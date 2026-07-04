/**
 * État d'authentification global (zustand).
 *
 * Cycle : `restoring` (lecture SecureStore au démarrage) → `signedIn` ou
 * `signedOut`. Le guard de `app/_layout.tsx` route vers les tabs ou le login
 * selon `status`.
 *
 * Offline-first : au démarrage, des identifiants présents suffisent à ouvrir
 * la session ; GET /me valide ensuite en arrière-plan (401 → purge → login,
 * erreur réseau → session conservée).
 */

import { create } from 'zustand';

import { ApiError, setOnUnauthorized, setSessionCredentials } from '@/services/api';
import {
  clearStoredCredentials,
  fetchMe,
  loadStoredCredentials,
  normalizeServerUrl,
  persistCredentials,
  type MeProfile,
} from '@/services/auth';

export type AuthStatus = 'restoring' | 'signedOut' | 'signedIn';

/**
 * Session invalidée côté Drupal. Un mauvais mot de passe ne produit pas de
 * 401 : basic_auth échoue silencieusement, la requête passe en anonyme et
 * /me répond 403 (permission `use opencar api` manquante). Un 403 sur /me
 * équivaut donc à des identifiants révoqués.
 */
function isSessionInvalid(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

type AuthState = {
  status: AuthStatus;
  profile: MeProfile | null;
  serverUrl: string | null;
  username: string | null;
  /** Lit SecureStore au démarrage puis valide la session via GET /me. */
  restore: () => Promise<void>;
  /** Valide les identifiants via GET /me puis les persiste. Jette en cas d'échec. */
  signIn: (serverUrl: string, username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Recharge le profil /me (écran Réglages). */
  refreshProfile: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: 'restoring',
  profile: null,
  serverUrl: null,
  username: null,

  restore: async () => {
    const credentials = await loadStoredCredentials();
    if (credentials === null) {
      set({ status: 'signedOut' });
      return;
    }
    setSessionCredentials(credentials);
    set({
      status: 'signedIn',
      serverUrl: credentials.serverUrl,
      username: credentials.username,
    });
    try {
      const profile = await fetchMe();
      set({ profile });
    } catch (e) {
      if (isSessionInvalid(e)) {
        await useAuthStore.getState().signOut();
      }
      // Erreur réseau → session conservée (offline-first), profil rechargé plus tard.
    }
  },

  signIn: async (serverUrlInput, usernameInput, password) => {
    const credentials = {
      serverUrl: normalizeServerUrl(serverUrlInput),
      username: usernameInput.trim(),
      password,
    };
    let profile: MeProfile;
    try {
      profile = await fetchMe(credentials);
    } catch (e) {
      if (isSessionInvalid(e)) {
        // Le 403 anonyme de Drupal (« permission required ») serait trompeur ici.
        throw new Error('Identifiants refusés, ou compte sans accès à l’application.');
      }
      throw e;
    }
    await persistCredentials(credentials);
    setSessionCredentials(credentials);
    set({
      status: 'signedIn',
      profile,
      serverUrl: credentials.serverUrl,
      username: credentials.username,
    });
  },

  signOut: async () => {
    await clearStoredCredentials();
    setSessionCredentials(null);
    set({ status: 'signedOut', profile: null, serverUrl: null, username: null });
  },

  refreshProfile: async () => {
    try {
      const profile = await fetchMe();
      set({ profile });
    } catch (e) {
      if (isSessionInvalid(e)) {
        await useAuthStore.getState().signOut();
      }
      throw e;
    }
  },
}));

// Identifiants révoqués côté Drupal (401 en cours de session) :
// purge + retour login via le guard.
setOnUnauthorized(() => {
  void useAuthStore.getState().signOut();
});
