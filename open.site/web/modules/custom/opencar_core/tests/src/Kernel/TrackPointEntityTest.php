<?php

declare(strict_types=1);

namespace Drupal\Tests\opencar_core\Kernel;

use Drupal\Core\Entity\EntityStorageException;
use Drupal\KernelTests\KernelTestBase;
use Drupal\node\Entity\Node;
use Drupal\node\Entity\NodeType;
use Drupal\node\NodeInterface;
use Drupal\opencar_core\Entity\TrackPoint;
use Drupal\user\Entity\User;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * CRUD de l'entité opencar_track_point et contrainte unique (trajet, sequence).
 */
#[Group('opencar_core')]
#[RunTestsInSeparateProcesses]
final class TrackPointEntityTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'system',
    'user',
    'field',
    'filter',
    'text',
    'node',
    'opencar_core',
  ];

  /**
   * Le node trajet de test.
   */
  private NodeInterface $trajet;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    $this->installEntitySchema('user');
    $this->installEntitySchema('node');
    $this->installEntitySchema('opencar_track_point');
    $this->installSchema('node', ['node_access']);

    NodeType::create(['type' => 'trajet', 'name' => 'Trajet'])->save();
    User::create(['name' => 'runner', 'status' => 1])->save();
    $this->trajet = Node::create([
      'type' => 'trajet',
      'title' => 'Trajet de test',
      'uid' => 1,
    ]);
    $this->trajet->save();
  }

  /**
   * Crée, sauve et recharge un point avec toutes ses valeurs.
   */
  public function testCreateAndLoad(): void {
    $point = TrackPoint::create([
      'trajet' => $this->trajet->id(),
      'uid' => 1,
      'sequence' => 1,
      'timestamp_ms' => 1751628000123,
      'lat' => 48.8566001,
      'lng' => 2.3522219,
      'altitude' => 35.5,
      'speed' => 4.2,
      'bearing' => 180.0,
      'accuracy' => 3.9,
      'heart_rate' => 142,
      'segment' => 0,
    ]);
    $point->save();

    $storage = $this->container->get('entity_type.manager')->getStorage('opencar_track_point');
    $loaded = $storage->load($point->id());

    $this->assertInstanceOf(TrackPoint::class, $loaded);
    $this->assertSame((int) $this->trajet->id(), (int) $loaded->get('trajet')->target_id);
    $this->assertSame(1, (int) $loaded->get('sequence')->value);
    $this->assertSame(1751628000123, (int) $loaded->get('timestamp_ms')->value);
    $this->assertEqualsWithDelta(48.8566001, (float) $loaded->get('lat')->value, 1e-7);
    $this->assertEqualsWithDelta(2.3522219, (float) $loaded->get('lng')->value, 1e-7);
    $this->assertEqualsWithDelta(35.5, (float) $loaded->get('altitude')->value, 1e-6);
    $this->assertSame(142, (int) $loaded->get('heart_rate')->value);
    $this->assertSame(0, (int) $loaded->get('segment')->value);
    $this->assertSame(1, (int) $loaded->getOwnerId());
  }

  /**
   * Deux points (trajet, sequence) identiques : le second save échoue.
   */
  public function testUniqueTrajetSequenceConstraint(): void {
    $values = [
      'trajet' => $this->trajet->id(),
      'uid' => 1,
      'sequence' => 42,
      'timestamp_ms' => 1751628000000,
      'lat' => 45.0,
      'lng' => 5.0,
    ];
    TrackPoint::create($values)->save();

    // Une séquence différente sur le même trajet passe.
    TrackPoint::create(['sequence' => 43, 'timestamp_ms' => 1751628001000] + $values)->save();
    // La même séquence sur un autre trajet passe aussi.
    $autre = Node::create(['type' => 'trajet', 'title' => 'Autre trajet', 'uid' => 1]);
    $autre->save();
    TrackPoint::create(['trajet' => $autre->id()] + $values)->save();

    // Le doublon exact (trajet, sequence) est rejeté par la base.
    $this->expectException(EntityStorageException::class);
    TrackPoint::create($values)->save();
  }

  /**
   * Sans propriétaire explicite, le point appartient à l'anonyme.
   */
  public function testDefaultOwner(): void {
    $point = TrackPoint::create([
      'trajet' => $this->trajet->id(),
      'sequence' => 1,
      'timestamp_ms' => 1751628000000,
      'lat' => 45.0,
      'lng' => 5.0,
    ]);
    $point->save();

    $this->assertSame(0, (int) $point->getOwnerId());
  }

  /**
   * La suppression du trajet supprime ses points (hook node_predelete).
   */
  public function testPointsDeletedWithTrajet(): void {
    $values = [
      'trajet' => $this->trajet->id(),
      'uid' => 1,
      'timestamp_ms' => 1751628000000,
      'lat' => 45.0,
      'lng' => 5.0,
    ];
    TrackPoint::create(['sequence' => 1] + $values)->save();
    TrackPoint::create(['sequence' => 2] + $values)->save();

    $this->trajet->delete();

    $count = $this->container->get('entity_type.manager')
      ->getStorage('opencar_track_point')
      ->getQuery()
      ->accessCheck(FALSE)
      ->count()
      ->execute();
    $this->assertSame(0, (int) $count);
  }

}
