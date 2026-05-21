import {NativeEventEmitter, NativeModules, Platform} from 'react-native';

export type RokidSceneMode = 'customView' | 'customApp';

export interface RokidAuthResult {
  token: string;
  sessionId?: string | null;
}

export interface RokidAuthState {
  status: 'notAuthenticated' | 'authenticating' | 'authenticated' | 'expired' | 'failed';
  isAuthenticated: boolean;
  token?: string;
  expiresAt?: number | null;
  error?: string;
}

export interface RokidMediaResult {
  filePath: string;
  duration?: number;
  timestamp: number;
  size: number;
}

export interface RokidSavedMediaResult {
  recordings: RokidMediaResult[];
  photos: RokidMediaResult[];
}

interface RokidNativeModule {
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  initializeClient(mode: RokidSceneMode, appDisplayName?: string, pageName?: string): Promise<{
    initialized: boolean;
    outcome: string;
    mode: string;
  }>;
  isRokidAppInstalled(): Promise<boolean>;
  authenticate(scopes?: string[], appName?: string): Promise<RokidAuthResult>;
  getAuthState(): Promise<RokidAuthState>;
  clearAuthentication(): Promise<void>;
  queryCustomApp(): Promise<{installed: boolean; packageName: string}>;
  openCustomApp(activityName?: string, url?: string): Promise<{success: boolean}>;
  stopCustomApp(): Promise<{success: boolean}>;
  openCustomView(viewJson?: string): Promise<{success: boolean; errorCode?: number | null}>;
  closeCustomView(viewJson?: string): Promise<{success: boolean}>;
  startRecord(type?: string): Promise<void>;
  stopRecord(type?: string): Promise<RokidMediaResult>;
  takePhoto(width?: number, height?: number, quality?: number): Promise<RokidMediaResult>;
  playAudioFile(filePath: string): Promise<{filePath: string; duration: number}>;
  stopAudioPlayback(): Promise<void>;
  getAudioWaveform(filePath: string, bars?: number): Promise<number[]>;
  resolveMediaPath(filePath: string): Promise<string>;
  getSavedMedia(): Promise<RokidSavedMediaResult>;
}

const unavailableError = new Error('RTNRokidModule is temporarily unavailable');
const nativeModule = NativeModules.RTNRokidModule as RokidNativeModule | undefined;

const unavailableModule: RokidNativeModule = {
  addListener: () => {},
  removeListeners: () => {},
  initializeClient: async () => {
    throw unavailableError;
  },
  isRokidAppInstalled: async () => false,
  authenticate: async () => {
    throw unavailableError;
  },
  getAuthState: async () => ({status: 'notAuthenticated', isAuthenticated: false}),
  clearAuthentication: async () => {},
  queryCustomApp: async () => {
    throw unavailableError;
  },
  openCustomApp: async () => {
    throw unavailableError;
  },
  stopCustomApp: async () => {
    throw unavailableError;
  },
  openCustomView: async () => {
    throw unavailableError;
  },
  closeCustomView: async () => {
    throw unavailableError;
  },
  startRecord: async () => {
    throw unavailableError;
  },
  stopRecord: async () => {
    throw unavailableError;
  },
  takePhoto: async () => {
    throw unavailableError;
  },
  playAudioFile: async () => {
    throw unavailableError;
  },
  stopAudioPlayback: async () => {},
  getAudioWaveform: async () => [],
  resolveMediaPath: async () => '',
  getSavedMedia: async () => ({recordings: [], photos: []}),
};

export const isRokidModuleAvailable = Boolean(nativeModule);
export const RokidModule = nativeModule ?? unavailableModule;
export const rokidEventEmitter = nativeModule
  ? new NativeEventEmitter(nativeModule as any)
  : {addListener: () => ({remove: () => {}})};

export const ROKID_DEFAULTS = {
  scopes: ['device_control', 'audio_stream'],
  appName: 'SeeMemory',
  customAppDisplayName: 'sSDKSampleforCXR',
  customAppPageName: 'com.rokid.cxrswithcxrl',
  customAppActivityName: 'com.rokid.cxrswithcxrl.activities.main.MainActivity',
  recordType: 'seememory',
};

export function createDefaultRokidCustomView(text = 'SeeMemory Ready') {
  return JSON.stringify({
    type: 'LinearLayout',
    props: {
      layout_width: 'match_parent',
      layout_height: 'match_parent',
      orientation: 'vertical',
      gravity: 'center',
      paddingTop: '140dp',
      paddingBottom: '100dp',
      paddingStart: '24dp',
      paddingEnd: '24dp',
      backgroundColor: '#FF000000',
    },
    children: [
      {
        type: 'TextView',
        props: {
          id: 'title',
          layout_width: 'wrap_content',
          layout_height: 'wrap_content',
          text,
          textColor: '#FF00FF00',
          textSize: '20sp',
          textStyle: 'bold',
        },
      },
      {
        type: 'TextView',
        props: {
          id: 'subtitle',
          layout_width: 'wrap_content',
          layout_height: 'wrap_content',
          text: Platform.OS === 'ios' ? 'iOS CXR-L' : 'Android CXR-L',
          textColor: '#FFFFFFFF',
          textSize: '14sp',
          marginTop: '12dp',
        },
      },
    ],
  });
}
