/**
 * @file
 * Cartes décoratives des cards du listing /trajets (Section 2).
 *
 * Affiche le tracé de chaque trajet « à la une » en couverture de sa card,
 * toutes interactions désactivées (la card entière reste cliquable vers le
 * trajet). Multi-instance : une carte par élément [data-opencar-card-map],
 * config lue dans drupalSettings.opencarDisplay.cardMaps[id]. L'initialisation
 * attend le consentement au service « osm » si le module cookies est actif
 * (voir map-consent.js).
 */
(function (Drupal, once, drupalSettings) {
  'use strict';

  function initCardMap(element, config) {
    var map = window.L.map(element, {
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      touchZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      tap: false,
      attributionControl: true
    });

    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    var track = window.L.geoJSON(config.geojson, {
      style: { color: config.color, weight: 4, opacity: 0.95 }
    }).addTo(map);

    map.fitBounds(track.getBounds(), { padding: [24, 24] });
  }

  Drupal.behaviors.opencarCardMap = {
    attach: function (context) {
      once('opencar-card-map', '[data-opencar-card-map]', context).forEach(function (element) {
        var maps = (drupalSettings.opencarDisplay || {}).cardMaps || {};
        var config = maps[element.getAttribute('data-opencar-card-map')];
        if (!config || !window.L) {
          return;
        }
        Drupal.opencarMapConsent(element, function () {
          initCardMap(element, config);
        });
      });
    }
  };
})(Drupal, once, drupalSettings);
