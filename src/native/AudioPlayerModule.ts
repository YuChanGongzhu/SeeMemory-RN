import {NativeModules} from 'react-native';

export interface AudioPlaybackInfo {
  duration: number;
  size?: number;
  started?: boolean;
}

type NativeAudioPlayerModule = {
  playAudioFile: (filePath: string) => Promise<AudioPlaybackInfo>;
  stopAudioPlayback: () => Promise<void>;
};

const LINKING_ERROR =
  'RTNAudioPlayerModule is unavailable. Please rebuild the native app after adding the module.';

const {RTNAudioPlayerModule: nativeModule} = NativeModules as {
  RTNAudioPlayerModule?: NativeAudioPlayerModule;
};

export const isAudioPlayerModuleAvailable = Boolean(nativeModule);

export const AudioPlayerModule: NativeAudioPlayerModule = nativeModule ?? {
  playAudioFile: async () => {
    throw new Error(LINKING_ERROR);
  },
  stopAudioPlayback: async () => {},
};
