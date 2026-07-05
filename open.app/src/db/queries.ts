/**
 * Opérations SQLite partagées entre la tâche GPS (arrière-plan), le service
 * de tracking, l'écran Enregistrer et le moteur de sync.
 *
 * Toutes passent par `getDb()` (connexion + migrations mémoïsées) : elles
 * sont donc sûres à appeler depuis un contexte headless.
 */

import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type * as Location from 'expo-location';

import { getDb } from '@/db';
import {
  photosQueue,
  points,
  syncMeta,
  trips,
  type ActivityType,
  type NewPointRow,
  type PhotoQueueRow,
  type PointRow,
  type TripRow,
  type TripStatus,
} from '@/db/schema';

// ---------------------------------------------------------------------------
// Cycle de vie du trajet
// ---------------------------------------------------------------------------

export type NewTrip = {
  uuid: string;
  title: string;
  activityType: ActivityType;
  startedAt: number;
  batteryStart: number | null;
  deviceInfo: string | null;
};

export async function insertTrip(newTrip: NewTrip): Promise<TripRow> {
  const db = await getDb();
  const rows = await db
    .insert(trips)
    .values({ ...newTrip, status: 'recording' })
    .returning();
  return rows[0];
}

/** Trajet en cours (recording ou paused), le plus récent d'abord. */
export async function getActiveTrip(): Promise<TripRow | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(trips)
    .where(inArray(trips.status, ['recording', 'paused']))
    .orderBy(desc(trips.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getTrip(uuid: string): Promise<TripRow | null> {
  const db = await getDb();
  const rows = await db.select().from(trips).where(eq(trips.uuid, uuid)).limit(1);
  return rows[0] ?? null;
}

export async function pauseTrip(uuid: string, now: number): Promise<void> {
  const db = await getDb();
  await db
    .update(trips)
    .set({ status: 'paused', pausedAt: now })
    .where(eq(trips.uuid, uuid));
}

/** Reprise après pause : nouveau segment, cumul du temps de pause. */
export async function resumeTrip(trip: TripRow, now: number): Promise<void> {
  const db = await getDb();
  const pausedMs = trip.pausedMs + (trip.pausedAt !== null ? now - trip.pausedAt : 0);
  await db
    .update(trips)
    .set({
      status: 'recording',
      pausedAt: null,
      pausedMs,
      currentSegment: trip.currentSegment + 1,
    })
    .where(eq(trips.uuid, trip.uuid));
}

export async function completeTrip(
  trip: TripRow,
  now: number,
  batteryEnd: number | null,
): Promise<void> {
  const db = await getDb();
  const pausedMs = trip.pausedMs + (trip.pausedAt !== null ? now - trip.pausedAt : 0);
  await db
    .update(trips)
    .set({
      status: 'completed',
      endedAt: now,
      pausedAt: null,
      pausedMs,
      batteryEnd,
      // battery_end (et ended_at de secours) à pousser via PATCH /trips.
      pendingMeta: 1,
      // Trajet rouvert puis terminé avant toute sync : invalide l'acquittement
      // `completed` pour que pushCompletedStatus rejoue le PATCH (recalcul
      // serveur). En SQL : un run de sync a pu changer syncedStatus depuis la
      // lecture de `trip`.
      syncedStatus: sql`CASE WHEN ${trips.syncedStatus} = 'completed' THEN 'recording' ELSE ${trips.syncedStatus} END`,
    })
    .where(eq(trips.uuid, trip.uuid));
}

/**
 * Rouvre un trajet terminé : le temps d'arrêt devient de la pause, la suite
 * de l'enregistrement part sur un nouveau segment. Idempotent (`WHERE
 * status = 'completed'`). `syncedStatus` n'est pas touché : il mémorise
 * l'état connu du serveur, c'est la sync qui renverra `recording`.
 */
export async function reopenTrip(trip: TripRow, now: number): Promise<void> {
  const db = await getDb();
  await db
    .update(trips)
    .set({
      status: 'recording',
      pausedMs: trip.pausedMs + (trip.endedAt !== null ? Math.max(0, now - trip.endedAt) : 0),
      endedAt: null,
      pausedAt: null,
      currentSegment: trip.currentSegment + 1,
      // Périmée, refigée au prochain « Terminer ».
      batteryEnd: null,
    })
    .where(and(eq(trips.uuid, trip.uuid), eq(trips.status, 'completed')));
}

/** Renomme un trajet local (miroir du PATCH title côté serveur). */
export async function updateTripTitle(uuid: string, title: string): Promise<void> {
  const db = await getDb();
  await db.update(trips).set({ title }).where(eq(trips.uuid, uuid));
}

/**
 * Supprime un trajet local ; points et photos_queue suivent par cascade.
 *
 * @returns Les URI locales des photos en file, à purger du disque par
 *   l'appelant (la cascade SQL ne supprime pas les fichiers).
 */
export async function deleteLocalTrip(uuid: string): Promise<string[]> {
  const db = await getDb();
  const photos = await db
    .select({ localUri: photosQueue.localUri })
    .from(photosQueue)
    .where(eq(photosQueue.tripUuid, uuid));
  await db.delete(trips).where(eq(trips.uuid, uuid));
  return photos.map((p) => p.localUri);
}

// ---------------------------------------------------------------------------
// Points (écrits par la tâche GPS)
// ---------------------------------------------------------------------------

/**
 * Normalise un fix expo-location : les valeurs sentinelles invalides du GPS
 * (speed/heading négatifs, accuracy absente) deviennent NULL — le contrat
 * API refuse spd < 0, brg hors 0–360, acc < 0.
 */
function normalizeLocation(
  location: Location.LocationObject,
  tripUuid: string,
  seq: number,
  seg: number,
): NewPointRow {
  const { coords, timestamp } = location;
  return {
    tripUuid,
    seq,
    seg,
    t: Math.round(timestamp),
    lat: coords.latitude,
    lng: coords.longitude,
    alt: coords.altitude,
    spd: coords.speed !== null && coords.speed >= 0 ? coords.speed : null,
    brg: coords.heading !== null && coords.heading >= 0 && coords.heading <= 360
      ? coords.heading
      : null,
    acc: coords.accuracy !== null && coords.accuracy >= 0 ? coords.accuracy : null,
  };
}

/**
 * Ajoute des fixes GPS au trajet en cours d'enregistrement (appelé par la
 * tâche background). Séquence auto-incrémentée à partir du MAX local,
 * segment courant du trajet. Sans trajet `recording`, les fixes tardifs
 * sont ignorés.
 *
 * @returns Le nombre de points écrits.
 */
export async function appendLocations(locations: Location.LocationObject[]): Promise<number> {
  if (locations.length === 0) {
    return 0;
  }
  const db = await getDb();
  const trip = await getActiveTrip();
  if (trip === null || trip.status !== 'recording') {
    return 0;
  }

  const ordered = [...locations].sort((a, b) => a.timestamp - b.timestamp);
  return db.transaction(async (tx) => {
    const [{ maxSeq }] = await tx
      .select({ maxSeq: sql<number>`COALESCE(MAX(${points.seq}), -1)` })
      .from(points)
      .where(eq(points.tripUuid, trip.uuid));
    const rows = ordered.map((location, i) =>
      normalizeLocation(location, trip.uuid, maxSeq + 1 + i, trip.currentSegment),
    );
    await tx.insert(points).values(rows).onConflictDoNothing();
    return rows.length;
  });
}

/** Points d'un trajet au-delà d'un id connu (polling incrémental de l'écran). */
export async function getPointsAfter(tripUuid: string, afterId: number): Promise<PointRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(points)
    .where(and(eq(points.tripUuid, tripUuid), gt(points.id, afterId)))
    .orderBy(asc(points.id));
}

// ---------------------------------------------------------------------------
// Synchronisation
// ---------------------------------------------------------------------------

/** Trajets ayant quelque chose à pousser, plus anciens d'abord (ordre strict). */
export async function getTripsNeedingSync(): Promise<TripRow[]> {
  const db = await getDb();
  const withUnsyncedPoints = db
    .selectDistinct({ uuid: points.tripUuid })
    .from(points)
    .where(eq(points.synced, 0));
  const withUnsyncedPhotos = db
    .selectDistinct({ uuid: photosQueue.tripUuid })
    .from(photosQueue)
    .where(eq(photosQueue.synced, 0));
  return db
    .select()
    .from(trips)
    .where(
      or(
        eq(trips.serverCreated, 0),
        eq(trips.pendingMeta, 1),
        and(eq(trips.status, 'completed'), ne(sql`COALESCE(${trips.syncedStatus}, '')`, 'completed')),
        // Trajet rouvert : le serveur le croit encore `completed`.
        and(inArray(trips.status, ['recording', 'paused']), eq(trips.syncedStatus, 'completed')),
        inArray(trips.uuid, withUnsyncedPoints),
        inArray(trips.uuid, withUnsyncedPhotos),
      ),
    )
    .orderBy(asc(trips.startedAt));
}

export async function getUnsyncedPointsBatch(tripUuid: string, limit: number): Promise<PointRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(points)
    .where(and(eq(points.tripUuid, tripUuid), eq(points.synced, 0)))
    .orderBy(asc(points.seq))
    .limit(limit);
}

