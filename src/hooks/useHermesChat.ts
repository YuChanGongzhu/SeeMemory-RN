import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useAuth} from '../auth/AuthContext';
import {streamChat, toOpenAIMessages, type StreamHandle} from '../services/hermesChat';
import {uploadImageFile} from '../services/api';
import {loadChatHistory, saveChatHistory, clearChatHistory} from '../services/chatHistoryStore';
import type {ChatMessage} from '../types/chat';

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// 聊天历史按登录用户维度持久化。后端 /app/chat 本就是按用户分流（与选中的记忆盒子无关），
// 因此用固定的单会话 key —— 避免「未选盒子 / 盒子水合竞态」时 boxId 为空，导致历史存不下来
// （表现为每次重开对话都被清空）。登出时统一清除，避免换账号后串台。
const CHAT_SESSION_KEY = 'self';

export function useHermesChat() {
  const {selectedDevice} = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const streamRef = useRef<StreamHandle | null>(null);
  // 已从磁盘水合完成的标记：水合前不回写，避免用空历史覆盖已存的会话。
  const hydratedRef = useRef(false);

  useEffect(() => {
    return () => {
      streamRef.current?.abort();
    };
  }, []);

  // 挂载时加载已持久化的会话历史（单用户单会话，不随记忆盒子切换而清空）。
  useEffect(() => {
    let cancelled = false;
    loadChatHistory(CHAT_SESSION_KEY).then(history => {
      if (cancelled) return;
      // 若用户在磁盘读完成前已开始发消息，则保留其消息，不被历史覆盖。
      setMessages(prev => (prev.length ? prev : history));
      hydratedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 持久化历史；水合完成前 / 流式期间跳过（避免每个 delta 都写一次盘）。
  useEffect(() => {
    if (!hydratedRef.current || isSending) {
      return;
    }
    saveChatHistory(CHAT_SESSION_KEY, messages);
  }, [messages, isSending]);

  const appendSystemMessage = useCallback((text: string) => {
    setMessages(prev => [
      ...prev,
      {id: createMessageId('system'), role: 'system', text},
    ]);
  }, []);

  const send = useCallback(
    async (
      text: string,
      attachment?: {audioPath?: string; audioDurationMs?: number},
    ): Promise<boolean> => {
      const content = text.trim();
      if (!content) {
        return false;
      }
      // /app/chat 按登录用户维度，后端自动分流云端/本地盒子，无需选中设备。
      if (isSending) {
        return false;
      }

      const userMessage: ChatMessage = {
        id: createMessageId('user'),
        role: 'user',
        text: content,
        // 语音消息：气泡展示可回听的音频卡片；发给 agent 的仍是转写文本(content)。
        ...(attachment?.audioPath ? {audioPath: attachment.audioPath} : {}),
        ...(attachment?.audioDurationMs ? {audioDurationMs: attachment.audioDurationMs} : {}),
      };
      const assistantId = createMessageId('assistant');
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        text: '',
        isStreaming: true,
      };

      const outbound = toOpenAIMessages([...messages, userMessage]);
      setMessages(prev => [...prev, userMessage, assistantMessage]);
      setIsSending(true);

      return new Promise<boolean>(resolve => {
        const updateAssistant = (patch: Partial<ChatMessage>) => {
          setMessages(prev =>
            prev.map(m => (m.id === assistantId ? {...m, ...patch} : m)),
          );
        };

        streamRef.current = streamChat({
          messages: outbound,
          onDelta: fullText => updateAssistant({text: fullText, isStreaming: true}),
          onDone: fullText => {
            updateAssistant({
              text: fullText || '（无回复内容）',
              isStreaming: false,
            });
            streamRef.current = null;
            setIsSending(false);
            resolve(true);
          },
          onError: message => {
            // Drop the empty placeholder, surface the error as a system line.
            setMessages(prev => prev.filter(m => m.id !== assistantId));
            appendSystemMessage(`回复出错：${message}`);
            streamRef.current = null;
            setIsSending(false);
            resolve(false);
          },
        });
      });
    },
    [appendSystemMessage, isSending, messages],
  );

  const sendImageMessage = useCallback(
    async (params: {filePath: string; mimeType?: string; text?: string}): Promise<boolean> => {
      if (!selectedDevice) {
        appendSystemMessage('请先在「设置」中选择一个记忆盒子，再上传图片。');
        return false;
      }
      setIsUploadingImage(true);
      try {
        const uploadResponse = await uploadImageFile(undefined, params.filePath, params.mimeType);
        const objectUrl = uploadResponse.result?.objectUrl?.trim();
        if (!objectUrl) {
          throw new Error('图片上传成功，但未拿到 objectUrl');
        }
        const textPart = params.text?.trim() || '';
        const message = textPart ? `${objectUrl}\n${textPart}` : objectUrl;
        return await send(message);
      } catch (error) {
        appendSystemMessage(
          `图片上传失败：${error instanceof Error ? error.message : '未知错误'}`,
        );
        return false;
      } finally {
        setIsUploadingImage(false);
      }
    },
    [appendSystemMessage, selectedDevice, send],
  );

  // 语音消息：气泡展示可本地回听的音频卡片，发给 agent 的是转写文本。
  const sendVoice = useCallback(
    async (params: {filePath: string; durationMs: number; text: string}): Promise<boolean> => {
      return send(params.text, {audioPath: params.filePath, audioDurationMs: params.durationMs});
    },
    [send],
  );

  const reset = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    setMessages([]);
    setIsSending(false);
    clearChatHistory(CHAT_SESSION_KEY);
  }, []);

  return useMemo(
    () => ({
      selectedDevice,
      messages,
      isSending,
      isUploadingImage,
      send,
      sendImageMessage,
      sendVoice,
      reset,
    }),
    [selectedDevice, messages, isSending, isUploadingImage, send, sendImageMessage, sendVoice, reset],
  );
}
