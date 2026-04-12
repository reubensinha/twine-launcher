/**
 * Typed API client for the Twine Launcher backend.
 * All requests include the JWT from localStorage automatically.
 */

import type {
  BackupImportResult,
  Game,
  GameCreate,
  GameSession,
  GameUpdate,
  TokenResponse,
  User,
  UserCreate,
  UserUpdate,
} from '../types';

const BASE = '/api/v1';

export function getToken(): string | null { return localStorage.getItem('twine_access_token'); }
export function setToken(t: string): void  { localStorage.setItem('twine_access_token', t); }
export function clearToken(): void         { localStorage.removeItem('twine_access_token'); }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const isForm = options.body instanceof FormData || options.body instanceof URLSearchParams;
  const headers: Record<string, string> = {
    ...(options.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> | undefined ?? {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail ?? `HTTP ${res.status}`);
  return data as T;
}

export const auth = {
  setupRequired: () => request<{ setup_required: boolean }>('/auth/setup-required'),
  setup: (username: string, password: string) =>
    request<TokenResponse>('/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) =>
    request<TokenResponse>('/auth/login', {
      method: 'POST',
      body: new URLSearchParams({ username, password }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }),
  me: () => request<User>('/auth/me'),
};

export const users = {
  list: () => request<User[]>('/users/'),
  create: (p: UserCreate) => request<User>('/users/', { method: 'POST', body: JSON.stringify(p) }),
  update: (id: number, p: UserUpdate) => request<User>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  delete: (id: number) => request<void>(`/users/${id}`, { method: 'DELETE' }),
};

export const games = {
  list: () => request<Game[]>('/games/'),
  get: (id: number) => request<Game>(`/games/${id}`),
  create: (p: GameCreate) => request<Game>('/games/', { method: 'POST', body: JSON.stringify(p) }),
  update: (id: number, p: GameUpdate) => request<Game>(`/games/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  delete: (id: number) => request<void>(`/games/${id}`, { method: 'DELETE' }),
  playUrl: (id: number) => `/api/v1/games/${id}/play`,
};

export const sessions = {
  list: () => request<GameSession[]>('/sessions/'),
  close: (id: number) => request<void>(`/sessions/${id}`, { method: 'DELETE' }),
};

export const saves = {
  delete: (gameId: number) => request<void>(`/saves/${gameId}`, { method: 'DELETE' }),
};

export const backup = {
  export: async (scope: 'full' | 'saves-only'): Promise<void> => {
    const token = getToken();
    const res = await fetch(`${BASE}/backup/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ scope }),
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err?.detail ?? 'Export failed'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cd = res.headers.get('content-disposition') ?? '';
    a.download = cd.match(/filename="(.+)"/)?.[1] ?? 'twine-launcher-backup.zip';
    a.href = url; a.click(); URL.revokeObjectURL(url);
  },
  import: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<BackupImportResult>('/backup/import', { method: 'POST', body: form });
  },
};

export const themeApi = {
  builtins: () => request<Array<{ id: string; name: string; description?: string } & Record<string, string>>>('/themes/builtins'),
  active: () => request<{ source: string; theme: Record<string, string> }>('/themes/active'),
  setGlobalBuiltin: (id: string) => request<{ ok: boolean }>(`/themes/global/builtin/${id}`, { method: 'POST' }),
  setGlobalCustom: (file: File) => {
    const form = new FormData(); form.append('file', file);
    return request<{ ok: boolean }>('/themes/global/custom', { method: 'POST', body: form });
  },
  resetGlobal: () => request<{ ok: boolean }>('/themes/global', { method: 'DELETE' }),
  setUserBuiltin: (id: string) => request<{ ok: boolean }>(`/themes/user/builtin/${id}`, { method: 'POST' }),
  setUserCustom: (file: File) => {
    const form = new FormData(); form.append('file', file);
    return request<{ ok: boolean }>('/themes/user/custom', { method: 'POST', body: form });
  },
  resetUser: () => request<{ ok: boolean }>('/themes/user', { method: 'DELETE' }),
};