export async function countUnsyncedPoints(tripUuid?: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ n: count() })
    .from(points)
    .where(
      tripUuid === undefined
        ? eq(points.synced, 0)
        : and(eq(points.tripUuid, tripUuid), eq(points.synced, 0)),
    );
  return rows[0]?.n ?? 0;
}

export async function markPointsSynced(ids: number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const db = await getDb();
  await db.update(points).set({ synced: 1 }).where(inArray(points.id, ids));
}

export async function updateTripSyncState(
  uuid: string,
  changes: Partial<{
    serverCreated: number;
    syncedStatus: TripStatus;
    pendingMeta: number;
    syncError: string | null;
  }>,
): Promise<void> {
  const db = await getDb();
  await db.update(trips).set(changes).where(eq(trips.uuid, uuid));
}

// ---------------------------------------------------------------------------
// Lecture pour l'écran détail (trajets enregistrés sur cet appareil)
// ---------------------------------------------------------------------------

/** Tous les points d'un trajet local, triés par séquence. */
export async function getTripPoints(tripUuid: string): Promise<PointRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(points)
    .where(eq(points.tripUuid, tripUuid))
    .orderBy(asc(points.seq));
}

// ---------------------------------------------------------------------------
// Santé (fusion HealthKit / Health Connect)
// ---------------------------------------------------------------------------

