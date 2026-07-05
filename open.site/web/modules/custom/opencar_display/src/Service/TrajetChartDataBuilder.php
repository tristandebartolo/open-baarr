<?php

declare(strict_types=1);

namespace Drupal\opencar_display\Service;

use Drupal\node\NodeInterface;
use Drupal\opencar_core\Service\TrackPointRepository;

/**
 * Construit les séries des graphiques d'un trajet (vitesse, altitude, FC).
 *
 * Les points de mesure (un par seconde) sont lus en base via
 * TrackPointRepository puis downsamplés à ~200 points par l'algorithme LTTB
 * (Largest Triangle Three Buckets), comme dans l'app mobile. Les séries sont
 * fournies en paires {x, y} prêtes pour Chart.js : x en secondes depuis le
 * départ, vitesse en km/h.
 */
final class TrajetChartDataBuilder {

  public function __construct(
    private readonly TrackPointRepository $trackPointRepository,
  ) {}

  /**
   * Construit les séries downsamplées d'un trajet.
   *
   * @return array{series: array<string, list<array{x: float, y: float}>>, summary: array<string, string>}|null
   *   Les séries présentes (speed, altitude, heartRate) et un résumé textuel
   *   par série pour les aria-labels, ou NULL si le trajet n'a aucun point.
   */
  public function build(NodeInterface $trajet, int $maxPoints = 200): ?array {
    $points = $this->trackPointRepository->getPointsData((int) $trajet->id());
    if ($points === []) {
      return NULL;
    }

    $origin = $points[0]['timestamp_ms'];
    $speed = [];
    $altitude = [];
    $heartRate = [];
    foreach ($points as $point) {
      $x = ($point['timestamp_ms'] - $origin) / 1000;
      if ($point['speed'] !== NULL) {
        $speed[] = ['x' => $x, 'y' => round($point['speed'] * 3.6, 2)];
      }
      if ($point['altitude'] !== NULL) {
        $altitude[] = ['x' => $x, 'y' => round($point['altitude'], 1)];
      }
      if ($point['heart_rate'] !== NULL) {
        $heartRate[] = ['x' => $x, 'y' => (float) $point['heart_rate']];
      }
    }

    $series = [];
    $summary = [];
    foreach (['speed' => $speed, 'altitude' => $altitude, 'heartRate' => $heartRate] as $key => $data) {
      if (count($data) < 2) {
        continue;
      }
      $series[$key] = $this->downsampleLttb($data, $maxPoints);
      $summary[$key] = $this->summarize($key, $data);
    }

    if ($series === []) {
      return NULL;
    }

    return [
      'series' => $series,
      'summary' => $summary,
    ];
  }

  /**
   * Downsampling LTTB : préserve la forme visuelle de la courbe.
   *
   * @param list<array{x: float, y: float}> $data
   *   Série ordonnée par x croissant.
   *
   * @return list<array{x: float, y: float}>
   *   Au plus $threshold points, premier et dernier conservés.
   */
  private function downsampleLttb(array $data, int $threshold): array {
    $count = count($data);
    if ($threshold >= $count || $threshold < 3) {
      return $data;
    }

    $sampled = [$data[0]];
    $bucketSize = ($count - 2) / ($threshold - 2);
    $previousIndex = 0;

    for ($i = 0; $i < $threshold - 2; $i++) {
      // Moyenne du bucket suivant (point d'ancrage du triangle).
      $rangeStart = (int) floor(($i + 1) * $bucketSize) + 1;
      $rangeEnd = min((int) floor(($i + 2) * $bucketSize) + 1, $count);
      $avgX = 0.0;
      $avgY = 0.0;
      $rangeLength = $rangeEnd - $rangeStart;
      for ($j = $rangeStart; $j < $rangeEnd; $j++) {
        $avgX += $data[$j]['x'];
        $avgY += $data[$j]['y'];
      }
      if ($rangeLength > 0) {
        $avgX /= $rangeLength;
        $avgY /= $rangeLength;
      }

      // Point du bucket courant qui maximise l'aire du triangle.
      $bucketStart = (int) floor($i * $bucketSize) + 1;
      $bucketEnd = min((int) floor(($i + 1) * $bucketSize) + 1, $count - 1);
      $pointAx = $data[$previousIndex]['x'];
      $pointAy = $data[$previousIndex]['y'];
      $maxArea = -1.0;
      $maxIndex = $bucketStart;
      for ($j = $bucketStart; $j < $bucketEnd; $j++) {
        $area = abs(
          ($pointAx - $avgX) * ($data[$j]['y'] - $pointAy)
          - ($pointAx - $data[$j]['x']) * ($avgY - $pointAy)
        ) / 2;
        if ($area > $maxArea) {
          $maxArea = $area;
          $maxIndex = $j;
        }
      }

      $sampled[] = $data[$maxIndex];
      $previousIndex = $maxIndex;
    }

    $sampled[] = $data[$count - 1];
    return $sampled;
  }

  /**
   * Résumé textuel FR d'une série (pour l'aria-label du canvas).
   */
  private function summarize(string $key, array $data): string {
    $values = array_column($data, 'y');
    $min = min($values);
    $max = max($values);
    $avg = array_sum($values) / count($values);
    [$label, $unit] = match ($key) {
      'speed' => ['Vitesse', 'km/h'],
      'altitude' => ['Altitude', 'm'],
      default => ['Fréquence cardiaque', 'bpm'],
    };
    $format = static fn (float $value): string => number_format($value, 1, ',', ' ');
    return sprintf(
      '%s : minimum %s %s, maximum %s %s, moyenne %s %s.',
      $label,
      $format($min),
      $unit,
      $format($max),
      $unit,
      $format($avg),
      $unit,
    );
  }

}
