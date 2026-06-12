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
  Image,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme/ThemeProvider';
import type {Theme} from '../theme/index';
import {MicIcon, CameraIcon, SendIcon} from '../components/Icons';
import {AnimatedOrb, BubbleInView, FadeUpView} from '../components/Animated';
import {useHermesChat} from '../hooks/useHermesChat';
import {pickImageFromLibrary} from '../native/ImagePickerModule';
import type {ChatMessage} from '../types/chat';
import {
  loadConversations,
  addConversation,
  type Conversation,
  type ExtendedMessage,
  type MemoryCard,
} from '../services/conversationStore';
import {ReplayPage} from '../components/ReplayPage';

// "看海" demo - 完全按照 HTML 原型的 mock 数据
const seaDemoConversation: Conversation = {
  id: 'demo-sea',
  title: '看海',
  lastMessage: '6月7日，上周日。那天海边风很大，你说"想把这阵风装进瓶子里"。',
  time: '6月7日',
  messages: [
    {id: 's1', role: 'assistant', text: '我是光。想不起来的事，问我就好——你见过谁、去过哪、那天什么天气、说过什么话，我都替你记着。'},
    {id: 's2', role: 'user', text: '上次见到海是什么时候？'},
    {id: 's3', role: 'assistant', text: '6月7日，上周日。那天海边风很大，你说"想把这阵风装进瓶子里"。', card: {date: '6月7日 · 上周日', title: '海边，风很大', season: '夏', hue: 196, dayId: 'd2'}},
  ],
};

// HTML 原型中的 days 数据
const mockDays = [
  {id: 'd1', date: '2026年6月11日', rel: '昨天', title: '写贪吃蛇代码的那天', season: '夏', hue: 178},
  {id: 'd2', date: '2026年6月7日', rel: '上周日', title: '海边，风很大', season: '夏', hue: 196},
  {id: 'd3', date: '2026年5月20日', rel: '上个月', title: '她第一次喊"妈妈"', season: '春', hue: 96},
  {id: 'd4', date: '2025年6月12日', rel: '去年今天', title: '同一条河堤，那时还冷', season: '春', hue: 128},
  {id: 'd5', date: '2025年12月20日', rel: '去年冬天', title: '初雪，窗上全是雾', season: '冬', hue: 212},
  {id: 'd6', date: '2025年10月18日', rel: '去年秋天', title: '银杏铺满了整条路', season: '秋', hue: 42},
];

// 建议标签
const suggestedQuestions = [
  '去年今天',
  '上周的会议',
];

const seasonColors: Record<string, {main: string; soft: string}> = {
  '春': {main: '#7FA868', soft: '#E8EEDD'},
  '夏': {main: '#3F8A82', soft: '#DCEAE6'},
  '秋': {main: '#C2803C', soft: '#F2E6D4'},
  '冬': {main: '#7C92A6', soft: '#E4E9EE'},
};

// 检测文本中的图片 URL 并渲染
function renderTextWithImages(text: string, isUser: boolean, theme: Theme) {
  const parts: React.ReactNode[] = [];
  const urlRegex = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|bmp|heic))/gi;
  let lastIndex = 0;
  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <Text key={`text-${lastIndex}`} style={{color: isUser ? '#FFFFFF' : '#3F473F', lineHeight: 22}}>
          {text.slice(lastIndex, match.index)}
        </Text>
      );
    }
    parts.push(
      <Image
        key={`img-${match.index}`}
        source={{uri: match[0]}}
        style={{width: 200, height: 150, borderRadius: 12, marginVertical: 8}}
        resizeMode="cover"
      />
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(
      <Text key={`text-${lastIndex}`} style={{color: isUser ? '#FFFFFF' : '#3F473F', lineHeight: 22}}>
        {text.slice(lastIndex)}
      </Text>
    );
  }

  return parts;
}

