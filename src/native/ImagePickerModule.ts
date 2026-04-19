import {NativeModules} from 'react-native';

export interface PickedImageAsset {
  didCancel?: boolean;
  filePath?: string;
  uri?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  width?: number;
  height?: number;
}

type NativeImagePickerModule = {
  pickImage: () => Promise<PickedImageAsset | null>;
};

const LINKING_ERROR =
  'ImagePickerModule is unavailable. Please rebuild the native app after adding the module.';

const {ImagePickerModule} = NativeModules as {
  ImagePickerModule?: NativeImagePickerModule;
};

export async function pickImageFromLibrary(): Promise<PickedImageAsset | null> {
  if (!ImagePickerModule?.pickImage) {
    throw new Error(LINKING_ERROR);
  }

  return await ImagePickerModule.pickImage();
}
