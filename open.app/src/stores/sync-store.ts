/**
 * État observable de la synchronisation (écrans Enregistrer, Réglages,
 * liste des trajets). Alimenté par `services/sync.ts`.
 */

import { create } from 'zustand';

type SyncState = {
  syncing: boolean;
  /** Epoch ms de la dernière sync menée à bien (même partielle). */
  lastSyncAt: number | null;
  /** Dernière erreur bloquante (réseau exclu), null si la dernière sync a réussi. */
  lastError: string | null;
  /** Résumé lisible du dernier run (« 250 points, 2 photos », « hors ligne »…). */
  lastResult: string | null;
  setSyncing: (syncing: boolean) => void;
  setResult: (lastSyncAt: number, lastError: string | null, lastResult: string | null) => void;
};

export const useSyncStore = create<SyncState>((set) => ({
  syncing: false,
  lastSyncAt: null,
  lastError: null,
  lastResult: null,
  setSyncing: (syncing) => set({ syncing }),
  setResult: (lastSyncAt, lastError, lastResult) =>
    set({ lastSyncAt, lastError, lastResult, syncing: false }),
}));
