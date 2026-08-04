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

  // 带应答写：promise 直到设备 ATT 层确认收下才兑现。OTA 固件帧专用——无应答写
  // 只保证数据交给了对方控制器，设备主机在擦 flash 来不及取时会静默丢包，本机
  // 完全看不见，表现为「3536 帧一路畅通、收完回 OT&ERR」。特征不支持时 reject
  // WRITE_NO_ACK_SUPPORT，上层据此降级回 writeNoResponse。
  writeWithResponse(
    serviceUUID: string,
    characteristicUUID: string,
    base64Value: string,
  ): Promise<void>;

  // 某特征的能力 + 当前 MTU 下两种写方式各自的单帧上限。OTA 前用来选写入方式。
  characteristicInfo(
    serviceUUID: string,
    characteristicUUID: string,
  ): Promise<{
    write: boolean;
    writeWithoutResponse: boolean;
    notify: boolean;
    properties: string;
    maxWithResponse: number;
    maxWithoutResponse: number;
  }>;

  // 当前连接单帧可写的最大字节数（受 ATT MTU 限制）。OTA 前用来校准帧长：
  // 超过它的写会被 CoreBluetooth 静默截断，设备收不满声明的 LEN 会判 OTA 失败。
  maxWriteLength(): Promise<{withoutResponse: number; withResponse: number}>;

  // 订阅 notify；值通过 onCharValue 事件回传（base64）
  monitor(serviceUUID: string, characteristicUUID: string): Promise<void>;

  // 把 base64 数据写到 Documents 下的相对路径，返回绝对路径（替代 blob-util）
  writeBase64File(relativePath: string, base64Value: string): Promise<string>;

  // 删除 Documents 下某相对路径（文件或目录），不存在视为成功
  deleteRelativePath(relativePath: string): Promise<void>;

  // 把 Documents 下的相对目录/文件整体搬到另一相对位置（自动建目标父目录）。
  // 源不存在视为成功（无历史数据可搬）；用于把旧 `mr20` 目录迁进 `mr20/u_<userId>`。
  moveRelativePath(fromRelativePath: string, toRelativePath: string): Promise<void>;

  // 返回当前沙盒 Documents 绝对路径。读取端据此 + 相对路径现算，避免持久化
  // 的绝对路径因容器 UUID 变化（重装/恢复）而失效。
  getDocumentsDir(): Promise<string>;

  // ============ WiFi 快传 ============
  // 程序化加入设备热点（iOS NEHotspotConfiguration / Android WifiNetworkSpecifier）。
  // 系统会弹一次确认框。成功 resolve true；被拒/超时 resolve false（上层降级到引导手动连接）。
  wifiJoin(ssid: string, pwd: string, timeoutMs: number): Promise<boolean>;

  // 退出/移除设备热点配置（iOS removeConfiguration / Android 释放 requestNetwork 回调）。
  wifiLeave(): Promise<void>;

  /**
   * 系统侧的入网现状：iOS 当前替本 App 保留了哪些热点配置、现在关联的是哪个网络。
   * 排查「系统设置里能连、App 里连不上」时用——直接看出 apply 有没有落地。
   * 旧二进制里没有这个方法，调用前要判存在（见 Mr20Native 的降级实现）。
   */
  wifiDiagnostics(): Promise<{
    configuredSSIDs: string[];
    currentSSID?: string | null;
    joinedSSID?: string | null;
  }>;

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

  // ============ OTA 定时发帧 ============
  // 把整个固件交给原生，由 GCD 定时器按 periodMs 严格打点切片发送，**不等任何一帧写完**。
  // JS 逐帧 await 的真实周期是「写入 + setTimeout + 超调」≈25~35ms，固件方判定发得太慢；
  // 下沉到原生后节奏与 JS 线程忙不忙无关（±1ms）。进度通过 onOtaProgress 事件回传。
  // resolve 的 notReady = 发某帧时 iOS 发送队列已满的次数（照发不误，仅作诊断）。
  otaSendFrames(
    serviceUUID: string,
    characteristicUUID: string,
    base64Bin: string,
    frameSize: number,
    periodMs: number,
  ): Promise<{
    frames: number;
    sent: number;
    total: number;
    elapsedMs: number;
    avgPeriodMs: number;
    maxPeriodMs: number;
    notReady: number;
  }>;

  // 中止正在跑的定时发帧（设备中途乱回话 / 断连 / 用户退出）。没在跑即 no-op。
  otaAbort(): Promise<void>;
}

export default TurboModuleRegistry.get<Spec>('RTNMr20Module');
