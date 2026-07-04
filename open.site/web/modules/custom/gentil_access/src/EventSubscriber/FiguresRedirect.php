<?php

namespace Drupal\gentil_access\EventSubscriber;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Routing\TrustedRedirectResponse;
use Drupal\Core\Url;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\taxonomy\Entity\Term;
use Drupal\taxonomy\TermInterface;

/**
 * Redirect subscriber for FiguresController requests.
 */
class FiguresRedirect implements EventSubscriberInterface {

    /**
   * Domain redirect configuration.
   *
   * @var \Drupal\Core\Config\Config
   */
  protected $domainConfig;

  /**
   * The current account.
   *
   * @var \Drupal\Core\Session\AccountInterface
   */
  protected $account;

  /**
   * Constructs a \Drupal\redirect\EventSubscriber\RedirectRequestSubscriber object.
   *
   * @param \Drupal\Core\Config\ConfigFactoryInterface $config_factory
   *   The config factory.
   */
  public function __construct(ConfigFactoryInterface $config_factory, AccountInterface $account) {
    $this->domainConfig = $config_factory->get('redirect_domain.domains');
    $this->account = $account;
  }

  /**
   * Handles the domain redirect if any found.
   *
   * @param \Symfony\Component\HttpKernel\Event\RequestEvent $event
   *   The event to process.
   */
  public function onKernelRequestCheckFiguresRedirect(RequestEvent $event) {

    $request = $event->getRequest();

    if (!$request->attributes->get('_route')) {
      return;
    }

    if ($request->attributes->get('_route') !== 'entity.taxonomy_term.canonical') {
      return;
    }

    $term = $request->attributes->get('taxonomy_term');
    if (!$term instanceof TermInterface) {
      return;
    }

    if ($term->bundle() !== 'figures') {
      return;
    }

    $name = $term->label();
    $prenom = ($term->hasField('field_prenom')
      && !$term->get('field_prenom')->isEmpty())
      ? $term->get ('field_prenom')->getValue()[0]['value']
      : '';

    $alias =\Drupal::service("pathauto.alias_cleaner")
      ->cleanString((string)$prenom . ' ' . (string)$name);

    $response = new TrustedRedirectResponse(Url::fromRoute('gentil_front.figure', ['figure' => $alias], [])->toString(), 301);
    $response->send();

    return;

  }

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    $events[KernelEvents::REQUEST][] = ['onKernelRequestCheckFiguresRedirect', 0];
    return $events;
  }

}
