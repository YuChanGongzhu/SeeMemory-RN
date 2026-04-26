import {apiRequest} from './api-client';
import {API_ROUTES, isRouteConfigured} from './api-routes';
import {getToken} from './storage';

interface TokenResponse {
  token: string;
}

interface UploadResponse {
  status: number;
  message: string;
  result: any;
}

interface PresignedUrlPayload {
  presignedUrl: string;
  objectUrl: string;
}

interface PresignedUrlApiResponse {
  code: number;
  msg: string;
  data: PresignedUrlPayload;
}

interface UploadFileOptions {
  token?: string;
  filePath: string;
  fileExtension?: string;
  contentType: string;
  scene: number;
  extra?: Record<string, unknown>;
}

interface UploadFileResult {
  status: number;
  message: string;
  result: {
    objectUrl: string;
    presignedUrl: string;
    fileExtension: string;
    scene: number;
  } & Record<string, unknown>;
}

interface AsrResponse {
  text?: string;
  [key: string]: unknown;
}

const AMPHION_ASR_ENDPOINT = 'https://amphion.top/asr/v1/audio/transcriptions';
const AMPHION_ASR_API_KEY = 'sk-2d106f6227476125be26a20fd3fbd62875bea1146440ebfd1d8a2bde477a2631';
const AMPHION_ASR_AUTH_MODE: 'bearer' | 'x-api-key' | 'query' = 'bearer';
const AMPHION_ASR_LANGUAGE = '';

function normalizeFileUri(filePath: string): string {
  return filePath.startsWith('file://') ? filePath : `file://${filePath}`;
}

function getFileName(filePath: string): string {
  const cleaned = filePath.split('?')[0] || '';
  const parts = cleaned.split(/[\\/]/);
  return parts[parts.length - 1] || `audio.${getFileExtension(filePath)}`;
}

function getFileExtension(filePath: string): string {
  const cleaned = filePath.split('?')[0] || '';
  const index = cleaned.lastIndexOf('.');
  if (index < 0 || index === cleaned.length - 1) {
    return 'wav';
  }
  return cleaned.slice(index + 1).toLowerCase();
}

function buildAmphionAsrRequestInfo() {
  const url = new URL(AMPHION_ASR_ENDPOINT);
  const headers: Record<string, string> = {};

  if (AMPHION_ASR_AUTH_MODE === 'query') {
    url.searchParams.set('api_key', AMPHION_ASR_API_KEY);
  } else if (AMPHION_ASR_AUTH_MODE === 'x-api-key') {
    headers['X-API-Key'] = AMPHION_ASR_API_KEY;
  } else {
    headers.Authorization = `Bearer ${AMPHION_ASR_API_KEY}`;
  }

  return {url: url.toString(), headers};
}

export async function getPresignedUrl(
  fileExtension: string,
  scene: number,
  token?: string,
): Promise<PresignedUrlApiResponse> {
  if (!isRouteConfigured(API_ROUTES.getPresignedUrl)) {
    throw new Error('getPresignedUrl route is not configured yet.');
  }

  const response = await apiRequest<PresignedUrlApiResponse>(API_ROUTES.getPresignedUrl, {
    authToken: token,
    query: {
      fileExtension,
      scene,
    },
  });

  if (response.code !== 0 || !response.data?.presignedUrl || !response.data?.objectUrl) {
    const usedToken = token || (await getToken()) || '';
    console.warn('[getPresignedUrl] Invalid response', {
      fileExtension,
      scene,
      code: response.code,
      msg: response.msg,
      authPreview: usedToken ? `${usedToken.slice(0, 8)}...` : 'none',
      hasPresignedUrl: !!response.data?.presignedUrl,
      hasObjectUrl: !!response.data?.objectUrl,
    });
    throw new Error(response.msg || 'Failed to get presigned URL.');
  }

  return response;
}

