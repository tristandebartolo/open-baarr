<?php

declare(strict_types=1);

namespace Drupal\opencar_api\Service;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\taxonomy\TermInterface;

/**
 * Recherche et résolution des termes du vocabulaire « thematiques ».
 *
 * L'app envoie les thématiques comme un tableau de noms : chaque nom est
 * rattaché à un terme existant (comparaison insensible à la casse) ou crée
 * un nouveau terme — jamais de doublon.
 */
final class ThematiqueResolver {

  private const VID = 'thematiques';

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * Recherche de termes par fragment de nom (autocomplétion de l'app).
   *
   * @return list<array{id: int, name: string}>
   *   Termes correspondants, triés par nom.
   */
  public function search(string $q, int $limit = 20): array {
    $storage = $this->entityTypeManager->getStorage('taxonomy_term');
    $query = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('vid', self::VID)
      ->sort('name')
      ->range(0, $limit);
    if (trim($q) !== '') {
      $query->condition('name', trim($q), 'CONTAINS');
    }
    $terms = $storage->loadMultiple($query->execute());

    $results = [];
    foreach ($terms as $term) {
      if ($term instanceof TermInterface) {
        $results[] = ['id' => (int) $term->id(), 'name' => (string) $term->label()];
      }
    }
    return $results;
  }

  /**
   * Résout une liste de noms en identifiants de termes (get-or-create).
   *
   * @param list<string> $names
   *   Noms saisis côté app (déjà validés : non vides, ≤ 255).
   *
   * @return list<int>
   *   Les tids, dans l'ordre d'entrée, dédoublonnés.
   */
  public function resolveNames(array $names): array {
    $storage = $this->entityTypeManager->getStorage('taxonomy_term');
    $tids = [];
    $seen = [];
    foreach ($names as $name) {
      $name = trim($name);
      $key = mb_strtolower($name);
      if ($name === '' || isset($seen[$key])) {
        continue;
      }
      $seen[$key] = TRUE;

      // Comparaison insensible à la casse : loadByProperties est sensible
      // selon la collation ; on requête donc explicitement.
      $existing = $storage->getQuery()
        ->accessCheck(FALSE)
        ->condition('vid', self::VID)
        ->condition('name', $name)
        ->range(0, 1)
        ->execute();
      $tid = $existing !== [] ? (int) reset($existing) : NULL;

      if ($tid === NULL) {
        $term = $storage->create(['vid' => self::VID, 'name' => $name]);
        $term->save();
        $tid = (int) $term->id();
      }
      $tids[] = $tid;
    }
    return $tids;
  }

}
