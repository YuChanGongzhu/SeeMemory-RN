import React, {useState, useRef, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme/ThemeProvider';
import type {Theme} from '../theme/index';
import {MicIcon, BackIcon} from '../components/Icons';
import {AnimatedOrb, BubbleInView} from '../components/Animated';

type ChatMessage = {
  id: string;
  role: 'ai' | 'user';
  text: string;
  card?: {
    date: string;
    title: string;
    season: string;
    hue: number;
  };
};

const initialMessages: ChatMessage[] = [
  {
    id: '1',
    role: 'ai',
    text: '我是光。想不起来的事，问我就好——你见过谁、去过哪、那天什么天气、说过什么话，我都替你记着。',
  },
  {
    id: '2',
    role: 'user',
    text: '上次见到海是什么时候？',
  },
  {
    id: '3',
    role: 'ai',
    text: '6月7日，上周日。那天海边风很大，你说"想把这阵风装进瓶子里"。',
    card: {
      date: '6月7日 · 上周日',
      title: '海边，风很大',
      season: '夏',
      hue: 196,
    },
  },
];

const suggestedQuestions = [
  '上次见到海',
  '6神 最近',
  '去年今天',
  '上周的会议',
];

const qaMap: Record<string, {text: string; card?: ChatMessage['card']}> = {
  '上次见到海是什么时候': {
    text: '6月7日，上周日。那天海边风很大，你说"想把这阵风装进瓶子里"。',
    card: {date: '6月7日 · 上周日', title: '海边，风很大', season: '夏', hue: 196},
  },
  '6神最近怎么样': {
    text: '就在今天 13:30——6神在阳台啃彩色玉米，毛茸茸的，连耳朵都垂得认真。这个月你一共拍了它 38 次。',
    card: {date: '今天 13:30', title: '6神在啃彩色玉米', season: '夏', hue: 96},
  },
  '去年今天我在做什么': {
    text: '2025年6月12日，你也在滨河绿道晨跑。那时还要更冷些，你写下"想换个城市看看"。',
    card: {date: '去年今天', title: '同一条河堤，那时还冷', season: '春', hue: 128},
  },
  '上周的会议都定了什么': {
    text: '产品评审会定了两件事：按键集中单侧、正面无按键；首版功能可用优先于外观，并留下 3 条待办。',
    card: {date: '今天 10:00', title: '产品评审会 · 纪要', season: '秋', hue: 42},
  },
};

const seasonColors: Record<string, {main: string; soft: string}> = {
  '春': {main: '#7FA868', soft: '#E8EEDD'},
  '夏': {main: '#3F8A82', soft: '#DCEAE6'},
  '秋': {main: '#C2803C', soft: '#F2E6D4'},
  '冬': {main: '#7C92A6', soft: '#E4E9EE'},
};

function ChatBubble({message, theme, index}: {message: ChatMessage; theme: Theme; index: number}) {
  const isUser = message.role === 'user';
  const r = theme.radius;
  const s = theme.spacing;

  return (
    <BubbleInView delay={index * 100}>
      <View style={[localStyles.bubbleRow, {justifyContent: isUser ? 'flex-end' : 'flex-start'}]}>
        {!isUser && (
          <AnimatedOrb
            size={30}
            colors={['#F7E0AB', '#E3A94F']}
            glowColor="rgba(242, 204, 131, 0.4)"
          />
        )}
        <View style={[localStyles.bubble, {
          maxWidth: isUser ? '80%' : '85%',
          backgroundColor: isUser ? theme.colors.accent : theme.colors.bgCard,
          borderColor: isUser ? 'transparent' : theme.colors.border,
          borderRadius: isUser ? `${r.lg}px ${r.lg}px 5px ${r.lg}px` : `${r.lg}px ${r.lg}px ${r.lg}px 5px`,
          paddingHorizontal: s.sm + 6,
          paddingVertical: s.sm + 3,
          borderWidth: isUser ? 0 : 1,
        }]}>
          <Text style={[localStyles.bubbleText, {
            color: isUser ? '#FFFFFF' : theme.colors.text,
            lineHeight: 22,
          }]}>
            {message.text}
          </Text>
        </View>
        {isUser && (
          <View style={[localStyles.userAvatar, {
            backgroundColor: theme.colors.accent,
          }]} />
        )}
      </View>
    </BubbleInView>
  );
}

function MessageCard({card, theme}: {card: NonNullable<ChatMessage['card']>; theme: Theme}) {
  const colors = seasonColors[card.season] || seasonColors['夏'];
  const r = theme.radius;
  const s = theme.spacing;

  return (
    <TouchableOpacity
      style={[localStyles.messageCard, {
        backgroundColor: theme.colors.bgCard,
        borderColor: theme.colors.border,
        borderRadius: r.lg,
        padding: s.sm + 2,
      }]}
      activeOpacity={0.7}>
      <View style={[localStyles.cardThumb, {
        backgroundColor: `hsl(${card.hue}, 26%, 84%)`,
        borderRadius: r.sm + 4,
      }]} />
      <View style={localStyles.cardContent}>
        <Text style={[localStyles.cardDate, {color: colors.main}]}>
          {card.date}
        </Text>
        <Text style={[localStyles.cardTitle, {color: theme.colors.text}]}>
          {card.title}
        </Text>
        <View style={[localStyles.cardSeasonBadge, {backgroundColor: colors.soft}]}>
          <Text style={[localStyles.cardSeasonText, {color: colors.main}]}>
            {card.season}
          </Text>
        </View>
      </View>
      <Text style={[localStyles.cardArrow, {color: theme.colors.textMuted}]}>›</Text>
    </TouchableOpacity>
  );
}

export function ChatScreen() {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const s = theme.spacing;
  const r = theme.radius;

  useEffect(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({animated: true});
    }, 100);
  }, [messages]);

  const handleSend = () => {
    if (!inputText.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: inputText.trim(),
    };
    setMessages(prev => [...prev, userMessage]);
    setInputText('');

    // Simulate AI response
    setTimeout(() => {
      const qaKey = Object.keys(qaMap).find(key => inputText.includes(key.slice(0, 4)));
      const response = qaKey ? qaMap[qaKey] : {
        text: '我帮你想想...让我在记忆里搜寻一下。',
      };

      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        text: response.text,
        card: response.card,
      };
      setMessages(prev => [...prev, aiMessage]);
    }, 800);
  };

  const handleSuggestion = (suggestion: string) => {
    setInputText(suggestion);
    setTimeout(() => handleSend(), 100);
  };

  const renderItem = ({item, index}: {item: ChatMessage; index: number}) => (
    <View style={{marginBottom: s.md}}>
      <ChatBubble message={item} theme={theme} index={index} />
      {item.card && (
        <View style={{marginTop: s.sm, marginLeft: 40}}>
          <MessageCard card={item.card} theme={theme} />
        </View>
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={[localStyles.container, {backgroundColor: theme.colors.bg}]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}>
      {/* Header */}
      <View style={[localStyles.header, {
        paddingTop: insets.top + s.md,
        paddingHorizontal: s.lg,
        paddingBottom: s.sm + 4,
      }]}>
        <View style={localStyles.headerLeft}>
          <AnimatedOrb
            size={42}
            colors={['#F7E0AB', '#E3A94F']}
            glowColor="rgba(242, 204, 131, 0.4)"
          />
          <View>
            <Text style={[localStyles.headerTitle, {color: theme.colors.text}]}>
              和光聊聊
            </Text>
            <Text style={[localStyles.headerSubtitle, {color: theme.colors.textMuted}]}>
              想不起来的事，问我就好
            </Text>
          </View>
        </View>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={[localStyles.messageList, {paddingHorizontal: s.lg, paddingBottom: s.lg}]}
        showsVerticalScrollIndicator={false}
      />

      {/* Suggestion chips */}
      <View style={[localStyles.suggestionRow, {marginHorizontal: s.lg}]}>
        {suggestedQuestions.map((q, i) => (
          <TouchableOpacity
            key={i}
            style={[localStyles.suggestionChip, {
              backgroundColor: 'rgba(255,255,255,0.92)',
              borderColor: theme.colors.border,
              borderRadius: r.pill,
            }]}
            onPress={() => handleSuggestion(q)}>
            <Text style={[localStyles.suggestionText, {color: theme.colors.text}]}>
              {q}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Input Area */}
      <View style={[localStyles.inputContainer, {
        paddingHorizontal: s.lg,
        paddingBottom: insets.bottom + s.md,
        paddingTop: s.sm,
      }]}>
        <View style={[localStyles.inputWrapper, {
          backgroundColor: theme.colors.bgCard,
          borderColor: theme.colors.border,
          borderRadius: r.pill,
          paddingHorizontal: s.md,
          paddingVertical: s.sm,
          borderWidth: 1,
        }]}>
          <TouchableOpacity style={[localStyles.cameraBtn, {marginRight: s.sm}]}>
            <Text style={{fontSize: 18}}>📷</Text>
          </TouchableOpacity>
          <TextInput
            style={[localStyles.input, {color: theme.colors.text, fontSize: 13.5}]}
            placeholder="问问光，帮你想起来…"
            placeholderTextColor={theme.colors.textMuted}
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          <TouchableOpacity
            style={[localStyles.sendBtn, {backgroundColor: theme.colors.bgSecondary}]}
            onPress={handleSend}>
            <MicIcon size={17} color={theme.colors.accent} />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const localStyles = StyleSheet.create({
  container: {flex: 1},
  header: {},
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  messageList: {},
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  userAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  bubble: {},
  bubbleText: {
    fontSize: 13.5,
  },
  messageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    gap: 11,
  },
  cardThumb: {
    width: 54,
    height: 54,
  },
  cardContent: {flex: 1},
  cardDate: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardTitle: {
    fontSize: 13.5,
    fontWeight: '600',
    marginTop: 2,
  },
  cardSeasonBadge: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 6,
  },
  cardSeasonText: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  cardArrow: {
    fontSize: 17,
  },
  suggestionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  suggestionChip: {
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  suggestionText: {
    fontSize: 12,
  },
  inputContainer: {},
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cameraBtn: {},
  input: {
    flex: 1,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
