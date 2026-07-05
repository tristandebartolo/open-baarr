<?php

declare(strict_types=1);

namespace Drupal\opencar_api\Service;

use Drupal\Component\Uuid\Uuid;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * Validation stricte des payloads JSON de l'API mobile.
 *
 * Chaque méthode valide un payload d'endpoint : clés inconnues refusées,
 * types et bornes contrôlés, valeurs normalisées (timestamps en secondes
 * epoch, nombres castés). Erreur de structure → 400, contenu invalide → 422.
 */
final class PayloadValidator {

  public const ACTIVITY_TYPES = ['car', 'motorcycle', 'running', 'walking', 'hiking'];
  public const TRIP_STATUSES = ['draft', 'recording', 'paused', 'completed'];
  public const MAX_BATCH_SIZE = 500;
  public const MAX_LIST_LIMIT = 100;

  /**
   * Décode le corps JSON d'une requête en tableau associatif.
   *
   * @return array<mixed>
   *   Le payload décodé.
   */
  public function decode(Request $request): array {
    $content = (string) $request->getContent();
    if ($content === '') {
      throw new BadRequestHttpException('Corps de requête vide : un objet JSON est attendu.');
    }
    try {
      $data = json_decode($content, TRUE, 32, JSON_THROW_ON_ERROR);
    }
    catch (\JsonException $e) {
      throw new BadRequestHttpException('JSON invalide : ' . $e->getMessage());
    }
    if (!is_array($data)) {
      throw new BadRequestHttpException('Un objet JSON est attendu.');
    }
    return $data;
  }

  /**
   * Valide le payload de POST /trips.
   *
   * @param array<mixed> $payload
   *   Le payload décodé.
   *
   * @return array{uuid: string, title: string, activity_type: string, started_at: int, status: string, body: string|null, device_info: string|null, battery_start: int|null}
   *   Le payload normalisé.
   */
  public function validateTripCreate(array $payload): array {
    $this->rejectUnknownKeys($payload, [
      'uuid', 'title', 'activity_type', 'started_at', 'status', 'body',
      'device_info', 'battery_start',
    ]);
    $errors = [];

    $uuid = $payload['uuid'] ?? NULL;
    if (!is_string($uuid) || !Uuid::isValid($uuid)) {
      $errors[] = 'uuid : UUID client requis et valide.';
    }
    $title = $payload['title'] ?? NULL;
    if (!is_string($title) || trim($title) === '' || mb_strlen($title) > 255) {
      $errors[] = 'title : chaîne non vide de 255 caractères maximum requise.';
    }
    $activityType = $payload['activity_type'] ?? NULL;
    if (!is_string($activityType) || !in_array($activityType, self::ACTIVITY_TYPES, TRUE)) {
      $errors[] = 'activity_type : valeurs autorisées ' . implode('|', self::ACTIVITY_TYPES) . '.';
    }
    $startedAt = $this->optionalTimestamp($payload, 'started_at', $errors);
    if (!array_key_exists('started_at', $payload)) {
      $errors[] = 'started_at : requis (epoch secondes ou ISO 8601).';
    }
    $status = $payload['status'] ?? 'draft';
    if (!is_string($status) || !in_array($status, self::TRIP_STATUSES, TRUE)) {
      $errors[] = 'status : valeurs autorisées ' . implode('|', self::TRIP_STATUSES) . '.';
    }
    $body = $this->optionalString($payload, 'body', 10000, $errors);
    $deviceInfo = $this->optionalString($payload, 'device_info', 255, $errors);
    $batteryStart = $this->optionalInt($payload, 'battery_start', 0, 100, $errors);

    $this->throwIfErrors($errors);

    return [
      'uuid' => mb_strtolower($uuid),
      'title' => trim($title),
      'activity_type' => $activityType,
      'started_at' => $startedAt,
      'status' => $status,
      'body' => $body,
      'device_info' => $deviceInfo,
      'battery_start' => $batteryStart,
    ];
  }

