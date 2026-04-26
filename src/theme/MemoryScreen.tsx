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
import {useTheme} from './ThemeProvider';
import type {Theme} from './index';

type BubblePart =
  | { type: 'text'; content: string }
  | { type: 'image'; url: string }
  | { type: 'audio'; url: string };

function detectMediaKind(url: string): 'image' | 'audio' | null {
  const cleanUrl = url.split('?')[0]?.toLowerCase() || '';
  if (/\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(cleanUrl)) return 'image';
  if (/\.(wav|mp3|m4a|aac|ogg|opus|flac)$/i.test(cleanUrl)) return 'audio';
  return null;
}

function buildDraftMessage(draft: ChatComposerDraft): string {
  const text = draft.text?.trim() || '';
  const mediaUrl = draft.mediaUrl?.trim() || '';
  if (mediaUrl && text) return `${mediaUrl}\n${text}`;
  return mediaUrl || text;
}

function buildDraftKey(draft: ChatComposerDraft): string {
  return [draft.createdAt, draft.mediaUrl?.trim() || '', draft.text?.trim() || ''].join('::');
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
    if (combined) parts.push({type: 'text', content: combined});
    textBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const mediaMatch = line.match(/^MEDIA:\s*(https?:\/\/\S+)$/i);
    if (mediaMatch?.[1]) {
      flushTextBuffer();
      const mediaUrl = mediaMatch[1].trim();
      const mediaKind = detectMediaKind(mediaUrl);
      if (mediaKind === 'image') parts.push({type: 'image', url: mediaUrl});
      else if (mediaKind === 'audio') parts.push({type: 'audio', url: mediaUrl});
      else textBuffer.push(mediaUrl);
      continue;
    }
    textBuffer.push(rawLine);
  }
  flushTextBuffer();
  if (parts.length === 0) {
    const normalized = normalizeBubbleText(text);
    if (normalized) parts.push({type: 'text', content: normalized});
  }
  return parts;
}

