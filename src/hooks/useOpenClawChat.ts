import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {GatewayClient} from '../openclaw/GatewayClient';
import {uploadImageFile} from '../services/api';
import {
  OpenClawChatClient,
  extractText,
  normalizeHistoryMessages,
  normalizeSessionList,
} from '../openclaw/OpenClawChatClient';
import {GatewaySettingsStore} from '../storage/GatewaySettingsStore';
import type {
  ChatEventPayload,
  ChatMessage,
  ConnectionState,
  GatewaySettings,
  SessionListItem,
} from '../openclaw/types';

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function upsertAssistantMessage(
  messages: ChatMessage[],
  payload: ChatEventPayload,
): ChatMessage[] {
  const text = extractText(payload.message);
  const runId = payload.runId || createMessageId('run');
  const existingIndex = messages.findIndex(
    item => item.role === 'assistant' && item.runId === runId,
  );

  if (payload.state === 'delta') {
    if (existingIndex >= 0) {
      const nextMessages = [...messages];
      const current = nextMessages[existingIndex];
      nextMessages[existingIndex] = {
        ...current,
        text: `${current.text}${text}`,
        isStreaming: true,
      };
      return nextMessages;
    }

    return [
      ...messages,
      {
        id: createMessageId('assistant'),
        role: 'assistant',
        text,
        isStreaming: true,
        runId,
      },
    ];
  }

  if (payload.state === 'final') {
    if (existingIndex >= 0) {
      const nextMessages = [...messages];
      const current = nextMessages[existingIndex];
      nextMessages[existingIndex] = {
        ...current,
        text: text || current.text,
        isStreaming: false,
      };
      return nextMessages;
    }

    if (!text) {
      return messages;
    }

    return [
      ...messages,
      {
        id: createMessageId('assistant'),
        role: 'assistant',
        text,
        isStreaming: false,
        runId,
      },
    ];
  }

  return messages;
}

function finalizeAssistantRun(messages: ChatMessage[], runId?: string): ChatMessage[] {
  if (!runId) {
    return messages.map(item =>
      item.role === 'assistant' && item.isStreaming
        ? {...item, isStreaming: false}
        : item,
    );
  }

  return messages.map(item =>
    item.role === 'assistant' && item.runId === runId
      ? {...item, isStreaming: false}
      : item,
  );
}

