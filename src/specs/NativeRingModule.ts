import {TurboModule, TurboModuleRegistry} from 'react-native';

// ============ 类型定义 ============

export interface RingDevice {
  id: string;
  name: string;
  rssi: number;
  isConnected: boolean;
  batteryLevel: number;
  macAddress?: string;
  uuidString?: string;
}

export interface AudioSegment {
  filePath: string;
  duration: number;
  timestamp: number;
  size: number;
  isDenoised?: boolean;
  sourceFilePath?: string;
}

export interface AudioPlaybackInfo {
  duration: number;
  size?: number;
  started?: boolean;
}

export type CaptureMode = 'adpcm' | 'pcm';

export interface BCLBindRingResponse {
  success: boolean;
  message: string;
}

export interface BCLConnectRingResponse {
  success: boolean;
  firmwareVersion: string;
  hardwareVersion: string;
  batteryLevel: number;
  stepCount: number;
}

export type DeviceStatus = 'disconnected' | 'scanning' | 'connecting' | 'connected';

// ============ TurboModule 接口 ============

export interface Spec extends TurboModule {
  addListener(eventName: string): void;
  removeListeners(count: number): void;

  // ===== 设备扫描 =====
  startScan(): Promise<void>;
  stopScan(): Promise<void>;

  // ===== 设备连接 =====
  connectDevice(deviceId: string): Promise<boolean>;
  disconnectDevice(): Promise<void>;

  // ===== 设备状态 =====
  getDeviceStatus(): Promise<DeviceStatus>;

  // ===== 录音控制 =====
  startCapture(): Promise<void>;
  startCapturePCM(): Promise<void>;
  stopCapture(): Promise<void>;
  isCapturing(): Promise<boolean>;
  getSavedAudioSegments(): Promise<AudioSegment[]>;
  denoiseAudioFile(filePath: string): Promise<AudioSegment>;
  playAudioFile(filePath: string): Promise<AudioPlaybackInfo>;
  stopAudioPlayback(): Promise<void>;

  // ===== 固件升级 (可选) =====
  checkForFirmwareUpdate(): Promise<string | null>;
  updateFirmware(filePath: string): Promise<boolean>;
}

export default TurboModuleRegistry.get<Spec>('RTNRingModule');