  /**
   * Valide le payload de PATCH /trips/{uuid} (mise à jour partielle).
   *
   * @param array<mixed> $payload
   *   Le payload décodé.
   *
   * @return array<string, mixed>
   *   Uniquement les clés fournies, normalisées.
   */
  public function validateTripUpdate(array $payload): array {
    $allowed = [
      'title', 'chapo', 'body', 'activity_type', 'started_at', 'ended_at',
      'weight', 'feeling', 'fatigue', 'hydration', 'steps', 'calories',
      'heart_rate_avg', 'heart_rate_max', 'battery_start', 'battery_end',
      'device_info', 'published', 'thematiques',
      'temperature', 'weather_code', 'wind_speed',
    ];
    $this->rejectUnknownKeys($payload, $allowed);
    if ($payload === []) {
      throw new UnprocessableEntityHttpException('Payload vide : au moins un champ à modifier est requis.');
    }
    $errors = [];
    $changes = [];

    if (array_key_exists('title', $payload)) {
      if (!is_string($payload['title']) || trim($payload['title']) === '' || mb_strlen($payload['title']) > 255) {
        $errors[] = 'title : chaîne non vide de 255 caractères maximum requise.';
      }
      else {
        $changes['title'] = trim($payload['title']);
      }
    }
    if (array_key_exists('activity_type', $payload)) {
      if (!is_string($payload['activity_type']) || !in_array($payload['activity_type'], self::ACTIVITY_TYPES, TRUE)) {
        $errors[] = 'activity_type : valeurs autorisées ' . implode('|', self::ACTIVITY_TYPES) . '.';
      }
      else {
        $changes['activity_type'] = $payload['activity_type'];
      }
    }

    foreach (['started_at', 'ended_at'] as $key) {
      if (array_key_exists($key, $payload)) {
        $changes[$key] = $this->optionalTimestamp($payload, $key, $errors);
      }
    }
    foreach ([
      'weight' => [0.0, 500.0],
      'hydration' => [0.0, 100.0],
      'calories' => [0.0, 100000.0],
      'temperature' => [-90.0, 60.0],
      'wind_speed' => [0.0, 150.0],
    ] as $key => [$min, $max]) {
      if (array_key_exists($key, $payload)) {
        $changes[$key] = $this->optionalFloat($payload, $key, $min, $max, $errors);
      }
    }
    foreach ([
      'feeling' => [1, 5],
      'fatigue' => [1, 5],
      'steps' => [0, 10000000],
      'heart_rate_avg' => [1, 300],
      'heart_rate_max' => [1, 300],
      'battery_start' => [0, 100],
      'battery_end' => [0, 100],
      'weather_code' => [0, 99],
    ] as $key => [$min, $max]) {
      if (array_key_exists($key, $payload)) {
        $changes[$key] = $this->optionalInt($payload, $key, $min, $max, $errors);
      }
    }
    if (array_key_exists('chapo', $payload)) {
      $changes['chapo'] = $this->optionalString($payload, 'chapo', 1000, $errors);
    }
    if (array_key_exists('body', $payload)) {
      $changes['body'] = $this->optionalString($payload, 'body', 10000, $errors);
    }
    if (array_key_exists('device_info', $payload)) {
      $changes['device_info'] = $this->optionalString($payload, 'device_info', 255, $errors);
    }
    if (array_key_exists('published', $payload)) {
      if (!is_bool($payload['published'])) {
        $errors[] = 'published : booléen requis.';
      }
      else {
        $changes['published'] = $payload['published'];
      }
    }
    if (array_key_exists('thematiques', $payload)) {
      $changes['thematiques'] = $this->optionalThematiques($payload, $errors);
    }

    $this->throwIfErrors($errors);
    return $changes;
  }

