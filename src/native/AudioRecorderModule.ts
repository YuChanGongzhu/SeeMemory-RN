import {NativeModules} from 'react-native';

export interface RecordingResult {
  filePath: string;
  durationMs: number;
}

type NativeAudioRecorderModule = {
  /** 返回是否已授予麦克风权限（iOS 会弹系统授权；Android 只查询，申请交给 PermissionsAndroid）。 */
  requestPermission: () => Promise<boolean>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<RecordingResult>;
  cancelRecording: () => Promise<void>;
};

const LINKING_ERROR =
  'RTNAudioRecorderModule is unavailable. Please rebuild the native app after adding the module.';

const {RTNAudioRecorderModule: nativeModule} = NativeModules as {
  RTNAudioRecorderModule?: NativeAudioRecorderModule;
};

export const isAudioRecorderAvailable = Boolean(nativeModule);

export const AudioRecorderModule: NativeAudioRecorderModule = nativeModule ?? {
  requestPermission: async () => false,
  startRecording: async () => {
    throw new Error(LINKING_ERROR);
  },
  stopRecording: async () => {
    throw new Error(LINKING_ERROR);
  },
  cancelRecording: async () => {},
};
