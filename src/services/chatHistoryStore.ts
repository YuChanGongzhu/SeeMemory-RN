import AsyncStorage from '@react-native-async-storage/async-storage';
import type {ChatMessage} from '../types/chat';

// 聊天历史按「记忆盒子」(subDomain) 分别持久化，互不串台。
const PREFIX = '@ringmemory:chat_history:';
const MAX_MESSAGES = 200;

function keyFor(boxId: string) {
  return `${PREFIX}${boxId}`;
}

export async function loadChatHistory(boxId: string): Promise<ChatMessage[]> {
  if (!boxId) return [];
  try {
    const raw = await AsyncStorage.getItem(keyFor(boxId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(m => m && typeof m.id === 'string' && typeof m.text === 'string' && typeof m.role === 'string')
      .map(m => ({...m, isStreaming: false}) as ChatMessage);
  } catch {
    return [];
  }
}

export async function saveChatHistory(boxId: string, messages: ChatMessage[]): Promise<void> {
  if (!boxId) return;
  try {
    const sanitized = messages
      // 不持久化系统提示行(选盒子/出错等都是临时性的)
      .filter(m => m.role !== 'system')
      // 丢掉还没收到内容的流式占位
      .filter(m => !(m.role === 'assistant' && !m.text))
      // 只保留稳定字段，去掉运行期(isStreaming)与体积大的(debugRaw)字段
      .map(m => {
        const out: ChatMessage = {id: m.id, role: m.role, text: m.text};
        if (m.runId) out.runId = m.runId;
        if (m.debugSource) out.debugSource = m.debugSource;
        return out;
      })
      .slice(-MAX_MESSAGES);
    if (!sanitized.length) {
      await AsyncStorage.removeItem(keyFor(boxId));
      return;
    }
    await AsyncStorage.setItem(keyFor(boxId), JSON.stringify(sanitized));
  } catch {
    // 持久化失败不影响会话本身
  }
}

export async function clearChatHistory(boxId: string): Promise<void> {
  if (!boxId) return;
  try {
    await AsyncStorage.removeItem(keyFor(boxId));
  } catch {
    // ignore
  }
}
