<?php

declare(strict_types=1);

namespace Drupal\opencar_core\Service;

use Drupal\Core\Database\Connection;
use Drupal\Core\Database\Statement\FetchAs;

/**
 * Lecture des points de mesure d'un trajet, sans charger d'entités.
 *
 * Fournit aux autres services (métriques, géométrie, GPX) les points d'un
 * trajet sous forme de tableaux typés, triés par séquence.
 */
final class TrackPointRepository {

  public function __construct(
    private readonly Connection $database,
  ) {}

  /**
   * Retourne les points d'un trajet triés par séquence.
   *
   * @return list<array{sequence: int, timestamp_ms: int, lat: float, lng: float, altitude: float|null, speed: float|null, bearing: float|null, accuracy: float|null, heart_rate: int|null, segment: int}>
   *   Les points, ou un tableau vide si le trajet n'en a pas.
   */
  public function getPointsData(int $trajetId): array {
    $rows = $this->database->select('opencar_track_point', 'p')
      ->fields('p', [
        'sequence',
        'timestamp_ms',
        'lat',
        'lng',
        'altitude',
        'speed',
        'bearing',
        'accuracy',
        'heart_rate',
        'segment',
      ])
      ->condition('p.trajet', $trajetId)
      ->orderBy('p.sequence')
      ->execute()
      ->fetchAll(FetchAs::Associative);

    return array_map(
      static fn (array $row): array => [
        'sequence' => (int) $row['sequence'],
        'timestamp_ms' => (int) $row['timestamp_ms'],
        'lat' => (float) $row['lat'],
        'lng' => (float) $row['lng'],
        'altitude' => $row['altitude'] === NULL ? NULL : (float) $row['altitude'],
        'speed' => $row['speed'] === NULL ? NULL : (float) $row['speed'],
        'bearing' => $row['bearing'] === NULL ? NULL : (float) $row['bearing'],
        'accuracy' => $row['accuracy'] === NULL ? NULL : (float) $row['accuracy'],
        'heart_rate' => $row['heart_rate'] === NULL ? NULL : (int) $row['heart_rate'],
        'segment' => (int) $row['segment'],
      ],
      $rows,
    );
  }

  /**
   * Compte les points d'un trajet.
   */
  public function countForTrip(int $trajetId): int {
    return (int) $this->database->select('opencar_track_point', 'p')
      ->condition('p.trajet', $trajetId)
      ->countQuery()
      ->execute()
      ->fetchField();
  }

}
