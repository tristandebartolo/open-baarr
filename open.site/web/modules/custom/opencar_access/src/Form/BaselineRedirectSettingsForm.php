<?php

declare(strict_types=1);

namespace Drupal\opencar_access\Form;

use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;

/**
 * Formulaire de configuration des redirections OpenCar Access.
 */
final class BaselineRedirectSettingsForm extends ConfigFormBase {

  /**
   * Nom de la configuration éditée.
   */
  private const SETTINGS = 'opencar_access.settings';

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'opencar_access_baseline_redirect_settings';
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditableConfigNames(): array {
    return [self::SETTINGS];
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $form['active_redirection_baseline'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Activer la redirection des baselines'),
      '#description' => $this->t('Redirige les nœuds de type « baseline » vers la page « Notes » de la vue des trajets (/notes).'),
      '#default_value' => (bool) $this->config(self::SETTINGS)->get('active_redirection_baseline'),
    ];

    return parent::buildForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $this->config(self::SETTINGS)
      ->set('active_redirection_baseline', (bool) $form_state->getValue('active_redirection_baseline'))
      ->save();

    parent::submitForm($form, $form_state);
  }

}
