<?php

declare(strict_types=1);

namespace Drupal\Tests\opencar_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Métriques et géométrie sur des jeux de points connus.
 */
#[Group('opencar_core')]
#[RunTestsInSeparateProcesses]
final class TripMetricsCalculatorTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['system', 'opencar_core'];

  /**
   * Fabrique un point avec des valeurs par défaut.
   *
   * @param array<string, mixed> $overrides
   *   Valeurs spécifiques du point.
   *
   * @return array<string, mixed>
   *   Le point complet.
   */
  private static function point(array $overrides): array {
    return $overrides + [
      'sequence' => 0,
      'timestamp_ms' => 0,
      'lat' => 0.0,
      'lng' => 0.0,
      'altitude' => NULL,
      'speed' => NULL,
      'bearing' => NULL,
      'accuracy' => NULL,
      'heart_rate' => NULL,
      'segment' => 0,
    ];
  }

  /**
   * Un trajet vide ou à point unique donne des métriques nulles.
   */
  public function testEmptyAndSinglePoint(): void {
    $calculator = $this->container->get('opencar_core.trip_metrics_calculator');

    $empty = $calculator->calculate([]);
    $this->assertSame(0.0, $empty['distance']);
    $this->assertSame(0, $empty['duration']);
    $this->assertSame(0, $empty['duration_total']);
    $this->assertNull($empty['heart_rate_avg']);

    $single = $calculator->calculate([self::point(['heart_rate' => 100])]);
    $this->assertSame(0.0, $single['distance']);
    $this->assertSame(100, $single['heart_rate_avg']);
    $this->assertSame(100, $single['heart_rate_max']);
  }

  /**
   * Distance haversine sur un cas connu : 0.01° de longitude à l'équateur.
   */
  public function testHaversineKnownDistance(): void {
    $calculator = $this->container->get('opencar_core.trip_metrics_calculator');

    // 0.01° d'arc sur un rayon de 6 371 km ≈ 1 111.95 m.
    $this->assertEqualsWithDelta(1111.95, $calculator->haversine(0.0, 0.0, 0.0, 0.01), 0.5);
    $this->assertSame(0.0, $calculator->haversine(45.0, 5.0, 45.0, 5.0));
  }

  /**
   * Métriques complètes sur un jeu de points connu, avec pause (segments).
   */
  public function testMetricsWithSegments(): void {
    $calculator = $this->container->get('opencar_core.trip_metrics_calculator');

    // Segment 0 : deux tronçons de ~1112 m en 2 × 60 s, montée 10 m puis 5 m
    // de descente. Pause de 300 s. Segment 1 : un tronçon de ~1112 m en 60 s.
    $points = [
      self::point(['sequence' => 0, 'timestamp_ms' => 0, 'lat' => 0.0, 'lng' => 0.0, 'altitude' => 100.0, 'speed' => 15.0, 'heart_rate' => 120, 'segment' => 0]),
      self::point(['sequence' => 1, 'timestamp_ms' => 60_000, 'lat' => 0.0, 'lng' => 0.01, 'altitude' => 110.0, 'speed' => 20.0, 'heart_rate' => 140, 'segment' => 0]),
      self::point(['sequence' => 2, 'timestamp_ms' => 120_000, 'lat' => 0.0, 'lng' => 0.02, 'altitude' => 105.0, 'speed' => 18.0, 'heart_rate' => 160, 'segment' => 0]),
      self::point(['sequence' => 3, 'timestamp_ms' => 420_000, 'lat' => 0.0, 'lng' => 0.02, 'altitude' => 105.0, 'speed' => 0.0, 'segment' => 1]),
      self::point(['sequence' => 4, 'timestamp_ms' => 480_000, 'lat' => 0.0, 'lng' => 0.03, 'altitude' => 105.0, 'speed' => 19.0, 'segment' => 1]),
    ];

    $metrics = $calculator->calculate($points);

    // 3 tronçons de ~1111.95 m ; le saut entre segments ne compte pas.
    $this->assertEqualsWithDelta(3 * 1111.95, $metrics['distance'], 2.0);
    // Durée en mouvement : 120 s (segment 0) + 60 s (segment 1).
    $this->assertSame(180, $metrics['duration']);
    // Durée totale : du premier au dernier timestamp, pause comprise.
    $this->assertSame(480, $metrics['duration_total']);
    $this->assertEqualsWithDelta(10.0, $metrics['elevation_gain'], 1e-6);
    $this->assertEqualsWithDelta(5.0, $metrics['elevation_loss'], 1e-6);
    // Vitesse moyenne = distance / durée en mouvement.
    $this->assertEqualsWithDelta(3 * 1111.95 / 180, $metrics['speed_avg'], 0.1);
    // Vitesse max mesurée par le GPS.
    $this->assertEqualsWithDelta(20.0, $metrics['speed_max'], 1e-6);
    $this->assertSame(140, $metrics['heart_rate_avg']);
    $this->assertSame(160, $metrics['heart_rate_max']);
  }

  /**
   * La géométrie GeoJSON coupe le tracé par segment.
   */
  public function testGeometryCollectionBySegment(): void {
    $builder = $this->container->get('opencar_core.trip_geometry_builder');

    $this->assertNull($builder->buildGeometryCollection([]));
    // Un segment à point unique ne produit pas de LineString.
    $this->assertNull($builder->buildGeometryCollection([self::point(['lat' => 1.5, 'lng' => 2.5])]));

    $geojson = $builder->buildGeometryCollection([
      self::point(['lat' => 1.5, 'lng' => 2.5, 'segment' => 0]),
      self::point(['lat' => 1.6, 'lng' => 2.6, 'segment' => 0]),
      self::point(['lat' => 1.7, 'lng' => 2.7, 'segment' => 1]),
      self::point(['lat' => 1.8, 'lng' => 2.8, 'segment' => 1]),
      // Segment 2 orphelin (un seul point) : ignoré.
      self::point(['lat' => 1.9, 'lng' => 2.9, 'segment' => 2]),
    ]);

    $this->assertNotNull($geojson);
    $decoded = json_decode($geojson, TRUE, 512, JSON_THROW_ON_ERROR);
    $this->assertSame('GeometryCollection', $decoded['type']);
    $this->assertCount(2, $decoded['geometries']);
    $this->assertSame('LineString', $decoded['geometries'][0]['type']);
    // GeoJSON stocke [lng, lat].
    $this->assertSame([2.5, 1.5], $decoded['geometries'][0]['coordinates'][0]);
    $this->assertSame([[2.7, 1.7], [2.8, 1.8]], $decoded['geometries'][1]['coordinates']);
  }

}
