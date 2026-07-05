/**
 * @file
 * Carte décorative du hero de la page d'accueil.
 *
 * Affiche le tracé du dernier trajet publié en fond du hero, toutes
 * interactions désactivées (la carte est un décor : le contenu du hero passe
 * au-dessus). Settings dans drupalSettings.opencarDisplay.frontHero.
 * L'initialisation attend le consentement au service « osm » si le module
 * cookies est actif (voir map-consent.js).
 */
(function (Drupal, once, drupalSettings) {
  'use strict';

  function initHeroMap(element, config) {
    var map = window.L.map(element, {
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      touchZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      attributionControl: true
    });

    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    var track = window.L.geoJSON(config.geojson, {
      style: { color: config.color, weight: 4, opacity: 0.9 }
    }).addTo(map);

    map.fitBounds(track.getBounds(), { padding: [60, 60] });
  }

  Drupal.behaviors.opencarFrontHero = {
    attach: function (context) {
      once('opencar-front-hero', '[data-opencar-front-hero]', context).forEach(function (element) {
        var config = (drupalSettings.opencarDisplay || {}).frontHero;
        if (!config || !window.L) {
          return;
        }
        Drupal.opencarMapConsent(element, function () {
          initHeroMap(element, config);
        });
      });
    }
  };
})(Drupal, once, drupalSettings);