  /**
   * Valide le payload de POST /baselines (création idempotente).
   *
   * @param array<mixed> $payload
   *   Le payload décodé.
   *
   * @return array<string, mixed>
   *   Le payload normalisé.
   */
  public function validateBaselineCreate(array $payload): array {
    $this->rejectUnknownKeys($payload, ['uuid', 'title', 'body', 'lat', 'lng', 'thematiques']);
    $errors = [];

    $uuid = $payload['uuid'] ?? NULL;
    if (!is_string($uuid) || !Uuid::isValid($uuid)) {
      $errors[] = 'uuid : UUID client requis et valide.';
    }
    $title = $payload['title'] ?? NULL;
    if (!is_string($title) || trim($title) === '' || mb_strlen($title) > 255) {
      $errors[] = 'title : chaîne non vide de 255 caractères maximum requise.';
    }
    $body = $this->optionalString($payload, 'body', 10000, $errors);
    $lat = $this->optionalFloat($payload, 'lat', -90.0, 90.0, $errors);
    $lng = $this->optionalFloat($payload, 'lng', -180.0, 180.0, $errors);
    if (($lat === NULL) !== ($lng === NULL)) {
      $errors[] = 'lat/lng : fournir les deux coordonnées, ou aucune.';
    }
    $thematiques = array_key_exists('thematiques', $payload)
      ? $this->optionalThematiques($payload, $errors)
      : NULL;

    $this->throwIfErrors($errors);
    return [
      'uuid' => mb_strtolower((string) $uuid),
      'title' => trim((string) $title),
      'body' => $body,
      'coordinates' => $lat !== NULL && $lng !== NULL ? ['lat' => $lat, 'lng' => $lng] : NULL,
      'thematiques' => $thematiques,
    ];
  }

  /**
   * Valide le payload de PATCH /baselines/{uuid}.
   *
   * @param array<mixed> $payload
   *   Le payload décodé.
   *
   * @return array<string, mixed>
   *   Uniquement les clés fournies, normalisées.
   */
  public function validateBaselineUpdate(array $payload): array {
    $this->rejectUnknownKeys($payload, ['title', 'body', 'published', 'thematiques']);
    if ($payload === []) {
      throw new UnprocessableEntityHttpException('Payload vide : au moins un champ à modifier est requis.');
    }
    $errors = [];
    $changes = [];

    if (array_key_exists('title', $payload)) {
      if (!is_string($payload['title']) || trim($payload['title']) === '' || mb_strlen($payload['title']) > 255) {
        $errors[] = 'title : chaîne non vide de 255 caractères maximum requise.';
      }
      else {
        $changes['title'] = trim($payload['title']);
      }
    }
    if (array_key_exists('body', $payload)) {
      $changes['body'] = $this->optionalString($payload, 'body', 10000, $errors);
    }
    if (array_key_exists('published', $payload)) {
      if (!is_bool($payload['published'])) {
        $errors[] = 'published : booléen requis.';
      }
      else {
        $changes['published'] = $payload['published'];
      }
    }
    if (array_key_exists('thematiques', $payload)) {
      $changes['thematiques'] = $this->optionalThematiques($payload, $errors);
    }

    $this->throwIfErrors($errors);
    return $changes;
  }

  /**
   * Valide la clé `thematiques` : liste de noms de termes (remplacement
   * complet du champ — retirer un terme = renvoyer la liste sans lui).
   *
   * @param array<mixed> $payload
   *   Le payload décodé.
   * @param list<string> $errors
   *   Accumulateur d'erreurs.
   *
   * @return list<string>
   *   Les noms nettoyés.
   */
  private function optionalThematiques(array $payload, array &$errors): array {
    $value = $payload['thematiques'];
    if (!is_array($value) || count($value) > 20) {
      $errors[] = 'thematiques : tableau de 20 noms maximum attendu.';
      return [];
    }
    $names = [];
    foreach ($value as $name) {
      if (!is_string($name) || trim($name) === '' || mb_strlen($name) > 255) {
        $errors[] = 'thematiques : chaque entrée doit être une chaîne non vide de 255 caractères maximum.';
        return [];
      }
      $names[] = trim($name);
    }
    return $names;
  }

