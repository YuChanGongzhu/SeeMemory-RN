import {GatewayClient} from './GatewayClient';
import type {ChatEventPayload, ChatMessage, SessionListItem} from './types';

function createIdempotencyKey() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function extractText(message: unknown): string {
  if (!message) {
    return '';
  }

  if (typeof message === 'string') {
    return message;
  }

  if (Array.isArray(message)) {
    return message
      .map(block => extractText(block))
      .filter(Boolean)
      .join('');
  }

  if (typeof message === 'object' && message !== null) {
    const maybeMessage = message as {
      text?: unknown;
      content?: Array<{type?: unknown; text?: unknown}>;
      value?: unknown;
      title?: unknown;
      label?: unknown;
      lastMessagePreview?: unknown;
    };

    if (typeof maybeMessage.text === 'string') {
      return maybeMessage.text;
    }

    if (typeof maybeMessage.value === 'string') {
      return maybeMessage.value;
    }

    if (typeof maybeMessage.title === 'string') {
      return maybeMessage.title;
    }

    if (typeof maybeMessage.label === 'string') {
      return maybeMessage.label;
    }

    if (typeof maybeMessage.lastMessagePreview === 'string') {
      return maybeMessage.lastMessagePreview;
    }

    if (Array.isArray(maybeMessage.content)) {
      return maybeMessage.content
        .map(block => {
          if (typeof block?.text === 'string') {
            return block.text;
          }
          return extractText(block);
        })
        .filter(Boolean)
        .join('');
    }
  }

  return '';
}

type AssistantPhase = 'commentary' | 'final_answer';

function normalizeAssistantPhase(value: unknown): AssistantPhase | undefined {
  return value === 'commentary' || value === 'final_answer' ? value : undefined;
}

function parseAssistantTextSignature(value: unknown): {phase?: AssistantPhase} | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  if (!value.startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as {v?: unknown; phase?: unknown};
    if (parsed.v !== 1) {
      return null;
    }
    return {
      phase: normalizeAssistantPhase(parsed.phase),
    };
  } catch {
    return null;
  }
}

function resolveAssistantMessagePhase(message: unknown): AssistantPhase | undefined {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return undefined;
  }

  const entry = message as {phase?: unknown; content?: unknown};
  const direct = normalizeAssistantPhase(entry.phase);
  if (direct) {
    return direct;
  }

  if (!Array.isArray(entry.content)) {
    return undefined;
  }

  const phases = new Set<AssistantPhase>();
  for (const block of entry.content) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      continue;
    }
    const typed = block as {type?: unknown; textSignature?: unknown};
    if (typed.type !== 'text') {
      continue;
    }
    const phase = parseAssistantTextSignature(typed.textSignature)?.phase;
    if (phase) {
      phases.add(phase);
    }
  }

  return phases.size === 1 ? Array.from(phases)[0] : undefined;
}

function extractAssistantTextForPhase(
  message: unknown,
  targetPhase?: AssistantPhase,
): string | undefined {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return undefined;
  }

  const entry = message as {text?: unknown; content?: unknown; phase?: unknown};
  const messagePhase = normalizeAssistantPhase(entry.phase);
  const shouldInclude = (phase?: AssistantPhase) => {
    if (targetPhase) {
      return phase === targetPhase;
    }
    return phase === undefined;
  };

  if (typeof entry.text === 'string') {
    return shouldInclude(messagePhase) ? entry.text.trim() || undefined : undefined;
  }

  if (typeof entry.content === 'string') {
    return shouldInclude(messagePhase) ? entry.content.trim() || undefined : undefined;
  }

  if (!Array.isArray(entry.content)) {
    return undefined;
  }

  const hasExplicitPhasedBlocks = entry.content.some(block => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      return false;
    }
    const typed = block as {type?: unknown; textSignature?: unknown};
    return typed.type === 'text' && !!parseAssistantTextSignature(typed.textSignature)?.phase;
  });

  if (!targetPhase && hasExplicitPhasedBlocks) {
    return undefined;
  }

  const parts = entry.content
    .map(block => {
      if (!block || typeof block !== 'object' || Array.isArray(block)) {
        return null;
      }
      const typed = block as {type?: unknown; text?: unknown; textSignature?: unknown};
      if (typed.type !== 'text' || typeof typed.text !== 'string') {
        return null;
      }
      const signaturePhase = parseAssistantTextSignature(typed.textSignature)?.phase;
      const resolvedPhase = signaturePhase ?? (hasExplicitPhasedBlocks ? undefined : messagePhase);
      if (!shouldInclude(resolvedPhase)) {
        return null;
      }
      const text = typed.text.trim();
      return text || null;
    })
    .filter((value): value is string => typeof value === 'string');

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join('\n').trim() || undefined;
}

function extractAssistantVisibleText(message: unknown): string | undefined {
  return (
    extractAssistantTextForPhase(message, 'final_answer') ||
    extractAssistantTextForPhase(message)
  );
}

