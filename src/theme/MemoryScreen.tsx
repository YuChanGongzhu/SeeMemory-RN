import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
  Modal,
  Pressable,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useHermesChat} from '../hooks/useHermesChat';
import {pickImageFromLibrary} from '../native/ImagePickerModule';
import type {ChatMessage} from '../types/chat';
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

// Matches any http(s) URL run. Trailing sentence punctuation is stripped separately
// so links like "...jpg。" or "(...jpg)" still resolve to a clean media URL.
const URL_SCAN_REGEX = /(https?:\/\/[^\s]+)/g;
const TRAILING_PUNCT_REGEX = /[)\]}>"'.,;:!?。，、；：！？）】》「」“”]+$/;

// Splits free-form text into parts, turning any inline image/audio URL into a media
// part (regardless of role). Non-media URLs are left inside the surrounding text.
function pushTextWithInlineMedia(parts: BubblePart[], rawText: string): void {
  const normalized = normalizeBubbleText(rawText.replace(/[ \t]+\n/g, '\n'));
  if (!normalized) return;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  URL_SCAN_REGEX.lastIndex = 0;
  while ((match = URL_SCAN_REGEX.exec(normalized)) !== null) {
    const cleanedUrl = match[1].replace(TRAILING_PUNCT_REGEX, '');
    const kind = detectMediaKind(cleanedUrl);
    if (!kind) continue;
    const before = normalized.slice(lastIndex, match.index).trim();
    if (before) parts.push({type: 'text', content: before});
    parts.push(kind === 'image' ? {type: 'image', url: cleanedUrl} : {type: 'audio', url: cleanedUrl});
    lastIndex = match.index + cleanedUrl.length;
  }
  const rest = normalized.slice(lastIndex).trim();
  if (rest) parts.push({type: 'text', content: rest});
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
    pushTextWithInlineMedia(parts, textBuffer.join('\n'));
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
  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const hasAppliedInitialScrollRef = useRef(false);
  const activeAutoSendDraftKeyRef = useRef<string | null>(null);

  const {selectedDevice, messages, isSending, isUploadingImage, send, sendImageMessage, reset} =
    useHermesChat();

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

  // Auto-send drafts produced by ring-audio transcription on the Devices tab.
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
    if (!selectedDevice || isSending || isUploadingImage) return;
    if (activeAutoSendDraftKeyRef.current === draftKey) return;
    let cancelled = false;
    activeAutoSendDraftKeyRef.current = draftKey;
    void (async () => {
      setPendingComposerDraft(current => current && buildDraftKey(current) === draftKey ? null : current);
      await ChatComposerDraftStore.clear();
      setInputText('');
      const sent = await send(draftText);
      if (cancelled) {
        if (activeAutoSendDraftKeyRef.current === draftKey) activeAutoSendDraftKeyRef.current = null;
        return;
      }
      if (activeAutoSendDraftKeyRef.current === draftKey) activeAutoSendDraftKeyRef.current = null;
      if (sent) return;
      setInputText(current => current.trim() ? current : draftText);
    })();
    return () => { cancelled = true; };
  }, [selectedDevice, isSending, isUploadingImage, pendingComposerDraft, send]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    hasAppliedInitialScrollRef.current = false;
  }, [selectedDevice?.subDomain]);

  const handleSend = async () => {
    if (!inputText.trim()) return;
    const messageToSend = inputText;
    shouldStickToBottomRef.current = true;
    setInputText('');
    const sent = await send(messageToSend);
    if (!sent) setInputText(messageToSend);
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

  const hasDevice = !!selectedDevice;
  const canSend = hasDevice && !isSending && !isUploadingImage && !!inputText.trim();
  const canPickImage = hasDevice && !isSending && !isUploadingImage;

  const s = theme.spacing;
  const r = theme.radius;

  const scrollToBottom = (animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({animated});
    });
  };

  return (
    <KeyboardAvoidingView style={[localStyles.container, {backgroundColor: theme.colors.bg}]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
      {/* Header */}
      <View style={[localStyles.header, {paddingTop: insets.top + s.md, backgroundColor: theme.colors.bg, borderBottomColor: theme.colors.border}]}>
        <View style={{flex: 1, paddingRight: s.sm}}>
          {theme.mode === 'neon' && <Text style={[localStyles.titleNeon, {color: theme.colors.accent}]}>记忆链路</Text>}
          {theme.mode === 'warm' && <Text style={[localStyles.titleWarm, {color: theme.colors.accent}]}>记忆之树</Text>}
          <Text style={[localStyles.subtitle, {color: theme.colors.textSecondary}]} numberOfLines={1}>
            {hasDevice ? (selectedDevice?.name || selectedDevice?.subDomain) : (theme.mode === 'warm' ? '未选择记忆盒子' : '// 未连接记忆盒子')}
          </Text>
        </View>
        <TouchableOpacity
          style={{
            paddingHorizontal: s.sm + 2,
            paddingVertical: s.xs + 2,
            borderRadius: r.pill,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bgCard,
          }}
          onPress={reset}
          disabled={messages.length === 0}>
          <Text style={{color: messages.length === 0 ? theme.colors.textMuted : theme.colors.accent, fontSize: 12, fontWeight: '600'}}>
            新对话
          </Text>
        </TouchableOpacity>
      </View>

      {!hasDevice ? (
        <View style={[localStyles.noDeviceBanner, {backgroundColor: theme.colors.bgSecondary, borderBottomColor: theme.colors.border, paddingHorizontal: s.md, paddingVertical: s.sm}]}>
          <Text style={{color: theme.colors.textSecondary, fontSize: 12}}>
            还没有选择记忆盒子，请到「设置 · 记忆盒子」中选择后再开始对话。
          </Text>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={item => item.id}
        contentContainerStyle={[localStyles.list, {padding: s.md, gap: s.sm + 4}]}
        onScroll={event => {
          const {contentOffset, layoutMeasurement, contentSize} = event.nativeEvent;
          const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
          shouldStickToBottomRef.current = distanceFromBottom < 80;
        }}
        scrollEventThrottle={16}
        onContentSizeChange={() => {
          if (!hasAppliedInitialScrollRef.current) {
            hasAppliedInitialScrollRef.current = true;
            scrollToBottom(false);
            return;
          }
          if (shouldStickToBottomRef.current) {
            scrollToBottom(true);
          }
        }}
        ListHeaderComponent={<View style={{height: s.xs}} />}
        renderItem={({item}) => (
          <ChatBubble item={item} onPreviewImage={setPreviewImageUrl} theme={theme} />
        )}
        ListEmptyComponent={
          <Text style={[localStyles.emptyText, {color: theme.colors.textMuted, textAlign: 'center', marginTop: s.xl}]}>
            {hasDevice ? '和你的记忆盒子聊聊吧，它会帮你召回记忆。' : ''}
          </Text>
        }
      />

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
          <Text style={{color: canPickImage ? theme.colors.accent : theme.colors.textMuted, fontSize: 16}}>📷</Text>
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
          placeholder={hasDevice ? '输入消息，召回你的记忆...' : '请先在设置中选择记忆盒子'}
          placeholderTextColor={theme.colors.textMuted}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
          editable={hasDevice && !isSending && !isUploadingImage}
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
          }]}
          onPress={handleSend}
          disabled={!canSend}>
          <Text style={[localStyles.sendBtnText, {color: theme.colors.buttonPrimaryText, fontSize: 13, fontWeight: '700'}]}>
            {isUploadingImage || isSending ? '...' : '发送'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Image Preview Modal */}
      <Modal visible={!!previewImageUrl} animationType="fade" transparent onRequestClose={() => setPreviewImageUrl(null)}>
        <Pressable style={[localStyles.previewOverlay, {backgroundColor: 'rgba(0, 0, 0, 0.92)', flex: 1, alignItems: 'center', justifyContent: 'center', padding: s.lg}]} onPress={() => setPreviewImageUrl(null)}>
          <Pressable style={{width: '100%', alignItems: 'center', justifyContent: 'center'}} onPress={() => {}}>
            {previewImageUrl && <Image source={{uri: previewImageUrl}} style={{width: '100%', height: '78%', maxHeight: 600, backgroundColor: '#111', borderRadius: r.lg}} resizeMode="contain" />}
            <TouchableOpacity style={[localStyles.previewCloseButton, {marginTop: s.md, paddingHorizontal: s.md + 4, paddingVertical: s.sm + 2, borderRadius: 999, backgroundColor: theme.colors.bgCard}]} onPress={() => setPreviewImageUrl(null)}>
              <Text style={[localStyles.previewCloseText, {color: theme.colors.text}]}>✕</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function ChatBubble({item, onPreviewImage, theme}: {item: ChatMessage; onPreviewImage: (url: string) => void; theme: Theme}) {
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
      }}>
      {parts.map((part, index) =>
        part.type === 'image' ? (
          <TouchableOpacity key={`${part.url}-${index}`} activeOpacity={0.9} onPress={() => onPreviewImage(part.url)}>
            <Image source={{uri: part.url}} style={{width: 160, height: 160, borderRadius: r.md, marginBottom: 8, backgroundColor: '#111'}} resizeMode="cover" />
          </TouchableOpacity>
        ) : part.type === 'audio' ? (
          <View key={`${part.url}-${index}`} style={{marginBottom: 8, padding: s.sm, borderRadius: r.sm, backgroundColor: 'rgba(0,0,0,0.1)'}}>
            <Text style={{color: isUser ? '#FFF' : theme.mode === 'neon' ? theme.colors.accent : theme.colors.textSecondary, fontSize: 11, fontWeight: '700', marginBottom: 4}}>音频附件</Text>
            <Text selectable style={{color: isUser ? '#FFF' : theme.colors.textSecondary, fontSize: 11}}>{part.url}</Text>
          </View>
        ) : (
          <Text key={`${part.content.slice(0, 24)}-${index}`} style={{color: isUser ? '#FFF' : isSystem ? theme.colors.textSecondary : theme.colors.text, fontSize: 14, lineHeight: 20}}>
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
  noDeviceBanner: {borderBottomWidth: 1},
  titleNeon: {fontSize: 18, fontWeight: '700', letterSpacing: 2},
  titleWarm: {fontSize: 20, fontWeight: '700'},
  subtitle: {fontSize: 11, marginTop: 4},
  list: {paddingBottom: 16},
  emptyText: {},
  inputContainer: {},
  mediaBtn: {},
  input: {},
  sendBtn: {},
  sendBtnText: {},
  previewOverlay: {},
  previewCloseButton: {},
  previewCloseText: {fontSize: 13, fontWeight: '600'},
});
