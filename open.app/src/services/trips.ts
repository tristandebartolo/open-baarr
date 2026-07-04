/**
 * Accès typé aux endpoints trajets & stats de l'API opencar.
 *
 * Les formes JSON suivent TripNormalizer et TripStatsService côté Drupal
 * (distances en mètres, durées en secondes, vitesses en m/s, timestamps en
 * secondes epoch).
 */

import { apiFetch } from '@/services/api';
import type { ActivityType, TripStatus } from '@/db/schema';

export type TripMetrics = {
  distance: number | null;
  duration: number | null;
  duration_total: number | null;
  elevation_gain: number | null;
  elevation_loss: number | null;
  speed_avg: number | null;
  speed_max: number | null;
};

export type TripHealth = {
  heart_rate_avg: number | null;
  heart_rate_max: number | null;
  steps: number | null;
  calories: number | null;
  weight: number | null;
  hydration: number | null;
  feeling: number | null;
  fatigue: number | null;
};

export type TripSummary = {
  uuid: string;
  title: string;
  activity_type: ActivityType | null;
  status: TripStatus | null;
  started_at: number | null;
  ended_at: number | null;
  metrics: TripMetrics;
  health: TripHealth;
  created: number;
  changed: number;
};

export type TripPhoto = {
  id: number;
  uuid: string;
  url: string;
};

export type TripDetail = TripSummary & {
  body: string | null;
  diagnostic: {
    battery_start: number | null;
    battery_end: number | null;
    device_info: string | null;
  };
  points_count: number;
  photos: TripPhoto[];
};

export type TripListResponse = {
  items: TripSummary[];
  page: number;
  limit: number;
  total: number;
};

export type StatsPeriod = 'week' | 'month' | 'all';

export type StatsSummary = {
  period: StatsPeriod;
  activity_type: ActivityType | null;
  totals: {
    trips: number;
    distance: number;
    duration: number;
    duration_total: number;
    elevation_gain: number;
  };
  records: {
    longest_distance: number;
    max_speed: number;
    longest_duration: number;
  };
  series: { date: string; distance: number; duration: number }[];
};

/** Champs de santé manuelle modifiables depuis l'écran détail. */
export type ManualHealthPatch = Partial<{
  weight: number;
  feeling: number;
  fatigue: number;
  hydration: number;
}>;

export function fetchTrips(options: {
  page?: number;
  limit?: number;
  status?: TripStatus;
}): Promise<TripListResponse> {
  return apiFetch<TripListResponse>('/opencar/api/v1/trips', {
    query: { page: options.page, limit: options.limit, status: options.status },
  });
}

export function fetchTripDetail(uuid: string): Promise<TripDetail> {
  return apiFetch<TripDetail>(`/opencar/api/v1/trips/${uuid}`);
}

export function patchTrip(uuid: string, patch: ManualHealthPatch): Promise<TripDetail> {
  return apiFetch<TripDetail>(`/opencar/api/v1/trips/${uuid}`, { method: 'PATCH', body: patch });
}

export function fetchStatsSummary(
  period: StatsPeriod,
  activityType?: ActivityType,
): Promise<StatsSummary> {
  return apiFetch<StatsSummary>('/opencar/api/v1/stats/summary', {
    query: { period, activity_type: activityType },
  });
}
