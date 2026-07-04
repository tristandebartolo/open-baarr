<?php

declare(strict_types=1);

namespace Drupal\opencar_api\Controller;

use Drupal\Core\Controller\ControllerBase;
use Symfony\Component\HttpFoundation\JsonResponse;

/**
 * GET /opencar/api/v1/me — profil du compte authentifié.
 *
 * Première route appelée par l'app : elle valide les identifiants Basic
 * de bout en bout et renvoie le profil (l'app l'affiche dans Réglages).
 */
final class MeController extends ControllerBase {

  /**
   * Renvoie le profil et les rôles du compte courant.
   */
  public function me(): JsonResponse {
    $account = $this->currentUser();
    return new JsonResponse([
      'uid' => (int) $account->id(),
      'name' => $account->getAccountName(),
      'mail' => $account->getEmail(),
      'roles' => array_values($account->getRoles(TRUE)),
      'permissions' => [
        'record' => $account->hasPermission('record opencar trips'),
        'admin' => $account->hasPermission('administer opencar'),
      ],
    ]);
  }

}
