import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  AUTH_TOKEN: '@ringmemory:auth_token',
  USER_ID: '@ringmemory:user_id',
  API_KEY: '@ringmemory:api_key',
};

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
