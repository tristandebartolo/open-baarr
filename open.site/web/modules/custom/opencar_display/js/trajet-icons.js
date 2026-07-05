/**
 * @file
 * Icônes UIkit custom des tuiles de stats trajet (préfixe oc-).
 *
 * UIkit ne fournit pas de thermomètre, vent, nuage, flamme ni pas :
 * on les enregistre via UIkit.icon.add() (tracés type Feather, stroke 1.5,
 * viewBox 24 pour rester homogène avec les icônes UIkit).
 */
(function (Drupal) {
  'use strict';

  var ICONS = {
    'oc-thermometer':
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>',
    'oc-wind':
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg>',
    'oc-cloud':
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>',
    'oc-fire':
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2s-6 5.5-6 11a6 6 0 0 0 12 0c0-2-1-4-2.5-5.5C14.5 9 13 10.5 13 12a3.5 3.5 0 0 1-2-3c0-2.5 1-5 1-7z"/></svg>',
    'oc-footsteps':
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3c1.7 0 3 1.6 3 4 0 1.8-.6 3.4-1.5 4.3L7 13H5l-.5-1.7C3.6 10.4 3 8.8 3 7c0-2.4 1.3-4 3-4z"/><path d="M5 15h2v2a2 2 0 1 1-4 0v-1a1 1 0 0 1 1-1z" transform="translate(1 0)"/><path d="M18 8c-1.7 0-3 1.6-3 4 0 1.8.6 3.4 1.5 4.3L17 18h2l.5-1.7c.9-.9 1.5-2.5 1.5-4.3 0-2.4-1.3-4-3-4z"/><path d="M17 20h2a1 1 0 0 1 1 1 2 2 0 1 1-4 0z" transform="translate(0 -1)"/></svg>'
  };

  Drupal.behaviors.opencarTrajetIcons = {
    attach: function () {
      if (this.registered || typeof window.UIkit === 'undefined' || !window.UIkit.icon) {
        return;
      }
      window.UIkit.icon.add(ICONS);
      this.registered = true;
    }
  };
})(Drupal);
