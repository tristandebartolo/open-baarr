/**
 * Moteur de synchronisation SQLite → Drupal.
 *
 * Ordre strict par trajet (protocole du plan, partie C) :
 *   1. POST /trips              — idempotent par uuid client (200 rejeu / 201)
 *   1bis. PATCH /trips/status   — `recording` si le trajet a été rouvert
 *                                 (« Reprendre ») alors que le serveur le
 *                                 croyait `completed` (+ ended_at vidé)
 *   2. POST /points/batch       — paquets de 500 triés par seq, rejouables
 *                                 sans doublon (index unique trajet+seq)
 *   3. PATCH /trips             — métadonnées (battery_end, ended_at,
 *                                 santé capteurs hr/steps/calories)
 *   4. PATCH /trips/status      — `completed` seulement quand tous les
 *                                 points sont partis (le serveur recalcule
 *                                 métriques et tracé à ce moment-là)
 *   5. POST /photos             — file photos_queue, multipart, rejouable
 *                                 (photo marquée synced sur 201 seulement ;
 *                                 un échec est noté et retenté au run suivant)
 *
 * Déclencheurs (`initSyncTriggers` + appels directs) : retour du réseau,
 * fin de trajet, ouverture de l'app, toutes les 60 s pendant
 * l'enregistrement.
 *
 * Politique d'erreur :
 * - réseau (status 0) → run abandonné en silence, tout reste local ;
 * - 401 → abandon (le wrapper a purgé la session → écran login) ;
 * - 403 → abandon SANS purge : mot de passe changé OU flood basic_auth
 *   plein — on ne jette jamais les données locales, on réessaiera ;
 * - autre code (409, 422, 5xx) → erreur notée sur le trajet
 *   (`sync_error`), on passe au trajet suivant, retenté au run d'après.
 */

import * as Network from 'expo-network';

import { ApiError, apiFetch, apiUploadFile } from '@/services/api';
import {
  countUnsyncedPoints,
  getTrip,
  getTripsNeedingSync,
  getUnsyncedPhotos,
  getUnsyncedPointsBatch,
  markPhotoSynced,
  markPointsSynced,
  recordPhotoError,
  updateTripSyncState,
} from '@/db/queries';
import type { PhotoQueueRow, PointRow, TripRow } from '@/db/schema';
import { deleteLocalPhoto } from '@/services/photos';
import { useSyncStore } from '@/stores/sync-store';

const BATCH_SIZE = 500;

export type SyncResult = {
  reason: string;
  /** Run non exécuté (hors-ligne, run déjà en cours…). */
  skipped?: 'offline' | 'busy';
  tripsSynced: number;
  pointsSynced: number;
  photosSynced: number;
  /** Erreur ayant interrompu le run (les données locales sont intactes). */
  aborted?: string;
};

/** Payload point pour POST /points/batch — bornes du PayloadValidator Drupal. */
function pointPayload(p: PointRow): Record<string, number> {
  const payload: Record<string, number> = {
    seq: p.seq,
    t: Math.round(p.t),
    lat: p.lat,
    lng: p.lng,
    seg: p.seg,
  };
  if (p.alt !== null && p.alt >= -1000 && p.alt <= 10000) {
    payload.alt = p.alt;
  }
  if (p.spd !== null && p.spd >= 0) {
    payload.spd = Math.min(p.spd, 200);
  }
  if (p.brg !== null && p.brg >= 0 && p.brg <= 360) {
    payload.brg = p.brg;
  }
  if (p.acc !== null && p.acc >= 0) {
    payload.acc = Math.min(p.acc, 10000);
  }
  if (p.hr !== null && p.hr >= 1 && p.hr <= 300) {
    payload.hr = Math.round(p.hr);
  }
  return payload;
}

function toEpochSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/** Erreur qui doit interrompre tout le run (réseau, session). */
function isAbortingError(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 0 || e.status === 401 || e.status === 403);
}

/** 1. Création idempotente du trajet côté serveur. */
async function ensureTripCreated(trip: TripRow): Promise<void> {
  if (trip.serverCreated === 1) {
    return;
  }
  await apiFetch('/opencar/api/v1/trips', {
    method: 'POST',
    body: {
      uuid: trip.uuid,
      title: trip.title,
      activity_type: trip.activityType,
      started_at: toEpochSeconds(trip.startedAt),
      // Toujours `recording` à la création : le passage à `completed` se
      // fait par PATCH /status une fois tous les points poussés, pour que
      // le recalcul serveur voie le trajet complet.
      status: 'recording',
      ...(trip.deviceInfo !== null ? { device_info: trip.deviceInfo } : {}),
      ...(trip.batteryStart !== null ? { battery_start: trip.batteryStart } : {}),
    },
  });
  await updateTripSyncState(trip.uuid, { serverCreated: 1, syncedStatus: 'recording' });
}

