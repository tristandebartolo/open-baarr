/**
 * Données santé pendant l'enregistrement : HealthKit (iOS) / Health Connect
 * (Android).
 *
 * - Fréquence cardiaque : échantillons lus périodiquement pendant le trajet
 *   et fusionnés aux points GPS par timestamp le plus proche
 *   (`mergeHeartRateSamples`) — ils partent ensuite avec les batches de
 *   points vers Drupal (`hr`).
 * - Pas et calories actives : totaux agrégés sur la fenêtre du trajet à la
 *   fin de l'enregistrement, poussés via PATCH /trips.
 *
 * Les modules natifs sont chargés paresseusement par plateforme (le module
 * de l'autre OS n'est jamais évalué). Toutes les fonctions sont
 * défensives : sans permission ou sans provider santé, elles renvoient
 * null/[] sans jeter — la santé est un enrichissement, jamais un bloqueur.
 */

import { Platform } from 'react-native';

import { type HeartRateSample } from '@/db/queries';

export type HealthSummary = {
  steps: number | null;
  /** Calories actives (kcal). */
  calories: number | null;
};

let permissionsGranted: boolean | null = null;

// ---------------------------------------------------------------------------
// iOS — HealthKit
// ---------------------------------------------------------------------------

const HK_READ_TYPES = [
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
] as const;

async function healthkit() {
  return import('@kingstinct/react-native-healthkit');
}

async function requestIosPermissions(): Promise<boolean> {
  const hk = await healthkit();
  if (!hk.isHealthDataAvailable()) {
    return false;
  }
  // HealthKit ne révèle jamais si la *lecture* a été accordée (secret
  // médical) : requestAuthorization réussit dès que la demande a été
  // présentée. Les requêtes renverront simplement 0 échantillon si refus.
  return hk.requestAuthorization({ toRead: [...HK_READ_TYPES] });
}

async function iosHeartRateSamples(fromMs: number, toMs: number): Promise<HeartRateSample[]> {
  const hk = await healthkit();
  const samples = await hk.queryQuantitySamples('HKQuantityTypeIdentifierHeartRate', {
    filter: { date: { startDate: new Date(fromMs), endDate: new Date(toMs) } },
    unit: 'count/min',
    ascending: true,
    limit: 0,
  });
  return samples.map((s) => ({ t: s.startDate.getTime(), bpm: s.quantity }));
}

async function iosSummary(fromMs: number, toMs: number): Promise<HealthSummary> {
  const hk = await healthkit();
  const filter = { date: { startDate: new Date(fromMs), endDate: new Date(toMs) } };
  const [steps, calories] = await Promise.all([
    hk.queryStatisticsForQuantity('HKQuantityTypeIdentifierStepCount', ['cumulativeSum'], {
      filter,
      unit: 'count',
    }),
    hk.queryStatisticsForQuantity('HKQuantityTypeIdentifierActiveEnergyBurned', ['cumulativeSum'], {
      filter,
      unit: 'kcal',
    }),
  ]);
  return {
    steps: steps.sumQuantity !== undefined ? Math.round(steps.sumQuantity.quantity) : null,
    calories: calories.sumQuantity?.quantity ?? null,
  };
}

// ---------------------------------------------------------------------------
// Android — Health Connect
// ---------------------------------------------------------------------------

async function healthConnect() {
  return import('react-native-health-connect');
}

async function requestAndroidPermissions(): Promise<boolean> {
  const hc = await healthConnect();
  if (!(await hc.initialize())) {
    return false;
  }
  const granted = await hc.requestPermission([
    { accessType: 'read', recordType: 'HeartRate' },
    { accessType: 'read', recordType: 'Steps' },
    { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
  ]);
  return granted.length > 0;
}

async function androidHeartRateSamples(fromMs: number, toMs: number): Promise<HeartRateSample[]> {
  const hc = await healthConnect();
  const { records } = await hc.readRecords('HeartRate', {
    timeRangeFilter: {
      operator: 'between',
      startTime: new Date(fromMs).toISOString(),
      endTime: new Date(toMs).toISOString(),
    },
  });
  return records.flatMap((record) =>
    record.samples.map((s) => ({ t: Date.parse(s.time), bpm: s.beatsPerMinute })),
  );
}

async function androidSummary(fromMs: number, toMs: number): Promise<HealthSummary> {
  const hc = await healthConnect();
  const timeRangeFilter = {
    operator: 'between',
    startTime: new Date(fromMs).toISOString(),
    endTime: new Date(toMs).toISOString(),
  } as const;
  const [steps, calories] = await Promise.all([
    hc.aggregateRecord({ recordType: 'Steps', timeRangeFilter }),
    hc.aggregateRecord({ recordType: 'ActiveCaloriesBurned', timeRangeFilter }),
  ]);
  return {
    steps: Math.round(steps.COUNT_TOTAL),
    calories: calories.ACTIVE_CALORIES_TOTAL.inKilocalories,
  };
}

// ---------------------------------------------------------------------------
// API commune
// ---------------------------------------------------------------------------

/**
 * Demande les permissions santé (une fois par session). Renvoie false si la
 * plateforme n'a pas de provider santé ou si la demande échoue — jamais
 * d'exception.
 */
export async function ensureHealthPermissions(): Promise<boolean> {
  if (permissionsGranted !== null) {
    return permissionsGranted;
  }
  try {
    permissionsGranted =
      Platform.OS === 'ios'
        ? await requestIosPermissions()
        : Platform.OS === 'android'
          ? await requestAndroidPermissions()
          : false;
  } catch (e) {
    console.warn('opencar: permissions santé indisponibles', e);
    permissionsGranted = false;
  }
  return permissionsGranted;
}

/** Échantillons de FC sur une fenêtre, triés par timestamp ([] sans donnée/permission). */
export async function getHeartRateSamples(fromMs: number, toMs: number): Promise<HeartRateSample[]> {
  if (!(await ensureHealthPermissions())) {
    return [];
  }
  try {
    const samples =
      Platform.OS === 'ios'
        ? await iosHeartRateSamples(fromMs, toMs)
        : await androidHeartRateSamples(fromMs, toMs);
    return samples.sort((a, b) => a.t - b.t);
  } catch (e) {
    console.warn('opencar: lecture de la fréquence cardiaque échouée', e);
    return [];
  }
}

/** Totaux pas + calories actives sur la fenêtre du trajet (null sans donnée). */
export async function getHealthSummary(fromMs: number, toMs: number): Promise<HealthSummary> {
  if (!(await ensureHealthPermissions())) {
    return { steps: null, calories: null };
  }
  try {
    return Platform.OS === 'ios' ? await iosSummary(fromMs, toMs) : await androidSummary(fromMs, toMs);
  } catch (e) {
    console.warn('opencar: lecture pas/calories échouée', e);
    return { steps: null, calories: null };
  }
}
