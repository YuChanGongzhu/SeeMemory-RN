import {deviceLang, type ConsentLang} from './locale';

/**
 * 授权相关界面（开屏基础隐私页 / per-action AI 授权弹窗 / 隐私与 AI 页）的中英文案。
 * 本次仅本地化授权相关界面，App 其余界面保持中文。
 * 服务商清单文案在 config/legal.ts 的 AI_VENDORS 里维护。
 */

type Dict = Record<string, string>;

const zh: Dict = {
  // 通用
  processing: '处理中…',
  cancel: '取消',
  errorSaveFailed: '授权状态保存失败，请重试。',

  // per-action AI 授权弹窗（AIConsentDisclosure）
  'ai.title': '第三方 AI 数据处理授权',
  'ai.lead': '使用 AI 功能前，请确认你同意将相关内容发送给下列服务商处理。',
  'ai.actionSend': '本次操作将发送',
  'ai.actionFor': '用于',
  'ai.dataTitle': '可能发送的数据',
  'ai.dataBody':
    '你主动录制或上传的音频、转写文本、笔记、记忆内容、图片与文档。我们只会在你主动使用相关功能时发送必要内容。',
  'ai.vendorTitle': '接收方与用途',
  'ai.noTraining':
    '这些服务商仅按我们的指令处理数据，不会将其用于自身模型训练。我们不会出售你的个人信息，也不会用于广告或跨应用追踪。',
  'ai.readPolicy': '阅读完整《隐私政策》',
  'ai.confirmCheckbox': '我已阅读并同意将上述数据发送给第三方 AI 服务商处理。',
  'ai.agreePerAction': '同意并继续本次操作',

  // 开屏基础隐私页（ConsentScreen）
  'base.title': '隐私保护说明',
  'base.lead': '欢迎使用 SiMemory。开始前，请阅读并同意我们处理基础账号与设备数据的方式。',
  'base.dataTitle': '基础服务需要的数据',
  'base.dataBody':
    '登录时使用的手机号、账号标识、设备与连接信息，以及保障服务稳定和安全所需的基础日志。蓝牙和本地网络仅用于连接记忆设备及传输本地录音。',
  'base.aiTitle': 'AI 数据处理单独授权',
  'base.aiBody':
    'AI 相关功能会在你首次使用时单独弹窗征求同意，此处无需操作。届时弹窗会说明本次发送的数据、接收方与用途。',
  'base.readPolicy': '阅读完整《隐私政策》',
  'base.agree': '同意隐私政策并继续',
  'base.disagree': '不同意',
  'base.disagreeMsg': '不同意《隐私政策》将无法进入 SiMemory。',
  'base.saveFailed': '保存失败，请重试。',

  // 隐私与 AI 页（PrivacyAIPage）
  'priv.back': '返回',
  'priv.pageTitle': '隐私与 AI',
  'priv.statusTitle': '第三方 AI 数据处理',
  'priv.granted': '已授权',
  'priv.notGranted': '未授权',
  'priv.intro':
    '未授权时，你仍可进入 App、连接记忆设备、在本地录音和播放已有内容。上传、转写、AI 对话、总结与智能整理会在发送数据前再次请求授权。',
  'priv.dataTitle': '可能发送的数据',
  'priv.dataBody':
    '你主动录制或上传的音频、转写文本、笔记、记忆内容、图片与文档。每次仅发送完成所选功能所必需的内容。',
  'priv.vendorTitle': '接收方与用途',
  'priv.vendorNote':
    '服务商仅按我们的指令处理数据，不会将其用于自身模型训练。我们不会出售你的个人信息，也不会用于广告或跨应用追踪。',
  'priv.fullPolicy': '完整隐私政策',
  'priv.grantButton': '同意使用第三方 AI',
  'priv.withdrawButton': '撤回第三方 AI 授权',
  'priv.withdrawTitle': '撤回第三方 AI 授权',
  'priv.withdrawBody':
    '撤回后，录音上传、语音转写、AI 对话、AI 总结和记忆整理将停止，直到你再次授权。',
  'priv.withdrawConfirm': '确认撤回',
  'priv.footnote':
    '撤回授权不会自动删除此前已处理或存储的数据。你可以删除单条记忆，或通过注销账号申请删除账号数据。',
};

