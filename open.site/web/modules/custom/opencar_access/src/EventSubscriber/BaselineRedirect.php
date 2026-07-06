<?php

declare(strict_types=1);

namespace Drupal\opencar_access\EventSubscriber;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Routing\LocalRedirectResponse;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Drupal\node\NodeInterface;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Redirige les nœuds « baseline » vers l'édition de la vue des trajets.
 */
final class BaselineRedirect implements EventSubscriberInterface {

  /**
   * Nom de la configuration du module.
   */
  private const SETTINGS = 'opencar_access.settings';

  /**
   * Route de destination de la redirection (vue « trajets », affichage Notes).
   */
  private const TARGET_ROUTE = 'view.trajets.page_2';

  /**
   * Rôles exemptés de redirection (accès direct au contenu baseline).
   */
  private const EXEMPT_ROLES = ['administrator', 'supervisor', 'opencar_app_user'];

  /**
   * Construit l'abonné.
   *
   * @param \Drupal\Core\Config\ConfigFactoryInterface $configFactory
   *   La fabrique de configuration.
   * @param \Drupal\Core\Session\AccountInterface $currentUser
   *   L'utilisateur courant.
   */
  public function __construct(
    private readonly ConfigFactoryInterface $configFactory,
    private readonly AccountInterface $currentUser,
  ) {}

  /**
   * Redirige la requête si le nœud est une baseline et la redirection active.
   *
   * @param \Symfony\Component\HttpKernel\Event\RequestEvent $event
   *   L'événement à traiter.
   */
  public function onKernelRequestCheckBaselineRedirect(RequestEvent $event): void {
    $request = $event->getRequest();

    if ($request->attributes->get('_route') !== 'entity.node.canonical') {
      return;
    }

    $node = $request->attributes->get('node');
    if (!$node instanceof NodeInterface || $node->bundle() !== 'baseline') {
      return;
    }

    if (!$this->configFactory->get(self::SETTINGS)->get('active_redirection_baseline')) {
      return;
    }

    // Les rôles exemptés accèdent directement au contenu baseline.
    if (array_intersect(self::EXEMPT_ROLES, $this->currentUser->getRoles())) {
      return;
    }

    $url = Url::fromRoute(self::TARGET_ROUTE)->toString();
    $event->setResponse(new LocalRedirectResponse($url, 301));
  }

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return [
      KernelEvents::REQUEST => [['onKernelRequestCheckBaselineRedirect', 0]],
    ];
  }

}
