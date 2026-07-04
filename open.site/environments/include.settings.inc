<?php

/**
 * @file
 * Set environment indicator amd drupal site-specific configuration file.
 */

/**
 * Location of the site configuration files.
 */
$settings['config_sync_directory'] = '../config/sync';

/**
 * Allow test modules and themes to be installed.
 *
 * Drupal ignores test modules and themes by default for performance reasons.
 * During development it can be useful to install test extensions for debugging
 * purposes.
 */
$settings['extension_discovery_scan_tests'] = FALSE;

/**
 * Salt for one-time login links, cancel links, form tokens, etc.
 */
$settings['hash_salt'] = 'ZH_JOZSx_lu3LRwSdrECdtrm7ZrxiK0WPPFJed_I9H0DHP4a8lsyFuQak3y4veF4b_JDvTSM4w';

/**
 * Access control for update.php script.
 */
$settings['update_free_access'] = FALSE;

/**
 * Default environment name.
 */
$environment = 'local';

/**
 * Detect current environment name.
 */
switch ($_SERVER["SERVER_NAME"] ?? '') {
  // Preprod environment.
  case 'preprod.mini.baarr.fr':
    $environment = 'preprod';
    break;

  // Prod environment.
  case 'mini.baarr.fr':
    $environment = 'prod';
    break;

  default:
    $environment = 'local';
    break;
}

if (getenv('IS_DDEV_PROJECT') === 'true') {
  $environment = 'local';
}else {
  $environment = 'prod';
}

/**
 * Load common services definition file.
 */
$settings['container_yamls'][] = __DIR__ . "/$environment/services.yml";

/**
 * Include settings.
 */
include __DIR__ . "/$environment/settings.php";

/**
 * Current environment name.
 */
$settings['current_environment_name'] = $environment;


/**
 * Set different memory limit for interfaces.
 */
$limit = php_sapi_name() === 'cli' ? '1200M' : '256M';
ini_set('memory_limit', $limit);

/**
 * Private file path.
 *
 * A local file system path where private files will be stored. This directory
 * must be absolute, outside of the Drupal installation directory and not
 * accessible over the web.
 *
 * Note: Caches need to be cleared when this value is changed to make the
 * private:// stream wrapper available to the system.
 *
 * See https://www.drupal.org/documentation/modules/file for more information
 * about securing private files.
 */
$settings['file_private_path'] = dirname(DRUPAL_ROOT) . '/private';
