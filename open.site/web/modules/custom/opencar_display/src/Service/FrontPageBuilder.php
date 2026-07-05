<?php

declare(strict_types=1);

namespace Drupal\opencar_display\Service;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\node\NodeInterface;

/**
 * Prépare les sections dynamiques de la page d'accueil.
 *
 * Hero (carte du dernier trajet publié), tuiles de chiffres clés publics et
 * articles récents. Les cache tags (node_list:trajet, node_list:article,
 * node:{nid}) sont posés par le preprocess sur le render array
 * front_cacheability imprimé dans le template.
 */
final class FrontPageBuilder {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TrajetMapDataBuilder $mapDataBuilder,
    private readonly TrajetStatsPresenter $statsPresenter,
    private readonly SiteStatsService $siteStats,
  ) {}

  /**
   * Carte du dernier trajet publié pour le hero.
   *
   * @return array{nid: int, settings: array<string, mixed>}|null
   *   Les settings carte (geojson, color, start, end), ou NULL si aucun
   *   trajet publié n'a de tracé.
   */
  public function hero(): ?array {
    $storage = $this->entityTypeManager->getStorage('node');
    $nids = $storage->getQuery()
      ->accessCheck(TRUE)
      ->condition('type', 'trajet')
      ->condition('status', 1)
      ->sort('field_started_at', 'DESC')
      ->range(0, 5)
      ->execute();

    foreach ($storage->loadMultiple($nids) as $trajet) {
      if (!$trajet instanceof NodeInterface) {
        continue;
      }
      $mapData = $this->mapDataBuilder->build($trajet);
      if ($mapData === NULL) {
        continue;
      }
      $activityType = $trajet->hasField('field_activity_type') && !$trajet->get('field_activity_type')->isEmpty()
        ? (string) $trajet->get('field_activity_type')->value
        : NULL;
      return [
        'nid' => (int) $trajet->id(),
        'settings' => [
          'geojson' => $mapData['geojson'],
          'color' => $this->statsPresenter->activityColor($activityType),
          'start' => $mapData['start'],
          'end' => $mapData['end'],
        ],
      ];
    }
    return NULL;
  }

  /**
   * Baseline du hero : titre du dernier node « baseline » publié.
   *
   * @return string|null
   *   Le titre, ou NULL si aucun node baseline publié (repli sur le slogan
   *   du site côté preprocess).
   */
  public function baseline(): ?string {
    $baselines = $this->baselines(1);
    return $baselines[0] ?? NULL;
  }

  /**
   * Titres des derniers nodes « baseline » publiés, du plus récent au plus
   * ancien.
   *
   * @return list<string>
   *   Les titres, vide si aucun node publié.
   */
  public function baselines(int $limit = 10): array {
    $storage = $this->entityTypeManager->getStorage('node');
    $nids = $storage->getQuery()
      ->accessCheck(TRUE)
      ->condition('type', 'baseline')
      ->condition('status', 1)
      ->sort('created', 'DESC')
      ->range(0, $limit)
      ->execute();

    $titles = [];
    foreach ($storage->loadMultiple($nids) as $node) {
      if ($node instanceof NodeInterface) {
        $titles[] = (string) $node->label();
      }
    }
    return $titles;
  }

  /**
   * Tuiles de chiffres clés publics (format du partial trajet-stat-tile).
   *
   * @return list<array{id: string, label: string, value: string, icon: string, hero: bool}>
   *   Vide si aucun trajet publié.
   */
  public function statTiles(): array {
    $totals = $this->siteStats->publicTotals();
    if ($totals['trips'] === 0) {
      return [];
    }

    $tiles = [
      [
        'id' => 'trips',
        'label' => 'Trajets publiés',
        'value' => (string) $totals['trips'],
        'icon' => 'location',
        'hero' => FALSE,
      ],
      [
        'id' => 'distance',
        'label' => 'Distance cumulée',
        'value' => $this->statsPresenter->formatDistance($totals['distance_m']),
        'icon' => 'move',
        'hero' => FALSE,
      ],
      [
        'id' => 'elevation',
        'label' => 'Dénivelé cumulé',
        'value' => $this->statsPresenter->formatElevation($totals['elevation_gain_m']),
        'icon' => 'arrow-up',
        'hero' => FALSE,
      ],
    ];

    $activity = array_key_first($totals['activities']);
    if ($activity !== NULL) {
      $tiles[] = [
        'id' => 'top_activity',
        'label' => 'Activité favorite',
        'value' => $this->statsPresenter->activityLabel($activity),
        'icon' => 'heart',
        'hero' => FALSE,
      ];
    }

    return $tiles;
  }

  /**
   * Derniers articles publiés rendus en view mode card.
   *
   * @return array<string, mixed>
   *   Render array (vide si aucun article).
   */
  public function recentArticles(int $limit = 3): array {
    $storage = $this->entityTypeManager->getStorage('node');
    $nids = $storage->getQuery()
      ->accessCheck(TRUE)
      ->condition('type', 'article')
      ->condition('status', 1)
      ->sort('created', 'DESC')
      ->range(0, $limit)
      ->execute();

    if ($nids === []) {
      return [];
    }

    $build = $this->entityTypeManager->getViewBuilder('node')
      ->viewMultiple($storage->loadMultiple($nids), 'card');
    $build['#cache']['tags'][] = 'node_list:article';
    return $build;
  }

}