export type HeartRateSample = {
  /** Epoch ms de la mesure. */
  t: number;
  bpm: number;
};

/**
 * Fusionne des échantillons de fréquence cardiaque aux points d'un trajet :
 * chaque point sans FC reçoit l'échantillon au timestamp le plus proche,
 * dans une tolérance donnée. Les points déjà pourvus ne sont pas modifiés.
 *
 * @returns Le nombre de points mis à jour.
 */
export async function mergeHeartRateSamples(
  tripUuid: string,
  samples: HeartRateSample[],
  toleranceMs = 30000,
): Promise<number> {
  if (samples.length === 0) {
    return 0;
  }
  const db = await getDb();
  const ordered = [...samples].sort((a, b) => a.t - b.t);
  const candidates = await db
    .select({ id: points.id, t: points.t })
    .from(points)
    .where(
      and(
        eq(points.tripUuid, tripUuid),
        isNull(points.hr),
        gte(points.t, ordered[0].t - toleranceMs),
        lte(points.t, ordered[ordered.length - 1].t + toleranceMs),
      ),
    )
    .orderBy(asc(points.t));
  if (candidates.length === 0) {
    return 0;
  }

  // Points et échantillons sont triés : parcours en tandem, O(n + m).
  const byBpm = new Map<number, number[]>();
  let cursor = 0;
  for (const point of candidates) {
    while (cursor + 1 < ordered.length && ordered[cursor + 1].t <= point.t) {
      cursor += 1;
    }
    const before = ordered[cursor];
    const after = cursor + 1 < ordered.length ? ordered[cursor + 1] : null;
    const nearest =
      after !== null && Math.abs(after.t - point.t) < Math.abs(before.t - point.t) ? after : before;
    if (Math.abs(nearest.t - point.t) > toleranceMs) {
      continue;
    }
    const bpm = Math.round(nearest.bpm);
    if (bpm < 1 || bpm > 300) {
      continue;
    }
    const ids = byBpm.get(bpm) ?? [];
    ids.push(point.id);
    byBpm.set(bpm, ids);
  }
  if (byBpm.size === 0) {
    return 0;
  }

  let updated = 0;
  await db.transaction(async (tx) => {
    for (const [bpm, ids] of byBpm) {
      await tx.update(points).set({ hr: bpm }).where(inArray(points.id, ids));
      updated += ids.length;
    }
  });
  return updated;
}

