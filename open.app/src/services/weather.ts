/**
 * Météo au point de départ — Open-Meteo (gratuit, sans clé).
 *
 * L'iPhone n'a pas de capteur de température ambiante : la seule source est
 * une API météo. Une seule tentative, best effort (offline → pas de météo,
 * jamais bloquant pour l'enregistrement).
 */

export type CurrentWeather = {
  /** °C. */
  temperature: number;
  /** Code WMO (0 = ciel clair… 99 = orage grêle). */
  weatherCode: number;
  /** m/s. */
  windSpeed: number;
};

const TIMEOUT_MS = 8000;

export async function fetchCurrentWeather(lat: number, lng: number): Promise<CurrentWeather | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      '&current=temperature_2m,weather_code,wind_speed_10m&wind_speed_unit=ms';
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number };
    };
    const current = payload.current;
    if (
      current === undefined ||
      typeof current.temperature_2m !== 'number' ||
      typeof current.weather_code !== 'number' ||
      typeof current.wind_speed_10m !== 'number'
    ) {
      return null;
    }
    return {
      temperature: current.temperature_2m,
      weatherCode: current.weather_code,
      windSpeed: current.wind_speed_10m,
    };
  } catch (e) {
    console.warn('opencar: météo indisponible', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Libellé FR d'un code météo WMO (groupes principaux). */
export function weatherLabel(code: number): string {
  if (code === 0) return 'Ciel clair';
  if (code <= 2) return 'Peu nuageux';
  if (code === 3) return 'Couvert';
  if (code <= 48) return 'Brouillard';
  if (code <= 57) return 'Bruine';
  if (code <= 67) return 'Pluie';
  if (code <= 77) return 'Neige';
  if (code <= 82) return 'Averses';
  if (code <= 86) return 'Averses de neige';
  return 'Orage';
}

/** Icône Ionicons correspondant au code WMO. */
export function weatherIcon(code: number): string {
  if (code === 0) return 'sunny-outline';
  if (code <= 2) return 'partly-sunny-outline';
  if (code === 3) return 'cloud-outline';
  if (code <= 48) return 'reorder-two-outline';
  if (code <= 67) return 'rainy-outline';
  if (code <= 77) return 'snow-outline';
  if (code <= 86) return 'rainy-outline';
  return 'thunderstorm-outline';
}
