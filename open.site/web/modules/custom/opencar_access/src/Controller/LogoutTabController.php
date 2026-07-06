<?php

namespace Drupal\opencar_access\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Url;
use Symfony\Component\HttpFoundation\RedirectResponse;

/**
 * Implements redirect from logout tab.
 */
class LogoutTabController extends ControllerBase {

  /**
   * Redirects user to configured logout page.
   *
   * @return \Symfony\Component\HttpFoundation\RedirectResponse
   *   Redirect to configured page.
   */
  public function logout() {
    user_logout();
    $url = Url::fromUserInput('/user/login');
    return new RedirectResponse($url->setAbsolute()->toString());
  }
}
