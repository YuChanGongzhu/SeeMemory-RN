import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, Image, Animated,
  ActivityIndicator, KeyboardAvoidingView, Platform, Linking, StyleSheet,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronLeft, Mic, Square, ArrowUp, Sparkles, ChevronRight, ImageOff, Play, Pause} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {images} from '../design/assets';
import {useNav} from '../navigation/nav';
import {useAuth} from '../auth/AuthContext';
import {useHermesChat} from '../hooks/useHermesChat';
import {useAudioPlayback, type AudioPlaybackState} from '../hooks/useAudioPlayback';
import {useVoiceInput} from '../hooks/useVoiceInput';
import {useImagePreview} from '../hooks/useImagePreview';

const WELCOME = '你好！我是你的记忆助手 ✦\n\n我可以帮你整理想法、回忆过去记录的内容，或者一起深化某个思考。今天想聊点什么？';

function TypingDots() {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, {toValue: -5, duration: 300, useNativeDriver: true}),
          Animated.timing(d, {toValue: 0, duration: 300, useNativeDriver: true}),
          Animated.delay((2 - i) * 160),
        ]),
      ),
    );
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [dots]);
  return (
    <View style={[styles.bubbleAI, {flexDirection: 'row', gap: 5, paddingVertical: 16}]}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={[styles.typingDot, {transform: [{translateY: d}]}]} />
      ))}
    </View>
  );
}

