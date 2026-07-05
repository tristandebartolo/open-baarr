/**
 * @file
 * Consentement RGPD des cartes (service « osm » du module cookies).
 *
 * Les tuiles OSM/OpenTopoMap transmettent l'adresse IP du visiteur à des
 * serveurs tiers : l'initialisation Leaflet attend le consentement.
 *
 * Intégration douce avec le module contrib cookies (COOKiES / cookiesjsr) :
 * - module absent ou service « osm » non configuré → init immédiate ;
 * - consentement déjà stocké (cookie cookiesjsr) → init immédiate ;
 * - sinon → overlay standard du module (cookiesOverlay, textes FR du service)
 *   et init au premier événement cookiesjsrUserConsent accordant « osm ».
 */
(function (Drupal, drupalSettings) {
  'use strict';

  var SERVICE_ID = 'osm';

  function cookiesModuleActive() {
    return typeof drupalSettings.cookies !== 'undefined'
      && drupalSettings.cookies.services
      && typeof drupalSettings.cookies.services[SERVICE_ID] !== 'undefined';
  }

  function grantedFromCookie() {
    try {
      var match = document.cookie.match(/(?:^|;\s*)cookiesjsr=([^;]*)/);
      if (match) {
        var services = JSON.parse(decodeURIComponent(match[1]));
        return services !== null && services[SERVICE_ID] === true;
      }
    }
    catch (e) {
      // Cookie illisible : on retombe sur l'événement de consentement.
    }
    return false;
  }

  /**
   * Exécute initialize() dès que le service osm est autorisé.
   */
  Drupal.opencarMapConsent = function (element, initialize) {
    if (!cookiesModuleActive() || grantedFromCookie()) {
      initialize();
      return;
    }

    var initialized = false;
    document.addEventListener('cookiesjsrUserConsent', function (event) {
      if (initialized) {
        return;
      }
      var services = (event.detail || {}).services || {};
      if (services[SERVICE_ID]) {
        initialized = true;
        initialize();
      }
      else if (window.jQuery && window.jQuery.fn.cookiesOverlay) {
        // Overlay standard du module : texte + bouton « Autoriser les
        // cartes » (déclenche cookiesjsrSetService, qui re-émet l'événement
        // de consentement écouté ci-dessus).
        window.jQuery(element).cookiesOverlay(SERVICE_ID);
      }
    });
  };
})(Drupal, drupalSettings);
