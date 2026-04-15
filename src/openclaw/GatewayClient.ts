import type {
  GatewayEventFrame,
  GatewayReqFrame,
  GatewayResFrame,
  GatewayStatus,
  HelloOkPayload,
} from './types';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type EventListener = (event: GatewayEventFrame) => void;
type StatusListener = (status: GatewayStatus) => void;

function createRequestId() {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private eventListeners = new Set<EventListener>();
  private statusListeners = new Set<StatusListener>();
  private currentUrl: string | null = null;

  onEvent(listener: EventListener) {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  onStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  async connect(url: string, token: string) {
    this.disconnect({emitStatus: false});
    this.currentUrl = url;
    this.emitStatus({state: 'connecting', detail: `正在连接 ${url}`});

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;

      const fail = (error: Error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      ws.onopen = () => {
        this.emitStatus({state: 'connecting', detail: '等待握手挑战'});
      };

      ws.onmessage = event => {
        try {
          const raw = JSON.parse(String(event.data)) as
            | GatewayEventFrame
            | GatewayResFrame<HelloOkPayload>;

          if (raw.type === 'event' && raw.event === 'connect.challenge') {
            void this.sendReq<HelloOkPayload>('connect', {
              minProtocol: 1,
              maxProtocol: 3,
              client: {
                // Match the proven HTML demo handshake to satisfy gateway client-id validation.
                id: 'webchat-ui',
                version: '0.1.0',
                platform: 'react-native',
                mode: 'webchat',
              },
              role: 'operator',
              scopes: ['operator.admin', 'operator.read', 'operator.write'],
              auth: {
                token,
              },
            })
              .then(payload => {
                if (settled) {
                  return;
                }
                settled = true;
                const version = payload?.server?.version ?? '?';
                this.emitStatus({
                  state: 'connected',
                  detail: `已连接 · 服务版本 ${version}`,
                });
                resolve();
              })
              .catch(error => {
                this.emitStatus({
                  state: 'error',
                  detail: error.message || '连接失败',
                });
                fail(error);
              });
            return;
          }

          this.routeFrame(raw);
        } catch (error) {
          const parsedError =
            error instanceof Error ? error : new Error('收到无法解析的服务端消息');
          this.emitStatus({state: 'error', detail: parsedError.message});
          fail(parsedError);
        }
      };

      ws.onerror = () => {
        const error = new Error('WebSocket 连接错误');
        this.emitStatus({state: 'error', detail: error.message});
        fail(error);
      };

      ws.onclose = event => {
        this.rejectAllPending(new Error('连接已关闭'));
        this.ws = null;
        const detail = `连接断开 (${event.code}${event.reason ? ` · ${event.reason}` : ''})`;
        this.emitStatus({state: 'disconnected', detail});
        if (!settled) {
          settled = true;
          reject(new Error(detail));
        }
      };
    });
  }

  disconnect(options?: {emitStatus?: boolean}) {
    this.rejectAllPending(new Error('连接已断开'));
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.close();
    }
    if (options?.emitStatus !== false) {
      this.emitStatus({state: 'idle', detail: this.currentUrl ? '已手动断开' : '未连接'});
    }
  }

  async sendReq<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 尚未连接');
    }

    const id = createRequestId();
    const frame: GatewayReqFrame = {
      type: 'req',
      id,
      method,
      params,
    };

    return await new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject,
      });
      this.ws?.send(JSON.stringify(frame));
    });
  }

  private routeFrame(frame: GatewayEventFrame | GatewayResFrame) {
    if (frame.type === 'res') {
      const pending = this.pending.get(frame.id);
      if (!pending) {
        return;
      }
      this.pending.delete(frame.id);
      if (frame.ok) {
        pending.resolve(frame.payload);
      } else {
        pending.reject(new Error(frame.error?.message || '请求失败'));
      }
      return;
    }

    if (frame.type === 'event') {
      this.eventListeners.forEach(listener => listener(frame));
    }
  }

  private emitStatus(status: GatewayStatus) {
    this.statusListeners.forEach(listener => listener(status));
  }

  private rejectAllPending(error: Error) {
    this.pending.forEach(request => request.reject(error));
    this.pending.clear();
  }
}
