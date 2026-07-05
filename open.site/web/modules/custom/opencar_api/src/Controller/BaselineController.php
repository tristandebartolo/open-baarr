<?php

declare(strict_types=1);

namespace Drupal\opencar_api\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\node\NodeInterface;
use Drupal\opencar_api\Service\PayloadValidator;
use Drupal\opencar_api\Service\ThematiqueResolver;
use Drupal\opencar_api\Service\TripNormalizer;
use Drupal\opencar_api\Service\TripRepository;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

/**
 * Baselines : /opencar/api/v1/baselines[/{uuid}] + recherche de thématiques.
 *
 * Une baseline est une note géolocalisée (title + description +
 * coordonnées + thématiques), créée depuis le formulaire de l'app —
 * idempotente par uuid client, dépubliée à la création (comme les trajets).
 */
final class BaselineController extends ControllerBase {

  public function __construct(
    private readonly PayloadValidator $validator,
    private readonly TripRepository $repository,
    private readonly TripNormalizer $normalizer,
    private readonly ThematiqueResolver $thematiqueResolver,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('opencar_api.payload_validator'),
      $container->get('opencar_api.trip_repository'),
      $container->get('opencar_api.trip_normalizer'),
      $container->get('opencar_api.thematique_resolver'),
    );
  }

  /**
   * POST /baselines — création idempotente par UUID client.
   */
  public function createBaseline(Request $request): JsonResponse {
    $payload = $this->validator->validateBaselineCreate($this->validator->decode($request));

    $existing = $this->repository->loadByUuid($payload['uuid'], 'baseline');
    if ($existing !== NULL) {
      if (!$this->repository->isAllowed($existing, $this->currentUser())) {
        throw new ConflictHttpException('UUID déjà utilisé.');
      }
      return new JsonResponse($this->normalizer->normalizeBaseline($existing), 200);
    }

    $values = [
      'type' => 'baseline',
      'uuid' => $payload['uuid'],
      'title' => $payload['title'],
      'uid' => $this->currentUser()->id(),
      // Dépubliée par défaut, comme les trajets (publication via PATCH).
      'status' => NodeInterface::NOT_PUBLISHED,
    ];
    if ($payload['body'] !== NULL) {
      $values['field_body'] = ['value' => $payload['body'], 'format' => 'plain_text'];
    }
    if ($payload['coordinates'] !== NULL) {
      $values['field_coordinates'] = $payload['coordinates'];
    }
    if ($payload['thematiques'] !== NULL) {
      $values['field_thematiques'] = $this->thematiqueResolver->resolveNames($payload['thematiques']);
    }

    $baseline = $this->entityTypeManager()->getStorage('node')->create($values);
    $baseline->save();
    assert($baseline instanceof NodeInterface);

    return new JsonResponse($this->normalizer->normalizeBaseline($baseline), 201);
  }

  /**
   * GET /baselines — liste paginée des baselines du compte.
   */
  public function list(Request $request): JsonResponse {
    $filters = $this->validator->validateListQuery($request);
    // Pas de filtres trajet (status/activity/since) pour les baselines.
    $filters['status'] = NULL;
    $filters['activity_type'] = NULL;
    $filters['since'] = NULL;
    $result = $this->repository->findForAccount($this->currentUser(), $filters, 'baseline');

    return new JsonResponse([
      'items' => array_map(
        fn (NodeInterface $baseline): array => $this->normalizer->normalizeBaseline($baseline),
        $result['items'],
      ),
      'page' => $filters['page'],
      'limit' => $filters['limit'],
      'total' => $result['total'],
    ]);
  }

  /**
   * PATCH /baselines/{uuid} — title, body, published, thématiques.
   */
  public function update(string $uuid, Request $request): JsonResponse {
    $baseline = $this->repository->loadForAccount($uuid, $this->currentUser(), 'baseline');
    $changes = $this->validator->validateBaselineUpdate($this->validator->decode($request));

    foreach ($changes as $key => $value) {
      switch ($key) {
        case 'title':
          $baseline->setTitle($value);
          break;

        case 'body':
          if ($baseline->hasField('field_body')) {
            $baseline->set('field_body', $value === NULL ? NULL : ['value' => $value, 'format' => 'plain_text']);
          }
          break;

        case 'published':
          $value ? $baseline->setPublished() : $baseline->setUnpublished();
          break;

        case 'thematiques':
          // Remplacement complet : retirer = renvoyer la liste sans le terme.
          if ($baseline->hasField('field_thematiques')) {
            $baseline->set('field_thematiques', $this->thematiqueResolver->resolveNames($value));
          }
          break;
      }
    }
    $baseline->save();

    return new JsonResponse($this->normalizer->normalizeBaseline($baseline));
  }

  /**
   * DELETE /baselines/{uuid} — 204.
   */
  public function delete(string $uuid): Response {
    $baseline = $this->repository->loadForAccount($uuid, $this->currentUser(), 'baseline');
    $baseline->delete();
    return new Response('', 204);
  }

  /**
   * GET /thematiques?q= — recherche de termes pour l'autocomplétion.
   */
  public function searchThematiques(Request $request): JsonResponse {
    $q = (string) $request->query->get('q', '');
    if (mb_strlen($q) > 255) {
      $q = mb_substr($q, 0, 255);
    }
    return new JsonResponse(['items' => $this->thematiqueResolver->search($q)]);
  }

}
