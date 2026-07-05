<?php

declare(strict_types=1);

namespace Drupal\opencar_display\Service;

use Drupal\Core\Datetime\DateFormatterInterface;
use Drupal\node\NodeInterface;

/**
 * Prépare les tuiles de statistiques d'un trajet pour l'affichage web.
 *
 * Reprend les formats FR de l'app mobile (open.app/src/utils/format.ts) :
 * distance en km avec virgule, durées H:MM:SS, vitesses m/s → km/h. Tous les
 * accès champ sont gardés par hasField()/isEmpty() — notamment les champs
 * météo, dont la configuration peut ne pas encore être déployée.
 */
final class TrajetStatsPresenter {

  /**
   * Couleur associée à chaque type d'activité (identique à l'app mobile).
   */
  private const ACTIVITY_COLORS = [
    'car' => '#208AEF',
    'motorcycle' => '#E8890C',
    'running' => '#E25C4A',
    'walking' => '#2E9E6B',
    'hiking' => '#7A5AF8',
  ];

  /**
   * Libellé FR de chaque type d'activité (identique à l'app mobile).
   */
  private const ACTIVITY_LABELS = [
    'car' => 'Voiture',
    'motorcycle' => 'Moto',
    'running' => 'Course',
    'walking' => 'Marche',
    'hiking' => 'Rando',
  ];

  public function __construct(
    private readonly DateFormatterInterface $dateFormatter,
  ) {}

  /**
   * Construit les tuiles de stats d'un trajet, groupées par section.
   *
   * @return list<array{id: string, label: string, value: string, icon: string, hero: bool, group: string}>
   *   Les tuiles dans l'ordre d'affichage ; une tuile n'apparaît que si sa
   *   donnée existe. Groupes : stats, health, weather.
   */
  public function build(NodeInterface $trajet): array {
    $tiles = [];

    $distance = $this->floatValue($trajet, 'field_distance');
    if ($distance !== NULL) {
      $tiles[] = $this->tile('distance', 'Distance', $this->formatDistance($distance), 'move', 'stats', hero: TRUE);
    }
    $duration = $this->intValue($trajet, 'field_duration');
    if ($duration !== NULL) {
      $tiles[] = $this->tile('duration', 'En mouvement', $this->formatDuration($duration), 'clock', 'stats');
    }
    $durationTotal = $this->intValue($trajet, 'field_duration_total');
    if ($durationTotal !== NULL) {
      $tiles[] = $this->tile('duration_total', 'Durée totale', $this->formatDuration($durationTotal), 'history', 'stats');
    }
    $speedAvg = $this->floatValue($trajet, 'field_speed_avg');
    if ($speedAvg !== NULL) {
      $tiles[] = $this->tile('speed_avg', 'Vitesse moy.', $this->formatSpeed($speedAvg), 'forward', 'stats');
    }
    $speedMax = $this->floatValue($trajet, 'field_speed_max');
    if ($speedMax !== NULL) {
      $tiles[] = $this->tile('speed_max', 'Vitesse max', $this->formatSpeed($speedMax), 'bolt', 'stats');
    }
    $elevationGain = $this->floatValue($trajet, 'field_elevation_gain');
    if ($elevationGain !== NULL) {
      $tiles[] = $this->tile('elevation_gain', 'Dénivelé +', $this->formatElevation($elevationGain), 'arrow-up', 'stats');
    }
    $elevationLoss = $this->floatValue($trajet, 'field_elevation_loss');
    if ($elevationLoss !== NULL) {
      $tiles[] = $this->tile('elevation_loss', 'Dénivelé −', $this->formatElevation($elevationLoss), 'arrow-down', 'stats');
    }

    $heartRateAvg = $this->intValue($trajet, 'field_heart_rate_avg');
    if ($heartRateAvg !== NULL) {
      $tiles[] = $this->tile('heart_rate_avg', 'FC moyenne', $heartRateAvg . ' bpm', 'heart', 'health');
    }
    $heartRateMax = $this->intValue($trajet, 'field_heart_rate_max');
    if ($heartRateMax !== NULL) {
      $tiles[] = $this->tile('heart_rate_max', 'FC max', $heartRateMax . ' bpm', 'heart', 'health');
    }
    $steps = $this->intValue($trajet, 'field_steps');
    if ($steps !== NULL) {
      $tiles[] = $this->tile('steps', 'Pas', $this->formatInt($steps), 'oc-footsteps', 'health');
    }
    $calories = $this->floatValue($trajet, 'field_calories');
    if ($calories !== NULL) {
      $tiles[] = $this->tile('calories', 'Calories', $this->formatInt((int) round($calories)) . ' kcal', 'oc-fire', 'health');
    }

    $temperature = $this->floatValue($trajet, 'field_temperature');
    if ($temperature !== NULL) {
      $tiles[] = $this->tile('temperature', 'Température', $this->formatDecimal($temperature, 1) . ' °C', 'oc-thermometer', 'weather');
    }
    $weatherCode = $this->intValue($trajet, 'field_weather_code');
    if ($weatherCode !== NULL) {
      $tiles[] = $this->tile('weather', 'Ciel', $this->weatherLabel($weatherCode), 'oc-cloud', 'weather');
    }
    $windSpeed = $this->floatValue($trajet, 'field_wind_speed');
    if ($windSpeed !== NULL) {
      $tiles[] = $this->tile('wind', 'Vent', $this->formatSpeed($windSpeed), 'oc-wind', 'weather');
    }

    return $tiles;
  }