// 在气泡文本里识别图片 / 音频 URL，替换成对应卡片。四个捕获组分别是：
// g1 = markdown 图片 ![alt](url)；g2 = 裸图片 URL；
// g3 = markdown 音频 [alt](url.mp3)；g4 = 裸音频 URL（mp3/wav/m4a/aac/ogg/flac，允许 ?query）。
const MEDIA_TOKEN_RE =
  /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|bmp|heic)(?:\?[^\s"'<>]*)?)|\[[^\]]*\]\((https?:\/\/[^\s)]+\.(?:mp3|wav|m4a|aac|ogg|flac)(?:\?[^\s)]*)?)\)|(https?:\/\/[^\s]+\.(?:mp3|wav|m4a|aac|ogg|flac)(?:\?[^\s"'<>]*)?)/gi;

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 聊天里的语音卡片：点按播放（本地文件或远程 URL 都走通用 AudioPlayerModule）。同一时刻只播一条。
 * durationMs 可选：用户语音消息在未播放时先显示已知时长。
 */
function ChatAudio({uri, playback, durationMs}: {uri: string; playback: AudioPlaybackState; durationMs?: number}) {
  const isThis = playback.playingId === uri;
  const playing = isThis && playback.isPlaying;
  const pct = isThis && playback.duration > 0 ? Math.min(100, (playback.currentTime / playback.duration) * 100) : 0;
  const timeLabel = isThis && playback.duration > 0
    ? fmtClock(playback.currentTime)
    : durationMs && durationMs > 0
      ? fmtClock(durationMs / 1000)
      : '播放';
  return (
    <TouchableOpacity
      style={styles.audioCard}
      activeOpacity={0.85}
      onPress={() => playback.toggle(uri, uri).catch(() => {})}>
      <View style={styles.audioPlayBtn}>
        {playing ? <Pause size={15} color="#fff" fill="#fff" /> : <Play size={15} color="#fff" fill="#fff" />}
      </View>
      <View style={{flex: 1, minWidth: 0}}>
        <Text style={styles.audioLabel} numberOfLines={1}>语音记录</Text>
        <View style={styles.audioTrack}>
          <View style={[styles.audioFill, {width: `${pct}%`}]} />
        </View>
      </View>
      <Text style={styles.audioTime}>{timeLabel}</Text>
    </TouchableOpacity>
  );
}

/** 稳定的伪波形高度比例（0.3~1），由音频路径派生，保证多次渲染一致。 */
function waveformBars(seed: string, count: number): number[] {
  const bars: number[] = [];
  const base = seed.length ? seed : 'voice';
  for (let i = 0; i < count; i++) {
    const code = base.charCodeAt(i % base.length) + i * 13;
    bars.push(0.3 + ((Math.sin(code) + 1) / 2) * 0.7);
  }
  return bars;
}

/**
 * 用户发送的语音气泡：参考微信 / iMessage —— 播放键 + 波形 + 时长，宽度随时长增长，
 * 沿用用户气泡的深色圆角样式。播放进度把波形从左到右点亮。
 */
function SentVoiceBubble({uri, playback, durationMs}: {uri: string; playback: AudioPlaybackState; durationMs?: number}) {
  const isThis = playback.playingId === uri;
  const playing = isThis && playback.isPlaying;
  const seconds = durationMs && durationMs > 0 ? durationMs / 1000 : isThis ? playback.duration : 0;
  const barCount = Math.min(32, Math.max(12, Math.round(seconds * 2.4) || 14));
  const bars = useMemo(() => waveformBars(uri, barCount), [uri, barCount]);
  const progress = isThis && playback.duration > 0 ? Math.min(1, playback.currentTime / playback.duration) : 0;
  const playedTo = Math.round(progress * barCount);
  const timeLabel = seconds > 0
    ? fmtClock(isThis && playback.currentTime ? playback.currentTime : seconds)
    : '';
  return (
    <TouchableOpacity
      style={styles.voiceMsg}
      activeOpacity={0.85}
      onPress={() => playback.toggle(uri, uri).catch(() => {})}>
      <View style={styles.voiceMsgPlay}>
        {playing ? <Pause size={13} color="#fff" fill="#fff" /> : <Play size={13} color="#fff" fill="#fff" />}
      </View>
      <View style={styles.voiceMsgWave}>
        {bars.map((h, i) => (
          <View
            key={i}
            style={[
              styles.voiceMsgBar,
              {height: 4 + h * 16, backgroundColor: i < playedTo ? '#fff' : 'rgba(255,255,255,0.4)'},
            ]}
          />
        ))}
      </View>
      {timeLabel ? <Text style={styles.voiceMsgTime}>{timeLabel}</Text> : null}
    </TouchableOpacity>
  );
}

/** 单张聊天图片：加载失败时不再留一个大空白块，而是回退成可点击的「图片链接」小卡片。 */
function ChatImage({uri}: {uri: string}) {
  const {preview} = useImagePreview();
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <TouchableOpacity style={styles.imageFallback} onPress={() => Linking.openURL(uri).catch(() => {})}>
        <ImageOff size={16} color={colors.textSub} />
        <Text style={styles.imageFallbackText} numberOfLines={1}>图片无法加载 · 点击在浏览器打开</Text>
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={() => preview(uri)}>
      <Image source={{uri}} style={styles.chatImage} resizeMode="cover" onError={() => setFailed(true)} />
    </TouchableOpacity>
  );
}

/** Renders bubble text, turning markdown / bare image + audio URLs into inline cards. */
function MessageContent({text, isUser, playback}: {text: string; isUser: boolean; playback: AudioPlaybackState}) {
  const textStyle = isUser ? styles.bubbleUserText : styles.bubbleAIText;
  const parts: React.ReactNode[] = [];
  const re = new RegExp(MEDIA_TOKEN_RE);
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<Text key={`t${i}`} style={textStyle}>{text.slice(last, m.index)}</Text>);
    }
    const imgUri = m[1] || m[2];
    const audioUri = m[3] || m[4];
    if (imgUri) {
      parts.push(<ChatImage key={`i${i}`} uri={imgUri} />);
    } else if (audioUri) {
      parts.push(<ChatAudio key={`a${i}`} uri={audioUri} playback={playback} />);
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) {
    parts.push(<Text key={`t${i}`} style={textStyle}>{text.slice(last)}</Text>);
  }
  return <>{parts}</>;
}

