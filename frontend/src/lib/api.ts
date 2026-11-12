import axios from 'axios';
import { useAuthStore } from '../store/auth';
import { tokenStorage } from './token-storage';
import type { AuthResult } from '../types/auth';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
  timeout: 10000,
});
let refreshPromise: Promise<AuthResult> | null = null;

// Dinh kem JWT vao moi request neu co
api.interceptors.request.use((config) => {
  const token = tokenStorage.get();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Xu ly 401: token het han / khong hop le -> dang xuat va ve trang login.
// Bo qua chinh request login/register de khong dieu huong khi nhap sai.
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status;
    const url: string = error?.config?.url ?? '';
    const isAuthEndpoint = [
      '/auth/login',
      '/auth/register',
      '/auth/refresh',
    ].includes(url);
    if (status === 401 && !isAuthEndpoint) {
      const state = useAuthStore.getState();
      if (!error.config._refreshed && state.refreshToken) {
        error.config._refreshed = true;
        try {
          refreshPromise ??= axios
            .post<AuthResult>(
              `${api.defaults.baseURL}/auth/refresh`,
              { refreshToken: state.refreshToken },
              { timeout: 10000 },
            )
            .then(({ data }) => {
              useAuthStore
                .getState()
                .setAuth(data.accessToken, data.user, data.refreshToken);
              return data;
            })
            .finally(() => {
              refreshPromise = null;
            });
          const auth = await refreshPromise;
          error.config.headers.Authorization = `Bearer ${auth.accessToken}`;
          return api.request(error.config);
        } catch {
          /* The session is no longer usable. */
        }
      }
      useAuthStore.getState().logout();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

// Lay thong bao loi than thien tu response cua backend
export function getErrorMessage(
  error: unknown,
  fallback = 'Da co loi xay ra',
): string {
  if (axios.isAxiosError(error)) {
    const msg = error.response?.data?.message;
    if (Array.isArray(msg)) return msg.join(', ');
    if (typeof msg === 'string') return msg;
  }
  return fallback;
}

export default api;
