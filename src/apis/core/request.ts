import {getAuthToken, handleUnauthorized} from './session';

export const BASE_API_URL = 'https://ms.seemem.com/api';

export class BizError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'BizError';
    this.code = code;
  }
}

interface ApiEnvelope<T> {
  code: number;
  msg: string;
  data: T | null;
}

type QueryValue = string | number | boolean | null | undefined;

export interface BaseRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  query?: Record<string, QueryValue>;
  timeout?: number;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  let url = `${BASE_API_URL}${normalizedPath}`;
  if (query) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        params.append(key, String(value));
      }
    });
    const qs = params.toString();
    if (qs) {
      url += `?${qs}`;
    }
  }
  return url;
}

export async function baseRequest<T>(options: BaseRequestOptions): Promise<T> {
  const {method = 'GET', path, body, query, timeout = 15000} = options;
  const url = buildUrl(path, query);

  const headers: Record<string, string> = {'Content-Type': 'application/json'};
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) {
    handleUnauthorized();
    throw new BizError(401, '登录已过期，请重新登录');
  }

  const text = await response.text();
  let payload: ApiEnvelope<T>;
  try {
    payload = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new BizError(response.status, text || `请求失败（${response.status}）`);
  }

  if (payload.code !== 0) {
    throw new BizError(payload.code, payload.msg || `请求失败（${payload.code}）`);
  }

  return payload.data as T;
}
