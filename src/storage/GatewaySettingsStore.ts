import AsyncStorage from '@react-native-async-storage/async-storage';
import type {GatewaySettings} from '../openclaw/types';

const STORAGE_KEY = '@ringmemory/openclaw-settings';
const SESSION_KEYS_STORAGE_KEY = '@ringmemory/openclaw-session-keys';

const defaultSettings: GatewaySettings = {
  url: 'ws://43.136.45.132:18789',
  token: 'demo-token-123',
};

export const GatewaySettingsStore = {
  async load(): Promise<GatewaySettings> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return defaultSettings;
      }

      const parsed = JSON.parse(raw) as Partial<GatewaySettings>;
      return {
        url: parsed.url?.trim() || defaultSettings.url,
        token: parsed.token?.trim() || defaultSettings.token,
      };
    } catch {
      return defaultSettings;
    }
  },

  async save(settings: GatewaySettings) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  },

  async loadSessionKeys(): Promise<string[]> {
    try {
      const raw = await AsyncStorage.getItem(SESSION_KEYS_STORAGE_KEY);
      if (!raw) {
        return ['main'];
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return ['main'];
      }

      const keys = parsed
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);

      return keys.length > 0 ? Array.from(new Set(['main', ...keys])) : ['main'];
    } catch {
      return ['main'];
    }
  },

  async saveSessionKeys(keys: string[]) {
    const normalized = Array.from(
      new Set(
        keys
          .map(item => item.trim())
          .filter(Boolean),
      ),
    );
    await AsyncStorage.setItem(
      SESSION_KEYS_STORAGE_KEY,
      JSON.stringify(normalized.length > 0 ? normalized : ['main']),
    );
  },
};
