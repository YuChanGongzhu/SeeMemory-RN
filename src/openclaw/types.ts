export type ConnectionState =
  | 'idle'
  | 'loading'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface GatewayErrorPayload {
  code?: string;
  message?: string;
  details?: unknown;
}

export interface GatewayReqFrame {
  type: 'req';
  id: string;
  method: string;
  params?: unknown;
}

export interface GatewayResFrame<T = unknown> {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: T;
  error?: GatewayErrorPayload;
}

export interface GatewayEventFrame<T = unknown> {
  type: 'event';
  event: string;
  payload?: T;
  seq?: number;
}

export interface GatewayStatus {
  state: ConnectionState;
  detail: string;
}

export interface HelloOkPayload {
  type?: string;
  protocol?: number;
  server?: {
    version?: string;
  };
}

export type ChatEventState = 'delta' | 'final' | 'error' | 'aborted';

export interface ChatEventPayload {
  state: ChatEventState;
  runId?: string;
  message?: unknown;
  errorMessage?: string;
}

export interface GatewaySettings {
  url: string;
  token: string;
}

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  isStreaming?: boolean;
  runId?: string;
  debugRaw?: unknown;
  debugSource?: 'event' | 'history';
}

export interface SessionListItem {
  key: string;
  sessionId?: string;
  title?: string;
  updatedAt?: number;
}
