import type {RingDevice, AudioSegment, DeviceStatus} from '../specs/NativeRingModule';

export type {RingDevice, AudioSegment, DeviceStatus};

// 事件类型
export type RingEventType =
  | 'onDeviceFound'
  | 'onDeviceConnected'
  | 'onDeviceDisconnected'
  | 'onAudioSegmentReady'
  | 'onBatteryChanged'
  | 'onError';

export interface RingEvent {
  type: RingEventType;
  payload: any;
}

export interface RingDebugLog {
  timestamp: number;
  message: string;
}