/**
 * Fige le résumé santé capteurs sur le trajet (fin d'enregistrement) et le
 * marque à pousser via PATCH /trips (`pendingMeta`).
 */
export async function setTripHealthSummary(
  uuid: string,
  summary: Partial<{
    hrAvg: number | null;
    hrMax: number | null;
    steps: number | null;
    calories: number | null;
  }>,
): Promise<void> {
  const db = await getDb();
  await db
    .update(trips)
    .set({ ...summary, pendingMeta: 1 })
    .where(eq(trips.uuid, uuid));
}

/**
 * Fige la météo du départ sur le trajet (une fois, au premier fix) et la
 * marque à pousser via PATCH /trips (`pendingMeta`).
 */
export async function setTripWeather(
  uuid: string,
  weather: { temperature: number; weatherCode: number; windSpeed: number },
): Promise<void> {
  const db = await getDb();
  await db
    .update(trips)
    .set({ ...weather, pendingMeta: 1 })
    .where(eq(trips.uuid, uuid));
}

/** FC moyenne/max calculées sur les points locaux d'un trajet (bpm, NULL sans FC). */
export async function getTripHeartRateStats(
  tripUuid: string,
): Promise<{ hrAvg: number | null; hrMax: number | null }> {
  const db = await getDb();
  const [row] = await db
    .select({
      hrAvg: sql<number | null>`ROUND(AVG(${points.hr}))`,
      hrMax: sql<number | null>`MAX(${points.hr})`,
    })
    .from(points)
    .where(and(eq(points.tripUuid, tripUuid), sql`${points.hr} IS NOT NULL`));
  return { hrAvg: row?.hrAvg ?? null, hrMax: row?.hrMax ?? null };
}

// ---------------------------------------------------------------------------
// File d'upload des photos
// ---------------------------------------------------------------------------

export async function enqueuePhoto(photo: {
  tripUuid: string;
  localUri: string;
  lat: number | null;
  lng: number | null;
  description: string | null;
  copyright: string | null;
  takenAt: number;
}): Promise<void> {
  const db = await getDb();
  await db.insert(photosQueue).values(photo);
}

export async function getUnsyncedPhotos(tripUuid: string): Promise<PhotoQueueRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(photosQueue)
    .where(and(eq(photosQueue.tripUuid, tripUuid), eq(photosQueue.synced, 0)))
    .orderBy(asc(photosQueue.id));
}

export async function countUnsyncedPhotos(tripUuid?: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ n: count() })
    .from(photosQueue)
    .where(
      tripUuid === undefined
        ? eq(photosQueue.synced, 0)
        : and(eq(photosQueue.tripUuid, tripUuid), eq(photosQueue.synced, 0)),
    );
  return rows[0]?.n ?? 0;
}

export async function markPhotoSynced(id: number): Promise<void> {
  const db = await getDb();
  await db.update(photosQueue).set({ synced: 1, lastError: null }).where(eq(photosQueue.id, id));
}

export async function recordPhotoError(id: number, error: string): Promise<void> {
  const db = await getDb();
  await db
    .update(photosQueue)
    .set({ lastError: error.slice(0, 500), attempts: sql`${photosQueue.attempts} + 1` })
    .where(eq(photosQueue.id, id));
}

// ---------------------------------------------------------------------------
// Clés/valeurs persistées (préférences, diagnostics) — table sync_meta
// ---------------------------------------------------------------------------

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select().from(syncMeta).where(eq(syncMeta.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db
    .insert(syncMeta)
    .values({ key, value })
    .onConflictDoUpdate({ target: syncMeta.key, set: { value } });
}
