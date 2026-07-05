/**
 * @file
 * Carte Leaflet du tracé d'un trajet.
 *
 * Config par carte dans drupalSettings.opencarDisplay.maps[id] :
 * { geojson, color, start: {lat, lng}|null, end: {lat, lng}|null }.
 *
 * Options utilisateur persistées en localStorage (clé
 * opencar_display.map_prefs.v1) : { v, baseLayer, zoomDelta, expanded }.
 * zoomDelta = écart de zoom choisi par rapport au zoom du fitBounds.
 */
(function (Drupal, once, drupalSettings) {
  'use strict';

  var STORAGE_KEY = 'opencar_display.map_prefs.v1';

  var BASE_LAYERS = {
    osm: {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }
    },
    topo: {
      url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
      options: {
        maxZoom: 17,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
      }
    }
  };

  function loadPrefs() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var prefs = JSON.parse(raw);
        if (prefs && prefs.v === 1) {
          return prefs;
        }
      }
    }
    catch (e) {
      // localStorage indisponible (mode privé) : préférences volatiles.
    }
    return { v: 1, baseLayer: 'osm', zoomDelta: 0, expanded: false };
  }

  function savePrefs(prefs) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    }
    catch (e) {
      // Ignoré : la carte reste fonctionnelle sans persistance.
    }
  }

  function markerIcon(color, label) {
    return window.L.divIcon({
      className: 'oc-map-marker',
      html: '<span class="oc-map-marker__dot" style="--oc-marker: ' + color + '" title="' + label + '"></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
  }

  function initMap(element, config) {
    var prefs = loadPrefs();
    var L = window.L;

    var map = L.map(element, {
      scrollWheelZoom: false,
      zoomControl: true,
      attributionControl: true
    });

    var layers = {};
    Object.keys(BASE_LAYERS).forEach(function (key) {
      layers[key] = L.tileLayer(BASE_LAYERS[key].url, BASE_LAYERS[key].options);
    });
    var currentLayer = layers[prefs.baseLayer] ? prefs.baseLayer : 'osm';
    layers[currentLayer].addTo(map);
    L.control.layers(
      { 'Plan': layers.osm, 'Relief': layers.topo },
      null,
      { position: 'topleft' }
    ).addTo(map);

    var track = L.geoJSON(config.geojson, {
      style: { color: config.color, weight: 4, opacity: 0.9 }
    }).addTo(map);

    if (config.start) {
      L.marker([config.start.lat, config.start.lng], {
        icon: markerIcon('#2E8B57', Drupal.t('Départ'))
      }).addTo(map);
    }
    if (config.end) {
      L.marker([config.end.lat, config.end.lng], {
        icon: markerIcon('#D64545', Drupal.t('Arrivée'))
      }).addTo(map);
    }

    var bounds = track.getBounds();
    map.fitBounds(bounds, { padding: [24, 24] });
    var fitZoom = null;
    var restoring = true;

    map.whenReady(function () {
      fitZoom = map.getZoom();
      if (prefs.zoomDelta) {
        map.setZoom(fitZoom + prefs.zoomDelta);
      }
      // Laisse passer le setZoom de restauration avant d'écouter l'utilisateur.
      window.setTimeout(function () {
        restoring = false;
      }, 0);
    });

    map.on('zoomend', function () {
      if (restoring || fitZoom === null) {
        return;
      }
      prefs.zoomDelta = map.getZoom() - fitZoom;
      savePrefs(prefs);
    });

    map.on('baselayerchange', function (event) {
      prefs.baseLayer = event.layer === layers.topo ? 'topo' : 'osm';
      savePrefs(prefs);
    });

    // Bouton agrandir / réduire (fourni par le template, frère de la carte).
    var wrapper = element.closest('.oc-hero-map');
    var expandButton = wrapper ? wrapper.querySelector('.oc-map-expand') : null;

    function setExpanded(expanded, persist) {
      if (!wrapper) {
        return;
      }
      wrapper.classList.toggle('is-expanded', expanded);
      document.documentElement.classList.toggle('oc-map-noscroll', expanded);
      if (expandButton) {
        expandButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        expandButton.setAttribute('aria-label', expanded ? Drupal.t('Réduire la carte') : Drupal.t('Agrandir la carte'));
      }
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [24, 24] });
      if (persist) {
        prefs.expanded = expanded;
        savePrefs(prefs);
      }
    }

    if (expandButton) {
      expandButton.addEventListener('click', function () {
        setExpanded(!wrapper.classList.contains('is-expanded'), true);
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && wrapper.classList.contains('is-expanded')) {
          setExpanded(false, true);
        }
      });
      if (prefs.expanded) {
        setExpanded(true, false);
      }
    }
  }

  Drupal.behaviors.opencarTrajetMap = {
    attach: function (context) {
      once('opencar-trajet-map', '[data-opencar-map]', context).forEach(function (element) {
        var settings = (drupalSettings.opencarDisplay || {}).maps || {};
        var config = settings[element.getAttribute('data-opencar-map')];
        if (config && window.L) {
          Drupal.opencarMapConsent(element, function () {
            initMap(element, config);
          });
        }
      });
    }
  };
})(Drupal, once, drupalSettings);
