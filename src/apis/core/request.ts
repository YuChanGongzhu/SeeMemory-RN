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

// 响应形态见《对外错误响应汇总.md》，判成败以 HTTP 状态码为准。
// baseRequest 现有调用面只会遇到两种形态（新增其他透传对接面时按该文档补分支）：
//   无 X-Upstream-Source 头 = manager-api 自产 {code,msg,data}（200 ⟺ code=0，code 是业务码）；
//   X-Upstream-Source: memory = memory 透传 {success,msg,data}（success 与 HTTP 状态一致）。
interface ApiEnvelope<T> {
  code?: number;
  success?: boolean;
  msg?: string;
  data?: T | null;
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

  if (!response.ok) {
    // 出错：按 X-Upstream-Source 头判定错误产自谁，取对应格式里的人话（见《对外错误响应汇总.md》）
    const upstream = response.headers.get('X-Upstream-Source');
    let message: string | undefined;
    let code = response.status;
    if (!upstream) {
      // manager-api 自产：{code,msg,data}，code 是业务码
      message = payload.msg;
      code = payload.code ?? response.status;
    } else if (upstream === 'memory') {
      message = payload.msg;
    }
    throw new BizError(code, message || `请求失败（${response.status}）`);
  }

  // 迁移前的旧 manager-api 失败也回 200+code≠0；服务端全量上线后此分支不会再命中，可删
  if (payload.code !== undefined && payload.code !== 0) {
    throw new BizError(payload.code, payload.msg || `请求失败（${payload.code}）`);
  }

  return payload.data as T;
}
