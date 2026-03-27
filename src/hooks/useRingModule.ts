import {useEffect, useState, useCallback} from 'react';
import type {RingDevice, DeviceStatus} from '../types';
import {RingModule, ringEventEmitter} from '../native/RingModule';

export function useRingModule() {
  const [isScanning, setIsScanning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [devices, setDevices] = useState<RingDevice[]>([]);
  const [currentDevice, setCurrentDevice] = useState<RingDevice | null>(null);
  const [status, setStatus] = useState<DeviceStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  // 事件订阅
  useEffect(() => {
    const subscriptions = [
      ringEventEmitter.addListener('onDeviceFound', (payload: {devices?: RingDevice[]}) => {
        const list = payload?.devices ?? [];
        if (!list.length) {
          return;
        }
        setDevices(prev => {
          const next = [...prev];
          list.forEach(device => {
            const exists = next.findIndex(d => d.id === device.id);
            if (exists >= 0) {
              next[exists] = device;
            } else {
              next.push(device);
            }
          });
          return next;
        });
      }),

      ringEventEmitter.addListener('onDeviceConnected', (device: RingDevice) => {
        setIsConnected(true);
        setCurrentDevice(device);
        setStatus('connected');
      }),

      ringEventEmitter.addListener('onDeviceDisconnected', () => {
        setIsConnected(false);
        setCurrentDevice(null);
        setStatus('disconnected');
      }),

      ringEventEmitter.addListener('onBatteryChanged', (level: number) => {
        setCurrentDevice(prev => prev ? {...prev, batteryLevel: level} : null);
      }),

      ringEventEmitter.addListener('onError', (err: string) => {
        setError(err);
      }),
    ];

    return () => {
      subscriptions.forEach(sub => sub.remove());
    };
  }, []);

  // 扫描设备
  const startScan = useCallback(async () => {
    try {
      setIsScanning(true);
      setStatus('scanning');
      await RingModule.startScan();
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const stopScan = useCallback(async () => {
    try {
      await RingModule.stopScan();
      setIsScanning(false);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  // 连接设备
  const connectDevice = useCallback(async (deviceId: string) => {
    try {
      setStatus('connecting');
      const success = await RingModule.connectDevice(deviceId);
      return success;
    } catch (err: any) {
      setError(err.message);
      return false;
    }
  }, []);

  const disconnectDevice = useCallback(async () => {
    try {
      await RingModule.disconnectDevice();
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  // 录音控制
  const startCapture = useCallback(async () => {
    try {
      await RingModule.startCapture();
      setIsCapturing(true);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const stopCapture = useCallback(async () => {
    try {
      await RingModule.stopCapture();
      setIsCapturing(false);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  return {
    // 状态
    isScanning,
    isConnected,
    isCapturing,
    devices,
    currentDevice,
    status,
    error,
    // 方法
    startScan,
    stopScan,
    connectDevice,
    disconnectDevice,
    startCapture,
    stopCapture,
  };
}
