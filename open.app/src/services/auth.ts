/**
 * Authentification : validation des identifiants via GET /me,
 * persistance dans SecureStore (chiffré : Keychain iOS / Keystore Android).
 */

import * as SecureStore from 'expo-secure-store';

import { apiFetch, type Credentials } from '@/services/api';

const KEYS = {
  serverUrl: 'opencar.server_url',
  username: 'opencar.username',
  password: 'opencar.password',
} as const;

export type MeProfile = {
  uid: number;
  name: string;
  mail: string;
  roles: string[];
  permissions: {
    record: boolean;
    admin: boolean;
  };
};

/**
 * Normalise l'URL serveur saisie : trim, suppression du slash final,
 * https:// obligatoire (identifiants transmis à chaque requête).
 */
export function normalizeServerUrl(input: string): string {
  const url = input.trim().replace(/\/+$/, '');
  if (url === '') {
    throw new Error('URL du serveur requise.');
  }
  if (!/^https:\/\/.+/i.test(url)) {
    throw new Error('L’URL du serveur doit commencer par https://');
  }
  return url;
}

/** GET /opencar/api/v1/me — profil + rôles de l'utilisateur authentifié. */
export function fetchMe(credentials?: Credentials): Promise<MeProfile> {
  return apiFetch<MeProfile>('/opencar/api/v1/me', { credentials });
}

export async function loadStoredCredentials(): Promise<Credentials | null> {
  const [serverUrl, username, password] = await Promise.all([
    SecureStore.getItemAsync(KEYS.serverUrl),
    SecureStore.getItemAsync(KEYS.username),
    SecureStore.getItemAsync(KEYS.password),
  ]);
  if (!serverUrl || !username || !password) {
    return null;
  }
  return { serverUrl, username, password };
}

export async function persistCredentials(credentials: Credentials): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.serverUrl, credentials.serverUrl),
    SecureStore.setItemAsync(KEYS.username, credentials.username),
    SecureStore.setItemAsync(KEYS.password, credentials.password),
  ]);
}

export async function clearStoredCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.serverUrl),
    SecureStore.deleteItemAsync(KEYS.username),
    SecureStore.deleteItemAsync(KEYS.password),
  ]);
}
