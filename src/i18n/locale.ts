import {NativeModules, Platform} from 'react-native';

/**
 * 设备语言检测（无 react-native-localize 依赖）。
 * 仅区分中文 / 非中文——非中文一律回退英文，供授权相关界面本地化使用。
 * App Store 审核指南 5.1.1(i)/5.1.2(i)：美区审核设备默认英文，授权页必须可读。
 */
export type ConsentLang = 'en' | 'zh';

function readRawLocale(): string {
  if (Platform.OS === 'ios') {
    const settings = NativeModules.SettingsManager?.settings;
    const languages = settings?.AppleLanguages;
    return String(settings?.AppleLocale ?? languages?.[0] ?? '');
  }
  return String(NativeModules.I18nManager?.localeIdentifier ?? '');
}

export function deviceLang(): ConsentLang {
  return readRawLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