  /**
   * Valide le payload de PATCH /trips/{uuid}/photos/{media_uuid}.
   *
   * @param array<mixed> $payload
   *   Le payload décodé.
   *
   * @return array<string, mixed>
   *   Uniquement les clés fournies, normalisées. `coordinates` vaut
   *   ['lat' => float, 'lng' => float] ou NULL (effacement).
   */
  public function validatePhotoUpdate(array $payload): array {
    $this->rejectUnknownKeys($payload, ['name', 'description', 'copyright', 'lat', 'lng']);
    if ($payload === []) {
      throw new UnprocessableEntityHttpException('Payload vide : au moins un champ à modifier est requis.');
    }
    $errors = [];
    $changes = [];

    if (array_key_exists('name', $payload)) {
      if (!is_string($payload['name']) || trim($payload['name']) === '' || mb_strlen($payload['name']) > 255) {
        $errors[] = 'name : chaîne non vide de 255 caractères maximum requise.';
      }
      else {
        $changes['name'] = trim($payload['name']);
      }
    }
    if (array_key_exists('description', $payload)) {
      $changes['description'] = $this->optionalString($payload, 'description', 1000, $errors);
    }
    if (array_key_exists('copyright', $payload)) {
      $changes['copyright'] = $this->optionalString($payload, 'copyright', 255, $errors);
    }
    if (array_key_exists('lat', $payload) || array_key_exists('lng', $payload)) {
      $lat = $this->optionalFloat($payload, 'lat', -90.0, 90.0, $errors);
      $lng = $this->optionalFloat($payload, 'lng', -180.0, 180.0, $errors);
      if (!array_key_exists('lat', $payload) || !array_key_exists('lng', $payload) || (($lat === NULL) !== ($lng === NULL))) {
        $errors[] = 'lat/lng : fournir les deux valeurs (ou null toutes les deux pour effacer).';
      }
      else {
        $changes['coordinates'] = $lat === NULL || $lng === NULL ? NULL : ['lat' => $lat, 'lng' => $lng];
      }
    }

    $this->throwIfErrors($errors);
    return $changes;
  }

  /**
   * Valide le payload de PATCH /trips/{uuid}/status.
   *
   * @param array<mixed> $payload
   *   Le payload décodé.
   *
   * @return array{status: string, at: int|null}
   *   Le payload normalisé.
   */
  public function validateStatusChange(array $payload): array {
    $this->rejectUnknownKeys($payload, ['status', 'at']);
    $errors = [];

    $status = $payload['status'] ?? NULL;
    if (!is_string($status) || !in_array($status, self::TRIP_STATUSES, TRUE)) {
      $errors[] = 'status : requis, valeurs autorisées ' . implode('|', self::TRIP_STATUSES) . '.';
    }
    $at = $this->optionalTimestamp($payload, 'at', $errors);

    $this->throwIfErrors($errors);
    return ['status' => $status, 'at' => $at];
  }

  /**
   * Valide le payload de POST /trips/{uuid}/points/batch.
   *
   * @param array<mixed> $payload
   *   Le payload décodé.
   *
   * @return list<array{sequence: int, timestamp_ms: int, lat: float, lng: float, altitude: float|null, speed: float|null, bearing: float|null, accuracy: float|null, heart_rate: int|null, segment: int}>
   *   Points normalisés, dédoublonnés par séquence, triés par séquence.
   */
  public function validatePointsBatch(array $payload): array {
    $this->rejectUnknownKeys($payload, ['points']);
    $points = $payload['points'] ?? NULL;
    if (!is_array($points) || $points === [] || !array_is_list($points)) {
      throw new UnprocessableEntityHttpException('points : liste non vide requise.');
    }
    if (count($points) > self::MAX_BATCH_SIZE) {
      throw new UnprocessableEntityHttpException(sprintf('points : %d points maximum par batch (%d reçus).', self::MAX_BATCH_SIZE, count($points)));
    }

    $errors = [];
    $normalized = [];
    foreach ($points as $index => $point) {
      if (!is_array($point)) {
        $errors[] = sprintf('points[%d] : objet attendu.', $index);
        continue;
      }
      $pointErrors = [];
      $this->rejectUnknownKeys($point, ['seq', 't', 'lat', 'lng', 'alt', 'spd', 'brg', 'acc', 'hr', 'seg'], sprintf('points[%d]', $index));

      $seq = $point['seq'] ?? NULL;
      if (!is_int($seq) || $seq < 0) {
        $pointErrors[] = 'seq : entier >= 0 requis.';
      }
      $t = $point['t'] ?? NULL;
      if (!is_int($t) || $t <= 0) {
        $pointErrors[] = 't : timestamp epoch en millisecondes requis.';
      }
      $lat = $point['lat'] ?? NULL;
      if (!is_int($lat) && !is_float($lat) || $lat < -90 || $lat > 90) {
        $pointErrors[] = 'lat : nombre entre -90 et 90 requis.';
      }
      $lng = $point['lng'] ?? NULL;
      if (!is_int($lng) && !is_float($lng) || $lng < -180 || $lng > 180) {
        $pointErrors[] = 'lng : nombre entre -180 et 180 requis.';
      }
      $alt = $this->optionalFloat($point, 'alt', -1000.0, 10000.0, $pointErrors);
      $spd = $this->optionalFloat($point, 'spd', 0.0, 200.0, $pointErrors);
      $brg = $this->optionalFloat($point, 'brg', 0.0, 360.0, $pointErrors);
      $acc = $this->optionalFloat($point, 'acc', 0.0, 10000.0, $pointErrors);
      $hr = $this->optionalInt($point, 'hr', 1, 300, $pointErrors);
      $seg = $this->optionalInt($point, 'seg', 0, 100000, $pointErrors);

      if ($pointErrors !== []) {
        $errors[] = sprintf('points[%d] : %s', $index, implode(' ', $pointErrors));
        continue;
      }
      // Dédoublonnage interne au batch : dernière occurrence gagnante.
      $normalized[$seq] = [
        'sequence' => $seq,
        'timestamp_ms' => $t,
        'lat' => (float) $lat,
        'lng' => (float) $lng,
        'altitude' => $alt,
        'speed' => $spd,
        'bearing' => $brg,
        'accuracy' => $acc,
        'heart_rate' => $hr,
        'segment' => $seg ?? 0,
      ];
    }

    $this->throwIfErrors($errors);
    ksort($normalized);
    return array_values($normalized);
  }

