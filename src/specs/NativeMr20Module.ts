import {TurboModule, TurboModuleRegistry} from 'react-native';

// ============ TurboModule 接口 ============
// 通用 BLE 原语（不含 MR20 协议逻辑；GJJY 编解码全在 JS 的 protocol.ts）。
// 独立 LocalPod，纯 CoreBluetooth，与其它硬件模块无关。

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

  // 返回当前沙盒 Documents 绝对路径。读取端据此 + 相对路径现算，避免持久化
  // 的绝对路径因容器 UUID 变化（重装/恢复）而失效。
  getDocumentsDir(): Promise<string>;

  // ============ WiFi 快传 ============
  // 程序化加入设备热点（iOS NEHotspotConfiguration / Android WifiNetworkSpecifier）。
  // 系统会弹一次确认框。成功 resolve true；被拒/超时 resolve false（上层降级到引导手动连接）。
  wifiJoin(ssid: string, pwd: string, timeoutMs: number): Promise<boolean>;

  // 退出/移除设备热点配置（iOS removeConfiguration / Android 释放 requestNetwork 回调）。
  wifiLeave(): Promise<void>;

  // 先建立到 host:port 的 TCP 连接（socket ready 即 resolve；失败/超时 reject）。
  // 必须在下发 BLE `W` 指令**之前**连好——设备一回 W&LEN 就立刻往 socket 推字节，
  // 晚连会丢数据卡 0（见 data/测试报告.md）。连接句柄按 transferId 暂存，供下面收流。
  wifiConnect(host: string, port: number, transferId: string): Promise<void>;

  // 在 wifiConnect 已建好的 socket 上收流，落盘到 Documents 下 relativePath，返回绝对路径。
  // 按 expectedLen 剥尾 5 字节结束标记 (BA 5A 02 8F 04)：落盘大小 = expectedLen。
  // 过程通过 onWifiProgress 事件回传 {transferId, received, total}。
  wifiReceiveFile(
    relativePath: string,
    expectedLen: number,
    transferId: string,
  ): Promise<string>;

  // 中断指定 transferId 的 WiFi 连接/接收（关 socket）。不存在视为成功。
  wifiAbort(transferId: string): Promise<void>;
}

export default TurboModuleRegistry.get<Spec>('RTNMr20Module');
