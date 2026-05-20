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

// Singleton promise to deduplicate concurrent 401 → refresh races.
let _refreshing: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  if (!_refreshing) {
    _refreshing = fetch(`${BASE}/auth/refresh`, { method: 'POST' })
      .then(async res => {
        if (!res.ok) return false;
        setToken((await res.json()).access_token);
        return true;
      })
      .catch(() => false)
      .finally(() => { _refreshing = null; });
  }
  return _refreshing;
}

function buildHeaders(options: RequestInit): Record<string, string> {
  const token = getToken();
  const isForm = options.body instanceof FormData || options.body instanceof URLSearchParams;
  return {
    ...(options.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> | undefined ?? {}),
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...options, headers: buildHeaders(options) });

  // Silent refresh: if we get a 401, try refreshing once.
  // Only exclude /auth/refresh itself to avoid infinite loops.
  if (res.status === 401 && path !== '/auth/refresh') {
    const refreshed = await tryRefresh();
    if (refreshed) {
      // Retry with the new token.
      const retry = await fetch(`${BASE}${path}`, { ...options, headers: buildHeaders(options) });
      if (retry.status === 204) return undefined as T;
      const retryData = await retry.json();
      if (!retry.ok) throw new Error(retryData?.detail ?? `HTTP ${retry.status}`);
      return retryData as T;
    }
  }

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
  updateMe: (prefs: { autosave_enabled: boolean }) =>
    request<User>('/auth/me', { method: 'PATCH', body: JSON.stringify(prefs) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ detail: string }>('/auth/me/password', {
      method: 'PATCH',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
};

export const users = {
  list: () => request<User[]>('/users/'),
  create: (p: UserCreate) => request<User>('/users/', { method: 'POST', body: JSON.stringify(p) }),
  update: (id: number, p: UserUpdate) => request<User>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  delete: (id: number) => request<void>(`/users/${id}`, { method: 'DELETE' }),
  resetPassword: (id: number) => request<{ temp_password: string }>(`/users/${id}/reset-password`, { method: 'POST' }),
};

export const games = {
  list: () => request<Game[]>('/games/'),
  get: (id: number) => request<Game>(`/games/${id}`),
  create: (p: GameCreate) => request<Game>('/games/', { method: 'POST', body: JSON.stringify(p) }),
  update: (id: number, p: GameUpdate) => request<Game>(`/games/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  delete: (id: number) => request<void>(`/games/${id}`, { method: 'DELETE' }),
  playUrl: (id: number) => `/api/v1/games/${id}/play`,
  startSession: (id: number) =>
    request<{ session_id: number; game_url: string; game_name: string; initial_saves: Record<string, string>; save_updated_at: string | null }>(
      `/games/${id}/session`, { method: 'POST' }
    ),
  upload: (params: { name: string; description?: string; zipFile?: File; folderFiles?: File[]; folderPaths?: string[] }) => {
    const form = new FormData();
    form.append('name', params.name);
    if (params.description) form.append('description', params.description);
    if (params.zipFile) {
      form.append('file', params.zipFile);
    } else if (params.folderFiles && params.folderPaths) {
      params.folderFiles.forEach(f => form.append('files', f));
      params.folderPaths.forEach(p => form.append('paths', p));
    }
    return request<Game>('/games/upload', { method: 'POST', body: form });
  },
};

export const sessions = {
  list: () => request<GameSession[]>('/sessions/'),
  close: (id: number) => request<void>(`/sessions/${id}`, { method: 'DELETE' }),
};

export interface SaveSummary {
  game_id: number; game_name: string;
  user_id: number; username: string;
  data: Record<string, string>;
  updated_at: string;
}

export const saves = {
  all: () => request<SaveSummary[]>('/saves/'),
  sync: (gameId: number, data: Record<string, string>) =>
    request<unknown>(`/saves/${gameId}`, { method: 'POST', body: JSON.stringify({ data }) }),
  delete: (gameId: number) => request<void>(`/saves/${gameId}`, { method: 'DELETE' }),
};

export const backup = {
  // Returns true if the file was saved, false if the user cancelled the save dialog.
  export: async (scope: 'full' | 'saves-only'): Promise<boolean> => {
    const token = getToken();
    const res = await fetch(`${BASE}/backup/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ scope }),
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err?.detail ?? 'Export failed'); }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    const filename = cd.match(/filename="(.+)"/)?.[1] ?? 'twine-launcher-backup.zip';

    // showSaveFilePicker gives a native "Save As" dialog in WebView2 and modern browsers.
    if ('showSaveFilePicker' in window) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Zip archive', accept: { 'application/zip': ['.zip'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch (err: unknown) {
        // AbortError = user cancelled the dialog — not an error condition.
        if (err instanceof DOMException && err.name === 'AbortError') return false;
        throw err;
      }
    }

    // Fallback for environments that don't support showSaveFilePicker.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = filename;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  },
  import: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<BackupImportResult>('/backup/import', { method: 'POST', body: form });
  },
};

export const configApi = {
  get: () => request<{ games_dir: string }>('/config'),
  browse: (path: string) =>
    request<{ current: string; parent: string | null; dirs: { name: string; path: string }[] }>(
      `/config/browse?path=${encodeURIComponent(path)}`
    ),
  logs: (lines = 200) =>
    request<{ path: string; size_bytes: number; lines: string[] }>(`/config/logs?lines=${lines}`),
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
