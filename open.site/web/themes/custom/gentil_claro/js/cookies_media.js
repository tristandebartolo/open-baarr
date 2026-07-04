/**
 * @file
 * Defines Javascript behaviors for the cookies module.
 */
 (function (Drupal, $) {
  'use strict';

  /**
   * Define defaults.
   */
  Drupal.behaviors.gentilCookiesVideo = {
    consentGiven: function (context) {
      $('iframe.gm-cookies-video', context).each(function (i, element) {
        var $element = $(element);
        if ($element.attr('src') !== $element.data('src')) {
          $element.attr('src', $element.data('src'));
          element.removeAttribute('data-src');
        }
      });
    },

    consentDenied: function (context, cookieName) {
      $('iframe.gm-cookies-video', context).cookiesOverlay(cookieName);
    },

    attach: function (context) {
      var self = this;

      document.addEventListener('cookiesjsrUserConsent', function(event) {

        var service = (typeof event.detail.services === 'object') ? event.detail.services : {};

        let CookiesGm = context.querySelectorAll("iframe[data-cookie-name]");

        if (CookiesGm) {
          CookiesGm.forEach(
            (value) => {
              var $element = $(value);

              if (service.hasOwnProperty(value.dataset.cookieName) && service[value.dataset.cookieName]) {
                console.log('COOKIES');
                $element.parent().removeClass('no-cookies');
                self.consentGiven(context);

              } else {
                console.log('NO COOKIES');
                $element.parent().addClass('no-cookies');
                self.consentDenied(context, value.dataset.cookieName);

              }
            }
          );
        }
      });
    }
  };

})(Drupal, jQuery);
