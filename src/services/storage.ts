import AsyncStorage from '@react-native-async-storage/async-storage';
import type {ApiEnv} from '../apis/core/env';

const KEYS = {
  AUTH_TOKEN: '@ringmemory:auth_token',
  USER_ID: '@ringmemory:user_id',
  API_KEY: '@ringmemory:api_key',
  SELECTED_DEVICE: '@ringmemory:selected_device',
  API_ENV: '@ringmemory:api_env',
  PRIVACY_CONSENT: '@ringmemory:privacy_consent_v1',
};

export interface SelectedDevice {
  id: string;
  name: string;
  subDomain: string;
  deviceToken: string;
}

export async function saveToken(token: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.AUTH_TOKEN, token);
}

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.AUTH_TOKEN);
}

export async function saveUserId(userId: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.USER_ID, userId);
}

export async function getUserId(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.USER_ID);
}

export async function saveApiKey(apiKey: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.API_KEY, apiKey);
}

export async function getApiKey(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.API_KEY);
}

export async function saveSelectedDevice(device: SelectedDevice): Promise<void> {
  await AsyncStorage.setItem(KEYS.SELECTED_DEVICE, JSON.stringify(device));
}

export async function getSelectedDevice(): Promise<SelectedDevice | null> {
  const raw = await AsyncStorage.getItem(KEYS.SELECTED_DEVICE);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SelectedDevice>;
    if (!parsed.subDomain || !parsed.deviceToken) {
      return null;
    }
    return {
      id: parsed.id || '',
      name: parsed.name || '',
      subDomain: parsed.subDomain,
      deviceToken: parsed.deviceToken,
    };
  } catch {
    return null;
  }
}

// 后端环境（dev 隐蔽入口切换）。默认 'prod'；**故意不放进 clearSession**——
// env 要跨登出存活（切换环境本身会触发登出）。
export async function saveApiEnv(env: ApiEnv): Promise<void> {
  await AsyncStorage.setItem(KEYS.API_ENV, env);
}

export async function getStoredApiEnv(): Promise<ApiEnv> {
  const val = await AsyncStorage.getItem(KEYS.API_ENV);
  return val === 'test' ? 'test' : 'prod';
}

// 隐私与 AI 处理告知的同意状态。key 带 v1 后缀：披露内容有实质变更时递增，
// 让所有用户重新确认。**故意不放进 clearSession**——同意是设备级的，
// 不该因登出或注销而失效，否则用户每次重新登录都要再同意一遍。
export async function savePrivacyConsent(): Promise<void> {
  await AsyncStorage.setItem(KEYS.PRIVACY_CONSENT, new Date().toISOString());
}

export async function getPrivacyConsent(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEYS.PRIVACY_CONSENT)) !== null;
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(KEYS.AUTH_TOKEN),
    AsyncStorage.removeItem(KEYS.USER_ID),
    AsyncStorage.removeItem(KEYS.API_KEY),
    AsyncStorage.removeItem(KEYS.SELECTED_DEVICE),
  ]);
}
