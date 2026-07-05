<?php

declare(strict_types=1);

namespace Drupal\opencar_api\Controller;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Controller\ControllerBase;
use Drupal\node\NodeInterface;
use Drupal\opencar_api\Service\PayloadValidator;
use Drupal\opencar_api\Service\TripNormalizer;
use Drupal\opencar_api\Service\TripRepository;
use Drupal\opencar_core\Service\TrackPointRepository;
use Drupal\opencar_core\Service\TripGeometryBuilder;
use Drupal\opencar_core\Service\TripMetricsCalculator;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

/**
 * CRUD des trajets : /opencar/api/v1/trips et /trips/{uuid}.
 *
 * La création est idempotente par UUID client : rejouer un POST avec un
 * UUID déjà connu du même compte renvoie 200 avec le trajet existant.
 * Le passage au statut `completed` déclenche le recalcul serveur des
 * métriques et de la géométrie (le serveur est autoritaire sur le calculé,
 * le client sur la saisie manuelle).
 */
final class TripController extends ControllerBase {

  /**
   * Correspondance clé de payload → champ du node trajet.
   */
  private const UPDATE_FIELD_MAP = [
    'chapo' => 'field_chapo',
    'activity_type' => 'field_activity_type',
    'started_at' => 'field_started_at',
    'ended_at' => 'field_ended_at',
    'weight' => 'field_weight',
    'feeling' => 'field_feeling',
    'fatigue' => 'field_fatigue',
    'hydration' => 'field_hydration',
    'steps' => 'field_steps',
    'calories' => 'field_calories',
    'heart_rate_avg' => 'field_heart_rate_avg',
    'heart_rate_max' => 'field_heart_rate_max',
    'battery_start' => 'field_battery_start',
    'battery_end' => 'field_battery_end',
    'device_info' => 'field_device_info',
  ];

