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
}
