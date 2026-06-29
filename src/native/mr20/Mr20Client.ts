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

export class Mr20Client {
  private nativeSubs: EmitterSubscription[] = [];
  private collectors: Array<(msg: DeviceMessage) => void> = [];
  // 每个 collect() 的取消句柄；断连/销毁时统一结算，避免残留超时定时器在
  // 8 秒后对着空 promise reject 出「未处理拒绝」。
  private pendingCancels: Set<(err: Error) => void> = new Set();
  private fileXfer: FileTransfer | null = null;
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

  private async sendAndWait(
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
  }

  async listFiles(dir: string, timeoutMs = DEFAULT_TIMEOUT): Promise<Mr20File[]> {
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
  }

  // -------------------------------------------------------------------------
  // 文件同步（BLE）
  // -------------------------------------------------------------------------

  async pullFile(
    dir: string,
    fname: string,
    onProgress?: (received: number, total: number) => void,
    timeoutMs = 120000,
  ): Promise<Uint8Array> {
    if (this.fileXfer) {
      throw new Error('已有文件正在同步');
    }
    return new Promise<Uint8Array>((resolve, reject) => {
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
          timer = setTimeout(() => {
            this.fileXfer = null;
            reject(new Error('文件同步停滞'));
          }, timeoutMs);
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
