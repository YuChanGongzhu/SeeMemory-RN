import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  AUTH_TOKEN: '@ringmemory:auth_token',
  USER_ID: '@ringmemory:user_id',
  API_KEY: '@ringmemory:api_key',
  SELECTED_DEVICE: '@ringmemory:selected_device',
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

export async function clearSession(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(KEYS.AUTH_TOKEN),
    AsyncStorage.removeItem(KEYS.USER_ID),
    AsyncStorage.removeItem(KEYS.API_KEY),
    AsyncStorage.removeItem(KEYS.SELECTED_DEVICE),
  ]);
}
