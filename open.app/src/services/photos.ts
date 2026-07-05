/**
 * Photos de trajet : capture (appareil) ou choix (bibliothèque), copie dans
 * le répertoire documents de l'app (l'URI caméra vit dans le cache,
 * purgeable), puis mise en file `photos_queue` — l'upload effectif
 * (POST /photos, multipart) est l'étape 5 du moteur de sync, rejouable.
 *
 * Une photo prise à l'appareil est aussi enregistrée dans la pellicule du
 * téléphone (expo-media-library, permission « ajout seulement ») — sinon
 * elle n'existerait que dans les données de l'app.
 *
 * La géolocalisation (dernier fix GPS), la description et le copyright
 * accompagnent la photo : le serveur les persiste sur le media image
 * (field_coordinates, field_description, field_copyright).
 */

import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Directory, File, Paths } from 'expo-file-system';

import { enqueuePhoto } from '@/db/queries';

export type PhotoPickResult =
  | { status: 'ok'; asset: ImagePicker.ImagePickerAsset }
  | { status: 'canceled' }
  | { status: 'permission-denied' };

/** Métadonnées saisies dans le mini-formulaire photo. */
export type PhotoMeta = {
  description: string | null;
  copyright: string | null;
};

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

/** Enregistre la photo dans la pellicule du téléphone (best effort). */
async function saveToCameraRoll(uri: string): Promise<void> {
  try {
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (permission.granted) {
      await MediaLibrary.saveToLibraryAsync(uri);
    }
  } catch (e) {
    console.warn('opencar: enregistrement dans la pellicule impossible', e);
  }
}

/** Prend une photo avec l'appareil (et la sauve dans la pellicule). */
export async function takeTripPhoto(): Promise<PhotoPickResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return { status: 'permission-denied' };
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.8,
    exif: false,
  });
  if (result.canceled || result.assets.length === 0) {
    return { status: 'canceled' };
  }
  await saveToCameraRoll(result.assets[0].uri);
  return { status: 'ok', asset: result.assets[0] };
}

/** Choisit une photo dans la bibliothèque (onglet Galerie du détail). */
export async function pickLibraryPhoto(): Promise<PhotoPickResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return { status: 'permission-denied' };
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.9,
  });
  if (result.canceled || result.assets.length === 0) {
    return { status: 'canceled' };
  }
  return { status: 'ok', asset: result.assets[0] };
}

/**
 * Copie la photo dans les documents de l'app et la met en file d'upload
 * pour le trajet (envoyée par la sync avec ses métadonnées).
 */
export async function queueTripPhoto(
  tripUuid: string,
  asset: ImagePicker.ImagePickerAsset,
  position: { lat: number; lng: number } | null,
  meta: PhotoMeta,
): Promise<void> {
  const source = new File(asset.uri);
  const target = new File(photosDirectory(), localName(tripUuid, asset.uri));
  await source.copy(target);
  await enqueuePhoto({
    tripUuid,
    localUri: target.uri,
    lat: position?.lat ?? null,
    lng: position?.lng ?? null,
    description: meta.description,
    copyright: meta.copyright,
    takenAt: Date.now(),
  });
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
