<?php

declare(strict_types=1);

namespace Drupal\opencar_api\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\opencar_api\Service\PayloadValidator;
use Drupal\opencar_core\Service\TripStatsService;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * GET /opencar/api/v1/stats/summary — agrégats pour le dashboard de l'app.
 */
final class StatsController extends ControllerBase {

  public function __construct(
    private readonly PayloadValidator $validator,
    private readonly TripStatsService $tripStats,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('opencar_api.payload_validator'),
      $container->get('opencar_core.trip_stats'),
    );
  }

  /**
   * Résumé statistique des trajets terminés du compte.
   */
  public function summary(Request $request): JsonResponse {
    $params = $this->validator->validateStatsQuery($request);
    $summary = $this->tripStats->summary(
      (int) $this->currentUser()->id(),
      $params['period'],
      $params['activity_type'],
    );
    return new JsonResponse($summary);
  }

}
