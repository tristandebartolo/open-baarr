<?php

declare(strict_types=1);

namespace Drupal\opencar_api\Service;

use Drupal\Core\File\FileUrlGeneratorInterface;
use Drupal\file\FileInterface;
use Drupal\media\MediaInterface;
use Drupal\node\NodeInterface;
use Drupal\opencar_core\Service\TrackPointRepository;

/**
 * Transforme un node trajet en tableau JSON pour l'API mobile.
 *
 * Deux niveaux : résumé (listes) et détail (ajoute body, diagnostic,
 * nombre de points et URLs des photos). Tous les accès champ sont gardés
 * par hasField() pour rester robuste si un champ manque.
 */
final class TripNormalizer {

  public function __construct(
    private readonly TrackPointRepository $trackPointRepository,
    private readonly FileUrlGeneratorInterface $fileUrlGenerator,
  ) {}

  /**
   * Normalise un trajet en tableau exportable JSON.
   *
   * @return array<string, mixed>
   *   La représentation JSON du trajet.
   */
  public function normalize(NodeInterface $trip, bool $detailed = FALSE): array {
    $data = [
      'uuid' => $trip->uuid(),
      'title' => $trip->label(),
      'published' => $trip->isPublished(),
      'activity_type' => $this->stringValue($trip, 'field_activity_type'),
      'status' => $this->stringValue($trip, 'field_trip_status'),
      'started_at' => $this->intValue($trip, 'field_started_at'),
      'ended_at' => $this->intValue($trip, 'field_ended_at'),
      'metrics' => [
        'distance' => $this->floatValue($trip, 'field_distance'),
        'duration' => $this->intValue($trip, 'field_duration'),
        'duration_total' => $this->intValue($trip, 'field_duration_total'),
        'elevation_gain' => $this->floatValue($trip, 'field_elevation_gain'),
        'elevation_loss' => $this->floatValue($trip, 'field_elevation_loss'),
        'speed_avg' => $this->floatValue($trip, 'field_speed_avg'),
        'speed_max' => $this->floatValue($trip, 'field_speed_max'),
      ],
      'health' => [
        'heart_rate_avg' => $this->intValue($trip, 'field_heart_rate_avg'),
        'heart_rate_max' => $this->intValue($trip, 'field_heart_rate_max'),
        'steps' => $this->intValue($trip, 'field_steps'),
        'calories' => $this->floatValue($trip, 'field_calories'),
        'weight' => $this->floatValue($trip, 'field_weight'),
        'hydration' => $this->floatValue($trip, 'field_hydration'),
        'feeling' => $this->intValue($trip, 'field_feeling'),
        'fatigue' => $this->intValue($trip, 'field_fatigue'),
      ],
      'created' => (int) $trip->getCreatedTime(),
      'changed' => (int) $trip->getChangedTime(),
    ];

    if ($detailed) {
      $data['chapo'] = $this->stringValue($trip, 'field_chapo');
      $data['body'] = $this->stringValue($trip, 'field_body');
      $data['diagnostic'] = [
        'battery_start' => $this->intValue($trip, 'field_battery_start'),
        'battery_end' => $this->intValue($trip, 'field_battery_end'),
        'device_info' => $this->stringValue($trip, 'field_device_info'),
      ];
      $data['points_count'] = $this->trackPointRepository->countForTrip((int) $trip->id());
      $data['photos'] = $this->photos($trip);
    }

    return $data;
  }

  /**
   * URLs absolues et métadonnées des photos de la galerie du trajet.
   *
   * @return list<array<string, mixed>>
   *   Une entrée par media image référencé dans field_galerie.
   */
  private function photos(NodeInterface $trip): array {
    if (!$trip->hasField('field_galerie')) {
      return [];
    }
    $photos = [];
    foreach ($trip->get('field_galerie')->referencedEntities() as $media) {
      if (!$media instanceof MediaInterface) {
        continue;
      }
      $photo = $this->normalizePhoto($media);
      if ($photo !== NULL) {
        $photos[] = $photo;
      }
    }
    return $photos;
  }

  /**
   * Normalise un media image (photo de trajet) en tableau JSON.
   *
   * @return array{id: int, uuid: string, url: string, name: string, description: string|null, copyright: string|null, coordinates: array{lat: float, lng: float}|null}|null
   *   NULL si le media n'a pas de fichier source exploitable.
   */
  public function normalizePhoto(MediaInterface $media): ?array {
    $sourceField = $media->getSource()->getConfiguration()['source_field'] ?? NULL;
    if ($sourceField === NULL || !$media->hasField($sourceField)) {
      return NULL;
    }
    $file = $media->get($sourceField)->entity;
    if (!$file instanceof FileInterface || $file->getFileUri() === NULL) {
      return NULL;
    }

    $coordinates = NULL;
    if ($media->hasField('field_coordinates') && !$media->get('field_coordinates')->isEmpty()) {
      $item = $media->get('field_coordinates')->first();
      $lat = $item?->get('lat')->getValue();
      $lng = $item?->get('lng')->getValue();
      if ($lat !== NULL && $lng !== NULL) {
        $coordinates = ['lat' => (float) $lat, 'lng' => (float) $lng];
      }
    }

    return [
      'id' => (int) $media->id(),
      'uuid' => (string) $media->uuid(),
      'url' => $this->fileUrlGenerator->generateAbsoluteString($file->getFileUri()),
      'name' => (string) $media->label(),
      'description' => $this->mediaStringValue($media, 'field_description'),
      'copyright' => $this->mediaStringValue($media, 'field_copyright'),
      'coordinates' => $coordinates,
    ];
  }

  /**
   * Valeur chaîne d'un champ mono-valeur d'un media, NULL si absent ou vide.
   */
  private function mediaStringValue(MediaInterface $media, string $field): ?string {
    if (!$media->hasField($field) || $media->get($field)->isEmpty()) {
      return NULL;
    }
    return (string) $media->get($field)->value;
  }

  /**
   * Valeur chaîne d'un champ mono-valeur, NULL si absent ou vide.
   */
  private function stringValue(NodeInterface $trip, string $field): ?string {
    if (!$trip->hasField($field) || $trip->get($field)->isEmpty()) {
      return NULL;
    }
    return (string) $trip->get($field)->value;
  }

  /**
   * Valeur entière d'un champ mono-valeur, NULL si absent ou vide.
   */
  private function intValue(NodeInterface $trip, string $field): ?int {
    if (!$trip->hasField($field) || $trip->get($field)->isEmpty()) {
      return NULL;
    }
    return (int) $trip->get($field)->value;
  }

  /**
   * Valeur flottante d'un champ mono-valeur, NULL si absent ou vide.
   */
  private function floatValue(NodeInterface $trip, string $field): ?float {
    if (!$trip->hasField($field) || $trip->get($field)->isEmpty()) {
      return NULL;
    }
    return (float) $trip->get($field)->value;
  }

}
