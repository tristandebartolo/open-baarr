<?php

declare(strict_types=1);

namespace Drupal\opencar_core;

use Drupal\Core\Entity\ContentEntityTypeInterface;
use Drupal\Core\Entity\Sql\SqlContentEntityStorageSchema;

/**
 * Schéma de stockage des points de mesure.
 *
 * Ajoute l'index unique (trajet, sequence) — garantie d'idempotence des
 * batches de points — et l'index (trajet, timestamp_ms) pour les lectures
 * ordonnées par temps.
 */
class TrackPointStorageSchema extends SqlContentEntityStorageSchema {

  /**
   * {@inheritdoc}
   *
   * @return array<string, array<string, mixed>>
   *   Le schéma par table.
   */
  protected function getEntitySchema(ContentEntityTypeInterface $entity_type, $reset = FALSE): array {
    $schema = parent::getEntitySchema($entity_type, $reset);

    $schema['opencar_track_point']['unique keys']['opencar_track_point__trajet_sequence'] = [
      'trajet',
      'sequence',
    ];
    $schema['opencar_track_point']['indexes']['opencar_track_point__trajet_timestamp'] = [
      'trajet',
      'timestamp_ms',
    ];

    return $schema;
  }

}
