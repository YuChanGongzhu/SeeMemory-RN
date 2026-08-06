import {NativeModules} from 'react-native';

type NativeSaveImageModule = {
  saveBase64ToCameraRoll: (base64Png: string) => Promise<{success: boolean}>;
};

const LINKING_ERROR =
  'SaveImageModule is unavailable. Please rebuild the native app after adding the module.';

const {SaveImageModule} = NativeModules as {
  SaveImageModule?: NativeSaveImageModule;
};

export async function saveBase64ImageToCameraRoll(base64Png: string): Promise<void> {
  if (!SaveImageModule?.saveBase64ToCameraRoll) {
    throw new Error(LINKING_ERROR);
  }

  await SaveImageModule.saveBase64ToCameraRoll(base64Png);
}
