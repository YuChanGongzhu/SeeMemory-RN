import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@ringmemory/chat-composer-draft';

export interface ChatComposerDraft {
  text?: string;
  mediaUrl?: string;
  mediaKind?: 'audio';
  source: 'device-audio';
  createdAt: number;
}

type DraftListener = (draft: ChatComposerDraft | null) => void;

const listeners = new Set<DraftListener>();

function emit(draft: ChatComposerDraft | null) {
  listeners.forEach(listener => listener(draft));
}

export const ChatComposerDraftStore = {
  async load(): Promise<ChatComposerDraft | null> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Partial<ChatComposerDraft>;
      const text = parsed.text?.trim();
      const mediaUrl = parsed.mediaUrl?.trim();
      if (!text && !mediaUrl) {
        return null;
      }

      return {
        text,
        mediaUrl,
        mediaKind: parsed.mediaKind === 'audio' ? 'audio' : undefined,
        source: 'device-audio',
        createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
      };
    } catch {
      return null;
    }
  },

  async save(draft: ChatComposerDraft) {
    const normalized = {
      ...draft,
      text: draft.text?.trim() || undefined,
      mediaUrl: draft.mediaUrl?.trim() || undefined,
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    emit(normalized);
  },

  async clear() {
    await AsyncStorage.removeItem(STORAGE_KEY);
    emit(null);
  },

  subscribe(listener: DraftListener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
