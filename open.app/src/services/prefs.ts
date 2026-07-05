/**
 * Préférences persistées de l'app (table SQLite `sync_meta`, clé/valeur) :
 * options de la carte (orientation, type, zoom) et repli du panneau
 * d'enregistrement. Typées et validées à la lecture — une valeur inconnue
 * retombe sur le défaut.
 */

import { getMeta, setMeta } from '@/db/queries';

export type MapOrientation = 'north' | 'course';
export type MapKind = 'standard' | 'satellite' | 'hybrid';

export type MapPrefs = {
  orientation: MapOrientation;
  mapType: MapKind;
  /** Altitude caméra Apple Maps (m) — c'est le « zoom » persisté. */
  altitude: number;
};

const DEFAULT_ALTITUDE = 2500;

export async function loadMapPrefs(): Promise<MapPrefs> {
  const [orientation, mapType, altitude] = await Promise.all([
    getMeta('map.orientation'),
    getMeta('map.type'),
    getMeta('map.altitude'),
  ]);
  const parsedAltitude = altitude !== null ? Number(altitude) : Number.NaN;
  return {
    orientation: orientation === 'course' ? 'course' : 'north',
    mapType: mapType === 'satellite' || mapType === 'hybrid' ? mapType : 'standard',
    altitude:
      Number.isFinite(parsedAltitude) && parsedAltitude >= 100 && parsedAltitude <= 500000
        ? parsedAltitude
        : DEFAULT_ALTITUDE,
  };
}

export function saveMapOrientation(orientation: MapOrientation): void {
  void setMeta('map.orientation', orientation);
}

export function saveMapType(mapType: MapKind): void {
  void setMeta('map.type', mapType);
}

export function saveMapAltitude(altitude: number): void {
  if (Number.isFinite(altitude) && altitude > 0) {
    void setMeta('map.altitude', String(Math.round(altitude)));
  }
}

export async function loadPanelCollapsed(): Promise<boolean> {
  return (await getMeta('record.collapsed')) === '1';
}

export function savePanelCollapsed(collapsed: boolean): void {
  void setMeta('record.collapsed', collapsed ? '1' : '0');
}