  /**
   * Couleur hexadécimale du type d'activité (accent par défaut).
   */
  public function activityColor(?string $activityType): string {
    return self::ACTIVITY_COLORS[$activityType] ?? '#208AEF';
  }

  /**
   * Libellé FR du type d'activité.
   */
  public function activityLabel(?string $activityType): string {
    return self::ACTIVITY_LABELS[$activityType] ?? 'Trajet';
  }

  /**
   * Libellé FR d'un code météo WMO (mêmes groupes que l'app mobile).
   */
  public function weatherLabel(int $code): string {
    return match (TRUE) {
      $code === 0 => 'Ciel clair',
      $code <= 2 => 'Peu nuageux',
      $code === 3 => 'Couvert',
      $code <= 48 => 'Brouillard',
      $code <= 57 => 'Bruine',
      $code <= 67 => 'Pluie',
      $code <= 77 => 'Neige',
      $code <= 82 => 'Averses',
      $code <= 86 => 'Averses de neige',
      default => 'Orage',
    };
  }

  /**
   * Date/heure « 04/07/2026 14:45 » d'un timestamp, NULL si champ vide.
   */
  public function formatDateTime(NodeInterface $trajet, string $field): ?string {
    $timestamp = $this->intValue($trajet, $field);
    if ($timestamp === NULL) {
      return NULL;
    }
    return $this->dateFormatter->format($timestamp, 'custom', 'd/m/Y H:i');
  }

  /**
   * Distance en mètres → « 850 m » ou « 12,45 km ».
   */
  public function formatDistance(float $meters): string {
    if ($meters < 1000) {
      return round($meters) . ' m';
    }
    return $this->formatDecimal($meters / 1000, 2) . ' km';
  }

  /**
   * Durée en secondes → « H:MM:SS » ou « M:SS ».
   */
  public function formatDuration(int $seconds): string {
    $h = intdiv($seconds, 3600);
    $m = intdiv($seconds % 3600, 60);
    $s = $seconds % 60;
    if ($h > 0) {
      return sprintf('%d:%02d:%02d', $h, $m, $s);
    }
    return sprintf('%d:%02d', $m, $s);
  }

  /**
   * Vitesse en m/s → « 12,4 km/h ».
   */
  public function formatSpeed(float $speedMs): string {
    return $this->formatDecimal($speedMs * 3.6, 1) . ' km/h';
  }

  /**
   * Dénivelé en mètres entiers → « 320 m ».
   */
  public function formatElevation(float $meters): string {
    return round($meters) . ' m';
  }

  /**
   * Nombre décimal au format FR (virgule).
   */
  private function formatDecimal(float $value, int $decimals): string {
    return number_format($value, $decimals, ',', ' ');
  }

  /**
   * Entier au format FR (séparateur de milliers : espace).
   */
  private function formatInt(int $value): string {
    return number_format($value, 0, ',', ' ');
  }

  /**
   * Fabrique une tuile de stat.
   *
   * @return array{id: string, label: string, value: string, icon: string, hero: bool, group: string}
   *   La tuile.
   */
  private function tile(string $id, string $label, string $value, string $icon, string $group, bool $hero = FALSE): array {
    return [
      'id' => $id,
      'label' => $label,
      'value' => $value,
      'icon' => $icon,
      'hero' => $hero,
      'group' => $group,
    ];
  }

  /**
   * Valeur flottante d'un champ, NULL si absent ou vide.
   */
  private function floatValue(NodeInterface $trajet, string $field): ?float {
    if (!$trajet->hasField($field) || $trajet->get($field)->isEmpty()) {
      return NULL;
    }
    return (float) $trajet->get($field)->value;
  }

  /**
   * Valeur entière d'un champ, NULL si absent ou vide.
   */
  private function intValue(NodeInterface $trajet, string $field): ?int {
    if (!$trajet->hasField($field) || $trajet->get($field)->isEmpty()) {
      return NULL;
    }
    return (int) $trajet->get($field)->value;
  }

}
