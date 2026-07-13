import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SafeUser } from '../types/auth';
import { tokenStorage } from '../lib/token-storage';

interface AuthState {
  token: string | null;
  user: SafeUser | null;
  isAuthenticated: boolean;
  setAuth: (token: string, user: SafeUser) => void;
  updateUser: (user: SafeUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      setAuth: (token, user) => {
        tokenStorage.set(token); // dong bo cho axios interceptor
        set({ token, user, isAuthenticated: true });
      },
      updateUser: (user) => {
        set({ user });
      },
      logout: () => {
        tokenStorage.clear();
        set({ token: null, user: null, isAuthenticated: false });
      },
    }),
    {
      name: 'banking_auth',
      // Khi khoi phuc tu localStorage, dong bo lai token cho axios.
      onRehydrateStorage: () => (state) => {
        if (state?.token) tokenStorage.set(state.token);
      },
    },
  ),
);
