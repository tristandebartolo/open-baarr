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
    private readonly TrajetGalleryBuilder $galleryBuilder,
  ) {}

  /**
   * Image de fond du hero : couverture d'un trajet publié et promu.
   *
   * Un trajet promu (base field promote) est tiré au hasard parmi ceux qui ont
   * une image ; le tirage est figé par le cache de l'accueil. Sert d'alternative
   * à la carte pour éviter le consentement cookies au premier affichage.
   *
   * @return array{nid: int, url: string, alt: string}|null
   *   L'image, ou NULL si aucun trajet promu n'a d'image exploitable (repli
   *   carte côté preprocess).
   */
  public function heroImage(): ?array {
    $storage = $this->entityTypeManager->getStorage('node');
    $nids = array_values($storage->getQuery()
      ->accessCheck(TRUE)
      ->condition('type', 'trajet')
      ->condition('status', 1)
      ->condition('promote', 1)
      ->execute());
    shuffle($nids);

    foreach ($nids as $nid) {
      $trajet = $storage->load($nid);
      if (!$trajet instanceof NodeInterface) {
        continue;
      }
      $cover = $this->galleryBuilder->coverImage($trajet);
      if ($cover !== NULL) {
        return [
          'nid' => (int) $trajet->id(),
          'url' => $cover['url'],
          'alt' => $cover['alt'],
        ];
      }
    }
    return NULL;
  }

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
   * Étapes de la timeline « route » : les derniers trajets publiés.
   *
   * @return list<array{url: string, title: string, date: string|null, activity: array{type: string|null, label: string, color: string}, distance: string|null, duration: string|null}>
   *   Du plus récent au plus ancien, vide si aucun trajet publié.
   */
  public function roadTrips(int $limit = 10): array {
    $storage = $this->entityTypeManager->getStorage('node');
    $nids = $storage->getQuery()
      ->accessCheck(TRUE)
      ->condition('type', 'trajet')
      ->condition('status', 1)
      ->sort('field_started_at', 'DESC')
      ->range(0, $limit)
      ->execute();

    $stops = [];
    foreach ($storage->loadMultiple($nids) as $trajet) {
      if (!$trajet instanceof NodeInterface) {
        continue;
      }
      $activityType = $trajet->hasField('field_activity_type') && !$trajet->get('field_activity_type')->isEmpty()
        ? (string) $trajet->get('field_activity_type')->value
        : NULL;
      $distance = $trajet->hasField('field_distance') && !$trajet->get('field_distance')->isEmpty()
        ? $this->statsPresenter->formatDistance((float) $trajet->get('field_distance')->value)
        : NULL;
      $duration = $trajet->hasField('field_duration') && !$trajet->get('field_duration')->isEmpty()
        ? $this->statsPresenter->formatDuration((int) $trajet->get('field_duration')->value)
        : NULL;

      $stops[] = [
        'url' => $trajet->toUrl()->toString(),
        'title' => (string) $trajet->label(),
        'date' => $this->statsPresenter->formatDateTime($trajet, 'field_started_at'),
        'activity' => [
          'type' => $activityType,
          'label' => $this->statsPresenter->activityLabel($activityType),
          'color' => $this->statsPresenter->activityColor($activityType),
        ],
        'distance' => $distance,
        'duration' => $duration,
      ];
    }
    return $stops;
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
