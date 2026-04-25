import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Alert,
  Image,
  Modal,
  Pressable,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useOpenClawChat} from '../hooks/useOpenClawChat';
import {pickImageFromLibrary} from '../native/ImagePickerModule';
import type {ChatMessage, SessionListItem} from '../openclaw/types';
import {ChatComposerDraftStore, type ChatComposerDraft} from '../storage/ChatComposerDraftStore';

type BubblePart =
  | {
      type: 'text';
      content: string;
    }
  | {
      type: 'image';
      url: string;
    }
  | {
      type: 'audio';
      url: string;
    };

function detectMediaKind(url: string): 'image' | 'audio' | null {
  const cleanUrl = url.split('?')[0]?.toLowerCase() || '';
  if (/\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(cleanUrl)) {
    return 'image';
  }
  if (/\.(wav|mp3|m4a|aac|ogg|opus|flac)$/i.test(cleanUrl)) {
    return 'audio';
  }
  return null;
}

function buildDraftMessage(draft: ChatComposerDraft): string {
  const text = draft.text?.trim() || '';
  const mediaUrl = draft.mediaUrl?.trim() || '';
  if (mediaUrl && text) {
    return `${mediaUrl}\n${text}`;
  }
  return mediaUrl || text;
}

function buildDraftKey(draft: ChatComposerDraft): string {
  return [
    draft.createdAt,
    draft.mediaUrl?.trim() || '',
    draft.text?.trim() || '',
  ].join('::');
}

