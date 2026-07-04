<?php

declare(strict_types=1);

namespace Drupal\opencar_core\Service;

use Drupal\node\NodeInterface;

/**
 * Construit la géométrie d'un trajet à partir de ses points de mesure.
 *
 * Le champ cible `field_coordinates_travel` (type
 * geolocation_geometry_geometrycollection) stocke du GeoJSON : on produit
 * une GeometryCollection contenant une LineString par segment (les pauses
 * coupent le tracé).
 */
final class TripGeometryBuilder {

  /**
   * Construit la GeometryCollection GeoJSON d'une liste de points ordonnés.
   *
   * @param list<array{lat: float, lng: float, segment: int}> $points
   *   Points triés par séquence croissante.
   *
   * @return string|null
   *   Le GeoJSON, ou NULL si aucun segment n'a au moins deux points.
   */
  public function buildGeometryCollection(array $points): ?string {
    $segments = [];
    foreach ($points as $point) {
      // GeoJSON attend [longitude, latitude].
      $segments[$point['segment']][] = [$point['lng'], $point['lat']];
    }

    $geometries = [];
    foreach ($segments as $coordinates) {
      if (count($coordinates) >= 2) {
        $geometries[] = [
          'type' => 'LineString',
          'coordinates' => $coordinates,
        ];
      }
    }

    if ($geometries === []) {
      return NULL;
    }

    return json_encode([
      'type' => 'GeometryCollection',
      'geometries' => $geometries,
    ], JSON_THROW_ON_ERROR);
  }

  /**
   * Applique la géométrie calculée au node trajet (sans sauvegarder).
   *
   * @param \Drupal\node\NodeInterface $trip
   *   Le node trajet.
   * @param list<array{lat: float, lng: float, segment: int}> $points
   *   Points triés par séquence croissante.
   */
  public function applyToTrip(NodeInterface $trip, array $points): void {
    $geojson = $this->buildGeometryCollection($points);
    $trip->set('field_coordinates_travel', $geojson === NULL ? NULL : ['geojson' => $geojson]);
  }

}
