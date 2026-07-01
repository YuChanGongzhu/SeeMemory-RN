import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useAuth} from '../auth/AuthContext';
import {streamChat, toOpenAIMessages, type StreamHandle} from '../services/hermesChat';
import {uploadImageFile} from '../services/api';
import {loadChatHistory, saveChatHistory, clearChatHistory} from '../services/chatHistoryStore';
import type {ChatMessage} from '../types/chat';

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useHermesChat() {
  const {selectedDevice} = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const streamRef = useRef<StreamHandle | null>(null);
  const boxId = selectedDevice?.subDomain || '';
  // 标记当前已水合完成的盒子，避免水合前就把空历史写回覆盖磁盘。
  const hydratedBoxRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.abort();
    };
  }, []);

  // 切换盒子：中断当前流，加载该盒子已持久化的历史（每个盒子独立会话）。
  useEffect(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    setIsSending(false);
    setMessages([]);
    hydratedBoxRef.current = null;

    if (!boxId) {
      hydratedBoxRef.current = '';
      return;
    }
    let cancelled = false;
    loadChatHistory(boxId).then(history => {
      if (cancelled) return;
      setMessages(history);
      hydratedBoxRef.current = boxId;
    });
    return () => {
      cancelled = true;
    };
  }, [boxId]);

  // 按盒子持久化历史；流式期间跳过，避免每个 delta 都写一次盘。
  useEffect(() => {
    if (!boxId || hydratedBoxRef.current !== boxId || isSending) {
      return;
    }
    saveChatHistory(boxId, messages);
  }, [boxId, messages, isSending]);

  const appendSystemMessage = useCallback((text: string) => {
    setMessages(prev => [
      ...prev,
      {id: createMessageId('system'), role: 'system', text},
    ]);
  }, []);

  const send = useCallback(
    async (text: string): Promise<boolean> => {
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

  const reset = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    setMessages([]);
    setIsSending(false);
    if (boxId) {
      clearChatHistory(boxId);
    }
  }, [boxId]);

  return useMemo(
    () => ({
      selectedDevice,
      messages,
      isSending,
      isUploadingImage,
      send,
      sendImageMessage,
      reset,
    }),
    [selectedDevice, messages, isSending, isUploadingImage, send, sendImageMessage, reset],
  );
}
