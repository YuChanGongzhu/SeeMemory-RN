export const API_BASE_URL = 'https://seemem.com/api/v1/';

// Temporary fallback token for debugging. Keep empty in production if token is managed by login flow.
export const API_AUTH_TOKEN_OVERRIDE = 'egUNen7DlBrGyVKwTaVJxXIjkNhixTzupYTxSN6n5U7p8Y8AaoStwCvJvulA4jmc';

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRoute {
  path: string;
  method: ApiMethod;
  requiresAuth: boolean;
}

export const API_ROUTES = {
  getPresignedUrl: {
    path: 'memory/getPresignedUrl',
    method: 'GET',
    requiresAuth: true,
  },
  createToken: {
    path: '',
    method: 'POST',
    requiresAuth: false,
  },
  uploadHistory: {
    path: '',
    method: 'POST',
    requiresAuth: true,
  },
  loadUserLatestHistory: {
    path: '',
    method: 'GET',
    requiresAuth: true,
  },
} as const satisfies Record<string, ApiRoute>;

export function isRouteConfigured(route: ApiRoute): boolean {
  return route.path.trim().length > 0;
}
