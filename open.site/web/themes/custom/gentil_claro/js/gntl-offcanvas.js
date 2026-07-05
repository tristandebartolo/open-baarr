/**
 * @file
 * Menu mobile offcanvas.
 *
 * Le menu principal n'est rendu qu'une fois (desktop) : on le clone dans
 * l'offcanvas au premier attach (sans attribut id, pour éviter les doublons).
 * Synchronise aria-expanded du burger sur les événements UIkit show/hide et
 * ferme l'offcanvas au clic sur un lien.
 */
(function (Drupal, once) {
  'use strict';

  Drupal.behaviors.gentilOffcanvas = {
    attach: function (context) {
      once('gntl-offcanvas', '[data-gntl-offcanvas-menu]', context).forEach(function (target) {
        var source = document.querySelector('.gntl-navbar-menu ul.menu');
        if (source) {
          var clone = source.cloneNode(true);
          clone.querySelectorAll('[id]').forEach(function (node) {
            node.removeAttribute('id');
          });
          clone.removeAttribute('id');
          target.appendChild(clone);
        }

        var offcanvas = document.getElementById('gntl-offcanvas');
        var burger = document.querySelector('[data-gntl-burger]');
        if (!offcanvas) {
          return;
        }

        if (burger) {
          offcanvas.addEventListener('show', function () {
            burger.setAttribute('aria-expanded', 'true');
          });
          offcanvas.addEventListener('hide', function () {
            burger.setAttribute('aria-expanded', 'false');
          });
        }

        target.addEventListener('click', function (event) {
          if (event.target.closest('a') && window.UIkit) {
            window.UIkit.offcanvas(offcanvas).hide();
          }
        });
      });
    }
  };
})(Drupal, once);
