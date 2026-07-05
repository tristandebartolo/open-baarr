/**
 * Schéma SQLite local (drizzle) — source de vérité offline-first.
 *
 * Les trajets et points sont écrits ici d'abord (y compris par la tâche GPS
 * en arrière-plan), puis synchronisés vers Drupal par `services/sync.ts` :
 * les colonnes `server_created` / `synced_status` / `pending_meta` (trips)
 * et `synced` (points, photos_queue) portent l'état de cette sync.
 *
 * Idempotence : `trips.uuid` est généré côté client (expo-crypto) et sert de
 * clé d'idempotence pour POST /trips ; les points sont uniques par
 * (trip_uuid, seq) — même contrainte que l'index serveur (trajet, sequence).
 */

import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export type ActivityType = 'car' | 'motorcycle' | 'running' | 'walking' | 'hiking';
export type TripStatus = 'draft' | 'recording' | 'paused' | 'completed';

export const trips = sqliteTable(
  'trips',
  {
    /** UUID v4 généré côté client — clé d'idempotence de POST /trips. */
    uuid: text('uuid').primaryKey(),
    title: text('title').notNull(),
    activityType: text('activity_type').$type<ActivityType>().notNull(),
    status: text('status').$type<TripStatus>().notNull().default('draft'),
    /** Epoch ms. */
    startedAt: integer('started_at_ms').notNull(),
    endedAt: integer('ended_at_ms'),
    /** Segment courant, incrémenté à chaque reprise après pause. */
    currentSegment: integer('current_segment').notNull().default(0),
    /** Temps passé en pause (ms cumulées) — durée en mouvement = écoulé − pausé. */
    pausedMs: integer('paused_ms').notNull().default(0),
    /** Epoch ms de la mise en pause en cours (NULL hors pause). */
    pausedAt: integer('paused_at_ms'),
    /** Batterie 0–100 (NULL si indisponible, ex. simulateur iOS). */
    batteryStart: integer('battery_start'),
    batteryEnd: integer('battery_end'),
    deviceInfo: text('device_info'),
    // --- Santé capteurs (HealthKit / Health Connect), figée à la fin du trajet ---
    /** FC moyenne bpm (NULL si aucune donnée santé). */
    hrAvg: integer('hr_avg'),
    hrMax: integer('hr_max'),
    steps: integer('steps'),
    /** Calories actives (kcal). */
    calories: real('calories'),
    // --- État de synchronisation vers Drupal ---
    /** 1 quand POST /trips a répondu 200/201 pour cet uuid. */
    serverCreated: integer('server_created').notNull().default(0),
    /** Dernier statut acquitté par PATCH /status (NULL = jamais poussé). */
    syncedStatus: text('synced_status').$type<TripStatus>(),
    /** 1 quand des métadonnées (battery_end…) attendent un PATCH /trips. */
    pendingMeta: integer('pending_meta').notNull().default(0),
    /** Dernière erreur de sync non réseau (diagnostic, réessayée au run suivant). */
    syncError: text('sync_error'),
  },
  (table) => [index('idx_trips_status').on(table.status)],
);

export const points = sqliteTable(
  'points',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tripUuid: text('trip_uuid')
      .notNull()
      .references(() => trips.uuid, { onDelete: 'cascade' }),
    /** N° d'ordre croissant par trajet — idempotence des batches serveur. */
    seq: integer('seq').notNull(),
    /** Epoch ms de la capture GPS. */
    t: integer('t_ms').notNull(),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    alt: real('alt'),
    /** m/s (NULL si le fix GPS ne la fournit pas). */
    spd: real('spd'),
    /** Cap 0–360° (NULL si invalide). */
    brg: real('brg'),
    /** Précision horizontale en mètres. */
    acc: real('acc'),
    /** Fréquence cardiaque bpm — alimentée à l'étape 6 (HealthKit/Health Connect). */
    hr: integer('hr'),
    seg: integer('seg').notNull().default(0),
    /** 1 quand le point est acquitté par POST /points/batch (accepted ou duplicate). */
    synced: integer('synced').notNull().default(0),
  },
  (table) => [
    uniqueIndex('idx_points_trip_seq').on(table.tripUuid, table.seq),
    index('idx_points_trip_synced').on(table.tripUuid, table.synced),
  ],
);

/** File d'upload des photos de trajet (consommée à l'étape 6 via POST /photos). */
export const photosQueue = sqliteTable(
  'photos_queue',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tripUuid: text('trip_uuid')
      .notNull()
      .references(() => trips.uuid, { onDelete: 'cascade' }),
    localUri: text('local_uri').notNull(),
    lat: real('lat'),
    lng: real('lng'),
    /** Métadonnées saisies à l'ajout (field_description / field_copyright). */
    description: text('description'),
    copyright: text('copyright'),
    /** Epoch ms de la prise de vue. */
    takenAt: integer('taken_at_ms'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    synced: integer('synced').notNull().default(0),
  },
  (table) => [index('idx_photos_trip_synced').on(table.tripUuid, table.synced)],
);

/** Clés/valeurs de sync (dernière sync réussie, diagnostics…). */
export const syncMeta = sqliteTable('sync_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export type TripRow = typeof trips.$inferSelect;
export type PointRow = typeof points.$inferSelect;
export type NewPointRow = typeof points.$inferInsert;
export type PhotoQueueRow = typeof photosQueue.$inferSelect;
export type NewPhotoQueueRow = typeof photosQueue.$inferInsert;
