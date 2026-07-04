<?php

declare(strict_types=1);

namespace Drupal\opencar_api\Controller;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\File\FileExists;
use Drupal\Core\File\FileSystemInterface;
use Drupal\Core\File\FileUrlGeneratorInterface;
use Drupal\file\FileRepositoryInterface;
use Drupal\opencar_api\Service\TripRepository;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * POST /opencar/api/v1/trips/{uuid}/photos — upload multipart d'une photo.
 *
 * Le fichier est écrit dans le répertoire de la médiathèque, un media
 * `image` est créé puis ajouté à la galerie (`field_galerie`) du trajet.
 * Les champs lat/lng/taken_at du payload sont acceptés mais non persistés
 * en V1 (l'EXIF de la photo porte déjà la géolocalisation).
 */
final class TripPhotoController extends ControllerBase {

  private const ALLOWED_EXTENSIONS = ['png', 'gif', 'jpg', 'jpeg', 'webp'];
  private const MAX_SIZE_BYTES = 20 * 1024 * 1024;

  public function __construct(
    private readonly TripRepository $tripRepository,
    private readonly FileRepositoryInterface $fileRepository,
    private readonly FileSystemInterface $fileSystem,
    private readonly FileUrlGeneratorInterface $fileUrlGenerator,
    private readonly TimeInterface $time,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('opencar_api.trip_repository'),
      $container->get('file.repository'),
      $container->get('file_system'),
      $container->get('file_url_generator'),
      $container->get('datetime.time'),
    );
  }

  /**
   * Attache une photo au trajet.
   */
  public function upload(string $uuid, Request $request): JsonResponse {
    $trip = $this->tripRepository->loadForAccount($uuid, $this->currentUser());
    $upload = $request->files->get('file');
    if (!$upload instanceof UploadedFile || !$upload->isValid()) {
      throw new UnprocessableEntityHttpException('file : fichier image requis (multipart/form-data).');
    }
    $extension = mb_strtolower($upload->getClientOriginalExtension());
    if (!in_array($extension, self::ALLOWED_EXTENSIONS, TRUE)) {
      throw new UnprocessableEntityHttpException('file : extensions autorisées ' . implode(', ', self::ALLOWED_EXTENSIONS) . '.');
    }
    if ($upload->getSize() === FALSE || $upload->getSize() > self::MAX_SIZE_BYTES) {
      throw new UnprocessableEntityHttpException('file : 20 Mo maximum.');
    }
    // Contrôle du contenu réel (pas du nom) : Drupal remplace le guesser
    // Symfony par un guesser à l'extension, inutilisable sur le fichier
    // temporaire d'upload — getimagesize() lit les octets.
    if (@getimagesize($upload->getPathname()) === FALSE) {
      throw new UnprocessableEntityHttpException('file : le contenu doit être une image.');
    }

    // Même arborescence que la médiathèque du site.
    $directory = 'public://mediatheque/images/' . gmdate('Y-m', $this->time->getRequestTime());
    if (!$this->fileSystem->prepareDirectory($directory, FileSystemInterface::CREATE_DIRECTORY | FileSystemInterface::MODIFY_PERMISSIONS)) {
      throw new HttpException(500, 'Impossible de préparer le répertoire de destination.');
    }

    $basename = preg_replace('/[^a-zA-Z0-9._-]+/', '_', $upload->getClientOriginalName());
    if ($basename === NULL || $basename === '' || $basename[0] === '.') {
      $basename = 'photo.' . $extension;
    }
    $content = file_get_contents($upload->getPathname());
    if ($content === FALSE) {
      throw new HttpException(500, 'Lecture du fichier reçu impossible.');
    }
    $file = $this->fileRepository->writeData($content, $directory . '/' . $basename, FileExists::Rename);

    $media = $this->entityTypeManager()->getStorage('media')->create([
      'bundle' => 'image',
      'uid' => (int) $trip->getOwnerId(),
      'name' => $trip->label() . ' — ' . $basename,
      'field_media_image' => [
        'target_id' => $file->id(),
        'alt' => (string) $trip->label(),
      ],
    ]);
    $media->save();

    $trip->get('field_galerie')->appendItem(['target_id' => $media->id()]);
    $trip->save();

    return new JsonResponse([
      'id' => (int) $media->id(),
      'uuid' => (string) $media->uuid(),
      'url' => $this->fileUrlGenerator->generateAbsoluteString($file->getFileUri()),
    ], 201);
  }

}
