import {useEffect, useState, useCallback} from 'react';
import {PermissionsAndroid, Platform} from 'react-native';
import type {RingDevice} from '../types';
import {RingModule, ringEventEmitter} from '../native/RingModule';

export interface UseRingScannerReturn {
  isScanning: boolean;
  devices: RingDevice[];
  currentDevice: RingDevice | null;
  isConnected: boolean;
  status: string;
  error: string | null;
  requestPermissions: () => Promise<boolean>;
  startScan: () => Promise<void>;
  stopScan: () => Promise<void>;
  connectDevice: (deviceId: string) => Promise<boolean>;
  disconnectDevice: () => Promise<void>;
}

export function useRingScanner(): UseRingScannerReturn {
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<RingDevice[]>([]);
  const [currentDevice, setCurrentDevice] = useState<RingDevice | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<string>('disconnected');
  const [error, setError] = useState<string | null>(null);

  // 权限请求
  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]);

        return Object.values(granted).every(
          result => result === PermissionsAndroid.RESULTS.GRANTED
        );
      } catch (err) {
        console.error('[Scanner] Permission error:', err);
        return false;
      }
    }
    return true;
  }, []);

  // 事件订阅
  useEffect(() => {
    const subscriptions = [
      ringEventEmitter.addListener('onDeviceFound', (payload: {devices?: RingDevice[]}) => {
        const list = payload?.devices ?? [];
        if (!list.length) {
          return;
        }
        const connected = list.find(device => device.isConnected);
        if (connected) {
          setIsConnected(true);
          setCurrentDevice(connected);
          setStatus('connected');
        }
        setDevices(prev => {
          const next = [...prev];
          const findMatchIndex = (device: RingDevice) =>
            next.findIndex(existing =>
              (!!device.id && existing.id === device.id) ||
              (!!device.macAddress && existing.macAddress === device.macAddress) ||
              (!!device.uuidString && existing.uuidString === device.uuidString) ||
              (!!device.name && existing.name === device.name && device.isConnected && existing.isConnected)
            );
          list.forEach(device => {
            if (!device.id && !device.macAddress && !device.uuidString) {
              return;
            }

            const exists = findMatchIndex(device);
            if (exists >= 0) {
              next[exists] = {
                ...next[exists],
                ...device,
                name: device.name || next[exists].name,
              };
            } else {
              next.push(device);
            }
          });
          return next.filter((device, index, arr) =>
            arr.findIndex(candidate =>
              candidate.id === device.id ||
              (!!device.macAddress && candidate.macAddress === device.macAddress) ||
              (!!device.uuidString && candidate.uuidString === device.uuidString)
            ) === index
          );
        });
      }),

      ringEventEmitter.addListener('onDeviceConnected', (device: RingDevice) => {
        console.log('[Scanner] Device connected:', device);
        setIsConnected(true);
        setCurrentDevice(device);
        setDevices(prev =>
          prev.map(item =>
            item.id === device.id
              ? {...item, ...device, isConnected: true}
              : item
          )
        );
        setStatus('connected');
      }),

      ringEventEmitter.addListener('onDeviceDisconnected', () => {
        console.log('[Scanner] Device disconnected');
        setDevices(prev => prev.map(item => ({...item, isConnected: false})));
        setIsConnected(false);
        setCurrentDevice(null);
        setStatus('disconnected');
      }),

      ringEventEmitter.addListener('onBatteryChanged', (level: number) => {
        setCurrentDevice(prev => prev ? {...prev, batteryLevel: level} : null);
      }),

      ringEventEmitter.addListener('onError', (err: string) => {
        console.error('[Scanner] Error:', err);
        setError(err);
      }),
    ];

    return () => {
      subscriptions.forEach(sub => sub.remove());
    };
  }, []);

  const startScan = useCallback(async () => {
    setDevices([]);
    setIsScanning(true);
    setStatus('scanning');
    try {
      await RingModule.startScan();
    } catch (err: any) {
      setError(err.message);
      setIsScanning(false);
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

  const connectDevice = useCallback(async (deviceId: string): Promise<boolean> => {
    setStatus('connecting');
    try {
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

  return {
    isScanning,
    devices,
    currentDevice,
    isConnected,
    status,
    error,
    requestPermissions,
    startScan,
    stopScan,
    connectDevice,
    disconnectDevice,
  };
}
