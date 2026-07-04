/** Formatage FR des grandeurs affichées (distance, durée, vitesse). */

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2).replace('.', ',')} km`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** m/s → km/h affiché. */
export function formatSpeed(speedMs: number | null): string {
  if (speedMs === null) {
    return '—';
  }
  return `${(speedMs * 3.6).toFixed(1).replace('.', ',')} km/h`;
}