export async function putFileToPresignedUrl(
  presignedUrl: string,
  filePath: string,
  contentType: string
): Promise<void> {
  const localFileResponse = await fetch(normalizeFileUri(filePath));
  if (!localFileResponse.ok) {
    throw new Error(`Failed to read local file: ${filePath}`);
  }

  const fileBlob = await localFileResponse.blob();
  const uploadResponse = await fetch(presignedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body: fileBlob,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    console.error('[putFileToPresignedUrl] PUT failed', {
      status: uploadResponse.status,
      statusText: uploadResponse.statusText,
      contentType,
      filePath,
      presignedUrlPreview: presignedUrl.slice(0, 120),
      responseBody: errorText?.slice(0, 1000),
    });
    throw new Error(`PUT presignedUrl failed (${uploadResponse.status}): ${errorText || uploadResponse.statusText}`);
  }
}

export async function uploadFileToCos({
  token,
  filePath,
  fileExtension,
  contentType,
  scene,
  extra,
}: UploadFileOptions): Promise<UploadFileResult> {
  const resolvedExtension = (fileExtension || getFileExtension(filePath)).toLowerCase();
  const presignedResult = await getPresignedUrl(resolvedExtension, scene, token);
  const {presignedUrl, objectUrl} = presignedResult.data;
  await putFileToPresignedUrl(presignedUrl, filePath, contentType);

  return {
    status: presignedResult.code,
    message: presignedResult.msg,
    result: {
      objectUrl,
      presignedUrl,
      fileExtension: resolvedExtension,
      scene,
      ...(extra || {}),
    },
  };
}

export async function createToken(apiKey: string, username: string): Promise<string> {
  if (!isRouteConfigured(API_ROUTES.createToken)) {
    throw new Error('createToken route is not configured yet.');
  }

  const data = await apiRequest<TokenResponse>(API_ROUTES.createToken, {
    body: {apiKey, username},
  });
  return data.token;
}

export async function uploadAudioSegment(
  token: string | undefined,
  filePath: string,
  duration: number,
  timestamp: number
): Promise<UploadResponse> {
  const fileExtension = getFileExtension(filePath);
  const scene = 4;
  const contentType = `audio/${fileExtension}`;
  return uploadFileToCos({
    token,
    filePath,
    fileExtension,
    contentType,
    scene,
    extra: {
      duration,
      timestamp,
    },
  });
}

export async function transcribeAudioFile(filePath: string): Promise<string> {
  const {url, headers} = buildAmphionAsrRequestInfo();
  const fileExtension = getFileExtension(filePath);
  const mimeType = fileExtension === 'wav' ? 'audio/wav' : `audio/${fileExtension}`;
  const form = new FormData();

  form.append('file', {
    uri: normalizeFileUri(filePath),
    name: getFileName(filePath),
    type: mimeType,
  } as any);

  if (AMPHION_ASR_LANGUAGE) {
    form.append('language', AMPHION_ASR_LANGUAGE);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: form,
  });

  const rawText = await response.text();
  let payload: AsrResponse | {raw: string};
  try {
    payload = JSON.parse(rawText) as AsrResponse;
  } catch {
    payload = {raw: rawText};
  }

  if (!response.ok) {
    throw new Error(
      `ASR 请求失败 (${response.status}): ${
        typeof payload === 'object' ? JSON.stringify(payload) : rawText
      }`,
    );
  }

  const transcript = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!transcript) {
    throw new Error('ASR 成功返回，但未拿到可用文本');
  }

  return transcript;
}

export async function uploadImageFile(
  token: string | undefined,
  filePath: string,
  mimeType?: string,
): Promise<UploadResponse> {
  const fileExtension = getFileExtension(filePath);
  const scene = 4;
  const normalizedMimeType =
    mimeType?.trim() || (fileExtension === 'jpg' ? 'image/jpeg' : `image/${fileExtension}`);

  return uploadFileToCos({
    token,
    filePath,
    fileExtension,
    contentType: normalizedMimeType,
    scene,
    extra: {
      mimeType: normalizedMimeType,
    },
  });
}

export async function getLatestHistory(token?: string): Promise<any> {
  if (!isRouteConfigured(API_ROUTES.loadUserLatestHistory)) {
    return null;
  }

  return apiRequest<any>(API_ROUTES.loadUserLatestHistory, {
    authToken: token,
  });
}
