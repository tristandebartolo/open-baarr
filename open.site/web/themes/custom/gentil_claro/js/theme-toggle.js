/**
 * @file
 * Bascule dark/light du site.
 *
 * Trois états : préférence explicite 'dark' ou 'light' (attribut data-theme
 * sur <html>, persisté en localStorage), sinon suivi du système. L'attribut
 * est posé avant le premier rendu par le script inline de html.html.twig
 * (anti-flash) ; ici on ne gère que le clic et la synchronisation.
 *
 * Émet l'événement window 'oc-theme-change' à chaque bascule (écouté par les
 * graphiques des trajets pour se re-rendre).
 */
(function (Drupal, once) {
  'use strict';

  var STORAGE_KEY = 'gentil_claro.theme.v1';
  var darkScheme = window.matchMedia('(prefers-color-scheme: dark)');

  function effectiveTheme() {
    var explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'dark' || explicit === 'light') {
      return explicit;
    }
    return darkScheme.matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    }
    catch (e) {
      // localStorage indisponible : la bascule reste valable pour la page.
    }
    window.dispatchEvent(new CustomEvent('oc-theme-change', { detail: { theme: theme } }));
  }

  function updateLabel(button) {
    var dark = effectiveTheme() === 'dark';
    button.setAttribute('aria-label', dark ? Drupal.t('Passer au thème clair') : Drupal.t('Passer au thème sombre'));
    button.setAttribute('aria-pressed', dark ? 'true' : 'false');
  }

  function updateAllLabels() {
    document.querySelectorAll('[data-oc-theme-toggle]').forEach(updateLabel);
  }

  // Plusieurs boutons coexistent (navbar + offcanvas) : on synchronise
  // l'état de tous à chaque bascule ou changement système.
  window.addEventListener('oc-theme-change', updateAllLabels);
  darkScheme.addEventListener('change', updateAllLabels);

  Drupal.behaviors.gentilThemeToggle = {
    attach: function (context) {
      once('gentil-theme-toggle', '[data-oc-theme-toggle]', context).forEach(function (button) {
        updateLabel(button);
        button.addEventListener('click', function () {
          applyTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
        });
      });
    }
  };
})(Drupal, once);
