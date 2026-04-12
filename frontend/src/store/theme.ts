/**
 * Theme store — fetches the active theme from the backend and applies
 * it to CSS custom properties on :root. All colour rendering flows through
 * CSS variables, so swapping a theme is instant with no re-render.
 */

import { create } from 'zustand';
import { getToken } from '../api';

export interface ThemeData {
  name?: string;
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
}

export interface BuiltinTheme extends ThemeData {
  id: string;
  description?: string;
}

interface ThemeState {
  active: ThemeData | null;
  source: string;
  builtins: BuiltinTheme[];
  fetchActive: () => Promise<void>;
  fetchBuiltins: () => Promise<void>;
  applyTheme: (theme: ThemeData) => void;
}

/** Write a theme object into :root CSS variables. */
function applyToCSSVars(theme: ThemeData): void {
  const root = document.documentElement;
  root.style.setProperty('--bg',          theme.bg);
  root.style.setProperty('--surface',     theme.surface);
  root.style.setProperty('--surface2',    theme.surface2);
  root.style.setProperty('--border',      theme.border);
  root.style.setProperty('--text',        theme.text);
  root.style.setProperty('--text-muted',  theme.textMuted);
  root.style.setProperty('--accent',      theme.accent);
  root.style.setProperty('--accent-text', theme.accentText);
}

export const useThemeStore = create<ThemeState>((set) => ({
  active: null,
  source: 'default',
  builtins: [],

  fetchActive: async () => {
    try {
      const token = getToken();
      if (!token) return;
      const res = await fetch('/api/v1/themes/active', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      applyToCSSVars(data.theme);
      set({ active: data.theme, source: data.source });
    } catch {
      // Non-fatal — CSS defaults remain
    }
  },

  fetchBuiltins: async () => {
    try {
      const res = await fetch('/api/v1/themes/builtins');
      if (!res.ok) return;
      const data: BuiltinTheme[] = await res.json();
      set({ builtins: data });
    } catch {
      // Non-fatal
    }
  },

  applyTheme: (theme) => {
    applyToCSSVars(theme);
    set({ active: theme });
  },
}));
