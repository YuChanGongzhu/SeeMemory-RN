export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  isStreaming?: boolean;
  runId?: string;
  // Kept optional for the message-bubble debug long-press in MemoryScreen.
  debugRaw?: unknown;
  debugSource?: 'event' | 'history';
  // 用户语音消息：本地音频路径（可本地回听）+ 时长。text 存转写文本发给 agent。
  audioPath?: string;
  audioDurationMs?: number;
}
