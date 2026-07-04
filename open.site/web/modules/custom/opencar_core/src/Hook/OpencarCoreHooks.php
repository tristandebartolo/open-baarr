<?php

declare(strict_types=1);

namespace Drupal\opencar_core\Hook;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\node\NodeInterface;
use Drupal\user\UserInterface;

/**
 * Hooks du module opencar_core.
 *
 * Nettoyage des points de mesure orphelins : les points suivent le cycle de
 * vie de leur trajet et de leur propriétaire.
 */
class OpencarCoreHooks {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * Implements hook_ENTITY_TYPE_predelete() for node entities.
   */
  #[Hook('node_predelete')]
  public function nodePredelete(NodeInterface $node): void {
    if ($node->bundle() !== 'trajet') {
      return;
    }
    $this->deletePoints('trajet', (int) $node->id());
  }

  /**
   * Implements hook_ENTITY_TYPE_predelete() for user entities.
   */
  #[Hook('user_predelete')]
  public function userPredelete(UserInterface $account): void {
    $this->deletePoints('uid', (int) $account->id());
  }

  /**
   * Supprime les points de mesure par paquets pour limiter la mémoire.
   */
  private function deletePoints(string $field, int $id): void {
    $storage = $this->entityTypeManager->getStorage('opencar_track_point');
    $ids = $storage->getQuery()
      ->condition($field, $id)
      ->accessCheck(FALSE)
      ->execute();
    foreach (array_chunk($ids, 500) as $chunk) {
      $storage->delete($storage->loadMultiple($chunk));
    }
  }

}
