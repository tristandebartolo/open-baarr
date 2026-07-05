<?php

declare(strict_types=1);

namespace Drupal\opencar_api\Controller;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\File\FileExists;
use Drupal\Core\File\FileSystemInterface;
use Drupal\file\FileInterface;
use Drupal\file\FileRepositoryInterface;
use Drupal\media\MediaInterface;
use Drupal\node\NodeInterface;
use Drupal\opencar_api\Service\PayloadValidator;
use Drupal\opencar_api\Service\TripNormalizer;
use Drupal\opencar_api\Service\TripRepository;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * Photos de trajet : /opencar/api/v1/trips/{uuid}/photos[/{media_uuid}].
 *
 * - POST : upload multipart {file, description?, copyright?, lat?, lng?,
 *   taken_at?} → media image (field_description, field_copyright,
 *   field_coordinates) attaché à la galerie (`field_galerie`) du trajet.
 * - PATCH : mise à jour des métadonnées du media (name, description,
 *   copyright, lat/lng).
 * - DELETE : détache le media de la galerie puis supprime media et fichier.
 *
 * Isolation : un media n'est adressable que via un trajet du compte
 * courant ET référencé par sa galerie — sinon 404, sans fuite d'existence.
 */
final class TripPhotoController extends ControllerBase {

  private const ALLOWED_EXTENSIONS = ['png', 'gif', 'jpg', 'jpeg', 'webp'];
  private const MAX_SIZE_BYTES = 20 * 1024 * 1024;

  public function __construct(
    private readonly TripRepository $tripRepository,
    private readonly PayloadValidator $validator,
    private readonly TripNormalizer $normalizer,
    private readonly FileRepositoryInterface $fileRepository,
    private readonly FileSystemInterface $fileSystem,
    private readonly TimeInterface $time,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('opencar_api.trip_repository'),
      $container->get('opencar_api.payload_validator'),
      $container->get('opencar_api.trip_normalizer'),
      $container->get('file.repository'),
      $container->get('file_system'),
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

    $description = $this->formString($request, 'description', 1000);
    $copyright = $this->formString($request, 'copyright', 255);
    $coordinates = $this->formCoordinates($request);

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

    $values = [
      'bundle' => 'image',
      'uid' => (int) $trip->getOwnerId(),
      'name' => $trip->label() . ' — ' . $basename,
      'field_media_image' => [
        'target_id' => $file->id(),
        'alt' => $description ?? (string) $trip->label(),
      ],
    ];
    if ($description !== NULL) {
      $values['field_description'] = $description;
    }
    if ($copyright !== NULL) {
      $values['field_copyright'] = $copyright;
    }
    if ($coordinates !== NULL) {
      $values['field_coordinates'] = $coordinates;
    }
    $media = $this->entityTypeManager()->getStorage('media')->create($values);
    $media->save();

    $trip->get('field_galerie')->appendItem(['target_id' => $media->id()]);
    $trip->save();

    assert($media instanceof MediaInterface);
    return new JsonResponse($this->normalizer->normalizePhoto($media), 201);
  }

  /**
   * PATCH — métadonnées d'une photo (name, description, copyright, lat/lng).
   */
  public function update(string $uuid, string $media_uuid, Request $request): JsonResponse {
    $trip = $this->tripRepository->loadForAccount($uuid, $this->currentUser());
    $media = $this->loadTripMedia($trip, $media_uuid);
    $changes = $this->validator->validatePhotoUpdate($this->validator->decode($request));

    foreach ($changes as $key => $value) {
      switch ($key) {
        case 'name':
          $media->setName($value);
          break;

        case 'description':
          $this->setMediaField($media, 'field_description', $value);
          break;

        case 'copyright':
          $this->setMediaField($media, 'field_copyright', $value);
          break;

        case 'coordinates':
          $this->setMediaField($media, 'field_coordinates', $value);
          break;
      }
    }
    $media->save();

    return new JsonResponse($this->normalizer->normalizePhoto($media));
  }

  /**
   * DELETE — détache la photo de la galerie, supprime media et fichier.
   */
  public function delete(string $uuid, string $media_uuid): Response {
    $trip = $this->tripRepository->loadForAccount($uuid, $this->currentUser());
    $media = $this->loadTripMedia($trip, $media_uuid);

    // Retire la référence de la galerie du trajet.
    $items = $trip->get('field_galerie');
    for ($i = $items->count() - 1; $i >= 0; $i--) {
      $item = $items->get($i);
      if ($item !== NULL && (string) $item->get('target_id')->getValue() === (string) $media->id()) {
        $items->removeItem($i);
      }
    }
    $trip->save();

    // Supprime le media puis son fichier source (sinon il resterait
    // orphelin jusqu'au cron de nettoyage).
    $sourceField = $media->getSource()->getConfiguration()['source_field'] ?? NULL;
    $file = $sourceField !== NULL && $media->hasField($sourceField)
      ? $media->get($sourceField)->entity
      : NULL;
    $media->delete();
    if ($file instanceof FileInterface) {
      $file->delete();
    }

    return new Response('', 204);
  }

  /**
   * Charge un media par uuid, uniquement s'il est dans la galerie du trajet.
   */
  private function loadTripMedia(NodeInterface $trip, string $mediaUuid): MediaInterface {
    if ($trip->hasField('field_galerie')) {
      foreach ($trip->get('field_galerie')->referencedEntities() as $media) {
        if ($media instanceof MediaInterface && $media->uuid() === mb_strtolower($mediaUuid)) {
          return $media;
        }
      }
    }
    throw new NotFoundHttpException('Photo introuvable.');
  }

  /**
   * Affecte une valeur (ou NULL) à un champ si le media le porte.
   */
  private function setMediaField(MediaInterface $media, string $field, mixed $value): void {
    if ($media->hasField($field)) {
      $media->set($field, $value);
    }
  }

  /**
   * Champ texte optionnel du formulaire multipart, borné.
   */
  private function formString(Request $request, string $key, int $maxLength): ?string {
    $value = $request->request->get($key);
    if ($value === NULL || $value === '') {
      return NULL;
    }
    if (!is_string($value) || mb_strlen($value) > $maxLength) {
      throw new UnprocessableEntityHttpException(sprintf('%s : chaîne de %d caractères maximum attendue.', $key, $maxLength));
    }
    return $value;
  }

  /**
   * Coordonnées lat/lng optionnelles du formulaire multipart.
   *
   * @return array{lat: float, lng: float}|null
   *   NULL si absentes.
   */
  private function formCoordinates(Request $request): ?array {
    $lat = $request->request->get('lat');
    $lng = $request->request->get('lng');
    if ($lat === NULL || $lng === NULL || $lat === '' || $lng === '') {
      return NULL;
    }
    if (!is_numeric($lat) || !is_numeric($lng)
      || (float) $lat < -90.0 || (float) $lat > 90.0
      || (float) $lng < -180.0 || (float) $lng > 180.0) {
      throw new UnprocessableEntityHttpException('lat/lng : coordonnées invalides.');
    }
    return ['lat' => (float) $lat, 'lng' => (float) $lng];
  }

}
