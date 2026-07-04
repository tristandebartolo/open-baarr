<?php

declare(strict_types=1);

namespace Drupal\opencar_api\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\opencar_api\Service\TripRepository;
use Drupal\opencar_core\Service\GpxGenerator;
use Drupal\opencar_core\Service\TrackPointRepository;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Response;

/**
 * GET /opencar/api/v1/trips/{uuid}/gpx — export GPX 1.1 d'un trajet.
 */
final class GpxController extends ControllerBase {

  public function __construct(
    private readonly TripRepository $tripRepository,
    private readonly TrackPointRepository $trackPointRepository,
    private readonly GpxGenerator $gpxGenerator,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('opencar_api.trip_repository'),
      $container->get('opencar_core.track_point_repository'),
      $container->get('opencar_core.gpx_generator'),
    );
  }

  /**
   * Télécharge la trace GPX du trajet.
   */
  public function download(string $uuid): Response {
    $trip = $this->tripRepository->loadForAccount($uuid, $this->currentUser());
    $points = $this->trackPointRepository->getPointsData((int) $trip->id());
    $gpx = $this->gpxGenerator->generate($trip, $points);

    return new Response($gpx, 200, [
      'Content-Type' => 'application/gpx+xml; charset=UTF-8',
      'Content-Disposition' => sprintf('attachment; filename="trajet-%s.gpx"', $trip->uuid()),
    ]);
  }

}
