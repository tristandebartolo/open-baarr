/**
 * État de l'écran Enregistrer (zustand).
 *
 * La source de vérité est SQLite (alimentée par la tâche GPS) : ce store se
 * contente de la refléter — polling 1 s des nouveaux points pour les stats
 * temps réel (distance haversine, durées, vitesse) et le tracé de la carte.
 * Il pilote aussi la sync périodique (60 s) pendant l'enregistrement et la
 * reprise d'un trajet actif après que l'app a été tuée.
 */

import { create } from 'zustand';

import { countUnsyncedPoints, getPointsAfter, getTrip } from '@/db/queries';
import type { ActivityType, PointRow, TripRow } from '@/db/schema';
import { syncNow } from '@/services/sync';
import {
  pauseRecording,
  recoverActiveTrip,
  resumeRecording,
  startRecording,
  stopRecording,
} from '@/services/tracking';
import { haversineMeters } from '@/utils/geo';

export type RecordPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

export type TrackSegment = {
  seg: number;
  coords: { latitude: number; longitude: number }[];
};

type RecordState = {
  phase: RecordPhase;
  trip: TripRow | null;
  /** false : permission « Toujours » refusée, suivi limité à l'app ouverte. */
  backgroundGranted: boolean;
  error: string | null;
  distanceM: number;
  elapsedMs: number;
  movingMs: number;
  /** Vitesse du dernier fix (m/s), null sans fix. */
  speedMs: number | null;
  pointCount: number;
  unsyncedCount: number;
  segments: TrackSegment[];
  lastPoint: PointRow | null;
  start: (activityType: ActivityType) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  /** Reprise d'un trajet actif au démarrage de l'app (app tuée en cours). */
  restore: () => Promise<void>;
};

// Curseurs de lecture incrémentale, hors état React (un seul trajet actif).
let lastPointId = 0;
let lastCoord: { lat: number; lng: number; seg: number } | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

function resetCursors(): void {
  lastPointId = 0;
  lastCoord = null;
}

function stopTimers(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (syncTimer !== null) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

export const useRecordStore = create<RecordState>((set, get) => {
  function durations(trip: TripRow, now: number): { elapsedMs: number; movingMs: number } {
    const elapsedMs = Math.max(0, now - trip.startedAt);
    const currentPause = trip.pausedAt !== null ? now - trip.pausedAt : 0;
    return { elapsedMs, movingMs: Math.max(0, elapsedMs - trip.pausedMs - currentPause) };
  }

  /** Intègre les nouveaux points SQLite : distance, tracé par segment. */
  async function tick(): Promise<void> {
    const { trip, phase } = get();
    if (trip === null || ticking) {
      return;
    }
    ticking = true;
    try {
      const fresh = await getPointsAfter(trip.uuid, lastPointId);
      let { distanceM } = get();
      const segments = get().segments.map((s) => ({ ...s, coords: [...s.coords] }));
      for (const point of fresh) {
        if (lastCoord !== null && lastCoord.seg === point.seg) {
          distanceM += haversineMeters(lastCoord.lat, lastCoord.lng, point.lat, point.lng);
        }
        lastCoord = { lat: point.lat, lng: point.lng, seg: point.seg };
        lastPointId = point.id;
        let segment = segments.find((s) => s.seg === point.seg);
        if (segment === undefined) {
          segment = { seg: point.seg, coords: [] };
          segments.push(segment);
        }
        segment.coords.push({ latitude: point.lat, longitude: point.lng });
      }
      const last = fresh.length > 0 ? fresh[fresh.length - 1] : get().lastPoint;
      set({
        distanceM,
        segments,
        lastPoint: last,
        pointCount: get().pointCount + fresh.length,
        speedMs: phase === 'recording' ? (last?.spd ?? null) : null,
        unsyncedCount: await countUnsyncedPoints(trip.uuid),
        ...durations(trip, Date.now()),
      });
    } catch (e) {
      console.warn('opencar: lecture des points échouée', e);
    } finally {
      ticking = false;
    }
  }

  function startTimers(): void {
    stopTimers();
    pollTimer = setInterval(() => void tick(), 1000);
    // Déclencheur du plan : sync toutes les 60 s pendant l'enregistrement.
    syncTimer = setInterval(() => void syncNow('enregistrement'), 60000);
  }

  return {
    phase: 'idle',
    trip: null,
    backgroundGranted: true,
    error: null,
    distanceM: 0,
    elapsedMs: 0,
    movingMs: 0,
    speedMs: null,
    pointCount: 0,
    unsyncedCount: 0,
    segments: [],
    lastPoint: null,

    start: async (activityType) => {
      if (get().phase !== 'idle') {
        return;
      }
      set({ phase: 'starting', error: null });
      try {
        const { trip, backgroundGranted } = await startRecording(activityType);
        resetCursors();
        set({
          phase: 'recording',
          trip,
          backgroundGranted,
          distanceM: 0,
          elapsedMs: 0,
          movingMs: 0,
          speedMs: null,
          pointCount: 0,
          unsyncedCount: 0,
          segments: [],
          lastPoint: null,
        });
        startTimers();
      } catch (e) {
        set({ phase: 'idle', error: e instanceof Error ? e.message : String(e) });
      }
    },

    pause: async () => {
      const { trip, phase } = get();
      if (trip === null || phase !== 'recording') {
        return;
      }
      await pauseRecording(trip);
      set({ phase: 'paused', trip: await getTrip(trip.uuid), speedMs: null });
    },

    resume: async () => {
      const { trip, phase } = get();
      if (trip === null || phase !== 'paused') {
        return;
      }
      await resumeRecording(trip);
      set({ phase: 'recording', trip: await getTrip(trip.uuid) });
    },

    stop: async () => {
      const { trip, phase } = get();
      if (trip === null || (phase !== 'recording' && phase !== 'paused')) {
        return;
      }
      set({ phase: 'stopping' });
      stopTimers();
      try {
        await stopRecording(trip);
      } finally {
        set({ phase: 'idle', trip: null, speedMs: null });
      }
      // Fin de trajet = déclencheur de sync (points restants + statut completed).
      void syncNow('fin de trajet');
    },

    restore: async () => {
      if (get().phase !== 'idle') {
        return;
      }
      const trip = await recoverActiveTrip();
      if (trip === null) {
        return;
      }
      resetCursors();
      set({
        phase: trip.status === 'paused' ? 'paused' : 'recording',
        trip,
        distanceM: 0,
        pointCount: 0,
        segments: [],
        lastPoint: null,
      });
      await tick();
      startTimers();
    },
  };
});
