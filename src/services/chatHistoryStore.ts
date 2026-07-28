import AsyncStorage from '@react-native-async-storage/async-storage';
import type {ChatMessage} from '../types/chat';

// 聊天历史按 sessionId 持久化（当前为「登录用户单会话」）。key 通用，调用方决定粒度。
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
        // 语音消息的本地音频路径与时长：持久化后重开仍可回听（文件存在时）。
        if (m.audioPath) out.audioPath = m.audioPath;
        if (m.audioDurationMs) out.audioDurationMs = m.audioDurationMs;
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

// 清除所有聊天历史（登出时调用，避免换账号后看到上一个用户的会话）。
export async function clearAllChatHistory(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter(k => k.startsWith(PREFIX));
    if (mine.length) {
      await Promise.all(mine.map(key => AsyncStorage.removeItem(key)));
    }
  } catch {
    // ignore
  }
}
