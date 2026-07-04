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
   * URLs absolues des photos de la galerie du trajet.
   *
   * @return list<array{id: int, uuid: string, url: string}>
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
      $sourceField = $media->getSource()->getConfiguration()['source_field'] ?? NULL;
      if ($sourceField === NULL || !$media->hasField($sourceField)) {
        continue;
      }
      $file = $media->get($sourceField)->entity;
      if (!$file instanceof FileInterface || $file->getFileUri() === NULL) {
        continue;
      }
      $photos[] = [
        'id' => (int) $media->id(),
        'uuid' => (string) $media->uuid(),
        'url' => $this->fileUrlGenerator->generateAbsoluteString($file->getFileUri()),
      ];
    }
    return $photos;
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
