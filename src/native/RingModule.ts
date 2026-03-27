import {NativeEventEmitter, NativeModules} from 'react-native';
import RTNRingModule from '../specs/NativeRingModule';
import type {Spec} from '../specs/NativeRingModule';

const fallbackModule = NativeModules.RTNRingModule;
const ringModule = RTNRingModule ?? fallbackModule;
const unavailableError = new Error('RTNRingModule is temporarily unavailable');

const noopEmitter = {
  addListener: () => ({
    remove: () => {},
  }),
};

const unavailableModule: Spec = {
  addListener: () => {},
  removeListeners: () => {},
  startScan: async () => {
    throw unavailableError;
  },
  stopScan: async () => {
    throw unavailableError;
  },
  connectDevice: async () => {
    throw unavailableError;
  },
  disconnectDevice: async () => {
    throw unavailableError;
  },
  getDeviceStatus: async () => 'disconnected',
  startCapture: async () => {
    throw unavailableError;
  },
  stopCapture: async () => {
    throw unavailableError;
  },
  isCapturing: async () => false,
  getSavedAudioSegments: async () => [],
  playAudioFile: async () => {
    throw unavailableError;
  },
  stopAudioPlayback: async () => {
    throw unavailableError;
  },
  checkForFirmwareUpdate: async () => null,
  updateFirmware: async () => {
    throw unavailableError;
  },
};

export const isRingModuleAvailable = Boolean(ringModule);
export const RingModule: Spec = (ringModule ?? unavailableModule) as Spec;
export const ringEventEmitter = ringModule
  ? new NativeEventEmitter(ringModule)
  : noopEmitter;