// 流式动画指示器
function StreamingIndicator({color}: {color: string}) {
  return (
    <View style={localStyles.streamingContainer}>
      <View style={[localStyles.streamingDot, {backgroundColor: color}]} />
      <View style={[localStyles.streamingDot, {backgroundColor: color, marginLeft: 4}]} />
      <View style={[localStyles.streamingDot, {backgroundColor: color, marginLeft: 4}]} />
    </View>
  );
}

// 记忆卡片组件 - 和 HTML 原型完全一致
function MemoryCardComponent({card, theme, onPress}: {card: MemoryCard; theme: Theme; onPress?: () => void}) {
  const colors = seasonColors[card.season] || seasonColors['夏'];
  return (
    <TouchableOpacity
      style={[localStyles.memoryCard]}
      onPress={onPress}
      activeOpacity={0.7}>
      <View style={[localStyles.memoryCardThumb, {
        backgroundColor: `hsl(${card.hue}, 26%, 84%)`,
      }]}>
        <Text style={[localStyles.memoryCardThumbLabel, {color: `hsl(${card.hue}, 24%, 35%)`}]}>
          {card.date.split(' ')[0]}
        </Text>
      </View>
      <View style={localStyles.memoryCardContent}>
        <Text style={[localStyles.memoryCardDate, {color: colors.main}]}>
          {card.date}
        </Text>
        <Text style={[localStyles.memoryCardTitle, {color: '#28302C'}]}>
          {card.title}
        </Text>
        <View style={[localStyles.memoryCardSeasonBadge, {backgroundColor: colors.soft}]}>
          <Text style={[localStyles.memoryCardSeasonText, {color: colors.main}]}>
            {card.season}
          </Text>
        </View>
      </View>
      <Text style={[localStyles.memoryCardArrow, {color: '#C3C8BB'}]}>›</Text>
    </TouchableOpacity>
  );
}

// 历史会话卡片
function ConversationCard({conversation, theme, onPress}: {
  conversation: Conversation;
  theme: Theme;
  onPress: () => void;
}) {
  const s = theme.spacing;
  const r = theme.radius;

  return (
    <TouchableOpacity
      style={[localStyles.convCard, {
        backgroundColor: theme.colors.bgCard,
        borderColor: theme.colors.border,
        borderRadius: r.lg,
        padding: s.md,
      }]}
      onPress={onPress}
      activeOpacity={0.7}>
      <View style={localStyles.convCardHeader}>
        <View style={[localStyles.convCardIcon, {backgroundColor: theme.colors.accent + '18'}]}>
          <Text style={{fontSize: 16}}>💬</Text>
        </View>
        <View style={{flex: 1}}>
          <Text style={[localStyles.convCardTitle, {color: theme.colors.text}]}>
            {conversation.title}
          </Text>
          <Text style={[localStyles.convCardTime, {color: theme.colors.textMuted}]}>
            {conversation.time}
          </Text>
        </View>
        <Text style={[localStyles.convCardArrow, {color: theme.colors.textMuted}]}>›</Text>
      </View>
      <Text style={[localStyles.convCardPreview, {color: theme.colors.textSecondary}]} numberOfLines={2}>
        {conversation.lastMessage}
      </Text>
    </TouchableOpacity>
  );
}