/** 记忆对话 — Prototype ChatTab (App.jsx:2141), wired to real useHermesChat stream. */
export function ChatPage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const {isGuest} = useAuth();
  const {messages, isSending, send, sendVoice} = useHermesChat();
  const playback = useAudioPlayback();
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  // 录完直接发一条可本地回听的语音消息（气泡是音频卡片）；转写文本在后台发给 agent。
  const onVoiceResult = useCallback(
    ({filePath, durationMs, text}: {filePath: string; durationMs: number; text: string}) => {
      void sendVoice({filePath, durationMs, text});
    },
    [sendVoice],
  );
  const voice = useVoiceInput(onVoiceResult);

  const onSend = () => {
    const text = input.trim();
    if (!text || isGuest || isSending) return;
    setInput('');
    void send(text);
  };

  useEffect(() => {
    scrollRef.current?.scrollToEnd({animated: true});
  }, [messages, isSending]);

  // assistant placeholder with empty text + streaming → show typing dots
  const lastAssistantStreaming = messages.length > 0 && messages[messages.length - 1].role === 'assistant' && !!messages[messages.length - 1].isStreaming && !messages[messages.length - 1].text;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <TouchableOpacity style={styles.backBtn} onPress={nav.pop}>
          <ChevronLeft size={24} strokeWidth={2.2} color={colors.textMain} />
        </TouchableOpacity>
        <View style={styles.avatar}>
          <Image source={images.ipStar} style={{width: 24, height: 24}} resizeMode="contain" />
        </View>
        <View style={{flex: 1}}>
          <Text style={styles.title}>记忆对话</Text>
          <Text style={styles.subtitle}>神经元持续响应中 ✦</Text>
        </View>
      </View>

      <ScrollView ref={scrollRef} style={{flex: 1}} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.systemNote}>「本次对话将在结束后自动整理为记忆 ✦」</Text>

        {messages.length === 0 ? (
          <View style={styles.aiRow}>
            <View style={styles.aiAvatar}><Image source={images.ipStar} style={{width: 18, height: 18}} resizeMode="contain" /></View>
            <View style={styles.bubbleAI}><Text style={styles.bubbleAIText}>{WELCOME}</Text></View>
          </View>
        ) : null}

        {messages.map(m => {
          if (m.role === 'system') {
            return <Text key={m.id} style={styles.systemNote}>{m.text}</Text>;
          }
          if (m.role === 'assistant') {
            if (!m.text && m.isStreaming) return null; // handled by typing dots below
            return (
              <View key={m.id} style={styles.aiRow}>
                <View style={styles.aiAvatar}><Image source={images.ipStar} style={{width: 18, height: 18}} resizeMode="contain" /></View>
                <View style={styles.bubbleAI}><MessageContent text={m.text} isUser={false} playback={playback} /></View>
              </View>
            );
          }
          return (
            <View key={m.id} style={styles.userRow}>
              {m.audioPath ? (
                <SentVoiceBubble uri={m.audioPath} playback={playback} durationMs={m.audioDurationMs} />
              ) : (
                <View style={styles.bubbleUser}><MessageContent text={m.text} isUser playback={playback} /></View>
              )}
            </View>
          );
        })}

        {lastAssistantStreaming ? (
          <View style={styles.aiRow}>
            <View style={styles.aiAvatar}><Image source={images.ipStar} style={{width: 18, height: 18}} resizeMode="contain" /></View>
            <TypingDots />
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.inputArea, {paddingBottom: insets.bottom + 10}]}>
        {isGuest ? (
          <TouchableOpacity style={styles.guestBanner}>
            <Sparkles size={16} color={colors.textSub} />
            <Text style={styles.guestText}>登录后与记忆助手对话</Text>
            <ChevronRight size={16} color={colors.textSub} />
          </TouchableOpacity>
        ) : voice.status === 'recording' ? (
          <View style={styles.voiceBanner}>
            <View style={styles.recDot} />
            <Text style={styles.voiceBannerText}>正在录音…点击麦克风结束</Text>
            <TouchableOpacity onPress={() => voice.cancel()} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <Text style={styles.voiceCancel}>取消</Text>
            </TouchableOpacity>
          </View>
        ) : voice.status === 'transcribing' ? (
          <View style={styles.voiceBanner}>
            <ActivityIndicator size="small" color={colors.textSub} />
            <Text style={styles.voiceBannerText}>识别中…</Text>
          </View>
        ) : voice.error ? (
          <View style={styles.voiceBanner}>
            <Text style={[styles.voiceBannerText, {color: '#E5484D'}]}>{voice.error}</Text>
          </View>
        ) : null}
        <View style={styles.inputBar}>
          <TouchableOpacity
            style={styles.micBtn}
            disabled={isGuest || voice.status === 'transcribing'}
            onPress={() => (voice.status === 'recording' ? voice.stop() : voice.start())}>
            {voice.status === 'transcribing' ? (
              <ActivityIndicator size="small" color={colors.textSub} />
            ) : voice.status === 'recording' ? (
              <Square size={17} color="#E5484D" fill="#E5484D" />
            ) : (
              <Mic size={20} color={isGuest ? colors.border : colors.textSub} />
            )}
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder={isGuest ? '登录后开始对话' : voice.status === 'recording' ? '正在录音…' : '说点什么…'}
            placeholderTextColor={colors.textSub}
            value={input}
            onChangeText={setInput}
            editable={!isGuest && voice.status !== 'transcribing'}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, {opacity: input.trim() && !isGuest && !isSending ? 1 : 0.35}]}
            onPress={onSend}
            disabled={!input.trim() || isGuest || isSending}>
            <ArrowUp size={19} strokeWidth={2.4} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg},
  header: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.bgSecondary},
  backBtn: {width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -6},
  avatar: {width: 42, height: 42, borderRadius: 14, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center'},
  title: {fontSize: 18, fontWeight: '700', color: colors.textMain},
  subtitle: {fontSize: 12, color: colors.textSub, marginTop: 2},
  body: {padding: 16, gap: 14},
  systemNote: {fontSize: 13, color: colors.textSub, textAlign: 'center', marginVertical: 8},
  aiRow: {flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '82%'},
  aiAvatar: {width: 30, height: 30, borderRadius: 10, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center'},
  bubbleAI: {backgroundColor: colors.bgSecondary, borderRadius: radius.pill, borderBottomLeftRadius: 6, paddingHorizontal: 14, paddingVertical: 10, flexShrink: 1},
  bubbleAIText: {fontSize: 15, lineHeight: 23, color: colors.textMain},
  userRow: {alignItems: 'flex-end'},
  bubbleUser: {backgroundColor: colors.primary, borderRadius: radius.pill, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '82%'},
  bubbleUserText: {fontSize: 15, lineHeight: 23, color: '#fff'},
  chatImage: {width: 220, height: 165, borderRadius: 12, marginVertical: 6, backgroundColor: colors.border},
  imageFallback: {flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.bg},
  imageFallbackText: {flex: 1, fontSize: 13, color: colors.textSub},
  audioCard: {width: 220, flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.bg},
  audioPlayBtn: {width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'},
  audioLabel: {fontSize: 13, fontWeight: '600', color: colors.textMain, marginBottom: 6},
  audioTrack: {height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden'},
  audioFill: {height: '100%', borderRadius: 2, backgroundColor: colors.primary},
  audioTime: {fontSize: 11, color: colors.textSub, fontVariant: ['tabular-nums'], minWidth: 28, textAlign: 'right'},
  // 用户发送的语音气泡（微信/iMessage 风格：播放键 + 波形 + 时长，深色圆角）。
  voiceMsg: {flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 2, paddingVertical: 9, paddingHorizontal: 14, backgroundColor: colors.primary, borderRadius: radius.pill, borderBottomRightRadius: 6, maxWidth: '82%'},
  voiceMsgPlay: {width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center'},
  voiceMsgWave: {flexDirection: 'row', alignItems: 'center', gap: 2, height: 20},
  voiceMsgBar: {width: 3, borderRadius: 1.5},
  voiceMsgTime: {fontSize: 12, color: 'rgba(255,255,255,0.85)', fontVariant: ['tabular-nums'], marginLeft: 2},
  typingDot: {width: 7, height: 7, borderRadius: 4, backgroundColor: colors.textSub},
  inputArea: {paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.bgSecondary},
  guestBanner: {flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bgSecondary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10},
  guestText: {flex: 1, fontSize: 13, color: colors.textSub},
  voiceBanner: {flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bgSecondary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10},
  voiceBannerText: {flex: 1, fontSize: 13, color: colors.textSub},
  recDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: '#E5484D'},
  voiceCancel: {fontSize: 13, color: colors.textSub, fontWeight: '600'},
  inputBar: {flexDirection: 'row', alignItems: 'flex-end', backgroundColor: colors.bgSecondary, borderRadius: radius.pill, paddingVertical: 6, paddingLeft: 6, paddingRight: 6, gap: 8},
  micBtn: {width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center'},
  input: {flex: 1, fontSize: 15, color: colors.textMain, maxHeight: 120, paddingTop: 8, paddingBottom: 8},
  sendBtn: {width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'},
});