  /**
   * Valide les paramètres de requête de GET /trips.
   *
   * @return array{status: string|null, activity_type: string|null, since: int|null, page: int, limit: int}
   *   Filtres et pagination normalisés.
   */
  public function validateListQuery(Request $request): array {
    $errors = [];

    $status = $request->query->get('status');
    if ($status !== NULL && !in_array($status, self::TRIP_STATUSES, TRUE)) {
      $errors[] = 'status : valeurs autorisées ' . implode('|', self::TRIP_STATUSES) . '.';
    }
    $activityType = $request->query->get('activity_type');
    if ($activityType !== NULL && !in_array($activityType, self::ACTIVITY_TYPES, TRUE)) {
      $errors[] = 'activity_type : valeurs autorisées ' . implode('|', self::ACTIVITY_TYPES) . '.';
    }
    $since = NULL;
    $rawSince = $request->query->get('since');
    if ($rawSince !== NULL) {
      $since = $this->parseTimestamp($rawSince);
      if ($since === NULL) {
        $errors[] = 'since : epoch secondes ou date ISO 8601 attendu.';
      }
    }
    $page = max(0, (int) $request->query->get('page', '0'));
    $limit = (int) $request->query->get('limit', '20');
    if ($limit < 1 || $limit > self::MAX_LIST_LIMIT) {
      $errors[] = sprintf('limit : entier entre 1 et %d attendu.', self::MAX_LIST_LIMIT);
    }

    $this->throwIfErrors($errors);
    return [
      'status' => is_string($status) ? $status : NULL,
      'activity_type' => is_string($activityType) ? $activityType : NULL,
      'since' => $since,
      'page' => $page,
      'limit' => $limit,
    ];
  }

  /**
   * Valide les paramètres de requête de GET /stats/summary.
   *
   * @return array{period: string, activity_type: string|null}
   *   Paramètres normalisés.
   */
  public function validateStatsQuery(Request $request): array {
    $errors = [];

    $period = $request->query->get('period', 'all');
    if (!in_array($period, ['week', 'month', 'all'], TRUE)) {
      $errors[] = 'period : valeurs autorisées week|month|all.';
    }
    $activityType = $request->query->get('activity_type');
    if ($activityType !== NULL && !in_array($activityType, self::ACTIVITY_TYPES, TRUE)) {
      $errors[] = 'activity_type : valeurs autorisées ' . implode('|', self::ACTIVITY_TYPES) . '.';
    }

    $this->throwIfErrors($errors);
    return [
      'period' => $period,
      'activity_type' => is_string($activityType) ? $activityType : NULL,
    ];
  }

