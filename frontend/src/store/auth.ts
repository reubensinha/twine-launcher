import { create } from 'zustand';
import { auth as authApi, clearToken, setToken } from '../api';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  loading: boolean;
  hydrate: () => Promise<void>;
  login:   (username: string, password: string) => Promise<void>;
  setup:   (username: string, password: string) => Promise<void>;
  logout:  () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  hydrate: async () => {
    set({ loading: true });
    try {
      const user = await authApi.me();
      set({ user, loading: false });
    } catch {
      clearToken();
      set({ user: null, loading: false });
    }
  },

  login: async (username, password) => {
    const { access_token } = await authApi.login(username, password);
    setToken(access_token);
    const user = await authApi.me();
    set({ user });
  },

  setup: async (username, password) => {
    const { access_token } = await authApi.setup(username, password);
    setToken(access_token);
    const user = await authApi.me();
    set({ user });
  },

  logout: () => {
    clearToken();
    set({ user: null });
  },
}));
