/**
 * Baselines (notes géolocalisées) et thématiques — accès typé à l'API.
 *
 * Les baselines se créent en ligne uniquement (formulaire → POST direct,
 * pas de file offline) ; les thématiques sont envoyées comme un tableau de
 * noms, le serveur rattache ou crée les termes (remplacement complet).
 */

import { apiFetch } from '@/services/api';

export type Thematique = {
  id: number;
  name: string;
};

export type Baseline = {
  uuid: string;
  title: string;
  published: boolean;
  body: string | null;
  coordinates: { lat: number; lng: number } | null;
  thematiques: Thematique[];
  created: number;
  changed: number;
};

export type BaselineListResponse = {
  items: Baseline[];
  page: number;
  limit: number;
  total: number;
};

export function fetchBaselines(options: { page?: number; limit?: number } = {}): Promise<BaselineListResponse> {
  return apiFetch<BaselineListResponse>('/opencar/api/v1/baselines', {
    query: { page: options.page, limit: options.limit },
  });
}

export function createBaseline(baseline: {
  uuid: string;
  title: string;
  body?: string;
  lat?: number;
  lng?: number;
  thematiques?: string[];
}): Promise<Baseline> {
  return apiFetch<Baseline>('/opencar/api/v1/baselines', { method: 'POST', body: baseline });
}

export function patchBaseline(
  uuid: string,
  patch: Partial<{ title: string; body: string | null; published: boolean; thematiques: string[] }>,
): Promise<Baseline> {
  return apiFetch<Baseline>(`/opencar/api/v1/baselines/${uuid}`, { method: 'PATCH', body: patch });
}

export function deleteBaseline(uuid: string): Promise<void> {
  return apiFetch<void>(`/opencar/api/v1/baselines/${uuid}`, { method: 'DELETE' });
}

/** Recherche de termes pour l'autocomplétion du picker. */
export async function searchThematiques(q: string): Promise<Thematique[]> {
  const response = await apiFetch<{ items: Thematique[] }>('/opencar/api/v1/thematiques', {
    query: { q: q || undefined },
  });
  return response.items;
}