/**
 * 1bis. Trajet rouvert localement (« Reprendre ») : le serveur le croit
 * encore `completed`. Renvoie le statut `recording` et vide le `ended_at`
 * périmé (PATCH dédié : pushMeta saute les null). `syncedStatus` n'est
 * remis à `recording` qu'après les 200 — rejouable hors-ligne.
 */
async function pushReopenedStatus(trip: TripRow): Promise<void> {
  if (
    trip.syncedStatus !== 'completed' ||
    (trip.status !== 'recording' && trip.status !== 'paused')
  ) {
    return;
  }
  await apiFetch(`/opencar/api/v1/trips/${trip.uuid}/status`, {
    method: 'PATCH',
    body: { status: 'recording' },
  });
  await apiFetch(`/opencar/api/v1/trips/${trip.uuid}`, {
    method: 'PATCH',
    body: { ended_at: null },
  });
  await updateTripSyncState(trip.uuid, { syncedStatus: 'recording' });
}

/** 2. Points non synchronisés, par paquets de 500 triés par seq. */
async function pushPoints(trip: TripRow): Promise<number> {
  let pushed = 0;
  for (;;) {
    const batch = await getUnsyncedPointsBatch(trip.uuid, BATCH_SIZE);
    if (batch.length === 0) {
      return pushed;
    }
    // `accepted` comme `duplicates` signifient « présent côté serveur » :
    // un batch rejoué après timeout se marque synchronisé pareil.
    await apiFetch<{ accepted: number; duplicates: number }>(
      `/opencar/api/v1/trips/${trip.uuid}/points/batch`,
      { method: 'POST', body: { points: batch.map(pointPayload) } },
    );
    await markPointsSynced(batch.map((p) => p.id));
    pushed += batch.length;
  }
}

/** 3. Métadonnées de fin (battery_end, ended_at de secours, santé capteurs). */
async function pushMeta(trip: TripRow): Promise<void> {
  if (trip.pendingMeta !== 1) {
    return;
  }
  const body = {
    ...(trip.endedAt !== null ? { ended_at: toEpochSeconds(trip.endedAt) } : {}),
    ...(trip.batteryEnd !== null ? { battery_end: trip.batteryEnd } : {}),
    ...(trip.hrAvg !== null ? { heart_rate_avg: trip.hrAvg } : {}),
    ...(trip.hrMax !== null ? { heart_rate_max: trip.hrMax } : {}),
    ...(trip.steps !== null ? { steps: trip.steps } : {}),
    ...(trip.calories !== null ? { calories: trip.calories } : {}),
  };
  if (Object.keys(body).length > 0) {
    await apiFetch(`/opencar/api/v1/trips/${trip.uuid}`, { method: 'PATCH', body });
  }
  await updateTripSyncState(trip.uuid, { pendingMeta: 0 });
}

/** 4. Statut `completed` — déclenche le recalcul serveur (métriques + tracé). */
async function pushCompletedStatus(trip: TripRow): Promise<void> {
  // Relecture fraîche : « Reprendre » a pu rouvrir le trajet pendant que ce
  // run itérait sur un snapshot pris avant — on ne renvoie pas `completed`
  // pour un trajet redevenu actif.
  const fresh = (await getTrip(trip.uuid)) ?? trip;
  if (fresh.status !== 'completed' || fresh.syncedStatus === 'completed') {
    return;
  }
  if ((await countUnsyncedPoints(fresh.uuid)) > 0) {
    // Des points restent à pousser (échec partiel plus haut) : le statut
    // attendra le prochain run pour que la consolidation soit complète.
    return;
  }
  await apiFetch(`/opencar/api/v1/trips/${fresh.uuid}/status`, {
    method: 'PATCH',
    body: {
      status: 'completed',
      ...(fresh.endedAt !== null ? { at: toEpochSeconds(fresh.endedAt) } : {}),
    },
  });
  await updateTripSyncState(fresh.uuid, { syncedStatus: 'completed' });
}

/** Type MIME de la photo à partir de l'extension de sa copie locale. */
function photoMimeType(photo: PhotoQueueRow): string {
  const ext = /\.([a-z0-9]+)$/i.exec(photo.localUri)?.[1]?.toLowerCase() ?? 'jpg';
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
}

/**
 * 5. Upload des photos en attente (une par une, échec non bloquant).
 *
 * Via l'UploadTask natif d'expo-file-system : le fetch d'Expo ne supporte
 * pas la convention RN {uri, name, type} dans FormData.
 */
