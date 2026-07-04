<?php

declare(strict_types=1);

namespace Drupal\opencar_core\Service;

use Drupal\node\NodeInterface;

/**
 * Export GPX 1.1 d'un trajet et de ses points de mesure.
 *
 * Produit un document GPX avec un <trkseg> par segment (les pauses coupent
 * la trace) et la fréquence cardiaque dans l'extension Garmin
 * TrackPointExtension quand elle est disponible.
 */
final class GpxGenerator {

  private const GPX_NS = 'http://www.topografix.com/GPX/1/1';
  private const TPX_NS = 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1';

  /**
   * Génère le document GPX d'un trajet.
   *
   * @param \Drupal\node\NodeInterface $trip
   *   Le node trajet (titre + date de départ pour les métadonnées).
   * @param list<array{timestamp_ms: int, lat: float, lng: float, altitude: float|null, heart_rate: int|null, segment: int}> $points
   *   Points triés par séquence croissante.
   *
   * @return string
   *   Le XML GPX 1.1.
   */
  public function generate(NodeInterface $trip, array $points): string {
    $writer = new \XMLWriter();
    $writer->openMemory();
    $writer->setIndent(TRUE);
    $writer->setIndentString('  ');
    $writer->startDocument('1.0', 'UTF-8');

    $writer->startElement('gpx');
    $writer->writeAttribute('version', '1.1');
    $writer->writeAttribute('creator', 'OpenCar');
    $writer->writeAttribute('xmlns', self::GPX_NS);
    $writer->writeAttribute('xmlns:gpxtpx', self::TPX_NS);

    $writer->startElement('metadata');
    $writer->writeElement('name', $trip->label() ?? '');
    $startedAt = $this->tripStartTimestamp($trip, $points);
    if ($startedAt !== NULL) {
      $writer->writeElement('time', $this->formatTime($startedAt * 1000));
    }
    $writer->endElement();

    $writer->startElement('trk');
    $writer->writeElement('name', $trip->label() ?? '');

    foreach ($this->groupBySegment($points) as $segmentPoints) {
      $writer->startElement('trkseg');
      foreach ($segmentPoints as $point) {
        $this->writeTrackPoint($writer, $point);
      }
      $writer->endElement();
    }

    $writer->endElement();
    $writer->endElement();
    $writer->endDocument();

    return $writer->outputMemory();
  }

  /**
   * Écrit un <trkpt> avec altitude, horodatage et fréquence cardiaque.
   *
   * @param array{timestamp_ms: int, lat: float, lng: float, altitude: float|null, heart_rate: int|null} $point
   *   Le point de mesure.
   */
  private function writeTrackPoint(\XMLWriter $writer, array $point): void {
    $writer->startElement('trkpt');
    $writer->writeAttribute('lat', number_format($point['lat'], 7, '.', ''));
    $writer->writeAttribute('lon', number_format($point['lng'], 7, '.', ''));

    if ($point['altitude'] !== NULL) {
      $writer->writeElement('ele', number_format($point['altitude'], 1, '.', ''));
    }
    $writer->writeElement('time', $this->formatTime($point['timestamp_ms']));

    if ($point['heart_rate'] !== NULL) {
      $writer->startElement('extensions');
      $writer->startElement('gpxtpx:TrackPointExtension');
      $writer->writeElement('gpxtpx:hr', (string) $point['heart_rate']);
      $writer->endElement();
      $writer->endElement();
    }

    $writer->endElement();
  }

  /**
   * Regroupe les points par segment en préservant l'ordre.
   *
   * @param list<array{segment: int}> $points
   *   Points triés par séquence croissante.
   *
   * @return array<int, list<array>>
   *   Points groupés par numéro de segment.
   */
  private function groupBySegment(array $points): array {
    $segments = [];
    foreach ($points as $point) {
      $segments[$point['segment']][] = $point;
    }
    return $segments;
  }

  /**
   * Timestamp de départ : field_started_at, sinon le premier point.
   *
   * @param list<array{timestamp_ms: int}> $points
   *   Points triés par séquence croissante.
   */
  private function tripStartTimestamp(NodeInterface $trip, array $points): ?int {
    if ($trip->hasField('field_started_at') && !$trip->get('field_started_at')->isEmpty()) {
      return (int) $trip->get('field_started_at')->value;
    }
    if ($points !== []) {
      return intdiv($points[array_key_first($points)]['timestamp_ms'], 1000);
    }
    return NULL;
  }

  /**
   * Formate un timestamp en millisecondes au format ISO 8601 UTC.
   */
  private function formatTime(int $timestampMs): string {
    return gmdate('Y-m-d\TH:i:s', intdiv($timestampMs, 1000))
      . sprintf('.%03dZ', $timestampMs % 1000);
  }

}