  public function __construct(
    private readonly PayloadValidator $validator,
    private readonly TripRepository $tripRepository,
    private readonly TripNormalizer $normalizer,
    private readonly TrackPointRepository $trackPointRepository,
    private readonly TripMetricsCalculator $metricsCalculator,
    private readonly TripGeometryBuilder $geometryBuilder,
    private readonly TimeInterface $time,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('opencar_api.payload_validator'),
      $container->get('opencar_api.trip_repository'),
      $container->get('opencar_api.trip_normalizer'),
      $container->get('opencar_core.track_point_repository'),
      $container->get('opencar_core.trip_metrics_calculator'),
      $container->get('opencar_core.trip_geometry_builder'),
      $container->get('datetime.time'),
    );
  }

  /**
   * POST /trips — création idempotente par UUID client.
   */
  public function createTrip(Request $request): JsonResponse {
    $payload = $this->validator->validateTripCreate($this->validator->decode($request));

    $existing = $this->tripRepository->loadByUuid($payload['uuid']);
    if ($existing !== NULL) {
      if (!$this->tripRepository->isAllowed($existing, $this->currentUser())) {
        throw new ConflictHttpException('UUID déjà utilisé.');
      }
      return new JsonResponse($this->normalizer->normalize($existing, TRUE), 200);
    }

    $values = [
      'type' => 'trajet',
      'uuid' => $payload['uuid'],
      'title' => $payload['title'],
      'uid' => $this->currentUser()->id(),
      // Dépublié par défaut : le trajet ne paraît sur le site qu'après une
      // publication explicite (PATCH published: true depuis l'app).
      'status' => NodeInterface::NOT_PUBLISHED,
      'field_activity_type' => $payload['activity_type'],
      'field_trip_status' => $payload['status'],
      'field_started_at' => $payload['started_at'],
    ];
    if ($payload['device_info'] !== NULL) {
      $values['field_device_info'] = $payload['device_info'];
    }
    if ($payload['battery_start'] !== NULL) {
      $values['field_battery_start'] = $payload['battery_start'];
    }
    if ($payload['body'] !== NULL) {
      $values['field_body'] = ['value' => $payload['body'], 'format' => 'plain_text'];
    }

    $trip = $this->entityTypeManager()->getStorage('node')->create($values);
    $trip->save();

    return new JsonResponse($this->normalizer->normalize($trip, TRUE), 201);
  }

  /**
   * GET /trips — liste paginée des trajets du compte.
   */
  public function list(Request $request): JsonResponse {
    $filters = $this->validator->validateListQuery($request);
    $result = $this->tripRepository->findForAccount($this->currentUser(), $filters);

    return new JsonResponse([
      'items' => array_map(
        fn (NodeInterface $trip): array => $this->normalizer->normalize($trip),
        $result['items'],
      ),
      'page' => $filters['page'],
      'limit' => $filters['limit'],
      'total' => $result['total'],
    ]);
  }

  /**
   * GET /trips/{uuid} — détail d'un trajet.
   */
  public function get(string $uuid): JsonResponse {
    $trip = $this->tripRepository->loadForAccount($uuid, $this->currentUser());
    return new JsonResponse($this->normalizer->normalize($trip, TRUE));
  }

  /**
   * PATCH /trips/{uuid} — métadonnées et santé manuelle.
   */
  public function update(string $uuid, Request $request): JsonResponse {
    $trip = $this->tripRepository->loadForAccount($uuid, $this->currentUser());
    $changes = $this->validator->validateTripUpdate($this->validator->decode($request));

    foreach ($changes as $key => $value) {
      if ($key === 'title') {
        $trip->setTitle($value);
      }
      elseif ($key === 'body') {
        $this->setFieldValue($trip, 'field_body', $value === NULL ? NULL : ['value' => $value, 'format' => 'plain_text']);
      }
      elseif ($key === 'published') {
        $value ? $trip->setPublished() : $trip->setUnpublished();
      }
      else {
        $this->setFieldValue($trip, self::UPDATE_FIELD_MAP[$key], $value);
      }
    }
    $trip->save();

    return new JsonResponse($this->normalizer->normalize($trip, TRUE));
  }

  /**
   * PATCH /trips/{uuid}/status — changement de statut du cycle de vie.
   *
   * Sur `completed`, le serveur recalcule métriques et géométrie à partir
   * des points de mesure reçus.
   */
  public function updateStatus(string $uuid, Request $request): JsonResponse {
    $trip = $this->tripRepository->loadForAccount($uuid, $this->currentUser());
    $payload = $this->validator->validateStatusChange($this->validator->decode($request));
    $at = $payload['at'] ?? $this->time->getRequestTime();

    $this->setFieldValue($trip, 'field_trip_status', $payload['status']);

    if ($payload['status'] === 'recording' && $this->fieldIsEmpty($trip, 'field_started_at')) {
      $this->setFieldValue($trip, 'field_started_at', $at);
    }

    if ($payload['status'] === 'completed') {
      $this->consolidate($trip, $at);
    }

    $trip->save();
    return new JsonResponse($this->normalizer->normalize($trip, TRUE));
  }

  /**
   * DELETE /trips/{uuid} — suppression (les points suivent via hook).
   */
  public function delete(string $uuid): Response {
    $trip = $this->tripRepository->loadForAccount($uuid, $this->currentUser());
    $trip->delete();
    return new Response('', 204);
  }

  /**
   * Recalcule métriques, géométrie et bornes temporelles d'un trajet clos.
   */
  private function consolidate(NodeInterface $trip, int $completedAt): void {
    $points = $this->trackPointRepository->getPointsData((int) $trip->id());
    $metrics = $this->metricsCalculator->calculate($points);

    $this->setFieldValue($trip, 'field_distance', $metrics['distance']);
    $this->setFieldValue($trip, 'field_duration', $metrics['duration']);
    $this->setFieldValue($trip, 'field_duration_total', $metrics['duration_total']);
    $this->setFieldValue($trip, 'field_elevation_gain', $metrics['elevation_gain']);
    $this->setFieldValue($trip, 'field_elevation_loss', $metrics['elevation_loss']);
    $this->setFieldValue($trip, 'field_speed_avg', $metrics['speed_avg']);
    $this->setFieldValue($trip, 'field_speed_max', $metrics['speed_max']);
    // La FC issue des points est prioritaire ; sinon on garde une éventuelle
    // valeur envoyée par l'app (HealthKit / Health Connect).
    if ($metrics['heart_rate_avg'] !== NULL) {
      $this->setFieldValue($trip, 'field_heart_rate_avg', $metrics['heart_rate_avg']);
      $this->setFieldValue($trip, 'field_heart_rate_max', $metrics['heart_rate_max']);
    }

    $this->geometryBuilder->applyToTrip($trip, $points);

    if ($points !== []) {
      $first = $points[array_key_first($points)];
      $last = $points[array_key_last($points)];
      if ($this->fieldIsEmpty($trip, 'field_started_at')) {
        $this->setFieldValue($trip, 'field_started_at', intdiv($first['timestamp_ms'], 1000));
      }
      if ($this->fieldIsEmpty($trip, 'field_ended_at')) {
        $this->setFieldValue($trip, 'field_ended_at', intdiv($last['timestamp_ms'], 1000));
      }
      if ($this->fieldIsEmpty($trip, 'field_coordinates')) {
        $this->setFieldValue($trip, 'field_coordinates', ['lat' => $first['lat'], 'lng' => $first['lng']]);
      }
    }
    elseif ($this->fieldIsEmpty($trip, 'field_ended_at')) {
      $this->setFieldValue($trip, 'field_ended_at', $completedAt);
    }
  }

  /**
   * Affecte une valeur à un champ si le node le porte.
   */
  private function setFieldValue(NodeInterface $trip, string $field, mixed $value): void {
    if ($trip->hasField($field)) {
      $trip->set($field, $value);
    }
  }

  /**
   * Le champ est-il absent ou vide ?
   */
  private function fieldIsEmpty(NodeInterface $trip, string $field): bool {
    return !$trip->hasField($field) || $trip->get($field)->isEmpty();
  }

}