function normalizeBubbleText(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function buildBubbleParts(text: string, role: ChatMessage['role']): BubblePart[] {
  const firstLine = text.split('\n')[0]?.trim() || '';
  const workingText =
    role === 'user' && /^https?:\/\/\S+$/i.test(firstLine)
      ? `MEDIA:${firstLine}\n${text.split('\n').slice(1).join('\n')}`
      : text;
  const parts: BubblePart[] = [];
  const lines = workingText.split('\n');
  let textBuffer: string[] = [];

  const flushTextBuffer = () => {
    const combined = normalizeBubbleText(textBuffer.join('\n').replace(/[ \t]+\n/g, '\n'));
    if (combined) {
      parts.push({
        type: 'text',
        content: combined,
      });
    }
    textBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const mediaMatch = line.match(/^MEDIA:\s*(https?:\/\/\S+)$/i);

    if (mediaMatch?.[1]) {
      flushTextBuffer();
      const mediaUrl = mediaMatch[1].trim();
      const mediaKind = detectMediaKind(mediaUrl);

      if (mediaKind === 'image') {
        parts.push({
          type: 'image',
          url: mediaUrl,
        });
      } else if (mediaKind === 'audio') {
        parts.push({
          type: 'audio',
          url: mediaUrl,
        });
      } else {
        textBuffer.push(mediaUrl);
      }
      continue;
    }

    textBuffer.push(rawLine);
  }

  flushTextBuffer();

  if (parts.length === 0) {
    const normalized = normalizeBubbleText(text);
    if (normalized) {
      parts.push({
        type: 'text',
        content: normalized,
      });
    }
  }

  return parts;
}

export function MemoryScreen() {
  const insets = useSafeAreaInsets();
  const [inputText, setInputText] = useState('');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [pendingComposerDraft, setPendingComposerDraft] = useState<ChatComposerDraft | null>(null);
  const [debugMessage, setDebugMessage] = useState<ChatMessage | null>(null);
  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  const activeAutoSendDraftKeyRef = useRef<string | null>(null);
  const debugTapRef = useRef<{
    messageId: string | null;
    count: number;
    timer: ReturnType<typeof setTimeout> | null;
  }>({
    messageId: null,
    count: 0,
    timer: null,
  });
  const {
    settings,
    draftSessionKey,
    activeSessionKey,
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
  } = useOpenClawChat();

  useEffect(() => {
    let active = true;

    const applyDraft = (draft: ChatComposerDraft | null) => {
      if (!active || (!draft?.text?.trim() && !draft?.mediaUrl?.trim())) {
        return;
      }
      setPendingComposerDraft(draft);
    };

    const unsubscribe = ChatComposerDraftStore.subscribe(draft => {
      applyDraft(draft);
    });

    void ChatComposerDraftStore.load().then(draft => {
      applyDraft(draft);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!pendingComposerDraft) {
      return;
    }

    const draftText = buildDraftMessage(pendingComposerDraft).trim();
    const draftKey = buildDraftKey(pendingComposerDraft);

    if (!draftText) {
      setPendingComposerDraft(null);
      activeAutoSendDraftKeyRef.current = null;
      void ChatComposerDraftStore.clear();
      return;
    }

    if (!isConnected || isSending || isUploadingImage) {
      return;
    }

    if (activeAutoSendDraftKeyRef.current === draftKey) {
      return;
    }

    let cancelled = false;
    activeAutoSendDraftKeyRef.current = draftKey;

    void (async () => {
      setPendingComposerDraft(current =>
        current && buildDraftKey(current) === draftKey ? null : current,
      );
      await ChatComposerDraftStore.clear();
      setInputText('');
      const sent = await sendMessage(draftText);
      if (cancelled) {
        if (activeAutoSendDraftKeyRef.current === draftKey) {
          activeAutoSendDraftKeyRef.current = null;
        }
        return;
      }

      if (activeAutoSendDraftKeyRef.current === draftKey) {
        activeAutoSendDraftKeyRef.current = null;
      }

      if (sent) {
        return;
      }

      setInputText(current => (current.trim() ? current : draftText));
    })();

    return () => {
      cancelled = true;
    };
  }, [isConnected, isSending, isUploadingImage, pendingComposerDraft, sendMessage]);

  const handleSend = async () => {
    if (!inputText.trim()) return;
    const messageToSend = inputText;
    setInputText('');
    const sent = await sendMessage(messageToSend);
    if (sent) {
      setInputText('');
      return;
    }
    setInputText(messageToSend);
  };

  const handlePickImage = async () => {
    try {
      const picked = await pickImageFromLibrary();
      if (!picked || picked.didCancel || !picked.filePath) {
        return;
      }

      const sent = await sendImageMessage({
        filePath: picked.filePath,
        mimeType: picked.mimeType,
        text: inputText,
      });

      if (sent) {
        setInputText('');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '选择图片失败';
      Alert.alert('图片发送失败', message);
    }
  };

  const isConnected = connectionState === 'connected';
  const canSend = isConnected && !isSending && !isUploadingImage && !!inputText.trim();
  const canPickImage = isConnected && !isSending && !isUploadingImage;
  const statusColor = useMemo(() => {
    switch (connectionState) {
      case 'connected':
        return '#4CAF50';
      case 'connecting':
      case 'loading':
        return '#FF9800';
      case 'error':
        return '#F44336';
      default:
        return '#666666';
    }
  }, [connectionState]);

  const handleDebugTap = (item: ChatMessage) => {
    if (item.role !== 'assistant' || !item.debugRaw) {
      return;
    }

    if (debugTapRef.current.timer) {
      clearTimeout(debugTapRef.current.timer);
    }

    if (debugTapRef.current.messageId === item.id) {
      debugTapRef.current.count += 1;
    } else {
      debugTapRef.current.messageId = item.id;
      debugTapRef.current.count = 1;
    }

    if (debugTapRef.current.count >= 5) {
      debugTapRef.current.messageId = null;
      debugTapRef.current.count = 0;
      debugTapRef.current.timer = null;
      setDebugMessage(item);
      return;
    }

    debugTapRef.current.timer = setTimeout(() => {
      debugTapRef.current.messageId = null;
      debugTapRef.current.count = 0;
      debugTapRef.current.timer = null;
    }, 1400);
  };

  const debugText = useMemo(() => {
    if (!debugMessage?.debugRaw) {
      return '';
    }

    try {
      return JSON.stringify(debugMessage.debugRaw, null, 2);
    } catch {
      return String(debugMessage.debugRaw);
    }
  }, [debugMessage]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <View>
          <Text style={styles.title}>AI Chat Demo</Text>
          <Text style={styles.subtitle}>基于 openclaw-demo 的最小可演示版本</Text>
        </View>
        <Text style={styles.recordIcon}>💬</Text>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({animated: true})}
        ListHeaderComponent={
          <View style={styles.configCard}>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, {backgroundColor: statusColor}]} />
              <Text style={styles.statusText}>{statusText}</Text>
            </View>

            <Text style={styles.sectionLabel}>Gateway URL</Text>
            <TextInput
              style={styles.configInput}
              placeholder="ws://43.136.45.132:18789"
              placeholderTextColor="#666"
              autoCapitalize="none"
              autoCorrect={false}
              value={settings.url}
              onChangeText={value => updateSetting('url', value)}
            />

            <Text style={styles.sectionLabel}>Token</Text>
            <TextInput
              style={styles.configInput}
              placeholder="demo-token-123"
              placeholderTextColor="#666"
              autoCapitalize="none"
              autoCorrect={false}
              value={settings.token}
              onChangeText={value => updateSetting('token', value)}
            />

            <Text style={styles.sectionLabel}>New Session Key</Text>
            <View style={styles.sessionCreateRow}>
              <TextInput
                style={[styles.configInput, styles.sessionInput]}
                placeholder="main"
                placeholderTextColor="#666"
                autoCapitalize="none"
                autoCorrect={false}
                value={draftSessionKey}
                onChangeText={setDraftSessionKey}
              />
              <TouchableOpacity
                style={styles.newSessionButton}
                onPress={createSession}>
                <Text style={styles.newSessionButtonText}>新开会话</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.sessionHint}>
              当前激活会话为 `{activeSessionKey}`。输入框只用于新开会话，不会直接改写当前会话。
            </Text>

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.primaryAction, !isHydrated && styles.disabledAction]}
                disabled={!isHydrated || connectionState === 'connecting'}
                onPress={connect}>
                {connectionState === 'connecting' ? (
                  <ActivityIndicator size="small" color="#0D0D0D" />
                ) : (
                  <Text style={styles.primaryActionText}>
                    {isConnected ? '重新连接' : '连接'}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryAction, !isConnected && styles.disabledSecondary]}
                disabled={!isConnected}
                onPress={disconnect}>
                <Text style={styles.secondaryActionText}>断开</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sessionListHeader}>
              <Text style={styles.aiTitle}>会话列表</Text>
              <TouchableOpacity
                style={styles.refreshLink}
                onPress={refreshSessions}
                disabled={!isConnected}>
                <Text style={styles.refreshLinkText}>刷新</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.sessionList}>
              {sessions.map(item => (
                <SessionChip
                  key={item.key}
                  item={item}
                  active={item.key === activeSessionKey}
                  onPress={selectSession}
                />
              ))}
            </ScrollView>

            <View style={styles.welcomeCard}>
              <Text style={styles.aiTitle}>演示说明</Text>
              <Text style={styles.aiSubtitle}>
                现在页面支持手动创建 `sessionKey`、本地记住会话键，并通过
                `sessions.list` 和 `chat.history` 拉取不同会话内容。
              </Text>
            </View>
          </View>
        }
        renderItem={({item}) => (
          <ChatBubble
            item={item}
            onPreviewImage={setPreviewImageUrl}
            onDebugTap={handleDebugTap}
          />
        )}
        ListEmptyComponent={
          isHydrated ? (
            <Text style={styles.emptyText}>连接成功后就可以开始演示对话了</Text>
          ) : null
        }
      />

      <View style={styles.inputContainer}>
        <TouchableOpacity
          style={[styles.mediaBtn, !canPickImage && styles.disabledSendBtn]}
          onPress={handlePickImage}
          disabled={!canPickImage}>
          <Text style={styles.mediaBtnText}>{isUploadingImage ? '上传中' : '图片'}</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder={isConnected ? '输入消息开始演示...' : '请先连接 Gateway'}
          placeholderTextColor="#666"
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
          editable={isConnected && !isSending && !isUploadingImage}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, !canSend && styles.disabledSendBtn]}
          onPress={handleSend}
          disabled={!canSend}>
          <Text style={styles.sendBtnText}>
            {isUploadingImage ? '上传中' : isSending ? '等待中' : '发送'}
          </Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={!!previewImageUrl}
        animationType="fade"
        transparent
        onRequestClose={() => setPreviewImageUrl(null)}>
        <Pressable
          style={styles.previewOverlay}
          onPress={() => setPreviewImageUrl(null)}>
          <Pressable style={styles.previewCard} onPress={() => {}}>
            {previewImageUrl ? (
              <Image
                source={{uri: previewImageUrl}}
                style={styles.previewImage}
                resizeMode="contain"
              />
            ) : null}
            <TouchableOpacity
              style={styles.previewCloseButton}
              onPress={() => setPreviewImageUrl(null)}>
              <Text style={styles.previewCloseText}>关闭</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={!!debugMessage}
        animationType="slide"
        transparent
        onRequestClose={() => setDebugMessage(null)}>
        <Pressable
          style={styles.previewOverlay}
          onPress={() => setDebugMessage(null)}>
          <Pressable style={[styles.previewCard, styles.debugCard]} onPress={() => {}}>
            <Text style={styles.debugModalTitle}>
              原始响应 · {debugMessage?.debugSource === 'history' ? 'history' : 'event'}
            </Text>
            <ScrollView style={styles.debugScroll} contentContainerStyle={styles.debugScrollContent}>
              <Text selectable style={styles.debugModalText}>
                {debugText}
              </Text>
            </ScrollView>
            <TouchableOpacity
              style={styles.previewCloseButton}
              onPress={() => setDebugMessage(null)}>
              <Text style={styles.previewCloseText}>关闭</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function ChatBubble(params: {
  item: ChatMessage;
  onPreviewImage: (url: string) => void;
  onDebugTap: (item: ChatMessage) => void;
}) {
  const {item, onPreviewImage, onDebugTap} = params;
  const isSystem = item.role === 'system';
  const isUser = item.role === 'user';
  const isAssistant = item.role === 'assistant';
  const parts = buildBubbleParts(item.text, item.role);
  const lastTextPartIndex = [...parts]
    .map((part, index) => ({part, index}))
    .filter(entry => entry.part.type === 'text')
    .at(-1)?.index;
  const shouldRenderStreamingCursor = item.isStreaming && lastTextPartIndex == null;

  return (
    <View
      style={[
        styles.messageBubble,
        isUser && styles.userBubble,
        item.role === 'assistant' && styles.assistantBubble,
        isSystem && styles.systemBubble,
      ]}
      onStartShouldSetResponder={() => isAssistant}
      onResponderRelease={() => {
        if (isAssistant) {
          onDebugTap(item);
        }
      }}>
      {parts.map((part, index) =>
        part.type === 'image' ? (
          <TouchableOpacity
            key={`${part.url}-${index}`}
            activeOpacity={0.9}
            onPress={() => {
              onDebugTap(item);
              onPreviewImage(part.url);
            }}>
            <Image
              source={{uri: part.url}}
              style={styles.imageBubblePreview}
              resizeMode="cover"
            />
          </TouchableOpacity>
        ) : part.type === 'audio' ? (
          <View key={`${part.url}-${index}`} style={styles.audioBubbleCard}>
            <Text
              style={[
                styles.audioBubbleLabel,
                isUser && styles.userBubbleText,
                isSystem && styles.systemBubbleText,
              ]}>
              音频附件
            </Text>
            <Text
              selectable
              style={[
                styles.audioBubbleUrl,
                isUser && styles.userBubbleText,
                isSystem && styles.systemBubbleText,
              ]}>
              {part.url}
            </Text>
          </View>
        ) : (
          <Text
            key={`${part.content.slice(0, 24)}-${index}`}
            style={[
              styles.messageText,
              isUser && styles.userBubbleText,
              isSystem && styles.systemBubbleText,
            ]}>
            {part.content}
            {item.isStreaming && lastTextPartIndex === index ? '▋' : ''}
          </Text>
        ),
      )}
      {shouldRenderStreamingCursor ? (
        <Text
          style={[
            styles.messageText,
            isUser && styles.userBubbleText,
            isSystem && styles.systemBubbleText,
          ]}>
          ▋
        </Text>
      ) : null}
    </View>
  );
}

