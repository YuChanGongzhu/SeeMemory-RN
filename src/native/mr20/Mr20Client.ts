/**
 * Mr20Client — 用原生模块 RTNMr20Module 驱动 MR20「记忆粒」的单设备连接。
 *
 * 职责：扫描/连接/订阅/写命令/命令-应答相关/文件传输状态机/实时音频分发/断连。
 * 底层 BLE 由原生 CoreBluetooth/android.bluetooth 实现（见 Mr20Native）；
 * 本文件只做协议层逻辑，GJJY 编解码在 protocol.ts。
 */
import {EmitterSubscription, PermissionsAndroid, Platform} from 'react-native';
import {Mr20Native, mr20Emitter} from './Mr20Native';
import {
  Cmd,
  DeviceMessage,
  MR20_UUID,
  base64ToBytes,
  bytesToAscii,
  bytesToBase64,
  encodeCommand,
  isCommandFrame,
  parseDeviceMessage,
} from './protocol';

export interface Mr20Device {
  id: string;
  name: string;
  rssi: number | null;
}

export interface Mr20File {
  dir: string;
  fname: string;
  seconds: number;
  size: number;
}

export interface Mr20Status {
  battery?: number;
  spaceFreeMb?: number;
  spaceTotalMb?: number;
  firmware?: string;
  wifiVersion?: string;
  mac?: string;
  recMode?: 'call' | 'conversation';
}

export type Mr20ConnState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'pairing'
  | 'connected'
  | 'disconnected';

type EventMap = {
  stateChange: Mr20ConnState;
  deviceFound: Mr20Device;
  connected: Mr20Device;
  disconnected: {reason?: string};
  status: Mr20Status;
  recording: {fname: string; seconds: number};
  recState: {recording: boolean};
  fileProgress: {received: number; total: number};
  audio: Uint8Array;
  error: {code: string; message: string};
  log: string;
};

type Listener<K extends keyof EventMap> = (payload: EventMap[K]) => void;
type Reducer<T> = (msg: DeviceMessage) => {done: boolean; value?: T};

interface FileTransfer {
  expected: number;
  received: number;
  chunks: Uint8Array[];
  resolve: (bytes: Uint8Array) => void;
  reject: (err: Error) => void;
  onProgress?: (received: number, total: number) => void;
}

const DEFAULT_TIMEOUT = 8000;

// MR20「记忆粒」广播名前缀（真机实测名形如 YLF20_f065fc9a）。扫描时只显示匹配的设备，
// 过滤掉附近一堆无关蓝牙设备。如需放开调试可临时返回 true。
const MR20_NAME_PREFIXES = ['YLF', 'MR20'];
function isMr20DeviceName(name: string): boolean {
  const upper = (name || '').trim().toUpperCase();
  return MR20_NAME_PREFIXES.some(p => upper.startsWith(p));
}

/**
 * 蓝牙文件流被实时录音流污染：收到的字节多于设备声明的 LEN。
 * 单独一个类型是为了让上层**不要重试**——只要设备还在录音，重试必然同样污染，
 * 徒增等待；应直接把原因报给用户（停止录音 / 改用 WiFi 快传）。
 */
export class Mr20StreamPollutedError extends Error {
  constructor(readonly received: number, readonly expected: number) {
    super(
      `文件流被干扰（收到 ${received} 字节 > 声明 ${expected}）：设备可能正在录音，` +
        '实时音频流混入了蓝牙文件通道。请停止录音后重试，或改用 WiFi 快传。',
    );
    this.name = 'Mr20StreamPollutedError';
  }
}

export class Mr20Client {
  private nativeSubs: EmitterSubscription[] = [];
  private collectors: Array<(msg: DeviceMessage) => void> = [];
  // 每个 collect() 的取消句柄；断连/销毁时统一结算，避免残留超时定时器在
  // 8 秒后对着空 promise reject 出「未处理拒绝」。
  private pendingCancels: Set<(err: Error) => void> = new Set();
  // BLE 请求-应答事务串行链：设备应答会广播给所有 collector，两个「同类型」事务并发时会串扰
  // （典型：并发的全盘扫描——listDirs/listFiles——彼此的 DONE 提前结算对方，导致目录/文件被截断，
  // 表现为「设备文件只剩当天」）。用 promise 链保证同一时刻只有一个 collect 事务在飞。
  private txChain: Promise<void> = Promise.resolve();
  private fileXfer: FileTransfer | null = null;
  private wifiTransferId: string | null = null;
  private listeners: {[K in keyof EventMap]?: Set<Listener<K>>} = {};
  private connState: Mr20ConnState = 'idle';
  private device: Mr20Device | null = null;
  private wired = false;
  private statusRefreshing = false;

  // -------------------------------------------------------------------------
  // 事件（对 UI 暴露）
  // -------------------------------------------------------------------------

  on<K extends keyof EventMap>(event: K, cb: Listener<K>): () => void {
    let set = this.listeners[event] as Set<Listener<K>> | undefined;
    if (!set) {
      set = new Set<Listener<K>>();
      (this.listeners as Record<string, unknown>)[event as string] = set;
    }
    set.add(cb);
    return () => set?.delete(cb);
  }