const en: Dict = {
  processing: 'Processing…',
  cancel: 'Cancel',
  errorSaveFailed: 'Failed to save your choice. Please try again.',

  'ai.title': 'Third-Party AI Data Processing Consent',
  'ai.lead':
    'Before using AI features, please confirm that you agree to send the relevant content to the providers below for processing.',
  'ai.actionSend': 'This action will send',
  'ai.actionFor': 'Purpose',
  'ai.dataTitle': 'Data that may be sent',
  'ai.dataBody':
    'Audio you record or upload, transcripts, notes, memory content, images, and documents. We only send the content necessary when you actively use a feature.',
  'ai.vendorTitle': 'Recipients and purposes',
  'ai.noTraining':
    'These providers process data only under our instructions and do not use it to train their own models. We do not sell your personal information, nor use it for advertising or cross-app tracking.',
  'ai.readPolicy': 'Read the full Privacy Policy',
  'ai.confirmCheckbox':
    'I have read and agree to send the above data to third-party AI providers for processing.',
  'ai.agreePerAction': 'Agree and continue',

  'base.title': 'Privacy Notice',
  'base.lead':
    'Welcome to SiMemory. Before you start, please read and agree to how we handle your basic account and device data.',
  'base.dataTitle': 'Data required for basic service',
  'base.dataBody':
    'The phone number used to sign in, your account identifier, device and connection information, and the basic logs needed to keep the service stable and secure. Bluetooth and the local network are used only to connect your memory device and transfer local recordings.',
  'base.aiTitle': 'Separate consent for AI processing',
  'base.aiBody':
    'AI features will ask for your consent separately the first time you use them — no action is needed here. That prompt will state what data is sent, to whom, and for what purpose.',
  'base.readPolicy': 'Read the full Privacy Policy',
  'base.agree': 'Agree and continue',
  'base.disagree': 'Disagree',
  'base.disagreeMsg': 'You cannot enter SiMemory without agreeing to the Privacy Policy.',
  'base.saveFailed': 'Failed to save. Please try again.',

  'priv.back': 'Back',
  'priv.pageTitle': 'Privacy and AI',
  'priv.statusTitle': 'Third-party AI data processing',
  'priv.granted': 'Authorized',
  'priv.notGranted': 'Not authorized',
  'priv.intro':
    'While not authorized, you can still enter the app, connect your memory device, record locally, and play existing content. Upload, transcription, AI chat, summarization, and smart organization will request consent again before any data is sent.',
  'priv.dataTitle': 'Data that may be sent',
  'priv.dataBody':
    'Audio you record or upload, transcripts, notes, memory content, images, and documents. Each time, only the content necessary for the chosen feature is sent.',
  'priv.vendorTitle': 'Recipients and purposes',
  'priv.vendorNote':
    'Providers process data only under our instructions and do not use it to train their own models. We do not sell your personal information, nor use it for advertising or cross-app tracking.',
  'priv.fullPolicy': 'Full Privacy Policy',
  'priv.grantButton': 'Agree to use third-party AI',
  'priv.withdrawButton': 'Withdraw third-party AI consent',
  'priv.withdrawTitle': 'Withdraw third-party AI consent',
  'priv.withdrawBody':
    'After withdrawing, audio upload, transcription, AI chat, AI summarization, and memory organization will stop until you authorize again.',
  'priv.withdrawConfirm': 'Withdraw',
  'priv.footnote':
    'Withdrawing consent does not automatically delete data already processed or stored. You can delete individual memories, or request deletion of account data by deleting your account.',
};

const dict: Record<ConsentLang, Dict> = {zh, en};
const LANG: ConsentLang = deviceLang();

export function t(key: keyof typeof zh): string {
  return dict[LANG][key] ?? zh[key] ?? String(key);
}
