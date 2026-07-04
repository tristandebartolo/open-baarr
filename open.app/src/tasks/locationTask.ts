/**
 * Tâche GPS d'arrière-plan (expo-task-manager).
 *
 * `defineTask` doit s'exécuter au niveau module, dans le scope global :
 * ce fichier est importé pour effet de bord par `src/app/_layout.tsx`, et le
 * bundle entier (donc ce module) est rechargé par l'OS en contexte headless
 * si l'app est relancée pour un événement de localisation.
 *
 * La tâche écrit directement en SQLite (`appendLocations`) : séquence
 * auto-incrémentée, segment courant du trajet. Aucune dépendance au réseau
 * ni à l'état React — la sync vers Drupal est un processus séparé.
 */

import type * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { appendLocations } from '@/db/queries';

export const LOCATION_TASK = 'opencar-location-task';

type LocationTaskData = {
  locations: Location.LocationObject[];
};

TaskManager.defineTask<LocationTaskData>(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn(`opencar: tâche localisation en erreur (${error.message})`);
    return;
  }
  if (!data?.locations?.length) {
    return;
  }
  try {
    await appendLocations(data.locations);
  } catch (e) {
    // Ne jamais laisser la tâche jeter : le point sera re-capturé au fix
    // suivant, et un crash ici tuerait le suivi background.
    console.warn('opencar: écriture des points GPS échouée', e);
  }
});
