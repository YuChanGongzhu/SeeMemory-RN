import AsyncStorage from '@react-native-async-storage/async-storage';
import type {ChatMessage} from '../types/chat';

// 记忆卡片类型
export type MemoryCard = {
  date: string;
  title: string;
  season: string;
  hue: number;
  dayId?: string;
  momentId?: string;
  summaryId?: string;
};

// 扩展的消息类型
export type ExtendedMessage = ChatMessage & {
  card?: MemoryCard;
};

// 历史会话类型
export type Conversation = {
  id: string;
  title: string;
  lastMessage: string;
  time: string;
  messages: ExtendedMessage[];
};

// 存储键
const CONVERSATIONS_KEY = '@ringmemory:conversations';

// 加载历史对话列表
export async function loadConversations(): Promise<Conversation[]> {
  try {
    const raw = await AsyncStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(c => c && typeof c.id === 'string' && typeof c.title === 'string');
  } catch {
    return [];
  }
}

// 保存历史对话列表
export async function saveConversations(conversations: Conversation[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
  } catch {
    // 持久化失败不影响使用
  }
}

// 添加新的历史对话
export async function addConversation(conversation: Conversation): Promise<void> {
  const conversations = await loadConversations();
  // 检查是否已存在，如果存在则更新
  const index = conversations.findIndex(c => c.id === conversation.id);
  if (index >= 0) {
    conversations[index] = conversation;
  } else {
    conversations.unshift(conversation);
  }
  // 最多保存 20 个对话
  await saveConversations(conversations.slice(0, 20));
}

// 删除历史对话
export async function deleteConversation(id: string): Promise<void> {
  const conversations = await loadConversations();
  await saveConversations(conversations.filter(c => c.id !== id));
}

// 清空历史对话
export async function clearConversations(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CONVERSATIONS_KEY);
  } catch {
    // ignore
  }
}
