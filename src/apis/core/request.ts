import {getAuthToken, getDeviceContext, handleUnauthorized} from './session';
import {getBaseApiUrl} from './env';

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
  let url = `${getBaseApiUrl()}${normalizedPath}`;
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

// Hits {subDomain}.remote.seemem.com/api with device_token — mirrors web's deviceClient
export async function deviceRequest<T>(options: BaseRequestOptions): Promise<T> {
  const ctx = getDeviceContext();
  if (!ctx?.subDomain || !ctx?.deviceToken) {
    throw new BizError(0, '未绑定设备，请先选择记忆盒子');
  }
  const deviceBase = `https://${ctx.subDomain}.remote.seemem.com/api`;
  const normalizedPath = options.path.startsWith('/') ? options.path : `/${options.path}`;
  let url = `${deviceBase}${normalizedPath}`;
  if (options.query) {
    const params = new URLSearchParams();
    Object.entries(options.query).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        params.append(key, String(value));
      }
    });
    const qs = params.toString();
    if (qs) { url += `?${qs}`; }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ctx.deviceToken}`,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 15000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined && options.body !== null ? JSON.stringify(options.body) : undefined,
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
  // Device backend may return plain data without envelope on some routes
  let payload: {code?: number; msg?: string; data?: T} & Record<string, unknown>;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new BizError(response.status, text || `请求失败（${response.status}）`);
  }

  if (payload.code !== undefined && payload.code !== 0) {
    throw new BizError(payload.code, (payload.msg as string) || `请求失败（${payload.code}）`);
  }

  // If envelope with data field, unwrap; otherwise treat whole payload as T
  return (payload.data !== undefined ? payload.data : payload) as T;
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
