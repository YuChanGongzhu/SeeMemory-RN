import {getBaseApiUrl} from '../core/env';
import {assertAiConsentGranted} from '../../privacy/consentRuntime';
import {getAuthToken} from '../core/session';

/**
 * 语音转文字：把录好的本地音频文件 multipart 上传到 manager-api 的 App 出口
 * `POST /app/audio/transcriptions`（@Auth(USER)，用登录用户的 auth_token 鉴权），
 * 同步返回 `{ text }`。后端内部按登录用户映射到其记忆身份、复用 Amphion ASR。
 *
 * 不走 baseRequest（那是 JSON 封装）；multipart 用 fetch 直发，参考 services/api.ts 里的
 * transcribeAudioFile 写法。
 */

function normalizeFileUri(filePath: string): string {
  return filePath.startsWith('file://') ? filePath : `file://${filePath}`;
}

function fileNameOf(filePath: string): string {
  const cleaned = filePath.split('?')[0] || '';
  const parts = cleaned.split(/[\\/]/);
  return parts[parts.length - 1] || 'voice.m4a';
}

export interface TranscribeVoiceParams {
  filePath: string;
  /** BCP-47 语言码，如 'zh-CN'；不传由后端/上游自动识别。 */
  language?: string;
  mimeType?: string;
}

export async function transcribeVoice({
  filePath,
  language,
  mimeType = 'audio/m4a',
}: TranscribeVoiceParams): Promise<string> {
  assertAiConsentGranted();
  const token = getAuthToken();
  if (!token) {
    throw new Error('未登录，无法使用语音转写');
  }

  const form = new FormData();
  form.append('file', {
    uri: normalizeFileUri(filePath),
    name: fileNameOf(filePath),
    type: mimeType,
  } as unknown as Blob);
  form.append('response_format', 'json');
  if (language) {
    form.append('language', language);
  }

  const response = await fetch(`${getBaseApiUrl()}/app/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      // 不手动设 Content-Type，让 RN 自动带上 multipart boundary。
    },
    body: form,
  });

  if (!response.ok) {
    // ASR 错误一律无 X-Upstream-Source 头（上游错误也被网关映射成 CommonVO {code,msg}，
    // 认证失败/积分不足/上游故障同形）；有头分支按全站约定保留，ASR 上实际不会命中。
    const upstream = response.headers.get('X-Upstream-Source');
    let message: string | undefined;
    try {
      const body = (await response.json()) as {msg?: string; error?: {message?: string}};
      message = upstream ? body?.error?.message : body?.msg;
    } catch {
      // 非 JSON（如网关 502 HTML）落兜底文案
    }
    throw new Error(`转写失败（${response.status}）${message ? `：${message}` : ''}`);
  }

  const data = (await response.json()) as {text?: string};
  return (data?.text || '').trim();
}
