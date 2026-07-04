<?php

namespace Drupal\gentil_access\EventSubscriber;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Routing\TrustedRedirectResponse;
use Drupal\Core\Url;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Drupal\Core\Session\AccountInterface;

/**
 * Redirect subscriber for controller requests.
 */
class PermissionsSiteRedirect implements EventSubscriberInterface {

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
  public function onKernelRequestCheckGentilDomainRedirect(RequestEvent $event) {
    $request = clone $event->getRequest();
    $host = $request->getHost();
    $path = $request->getPathInfo();
    $uid = (int) $this->account->id();

    $lang_code = \Drupal::languageManager()->getCurrentLanguage()->getId();

    $request = $event->getRequest();

    if (is_null($host)) {
      return;
    }

    if (!str_starts_with($host, 'bck')) {

      if (str_starts_with($path, "/$lang_code/admin")) {
        $response = new TrustedRedirectResponse("/$lang_code/404", 301);
        $response->send();
      }

      $front_route = [
        "/$lang_code/node/add",
        "/$lang_code/user",
        "/$lang_code/user/login",
        "/$lang_code/user/register",
        "/$lang_code/user/password"
      ];

      if (in_array($path, $front_route)) {
        $response = new TrustedRedirectResponse("/$lang_code/404", 301);
        $response->send();
      }
    }

    if (str_starts_with($host, 'bck')) {
      if ($this->account->isAnonymous()) {
        $back_route = [
          "/$lang_code/user/login",
          "/$lang_code/user/register",
          "/$lang_code/user/password"
        ];

        if (!in_array($path, $back_route)) {
          $response = new TrustedRedirectResponse("/$lang_code/user/login", 301);
          $response->send();
        }
      }
    }
    return;
  }

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    // This needs to run before RouterListener::onKernelRequest(), which has
    // a priority of 32 and
    // RedirectRequestSubscriber::onKernelRequestCheckRedirect(), which has
    // a priority of 33. Otherwise, that aborts the request if no matching
    // route is found.
    $events[KernelEvents::REQUEST][] = ['onKernelRequestCheckGentilDomainRedirect', 35];
    return $events;
  }

}
