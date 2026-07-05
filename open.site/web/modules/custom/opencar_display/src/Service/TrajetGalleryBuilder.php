<?php

declare(strict_types=1);

namespace Drupal\opencar_display\Service;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\File\FileUrlGeneratorInterface;
use Drupal\file\FileInterface;
use Drupal\image\ImageStyleInterface;
use Drupal\media\MediaInterface;
use Drupal\node\NodeInterface;

/**
 * Prépare la galerie photos d'un trajet pour la lightbox UIkit.
 *
 * Pour chaque media image de field_galerie : URL du fichier original (cible
 * de la lightbox), dérivée du style « large » pour la grille, alt, légende
 * (field_description) et crédit (field_copyright).
 */
final class TrajetGalleryBuilder {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly FileUrlGeneratorInterface $fileUrlGenerator,
  ) {}

  /**
   * Construit les entrées de la galerie d'un trajet.
   *
   * @return list<array{url: string, thumb: string, alt: string, caption: string|null, copyright: string|null}>
   *   Une entrée par photo exploitable, vide si pas de galerie.
   */
  public function build(NodeInterface $trajet): array {
    if (!$trajet->hasField('field_galerie') || $trajet->get('field_galerie')->isEmpty()) {
      return [];
    }

    $style = $this->entityTypeManager->getStorage('image_style')->load('large');
    $photos = [];
    foreach ($trajet->get('field_galerie')->referencedEntities() as $media) {
      if (!$media instanceof MediaInterface) {
        continue;
      }
      $photo = $this->normalize($media, $style instanceof ImageStyleInterface ? $style : NULL);
      if ($photo !== NULL) {
        $photos[] = $photo;
      }
    }
    return $photos;
  }

  /**
   * Normalise un media image en entrée de galerie.
   *
   * @return array{url: string, thumb: string, alt: string, caption: string|null, copyright: string|null}|null
   *   NULL si le media n'a pas de fichier image exploitable.
   */
  private function normalize(MediaInterface $media, ?ImageStyleInterface $style): ?array {
    $sourceField = $media->getSource()->getConfiguration()['source_field'] ?? NULL;
    if (!is_string($sourceField) || !$media->hasField($sourceField) || $media->get($sourceField)->isEmpty()) {
      return NULL;
    }
    $item = $media->get($sourceField)->first();
    $file = $media->get($sourceField)->entity;
    if (!$file instanceof FileInterface) {
      return NULL;
    }
    $uri = $file->getFileUri();
    if ($uri === NULL) {
      return NULL;
    }

    $url = $this->fileUrlGenerator->generateString($uri);
    $thumb = $style !== NULL && $style->supportsUri($uri) ? $style->buildUrl($uri) : $url;
    $alt = (string) ($item?->get('alt')?->getValue() ?? '');

    return [
      'url' => $url,
      'thumb' => $thumb,
      'alt' => $alt !== '' ? $alt : (string) $media->label(),
      'caption' => $this->stringValue($media, 'field_description'),
      'copyright' => $this->stringValue($media, 'field_copyright'),
    ];
  }

  /**
   * Valeur texte d'un champ du media, NULL si absente.
   */
  private function stringValue(MediaInterface $media, string $field): ?string {
    if (!$media->hasField($field) || $media->get($field)->isEmpty()) {
      return NULL;
    }
    $value = (string) $media->get($field)->value;
    return $value !== '' ? $value : NULL;
  }

}
