(Drupal => {
  /**
   * Add necessary event listeners and create aria attributes
   * @param {element} el - List item element that has a locale_menu.
   */
  function initFilterRegions(el) {
    // console.log('eeeee')
    // const mouseTarget = document.getElementById('block-localselectorblock');
    const button = el.querySelector('.gm-menu-open');
    button.setAttribute('aria-controls', button.dataset.ariacontrols);
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', e => toggleFilterRegionMenu(e.currentTarget, !getFilterRegionState(e.currentTarget)));
    // el.addEventListener('mouseenter', e => toggleFilterRegionMenu(button, true));
    // el.addEventListener('mouseleave', e => toggleFilterRegionMenu(button, false));
  }
  /**
   * Toggles the aria-expanded attribute of a given button to a desired state.
   * @param {element} button - Button element that should be toggled.
   * @param {boolean} toState - State indicating the end result toggle operation.
   */
  function toggleFilterRegionMenu(button, toState) {
    button.setAttribute('aria-expanded', toState);
  }
  /**
   * Get the current aria-expanded state of a given button.
   * @param {element} button - Button element to return state of.
   */
  function getFilterRegionState(button) {
    return button.getAttribute('aria-expanded') === 'true';
  }
  Drupal.behaviors.open_menu = {
    attach(context) {
      console.log('hhh')
      context.querySelectorAll('.tdb-navbar-open').forEach(el => initFilterRegions(el));
    },
  };
}) (Drupal);