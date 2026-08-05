import {baseRequest} from '../core/request';

// 与 manager-api /app/wechat 对齐（见 AppWechatController）：健康度 + 扫码绑定轮询。
// 待办提醒到点靠微信推送，创建提醒前后端要求先绑定微信（见 imemory-agent
// proactive/agreements.create_agreement 的 is_bound 校验），所以这一路是"代办链路"的前置依赖。
export type WechatQrStatus = 'wait' | 'scaned' | 'confirmed' | 'expired' | 'failed';

export interface WechatStatusResponse {
  healthy: boolean;
}

export interface WechatBindingResponse {
  status: WechatQrStatus;
  /** 二维码内容（原始文本，非图片）：wait 阶段才有值，本地用 QRCode 组件渲染成图。 */
  qrcode: string | null;
  error: string | null;
}

export function getWechatStatus(): Promise<WechatStatusResponse> {
  return baseRequest<WechatStatusResponse>({method: 'GET', path: '/app/wechat/status'});
}

/** nonce 由调用方每次打开/刷新弹窗生成，标识一次扫码会话；换 nonce = 拿新二维码（重绑）。 */
export function getWechatBinding(nonce: string): Promise<WechatBindingResponse> {
  return baseRequest<WechatBindingResponse>({method: 'GET', path: '/app/wechat/binding', query: {nonce}});
}
