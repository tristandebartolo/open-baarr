/**
 * Photos de trajet : capture (ou choix en galerie) pendant l'enregistrement,
 * copie dans le répertoire documents de l'app (l'URI caméra vit dans le
 * cache, purgeable), puis mise en file `photos_queue` — l'upload effectif
 * (POST /photos, multipart) est l'étape 5 du moteur de sync, rejouable.
 *
 * La géolocalisation (lat/lng du dernier fix GPS) et l'heure de prise de vue
 * accompagnent la photo dans la queue ; le serveur les accepte (l'EXIF porte
 * déjà la position quand l'OS l'autorise).
 */

import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';

import { enqueuePhoto } from '@/db/queries';

export type PhotoCaptureResult = 'queued' | 'canceled' | 'permission-denied';

function photosDirectory(): Directory {
  const dir = new Directory(Paths.document, 'trip-photos');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/** Nom de fichier unique et sain pour la copie locale. */
function localName(tripUuid: string, sourceUri: string): string {
  const ext = /\.(jpe?g|png|webp|gif|heic)$/i.exec(sourceUri)?.[1]?.toLowerCase() ?? 'jpg';
  return `${tripUuid}-${Date.now()}.${ext === 'heic' ? 'jpg' : ext}`;
}

async function persistAndQueue(
  tripUuid: string,
  asset: ImagePicker.ImagePickerAsset,
  position: { lat: number; lng: number } | null,
): Promise<void> {
  const source = new File(asset.uri);
  const target = new File(photosDirectory(), localName(tripUuid, asset.uri));
  await source.copy(target);
  await enqueuePhoto({
    tripUuid,
    localUri: target.uri,
    lat: position?.lat ?? null,
    lng: position?.lng ?? null,
    takenAt: Date.now(),
  });
}

/**
 * Prend une photo avec l'appareil (bouton de l'écran Enregistrer) et la met
 * en file pour le trajet en cours.
 */
export async function captureTripPhoto(
  tripUuid: string,
  position: { lat: number; lng: number } | null,
): Promise<PhotoCaptureResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return 'permission-denied';
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.8,
    exif: false,
  });
  if (result.canceled || result.assets.length === 0) {
    return 'canceled';
  }
  await persistAndQueue(tripUuid, result.assets[0], position);
  return 'queued';
}

/** Supprime la copie locale une fois la photo poussée (best effort). */
export function deleteLocalPhoto(localUri: string): void {
  try {
    const file = new File(localUri);
    if (file.exists) {
      file.delete();
    }
  } catch (e) {
    console.warn('opencar: suppression de la photo locale impossible', e);
  }
}
