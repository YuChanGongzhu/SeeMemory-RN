import EventSource from 'react-native-sse';
import type {ChatMessage} from '../types/chat';

export interface OpenAIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function toOpenAIMessages(messages: ChatMessage[]): OpenAIMessage[] {
  return messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.text.trim())
    .map(m => ({role: m.role as 'user' | 'assistant', content: m.text}));
}

export interface StreamChatParams {
  subDomain: string;
  deviceToken: string;
  messages: OpenAIMessage[];
  model?: string;
  onDelta: (fullText: string) => void;
  onDone: (fullText: string) => void;
  onError: (message: string) => void;
}

export interface StreamHandle {
  abort: () => void;
}

// Streams a chat completion from the selected memory box's hermes agent
// (POST {subDomain}.remote.seemem.com/api/chat/completions, SSE).
// React Native's fetch can't read a streaming response body, so we use
// react-native-sse (XHR-based) which supports POST + custom headers.
export function streamChat(params: StreamChatParams): StreamHandle {
  const {subDomain, deviceToken, messages, model = 'SeeMemory LLM', onDelta, onDone, onError} = params;

  const url = `https://${subDomain}.remote.seemem.com/api/chat/completions`;
  let assistantText = '';
  let finished = false;

  const es = new EventSource(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deviceToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({model, messages, stream: true}),
    // Disable auto-reconnect: a chat completion is a one-shot stream.
    pollingInterval: 0,
    timeout: 60000,
  });

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

  es.addEventListener('message', event => {
    const data = (event.data || '').trim();
    if (!data || data === '[DONE]') {
      if (data === '[DONE]') {
        finish('done');
      }
      return;
    }
    try {
      const parsed = JSON.parse(data);
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) {
        assistantText += delta;
        onDelta(assistantText);
      }
    } catch {
      // skip malformed/keep-alive chunks
    }
  });

  es.addEventListener('error', event => {
    const message =
      'message' in event && event.message
        ? event.message
        : `连接出错（${'xhrStatus' in event ? event.xhrStatus : ''}）`;
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
