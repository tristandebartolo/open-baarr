/**
 * Opérations SQLite partagées entre la tâche GPS (arrière-plan), le service
 * de tracking, l'écran Enregistrer et le moteur de sync.
 *
 * Toutes passent par `getDb()` (connexion + migrations mémoïsées) : elles
 * sont donc sûres à appeler depuis un contexte headless.
 */

import { and, asc, count, desc, eq, gt, inArray, ne, or, sql } from 'drizzle-orm';
import type * as Location from 'expo-location';

import { getDb } from '@/db';
import {
  points,
  trips,
  type ActivityType,
  type NewPointRow,
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
    })
    .where(eq(trips.uuid, trip.uuid));
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
  return db
    .select()
    .from(trips)
    .where(
      or(
        eq(trips.serverCreated, 0),
        eq(trips.pendingMeta, 1),
        and(eq(trips.status, 'completed'), ne(sql`COALESCE(${trips.syncedStatus}, '')`, 'completed')),
        inArray(trips.uuid, withUnsyncedPoints),
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
