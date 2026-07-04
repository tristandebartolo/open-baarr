/**
 * Export et lecture GPX.
 *
 * - `shareTripGpx` : télécharge le GPX du trajet (GET /gpx, la seule route
 *   sans `_format: json`), l'écrit dans le cache et ouvre la feuille de
 *   partage système.
 * - `parseGpx` : parse le GPX produit par GpxGenerator (Drupal) pour
 *   reconstruire tracé et courbes quand les points ne sont pas en SQLite
 *   (trajet enregistré sur un autre appareil). Le format est le nôtre :
 *   un <trkseg> par segment, <ele>/<time> optionnels, FC dans
 *   l'extension Garmin <gpxtpx:hr>.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { apiFetchText } from '@/services/api';

export type GpxPoint = {
  lat: number;
  lng: number;
  /** Altitude m (null si absente du GPX). */
  alt: number | null;
  /** Epoch ms (null si absent). */
  t: number | null;
  /** Fréquence cardiaque bpm. */
  hr: number | null;
  /** Index du <trkseg> d'origine. */
  seg: number;
};

/** Télécharge le GPX d'un trajet et ouvre le partage système. */
export async function shareTripGpx(uuid: string, title: string): Promise<void> {
  const gpx = await apiFetchText(`/opencar/api/v1/trips/${uuid}/gpx`);
  const basename = `${title.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || 'trajet'}.gpx`;
  const file = new File(Paths.cache, basename);
  if (file.exists) {
    file.delete();
  }
  file.write(gpx);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/gpx+xml',
    dialogTitle: title,
    UTI: 'com.topografix.gpx',
  });
}

/** Télécharge et parse le tracé d'un trajet distant. */
export async function fetchTripTrack(uuid: string): Promise<GpxPoint[]> {
  return parseGpx(await apiFetchText(`/opencar/api/v1/trips/${uuid}/gpx`));
}

const TRKSEG_RE = /<trkseg>([\s\S]*?)<\/trkseg>/g;
const TRKPT_RE = /<trkpt\s+lat="(-?[\d.]+)"\s+lon="(-?[\d.]+)"\s*>([\s\S]*?)<\/trkpt>/g;

export function parseGpx(xml: string): GpxPoint[] {
  const points: GpxPoint[] = [];
  let seg = 0;
  for (const segMatch of xml.matchAll(TRKSEG_RE)) {
    for (const ptMatch of segMatch[1].matchAll(TRKPT_RE)) {
      const inner = ptMatch[3];
      const ele = /<ele>(-?[\d.]+)<\/ele>/.exec(inner);
      const time = /<time>([^<]+)<\/time>/.exec(inner);
      const hr = /<gpxtpx:hr>(\d+)<\/gpxtpx:hr>/.exec(inner);
      const t = time !== null ? Date.parse(time[1]) : Number.NaN;
      points.push({
        lat: Number(ptMatch[1]),
        lng: Number(ptMatch[2]),
        alt: ele !== null ? Number(ele[1]) : null,
        t: Number.isNaN(t) ? null : t,
        hr: hr !== null ? Number(hr[1]) : null,
        seg,
      });
    }
    seg += 1;
  }
  return points;
}