function extractAssistantTextForSilentCheck(message: unknown): string | undefined {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return undefined;
  }

  const entry = message as {text?: unknown; content?: unknown};
  if (typeof entry.text === 'string') {
    return entry.text.trim() || undefined;
  }
  if (typeof entry.content === 'string') {
    return entry.content.trim() || undefined;
  }
  if (!Array.isArray(entry.content) || entry.content.length === 0) {
    return undefined;
  }

  const texts: string[] = [];
  for (const block of entry.content) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      return undefined;
    }
    const typed = block as {type?: unknown; text?: unknown};
    if (typed.type !== 'text' || typeof typed.text !== 'string') {
      return undefined;
    }
    texts.push(typed.text);
  }

  return texts.join('\n').trim() || undefined;
}

function hasAssistantNonTextContent(message: unknown): boolean {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return false;
  }

  const content = (message as {content?: unknown}).content;
  if (!Array.isArray(content)) {
    return false;
  }

  return content.some(block => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      return false;
    }
    return (block as {type?: unknown}).type !== 'text';
  });
}

function isSuppressedControlReplyText(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  const normalized = text.trim().toUpperCase();
  return normalized === 'NO_REPLY' || normalized === 'ANNOUNCE_SKIP' || normalized === 'REPLY_SKIP';
}

function shouldDropAssistantHistoryMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return false;
  }

  const role = (message as {role?: unknown}).role;
  if (role !== 'assistant') {
    return false;
  }

  if (resolveAssistantMessagePhase(message) === 'commentary') {
    return true;
  }

  const text = extractAssistantTextForSilentCheck(message);
  if (!isSuppressedControlReplyText(text)) {
    return false;
  }

  return !hasAssistantNonTextContent(message);
}

export class OpenClawChatClient {
  constructor(private gatewayClient: GatewayClient) {}

  async sendMessage(sessionKey: string, message: string) {
    return await this.gatewayClient.sendReq('chat.send', {
      sessionKey,
      message,
      idempotencyKey: createIdempotencyKey(),
    });
  }

  async getHistory(sessionKey: string, limit = 100) {
    return await this.gatewayClient.sendReq<{
      sessionKey: string;
      sessionId?: string;
      messages?: unknown[];
    }>('chat.history', {
      sessionKey,
      limit,
    });
  }

  async listSessions() {
    return await this.gatewayClient.sendReq<{
      sessions?: Array<{
        key?: string;
        sessionId?: string;
        title?: string;
        displayName?: string;
        derivedTitle?: string;
        label?: string;
        lastMessagePreview?: string;
        updatedAt?: number;
      }>;
    }>('sessions.list', {
      includeDerivedTitles: true,
      includeLastMessage: true,
    });
  }

  subscribe(listener: (payload: ChatEventPayload) => void) {
    return this.gatewayClient.onEvent(event => {
      if (event.event === 'chat') {
        listener((event.payload || {}) as ChatEventPayload);
      }
    });
  }
}

export function normalizeHistoryMessages(messages: unknown[] | undefined): ChatMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.flatMap((message, index) => {
    if (shouldDropAssistantHistoryMessage(message)) {
      return [];
    }

    const record =
      message && typeof message === 'object' && !Array.isArray(message)
        ? (message as {
            role?: unknown;
            content?: unknown;
            text?: unknown;
            phase?: unknown;
            __openclaw?: {id?: unknown; seq?: unknown};
          })
        : undefined;

    const rawRole = record?.role;
    const role =
      rawRole === 'assistant' || rawRole === 'user' || rawRole === 'system'
        ? rawRole
        : undefined;

    // Drop tool/toolResult/custom/unknown transcript rows from the demo UI.
    if (!role || role === 'system') {
      return [];
    }

    const text =
      role === 'assistant'
        ? extractAssistantVisibleText(record) || ''
        : typeof record?.text === 'string'
          ? record.text
          : extractText(record?.content ?? message);

    const normalizedText = text.trim();
    if (!normalizedText) {
      return [];
    }

    return [{
      id:
        typeof record?.__openclaw?.id === 'string'
          ? record.__openclaw.id
          : `history-${index}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      text: normalizedText,
    }];
  });
}

export function normalizeSessionList(items: Array<{
  key?: string;
  sessionId?: string;
  title?: string;
  displayName?: string;
  derivedTitle?: string;
  label?: string;
  lastMessagePreview?: string;
  updatedAt?: number;
}> | undefined): SessionListItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map(item => ({
      key: typeof item.key === 'string' ? item.key.trim() : '',
      sessionId: typeof item.sessionId === 'string' ? item.sessionId : undefined,
      title:
        typeof item.displayName === 'string' && item.displayName.trim()
          ? item.displayName.trim()
          : typeof item.derivedTitle === 'string' && item.derivedTitle.trim()
            ? item.derivedTitle.trim()
            : typeof item.label === 'string' && item.label.trim()
              ? item.label.trim()
              : typeof item.lastMessagePreview === 'string' && item.lastMessagePreview.trim()
                ? item.lastMessagePreview.trim()
          : typeof item.title === 'string' && item.title.trim()
            ? item.title.trim()
            : undefined,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : undefined,
    }))
    .filter(item => item.key);
}
