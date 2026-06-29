import {TurboModule, TurboModuleRegistry} from 'react-native';

// ============ TurboModule 接口 ============
// 通用 BLE 原语（不含 MR20 协议逻辑；GJJY 编解码全在 JS 的 protocol.ts）。
// 原生模块与 RTNRingModule 同处一个 LocalPod，避免新增第三方 pod。

export interface Spec extends TurboModule {
  addListener(eventName: string): void;
  removeListeners(count: number): void;

  // 蓝牙开关状态：'poweredOn' | 'poweredOff' | 'unauthorized' | 'unsupported' | 'resetting' | 'unknown'
  getBleState(): Promise<string>;

  // 扫描（原生按 MR20 主服务 UUID 过滤）
  startScan(): Promise<void>;
  stopScan(): Promise<void>;

  // 连接：成功后原生自动发现全部 service/characteristic
  connect(deviceId: string): Promise<boolean>;
  disconnect(): Promise<void>;

  // 写命令（无应答优先，底层按特征能力回退 with-response）
  writeNoResponse(
    serviceUUID: string,
    characteristicUUID: string,
    base64Value: string,
  ): Promise<void>;

  // 订阅 notify；值通过 onCharValue 事件回传（base64）
  monitor(serviceUUID: string, characteristicUUID: string): Promise<void>;

  // 把 base64 数据写到 Documents 下的相对路径，返回绝对路径（替代 blob-util）
  writeBase64File(relativePath: string, base64Value: string): Promise<string>;

  // 删除 Documents 下某相对路径（文件或目录），不存在视为成功
  deleteRelativePath(relativePath: string): Promise<void>;
}

export default TurboModuleRegistry.get<Spec>('RTNMr20Module');
