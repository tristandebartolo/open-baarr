<?php

declare(strict_types=1);

namespace Drupal\opencar_display\Service;

use Drupal\Core\Database\Connection;

/**
 * Statistiques globales publiques des trajets (page d'accueil).
 *
 * Contrairement à TripStatsService (opencar_core), qui agrège par
 * utilisateur sans tenir compte de la publication, ce service ne compte que
 * les trajets PUBLIÉS et terminés — les seuls visibles des anonymes. Pas de
 * cache interne : la cacheabilité est portée par les cache tags
 * (node_list:trajet) du render array qui consomme ces données.
 */
final class SiteStatsService {

  public function __construct(
    private readonly Connection $database,
  ) {}

  /**
   * Totaux publics : trajets publiés terminés, distance et D+ cumulés.
   *
   * @return array{trips: int, distance_m: float, elevation_gain_m: float, activities: array<string, int>}
   *   Les totaux, et le nombre de trajets par type d'activité.
   */
  public function publicTotals(): array {
    $query = $this->baseQuery();
    $query->leftJoin('node__field_distance', 'd', 'd.entity_id = n.nid AND d.deleted = 0');
    $query->leftJoin('node__field_elevation_gain', 'e', 'e.entity_id = n.nid AND e.deleted = 0');
    $query->addExpression('COUNT(n.nid)', 'trips');
    $query->addExpression('COALESCE(SUM(d.field_distance_value), 0)', 'distance');
    $query->addExpression('COALESCE(SUM(e.field_elevation_gain_value), 0)', 'elevation_gain');
    $row = $query->execute()->fetchAssoc();

    return [
      'trips' => (int) ($row['trips'] ?? 0),
      'distance_m' => (float) ($row['distance'] ?? 0),
      'elevation_gain_m' => (float) ($row['elevation_gain'] ?? 0),
      'activities' => $this->activityCounts(),
    ];
  }

  /**
   * Nombre de trajets publiés terminés par type d'activité.
   *
   * @return array<string, int>
   *   Clé : valeur machine de field_activity_type, ordre décroissant.
   */
  private function activityCounts(): array {
    $query = $this->baseQuery();
    $query->innerJoin('node__field_activity_type', 'a', 'a.entity_id = n.nid AND a.deleted = 0');
    $query->addField('a', 'field_activity_type_value', 'activity');
    $query->addExpression('COUNT(n.nid)', 'trips');
    $query->groupBy('a.field_activity_type_value');
    $query->orderBy('trips', 'DESC');

    $counts = [];
    foreach ($query->execute() as $row) {
      $counts[(string) $row->activity] = (int) $row->trips;
    }
    return $counts;
  }

  /**
   * Requête de base : trajets publiés au statut completed.
   */
  private function baseQuery(): \Drupal\Core\Database\Query\SelectInterface {
    $query = $this->database->select('node_field_data', 'n');
    $query->innerJoin('node__field_trip_status', 's', 's.entity_id = n.nid AND s.deleted = 0');
    $query->condition('n.type', 'trajet')
      ->condition('n.status', 1)
      ->condition('s.field_trip_status_value', 'completed');
    return $query;
  }

}