export function MemoryScreen() {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const [inputText, setInputText] = useState('');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [pendingComposerDraft, setPendingComposerDraft] = useState<ChatComposerDraft | null>(null);
  const [debugMessage, setDebugMessage] = useState<ChatMessage | null>(null);
  const [isManagerExpanded, setIsManagerExpanded] = useState(false);
  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  const listViewportHeightRef = useRef(0);
  const listContentHeightRef = useRef(0);
  const shouldStickToBottomRef = useRef(true);
  const hasAppliedInitialScrollRef = useRef(false);
  const activeAutoSendDraftKeyRef = useRef<string | null>(null);
  const debugTapRef = useRef<{messageId: string | null; count: number; timer: ReturnType<typeof setTimeout> | null}>({
    messageId: null, count: 0, timer: null,
  });

  const {
    settings, draftSessionKey, activeSessionKey, sessions, isHydrated,
    connectionState, statusText, messages, isSending, isUploadingImage,
    updateSetting, setDraftSessionKey, connect, disconnect, createSession, createSessionWithKey,
    selectSession, refreshSessions, sendMessage, sendImageMessage,
  } = useOpenClawChat();

  useEffect(() => {
    let active = true;
    const applyDraft = (draft: ChatComposerDraft | null) => {
      if (!active || (!draft?.text?.trim() && !draft?.mediaUrl?.trim())) return;
      setPendingComposerDraft(draft);
    };
    const unsubscribe = ChatComposerDraftStore.subscribe(draft => applyDraft(draft));
    void ChatComposerDraftStore.load().then(draft => applyDraft(draft));
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!pendingComposerDraft) return;
    const draftText = buildDraftMessage(pendingComposerDraft).trim();
    const draftKey = buildDraftKey(pendingComposerDraft);
    if (!draftText) {
      setPendingComposerDraft(null);
      activeAutoSendDraftKeyRef.current = null;
      void ChatComposerDraftStore.clear();
      return;
    }
    if (connectionState !== 'connected' || isSending || isUploadingImage) return;
    if (activeAutoSendDraftKeyRef.current === draftKey) return;
    let cancelled = false;
    activeAutoSendDraftKeyRef.current = draftKey;
    void (async () => {
      setPendingComposerDraft(current => current && buildDraftKey(current) === draftKey ? null : current);
      await ChatComposerDraftStore.clear();
      setInputText('');
      const sent = await sendMessage(draftText);
      if (cancelled) {
        if (activeAutoSendDraftKeyRef.current === draftKey) activeAutoSendDraftKeyRef.current = null;
        return;
      }
      if (activeAutoSendDraftKeyRef.current === draftKey) activeAutoSendDraftKeyRef.current = null;
      if (sent) return;
      setInputText(current => current.trim() ? current : draftText);
    })();
    return () => { cancelled = true; };
  }, [connectionState, isSending, isUploadingImage, pendingComposerDraft, sendMessage]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    hasAppliedInitialScrollRef.current = false;
  }, [activeSessionKey]);

  const handleSend = async () => {
    if (!inputText.trim()) return;
    const messageToSend = inputText;
    shouldStickToBottomRef.current = true;
    setInputText('');
    const sent = await sendMessage(messageToSend);
    if (sent) { setInputText(''); return; }
    setInputText(messageToSend);
  };

  const handlePickImage = async () => {
    try {
      const picked = await pickImageFromLibrary();
      if (!picked || picked.didCancel || !picked.filePath) return;
      shouldStickToBottomRef.current = true;
      const sent = await sendImageMessage({filePath: picked.filePath, mimeType: picked.mimeType, text: inputText});
      if (sent) setInputText('');
    } catch (error) {
      Alert.alert('图片发送失败', error instanceof Error ? error.message : '选择图片失败');
    }
  };

  const isConnected = connectionState === 'connected';
  const canSend = isConnected && !isSending && !isUploadingImage && !!inputText.trim();
  const canPickImage = isConnected && !isSending && !isUploadingImage;

  const statusColor = useMemo(() => {
    switch (connectionState) {
      case 'connected': return theme.colors.statusConnected;
      case 'connecting': case 'loading': return theme.colors.statusConnecting;
      case 'error': return theme.colors.statusError;
      default: return theme.colors.statusOffline;
    }
  }, [connectionState, theme]);

  const handleDebugTap = (item: ChatMessage) => {
    if (item.role !== 'assistant' || !item.debugRaw) return;
    if (debugTapRef.current.timer) clearTimeout(debugTapRef.current.timer);
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
    if (!debugMessage?.debugRaw) return '';
    try { return JSON.stringify(debugMessage.debugRaw, null, 2); }
    catch { return String(debugMessage.debugRaw); }
  }, [debugMessage]);

  const s = theme.spacing;
  const r = theme.radius;

  const scrollToBottom = (animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({animated});
    });
  };

  const handleToggleManager = () => {
    setIsManagerExpanded(current => !current);
  };

  const handleCreateNewSession = async () => {
    const nextKey = `new-${Date.now().toString(36).slice(-6)}`;
    setDraftSessionKey(nextKey);
    setIsManagerExpanded(true);
    await createSessionWithKey(nextKey);
  };

  const managerPanel = (
    <Modal
      visible={isManagerExpanded}
      animationType="slide"
      transparent
      onRequestClose={handleToggleManager}>
      <Pressable
        style={[localStyles.previewOverlay, {backgroundColor: 'rgba(3, 6, 18, 0.72)', justifyContent: 'flex-end'}]}
        onPress={handleToggleManager}>
        <Pressable
          style={[localStyles.managerModalCard, {
            backgroundColor: theme.colors.bgCard,
            borderTopLeftRadius: r.xl,
            borderTopRightRadius: r.xl,
            borderWidth: 1,
            borderColor: theme.colors.border,
            maxHeight: '82%',
          }]}
          onPress={() => {}}>
          <ScrollView
            style={{width: '100%'}}
            contentContainerStyle={{paddingHorizontal: s.md, paddingTop: s.md, paddingBottom: s.xl}}
            showsVerticalScrollIndicator={false}>
        <View style={[localStyles.managerHeader, {marginBottom: s.md}]}>
          <View style={localStyles.managerHeaderCopy}>
            <Text style={[localStyles.managerTitle, {color: theme.colors.text}]}>管理面板</Text>
            <Text style={[localStyles.managerSubtitle, {color: theme.colors.textSecondary}]}>
              把当前会话、历史会话和连接配置放在同一处管理。
            </Text>
          </View>
          <TouchableOpacity
            style={[localStyles.managerCollapseButton, {
              backgroundColor: theme.colors.bgSecondary,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: r.pill,
            }]}
            onPress={handleToggleManager}>
            <Text style={[localStyles.managerCollapseButtonText, {color: theme.colors.text}]}>收起面板</Text>
          </TouchableOpacity>
        </View>

        <View style={[localStyles.managerSection, {
          backgroundColor: theme.colors.bgSecondary,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: r.lg,
          marginBottom: s.md,
        }]}>
          <View style={[localStyles.statusRow, {marginBottom: s.md}]}>
            <View style={[localStyles.statusDot, {backgroundColor: statusColor}]} />
            <Text style={[localStyles.statusText, {color: theme.colors.textSecondary}]}>{statusText}</Text>
          </View>

          <Text style={[localStyles.sectionLabel, {color: theme.mode === 'neon' ? theme.colors.accent : theme.colors.textMuted, marginBottom: s.sm}]}>网关地址</Text>
          <TextInput
            style={[localStyles.configInput, {
              backgroundColor: theme.colors.input,
              borderWidth: 1,
              borderColor: theme.colors.inputBorder,
              borderRadius: r.md,
              paddingHorizontal: s.sm + 4,
              paddingVertical: s.sm + 2,
              color: theme.colors.text,
              fontSize: 13,
            }]}
            placeholder="ws://43.136.45.132:18789"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={settings.url}
            onChangeText={value => updateSetting('url', value)}
          />

          <Text style={[localStyles.sectionLabel, {color: theme.mode === 'neon' ? theme.colors.accent : theme.colors.textMuted, marginBottom: s.sm, marginTop: s.sm}]}>访问令牌</Text>
          <TextInput
            style={[localStyles.configInput, {
              backgroundColor: theme.colors.input,
              borderWidth: 1,
              borderColor: theme.colors.inputBorder,
              borderRadius: r.md,
              paddingHorizontal: s.sm + 4,
              paddingVertical: s.sm + 2,
              color: theme.colors.text,
              fontSize: 13,
            }]}
            placeholder="demo-token-123"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={settings.token}
            onChangeText={value => updateSetting('token', value)}
          />

          <View style={[localStyles.actionRow, {gap: s.sm, marginTop: s.md}]}>
            <TouchableOpacity
              style={[localStyles.primaryAction, {
                flex: 1,
                backgroundColor: theme.colors.buttonPrimary,
                borderWidth: theme.mode === 'warm' ? 0 : 1,
                borderColor: theme.mode === 'warm' ? 'transparent' : theme.colors.borderAccent,
                borderRadius: theme.mode === 'warm' ? r.pill : r.md,
                paddingVertical: s.sm + 4,
                alignItems: 'center',
                justifyContent: 'center',
              }]}
              disabled={!isHydrated || connectionState === 'connecting'}
              onPress={connect}>
              {connectionState === 'connecting' ? (
                <ActivityIndicator size="small" color={theme.colors.buttonPrimaryText} />
              ) : (
                <Text style={[localStyles.primaryActionText, {color: theme.colors.buttonPrimaryText, fontWeight: '700', fontSize: 13}]}>
                  {isConnected ? '重新连接' : '连接'}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[localStyles.secondaryAction, {
                flex: 1,
                backgroundColor: theme.colors.bgCard,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: theme.mode === 'warm' ? r.pill : r.md,
                paddingVertical: s.sm + 4,
                alignItems: 'center',
                justifyContent: 'center',
              }]}
              disabled={!isConnected}
              onPress={disconnect}>
              <Text style={[localStyles.secondaryActionText, {color: theme.colors.text, fontSize: 13}]}>断开</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[localStyles.managerSection, {
          backgroundColor: theme.colors.bgSecondary,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: r.lg,
          marginBottom: s.md,
        }]}>
          <View style={[localStyles.sessionListHeader, {marginBottom: s.sm}]}>
            <Text style={[localStyles.aiTitle, {color: theme.colors.text}]}>会话列表</Text>
            <TouchableOpacity onPress={refreshSessions} disabled={!isConnected}>
              <Text style={[localStyles.refreshLinkText, {color: theme.colors.accent}]}>刷新</Text>
            </TouchableOpacity>
          </View>
          <View style={[localStyles.sessionListStack, {gap: s.sm}]}>
            {sessions.map(item => (
              <SessionChip key={item.key} item={item} active={item.key === activeSessionKey} onPress={selectSession} theme={theme} />
            ))}
          </View>
        </View>

        <View style={[localStyles.managerSection, {
          backgroundColor: theme.colors.bgSecondary,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: r.lg,
          marginBottom: s.md,
        }]}>
          <Text style={[localStyles.managerSectionLabel, {color: theme.colors.textMuted}]}>新开会话</Text>
          <Text style={[localStyles.managerSectionHint, {color: theme.colors.textSecondary}]}>
            你可以快速生成一个新的 `sessionKey`，也可以自定义名字后进入。
          </Text>
          <View style={[localStyles.sessionCreateRow, {gap: s.sm, marginTop: s.sm}]}>
            <TextInput
              style={[localStyles.configInput, localStyles.sessionInput, {
                backgroundColor: theme.colors.input,
                borderWidth: 1,
                borderColor: theme.colors.inputBorder,
                borderRadius: r.md,
                paddingHorizontal: s.sm + 4,
                paddingVertical: s.sm + 2,
                color: theme.colors.text,
                fontSize: 13,
              }]}
              placeholder="new-project"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              value={draftSessionKey}
              onChangeText={setDraftSessionKey}
            />
          </View>
          <View style={[localStyles.managerButtonRow, {gap: s.sm, marginTop: s.sm}]}>
            <TouchableOpacity
              style={[localStyles.managerActionButton, {
                backgroundColor: theme.colors.buttonPrimary,
                borderWidth: theme.mode === 'warm' ? 0 : 1,
                borderColor: theme.colors.borderAccent,
                borderRadius: theme.mode === 'warm' ? r.pill : r.md,
              }]}
              onPress={handleCreateNewSession}>
              <Text style={[localStyles.newSessionButtonText, {color: theme.colors.buttonPrimaryText}]}>快速新建</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[localStyles.managerActionButton, {
                backgroundColor: theme.colors.bgCard,
                borderWidth: 1,
                borderColor: theme.colors.borderAccent,
                borderRadius: theme.mode === 'warm' ? r.pill : r.md,
              }]}
              onPress={createSession}>
              <Text style={[localStyles.newSessionButtonText, {color: theme.colors.accent}]}>使用当前 key</Text>
            </TouchableOpacity>
          </View>
        </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );

  return (
    <KeyboardAvoidingView style={[localStyles.container, {backgroundColor: theme.colors.bg}]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
      {/* Header */}
      <View style={[localStyles.header, {paddingTop: insets.top + s.md, backgroundColor: theme.colors.bg, borderBottomColor: theme.colors.border}]}>
        <View>
          {theme.mode === 'neon' && <Text style={[localStyles.titleNeon, {color: theme.colors.accent}]}>记忆链路</Text>}
          {theme.mode === 'warm' && <Text style={[localStyles.titleWarm, {color: theme.colors.accent}]}>记忆之树</Text>}
          <Text style={[localStyles.subtitle, {color: theme.colors.textSecondary}]}>
            {theme.mode === 'warm' ? 'Memory Tree' : '// 智能会话通道'}
          </Text>
        </View>
        <Text style={localStyles.recordIcon}>
          {theme.mode === 'warm' ? '🌿' : '◉'}
        </Text>
      </View>

      <View style={[localStyles.quickBar, {
        backgroundColor: theme.colors.bgSecondary,
        borderBottomColor: theme.colors.border,
        paddingHorizontal: s.md,
        paddingVertical: s.sm,
        gap: s.sm,
      }]}>
        <TouchableOpacity
          style={[localStyles.quickBarButton, {
            backgroundColor: isManagerExpanded ? (theme.colors.accentGlow || theme.colors.bgCard) : theme.colors.bgCard,
            borderColor: isManagerExpanded ? theme.colors.accent : theme.colors.border,
            borderRadius: theme.mode === 'warm' ? r.pill : r.md,
          }]}
          onPress={handleToggleManager}>
          <Text style={[localStyles.quickBarButtonText, {color: theme.colors.text}]}>
            {isManagerExpanded ? '收起面板' : '管理面板'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[localStyles.quickBarButton, {
            backgroundColor: theme.colors.buttonPrimary,
            borderColor: theme.colors.borderAccent,
            borderRadius: theme.mode === 'warm' ? r.pill : r.md,
          }]}
          onPress={handleCreateNewSession}>
          <Text style={[localStyles.quickBarButtonText, {color: theme.colors.buttonPrimaryText}]}>
            新开会话
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[localStyles.quickSessionChip, {
            flex: 1,
            backgroundColor: theme.colors.bgCard,
            borderColor: theme.colors.borderAccent,
            borderRadius: r.pill,
          }]}
          onPress={() => {
            if (!isManagerExpanded) {
              setIsManagerExpanded(true);
            }
          }}>
          <Text
            numberOfLines={1}
            style={[localStyles.quickSessionText, {
              color: theme.colors.accent,
            }]}>
            {activeSessionKey}
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={item => item.id}
        contentContainerStyle={[localStyles.list, {padding: s.md, gap: s.sm + 4}]}
        onLayout={event => {
          listViewportHeightRef.current = event.nativeEvent.layout.height;
        }}
        onScroll={event => {
          const {contentOffset, layoutMeasurement, contentSize} = event.nativeEvent;
          const distanceFromBottom =
            contentSize.height - (contentOffset.y + layoutMeasurement.height);
          shouldStickToBottomRef.current = distanceFromBottom < 80;
        }}
        scrollEventThrottle={16}
        onContentSizeChange={(_, contentHeight) => {
          const previousHeight = listContentHeightRef.current;
          listContentHeightRef.current = contentHeight;
          if (!hasAppliedInitialScrollRef.current) {
            hasAppliedInitialScrollRef.current = true;
            scrollToBottom(false);
            return;
          }

          if (contentHeight <= previousHeight) {
            return;
          }

          if (shouldStickToBottomRef.current) {
            scrollToBottom(true);
          }
        }}
        ListHeaderComponent={<View style={{height: s.xs}} />}
        renderItem={({item}) => (
          <ChatBubble item={item} onPreviewImage={setPreviewImageUrl} onDebugTap={handleDebugTap} theme={theme} />
        )}
        ListEmptyComponent={
          isHydrated ? (
            <Text style={[localStyles.emptyText, {color: theme.colors.textMuted, textAlign: 'center', marginTop: s.xl}]}>
              {'连接成功后就可以开始演示对话了'}
            </Text>
          ) : null
        }
      />

      {managerPanel}

      {/* Input Area */}
      <View style={[localStyles.inputContainer, {
        padding: s.md,
        backgroundColor: theme.colors.bgSecondary,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        flexDirection: 'row',
        alignItems: 'flex-end',
      }]}>
        <TouchableOpacity
          style={[localStyles.mediaBtn, {
            backgroundColor: theme.colors.bgCard,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: s.sm + 4,
            paddingVertical: s.sm + 2,
            borderRadius: r.md,
            marginRight: s.sm,
            minWidth: 50,
            alignItems: 'center',
            justifyContent: 'center',
          }]}
          onPress={handlePickImage}
          disabled={!canPickImage}>
          <Text style={{color: canPickImage ? theme.colors.accent : theme.colors.textMuted, fontSize: 16}}>
            {theme.mode === 'warm' ? '📷' : '📷'}
          </Text>
        </TouchableOpacity>
        <TextInput
          style={[localStyles.input, {
            flex: 1,
            backgroundColor: theme.colors.input,
            borderWidth: 1,
            borderColor: theme.colors.inputBorder,
            borderRadius: r.md,
            paddingHorizontal: s.sm + 4,
            paddingVertical: s.sm + 2,
            color: theme.colors.text,
            fontSize: 14,
            marginRight: s.sm,
            minHeight: 40,
            maxHeight: 100,
          }]}
          placeholder={isConnected ? ('输入消息开始演示...') : ('请先连接 Gateway')}
          placeholderTextColor={theme.colors.textMuted}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
          editable={isConnected && !isSending && !isUploadingImage}
          multiline
        />
        <TouchableOpacity
          style={[localStyles.sendBtn, {
            backgroundColor: theme.colors.buttonPrimary,
            borderWidth: theme.mode === 'warm' ? 0 : 1,
            borderColor: theme.mode === 'warm' ? 'transparent' : theme.colors.borderAccent,
            paddingHorizontal: s.md,
            paddingVertical: s.sm + 2,
            borderRadius: theme.mode === 'warm' ? r.pill : r.md,
            justifyContent: 'center',
            minWidth: 60,
            alignItems: 'center',
            opacity: canSend ? 1 : 0.5,
            ...(theme.mode === 'neon' && canSend ? {shadowColor: theme.colors.accent, shadowOffset: {width: 0, height: 0}, shadowOpacity: 0.4, shadowRadius: 10} : {}),
          }]}
          onPress={handleSend}
          disabled={!canSend}>
          <Text style={[localStyles.sendBtnText, {color: theme.colors.buttonPrimaryText, fontSize: 13, fontWeight: '700'}]}>
            {isUploadingImage ? '...' : isSending ? '...' : ('发送')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Image Preview Modal */}
      <Modal visible={!!previewImageUrl} animationType="fade" transparent onRequestClose={() => setPreviewImageUrl(null)}>
        <Pressable style={[localStyles.previewOverlay, {backgroundColor: 'rgba(0, 0, 0, 0.92)', flex: 1, alignItems: 'center', justifyContent: 'center', padding: s.lg}]} onPress={() => setPreviewImageUrl(null)}>
          <Pressable style={{width: '100%', alignItems: 'center', justifyContent: 'center'}} onPress={() => {}}>
            {previewImageUrl && <Image source={{uri: previewImageUrl}} style={{width: '100%', height: '78%', maxHeight: 600, backgroundColor: '#111', borderRadius: r.lg}} resizeMode="contain" />}
            <TouchableOpacity style={[localStyles.previewCloseButton, {marginTop: s.md, paddingHorizontal: s.md + 4, paddingVertical: s.sm + 2, borderRadius: 999, backgroundColor: theme.colors.bgCard, borderWidth: 1, borderColor: undefined}]} onPress={() => setPreviewImageUrl(null)}>
              <Text style={[localStyles.previewCloseText, {color: theme.colors.text}]}>✕</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Debug Modal */}
      <Modal visible={!!debugMessage} animationType="slide" transparent onRequestClose={() => setDebugMessage(null)}>
        <Pressable style={[localStyles.previewOverlay, {backgroundColor: 'rgba(0, 0, 0, 0.92)', flex: 1, alignItems: 'center', justifyContent: 'center', padding: s.lg}]} onPress={() => setDebugMessage(null)}>
          <Pressable style={[localStyles.debugCard, {width: '92%', maxWidth: 520, maxHeight: '82%', backgroundColor: theme.colors.bgCard, borderRadius: r.lg, padding: s.md, borderWidth: 1, borderColor: theme.colors.border}]} onPress={() => {}}>
            <Text style={[localStyles.debugModalTitle, {color: theme.colors.text, fontSize: 14, fontWeight: '700', marginBottom: s.sm, textTransform: 'none' as const}]}>
              原始响应 · {debugMessage?.debugSource === 'history' ? '历史' : '事件'}
            </Text>
            <ScrollView style={{width: '100%', maxHeight: '86%'}} contentContainerStyle={{paddingBottom: s.sm}}>
              <Text selectable style={[localStyles.debugModalText, {color: theme.colors.textSecondary, fontSize: 11, lineHeight: 16, fontFamily: theme.fonts.mono}]}>
                {debugText}
              </Text>
            </ScrollView>
            <TouchableOpacity style={[localStyles.previewCloseButton, {marginTop: s.md, paddingHorizontal: s.md + 4, paddingVertical: s.sm + 2, borderRadius: 999, backgroundColor: theme.colors.bgSecondary, alignSelf: 'center'}]} onPress={() => setDebugMessage(null)}>
              <Text style={[localStyles.previewCloseText, {color: theme.colors.text}]}>关闭</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function SessionChip({item, active, onPress, theme}: {item: SessionListItem; active: boolean; onPress: (key: string) => void; theme: Theme}) {
  const r = theme.radius;
  const s = theme.spacing;
  return (
    <TouchableOpacity
      style={[localStyles.sessionRow, {
        backgroundColor: active
          ? (theme.mode === 'neon' ? 'rgba(0, 245, 255, 0.15)' : theme.mode === 'warm' ? 'rgba(255, 112, 67, 0.15)' : 'rgba(201, 169, 98, 0.15)')
          : theme.colors.bgSecondary,
        borderRadius: r.pill,
        borderWidth: 1,
        borderColor: active ? theme.colors.accent : theme.colors.border,
        paddingHorizontal: s.sm + 4,
        paddingVertical: s.sm + 2,
      }]}
      onPress={() => onPress(item.key)}>
      <View style={localStyles.sessionRowCopy}>
        <Text style={{color: active ? theme.colors.accent : theme.colors.text, fontSize: 13, fontWeight: '700'}}>
          {item.title || item.key}
        </Text>
        <Text style={{color: theme.colors.textSecondary, fontSize: 11, marginTop: 2}}>
          {item.key}
        </Text>
      </View>
      <View style={[localStyles.sessionRowBadge, {
        backgroundColor: active ? theme.colors.accent : theme.colors.bgCard,
        borderColor: active ? theme.colors.accent : theme.colors.border,
      }]}>
        <Text style={{color: active ? theme.colors.buttonPrimaryText : theme.colors.textSecondary, fontSize: 10, fontWeight: '700'}}>
          {active ? '当前' : '切换'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function ChatBubble({item, onPreviewImage, onDebugTap, theme}: {item: ChatMessage; onPreviewImage: (url: string) => void; onDebugTap: (item: ChatMessage) => void; theme: Theme}) {
  const isUser = item.role === 'user';
  const isSystem = item.role === 'system';
  const isAssistant = item.role === 'assistant';
  const parts = buildBubbleParts(item.text, item.role);
  const lastTextPartIndex = [...parts].map((part, index) => ({part, index})).filter(entry => entry.part.type === 'text').at(-1)?.index;
  const shouldRenderStreamingCursor = item.isStreaming && lastTextPartIndex == null;
  const r = theme.radius;
  const s = theme.spacing;

  return (
    <View
      style={{
        maxWidth: '84%',
        alignSelf: isUser ? 'flex-end' : isSystem ? 'center' : 'flex-start',
        backgroundColor: isUser ? (theme.mode === 'warm' ? theme.colors.chatUser : theme.colors.accent) : theme.colors.chatAI,
        borderWidth: theme.mode === 'neon' && isAssistant ? 1 : 0,
        borderColor: theme.mode === 'neon' ? 'rgba(0, 245, 255, 0.3)' : isUser ? 'transparent' : isAssistant ? theme.colors.borderAccent : 'transparent',
        borderRadius: isUser ? (theme.mode === 'warm' ? r.xl : r.lg) : r.lg,
        paddingHorizontal: s.sm + 6,
        paddingVertical: s.sm + 2,
        marginBottom: s.sm,
      }}
      onStartShouldSetResponder={() => isAssistant}
      onResponderRelease={() => { if (isAssistant) onDebugTap(item); }}>
      {parts.map((part, index) =>
        part.type === 'image' ? (
          <TouchableOpacity key={`${part.url}-${index}`} activeOpacity={0.9} onPress={() => { onDebugTap(item); onPreviewImage(part.url); }}>
            <Image source={{uri: part.url}} style={{width: 160, height: 160, borderRadius: r.md, marginBottom: 8, backgroundColor: '#111'}} resizeMode="cover" />
          </TouchableOpacity>
        ) : part.type === 'audio' ? (
          <View key={`${part.url}-${index}`} style={{marginBottom: 8, padding: s.sm, borderRadius: r.sm, backgroundColor: 'rgba(0,0,0,0.1)'}}>
            <Text style={{color: isUser ? '#FFF' : theme.mode === 'neon' ? theme.colors.accent : theme.colors.textSecondary, fontSize: 11, fontWeight: '700', marginBottom: 4}}>音频附件</Text>
            <Text selectable style={{color: isUser ? '#FFF' : theme.colors.textSecondary, fontSize: 11}}>{part.url}</Text>
          </View>
        ) : (
          <Text key={`${part.content.slice(0, 24)}-${index}`} style={{color: isUser ? (theme.mode === 'warm' ? '#FFF' : '#FFF') : isSystem ? theme.colors.textSecondary : theme.colors.text, fontSize: 14, lineHeight: 20}}>
            {part.content}
            {item.isStreaming && lastTextPartIndex === index ? '▋' : ''}
          </Text>
        ),
      )}
      {shouldRenderStreamingCursor ? (
        <Text style={{color: isUser ? '#FFF' : theme.colors.text}}>▋</Text>
      ) : null}
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: {flex: 1},
  header: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1},
  quickBar: {borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center'},
  managerPanelWrap: {},
  managerModalCard: {width: '100%', alignSelf: 'center'},
  managerHeader: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between'},
  managerHeaderCopy: {flex: 1, paddingRight: 12},
  managerTitle: {fontSize: 16, fontWeight: '700'},
  managerSubtitle: {fontSize: 12, lineHeight: 18, marginTop: 4},
  managerCollapseButton: {paddingHorizontal: 12, paddingVertical: 8},
  managerCollapseButtonText: {fontSize: 12, fontWeight: '700'},
  managerSection: {padding: 12},
  managerSectionLabel: {fontSize: 11, fontWeight: '700', marginBottom: 6},
  managerSectionHint: {fontSize: 12, lineHeight: 18},
  activeSessionValue: {fontSize: 18, fontWeight: '700'},
  activeSessionHint: {fontSize: 12, lineHeight: 18, marginTop: 6},
  managerButtonRow: {flexDirection: 'row'},
  managerActionButton: {flex: 1, paddingHorizontal: 12, paddingVertical: 10, alignItems: 'center', justifyContent: 'center'},
  quickBarButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickBarButtonText: {fontSize: 12, fontWeight: '700'},
  quickSessionChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickSessionText: {fontSize: 11, fontWeight: '600'},
  titleNeon: {fontSize: 18, fontWeight: '700', letterSpacing: 2},
  titleWarm: {fontSize: 20, fontWeight: '700'},
  titleLuxury: {fontSize: 22, fontWeight: '400', letterSpacing: 6, fontFamily: 'Georgia'},
  subtitle: {fontSize: 11, marginTop: 4},
  recordIcon: {fontSize: 18},
  list: {paddingBottom: 16},
  configCard: {},
  statusRow: {flexDirection: 'row', alignItems: 'center'},
  statusDot: {width: 8, height: 8, borderRadius: 999, marginRight: 8},
  statusText: {fontSize: 12},
  sectionLabel: {fontSize: 11, marginBottom: 4},
  configInput: {},
  sessionCreateRow: {flexDirection: 'row', alignItems: 'center'},
  sessionInput: {flex: 1},
  newSessionButton: {},
  newSessionButtonText: {fontSize: 12, fontWeight: '700'},
  sessionHint: {},
  actionRow: {flexDirection: 'row'},
  primaryAction: {},
  primaryActionText: {},
  secondaryAction: {},
  secondaryActionText: {},
  sessionListHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  sessionListStack: {},
  sessionRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  sessionRowCopy: {flex: 1, paddingRight: 12},
  sessionRowBadge: {paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1},
  aiTitle: {fontSize: 13, fontWeight: '600'},
  refreshLinkText: {fontWeight: '600'},
  emptyText: {},
  inputContainer: {},
  mediaBtn: {},
  input: {},
  sendBtn: {},
  sendBtnText: {},
  previewOverlay: {},
  previewCloseButton: {},
  previewCloseText: {fontSize: 13, fontWeight: '600'},
  debugCard: {},
  debugModalTitle: {},
  debugModalText: {},
});
