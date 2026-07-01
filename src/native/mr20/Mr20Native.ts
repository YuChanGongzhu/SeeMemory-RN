/**
 * Mr20Native — 对接原生 TurboModule `RTNMr20Module`（与 RTNRingModule 同处一个
 * LocalPod）。仅暴露通用 BLE 原语；GJJY 协议逻辑在 protocol.ts / Mr20Client.ts。
 *
 * 原生未链接时（例如尚未 pod install / 重新构建）降级为抛错的桩，App 不会崩。
 */
import {NativeEventEmitter, NativeModules} from 'react-native';
import RTNMr20Module from '../../specs/NativeMr20Module';
import type {Spec} from '../../specs/NativeMr20Module';

const nativeModule = RTNMr20Module ?? (NativeModules as any).RTNMr20Module;

export const isMr20NativeAvailable = Boolean(nativeModule);

/**
 * WiFi 快传能力是否可用。注意：BLE 原语在旧二进制里就有，但若未 `pod install` +
 * 重新编译，新加的 wifiJoin/wifiReceiveFile 等方法不在运行的 App 里——此时
 * `Mr20Native.wifiReceiveFile` 为 undefined，直接调用会抛「undefined is not a function」。
 * 用本标志在入口提前拦截，给出「需重新构建」的可操作提示。
 */
export const isMr20WifiAvailable = Boolean(
  nativeModule && typeof (nativeModule as any).wifiReceiveFile === 'function',
);

const unavailable = async (): Promise<never> => {
  throw new Error('记忆粒原生模块未链接：iOS 需 pod install + 重新构建，Android 需重新构建');
};

export const Mr20Native: Spec =
  nativeModule ??
  ({
    addListener: () => {},
    removeListeners: () => {},
    getBleState: async () => 'unknown',
    startScan: unavailable,
    stopScan: async () => {},
    connect: unavailable,
    disconnect: async () => {},
    writeNoResponse: unavailable,
    monitor: unavailable,
    writeBase64File: unavailable,
    deleteRelativePath: async () => {},
    wifiJoin: async () => false,
    wifiLeave: async () => {},
    wifiConnect: unavailable,
    wifiReceiveFile: unavailable,
    wifiAbort: async () => {},
  } as Spec);

// 事件用经典 bridge 实例作为源更可靠（RCTEventEmitter 的 startObserving 计数走它）；
// 回退到 TurboModule 代理。
const emitterSource = (NativeModules as any).RTNMr20Module ?? nativeModule;
export const mr20Emitter = emitterSource
  ? new NativeEventEmitter(emitterSource)
  : ({addListener: () => ({remove: () => {}})} as unknown as NativeEventEmitter);
