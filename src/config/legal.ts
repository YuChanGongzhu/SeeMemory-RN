/**
 * 法务页面地址与第三方 AI 处理披露清单。
 *
 * App Store 审核指南 5.1.1(i) / 5.1.2(i) 要求：向第三方 AI 服务发送个人数据前，
 * 必须在 App 内说明「发送什么」「发给谁」并取得用户同意——仅写在隐私政策网页里不算数。
 * 因此下面这份清单要与隐私政策第四节保持一致；新增/更换服务商时两处都要改，
 * 并递增 privacy/consentPolicy.ts 里的版本号让用户重新确认。
 *
 * 清单为中英双语：美区审核设备默认英文，审核会将 App 内清单与英文隐私政策并排比对，
 * 因此服务商名、接收数据、用途三列都提供 en/zh 两种文案。
 */

import {deviceLang} from '../i18n/locale';

// v1.0 只提供隐私政策：网页端 pages/legal/ 下没有服务条款页，App Store 对
// 未自备 EULA 的应用默认套用标准 EULA。补了真正的用户协议页后再加回入口。
export const PRIVACY_POLICY_URL = 'https://ms.seemem.com/privacy';

interface LocalizedText {
  zh: string;
  en: string;
}

export interface AiVendorDisclosure {
  vendor: LocalizedText;
  data: LocalizedText;
  purpose: LocalizedText;
}

export interface LocalizedVendor {
  vendor: string;
  data: string;
  purpose: string;
}

export const AI_VENDORS: AiVendorDisclosure[] = [
  {
    vendor: {zh: 'Amphion', en: 'Amphion'},
    data: {zh: '录音音频', en: 'Audio recordings'},
    purpose: {zh: '语音转文字', en: 'Speech-to-text'},
  },
  {
    vendor: {zh: '腾讯云', en: 'Tencent Cloud'},
    data: {zh: '录音音频、图片', en: 'Audio recordings, images'},
    purpose: {zh: '语音识别与文件存储', en: 'Speech recognition & file storage'},
  },
  {
    vendor: {zh: '深度求索 DeepSeek', en: 'DeepSeek'},
    data: {zh: '转写文本、记忆内容', en: 'Transcripts, memory content'},
    purpose: {zh: 'AI 总结与对话', en: 'AI summarization & chat'},
  },
  {
    vendor: {zh: '阿里云百炼（通义千问）', en: 'Alibaba Cloud Bailian (Qwen)'},
    data: {zh: '转写文本、记忆内容、图片', en: 'Transcripts, memory content, images'},
    purpose: {zh: 'AI 总结与语义检索', en: 'AI summarization & semantic search'},
  },
  {
    vendor: {zh: '月之暗面 Moonshot（Kimi）', en: 'Moonshot (Kimi)'},
    data: {zh: '转写文本、图片、文档', en: 'Transcripts, images, documents'},
    purpose: {zh: 'AI 总结与内容理解', en: 'AI summarization & content understanding'},
  },
  {
    vendor: {zh: 'Amazon Web Services', en: 'Amazon Web Services (Bedrock)'},
    data: {zh: '转写文本、记忆内容', en: 'Transcripts, memory content'},
    purpose: {
      zh: 'AI 总结（节点位于日本东京）',
      en: 'AI summarization (node in Tokyo, Japan)',
    },
  },
];

/** 按设备语言取本地化后的服务商清单，供授权页 / 隐私与 AI 页渲染。 */
export function localizedVendors(): LocalizedVendor[] {
  const lang = deviceLang();
  return AI_VENDORS.map(v => ({
    vendor: v.vendor[lang],
    data: v.data[lang],
    purpose: v.purpose[lang],
  }));
}
