<?php

declare(strict_types=1);

namespace Drupal\opencar_api\Controller;

use Drupal\Core\Cache\Cache;
use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Database\Connection;
use Drupal\Core\Database\IntegrityConstraintViolationException;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\opencar_api\Service\PayloadValidator;
use Drupal\opencar_api\Service\TripRepository;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * POST /opencar/api/v1/trips/{uuid}/points/batch — ingestion des points.
 *
 * Idempotent : l'index unique (trajet, sequence) fait qu'un batch rejoué
 * après un timeout ne crée aucun doublon. Les séquences déjà connues sont
 * comptées dans `duplicates`, les nouvelles dans `accepted`.
 */
final class TripPointsController extends ControllerBase {

  public function __construct(
    private readonly PayloadValidator $validator,
    private readonly TripRepository $tripRepository,
    private readonly Connection $database,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('opencar_api.payload_validator'),
      $container->get('opencar_api.trip_repository'),
      $container->get('database'),
    );
  }

  /**
   * Ingère un batch de points (max 500), sans doublon possible.
   */
  public function batch(string $uuid, Request $request): JsonResponse {
    $trip = $this->tripRepository->loadForAccount($uuid, $this->currentUser());
    $points = $this->validator->validatePointsBatch($this->validator->decode($request));

    $existing = $this->existingSequences((int) $trip->id(), array_column($points, 'sequence'));
    $storage = $this->entityTypeManager()->getStorage('opencar_track_point');

    $accepted = 0;
    $duplicates = 0;
    foreach ($points as $point) {
      if (in_array($point['sequence'], $existing, TRUE)) {
        $duplicates++;
        continue;
      }
      $entity = $storage->create($point + [
        'trajet' => (int) $trip->id(),
        'uid' => (int) $trip->getOwnerId(),
      ]);
      try {
        $entity->save();
        $accepted++;
      }
      catch (EntityStorageException $e) {
        // Course avec un batch concurrent : l'index unique a fait son
        // travail, le point existe déjà.
        if ($e->getPrevious() instanceof IntegrityConstraintViolationException) {
          $duplicates++;
        }
        else {
          throw $e;
        }
      }
    }

    if ($accepted > 0) {
      // Les rendus web du trajet (carte, graphiques) dépendent des points :
      // ils sont mis en cache sous le tag du node, invalidé ici.
      Cache::invalidateTags(['node:' . $trip->id()]);
    }

    return new JsonResponse(['accepted' => $accepted, 'duplicates' => $duplicates]);
  }

  /**
   * Séquences déjà enregistrées pour ce trajet parmi celles du batch.
   *
   * @param list<int> $sequences
   *   Les séquences du batch.
   *
   * @return list<int>
   *   Celles qui existent déjà en base.
   */
  private function existingSequences(int $trajetId, array $sequences): array {
    if ($sequences === []) {
      return [];
    }
    $result = $this->database->select('opencar_track_point', 'p')
      ->fields('p', ['sequence'])
      ->condition('p.trajet', $trajetId)
      ->condition('p.sequence', $sequences, 'IN')
      ->execute()
      ->fetchCol();

    return array_map('intval', $result);
  }

}
