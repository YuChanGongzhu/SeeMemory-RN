import EventSource from 'react-native-sse';
import type {ChatMessage} from '../types/chat';
import {getBaseApiUrl} from '../apis/core/env';
import {getAuthToken, handleUnauthorized} from '../apis/core/session';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** ChatMessage[] → 后端 /app/chat 需要的 {role,content}[]（仅保留有内容的 user/assistant）。 */
export function toChatTurns(messages: ChatMessage[]): ChatTurn[] {
  return messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.text.trim())
    .map(m => ({role: m.role as 'user' | 'assistant', content: m.text}));
}

/** @deprecated 名称沿用旧实现，等价于 toChatTurns。 */
export const toOpenAIMessages = toChatTurns;

export interface StreamChatParams {
  messages: ChatTurn[];
  onDelta: (fullText: string) => void;
  onDone: (fullText: string) => void;
  onError: (message: string) => void;
}

export interface StreamHandle {
  abort: () => void;
}

// 与 see-mem-studio-web 的 butler/chat-adapter 对齐：登录用户走 manager-api
//   POST https://ms.seemem.com/api/app/chat
// 用登录态 auth_token (Bearer) 鉴权，请求体只收 {messages:[{role,content}]}，
// 自定义 SSE 流式返回：data: {"delta":"..."} ... data: [DONE]（出错为 data: {"error":"..."}）。
// 后端按当前记忆 mode 自动分流云端 imemory / 本地盒子，前端不再直连 remote.seemem.com。
// RN 的 fetch 读不了流式 body，因此用 react-native-sse（XHR）支持 POST + 自定义头。
export function streamChat(params: StreamChatParams): StreamHandle {
  const {messages, onDelta, onDone, onError} = params;

  let assistantText = '';
  let finished = false;

  const finish = (kind: 'done' | 'error', message?: string) => {
    if (finished) {
      return;
    }
    finished = true;
    es.removeAllEventListeners();
    es.close();
    if (kind === 'done') {
      onDone(assistantText);
    } else {
      onError(message || '网络异常，请稍后再试');
    }
  };

  const token = getAuthToken();
  if (!token) {
    // 与 baseRequest 的 401 行为一致：驱动回登录态，并把错误回传给 UI。
    handleUnauthorized();
    onError('登录已过期，请重新登录');
    return {abort: () => {}};
  }

  const url = `${getBaseApiUrl()}/app/chat`;
  const es = new EventSource(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({messages}),
    // Disable auto-reconnect: a chat completion is a one-shot stream.
    pollingInterval: 0,
    timeout: 60000,
  });

  es.addEventListener('message', event => {
    const data = (event.data || '').trim();
    if (!data || data === '[DONE]') {
      if (data === '[DONE]') {
        finish('done');
      }
      return;
    }
    try {
      const parsed = JSON.parse(data) as {delta?: unknown; error?: unknown};
      if (typeof parsed.error === 'string' && parsed.error) {
        finish('error', parsed.error);
        return;
      }
      if (typeof parsed.delta === 'string' && parsed.delta) {
        assistantText += parsed.delta;
        onDelta(assistantText);
      }
    } catch {
      // skip malformed/keep-alive chunks
    }
  });

  es.addEventListener('error', event => {
    const status = 'xhrStatus' in event ? event.xhrStatus : undefined;
    if (status === 401) {
      handleUnauthorized();
      finish('error', '登录已过期，请重新登录');
      return;
    }
    const message =
      'message' in event && event.message
        ? event.message
        : `连接出错（${status ?? ''}）`;
    finish('error', message);
  });

  es.addEventListener('close', () => {
    // Normal end of stream without an explicit [DONE]: treat any accumulated
    // text as success, otherwise surface an error.
    if (assistantText) {
      finish('done');
    } else {
      finish('error', '连接已关闭');
    }
  });

  return {
    abort: () => finish('error', '已取消'),
  };
}