// 气泡组件 - 按照 HTML 原型样式
function ChatBubble({message, theme, index, onCardPress}: {
  message: ExtendedMessage;
  theme: Theme;
  index: number;
  onCardPress?: (card: MemoryCard) => void;
}) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <BubbleInView delay={index * 50}>
        <View style={localStyles.systemRow}>
          <Text style={[localStyles.systemText, {color: theme.colors.textMuted}]}>
            {message.text}
          </Text>
        </View>
      </BubbleInView>
    );
  }

  return (
    <BubbleInView delay={index * 50}>
      <View style={[localStyles.bubbleRow, {justifyContent: isUser ? 'flex-end' : 'flex-start'}]}>
        {!isUser && (
          <AnimatedOrb
            size={30}
            colors={['#F7E0AB', '#E3A94F']}
            glowColor="rgba(242, 204, 131, 0.4)"
          />
        )}
        <View style={{flex: 1, maxWidth: '82%'}}>
          {/* 气泡 */}
          <View style={[
            isUser ? localStyles.userBubble : localStyles.aiBubble,
            isUser && {alignSelf: 'flex-end'},
          ]}>
            {renderTextWithImages(message.text, isUser, theme)}
            {message.isStreaming && <StreamingIndicator color="#3F8A82" />}
          </View>
          {/* 记忆卡片 - 只有有 card 的消息才显示 */}
          {message.card && (
            <MemoryCardComponent
              card={message.card}
              theme={theme}
              onPress={() => onCardPress?.(message.card!)}
            />
          )}
        </View>
        {isUser && (
          <View style={[localStyles.userAvatar, {backgroundColor: '#3F8A82'}]} />
        )}
      </View>
    </BubbleInView>
  );
}

