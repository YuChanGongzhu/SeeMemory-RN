import {getToken} from './storage';
import {API_AUTH_TOKEN_OVERRIDE, API_BASE_URL, type ApiRoute} from './api-routes';

type HeadersMap = Record<string, string>;

interface ApiRequestOptions {
  body?: unknown;
  headers?: HeadersMap;
  authToken?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
}

function isFormDataBody(body: unknown): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

function isStringBody(body: unknown): body is string {
  return typeof body === 'string';
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return `${normalizedBase}${normalizedPath}`;
}

function withQuery(url: string, query?: ApiRequestOptions['query']): string {
  if (!query) {
    return url;
  }

  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      params.append(key, String(value));
    }
  });

  const queryString = params.toString();
  if (!queryString) {
    return url;
  }

  return `${url}?${queryString}`;
}

export async function apiRequest<T>(
  route: ApiRoute,
  options: ApiRequestOptions = {}
): Promise<T> {
  const url = withQuery(joinUrl(API_BASE_URL, route.path), options.query);
  const headers: HeadersMap = {...options.headers};
  let body: RequestInit['body'];

  if (route.requiresAuth) {
    const storedToken = await getToken();
    const token = API_AUTH_TOKEN_OVERRIDE || options.authToken || storedToken || '';
    if (!token) {
      throw new Error(`Authorization token is required for route: ${route.path}`);
    }
    // Backend currently expects raw token in Authorization header.
    headers.Authorization = token;
    const tokenSource = API_AUTH_TOKEN_OVERRIDE
      ? 'API_AUTH_TOKEN_OVERRIDE'
      : options.authToken
        ? 'options.authToken'
        : storedToken
          ? 'storage.getToken'
          : 'none';
    console.log('[apiRequest] Auth source', {
      route: route.path,
      tokenSource,
      authPreview: `${token.slice(0, 8)}...`,
    });
  }

  if (options.body !== undefined && options.body !== null) {
    if (isFormDataBody(options.body)) {
      body = options.body;
    } else if (isStringBody(options.body)) {
      body = options.body;
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
    } else {
      body = JSON.stringify(options.body);
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
    }
  }

  try {
    const response = await fetch(url, {
      method: route.method,
      headers,
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[apiRequest] HTTP error', {
        method: route.method,
        url,
        status: response.status,
        statusText: response.statusText,
        authPreview: headers.Authorization ? `${String(headers.Authorization).slice(0, 8)}...` : 'none',
        responseBody: errorBody?.slice(0, 1000),
      });
      throw new Error(`API request failed (${response.status}): ${errorBody || response.statusText}`);
    }

    return response.json() as Promise<T>;
  } catch (error: any) {
    console.error('[apiRequest] Request failed', {
      method: route.method,
      url,
      authPreview: headers.Authorization ? `${String(headers.Authorization).slice(0, 8)}...` : 'none',
      message: error?.message,
      stack: error?.stack,
    });
    throw error;
  }
}
