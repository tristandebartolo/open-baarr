/**
 * Utilitaires partagés des graphes victory-native (Skia).
 *
 * Les axes de victory-native exigent une SkFont : `matchFont` évite
 * d'embarquer un fichier de police (fonte système par plateforme).
 */

import { matchFont, type SkFont } from '@shopify/react-native-skia';
import { Platform } from 'react-native';

export function chartFont(fontSize = 11): SkFont {
  return matchFont({
    fontFamily: Platform.select({ ios: 'Helvetica', default: 'sans-serif' }),
    fontSize,
  });
}

/**
 * Sous-échantillonne une série pour les courbes (les tracés d'un trajet
 * peuvent dépasser 10 000 points ; ~200 suffisent à l'écran).
 */
export function downsample<T>(items: T[], target = 200): T[] {
  if (items.length <= target) {
    return items;
  }
  const step = items.length / target;
  const out: T[] = [];
  for (let i = 0; i < target; i += 1) {
    out.push(items[Math.floor(i * step)]);
  }
  const last = items[items.length - 1];
  if (out[out.length - 1] !== last) {
    out.push(last);
  }
  return out;
}
