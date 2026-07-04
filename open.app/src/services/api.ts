/**
 * Wrapper fetch pour l'API opencar (Drupal, /opencar/api/v1/*).
 *
 * - Ajoute `Authorization: Basic` sur chaque requête (identifiants SecureStore).
 * - Suffixe `?_format=json` sur toutes les routes JSON — exigence `_format: json`
 *   du routing Drupal. Seule la route GPX se consomme sans (`format: false`).
 * - 401 sur la session courante → handler `onUnauthorized` (purge des
 *   identifiants → retour à l'écran login).
 */

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

async function rawFetch(
  path: string,
  options: ApiFetchOptions & { formData?: FormData; accept?: string },
): Promise<Response> {
  const credentials = options.credentials ?? sessionCredentials;
  if (!credentials) {
    throw new ApiError(401, 'Aucun identifiant enregistré.');
  }

  const url = buildUrl(credentials.serverUrl, path, options.query, options.format ?? true);
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: basicAuthHeader(credentials),
        Accept: options.accept ?? 'application/json',
        // multipart : fetch pose lui-même le Content-Type avec la boundary.
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body:
        options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'Serveur injoignable. Vérifiez l’URL et la connexion réseau.');
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

/** POST multipart/form-data (upload de photo). */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const response = await rawFetch(path, { method: 'POST', formData });
  return (await response.json()) as T;
}