  private emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.listeners[event]?.forEach(cb => {
      try {
        cb(payload);
      } catch {
        // 单个监听器异常不影响其它
      }
    });
  }

  private setState(s: Mr20ConnState): void {
    this.connState = s;
    this.emit('stateChange', s);
  }

  get state(): Mr20ConnState {
    return this.connState;
  }

  private log(msg: string): void {
    this.emit('log', msg);
  }

  // -------------------------------------------------------------------------
  // 原生事件接线
  // -------------------------------------------------------------------------

  private wire(): void {
    if (this.wired) {
      return;
    }
    this.wired = true;
    this.nativeSubs.push(
      mr20Emitter.addListener('onDeviceFound', (d: any) => {
        const name = d.name || '记忆粒';
        if (!isMr20DeviceName(name)) {
          return; // 过滤非记忆粒设备
        }
        this.emit('deviceFound', {
          id: String(d.id),
          name,
          rssi: typeof d.rssi === 'number' ? d.rssi : null,
        });
      }),
      mr20Emitter.addListener('onDisconnected', (d: any) =>
        this.handleDisconnect(d?.reason),
      ),
      mr20Emitter.addListener('onCharValue', (d: any) => {
        if (d?.value) {
          this.handleFrame(
            base64ToBytes(String(d.value)),
            String(d?.characteristic || ''),
          );
        }
      }),
      mr20Emitter.addListener('onError', (d: any) =>
        this.emit('error', {
          code: String(d?.code || 'BLE'),
          message: String(d?.message || '蓝牙错误'),
        }),
      ),
    );
  }

  private handleFrame(bytes: Uint8Array, charUuid = ''): void {
    const ascii = bytesToAscii(bytes);
    if (isCommandFrame(ascii)) {
      this.log(`<= ${ascii.replace(/\0+$/g, '')}`);
      this.onDeviceMessage(parseDeviceMessage(ascii));
      return;
    }
    if (this.fileXfer) {
      // 首个数据帧记一条日志，确认文件二进制走的是哪个 notify 特征（排查空文件）。
      if (this.fileXfer.received === 0) {
        this.log(`<= [文件数据] 来自 ${charUuid.slice(0, 8)} (+${bytes.length}B)`);
      }
      this.pushFileBytes(bytes);
      return;
    }
    this.emit('audio', bytes);
  }

  // -------------------------------------------------------------------------
  // 蓝牙开关
  // -------------------------------------------------------------------------

  async ensurePoweredOn(timeoutMs = 6000): Promise<void> {
    const state = await Mr20Native.getBleState();
    if (state === 'poweredOn') {
      return;
    }
    if (state === 'poweredOff') {
      throw new Error('蓝牙未开启');
    }
    if (state === 'unauthorized') {
      throw new Error('未授予蓝牙权限');
    }
    if (state === 'unsupported') {
      throw new Error('设备不支持蓝牙');
    }
    // unknown / resetting：等待 onBleState
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.remove();
        reject(new Error('蓝牙未就绪'));
      }, timeoutMs);
      const sub = mr20Emitter.addListener('onBleState', (d: any) => {
        if (d?.state === 'poweredOn') {
          clearTimeout(timer);
          sub.remove();
          resolve();
        }
      });
    });
  }

  private async requestAndroidPermissions(): Promise<void> {
    if (Platform.OS !== 'android') {
      return;
    }
    const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : 0;
    const wanted: string[] =
      apiLevel >= 31
        ? [
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          ]
        : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    const result = (await PermissionsAndroid.requestMultiple(
      wanted as any,
    )) as Record<string, string>;
    if (wanted.some(p => result[p] !== PermissionsAndroid.RESULTS.GRANTED)) {
      throw new Error('蓝牙权限未授予');
    }
  }

  // -------------------------------------------------------------------------
  // 扫描
  // -------------------------------------------------------------------------

  async startScan(): Promise<void> {
    this.wire();
    await this.requestAndroidPermissions();
    await this.ensurePoweredOn();
    this.setState('scanning');
    await Mr20Native.startScan();
  }

  stopScan(): void {
    Mr20Native.stopScan().catch(() => undefined);
    if (this.connState === 'scanning') {
      this.setState('idle');
    }
  }

  // -------------------------------------------------------------------------
  // 连接 / 订阅
  // -------------------------------------------------------------------------

  async connect(deviceId: string, name = '记忆粒'): Promise<Mr20Device> {
    this.wire();
    this.stopScan();
    this.setState('connecting');
    try {
      await Mr20Native.connect(deviceId);
      // 订阅「指令 notify」(001120a3)：命令应答 / U&LEN / OFF 等走这里。
      await Mr20Native.monitor(MR20_UUID.service, MR20_UUID.cmdNotify);
      // 同时订阅「音频 notify」(001120a1)：BLE 同步文件的**二进制数据走这个口**，
      // 不是指令口。实测只订指令口时只收到 U&LEN/OFF 却收不到文件字节
      // （received 一直为 0 → 落盘空文件 → 播放 OSStatus 'wht?'、转写 no audio）。
      // 设备非录音态时该口静默，订了无副作用。
      await Mr20Native.monitor(MR20_UUID.service, MR20_UUID.audioNotify).catch(
        () => undefined,
      );
      const info: Mr20Device = {id: deviceId, name, rssi: null};
      this.device = info;
      // 此刻仅 BLE 链路就绪，尚未 SK 握手。协议要求 SK&OK 前设备对一切指令静默，
      // 因此**不**在此置 connected / 发 connected 事件——否则 UI 会瞬间切到设备
      // 主页并触发 refreshStatus，与握手命令交错；握手失败断开后，这些 status
      // 命令的等待者会残留并抛出未处理拒绝。connected 由 authenticate() 在
      // SK&OK 后发出。
      this.setState('pairing');
      return info;
    } catch (e) {
      this.setState('idle');
      throw e;
    }
  }

  /** 按需订阅音频 notify（实时聆听 / 录音监听时调用）。失败不影响连接。 */
  async startAudioMonitor(): Promise<void> {
    await Mr20Native.monitor(MR20_UUID.service, MR20_UUID.audioNotify).catch(
      () => undefined,
    );
  }

  // -------------------------------------------------------------------------
  // 设备消息分发
  // -------------------------------------------------------------------------

  private onDeviceMessage(msg: DeviceMessage): void {
    switch (msg.type) {
      case 'BATTERY':
        this.emit('status', {battery: msg.rate});
        break;
      case 'SPACE':
        this.emit('status', {spaceFreeMb: msg.freeMb, spaceTotalMb: msg.totalMb});
        break;
      case 'FIRMWARE':
        this.emit('status', {firmware: msg.version});
        break;
      case 'WIFI_VERSION':
        this.emit('status', {wifiVersion: msg.version});
        break;
      case 'MAC':
        this.emit('status', {mac: msg.mac});
        break;
      case 'REC_MODE':
        this.emit('status', {recMode: msg.mode});
        break;
      case 'RECORDING':
        this.emit('recording', {fname: msg.fname, seconds: msg.seconds});
        break;
      case 'REC_STATE':
        this.emit('recState', {recording: msg.recording});
        break;
      case 'DISK_ERR':
        this.emit('error', {code: 'DISK_FULL', message: '设备存储已满'});
        break;
      case 'REC_ERR':
        this.emit('error', {code: 'REC_ERR', message: '设备录音出错'});
        break;
      case 'FILE_DATA_LEN':
        if (this.fileXfer) {
          this.fileXfer.expected = msg.length;
          this.fileXfer.onProgress?.(0, msg.length);
        }
        break;
      case 'FILE_DATA_DONE':
        this.finishFileTransfer();
        break;
      case 'FILE_DATA_ERR':
        this.failFileTransfer(new Error('设备无法打开文件'));
        break;
      default:
        break;
    }
    for (const handler of [...this.collectors]) {
      handler(msg);
    }
  }

  // -------------------------------------------------------------------------
  // 命令-应答相关
  // -------------------------------------------------------------------------

  /**
   * 注册一个命令-应答收集器，返回 promise 及其取消句柄。
   * 取消（cancel）/超时/命中应答任一发生后都会拆掉定时器并从收集器表移除，
   * 保证不会残留「8 秒后对空 promise reject」的孤儿定时器。
   */
  /**
   * 串行执行一个 BLE 请求-应答事务（收集器注册 + 写命令 + 等应答）。排队期间**不注册** collector，
   * 保证同一时刻只有一个 collect 事务在飞，杜绝并发扫描的应答串扰。链在成功/失败后都继续推进。
   */
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.txChain.then(fn, fn);
    this.txChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private collect<T>(
    reducer: Reducer<T>,
    timeoutMs = DEFAULT_TIMEOUT,
  ): {promise: Promise<T>; cancel: (err: Error) => void} {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    let entry: (msg: DeviceMessage) => void = () => {};
    let cancel: (err: Error) => void = () => {};

    const promise = new Promise<T>((resolve, reject) => {
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.collectors = this.collectors.filter(h => h !== entry);
        this.pendingCancels.delete(cancel);
      };
      timer = setTimeout(() => {
        finish();
        reject(new Error('设备应答超时'));
      }, timeoutMs);
      entry = (msg: DeviceMessage) => {
        if (settled) {
          return;
        }
        const r = reducer(msg);
        if (r.done) {
          finish();
          resolve(r.value as T);
        }
      };
      cancel = (err: Error) => {
        if (settled) {
          return;
        }
        finish();
        reject(err);
      };
      this.collectors.push(entry);
    });

    this.pendingCancels.add(cancel);
    return {promise, cancel};
  }

  /** 断连/销毁时结算所有挂起的收集器，避免孤儿定时器抛未处理拒绝。 */
  private cancelAllCollectors(err: Error): void {
    const cancels = [...this.pendingCancels];
    this.pendingCancels.clear();
    this.collectors = [];
    cancels.forEach(c => {
      try {
        c(err);
      } catch {
        // 单个取消异常不影响其它
      }
    });
  }

  private async write(command: string): Promise<void> {
    this.log(`=> ${command}`);
    await Mr20Native.writeNoResponse(
      MR20_UUID.service,
      MR20_UUID.write,
      encodeCommand(command),
    );
  }

  private sendAndWait(
    command: string,
    predicate: (msg: DeviceMessage) => boolean,
    timeoutMs = DEFAULT_TIMEOUT,
  ): Promise<DeviceMessage> {
    return this.runExclusive(() =>
      this.sendAndWaitLocked(command, predicate, timeoutMs),
    );
  }

  /**
   * sendAndWait 的「已持锁」版本：写命令 + 等应答，但**不自己抢 runExclusive 锁**。
   * 供已经在一个 runExclusive 事务内的调用方复用（如 OTA 全程独占锁、中途要多次收发）；
   * 直接调用会与并发事务串扰，仅限已持锁场景。
   */
  private async sendAndWaitLocked(
    command: string,
    predicate: (msg: DeviceMessage) => boolean,
    timeoutMs = DEFAULT_TIMEOUT,
  ): Promise<DeviceMessage> {
    const {promise, cancel} = this.collect<DeviceMessage>(
      msg => (predicate(msg) ? {done: true, value: msg} : {done: false}),
      timeoutMs,
    );
    try {
      await this.write(command);
    } catch (e) {
      // write 失败（如已断开）时，等待者还没被任何人 await——必须主动结算，
      // 否则它会在超时后抛出未处理拒绝。先挂个 noop catch 吞掉取消引发的拒绝。
      promise.catch(() => undefined);
      cancel(e as Error);
      throw e;
    }
    return promise;
  }

  // -------------------------------------------------------------------------
  // 配对 + 设备信息
  // -------------------------------------------------------------------------

  /**
   * 鉴权握手：发 16 位密钥 SK，等设备应答。
   * 协议要求——握手成功（SK&OK）前，设备不响应任何指令。
   * SK&ERR（绑了别的密钥）或超时（设备静默）→ 抛错，由上层决定是否重置重绑。
   */
  async authenticate(key: string): Promise<void> {
    this.setState('pairing');
    const msg = await this.sendAndWait(
      Cmd.bindKey(key),
      m => m.type === 'SK_OK' || m.type === 'SK_ERR',
      8000,
    );
    if (msg.type !== 'SK_OK') {
      throw new Error('SK_ERR');
    }
    // SK&OK：握手通过，设备此刻才真正可用。connected 事件延后到这里发出
    // （见 connect() 注释），让 UI 在握手成功后才切到设备主页。
    this.markConnected();
  }

  /**
   * 裸连探测：连上后**不发任何密钥**，直接发一条只读指令（FW）看设备是否应答。
   * 用来判断这台固件到底强不强制 SK——能直接读到固件版本，就说明它对只读指令
   * 开放，可走「免密钥」路径，这是最稳、最简单的连接方式。
   * 返回 true 表示设备在 timeout 内回了 FIRMWARE 应答。
   */
  async probe(timeoutMs = 2500): Promise<boolean> {
    return this.runExclusive(async () => {
      const {promise, cancel} = this.collect<boolean>(
        msg => (msg.type === 'FIRMWARE' ? {done: true, value: true} : {done: false}),
        timeoutMs,
      );
      try {
        await this.write(Cmd.getFirmware());
      } catch (e) {
        promise.catch(() => undefined);
        cancel(e as Error);
        return false;
      }
      // 超时（设备静默）按「不开放」处理，吞掉超时拒绝。
      return promise.catch(() => false);
    });
  }

  /** 标记设备已就绪（SK&OK 或免密钥探测通过都走这里）。 */
  markConnected(): void {
    this.setState('connected');
    if (this.device) {
      this.emit('connected', this.device);
    }
  }

  async syncTime(): Promise<void> {
    await this.sendAndWait(
      Cmd.setTime(new Date()),
      m => m.type === 'TIME_SET_OK',
    ).catch(() => undefined);
  }

  async getBattery(): Promise<number> {
    const m = await this.sendAndWait(Cmd.getBattery(), x => x.type === 'BATTERY');
    return m.type === 'BATTERY' ? m.rate : 0;
  }

  async getSpace(): Promise<{freeMb: number; totalMb: number}> {
    const m = await this.sendAndWait(Cmd.getSpace(), x => x.type === 'SPACE');
    return m.type === 'SPACE' ? {freeMb: m.freeMb, totalMb: m.totalMb} : {freeMb: 0, totalMb: 0};
  }

  async getFirmware(): Promise<string> {
    const m = await this.sendAndWait(Cmd.getFirmware(), x => x.type === 'FIRMWARE');
    return m.type === 'FIRMWARE' ? m.version : '';
  }

  /** 获取 WiFi 模组固件版本（WF → WF&<版本>）。 */
  async getWifiVersion(): Promise<string> {
    const m = await this.sendAndWait(
      Cmd.getWifiVersion(),
      x => x.type === 'WIFI_VERSION',
    );
    return m.type === 'WIFI_VERSION' ? m.version : '';
  }

  /** 读取设备当前时间（GT → CT&<yyyymmddhhmmss>），返回原始 14 位串；解析交给 UI。 */
  async getTime(): Promise<string> {
    const m = await this.sendAndWait(Cmd.getTime(), x => x.type === 'TIME');
    return m.type === 'TIME' ? m.time : '';
  }

  async getMac(): Promise<string> {
    const m = await this.sendAndWait(Cmd.getMac(), x => x.type === 'MAC');
    return m.type === 'MAC' ? m.mac : '';
  }

  async getRecMode(): Promise<'call' | 'conversation'> {
    const m = await this.sendAndWait(Cmd.getRecMode(), x => x.type === 'REC_MODE');
    return m.type === 'REC_MODE' ? m.mode : 'conversation';
  }

  async refreshStatus(): Promise<Mr20Status> {
    // 防止并发刷新（connectAndPair 与界面 useEffect 会同时触发），否则命令-应答交错。
    if (this.statusRefreshing) {
      return {};
    }
    this.statusRefreshing = true;
    try {
      return await this.doRefreshStatus();
    } finally {
      this.statusRefreshing = false;
    }
  }

  private async doRefreshStatus(): Promise<Mr20Status> {
    const status: Mr20Status = {};
    try {
      status.battery = await this.getBattery();
    } catch {}
    try {
      const s = await this.getSpace();
      status.spaceFreeMb = s.freeMb;
      status.spaceTotalMb = s.totalMb;
    } catch {}
    try {
      status.firmware = await this.getFirmware();
    } catch {}
    try {
      status.wifiVersion = await this.getWifiVersion();
    } catch {}
    try {
      status.mac = await this.getMac();
    } catch {}
    try {
      status.recMode = await this.getRecMode();
    } catch {}
    this.emit('status', status);
    return status;
  }

  // -------------------------------------------------------------------------
  // 录音控制
  // -------------------------------------------------------------------------

  async startRecording(): Promise<void> {
    await this.write(Cmd.startRec());
  }

  async stopRecording(): Promise<void> {
    await this.write(Cmd.stopRec());
  }

  async getRecState(): Promise<boolean> {
    const m = await this.sendAndWait(Cmd.getRecState(), x => x.type === 'REC_STATE');
    return m.type === 'REC_STATE' ? m.recording : false;
  }

  // -------------------------------------------------------------------------
  // 文件列表
  // -------------------------------------------------------------------------

  async listDirs(timeoutMs = DEFAULT_TIMEOUT): Promise<string[]> {
    return this.runExclusive(async () => {
      const dirs: string[] = [];
      const {promise, cancel} = this.collect<string[]>(msg => {
        if (msg.type === 'DIR') {
          dirs.push(msg.name);
        }
        if (msg.type === 'DIRS_DONE') {
          return {done: true, value: dirs};
        }
        return {done: false};
      }, timeoutMs);
      try {
        await this.write(Cmd.listDirs());
      } catch (e) {
        promise.catch(() => undefined);
        cancel(e as Error);
        throw e;
      }
      return promise;
    });
  }

  async listFiles(dir: string, timeoutMs = DEFAULT_TIMEOUT): Promise<Mr20File[]> {
    return this.runExclusive(async () => {
      const files: Mr20File[] = [];
      const {promise, cancel} = this.collect<Mr20File[]>(msg => {
        if (msg.type === 'FILE') {
          files.push({dir: msg.dir, fname: msg.fname, seconds: msg.seconds, size: msg.size});
        }
        if (msg.type === 'FILE_LIST_DONE') {
          return {done: true, value: files};
        }
        return {done: false};
      }, timeoutMs);
      try {
        await this.write(Cmd.listFiles(dir));
      } catch (e) {
        promise.catch(() => undefined);
        cancel(e as Error);
        throw e;
      }
      return promise;
    });
  }

  // -------------------------------------------------------------------------
  // 文件同步（BLE）
  // -------------------------------------------------------------------------

  /**
   * BLE 单文件传输的「停滞」判定窗口：距上一批字节多久没有新数据算卡住。
   * 原来是 120s（等同整文件超时），设备中途不推字节时进度条要冻 2 分钟才报错——
   * 「传输中 0/6 卡很久」的主因。缩到 15s，让 syncFiles 能尽快重试。
   */
  private static readonly BLE_IDLE_TIMEOUT_MS = 15000;
  /**
   * 字节已收满但设备迟迟不回 FILE_DATA_DONE 时的宽限期。数据本身已完整，
   * 超过宽限期就按成功结算，不必陪着设备干等（这是卡住时最常见的形态：
   * 单文件进度条满格、总进度却不前进）。
   */
  private static readonly BLE_DONE_GRACE_MS = 5000;

  async pullFile(
    dir: string,
    fname: string,
    onProgress?: (received: number, total: number) => void,
    timeoutMs = 120000,
  ): Promise<Uint8Array> {
    // 与扫描/状态等控制指令走同一把串行锁：设备单线程，若在扫描（listDirs/listFiles）途中
    // 插进 syncFile，设备会不回 FILE_DATA_DONE，导致「字节收完但传输不结算、卡很久」。
    return this.runExclusive(() => this.pullFileLocked(dir, fname, onProgress, timeoutMs));
  }

  private pullFileLocked(
    dir: string,
    fname: string,
    onProgress?: (received: number, total: number) => void,
    timeoutMs = 120000,
  ): Promise<Uint8Array> {
    if (this.fileXfer) {
      return Promise.reject(new Error('已有文件正在同步'));
    }
    return new Promise<Uint8Array>((resolve, reject) => {
      // 首帧窗口用 timeoutMs（设备可能要先打开文件），之后每批字节把窗口收紧到
      // BLE_IDLE_TIMEOUT_MS —— 传起来之后的静默才是真卡住，不该再等两分钟。
      let timer = setTimeout(() => {
        this.fileXfer = null;
        reject(new Error('文件同步超时'));
      }, timeoutMs);

      const wrap = (fn: (v: any) => void) => (v: any) => {
        clearTimeout(timer);
        fn(v);
      };

      this.fileXfer = {
        expected: -1,
        received: 0,
        chunks: [],
        resolve: wrap(resolve),
        reject: wrap(reject),
        onProgress: (received, total) => {
          clearTimeout(timer);
          if (total > 0 && received > total) {
            // 收到的字节**多于**设备声明的 LEN：文件流里混进了别的东西。已知成因是设备在
            // 自动录音时，实时音频流与文件数据走同一个 notify 特征(001120a1)，handleFrame
            // 无法区分、把实时流也计进了本文件（见 pullFile 上方注释）。此时既不能按成功
            // 结算（落盘的 MP3 是坏的），也不该继续等——实时流会不停刷新进度、让停滞看门狗
            // 永远不触发，正是「进度条满格却永久卡死」的形态。立即失败并给出可定位的原因。
            this.fileXfer = null;
            reject(new Mr20StreamPollutedError(received, total));
          } else if (total > 0 && received === total) {
            // 字节齐了，只差一句 FILE_DATA_DONE：短宽限后自己结算，别把用户晾在满格进度条上。
            // 只在**恰好收满**时这么做；多收（上面那支）说明数据不可信，不能当成功。
            timer = setTimeout(() => {
              this.log('[ble] 字节已收全但未收到 DONE，按完成结算');
              this.finishFileTransfer();
            }, Mr20Client.BLE_DONE_GRACE_MS);
          } else {
            timer = setTimeout(() => {
              this.fileXfer = null;
              reject(new Error('文件同步停滞'));
            }, Mr20Client.BLE_IDLE_TIMEOUT_MS);
          }
          onProgress?.(received, total);
          this.emit('fileProgress', {received, total});
        },
      };

      this.write(Cmd.syncFile(dir, fname)).catch(err => {
        clearTimeout(timer);
        this.fileXfer = null;
        reject(err);
      });
    });
  }

  private pushFileBytes(bytes: Uint8Array): void {
    const xfer = this.fileXfer;
    if (!xfer) {
      return;
    }
    xfer.chunks.push(bytes);
    xfer.received += bytes.length;
    xfer.onProgress?.(xfer.received, xfer.expected);
  }

  private finishFileTransfer(): void {
    const xfer = this.fileXfer;
    if (!xfer) {
      return;
    }
    this.fileXfer = null;
    const total = xfer.chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of xfer.chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    xfer.resolve(out);
  }

  private failFileTransfer(err: Error): void {
    const xfer = this.fileXfer;
    if (!xfer) {
      return;
    }
    this.fileXfer = null;
    xfer.reject(err);
  }

  async abortTransfer(): Promise<void> {
    if (this.fileXfer) {
      this.failFileTransfer(new Error('已中断'));
    }
    await this.write(Cmd.shutTransfer()).catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // WiFi 快传（控制走 BLE，文件字节走 WiFi TCP）
  // -------------------------------------------------------------------------

  /**
   * WiFi 收流「多久没有新字节算停滞」。原生侧同名看门狗为 12s，JS 侧取稍大值（15s）作为
   * 兜底，避免两层同时触发时先报 JS 的通用错误、盖掉原生更具体的字节数信息。
   */
  private static readonly WIFI_IDLE_TIMEOUT_MS = 15000;

  /** 查询 WiFi 状态码（0关 1连 2未连但AP起 3待开 4配密码 5OTA 6待复位 7无连自动关）。 */
  async getWifiState(): Promise<number> {
    const m = await this.sendAndWait(
      Cmd.getWifiState(),
      x => x.type === 'WIFI_STATE',
    );
    return m.type === 'WIFI_STATE' ? parseInt(m.state, 10) || 0 : 0;
  }

  /** 获取热点 SSID/密码。 */
  async getWifiCredentials(): Promise<{ssid: string; pwd: string}> {
    const m = await this.sendAndWait(Cmd.getWifi(), x => x.type === 'WIFI_CRED');
    return m.type === 'WIFI_CRED'
      ? {ssid: m.ssid, pwd: m.pwd}
      : {ssid: '', pwd: ''};
  }

  /**
   * 开热点并等到 AP 就绪。**只发 WIFIO + 轮询 WIFIS，绝不发 SK**。
   *
   * 注意：协议说「设备收到密钥后才自动配 WiFi 密码」，但本 App 走裸连探测(不发 SK)，且部分设备
   * 出厂预绑厂商密钥、对我们的密钥永远 SK&ERR（见 [[mr20-sk-binding-key]]）——**在此发 SK 会打断
   * 会话、把连接搞断**。所以这里坚决不发 SK；WiFi 能否开由设备侧决定，开不起来就如实报「末态 X」。
   *
   * 状态机轮询 WIFIS：
   *   - 1(已连)/2(AP起未连)：就绪，返回
   *   - 0(关)/7(自动关)/-1(无应答)：发 WIFIO（节流 ≥3.5s）
   *   - 3(等待开启)/4/5/6(配密码/OTA/待复位)：继续等
   */
  async openWifi(opts: {maxWaitMs?: number} = {}): Promise<void> {
    const {maxWaitMs = 30000} = opts;
    const usable = (s: number) => s === 1 || s === 2;
    const deadline = Date.now() + maxWaitMs;
    let lastOpenAt = 0;
    let lastState = -1;
    while (Date.now() < deadline) {
      const s = await this.getWifiState().catch(() => -1);
      lastState = s;
      if (usable(s)) {
        return;
      }
      // 只在明确「关闭态」(0/7) 才补发 WIFIO，且节流 ≥6s——正常 WIFIO 4s 到 2。
      // 反复开关会触发 WiFi 模组卡死(状态3)，故尽量少发；状态 3/-1 期间纯等待不重发。
      if ((s === 0 || s === 7) && Date.now() - lastOpenAt > 6000) {
        lastOpenAt = Date.now();
        await this.sendAndWait(
          Cmd.wifiOpen(),
          x => x.type === 'WIFI_OPENED',
          3000,
        ).catch(() => undefined); // 个别固件不回 WIFIO，靠轮询兜底
      }
      await new Promise<void>(resolve => setTimeout(() => resolve(), 1000));
    }
    // 卡在状态 3 = 已知固件 bug（反复开关后 WiFi 模组卡「等待开启」进不到 2），需断电重启。
    if (lastState === 3) {
      throw new Error(
        '设备 WiFi 模组卡住（已知固件问题，反复开关触发）——请将录音设备断电重启后再试。',
      );
    }
    // 其它末态便于定位：-1=WIFIS 无应答；4/6=卡配密码周期；0=发了 WIFIO 仍未开。
    throw new Error(`设备 WiFi 热点未就绪（末态 ${lastState}）`);
  }

  /** 关热点：发 WIFIC（设备 30s 无连接也会自动关，故失败可容忍）。 */
  async closeWifi(): Promise<void> {
    await this.sendAndWait(
      Cmd.wifiClose(),
      x => x.type === 'WIFI_CLOSED',
      4000,
    ).catch(() => undefined);
  }

  /**
   * 修改热点 SSID/密码（WIFI&CH）。协议 R33：**MCU 不回包**，结果只能靠轮询 WIFIS 推断。
   *
   * 真机实测（YLF20，见 [[mr20-wifi-change-credentials]]）：**冷发 WIFI&CH 时设备只把热点从
   * 3→2 唤起、并不进 4（修改密码中）**——协议也印证「状态 4/5/6 时无法关 WiFi」，即改密发生在
   * 热点已开之时。故这里**先 openWifi() 让热点到 AP 态（1/2），再发 WIFI&CH**。
   *
   * 轮询 WIFIS：
   *   4/5 = 修改密码中 / 应用中 → 记为「已进入改密态」（命令被接受）
   *   6   = 密码已改、待复位关机 → 明确成功
   *   进过改密态后回落到 0/1/2/7（设备复位重启 WiFi）→ 视为已应用、成功
   * 全程未进改密态 → 按「末态 X，未进入修改态」抛错，便于判定是格式仍不对还是别的问题。
   *
   * ⚠️ WIFI&CH 的参数拼法（见 {@link Cmd.changeWifi}）协议未写死；本实现按 get 应答
   * `WIFI&SSID&PWD` 的结构对称拼 `WIFI&CH&ssid&pwd`。若真机仍不进 4/6，需向固件方确认格式。
   */
  async changeWifiCredentials(
    ssid: string,
    pwd: string,
    opts: {maxWaitMs?: number} = {},
  ): Promise<void> {
    const {maxWaitMs = 20000} = opts;
    // 先确保热点在 AP 态：冷发 WIFI&CH 只会唤起 WiFi、不进改密（真机实测）。
    await this.openWifi();
    // 命令无应答，直接写；随后进入轮询确认。
    await this.write(Cmd.changeWifi(ssid, pwd));
    const deadline = Date.now() + maxWaitMs;
    let sawChanging = false;
    let lastState = -1;
    while (Date.now() < deadline) {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 1000));
      const s = await this.getWifiState().catch(() => -1);
      lastState = s;
      if (s === 4 || s === 5) {
        sawChanging = true; // 进入修改密码/应用中，命令已被接受
      }
      if (s === 6) {
        return; // 明确成功、待设备复位
      }
      // 进过改密态后回落（设备复位重启 WiFi）也算已应用。
      if (sawChanging && (s === 0 || s === 1 || s === 2 || s === 7)) {
        return;
      }
    }
    throw new Error(
      `修改热点信息未确认（末态 ${lastState}，${sawChanging ? '曾进入修改态' : '未进入修改态'}）`,
    );
  }

  /**
   * 建立整批 WiFi 快传共用的 TCP 长连接（**只连一次**）。后续每个文件用 {@link wifiReceiveShared}
   * 在同一 socket 上收流，批末用 {@link wifiCloseShared} 关闭——避免逐条重连的 ~1s 空档。
   * **必须早于发 W**（设备一回 W&LEN 就往 socket 推字节，晚连丢数据卡 0）。
   */
  async wifiOpenShared(host: string, port: number): Promise<void> {
    const transferId = `wifi/${Date.now()}`;
    this.wifiTransferId = transferId;
    this.log(`[wifi] 建立长连接 ${host}:${port} …`);
    try {
      await Mr20Native.wifiConnect(host, port, transferId);
    } catch (e) {
      this.wifiTransferId = null;
      throw new Error(`连接设备热点失败：${String((e as Error)?.message || e)}`);
    }
    this.log('[wifi] 长连接已建立');
  }

  /**
   * 在已建立的长连接上收一个文件：BLE 发 W 拿 W&LEN，再由原生 TCP 接收器收流落盘。
   * **不建连、不关连**（连接复用见 {@link wifiOpenShared}）。**不设置 this.fileXfer**——
   * 文件字节走 WiFi TCP，不经过 BLE notify，避免 handleFrame 误把无关 notify 当文件数据。
   */
  async wifiReceiveShared(
    dir: string,
    fname: string,
    opts: {
      relativePath: string;
      onProgress?: (received: number, total: number) => void;
    },
  ): Promise<{path: string; total: number}> {
    const transferId = this.wifiTransferId;
    if (!transferId) {
      throw new Error('WiFi 长连接未建立');
    }
    const {relativePath, onProgress} = opts;
    let total = 0;

    // JS 侧停滞兜底：原生已有 12s 看门狗，但旧二进制（未重编译）没有，且看门狗只覆盖
    // 「已开始收流」之后。这里再压一层：收到字节就续期，超时主动 abort 打断挂起的原生 promise，
    // 让上层 wifiSyncFiles 走重连续传，而不是永远停在同一格进度。
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let stalled = false;
    const armIdle = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => {
        stalled = true;
        this.log('[wifi] 收流停滞，主动断开重试');
        this.wifiCloseShared().catch(() => undefined);
      }, Mr20Client.WIFI_IDLE_TIMEOUT_MS);
    };
    const clearIdle = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    // 订阅原生进度事件（仅本次长连接的 transferId；同一时刻只有一个文件在收）。
    const sub = mr20Emitter.addListener('onWifiProgress', (d: any) => {
      if (String(d?.transferId) !== transferId) {
        return;
      }
      armIdle(); // 有新字节 → 停滞计时重新开始
      const received = Number(d?.received) || 0;
      const t = Number(d?.total) || total;
      onProgress?.(received, t);
      this.emit('fileProgress', {received, total: t});
    });

    try {
      // BLE 下发 W 指令拿文件长度（W&LEN）。
      const lenMsg = await this.sendAndWait(
        Cmd.wifiFile(dir, fname),
        x => x.type === 'FILE_DATA_LEN' || x.type === 'FILE_DATA_ERR',
        8000,
      );
      if (lenMsg.type === 'FILE_DATA_ERR') {
        throw new Error('设备无法打开文件');
      }
      total = lenMsg.type === 'FILE_DATA_LEN' ? lenMsg.length : 0;
      this.log(`[wifi] W&LEN=${total}，开始收流`);

      // 在长连接上收流落盘（含剥离 5 字节尾标），返回绝对路径。
      armIdle(); // 发完 W 就开始计时：设备一个字节都不推的情况也要能超时
      const path = await Mr20Native.wifiReceiveFile(relativePath, total, transferId);
      this.log('[wifi] 收流完成');
      return {path, total};
    } catch (e) {
      // abort 打断原生 promise 时报的是通用「已中断」，换成停滞原因便于定位。
      throw stalled ? new Error('传输停滞，已断开重连') : e;
    } finally {
      clearIdle();
      sub.remove();
    }
  }

  /** 关闭整批的 WiFi 长连接（批末或异常时）。 */
  async wifiCloseShared(): Promise<void> {
    const id = this.wifiTransferId;
    this.wifiTransferId = null;
    if (id) {
      await Mr20Native.wifiAbort(id).catch(() => undefined);
    }
  }

  /** 中断正在进行的 WiFi 接收（关 socket），使当前文件的 wifiReceiveShared 立即出错。 */
  async abortWifi(): Promise<void> {
    const id = this.wifiTransferId;
    if (id) {
      await Mr20Native.wifiAbort(id).catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------
  // OTA 固件升级（MCU）
  // -------------------------------------------------------------------------

  /** 直接发送原始字节帧（OTA 固件数据）。不做 GJJY ASCII 封装，仅 bytes->base64 写入写特征。 */
  private async writeRaw(bytes: Uint8Array): Promise<void> {
    await Mr20Native.writeNoResponse(
      MR20_UUID.service,
      MR20_UUID.write,
      bytesToBase64(bytes),
    );
  }

  /**
   * MCU OTA 升级。协议 R42/R44/R61：
   *   1. 发 `OTA&<LEN 6位>` → 等 `DEV&OTA` 就绪；
   *   2. 按 244 字节/帧流式发送固件原始字节，每帧间隔 ≥8ms（iOS 建议 20ms）；
   *   3. 发完 `OT&OVER` → 等 `DEV&OT&OVER`（成功）/ `OT&ERR`（失败）。
   *
   * 全程 `runExclusive` 独占 BLE 串行锁：协议明确「OTA 期间禁发其他指令，否则会 OTA 失败」。
   * LEN 固定 6 位 → 固件必须 ≤999999 字节（≈1MB）。成功后设备自行复位（BLE 断开是预期的）。
   * 传输中断/校验失败会使设备卡在 OTA 等待态，需断电重启——故失败文案提示重启。
   */
  async otaUpdateMcu(
    bin: Uint8Array,
    opts: {
      onProgress?: (sent: number, total: number) => void;
      frameSize?: number;
      frameIntervalMs?: number;
    } = {},
  ): Promise<void> {
    const {onProgress, frameSize = 244, frameIntervalMs = 20} = opts;
    const total = bin.length;
    if (total <= 0) {
      throw new Error('固件为空');
    }
    if (total > 999999) {
      throw new Error('固件超过 1MB（协议 OTA LEN 6 位上限），无法通过 BLE OTA 下发');
    }
    return this.runExclusive(async () => {
      // 1) 发起 OTA，等设备就绪。
      await this.sendAndWaitLocked(
        Cmd.otaStart(total),
        m => m.type === 'OTA_READY',
        8000,
      );
      // 2) 流式发送固件帧（原始字节，非 ASCII 命令）。
      let sent = 0;
      onProgress?.(0, total);
      for (let off = 0; off < total; off += frameSize) {
        const frame = bin.subarray(off, Math.min(off + frameSize, total));
        await this.writeRaw(frame);
        sent += frame.length;
        onProgress?.(sent, total);
        // 每帧间隔；最后一帧后无需再等。
        if (off + frameSize < total) {
          await new Promise<void>(resolve =>
            setTimeout(() => resolve(), frameIntervalMs),
          );
        }
      }
      // 3) 通知发送完成，等设备写 flash 后回结果（放宽超时）。
      const done = await this.sendAndWaitLocked(
        Cmd.otaOver(),
        m => m.type === 'OTA_DONE' || m.type === 'OTA_ERR',
        30000,
      );
      if (done.type === 'OTA_ERR') {
        throw new Error('设备固件接收失败，请断电重启设备后重试');
      }
    });
  }

  // -------------------------------------------------------------------------
  // 设备管理
  // -------------------------------------------------------------------------

  async deleteFile(dir: string, fname: string): Promise<boolean> {
    const m = await this.sendAndWait(
      Cmd.deleteFile(dir, fname),
      x => x.type === 'DELETE_OK' || x.type === 'DELETE_ERR',
    );
    return m.type === 'DELETE_OK';
  }

  async setUsb(on: boolean): Promise<void> {
    await this.write(Cmd.setUsb(on ? 1 : 0));
  }

  async factoryReset(): Promise<void> {
    await this.write(Cmd.bleReset());
  }

  // -------------------------------------------------------------------------
  // 断连
  // -------------------------------------------------------------------------

  private handleDisconnect(reason?: string): void {
    this.cancelAllCollectors(new Error('连接断开'));
    if (this.fileXfer) {
      this.failFileTransfer(new Error('连接断开'));
    }
    this.device = null;
    this.setState('disconnected');
    this.emit('disconnected', {reason});
  }

  async disconnect(): Promise<void> {
    this.cancelAllCollectors(new Error('连接断开'));
    if (this.fileXfer) {
      this.failFileTransfer(new Error('连接断开'));
    }
    this.device = null;
    await Mr20Native.disconnect().catch(() => undefined);
    this.setState('idle');
  }

  destroy(): void {
    this.stopScan();
    this.cancelAllCollectors(new Error('已销毁'));
    this.nativeSubs.forEach(s => s.remove());
    this.nativeSubs = [];
    this.wired = false;
  }
}
