<?php

declare(strict_types=1);

namespace Drupal\opencar_core\Service;

/**
 * Calcul des métriques d'un trajet à partir de ses points de mesure.
 *
 * Service pur (aucune dépendance) : il reçoit les points ordonnés par
 * séquence (format TrackPointRepository::getPointsData()) et retourne les
 * métriques agrégées. La distance et les durées ne sont cumulées qu'entre
 * points d'un même segment : les pauses ne comptent ni dans la distance ni
 * dans la durée en mouvement.
 */
final class TripMetricsCalculator {

  private const EARTH_RADIUS_M = 6371000.0;

  /**
   * Calcule les métriques agrégées d'une liste de points ordonnés.
   *
   * @param list<array{timestamp_ms: int, lat: float, lng: float, altitude: float|null, speed: float|null, heart_rate: int|null, segment: int}> $points
   *   Points triés par séquence croissante.
   *
   * @return array{distance: float, duration: int, duration_total: int, elevation_gain: float, elevation_loss: float, speed_avg: float, speed_max: float, heart_rate_avg: int|null, heart_rate_max: int|null}
   *   Distance en mètres, durées en secondes, vitesses en m/s.
   */
  public function calculate(array $points): array {
    $distance = 0.0;
    $movingSeconds = 0.0;
    $elevationGain = 0.0;
    $elevationLoss = 0.0;
    $measuredSpeedMax = NULL;
    $computedSpeedMax = 0.0;
    $heartRates = [];

    $previous = NULL;
    foreach ($points as $point) {
      if ($point['heart_rate'] !== NULL) {
        $heartRates[] = $point['heart_rate'];
      }
      if ($point['speed'] !== NULL) {
        $measuredSpeedMax = max($measuredSpeedMax ?? 0.0, $point['speed']);
      }

      if ($previous !== NULL && $point['segment'] === $previous['segment']) {
        $legDistance = $this->haversine($previous['lat'], $previous['lng'], $point['lat'], $point['lng']);
        $distance += $legDistance;

        $deltaSeconds = ($point['timestamp_ms'] - $previous['timestamp_ms']) / 1000;
        if ($deltaSeconds > 0) {
          $movingSeconds += $deltaSeconds;
          $computedSpeedMax = max($computedSpeedMax, $legDistance / $deltaSeconds);
        }

        if ($point['altitude'] !== NULL && $previous['altitude'] !== NULL) {
          $deltaAltitude = $point['altitude'] - $previous['altitude'];
          if ($deltaAltitude >= 0) {
            $elevationGain += $deltaAltitude;
          }
          else {
            $elevationLoss -= $deltaAltitude;
          }
        }
      }

      $previous = $point;
    }

    $durationTotal = 0;
    if (count($points) >= 2) {
      $first = $points[array_key_first($points)];
      $last = $points[array_key_last($points)];
      $durationTotal = (int) round(($last['timestamp_ms'] - $first['timestamp_ms']) / 1000);
    }

    return [
      'distance' => $distance,
      'duration' => (int) round($movingSeconds),
      'duration_total' => $durationTotal,
      'elevation_gain' => $elevationGain,
      'elevation_loss' => $elevationLoss,
      'speed_avg' => $movingSeconds > 0 ? $distance / $movingSeconds : 0.0,
      'speed_max' => $measuredSpeedMax ?? $computedSpeedMax,
      'heart_rate_avg' => $heartRates === [] ? NULL : (int) round(array_sum($heartRates) / count($heartRates)),
      'heart_rate_max' => $heartRates === [] ? NULL : max($heartRates),
    ];
  }

  /**
   * Distance haversine en mètres entre deux coordonnées WGS84.
   */
  public function haversine(float $lat1, float $lng1, float $lat2, float $lng2): float {
    $latRad1 = deg2rad($lat1);
    $latRad2 = deg2rad($lat2);
    $deltaLat = deg2rad($lat2 - $lat1);
    $deltaLng = deg2rad($lng2 - $lng1);

    $a = sin($deltaLat / 2) ** 2 + cos($latRad1) * cos($latRad2) * sin($deltaLng / 2) ** 2;

    return 2 * self::EARTH_RADIUS_M * asin(min(1.0, sqrt($a)));
  }

}