export function ChatScreen() {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const s = theme.spacing;
  const r = theme.radius;

  // 视图模式：'list' = 历史列表，'chat' = 聊天
  const [viewMode, setViewMode] = useState<'list' | 'chat'>('list');
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [conversationList, setConversationList] = useState<Conversation[]>([seaDemoConversation]);

  // Replay 页面状态
  const [replayDay, setReplayDay] = useState<any>(null);
  const [replayOpen, setReplayOpen] = useState(false);

  const {
    selectedDevice,
    messages: realMessages,
    isSending,
    isUploadingImage,
    send,
    sendImageMessage,
    reset,
  } = useHermesChat();

  // 当前显示的消息
  // 历史对话是只读的，新对话可以发送
  const messages = activeConversation ? activeConversation.messages : realMessages;
  const isViewingHistory = !!activeConversation;

  // 加载历史对话
  useEffect(() => {
    loadConversations().then(saved => {
      // 合并 demo 和保存的对话，demo 始终在最前面
      const withoutDemo = saved.filter(c => c.id !== 'demo-sea');
      setConversationList([seaDemoConversation, ...withoutDemo]);
    });
  }, []);

  useEffect(() => {
    if (viewMode === 'chat') {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({animated: true});
      }, 100);
    }
  }, [messages, viewMode]);

  // 保存对话到历史记录
  const saveCurrentConversation = async (msgs: ExtendedMessage[]) => {
    if (!selectedDevice || msgs.length === 0) return;
    
    // 生成标题（取第一条用户消息的前10个字）
    const firstUserMsg = msgs.find(m => m.role === 'user');
    const title = firstUserMsg 
      ? firstUserMsg.text.slice(0, 10) + (firstUserMsg.text.length > 10 ? '...' : '')
      : '新对话';
    
    const lastMsg = msgs[msgs.length - 1];
    const now = new Date();
    const timeStr = `${now.getMonth() + 1}月${now.getDate()}日`;

    const conv: Conversation = {
      id: `conv-${selectedDevice.subDomain}-${Date.now()}`,
      title,
      lastMessage: lastMsg.text.slice(0, 50),
      time: timeStr,
      messages: msgs,
    };

    await addConversation(conv);
    
    // 更新列表
    const updated = await loadConversations();
    const withoutDemo = updated.filter(c => c.id !== 'demo-sea');
    setConversationList([seaDemoConversation, ...withoutDemo]);
  };

  const handleSend = async () => {
    if (!inputText.trim() || isSending || isViewingHistory) return;
    const text = inputText;
    setInputText('');
    await send(text);
  };

  const handlePickImage = async () => {
    try {
      const picked = await pickImageFromLibrary();
      if (!picked || picked.didCancel || !picked.filePath) return;
      const text = inputText;
      setInputText('');
      await sendImageMessage({filePath: picked.filePath, mimeType: picked.mimeType, text});
    } catch (error) {
      console.log('Image pick error:', error);
    }
  };

  const handleSuggestion = async (suggestion: string) => {
    if (isSending) return;
    setInputText('');
    await send(suggestion);
  };

  // 当真实对话结束时保存
  useEffect(() => {
    if (!isSending && realMessages.length > 0 && activeConversation === null) {
      // 对话刚结束，保存到历史记录
      saveCurrentConversation(realMessages);
    }
  }, [isSending]);

  const handleOpenConversation = (conv: Conversation) => {
    setActiveConversation(conv);
    setViewMode('chat');
  };

  const handleNewConversation = () => {
    reset();
    setActiveConversation(null);
    setViewMode('chat');
  };

  const handleBack = () => {
    setViewMode('list');
    setActiveConversation(null);
  };

  const handleCardPress = (card: MemoryCard) => {
    // 按照 HTML 原型的交互逻辑
    if (card.dayId) {
      // 打开 replay 页面
      const day = mockDays.find(d => d.id === card.dayId);
      if (day) {
        setReplayDay(day);
        setReplayOpen(true);
      }
    }
  };

  // 历史列表视图
  if (viewMode === 'list') {
    return (
      <View style={[localStyles.container, {backgroundColor: theme.colors.bg}]}>
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
          <TouchableOpacity
            style={[localStyles.newChatBtn, {backgroundColor: '#3F8A82'}]}
            onPress={handleNewConversation}>
            <Text style={localStyles.newChatBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={conversationList}
          keyExtractor={item => item.id}
          contentContainerStyle={[localStyles.convListContent, {paddingHorizontal: s.lg, paddingBottom: s.lg}]}
          showsVerticalScrollIndicator={false}
          renderItem={({item, index}) => (
            <FadeUpView delay={index * 80}>
              <ConversationCard
                conversation={item}
                theme={theme}
                onPress={() => handleOpenConversation(item)}
              />
            </FadeUpView>
          )}
          ListHeaderComponent={
            <Text style={[localStyles.convListTitle, {color: theme.colors.textSecondary}]}>
              历史对话
            </Text>
          }
        />
      </View>
    );
  }

  // 聊天视图
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
        <TouchableOpacity style={localStyles.backBtn} onPress={handleBack}>
          <Text style={{fontSize: 20, color: theme.colors.text}}>←</Text>
        </TouchableOpacity>
        <View style={localStyles.headerCenter}>
          <Text style={[localStyles.headerTitle, {color: theme.colors.text}]}>
            {activeConversation?.title || '新对话'}
          </Text>
          <Text style={[localStyles.headerSubtitle, {color: theme.colors.textMuted}]}>
            想不起来的事，问我就好
          </Text>
        </View>
        <View style={{width: 36}} />
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={({item, index}) => (
          <View style={{marginBottom: 14}}>
            <ChatBubble
              message={item}
              theme={theme}
              index={index}
              onCardPress={handleCardPress}
            />
          </View>
        )}
        contentContainerStyle={[localStyles.messageList, {paddingHorizontal: s.lg, paddingBottom: s.lg}]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={localStyles.emptyContainer}>
            <AnimatedOrb size={60} colors={['#F7E0AB', '#E3A94F']} glowColor="rgba(242, 204, 131, 0.4)" />
            <Text style={[localStyles.emptyText, {color: theme.colors.textMuted, marginTop: s.md}]}>
              有什么想问光的？
            </Text>
          </View>
        }
      />

      {/* Suggestion chips - 只有新对话才显示 */}
      {!activeConversation && messages.length <= 2 && (
        <View style={[localStyles.suggestionRow, {marginHorizontal: s.lg}]}>
          {suggestedQuestions.map((q, i) => (
            <TouchableOpacity
              key={i}
              style={[localStyles.suggestionChip, {
                backgroundColor: 'rgba(255,255,255,0.92)',
                borderColor: '#E0DBCC',
                borderRadius: 18,
              }]}
              onPress={() => handleSuggestion(q)}
              disabled={isSending}>
              <Text style={[localStyles.suggestionText, {color: '#3F473F'}]}>
                {q}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Input Area */}
      <View style={[localStyles.inputContainer, {
        paddingHorizontal: s.lg,
        paddingBottom: insets.bottom + s.md,
        paddingTop: s.sm,
      }]}>
        <View style={[localStyles.inputWrapper, {
          backgroundColor: '#FFFFFF',
          borderColor: '#E3DECF',
          borderRadius: 24,
          paddingHorizontal: 8,
          paddingVertical: 8,
          borderWidth: 1,
        }]}>
          <TouchableOpacity
            style={[localStyles.cameraBtn, {marginLeft: 6}]}
            onPress={handlePickImage}
            disabled={isViewingHistory}>
            <CameraIcon size={20} color={isViewingHistory ? '#D5D2C2' : '#9AA095'} />
          </TouchableOpacity>
          <TextInput
            style={[localStyles.input, {color: isViewingHistory ? '#D5D2C2' : '#28302C', fontSize: 13.5}]}
            placeholder={isViewingHistory ? '这是历史对话' : '问问光，帮你想起来…'}
            placeholderTextColor="#9AA095"
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            editable={!isViewingHistory}
          />
          {inputText.trim() && !isViewingHistory ? (
            <TouchableOpacity
              style={[localStyles.sendBtn, {
                backgroundColor: '#3F8A82',
              }]}
              onPress={handleSend}
              disabled={isSending}>
              <SendIcon size={17} color="#FFFFFF" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Replay 页面 */}
      <ReplayPage
        visible={replayOpen}
        day={replayDay}
        onClose={() => setReplayOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}

const localStyles = StyleSheet.create({
  container: {flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    flex: 1,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newChatBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newChatBtnText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '600',
  },
  convListContent: {
    paddingTop: 16,
  },
  convListTitle: {
    fontSize: 13,
    marginBottom: 12,
  },
  convCard: {
    borderWidth: 1,
    marginBottom: 12,
  },
  convCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  convCardIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  convCardTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  convCardTime: {
    fontSize: 11,
    marginTop: 2,
  },
  convCardArrow: {
    fontSize: 18,
  },
  convCardPreview: {
    fontSize: 13,
    lineHeight: 18,
  },
  messageList: {},
  systemRow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  systemText: {
    fontSize: 12,
    textAlign: 'center',
  },
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
  aiBubble: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EAE5D7',
    borderRadius: 16,
    borderBottomLeftRadius: 5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    maxWidth: '100%',
  },
  userBubble: {
    backgroundColor: '#3F8A82',
    borderRadius: 16,
    borderBottomRightRadius: 5,
    paddingHorizontal: 14,
    paddingVertical: 11,
    maxWidth: '100%',
  },
  memoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EAE5D7',
    borderRadius: 16,
    padding: 10,
    marginTop: 9,
    gap: 11,
    shadowColor: '#283C2D',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 4,
  },
  memoryCardThumb: {
    width: 54,
    height: 54,
    borderRadius: 12,
    justifyContent: 'flex-end',
    padding: 6,
  },
  memoryCardThumbLabel: {
    fontSize: 9,
    fontFamily: 'ui-monospace',
    backgroundColor: 'rgba(255,255,255,0.62)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    alignSelf: 'flex-start',
  },
  memoryCardContent: {
    flex: 1,
  },
  memoryCardDate: {
    fontSize: 11,
    fontWeight: '700',
  },
  memoryCardTitle: {
    fontSize: 13.5,
    fontWeight: '600',
    marginTop: 2,
  },
  memoryCardSeasonBadge: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 6,
  },
  memoryCardSeasonText: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  memoryCardArrow: {
    fontSize: 17,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
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
  streamingContainer: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 8,
    alignItems: 'center',
  },
  streamingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    opacity: 0.4,
  },
});
