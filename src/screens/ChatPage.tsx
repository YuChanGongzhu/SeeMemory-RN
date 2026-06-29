import React, {useEffect, useRef, useState} from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, Image, Animated,
  KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronLeft, Mic, ArrowUp, Sparkles, ChevronRight} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {images} from '../design/assets';
import {useNav} from '../navigation/nav';
import {useAuth} from '../auth/AuthContext';
import {useHermesChat} from '../hooks/useHermesChat';

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

const IMG_URL_RE = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|bmp|heic))/gi;

/** Renders bubble text, turning image URLs into inline images (parity with committed ChatScreen.renderTextWithImages). */
function MessageContent({text, isUser}: {text: string; isUser: boolean}) {
  const textStyle = isUser ? styles.bubbleUserText : styles.bubbleAIText;
  const parts: React.ReactNode[] = [];
  const re = new RegExp(IMG_URL_RE);
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<Text key={`t${i}`} style={textStyle}>{text.slice(last, m.index)}</Text>);
    }
    parts.push(<Image key={`i${i}`} source={{uri: m[0]}} style={styles.chatImage} resizeMode="cover" />);
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
  const {messages, isSending, send} = useHermesChat();
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

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
                <View style={styles.bubbleAI}><MessageContent text={m.text} isUser={false} /></View>
              </View>
            );
          }
          return (
            <View key={m.id} style={styles.userRow}>
              <View style={styles.bubbleUser}><MessageContent text={m.text} isUser /></View>
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
        ) : null}
        <View style={styles.inputBar}>
          <TouchableOpacity style={styles.micBtn}>
            <Mic size={20} color={colors.textSub} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder={isGuest ? '登录后开始对话' : '说点什么…'}
            placeholderTextColor={colors.textSub}
            value={input}
            onChangeText={setInput}
            editable={!isGuest}
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
  chatImage: {width: 200, height: 150, borderRadius: 12, marginVertical: 6},
  typingDot: {width: 7, height: 7, borderRadius: 4, backgroundColor: colors.textSub},
  inputArea: {paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.bgSecondary},
  guestBanner: {flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bgSecondary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10},
  guestText: {flex: 1, fontSize: 13, color: colors.textSub},
  inputBar: {flexDirection: 'row', alignItems: 'flex-end', backgroundColor: colors.bgSecondary, borderRadius: radius.pill, paddingVertical: 6, paddingLeft: 6, paddingRight: 6, gap: 8},
  micBtn: {width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center'},
  input: {flex: 1, fontSize: 15, color: colors.textMain, maxHeight: 120, paddingTop: 8, paddingBottom: 8},
  sendBtn: {width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'},
});
