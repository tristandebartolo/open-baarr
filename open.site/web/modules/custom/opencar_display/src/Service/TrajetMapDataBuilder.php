<?php

declare(strict_types=1);

namespace Drupal\opencar_display\Service;

use Drupal\node\NodeInterface;

/**
 * Prépare les données de la carte d'un trajet (tracé + départ/arrivée).
 *
 * Le tracé vient de field_coordinates_travel (GeometryCollection GeoJSON,
 * une LineString par segment — voir TripGeometryBuilder). Le point de départ
 * vient de field_coordinates, avec repli sur la première coordonnée du tracé.
 */
final class TrajetMapDataBuilder {

  /**
   * Construit les données carte d'un trajet.
   *
   * @return array{geojson: array<string, mixed>, start: array{lat: float, lng: float}|null, end: array{lat: float, lng: float}|null}|null
   *   Les données, ou NULL si le trajet n'a pas de tracé exploitable.
   */
  public function build(NodeInterface $trajet): ?array {
    if (!$trajet->hasField('field_coordinates_travel') || $trajet->get('field_coordinates_travel')->isEmpty()) {
      return NULL;
    }
    $raw = $trajet->get('field_coordinates_travel')->geojson;
    if (!is_string($raw) || $raw === '') {
      return NULL;
    }
    try {
      $geojson = json_decode($raw, TRUE, 32, JSON_THROW_ON_ERROR);
    }
    catch (\JsonException) {
      return NULL;
    }
    if (!is_array($geojson) || ($geojson['geometries'] ?? []) === []) {
      return NULL;
    }

    return [
      'geojson' => $geojson,
      'start' => $this->startPoint($trajet, $geojson),
      'end' => $this->endPoint($geojson),
    ];
  }

  /**
   * Point de départ : field_coordinates, sinon première coordonnée du tracé.
   *
   * @param array<string, mixed> $geojson
   *   La GeometryCollection décodée.
   *
   * @return array{lat: float, lng: float}|null
   *   Le point, ou NULL faute de donnée.
   */
  private function startPoint(NodeInterface $trajet, array $geojson): ?array {
    if ($trajet->hasField('field_coordinates') && !$trajet->get('field_coordinates')->isEmpty()) {
      $item = $trajet->get('field_coordinates')->first();
      $lat = $item?->get('lat')?->getValue();
      $lng = $item?->get('lng')?->getValue();
      if (is_numeric($lat) && is_numeric($lng)) {
        return ['lat' => (float) $lat, 'lng' => (float) $lng];
      }
    }
    $first = $geojson['geometries'][0]['coordinates'][0] ?? NULL;
    if (is_array($first) && isset($first[0], $first[1])) {
      // GeoJSON stocke [longitude, latitude].
      return ['lat' => (float) $first[1], 'lng' => (float) $first[0]];
    }
    return NULL;
  }

  /**
   * Point d'arrivée : dernière coordonnée de la dernière LineString.
   *
   * @param array<string, mixed> $geojson
   *   La GeometryCollection décodée.
   *
   * @return array{lat: float, lng: float}|null
   *   Le point, ou NULL faute de donnée.
   */
  private function endPoint(array $geojson): ?array {
    $geometries = $geojson['geometries'] ?? [];
    $last = end($geometries);
    if (!is_array($last)) {
      return NULL;
    }
    $coordinates = $last['coordinates'] ?? [];
    $point = end($coordinates);
    if (is_array($point) && isset($point[0], $point[1])) {
      return ['lat' => (float) $point[1], 'lng' => (float) $point[0]];
    }
    return NULL;
  }

}
