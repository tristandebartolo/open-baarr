<?php

declare(strict_types=1);

namespace Drupal\opencar_core\Service;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Database\Connection;
use Drupal\Core\Database\Statement\FetchAs;

/**
 * Agrégats statistiques sur les trajets terminés d'un utilisateur.
 *
 * Requêtes SQL directes sur les tables de champs (aucun chargement
 * d'entité) : totaux, records et série journalière pour les graphes.
 * Seuls les trajets `completed` sont comptés.
 */
final class TripStatsService {

  private const PERIODS = ['week', 'month', 'all'];

  /**
   * Fenêtres glissantes, en secondes.
   */
  private const PERIOD_LENGTHS = [
    'week' => 7 * 86400,
    'month' => 30 * 86400,
  ];

  public function __construct(
    private readonly Connection $database,
    private readonly TimeInterface $time,
  ) {}

  /**
   * Résumé statistique des trajets d'un utilisateur.
   *
   * @param int $uid
   *   L'utilisateur.
   * @param string $period
   *   'week' (7 jours glissants), 'month' (30 jours glissants) ou 'all'.
   * @param string|null $activityType
   *   Filtre optionnel sur field_activity_type.
   *
   * @return array{period: string, activity_type: string|null, totals: array{trips: int, distance: float, duration: int, duration_total: int, elevation_gain: float}, records: array{longest_distance: float, max_speed: float, longest_duration: int}, series: list<array{date: string, distance: float, duration: int}>}
   *   Distances en mètres, durées en secondes, vitesses en m/s.
   */
  public function summary(int $uid, string $period = 'all', ?string $activityType = NULL): array {
    if (!in_array($period, self::PERIODS, TRUE)) {
      throw new \InvalidArgumentException(sprintf('Période inconnue : "%s".', $period));
    }
    $since = isset(self::PERIOD_LENGTHS[$period])
      ? $this->time->getRequestTime() - self::PERIOD_LENGTHS[$period]
      : NULL;

    $rows = $this->fetchTripRows($uid, $since, $activityType);

    $totals = [
      'trips' => count($rows),
      'distance' => 0.0,
      'duration' => 0,
      'duration_total' => 0,
      'elevation_gain' => 0.0,
    ];
    $records = [
      'longest_distance' => 0.0,
      'max_speed' => 0.0,
      'longest_duration' => 0,
    ];
    $series = [];

    foreach ($rows as $row) {
      $distance = (float) ($row['distance'] ?? 0.0);
      $duration = (int) ($row['duration'] ?? 0);

      $totals['distance'] += $distance;
      $totals['duration'] += $duration;
      $totals['duration_total'] += (int) ($row['duration_total'] ?? 0);
      $totals['elevation_gain'] += (float) ($row['elevation_gain'] ?? 0.0);

      $records['longest_distance'] = max($records['longest_distance'], $distance);
      $records['max_speed'] = max($records['max_speed'], (float) ($row['speed_max'] ?? 0.0));
      $records['longest_duration'] = max($records['longest_duration'], $duration);

      if ($row['started_at'] !== NULL) {
        $day = date('Y-m-d', (int) $row['started_at']);
        $series[$day]['distance'] = ($series[$day]['distance'] ?? 0.0) + $distance;
        $series[$day]['duration'] = ($series[$day]['duration'] ?? 0) + $duration;
      }
    }

    ksort($series);

    return [
      'period' => $period,
      'activity_type' => $activityType,
      'totals' => $totals,
      'records' => $records,
      'series' => array_map(
        static fn (string $day, array $values): array => [
          'date' => $day,
          'distance' => $values['distance'],
          'duration' => $values['duration'],
        ],
        array_keys($series),
        $series,
      ),
    ];
  }

  /**
   * Lit les métriques des trajets terminés, une ligne par trajet.
   *
   * @return list<array<string, string|null>>
   *   Lignes brutes (une par node trajet completed de l'utilisateur).
   */
  private function fetchTripRows(int $uid, ?int $since, ?string $activityType): array {
    $query = $this->database->select('node_field_data', 'n');
    $query->addField('n', 'nid');
    $query->condition('n.type', 'trajet');
    $query->condition('n.uid', $uid);

    $query->innerJoin('node__field_trip_status', 'ts', 'ts.entity_id = n.nid AND ts.deleted = 0');
    $query->condition('ts.field_trip_status_value', 'completed');

    $fields = [
      'distance' => 'field_distance',
      'duration' => 'field_duration',
      'duration_total' => 'field_duration_total',
      'elevation_gain' => 'field_elevation_gain',
      'speed_max' => 'field_speed_max',
      'started_at' => 'field_started_at',
    ];
    foreach ($fields as $alias => $fieldName) {
      $query->leftJoin("node__{$fieldName}", $alias . '_t', $alias . "_t.entity_id = n.nid AND {$alias}_t.deleted = 0");
      $query->addField($alias . '_t', $fieldName . '_value', $alias);
    }

    if ($since !== NULL) {
      $query->condition('started_at_t.field_started_at_value', $since, '>=');
    }
    if ($activityType !== NULL) {
      $query->innerJoin('node__field_activity_type', 'at', 'at.entity_id = n.nid AND at.deleted = 0');
      $query->condition('at.field_activity_type_value', $activityType);
    }

    return $query->execute()->fetchAll(FetchAs::Associative);
  }

}
