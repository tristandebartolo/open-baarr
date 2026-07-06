<?php

declare(strict_types=1);

namespace Drupal\opencar_display\Service;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\node\NodeInterface;

/**
 * Sélectionne les trajets mis en avant sur le listing /trajets.
 *
 * La page /trajets se lit en trois sections alimentées par un seul jeu de
 * résultats trié field_started_at DESC : hero (index 0), cards à la une
 * (index 1–3), puis le reste en liste tiny paginée (display Views, offset 4).
 * Ce service fournit les 4 premiers trajets, dans l'ordre, pour les sections
 * hero et cards ; l'offset du pager garantit qu'ils ne réapparaissent pas
 * dans la liste tiny.
 */
final class TrajetListingBuilder {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * Trajets mis en avant : le plus récent (hero) puis les suivants (cards).
   *
   * @param int $cards
   *   Nombre de cards « à la une » après le hero.
   *
   * @return array{hero: \Drupal\node\NodeInterface|null, cards: list<\Drupal\node\NodeInterface>}
   *   Le trajet hero (ou NULL si aucun trajet publié) et les cards, dans
   *   l'ordre du tri.
   */
  public function featured(int $cards = 3): array {
    $storage = $this->entityTypeManager->getStorage('node');
    $nids = $storage->getQuery()
      ->accessCheck(TRUE)
      ->condition('type', 'trajet')
      ->condition('status', 1)
      ->sort('field_started_at', 'DESC')
      ->range(0, 1 + $cards)
      ->execute();

    // loadMultiple ne garantit pas l'ordre : on réordonne selon $nids (DESC).
    $entities = $storage->loadMultiple($nids);
    $nodes = [];
    foreach ($nids as $nid) {
      if (($entities[$nid] ?? NULL) instanceof NodeInterface) {
        $nodes[] = $entities[$nid];
      }
    }

    return [
      'hero' => $nodes[0] ?? NULL,
      'cards' => array_slice($nodes, 1, $cards),
    ];
  }

}
