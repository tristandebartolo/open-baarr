<?php

declare(strict_types=1);

namespace Drupal\opencar_core\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\opencar_core\TrackPointInterface;
use Drupal\opencar_core\TrackPointStorageSchema;
use Drupal\user\EntityOwnerTrait;
use Drupal\views\EntityViewsData;

/**
 * Point de mesure d'un trajet (une position GPS horodatée).
 *
 * Entité volontairement minimale : pas de révisions, pas de traduction,
 * pas de bundles, pas de formulaires — les points sont créés exclusivement
 * par l'API mobile (batch) et lus par les services métier.
 */
#[ContentEntityType(
  id: 'opencar_track_point',
  label: new TranslatableMarkup('Point de mesure'),
  label_collection: new TranslatableMarkup('Points de mesure'),
  label_singular: new TranslatableMarkup('point de mesure'),
  label_plural: new TranslatableMarkup('points de mesure'),
  entity_keys: [
    'id' => 'id',
    'uuid' => 'uuid',
    'owner' => 'uid',
  ],
  handlers: [
    'storage_schema' => TrackPointStorageSchema::class,
    'views_data' => EntityViewsData::class,
  ],
  admin_permission: 'administer opencar',
  base_table: 'opencar_track_point',
  label_count: [
    'singular' => '@count point de mesure',
    'plural' => '@count points de mesure',
  ],
)]
class TrackPoint extends ContentEntityBase implements TrackPointInterface {

  use EntityOwnerTrait;

  /**
   * {@inheritdoc}
   */
  public function preSave(EntityStorageInterface $storage): void {
    parent::preSave($storage);
    if (!$this->getOwnerId()) {
      $this->setOwnerId(0);
    }
  }

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);
    $fields += static::ownerBaseFieldDefinitions($entity_type);

    $fields['trajet'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Trajet'))
      ->setDescription(new TranslatableMarkup('Le node trajet auquel appartient ce point.'))
      ->setSetting('target_type', 'node')
      ->setSetting('handler', 'default')
      ->setSetting('handler_settings', ['target_bundles' => ['trajet' => 'trajet']])
      ->setRequired(TRUE);

    $uid = $fields['uid'];
    if ($uid instanceof BaseFieldDefinition) {
      $uid->setLabel(new TranslatableMarkup('Utilisateur'))
        ->setDescription(new TranslatableMarkup('Propriétaire du trajet (dénormalisé pour le contrôle d’accès).'));
    }

    $fields['sequence'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Séquence'))
      ->setDescription(new TranslatableMarkup('Numéro d’ordre du point côté client (idempotence des batches).'))
      ->setSetting('unsigned', TRUE)
      ->setRequired(TRUE);

    $fields['timestamp_ms'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Horodatage (ms)'))
      ->setDescription(new TranslatableMarkup('Horodatage de capture en millisecondes epoch.'))
      ->setSetting('size', 'big')
      ->setRequired(TRUE);

    $fields['lat'] = BaseFieldDefinition::create('decimal')
      ->setLabel(new TranslatableMarkup('Latitude'))
      ->setSetting('precision', 10)
      ->setSetting('scale', 7)
      ->setRequired(TRUE);

    $fields['lng'] = BaseFieldDefinition::create('decimal')
      ->setLabel(new TranslatableMarkup('Longitude'))
      ->setSetting('precision', 11)
      ->setSetting('scale', 7)
      ->setRequired(TRUE);

    $fields['altitude'] = BaseFieldDefinition::create('float')
      ->setLabel(new TranslatableMarkup('Altitude (m)'));

    $fields['speed'] = BaseFieldDefinition::create('float')
      ->setLabel(new TranslatableMarkup('Vitesse (m/s)'));

    $fields['bearing'] = BaseFieldDefinition::create('float')
      ->setLabel(new TranslatableMarkup('Cap (degrés)'));

    $fields['accuracy'] = BaseFieldDefinition::create('float')
      ->setLabel(new TranslatableMarkup('Précision horizontale (m)'));

    $fields['heart_rate'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Fréquence cardiaque (bpm)'))
      ->setSetting('unsigned', TRUE);

    $fields['segment'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Segment'))
      ->setDescription(new TranslatableMarkup('Incrémenté à chaque reprise après une pause.'))
      ->setSetting('unsigned', TRUE)
      ->setDefaultValue(0);

    $fields['created'] = BaseFieldDefinition::create('created')
      ->setLabel(new TranslatableMarkup('Créé le'))
      ->setDescription(new TranslatableMarkup('Date d’enregistrement du point côté serveur.'));

    return $fields;
  }

}
