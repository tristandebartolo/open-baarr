<?php

declare(strict_types=1);

namespace Drupal\opencar_api\Service;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\node\NodeInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Chargement des nodes de l'API mobile (trajets, baselines), avec contrôle
 * de propriété.
 *
 * Isolation entre utilisateurs : un node qui n'appartient pas au compte
 * courant est traité comme inexistant (404, pas de fuite d'information),
 * sauf pour les porteurs de la permission `administer opencar`.
 */
final class TripRepository {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * Charge un node par son UUID, quel que soit son propriétaire.
   */
  public function loadByUuid(string $uuid, string $bundle = 'trajet'): ?NodeInterface {
    $nodes = $this->entityTypeManager->getStorage('node')->loadByProperties([
      'uuid' => mb_strtolower($uuid),
      'type' => $bundle,
    ]);
    $node = reset($nodes);
    return $node instanceof NodeInterface ? $node : NULL;
  }

  /**
   * Charge un node accessible au compte donné, sinon 404.
   *
   * @param bool $scopeToOwner
   *   FALSE pour un contenu partagé (baselines) : tout porteur du rôle y
   *   accède, seule l'existence compte.
   */
  public function loadForAccount(string $uuid, AccountInterface $account, string $bundle = 'trajet', bool $scopeToOwner = TRUE): NodeInterface {
    $trip = $this->loadByUuid($uuid, $bundle);
    if ($trip === NULL || ($scopeToOwner && !$this->isAllowed($trip, $account))) {
      throw new NotFoundHttpException('Contenu introuvable.');
    }
    return $trip;
  }

  /**
   * Le compte peut-il voir/modifier ce trajet ?
   */
  public function isAllowed(NodeInterface $trip, AccountInterface $account): bool {
    return (int) $trip->getOwnerId() === (int) $account->id()
      || $account->hasPermission('administer opencar');
  }

  /**
   * Liste paginée des trajets du compte, filtrable.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   Le compte dont on liste les trajets.
   * @param array{status: string|null, activity_type: string|null, since: int|null, page: int, limit: int} $filters
   *   Filtres et pagination validés par PayloadValidator::validateListQuery().
   *
   * @return array{total: int, items: list<\Drupal\node\NodeInterface>}
   *   Le total (hors pagination) et la page de trajets, du plus récent au
   *   plus ancien (date de création).
   */
  public function findForAccount(AccountInterface $account, array $filters, string $bundle = 'trajet', bool $scopeToOwner = TRUE): array {
    $storage = $this->entityTypeManager->getStorage('node');
    $query = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('type', $bundle);
    if ($scopeToOwner) {
      $query->condition('uid', $account->id());
    }

    if ($filters['status'] !== NULL) {
      $query->condition('field_trip_status', $filters['status']);
    }
    if ($filters['activity_type'] !== NULL) {
      $query->condition('field_activity_type', $filters['activity_type']);
    }
    if ($filters['since'] !== NULL) {
      $query->condition('changed', $filters['since'], '>=');
    }

    $total = (int) (clone $query)->count()->execute();

    $ids = $query
      ->sort('created', 'DESC')
      ->sort('nid', 'DESC')
      ->range($filters['page'] * $filters['limit'], $filters['limit'])
      ->execute();

    return ['total' => $total, 'items' => array_values($storage->loadMultiple($ids))];
  }

}
