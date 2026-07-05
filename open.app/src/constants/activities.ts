/**
 * Types d'activité : labels FR et profils GPS.
 *
 * Les clés suivent les `allowed_values` de `field_activity_type` côté Drupal
 * (`car|motorcycle|running|walking|hiking`) — même contrat que l'API.
 */

import * as Location from 'expo-location';

import type { ActivityType } from '@/db/schema';

export const ACTIVITY_TYPES: ActivityType[] = ['car', 'motorcycle', 'running', 'walking', 'hiking'];

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  car: 'Voiture',
  motorcycle: 'Moto',
  running: 'Course',
  walking: 'Marche',
  hiking: 'Rando',
};

export const ACTIVITY_ICONS: Record<ActivityType, string> = {
  car: 'car',
  motorcycle: 'bicycle',
  running: 'walk',
  walking: 'footsteps',
  hiking: 'trail-sign',
};

/**
 * Couleur signature par activité (icônes, pastilles, polylines).
 * Pastille de fond : suffixer l'alpha hex, ex. `ACTIVITY_COLORS[type] + '22'`.
 */
export const ACTIVITY_COLORS: Record<ActivityType, string> = {
  car: '#208AEF',
  motorcycle: '#E8890C',
  running: '#E25C4A',
  walking: '#2E9E6B',
  hiking: '#7A5AF8',
};

export type GpsProfile = {
  accuracy: Location.Accuracy;
  /** Intervalle mini entre deux fixes (ms) — honoré par Android uniquement. */
  timeInterval: number;
  /** Distance mini entre deux fixes (m) — iOS et Android. */
  distanceInterval: number;
  /** Optimisation du GPS iOS selon le type de déplacement. */
  activityType: Location.ActivityType;
};

/** Fréquences du plan : voiture/moto ≈ 3 s / 20 m ; course/marche/rando ≈ 1 s / 5 m. */
export const GPS_PROFILES: Record<ActivityType, GpsProfile> = {
  car: {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 3000,
    distanceInterval: 20,
    activityType: Location.ActivityType.AutomotiveNavigation,
  },
  motorcycle: {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 3000,
    distanceInterval: 20,
    activityType: Location.ActivityType.AutomotiveNavigation,
  },
  running: {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 5,
    activityType: Location.ActivityType.Fitness,
  },
  walking: {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 5,
    activityType: Location.ActivityType.Fitness,
  },
  hiking: {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 5,
    activityType: Location.ActivityType.Fitness,
  },
};