function SessionChip(params: {
  item: SessionListItem;
  active: boolean;
  onPress: (sessionKey: string) => void;
}) {
  const label = params.item.title || params.item.key;

  return (
    <TouchableOpacity
      style={[styles.sessionChip, params.active && styles.sessionChipActive]}
      onPress={() => params.onPress(params.item.key)}>
      <Text style={[styles.sessionChipText, params.active && styles.sessionChipTextActive]}>
        {label}
      </Text>
      <Text style={styles.sessionChipSubtext}>{params.item.key}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  title: {
    color: '#E5E5E5',
    fontSize: 20,
    fontWeight: '600',
  },
  subtitle: {
    color: '#666',
    fontSize: 12,
    marginTop: 4,
  },
  recordIcon: {
    fontSize: 20,
  },
  list: {
    padding: 16,
    gap: 10,
  },
  configCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginRight: 10,
  },
  statusText: {
    color: '#AAAAAA',
    fontSize: 13,
  },
  sectionLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 8,
    marginTop: 8,
    textTransform: 'uppercase',
  },
  configInput: {
    backgroundColor: '#0D0D0D',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#E5E5E5',
    fontSize: 14,
  },
  sessionCreateRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  sessionInput: {
    flex: 1,
  },
  newSessionButton: {
    backgroundColor: '#0F3B35',
    borderWidth: 1,
    borderColor: '#00D4AA',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
  },
  newSessionButtonText: {
    color: '#00D4AA',
    fontSize: 13,
    fontWeight: '700',
  },
  sessionHint: {
    color: '#7F7F7F',
    fontSize: 12,
    marginTop: 8,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  primaryAction: {
    flex: 1,
    backgroundColor: '#00D4AA',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    color: '#0D0D0D',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryAction: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#262626',
    borderWidth: 1,
    borderColor: '#333',
  },
  secondaryActionText: {
    color: '#E5E5E5',
    fontSize: 14,
    fontWeight: '600',
  },
  disabledAction: {
    opacity: 0.5,
  },
  disabledSecondary: {
    opacity: 0.5,
  },
  welcomeCard: {
    marginTop: 16,
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 14,
  },
  sessionListHeader: {
    marginTop: 18,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  refreshLink: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  refreshLinkText: {
    color: '#00D4AA',
    fontSize: 12,
    fontWeight: '600',
  },
  sessionList: {
    gap: 10,
    paddingBottom: 4,
  },
  sessionChip: {
    width: 180,
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2D2D2D',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sessionChipActive: {
    borderColor: '#00D4AA',
    backgroundColor: '#112824',
  },
  sessionChipText: {
    color: '#E5E5E5',
    fontSize: 13,
    fontWeight: '700',
  },
  sessionChipTextActive: {
    color: '#00D4AA',
  },
  sessionChipSubtext: {
    color: '#8A8A8A',
    fontSize: 11,
    marginTop: 6,
  },
  aiTitle: {
    color: '#00D4AA',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  aiSubtitle: {
    color: '#888',
    fontSize: 14,
    lineHeight: 20,
  },
  emptyText: {
    color: '#666',
    textAlign: 'center',
    marginTop: 40,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#1A1A1A',
    borderTopWidth: 1,
    borderTopColor: '#333',
    alignItems: 'flex-end',
  },
  mediaBtn: {
    backgroundColor: '#262626',
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    minWidth: 64,
  },
  mediaBtnText: {
    color: '#E5E5E5',
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#E5E5E5',
    fontSize: 14,
    marginRight: 12,
    minHeight: 44,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: '#00D4AA',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    justifyContent: 'center',
    minWidth: 72,
    alignItems: 'center',
  },
  disabledSendBtn: {
    opacity: 0.5,
  },
  sendBtnText: {
    color: '#0D0D0D',
    fontSize: 14,
    fontWeight: '600',
  },
  messageBubble: {
    maxWidth: '84%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#1976D2',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: '#333',
  },
  systemBubble: {
    alignSelf: 'center',
    backgroundColor: '#2B2B2B',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  messageText: {
    color: '#E5E5E5',
    fontSize: 14,
    lineHeight: 20,
  },
  imageBubblePreview: {
    width: 180,
    height: 180,
    borderRadius: 10,
    marginBottom: 10,
    backgroundColor: '#111',
  },
  audioBubbleCard: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
  },
  audioBubbleLabel: {
    color: '#E5E5E5',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  audioBubbleUrl: {
    color: '#CFE8FF',
    fontSize: 12,
    lineHeight: 18,
  },
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  previewCard: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  debugCard: {
    width: '92%',
    maxWidth: 520,
    maxHeight: '82%',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    backgroundColor: '#171717',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2D2D2D',
  },
  previewImage: {
    width: '100%',
    height: '78%',
    maxWidth: 420,
    maxHeight: 720,
    backgroundColor: '#111',
    borderRadius: 14,
  },
  previewCloseButton: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#1F1F1F',
    borderWidth: 1,
    borderColor: '#333',
  },
  previewCloseText: {
    color: '#E5E5E5',
    fontSize: 14,
    fontWeight: '600',
  },
  debugModalTitle: {
    color: '#E5E5E5',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  debugScroll: {
    width: '100%',
    maxHeight: '86%',
  },
  debugScrollContent: {
    paddingBottom: 12,
  },
  debugModalText: {
    color: '#D0D0D0',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  userBubbleText: {
    color: '#FFFFFF',
  },
  systemBubbleText: {
    color: '#AAAAAA',
    fontSize: 12,
  },
});