export function useOpenClawChat() {
  const [settings, setSettings] = useState<GatewaySettings>({
    url: '',
    token: '',
  });
  const [draftSessionKey, setDraftSessionKey] = useState('main');
  const [activeSessionKey, setActiveSessionKey] = useState('main');
  const [sessionKeys, setSessionKeys] = useState<string[]>(['main']);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('loading');
  const [statusText, setStatusText] = useState('正在读取配置...');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'system-initial',
      role: 'system',
      text: '请先填写 Gateway 地址和 Token，然后点击连接。',
    },
  ]);
  const [isSending, setIsSending] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const gatewayRef = useRef<GatewayClient | null>(null);
  const chatRef = useRef<OpenClawChatClient | null>(null);
  const unsubscribeStatusRef = useRef<(() => void) | null>(null);
  const unsubscribeChatRef = useRef<(() => void) | null>(null);
  const lastStatusDetailRef = useRef<string>('');

  useEffect(() => {
    let active = true;

    const hydrate = async () => {
      const [nextSettings, storedSessionKeys] = await Promise.all([
        GatewaySettingsStore.load(),
        GatewaySettingsStore.loadSessionKeys(),
      ]);
      if (!active) {
        return;
      }

      setSettings(nextSettings);
      setSessionKeys(storedSessionKeys);
      setSessions(storedSessionKeys.map(key => ({key, title: key})));
      setDraftSessionKey(storedSessionKeys[0] || 'main');
      setActiveSessionKey(storedSessionKeys[0] || 'main');
      setConnectionState('idle');
      setStatusText('待连接');
      setIsHydrated(true);
    };

    void hydrate();

    return () => {
      active = false;
      unsubscribeStatusRef.current?.();
      unsubscribeChatRef.current?.();
      gatewayRef.current?.disconnect({emitStatus: false});
    };
  }, []);

  const appendSystemMessage = useCallback((text: string) => {
    setMessages(prev => {
      if (prev[prev.length - 1]?.role === 'system' && prev[prev.length - 1]?.text === text) {
        return prev;
      }

      return [
        ...prev,
        {
          id: createMessageId('system'),
          role: 'system',
          text,
        },
      ];
    });
  }, []);

  const handleChatEvent = useCallback((payload: ChatEventPayload) => {
    if (payload.state === 'error' || payload.state === 'aborted') {
      setIsSending(false);
      setMessages(prev => finalizeAssistantRun(prev, payload.runId));
      appendSystemMessage(
        payload.state === 'aborted'
          ? '本轮回复已中断。'
          : `回复出错：${payload.errorMessage || '未知错误'}`,
      );
      return;
    }

    setMessages(prev => upsertAssistantMessage(prev, payload));

    if (payload.state === 'final') {
      setIsSending(false);
    }
  }, [appendSystemMessage]);

  const persistSessionKeys = useCallback(async (keys: string[]) => {
    setSessionKeys(keys);
    await GatewaySettingsStore.saveSessionKeys(keys);
  }, []);

  const mergeSessions = useCallback((items: SessionListItem[], preferredKey?: string) => {
    setSessions(prev => {
      const map = new Map<string, SessionListItem>();
      prev.forEach(item => map.set(item.key, item));
      items.forEach(item => {
        map.set(item.key, {
          ...map.get(item.key),
          ...item,
        });
      });
      const merged = Array.from(map.values()).sort((left, right) => {
        if (preferredKey && left.key === preferredKey) {
          return -1;
        }
        if (preferredKey && right.key === preferredKey) {
          return 1;
        }
        return (right.updatedAt || 0) - (left.updatedAt || 0);
      });
      return merged;
    });
  }, []);

  const ensureLocalSessionKey = useCallback(async (key: string) => {
    const normalized = key.trim() || 'main';
    const nextKeys = Array.from(new Set([normalized, ...sessionKeys]));
    await persistSessionKeys(nextKeys);
    mergeSessions([{key: normalized, title: normalized}], normalized);
    return normalized;
  }, [mergeSessions, persistSessionKeys, sessionKeys]);

  const refreshSessions = useCallback(async () => {
    if (!chatRef.current) {
      return;
    }
    try {
      const result = await chatRef.current.listSessions();
      const remoteSessions = normalizeSessionList(result.sessions);
      mergeSessions(
        remoteSessions.length > 0
          ? remoteSessions
          : sessionKeys.map(key => ({key, title: key})),
        activeSessionKey,
      );
    } catch {
      mergeSessions(sessionKeys.map(key => ({key, title: key})), activeSessionKey);
    }
  }, [activeSessionKey, mergeSessions, sessionKeys]);

  const loadSessionHistory = useCallback(async (sessionKey: string) => {
    if (!chatRef.current) {
      appendSystemMessage('请先连接 Gateway，再读取会话历史。');
      return false;
    }

    try {
      const normalizedKey = await ensureLocalSessionKey(sessionKey);
      const history = await chatRef.current.getHistory(normalizedKey, 100);
      const historyMessages = normalizeHistoryMessages(history.messages);
      setMessages(
        historyMessages.length > 0
          ? historyMessages
          : [
              {
                id: createMessageId('system'),
                role: 'system',
                text: `会话 ${normalizedKey} 暂无历史消息。`,
              },
            ],
      );
      setActiveSessionKey(normalizedKey);
      setDraftSessionKey(normalizedKey);
      mergeSessions(
        [
          {
            key: normalizedKey,
            sessionId: history.sessionId,
            title: normalizedKey,
            updatedAt: Date.now(),
          },
        ],
        normalizedKey,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取历史失败';
      appendSystemMessage(`读取历史失败：${message}`);
      return false;
    }
  }, [appendSystemMessage, ensureLocalSessionKey, mergeSessions]);

  const updateSetting = useCallback(
    (key: keyof GatewaySettings, value: string) => {
      setSettings(prev => ({
        ...prev,
        [key]: value,
      }));
    },
    [],
  );

  const disconnect = useCallback(() => {
    setIsSending(false);
    gatewayRef.current?.disconnect();
  }, []);

  const connect = useCallback(async () => {
    const trimmedSettings = {
      url: settings.url.trim(),
      token: settings.token.trim(),
    };

    if (!trimmedSettings.url || !trimmedSettings.token) {
      setConnectionState('error');
      setStatusText('请先填写 Gateway 地址和 Token');
      appendSystemMessage('连接失败：地址或 Token 为空。');
      return;
    }

    unsubscribeStatusRef.current?.();
    unsubscribeChatRef.current?.();
    gatewayRef.current?.disconnect({emitStatus: false});

    const gateway = new GatewayClient();
    const chat = new OpenClawChatClient(gateway);
    gatewayRef.current = gateway;
    chatRef.current = chat;
    lastStatusDetailRef.current = '';

    unsubscribeStatusRef.current = gateway.onStatus(status => {
      setConnectionState(status.state);
      setStatusText(status.detail);
      if (
        status.detail &&
        status.detail !== lastStatusDetailRef.current &&
        (status.state === 'connected' ||
          status.state === 'disconnected' ||
          status.state === 'error')
      ) {
        lastStatusDetailRef.current = status.detail;
        appendSystemMessage(status.detail);
      }
    });

    unsubscribeChatRef.current = chat.subscribe(handleChatEvent);

    setConnectionState('connecting');
    setStatusText('正在发起连接...');

    try {
      await GatewaySettingsStore.save(trimmedSettings);
      await gateway.connect(trimmedSettings.url, trimmedSettings.token);
      await refreshSessions();
      await loadSessionHistory(activeSessionKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接失败';
      setConnectionState('error');
      setStatusText(message);
      appendSystemMessage(`连接失败：${message}`);
    }
  }, [activeSessionKey, appendSystemMessage, handleChatEvent, loadSessionHistory, refreshSessions, settings]);

  const createSession = useCallback(async () => {
    const normalizedKey = await ensureLocalSessionKey(draftSessionKey || 'main');
    setActiveSessionKey(normalizedKey);
    setDraftSessionKey(normalizedKey);
    setMessages([
      {
        id: createMessageId('system'),
        role: 'system',
        text: `已切换到新会话 ${normalizedKey}。连接后即可开始对话。`,
      },
    ]);
    if (connectionState === 'connected') {
      await loadSessionHistory(normalizedKey);
      await refreshSessions();
    }
  }, [connectionState, draftSessionKey, ensureLocalSessionKey, loadSessionHistory, refreshSessions]);

  const selectSession = useCallback(async (sessionKey: string) => {
    await loadSessionHistory(sessionKey);
  }, [loadSessionHistory]);

  const sendMessage = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content) {
      return false;
    }

    if (!chatRef.current || connectionState !== 'connected') {
      appendSystemMessage('请先连接 Gateway，再发送消息。');
      return false;
    }

    setMessages(prev => [
      ...prev,
      {
        id: createMessageId('user'),
        role: 'user',
        text: content,
      },
    ]);
    setIsSending(true);

    try {
      await ensureLocalSessionKey(activeSessionKey);
      await chatRef.current.sendMessage(activeSessionKey, content);
      mergeSessions([{key: activeSessionKey, title: activeSessionKey, updatedAt: Date.now()}], activeSessionKey);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '发送失败';
      setIsSending(false);
      appendSystemMessage(`发送失败：${message}`);
      return false;
    }
  }, [activeSessionKey, appendSystemMessage, connectionState, ensureLocalSessionKey, mergeSessions]);

  const sendImageMessage = useCallback(
    async (params: {filePath: string; mimeType?: string; text?: string}) => {
      if (!chatRef.current || connectionState !== 'connected') {
        appendSystemMessage('请先连接 Gateway，再上传图片。');
        return false;
      }

      setIsUploadingImage(true);

      try {
        const uploadResponse = await uploadImageFile(
          undefined,
          params.filePath,
          params.mimeType,
        );
        const objectUrl = uploadResponse.result?.objectUrl?.trim();
        if (!objectUrl) {
          throw new Error('图片上传成功，但未拿到 objectUrl');
        }

        const textPart = params.text?.trim() || '';
        const message = textPart ? `${objectUrl}\n${textPart}` : objectUrl;
        return await sendMessage(message);
      } catch (error) {
        const message = error instanceof Error ? error.message : '图片上传失败';
        appendSystemMessage(`图片上传失败：${message}`);
        return false;
      } finally {
        setIsUploadingImage(false);
      }
    },
    [appendSystemMessage, connectionState, sendMessage],
  );

  return useMemo(
    () => ({
      settings,
      draftSessionKey,
      activeSessionKey,
      sessionKeys,
      sessions,
      isHydrated,
      connectionState,
      statusText,
      messages,
      isSending,
      isUploadingImage,
      updateSetting,
      setDraftSessionKey,
      connect,
      disconnect,
      createSession,
      selectSession,
      refreshSessions,
      sendMessage,
      sendImageMessage,
    }),
    [
      settings,
      draftSessionKey,
      activeSessionKey,
      sessionKeys,
      sessions,
      isHydrated,
      connectionState,
      statusText,
      messages,
      isSending,
      isUploadingImage,
      updateSetting,
      setDraftSessionKey,
      connect,
      disconnect,
      createSession,
      selectSession,
      refreshSessions,
      sendMessage,
      sendImageMessage,
    ],
  );
}
