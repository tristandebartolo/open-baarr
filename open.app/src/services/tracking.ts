/**
 * Cycle de vie de l'enregistrement GPS : permissions, création du trajet
 * local, démarrage/arrêt des mises à jour de localisation en arrière-plan.
 *
 * L'état persistant vit en SQLite (source de vérité) : si l'app est tuée
 * pendant un enregistrement, `recoverActiveTrip()` retrouve le trajet actif
 * au démarrage suivant et relance le suivi si nécessaire.
 */

import * as Battery from 'expo-battery';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Location from 'expo-location';

import { ACTIVITY_LABELS, GPS_PROFILES } from '@/constants/activities';
import {
  completeTrip,
  getActiveTrip,
  insertTrip,
  pauseTrip,
  resumeTrip,
} from '@/db/queries';
import type { ActivityType, TripRow } from '@/db/schema';
import { LOCATION_TASK } from '@/tasks/locationTask';

export type StartResult = {
  trip: TripRow;
  /** false : permission « Toujours » refusée — suivi limité à l'app ouverte. */
  backgroundGranted: boolean;
};

/** Batterie en % entier 0–100, NULL si indisponible (simulateur iOS). */
async function batteryPercent(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    return level >= 0 ? Math.round(level * 100) : null;
  } catch {
    return null;
  }
}

/** Ex. « iPhone 16 Pro · iOS 18.2 » (≤ 255 caractères côté API). */
function deviceInfo(): string {
  const parts = [Device.modelName, [Device.osName, Device.osVersion].filter(Boolean).join(' ')]
    .filter((part): part is string => typeof part === 'string' && part !== '');
  return parts.join(' · ').slice(0, 255) || 'appareil inconnu';
}

function tripTitle(activityType: ActivityType, startedAt: number): string {
  const d = new Date(startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${ACTIVITY_LABELS[activityType]} du ${date} à ${time}`;
}

async function startLocationUpdates(activityType: ActivityType): Promise<void> {
  const profile = GPS_PROFILES[activityType];
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: profile.accuracy,
    timeInterval: profile.timeInterval,
    distanceInterval: profile.distanceInterval,
    activityType: profile.activityType,
    // L'utilisateur enregistre volontairement : indicateur iOS visible,
    // pas de pause automatique qui trouerait le tracé.
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Trajet en cours',
      notificationBody: 'open.app enregistre votre position.',
      notificationColor: '#208AEF',
    },
  });
}

export async function stopLocationUpdates(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

/**
 * Démarre un enregistrement : permissions → trajet local `recording` →
 * mises à jour de localisation. Jette si la permission de premier plan est
 * refusée ; la permission background refusée n'est pas bloquante (suivi
 * dégradé, signalé à l'appelant).
 */
export async function startRecording(activityType: ActivityType): Promise<StartResult> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) {
    throw new Error('Permission de localisation refusée : impossible d’enregistrer un trajet.');
  }
  const background = await Location.requestBackgroundPermissionsAsync();

  const startedAt = Date.now();
  const trip = await insertTrip({
    uuid: Crypto.randomUUID(),
    title: tripTitle(activityType, startedAt),
    activityType,
    startedAt,
    batteryStart: await batteryPercent(),
    deviceInfo: deviceInfo(),
  });
  await startLocationUpdates(activityType);

  return { trip, backgroundGranted: background.granted };
}

/** Pause : arrêt du GPS (économie batterie), le trajet reste actif. */
export async function pauseRecording(trip: TripRow): Promise<void> {
  await stopLocationUpdates();
  await pauseTrip(trip.uuid, Date.now());
}

/** Reprise : nouveau segment (le tracé serveur fait une LineString par segment). */
export async function resumeRecording(trip: TripRow): Promise<void> {
  await resumeTrip(trip, Date.now());
  await startLocationUpdates(trip.activityType);
}

/** Stop : arrêt du GPS, trajet `completed` localement — la sync pousse tout. */
export async function stopRecording(trip: TripRow): Promise<void> {
  await stopLocationUpdates();
  await completeTrip(trip, Date.now(), await batteryPercent());
}

/**
 * Reprise après relance de l'app : retrouve le trajet actif en SQLite et,
 * s'il est `recording` mais que la tâche GPS ne tourne plus (app tuée),
 * relance les mises à jour.
 */
export async function recoverActiveTrip(): Promise<TripRow | null> {
  const trip = await getActiveTrip();
  if (trip === null) {
    return null;
  }
  if (trip.status === 'recording' && !(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) {
    try {
      await startLocationUpdates(trip.activityType);
    } catch (e) {
      console.warn('opencar: relance du suivi GPS impossible', e);
    }
  }
  return trip;
}
