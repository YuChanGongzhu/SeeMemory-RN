import {baseRequest} from '../apis/core/request';

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
  cleaned_text?: string;
  translated_text?: string;
  session_id?: string;
  detail?: unknown;
  [key: string]: unknown;
}

const AMPHION_ASR_ENDPOINT = 'https://amphion.top/asr/v1/audio/transcriptions';
const AMPHION_ASR_AUTH_MODE: 'bearer' | 'x-api-key' | 'query' = 'bearer';
const AMPHION_ASR_API_KEY = 'sk-2d106f6227476125be26a20fd3fbd62875bea1146440ebfd1d8a2bde477a2631';

type AmphionAsrCleanupLevel = 'off' | 'light' | 'standard';

interface AmphionAsrConfig {
  language?: string;
  translate_mode?: boolean;
  target_language?: string;
  cleanup?: {
    level?: AmphionAsrCleanupLevel;
    text_emotion?: boolean;
  };
  hotwords?: {
    builtin?: string[];
    custom?: string[];
  };
}

const AMPHION_ASR_DEFAULT_CONFIG: AmphionAsrConfig = {
  language: 'auto',
  translate_mode: false,
  cleanup: {
    level: 'light',
    text_emotion: false,
  },
  hotwords: {
    builtin: [],
    custom: [],
  },
};

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

function buildAmphionAsrConfig(): AmphionAsrConfig {
  return AMPHION_ASR_DEFAULT_CONFIG;
}

function getAsrErrorMessage(payload: AsrResponse | {raw: string}): string {
  if (!payload || typeof payload !== 'object') {
    return 'ASR 请求失败';
  }

  const detail = 'detail' in payload ? payload.detail : undefined;
  if (typeof detail === 'string') {
    return detail;
  }

  if (detail && typeof detail === 'object') {
    const detailRecord = detail as Record<string, unknown>;
    const message = typeof detailRecord.message === 'string' ? detailRecord.message : '';
    const sessionId = typeof detailRecord.session_id === 'string' ? detailRecord.session_id : '';
    return [message || 'ASR 请求失败', sessionId ? `session_id=${sessionId}` : '']
      .filter(Boolean)
      .join(' ');
  }

  if (typeof payload.raw === 'string' && payload.raw.trim()) {
    return payload.raw.trim();
  }

  return 'ASR 请求失败';
}

export async function getPresignedUrl(
  fileExtension: string,
  scene: number,
): Promise<PresignedUrlApiResponse> {
  // 与 see-mem-studio-web 一致：走 manager-api 通用预签名接口
  //   GET https://ms.seemem.com/api/common/getPresignedUrl?fileExtension=&scene=
  // 用登录态 auth_token (Bearer) 鉴权，返回 {code,msg,data:{presignedUrl,objectUrl}} 信封。
  // （旧实现打的是 seemem.com/api/v1/memory/getPresignedUrl，那是另一套鉴权，
  //   会返回「authorization 无效」。scene 必须是后端 FileUploadEnum 的合法值。）
  let data: PresignedUrlPayload;
  try {
    data = await baseRequest<PresignedUrlPayload>({
      method: 'GET',
      path: '/common/getPresignedUrl',
      query: {fileExtension, scene},
    });
  } catch (e) {
    // 区分「拿预签名就失败」（连不上 ms.seemem.com / 登录态失效）和「传 COS 失败」。
    throw new Error(`获取预签名失败: ${String((e as Error)?.message || e)}`);
  }

  if (!data?.presignedUrl || !data?.objectUrl) {
    throw new Error('获取预签名地址失败：返回为空');
  }

  return {code: 0, msg: 'ok', data};
}

export async function putFileToPresignedUrl(
  presignedUrl: string,
  filePath: string,
  contentType: string
): Promise<void> {
  let fileBlob: Blob;
  try {
    const localFileResponse = await fetch(normalizeFileUri(filePath));
    if (!localFileResponse.ok) {
      throw new Error(`Failed to read local file: ${filePath}`);
    }
    fileBlob = await localFileResponse.blob();
  } catch (e) {
    // 读本地文件失败：路径失效/文件被清理。区别于「传 COS 网络失败」。
    throw new Error(`读取本地录音失败(${filePath}): ${String((e as Error)?.message || e)}`);
  }

  // 提取 COS 主机，网络失败时能一眼看出是不是主机不可达/被 ATS 拦。
  const cosHost = presignedUrl.replace(/^https?:\/\//, '').split('/')[0];
  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(presignedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: fileBlob,
    });
  } catch (e) {
    // fetch 直接抛（TypeError: Network request failed）= 连不上 COS，不是 HTTP 错误码。
    throw new Error(`上传 COS 失败(${cosHost}): ${String((e as Error)?.message || e)}`);
  }

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
  filePath,
  fileExtension,
  contentType,
  scene,
  extra,
}: UploadFileOptions): Promise<UploadFileResult> {
  const resolvedExtension = (fileExtension || getFileExtension(filePath)).toLowerCase();
  const presignedResult = await getPresignedUrl(resolvedExtension, scene);
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
  const config = buildAmphionAsrConfig();

  form.append('file', {
    uri: normalizeFileUri(filePath),
    name: getFileName(filePath),
    type: mimeType,
  } as any);

  form.append('config', JSON.stringify(config));

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
    throw new Error(`ASR 请求失败 (${response.status}): ${getAsrErrorMessage(payload)}`);
  }

  if ('raw' in payload) {
    throw new Error(`ASR 返回非 JSON: ${payload.raw}`);
  }

  const asr = payload as AsrResponse;

  const transcript =
    typeof asr.cleaned_text === 'string' && asr.cleaned_text.trim()
      ? asr.cleaned_text.trim()
      : typeof asr.translated_text === 'string' && asr.translated_text.trim()
        ? asr.translated_text.trim()
        : typeof asr.text === 'string'
          ? asr.text.trim()
          : '';
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
  const scene = 7; // FileUploadEnum.MEMERY_IMAGE（记忆图片）
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

