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
  // WiFi 快传（控制走 BLE，文件字节走 WiFi TCP）
  // -------------------------------------------------------------------------

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
   * WiFi 拉取单个文件：BLE 发 W 命令拿 W&LEN，再由原生 TCP 接收器收流落盘。
   * **不设置 this.fileXfer**——文件字节走 WiFi TCP，不经过 BLE notify，避免
   * handleFrame 误把无关 notify 当文件数据。
   */
  async pullFileWifi(
    dir: string,
    fname: string,
    opts: {
      host: string;
      port: number;
      relativePath: string;
      resumeBytes?: number;
      onProgress?: (received: number, total: number) => void;
    },
  ): Promise<{path: string; total: number}> {
    const {host, port, relativePath, resumeBytes = 0, onProgress} = opts;
    const transferId = `${dir}/${fname}/${Date.now()}`;
    this.wifiTransferId = transferId;
    let total = 0;

    // 1) **先连 TCP socket**（必须早于发 W——设备一回 W&LEN 就往 socket 推字节，晚连丢数据卡 0）。
    this.log(`[wifi] 连接 ${host}:${port} …`);
    try {
      await Mr20Native.wifiConnect(host, port, transferId);
    } catch (e) {
      this.wifiTransferId = null;
      throw new Error(`连接设备热点失败：${String((e as Error)?.message || e)}`);
    }
    this.log('[wifi] socket 已连接');

    // 2) 订阅原生进度事件（仅本次 transferId）。
    const sub = mr20Emitter.addListener('onWifiProgress', (d: any) => {
      if (String(d?.transferId) !== transferId) {
        return;
      }
      const received = Number(d?.received) || 0;
      const t = Number(d?.total) || total;
      onProgress?.(received, t);
      this.emit('fileProgress', {received, total: t});
    });

    try {
      // 3) BLE 下发 W 指令拿文件长度（W&LEN）。
      const lenMsg = await this.sendAndWait(
        resumeBytes > 0
          ? Cmd.wifiFileResume(dir, fname, resumeBytes)
          : Cmd.wifiFile(dir, fname),
        x => x.type === 'FILE_DATA_LEN' || x.type === 'FILE_DATA_ERR',
        8000,
      );
      if (lenMsg.type === 'FILE_DATA_ERR') {
        throw new Error('设备无法打开文件');
      }
      total = lenMsg.type === 'FILE_DATA_LEN' ? lenMsg.length : 0;
      this.log(`[wifi] W&LEN=${total}，开始收流`);

      // 4) 在已连接的 socket 上收流落盘（含剥离 5 字节尾标），返回绝对路径。
      const path = await Mr20Native.wifiReceiveFile(relativePath, total, transferId);
      this.log('[wifi] 收流完成');
      return {path, total};
    } catch (e) {
      // 失败时关掉悬空 socket（成功路径原生已自行 cancel）。
      await Mr20Native.wifiAbort(transferId).catch(() => undefined);
      throw e;
    } finally {
      this.wifiTransferId = null;
      sub.remove();
    }
  }

  /** 中断正在进行的 WiFi 接收（关 socket），使当前文件 pullFileWifi 立即出错。 */
  async abortWifi(): Promise<void> {
    const id = this.wifiTransferId;
    if (id) {
      await Mr20Native.wifiAbort(id).catch(() => undefined);
    }
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