  /**
   * Refuse toute clé absente de la liste blanche.
   *
   * @param array<mixed> $payload
   *   Le payload décodé.
   * @param list<string> $allowed
   *   Les clés autorisées.
   */
  private function rejectUnknownKeys(array $payload, array $allowed, string $context = ''): void {
    $unknown = array_diff(array_keys($payload), $allowed);
    if ($unknown !== []) {
      $prefix = $context === '' ? '' : $context . ' : ';
      throw new UnprocessableEntityHttpException(sprintf('%sclés inconnues : %s.', $prefix, implode(', ', $unknown)));
    }
  }

  /**
   * Lève une 422 avec la liste des erreurs accumulées.
   *
   * @param list<string> $errors
   *   Les erreurs accumulées.
   */
  private function throwIfErrors(array $errors): void {
    if ($errors !== []) {
      throw new UnprocessableEntityHttpException(implode(' ', $errors));
    }
  }

  /**
   * Valide une chaîne optionnelle (NULL si absente).
   *
   * @param array<mixed> $payload
   *   Le payload décodé.
   * @param list<string> $errors
   *   Accumulateur d'erreurs.
   */
  private function optionalString(array $payload, string $key, int $maxLength, array &$errors): ?string {
    if (!array_key_exists($key, $payload) || $payload[$key] === NULL) {
      return NULL;
    }
    if (!is_string($payload[$key]) || mb_strlen($payload[$key]) > $maxLength) {
      $errors[] = sprintf('%s : chaîne de %d caractères maximum attendue.', $key, $maxLength);
      return NULL;
    }
    return $payload[$key];
  }

  /**
   * Valide un entier optionnel borné (NULL si absent).
   *
   * @param array<mixed> $payload
   *   Le payload décodé.
   * @param list<string> $errors
   *   Accumulateur d'erreurs.
   */
  private function optionalInt(array $payload, string $key, int $min, int $max, array &$errors): ?int {
    if (!array_key_exists($key, $payload) || $payload[$key] === NULL) {
      return NULL;
    }
    if (!is_int($payload[$key]) || $payload[$key] < $min || $payload[$key] > $max) {
      $errors[] = sprintf('%s : entier entre %d et %d attendu.', $key, $min, $max);
      return NULL;
    }
    return $payload[$key];
  }

  /**
   * Valide un nombre optionnel borné (NULL si absent).
   *
   * @param array<mixed> $payload
   *   Le payload décodé.
   * @param list<string> $errors
   *   Accumulateur d'erreurs.
   */
  private function optionalFloat(array $payload, string $key, float $min, float $max, array &$errors): ?float {
    if (!array_key_exists($key, $payload) || $payload[$key] === NULL) {
      return NULL;
    }
    if (!is_int($payload[$key]) && !is_float($payload[$key]) || $payload[$key] < $min || $payload[$key] > $max) {
      $errors[] = sprintf('%s : nombre entre %s et %s attendu.', $key, (string) $min, (string) $max);
      return NULL;
    }
    return (float) $payload[$key];
  }

  /**
   * Valide un timestamp optionnel (NULL si absent).
   *
   * @param array<mixed> $payload
   *   Le payload décodé.
   * @param list<string> $errors
   *   Accumulateur d'erreurs.
   */
  private function optionalTimestamp(array $payload, string $key, array &$errors): ?int {
    if (!array_key_exists($key, $payload) || $payload[$key] === NULL) {
      return NULL;
    }
    $timestamp = $this->parseTimestamp($payload[$key]);
    if ($timestamp === NULL) {
      $errors[] = sprintf('%s : epoch secondes ou date ISO 8601 attendu.', $key);
    }
    return $timestamp;
  }

  /**
   * Normalise un timestamp : epoch secondes (int) ou date ISO 8601 (string).
   */
  private function parseTimestamp(mixed $value): ?int {
    if (is_int($value) && $value > 0) {
      return $value;
    }
    if (is_string($value) && $value !== '') {
      if (ctype_digit($value)) {
        return (int) $value;
      }
      try {
        return (new \DateTimeImmutable($value))->getTimestamp();
      }
      catch (\Exception) {
        return NULL;
      }
    }
    return NULL;
  }

}
