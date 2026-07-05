<?php

declare(strict_types=1);

namespace Drupal\Tests\opencar_api\Functional;

use Drupal\Tests\BrowserTestBase;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\taxonomy\Entity\Vocabulary;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Psr\Http\Message\ResponseInterface;

/**
 * Contrôle d'accès de l'API mobile : rôle requis et isolation par compte.
 */
#[Group('opencar_api')]
#[RunTestsInSeparateProcesses]
final class ApiEndpointsTest extends BrowserTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['node', 'taxonomy', 'geolocation', 'opencar_api'];

  /**
   * {@inheritdoc}
   */
  protected $defaultTheme = 'stark';

  /**
   * Compte porteur du rôle app (propriétaire des trajets de test).
   */
  private UserInterface $userA;

  /**
   * Second compte porteur du rôle app (isolation).
   */
  private UserInterface $userB;

  /**
   * Compte authentifié sans le rôle app.
   */
  private UserInterface $userNoRole;

  /**
   * Compte administrateur OpenCar.
   */
  private UserInterface $admin;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    $this->drupalCreateContentType(['type' => 'trajet', 'name' => 'Trajet']);

    // Champs minimaux utilisés par l'API (les autres sont gardés par
    // hasField() dans le code).
    FieldStorageConfig::create([
      'field_name' => 'field_activity_type',
      'entity_type' => 'node',
      'type' => 'list_string',
      'settings' => [
        'allowed_values' => [
          'car' => 'Voiture',
          'motorcycle' => 'Moto',
          'running' => 'Course à pied',
          'walking' => 'Marche',
          'hiking' => 'Randonnée',
        ],
      ],
    ])->save();
    FieldStorageConfig::create([
      'field_name' => 'field_trip_status',
      'entity_type' => 'node',
      'type' => 'list_string',
      'settings' => [
        'allowed_values' => [
          'draft' => 'Brouillon',
          'recording' => 'Enregistrement',
          'paused' => 'En pause',
          'completed' => 'Terminé',
        ],
      ],
    ])->save();
    FieldStorageConfig::create([
      'field_name' => 'field_started_at',
      'entity_type' => 'node',
      'type' => 'timestamp',
    ])->save();
    FieldStorageConfig::create([
      'field_name' => 'field_chapo',
      'entity_type' => 'node',
      'type' => 'string_long',
    ])->save();
    FieldStorageConfig::create([
      'field_name' => 'field_temperature',
      'entity_type' => 'node',
      'type' => 'float',
    ])->save();
    FieldStorageConfig::create([
      'field_name' => 'field_weather_code',
      'entity_type' => 'node',
      'type' => 'integer',
    ])->save();
    foreach (['field_activity_type', 'field_trip_status', 'field_started_at', 'field_chapo', 'field_temperature', 'field_weather_code'] as $fieldName) {
      FieldConfig::create([
        'field_name' => $fieldName,
        'entity_type' => 'node',
        'bundle' => 'trajet',
      ])->save();
    }

    // Baselines + thématiques (vocabulaire partagé trajet/baseline).
    $this->drupalCreateContentType(['type' => 'baseline', 'name' => 'Baseline']);
    Vocabulary::create(['vid' => 'thematiques', 'name' => 'Thématiques'])->save();
    FieldStorageConfig::create([
      'field_name' => 'field_thematiques',
      'entity_type' => 'node',
      'type' => 'entity_reference',
      'settings' => ['target_type' => 'taxonomy_term'],
      'cardinality' => -1,
    ])->save();
    foreach (['trajet', 'baseline'] as $bundle) {
      FieldConfig::create([
        'field_name' => 'field_thematiques',
        'entity_type' => 'node',
        'bundle' => $bundle,
      ])->save();
    }
    FieldStorageConfig::create([
      'field_name' => 'field_coordinates',
      'entity_type' => 'node',
      'type' => 'geolocation',
    ])->save();
    FieldConfig::create([
      'field_name' => 'field_coordinates',
      'entity_type' => 'node',
      'bundle' => 'baseline',
    ])->save();

    $this->userA = $this->drupalCreateUser();
    $this->userB = $this->drupalCreateUser();
    // Rôle installé par opencar_core (config/install).
    foreach ([$this->userA, $this->userB] as $user) {
      $user->addRole('opencar_app_user');
      $user->save();
    }
    $this->userNoRole = $this->drupalCreateUser();
    $this->admin = $this->drupalCreateUser(['use opencar api', 'administer opencar']);
  }

  /**
   * Rôle exigé, création idempotente, isolation stricte entre comptes.
   */
  public function testAccessControlAndIsolation(): void {
    // Sans identifiants : challenge Basic (401).
    $response = $this->apiRequest(NULL, 'GET', '/me');
    $this->assertSame(401, $response->getStatusCode());

    // Authentifié sans le rôle : 403.
    $response = $this->apiRequest($this->userNoRole, 'GET', '/me');
    $this->assertSame(403, $response->getStatusCode());

    // Avec le rôle : 200 et profil correct.
    $response = $this->apiRequest($this->userA, 'GET', '/me');
    $this->assertSame(200, $response->getStatusCode());
    $me = json_decode((string) $response->getBody(), TRUE);
    $this->assertSame((int) $this->userA->id(), $me['uid']);
    $this->assertContains('opencar_app_user', $me['roles']);

    // Création d'un trajet par A.
    $uuid = '11111111-2222-4333-8444-555555555555';
    $payload = [
      'uuid' => $uuid,
      'title' => 'Trajet de A',
      'activity_type' => 'running',
      'started_at' => 1751600000,
    ];
    $response = $this->apiRequest($this->userA, 'POST', '/trips', $payload);
    $this->assertSame(201, $response->getStatusCode());
    $created = json_decode((string) $response->getBody(), TRUE);
    // Dépublié par défaut : publication explicite via PATCH.
    $this->assertFalse($created['published']);

    // Rejeu du POST par A : idempotent (200, pas de doublon).
    $response = $this->apiRequest($this->userA, 'POST', '/trips', $payload);
    $this->assertSame(200, $response->getStatusCode());

    // Publication puis dépublication par le propriétaire.
    $response = $this->apiRequest($this->userA, 'PATCH', "/trips/$uuid", ['published' => TRUE]);
    $this->assertSame(200, $response->getStatusCode());
    $this->assertTrue(json_decode((string) $response->getBody(), TRUE)['published']);
    $response = $this->apiRequest($this->userA, 'PATCH', "/trips/$uuid", ['published' => FALSE]);
    $this->assertFalse(json_decode((string) $response->getBody(), TRUE)['published']);
    // Booléen strict : "yes" refusé.
    $response = $this->apiRequest($this->userA, 'PATCH', "/trips/$uuid", ['published' => 'yes']);
    $this->assertSame(422, $response->getStatusCode());

    // Chapo (field_chapo) modifiable et relu au détail.
    $response = $this->apiRequest($this->userA, 'PATCH', "/trips/$uuid", ['chapo' => 'Un résumé du trajet.']);
    $this->assertSame(200, $response->getStatusCode());
    $detail = json_decode((string) $response->getBody(), TRUE);
    $this->assertSame('Un résumé du trajet.', $detail['chapo']);

    // Météo au départ : PATCH relu, bornes respectées.
    $response = $this->apiRequest($this->userA, 'PATCH', "/trips/$uuid", ['temperature' => 21.5, 'weather_code' => 61]);
    $this->assertSame(200, $response->getStatusCode());
    $weather = json_decode((string) $response->getBody(), TRUE)['weather'];
    $this->assertSame(21.5, $weather['temperature']);
    $this->assertSame(61, $weather['weather_code']);
    $response = $this->apiRequest($this->userA, 'PATCH', "/trips/$uuid", ['temperature' => 99.0]);
    $this->assertSame(422, $response->getStatusCode());

    // Sans le rôle, pas d'écriture : 403.
    $response = $this->apiRequest($this->userNoRole, 'POST', '/trips', $payload);
    $this->assertSame(403, $response->getStatusCode());

    // B ne voit pas le trajet de A : 404 (pas de fuite d'existence).
    $this->assertSame(404, $this->apiRequest($this->userB, 'GET', "/trips/$uuid")->getStatusCode());
    $this->assertSame(404, $this->apiRequest($this->userB, 'PATCH', "/trips/$uuid", ['title' => 'Piraté'])->getStatusCode());
    $this->assertSame(404, $this->apiRequest($this->userB, 'DELETE', "/trips/$uuid")->getStatusCode());
    $this->assertSame(404, $this->apiRequest($this->userB, 'POST', "/trips/$uuid/points/batch", [
      'points' => [['seq' => 0, 't' => 1751600000000, 'lat' => 48.85, 'lng' => 2.35]],
    ])->getStatusCode());

    // Le POST du même UUID par B est un conflit, pas une fusion.
    $this->assertSame(409, $this->apiRequest($this->userB, 'POST', '/trips', $payload)->getStatusCode());

    // La liste de B est vide, celle de A contient son trajet.
    $listB = json_decode((string) $this->apiRequest($this->userB, 'GET', '/trips')->getBody(), TRUE);
    $this->assertSame(0, $listB['total']);
    $listA = json_decode((string) $this->apiRequest($this->userA, 'GET', '/trips')->getBody(), TRUE);
    $this->assertSame(1, $listA['total']);
    $this->assertSame($uuid, $listA['items'][0]['uuid']);

    // A accède à son trajet ; l'admin aussi (permission administer opencar).
    $this->assertSame(200, $this->apiRequest($this->userA, 'GET', "/trips/$uuid")->getStatusCode());
    $this->assertSame(200, $this->apiRequest($this->admin, 'GET', "/trips/$uuid")->getStatusCode());

    // L'écriture de A sur son propre trajet fonctionne (batch idempotent).
    $batch = ['points' => [['seq' => 0, 't' => 1751600000000, 'lat' => 48.85, 'lng' => 2.35]]];
    $response = $this->apiRequest($this->userA, 'POST', "/trips/$uuid/points/batch", $batch);
    $this->assertSame(200, $response->getStatusCode());
    $this->assertSame(['accepted' => 1, 'duplicates' => 0], json_decode((string) $response->getBody(), TRUE));
    $response = $this->apiRequest($this->userA, 'POST', "/trips/$uuid/points/batch", $batch);
    $this->assertSame(['accepted' => 0, 'duplicates' => 1], json_decode((string) $response->getBody(), TRUE));

    // Payload rejeté strictement.
    $response = $this->apiRequest($this->userA, 'PATCH', "/trips/$uuid", ['feeling' => 12]);
    $this->assertSame(422, $response->getStatusCode());

    // Photos : media inconnu → 404 (pas de fuite), y compris pour un autre
    // compte sur le trajet d'autrui.
    $mediaUuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    $this->assertSame(404, $this->apiRequest($this->userA, 'PATCH', "/trips/$uuid/photos/$mediaUuid", ['description' => 'x'])->getStatusCode());
    $this->assertSame(404, $this->apiRequest($this->userB, 'DELETE', "/trips/$uuid/photos/$mediaUuid")->getStatusCode());

    // Thématiques sur le trajet : remplacement complet + get-or-create
    // insensible à la casse.
    $response = $this->apiRequest($this->userA, 'PATCH', "/trips/$uuid", ['thematiques' => ['Mer', 'Vélo']]);
    $this->assertSame(200, $response->getStatusCode());
    $names = array_column(json_decode((string) $response->getBody(), TRUE)['thematiques'], 'name');
    $this->assertSame(['Mer', 'Vélo'], $names);
    $response = $this->apiRequest($this->userA, 'PATCH', "/trips/$uuid", ['thematiques' => ['mer']]);
    $terms = json_decode((string) $response->getBody(), TRUE)['thematiques'];
    // Retrait effectif de « Vélo », et « mer » réutilise le terme « Mer ».
    $this->assertCount(1, $terms);
    $this->assertSame('Mer', $terms[0]['name']);
    $search = json_decode((string) $this->apiRequest($this->userA, 'GET', '/thematiques', NULL, ['q' => 'me'])->getBody(), TRUE);
    $this->assertSame(['Mer'], array_column($search['items'], 'name'));

    // Baselines : création idempotente dépubliée, isolation, cycle complet.
    $baselineUuid = '22222222-3333-4444-8555-666666666666';
    $payload = [
      'uuid' => $baselineUuid,
      'title' => 'Baseline de A',
      'body' => 'Une note géolocalisée.',
      'lat' => 48.11,
      'lng' => -1.68,
      'thematiques' => ['Mer'],
    ];
    $response = $this->apiRequest($this->userA, 'POST', '/baselines', $payload);
    $this->assertSame(201, $response->getStatusCode());
    $baseline = json_decode((string) $response->getBody(), TRUE);
    $this->assertFalse($baseline['published']);
    $this->assertSame(48.11, $baseline['coordinates']['lat']);
    $this->assertSame('Mer', $baseline['thematiques'][0]['name']);
    $this->assertSame(200, $this->apiRequest($this->userA, 'POST', '/baselines', $payload)->getStatusCode());
    $this->assertSame(409, $this->apiRequest($this->userB, 'POST', '/baselines', $payload)->getStatusCode());
    $this->assertSame(404, $this->apiRequest($this->userB, 'PATCH', "/baselines/$baselineUuid", ['title' => 'Piraté'])->getStatusCode());
    $listA = json_decode((string) $this->apiRequest($this->userA, 'GET', '/baselines')->getBody(), TRUE);
    $this->assertSame(1, $listA['total']);
    $response = $this->apiRequest($this->userA, 'PATCH', "/baselines/$baselineUuid", ['published' => TRUE, 'thematiques' => []]);
    $patched = json_decode((string) $response->getBody(), TRUE);
    $this->assertTrue($patched['published']);
    $this->assertSame([], $patched['thematiques']);
    $this->assertSame(204, $this->apiRequest($this->userA, 'DELETE', "/baselines/$baselineUuid")->getStatusCode());
    $this->assertSame(404, $this->apiRequest($this->userA, 'PATCH', "/baselines/$baselineUuid", ['title' => 'x'])->getStatusCode());
  }

  /**
   * Exécute une requête API en basic_auth.
   *
   * @param \Drupal\user\UserInterface|null $user
   *   Le compte (NULL = anonyme).
   * @param string $method
   *   La méthode HTTP.
   * @param string $path
   *   Le chemin relatif à /opencar/api/v1.
   * @param array<string, mixed>|null $json
   *   Le corps JSON éventuel.
   * @param array<string, string> $query
   *   Paramètres de requête supplémentaires.
   */
  private function apiRequest(?UserInterface $user, string $method, string $path, ?array $json = NULL, array $query = []): ResponseInterface {
    $options = ['http_errors' => FALSE];
    if ($user !== NULL) {
      $options['auth'] = [$user->getAccountName(), $user->passRaw];
    }
    if ($json !== NULL) {
      $options['json'] = $json;
    }
    $url = $this->buildUrl('opencar/api/v1' . $path, ['query' => $query + ['_format' => 'json']]);
    return $this->getHttpClient()->request($method, $url, $options);
  }

}
