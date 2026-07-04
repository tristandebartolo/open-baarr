<?php

declare(strict_types=1);

namespace Drupal\opencar_core;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\user\EntityOwnerInterface;

/**
 * Interface de l'entité point de mesure.
 */
interface TrackPointInterface extends ContentEntityInterface, EntityOwnerInterface {

}
