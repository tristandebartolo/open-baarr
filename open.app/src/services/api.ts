/**
 * Wrapper fetch pour l'API opencar (Drupal, /opencar/api/v1/*).
 *
 * - Ajoute `Authorization: Basic` sur chaque requête (identifiants SecureStore).
 * - Suffixe `?_format=json` sur toutes les routes JSON — exigence `_format: json`
 *   du routing Drupal. Seule la route GPX se consomme sans (`format: false`).
 * - 401 sur la session courante → handler `onUnauthorized` (purge des
 *   identifiants → retour à l'écran login).
 * - Upload de fichier : UploadTask natif d'expo-file-system (streaming
 *   multipart depuis le disque) — le fetch WinterCG d'Expo ne supporte PAS
 *   la convention RN `{uri, name, type}` dans FormData (« Unsupported
 *   FormDataPart implementation »).
 */

import { File, UploadType } from 'expo-file-system';

export type Credentials = {
  /** URL https:// du serveur, sans slash final. */
  serverUrl: string;
  username: string;
  password: string;
};

export class ApiError extends Error {
  /** Code HTTP ; 0 = erreur réseau (serveur injoignable). */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let sessionCredentials: Credentials | null = null;
let onUnauthorized: (() => void) | null = null;

export function setSessionCredentials(credentials: Credentials | null): void {
  sessionCredentials = credentials;
}

/** Handler appelé quand la session courante reçoit un 401 (identifiants invalidés côté serveur). */
export function setOnUnauthorized(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** Hermes ne fournit pas btoa : encodage base64 maison (UTF-8). */
function base64Encode(input: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  for (const char of input) {
    const cp = char.codePointAt(0) as number;
    if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp < 0x800) {
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    } else if (cp < 0x10000) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else {
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : alphabet[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : alphabet[b2 & 63];
  }
  return out;
}

export function basicAuthHeader(credentials: Credentials): string {
  return `Basic ${base64Encode(`${credentials.username}:${credentials.password}`)}`;
}

export type ApiFetchOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Corps JSON (sérialisé automatiquement). */
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** false pour les routes sans `_format: json` (GPX). */
  format?: boolean;
  /** Identifiants explicites (validation au login) au lieu de ceux de la session. */
  credentials?: Credentials;
};

function buildUrl(
  serverUrl: string,
  path: string,
  query: Record<string, string | number | undefined> | undefined,
  format: boolean,
): string {
  const params = new URLSearchParams();
  if (format) {
    params.set('_format', 'json');
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return `${serverUrl}${path}${qs ? `?${qs}` : ''}`;
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: unknown };
    if (typeof payload.message === 'string' && payload.message !== '') {
      return payload.message;
    }
  } catch {
    // corps non JSON : on retombe sur le statut HTTP
  }
  return `Erreur ${response.status}`;
}

/** Tentatives supplémentaires sur erreur réseau pure (coupure 5G, keep-alive
 * fermé en vol par le serveur…). Sans risque : tous les endpoints sont
 * idempotents (uuid client, index unique des points) — seul un upload photo
 * rejoué après une réponse perdue peut créer un doublon, supprimable depuis
 * la galerie. */
const NETWORK_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rawFetch(
  path: string,
  options: ApiFetchOptions & { accept?: string },
): Promise<Response> {
  const credentials = options.credentials ?? sessionCredentials;
  if (!credentials) {
    throw new ApiError(401, 'Aucun identifiant enregistré.');
  }

  const url = buildUrl(credentials.serverUrl, path, options.query, options.format ?? true);
  const timeoutMs = DEFAULT_TIMEOUT_MS;

  let response: Response | null = null;
  let lastNetworkError: unknown = null;
  for (let attempt = 0; attempt <= NETWORK_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          Authorization: basicAuthHeader(credentials),
          Accept: options.accept ?? 'application/json',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      break;
    } catch (e) {
      lastNetworkError = e;
      if (attempt < NETWORK_RETRIES) {
        // Backoff court : les coupures mobiles se résorbent en général vite.
        await sleep(700 * (attempt + 1));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  if (response === null) {
    const cause =
      lastNetworkError instanceof Error && lastNetworkError.name === 'AbortError'
        ? `délai dépassé (${Math.round(timeoutMs / 1000)} s)`
        : lastNetworkError instanceof Error
          ? lastNetworkError.message
          : 'erreur réseau';
    throw new ApiError(0, `Serveur injoignable après ${NETWORK_RETRIES + 1} tentatives (${cause}).`);
  }

  if (response.status === 401) {
    // 401 sur la session persistée (pas pendant un login explicite) :
    // identifiants révoqués côté Drupal → purge + retour login.
    if (options.credentials === undefined) {
      onUnauthorized?.();
    }
    throw new ApiError(401, 'Identifiants refusés par le serveur.');
  }

  if (!response.ok) {
    throw new ApiError(response.status, await extractErrorMessage(response));
  }

  return response;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const response = await rawFetch(path, options);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** Réponse texte brut (route GPX, sans `_format: json`). */
export async function apiFetchText(path: string, accept = 'application/gpx+xml'): Promise<string> {
  const response = await rawFetch(path, { format: false, accept });
  return response.text();
}

/**
 * POST multipart/form-data d'un fichier local (photo) via l'UploadTask
 * natif : le fichier part en streaming depuis le disque, les champs texte
 * accompagnent dans `parameters`. Mêmes retries réseau que rawFetch.
 */
export async function apiUploadFile<T>(
  path: string,
  fileUri: string,
  mimeType: string,
  fields: Record<string, string>,
): Promise<T> {
  const credentials = sessionCredentials;
  if (!credentials) {
    throw new ApiError(401, 'Aucun identifiant enregistré.');
  }
  const url = buildUrl(credentials.serverUrl, path, undefined, true);

  let result: { status: number; body: string } | null = null;
  let lastNetworkError: unknown = null;
  for (let attempt = 0; attempt <= NETWORK_RETRIES; attempt++) {
    const task = new File(fileUri).createUploadTask(url, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType,
      parameters: fields,
      headers: {
        Authorization: basicAuthHeader(credentials),
        Accept: 'application/json',
      },
    });
    try {
      // uploadAsync résout aussi pour les statuts non-2xx ; il ne rejette
      // que sur erreur réseau, lecture de fichier impossible ou annulation.
      result = await task.uploadAsync();
      break;
    } catch (e) {
      lastNetworkError = e;
      if (attempt < NETWORK_RETRIES) {
        await sleep(700 * (attempt + 1));
      }
    } finally {
      task.release();
    }
  }
  if (result === null) {
    const cause = lastNetworkError instanceof Error ? lastNetworkError.message : 'erreur réseau';
    throw new ApiError(0, `Serveur injoignable après ${NETWORK_RETRIES + 1} tentatives (${cause}).`);
  }

  if (result.status === 401) {
    onUnauthorized?.();
    throw new ApiError(401, 'Identifiants refusés par le serveur.');
  }
  if (result.status < 200 || result.status >= 300) {
    let message = `Erreur ${result.status}`;
    try {
      const payload = JSON.parse(result.body) as { message?: unknown };
      if (typeof payload.message === 'string' && payload.message !== '') {
        message = payload.message;
      }
    } catch {
      // corps non JSON : on garde le statut HTTP.
    }
    throw new ApiError(result.status, message);
  }
  return JSON.parse(result.body) as T;
}
