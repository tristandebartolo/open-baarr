/**
 * Agrégats du dashboard — fonctions pures (testables hors React Native).
 *
 * Sources : la série journalière de GET /stats/summary et la liste des
 * trajets terminés de GET /trips ; tous les calculs par activité et santé
 * se font côté client, sans requête supplémentaire.
 */

import type { StatsPeriod, StatsSummary, TripSummary } from '@/services/trips';
import type { ActivityType } from '@/db/schema';

export type DayBar = {
  /** « YYYY-MM-DD ». */
  date: string;
  /** Distance du jour en km. */
  km: number;
};

/**
 * Série journalière continue : complète les jours vides de la fenêtre
 * (7/30 derniers jours) — la série serveur ne contient que les jours actifs.
 * En période « all », renvoie la série serveur telle quelle.
 *
 * @param todayIso « YYYY-MM-DD » du jour courant (injecté pour testabilité).
 */
export function fillDailySeries(
  series: StatsSummary['series'],
  period: StatsPeriod,
  todayIso: string,
): DayBar[] {
  const byDate = new Map(series.map((day) => [day.date, day.distance]));
  if (period === 'all') {
    return series.map((day) => ({ date: day.date, km: day.distance / 1000 }));
  }
  const length = period === 'week' ? 7 : 30;
  const out: DayBar[] = [];
  const today = new Date(`${todayIso}T12:00:00Z`);
  for (let i = length - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, km: (byDate.get(iso) ?? 0) / 1000 });
  }
  return out;
}

/** Fenêtre de la période en secondes epoch (null = pas de borne, « all »). */
export function periodStart(period: StatsPeriod, nowEpoch: number): number | null {
  if (period === 'week') {
    return nowEpoch - 7 * 86400;
  }
  if (period === 'month') {
    return nowEpoch - 30 * 86400;
  }
  return null;
}

/** Trajets de la période (mêmes fenêtres glissantes que TripStatsService). */
export function tripsInPeriod(
  trips: TripSummary[],
  period: StatsPeriod,
  nowEpoch: number,
): TripSummary[] {
  const since = periodStart(period, nowEpoch);
  if (since === null) {
    return trips;
  }
  return trips.filter((trip) => trip.started_at !== null && trip.started_at >= since);
}

export type ActivityShare = {
  type: ActivityType;
  distance: number;
  trips: number;
  /** Part de la distance totale, 0..1. */
  share: number;
};

/** Répartition de la distance par activité, triée décroissante. */
export function activityBreakdown(trips: TripSummary[]): ActivityShare[] {
  const byType = new Map<ActivityType, { distance: number; trips: number }>();
  let total = 0;
  for (const trip of trips) {
    if (trip.activity_type === null) {
      continue;
    }
    const distance = trip.metrics.distance ?? 0;
    const entry = byType.get(trip.activity_type) ?? { distance: 0, trips: 0 };
    entry.distance += distance;
    entry.trips += 1;
    byType.set(trip.activity_type, entry);
    total += distance;
  }
  return [...byType.entries()]
    .map(([type, entry]) => ({
      type,
      distance: entry.distance,
      trips: entry.trips,
      share: total > 0 ? entry.distance / total : 0,
    }))
    .sort((a, b) => b.distance - a.distance);
}

export type HealthAggregates = {
  /** Moyenne simple des FC moyennes non nulles (pas de pondération en V1). */
  hrAvg: number | null;
  steps: number | null;
  calories: number | null;
};

/** Agrégats santé de la période (null quand aucune donnée). */
export function healthAggregates(trips: TripSummary[]): HealthAggregates {
  let hrSum = 0;
  let hrCount = 0;
  let steps = 0;
  let hasSteps = false;
  let calories = 0;
  let hasCalories = false;
  for (const trip of trips) {
    if (trip.health.heart_rate_avg !== null) {
      hrSum += trip.health.heart_rate_avg;
      hrCount += 1;
    }
    if (trip.health.steps !== null) {
      steps += trip.health.steps;
      hasSteps = true;
    }
    if (trip.health.calories !== null) {
      calories += trip.health.calories;
      hasCalories = true;
    }
  }
  return {
    hrAvg: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
    steps: hasSteps ? steps : null,
    calories: hasCalories ? Math.round(calories) : null,
  };
}

/** Trajet le plus récent (par started_at, created en secours). */
export function latestTrip(trips: TripSummary[]): TripSummary | null {
  let latest: TripSummary | null = null;
  for (const trip of trips) {
    const at = trip.started_at ?? trip.created;
    const latestAt = latest !== null ? (latest.started_at ?? latest.created) : -1;
    if (at > latestAt) {
      latest = trip;
    }
  }
  return latest;
}
