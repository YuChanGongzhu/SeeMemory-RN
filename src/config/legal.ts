/**
 * 法务页面地址与第三方 AI 处理披露清单。
 *
 * App Store 审核指南 5.1.1(i) / 5.1.2(i) 要求：向第三方 AI 服务发送个人数据前，
 * 必须在 App 内说明「发送什么」「发给谁」并取得用户同意——仅写在隐私政策网页里不算数。
 * 因此下面这份清单要与隐私政策第四节保持一致；新增/更换服务商时两处都要改，
 * 并递增 storage.ts 里 PRIVACY_CONSENT 的版本号让用户重新确认。
 */

// v1.0 只提供隐私政策：网页端 pages/legal/ 下没有服务条款页，App Store 对
// 未自备 EULA 的应用默认套用标准 EULA。补了真正的用户协议页后再加回入口。
export const PRIVACY_POLICY_URL = 'https://ms.seemem.com/privacy';

export interface AiVendorDisclosure {
  vendor: string;
  data: string;
  purpose: string;
}

export const AI_VENDORS: AiVendorDisclosure[] = [
  {vendor: 'Amphion', data: '录音音频', purpose: '语音转文字'},
  {vendor: '腾讯云', data: '录音音频、图片', purpose: '语音识别与文件存储'},
  {vendor: '深度求索 DeepSeek', data: '转写文本、记忆内容', purpose: 'AI 总结与对话'},
  {vendor: '阿里云百炼（通义千问）', data: '转写文本、记忆内容、图片', purpose: 'AI 总结与语义检索'},
  {vendor: '月之暗面 Moonshot（Kimi）', data: '转写文本、图片、文档', purpose: 'AI 总结与内容理解'},
  {vendor: 'Amazon Web Services', data: '转写文本、记忆内容', purpose: 'AI 总结（节点位于日本东京）'},
];
