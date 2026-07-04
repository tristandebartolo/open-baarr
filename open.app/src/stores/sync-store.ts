/**
 * État observable de la synchronisation (affiché sur l'écran Enregistrer
 * et, plus tard, dans Réglages). Alimenté par `services/sync.ts`.
 */

import { create } from 'zustand';

type SyncState = {
  syncing: boolean;
  /** Epoch ms de la dernière sync menée à bien (même partielle). */
  lastSyncAt: number | null;
  /** Dernière erreur bloquante (réseau exclu), null si la dernière sync a réussi. */
  lastError: string | null;
  setSyncing: (syncing: boolean) => void;
  setResult: (lastSyncAt: number, lastError: string | null) => void;
};

export const useSyncStore = create<SyncState>((set) => ({
  syncing: false,
  lastSyncAt: null,
  lastError: null,
  setSyncing: (syncing) => set({ syncing }),
  setResult: (lastSyncAt, lastError) => set({ lastSyncAt, lastError, syncing: false }),
}));