async function pushPhotos(trip: TripRow): Promise<number> {
  let pushed = 0;
  for (const photo of await getUnsyncedPhotos(trip.uuid)) {
    const fields: Record<string, string> = {};
    if (photo.lat !== null && photo.lng !== null) {
      fields.lat = String(photo.lat);
      fields.lng = String(photo.lng);
    }
    if (photo.description !== null) {
      fields.description = photo.description;
    }
    if (photo.copyright !== null) {
      fields.copyright = photo.copyright;
    }
    if (photo.takenAt !== null) {
      fields.taken_at = String(toEpochSeconds(photo.takenAt));
    }
    try {
      await apiUploadFile(
        `/opencar/api/v1/trips/${trip.uuid}/photos`,
        photo.localUri,
        photoMimeType(photo),
        fields,
      );
      await markPhotoSynced(photo.id);
      deleteLocalPhoto(photo.localUri);
      pushed += 1;
    } catch (e) {
      if (isAbortingError(e)) {
        throw e;
      }
      // 422/413/5xx propre à cette photo : noté, on continue avec les autres.
      await recordPhotoError(photo.id, e instanceof Error ? e.message : String(e));
    }
  }
  return pushed;
}

let currentRun: Promise<SyncResult> | null = null;

/**
 * Lance une synchronisation complète (mutex : un seul run à la fois, un
 * appel pendant un run rend le run en cours).
 */
export function syncNow(reason: string): Promise<SyncResult> {
  if (currentRun !== null) {
    return currentRun;
  }
  currentRun = runSync(reason).finally(() => {
    currentRun = null;
  });
  return currentRun;
}

/** Résumé lisible d'un run pour l'écran Réglages. */
function describeResult(result: SyncResult): string {
  if (result.skipped === 'offline') {
    return 'hors ligne — synchronisation reportée';
  }
  if (result.aborted !== undefined) {
    return `interrompue : ${result.aborted}`;
  }
  return `${result.pointsSynced} point${result.pointsSynced > 1 ? 's' : ''}, ${result.photosSynced} photo${result.photosSynced > 1 ? 's' : ''}, ${result.tripsSynced} trajet${result.tripsSynced > 1 ? 's' : ''}`;
}

async function runSync(reason: string): Promise<SyncResult> {
  const result: SyncResult = { reason, tripsSynced: 0, pointsSynced: 0, photosSynced: 0 };

  const network = await Network.getNetworkStateAsync().catch(() => null);
  if (network !== null && (network.isInternetReachable === false || network.isConnected === false)) {
    const skipped: SyncResult = { ...result, skipped: 'offline' };
    const store = useSyncStore.getState();
    store.setResult(store.lastSyncAt ?? Date.now(), store.lastError, describeResult(skipped));
    return skipped;
  }

  const pending = await getTripsNeedingSync();
  if (pending.length === 0) {
    useSyncStore.getState().setResult(Date.now(), null, 'rien à synchroniser');
    return result;
  }

  const store = useSyncStore.getState();
  store.setSyncing(true);
  let blockingError: string | null = null;

  for (const trip of pending) {
    try {
      await ensureTripCreated(trip);
      await pushReopenedStatus(trip);
      result.pointsSynced += await pushPoints(trip);
      await pushMeta(trip);
      await pushCompletedStatus(trip);
      result.photosSynced += await pushPhotos(trip);
      if (trip.syncError !== null) {
        await updateTripSyncState(trip.uuid, { syncError: null });
      }
      result.tripsSynced += 1;
    } catch (e) {
      if (isAbortingError(e)) {
        // Hors-ligne, session purgée (401) ou 403 (mot de passe changé /
        // flood) : on arrête tout le run, données locales intactes.
        result.aborted = e instanceof Error ? e.message : String(e);
        if (e instanceof ApiError && e.status !== 0) {
          blockingError = result.aborted;
        }
        break;
      }
      // Erreur propre à ce trajet (409 uuid volé, 422…) : notée pour
      // diagnostic, on continue avec les autres trajets.
      const message = e instanceof Error ? e.message : String(e);
      await updateTripSyncState(trip.uuid, { syncError: message.slice(0, 500) });
      console.warn(`opencar: sync du trajet ${trip.uuid} en erreur`, message);
    }
  }

  useSyncStore.getState().setResult(Date.now(), blockingError, describeResult(result));
  return result;
}

let triggersInitialized = false;

/**
 * Déclencheur « retour du réseau » (les autres déclencheurs — ouverture,
 * fin de trajet, période de 60 s en enregistrement — appellent `syncNow`
 * directement). À appeler une fois, au montage du layout racine.
 */
export function initSyncTriggers(): void {
  if (triggersInitialized) {
    return;
  }
  triggersInitialized = true;
  let wasReachable: boolean | null = null;
  Network.addNetworkStateListener((state) => {
    const reachable = (state.isInternetReachable ?? state.isConnected) === true;
    if (reachable && wasReachable === false) {
      void syncNow('retour réseau');
    }
    wasReachable = reachable;
  });
}
