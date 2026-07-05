<?php

declare(strict_types=1);

namespace Drupal\opencar_display\Service;

use Drupal\node\NodeInterface;
use Drupal\opencar_core\Service\TrackPointRepository;

/**
 * Construit les séries des graphiques d'un trajet (vitesse, altitude, FC).
 *
 * Les points de mesure (un par seconde) sont lus en base via
 * TrackPointRepository puis downsamplés à ~200 points par échantillonnage
 * régulier — le même algorithme que l'app mobile (open.app/src/utils/chart.ts),
 * pour un rendu identique des courbes. Les séries sont fournies en paires
 * {x, y} prêtes pour Chart.js : x en secondes depuis le départ, vitesse en
 * km/h.
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
      $series[$key] = $this->downsample($data, $maxPoints);
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
   * Échantillonnage régulier, identique à downsample() de l'app mobile.
   *
   * @param list<array{x: float, y: float}> $data
   *   Série ordonnée par x croissant.
   *
   * @return list<array{x: float, y: float}>
   *   Au plus $target (+1 pour le dernier) points, dernier point conservé.
   */
  private function downsample(array $data, int $target): array {
    $count = count($data);
    if ($count <= $target || $target < 2) {
      return $data;
    }

    $step = $count / $target;
    $sampled = [];
    for ($i = 0; $i < $target; $i++) {
      $sampled[] = $data[(int) floor($i * $step)];
    }
    $last = $data[$count - 1];
    if (end($sampled) !== $last) {
      $sampled[] = $last;
    }
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
