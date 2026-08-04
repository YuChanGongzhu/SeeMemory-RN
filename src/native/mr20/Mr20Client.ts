/**
 * Mr20Client — 用原生模块 RTNMr20Module 驱动 MR20「记忆粒」的单设备连接。
 *
 * 职责：扫描/连接/订阅/写命令/命令-应答相关/文件传输状态机/实时音频分发/断连。
 * 底层 BLE 由原生 CoreBluetooth/android.bluetooth 实现（见 Mr20Native）；
 * 本文件只做协议层逻辑，GJJY 编解码在 protocol.ts。
 */
import {EmitterSubscription, PermissionsAndroid, Platform} from 'react-native';
import {
  Mr20Native,
  isMr20OtaSenderAvailable,
  mr20Emitter,
} from './Mr20Native';
import {otaLog} from '../../services/otaLog';
import {
  CMD_PREFIX,
  Cmd,
  DeviceMessage,
  MR20_UUID,
  base64ToBytes,
  bytesToAscii,
  bytesToBase64,
  encodeCommand,
  isCommandFrame,
  isValidDeviceKey,
  parseDeviceMessage,
  toDeviceKey,
  WIFI_TIMING,
  WifiState,
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

// 单帧 OTA 写入的兜底超时，只用来兜住原生挂起不返回的情况。
// 原来取 5s，真机在第 391 帧（≈93KB）被它判死——但设备此时多半只是在擦 flash 块：
// 擦写期间它不再消费 BLE 接收缓冲，iOS 的 canSendWriteWithoutResponse 就一直是 false。
// 擦一块几秒钟是正常的，5s 等于把「设备在忙」当成「链路已断」。放宽到 20s，
// 真断链的场景照样会在 20s 后收口，只是慢一点。
const OTA_FRAME_WRITE_TIMEOUT_MS = 20000;

// 单帧写入超过这个时长就单独记一条日志。正常帧是毫秒级，能记下来的都是设备在擦 flash。
// 这些停顿出现在哪些帧号是关键证据：若呈周期性（如每 128 帧一次）说明设备按块擦写、
// 只需耐心等；若只在某一帧上一去不回，才是设备真的死了。
const OTA_SLOW_WRITE_LOG_MS = 200;

// 发完 OT&OVER 后等设备擦写 flash 的上限。原来是 30s——862KB 的擦写实测就要更久，
// 30s 会把「设备正常在忙」误判成失败，还可能在写 flash 途中打断它。
const OTA_OVER_TIMEOUT_MS = 180000;
const OTA_OVER_HEARTBEAT_MS = 15000;

// WiFi 模组 OTA 独有的第 4 步：设备回 OT&OVER（数据收全）之后还要把固件刷进 WiFi 模组，
// 期间推 WIFIS&5（状态 5=OTA 中），刷完回落 WIFIS&0。这段是模组自己在烧，比 MCU 擦写更久。
const OTA_WIFI_FLASH_TIMEOUT_MS = 300000;

// 数据阶段设备本应全程沉默——协议只规定 OT&OVER 才有应答。若它对固件帧逐帧回话，
// 说明已经掉出 OTA 接收态，把剩下几千帧发完也只是白等两分钟再看它回 OT&ERR。
// 判据用「连续」而非「总量占比」：设备可能跑到中途才掉出去（占比永远到不了阈值），
// 而连击计数无论从第几帧开始失效都能立刻抓到。
const OTA_STRAY_RUN_LIMIT = 16;

// 帧节奏是「帧首到帧首」的周期，不是写完之后再额外睡的时间：写一帧要过 RN 桥
// （base64 + 桥调用 + 回调），这段本身就占掉预算，睡满 20ms 会让真实周期变成
// 「写入耗时 + 20ms + 定时器超调」，远超协议给 iOS 的 20ms。故按截止时间倒扣着睡。
// 超出周期这么多才算一帧超预算并记日志（RN 定时器本身有 1~2ms 抖动，别刷屏）。
const OTA_PERIOD_SLACK_MS = 4;

// setTimeout(n) 在 RN 上实测总是晚于 n 毫秒返回（JS 线程还要跑进度回调、通知解析）。
// 用滚动均值估这段系统性超调并提前扣掉，否则每帧都稳定迟到几毫秒。
// 上限压住：估歪了最多提前 8ms 醒，不至于把帧间隔挤到协议下限 8ms 以下。
const OTA_TIMER_BIAS_MAX_MS = 8;

// MR20「记忆粒」广播名前缀（真机实测：老批次形如 YLF20_f065fc9a，新批次形如 JYL_xxxx——
// 两种广播名对应同一套 GJJY 协议、同一个服务 UUID，只是固件换了名字，别当笔误删掉）。
// 扫描时只显示匹配的设备，过滤掉附近一堆无关蓝牙设备。如需放开调试可临时返回 true。
// 按不带下划线的前缀匹配：各批次带不带下划线并不统一（老设备是 YLF20_ 而非 YLF_）。
const MR20_NAME_PREFIXES = ['YLF', 'JYL', 'MR20'];
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

/**
 * OTA 期间的取证记录。设备端只会回一句 OT&OVER / OT&ERR，出问题时全靠这些计数
 * 判断「是我们没发到」还是「设备没收下」，故字段宁多勿少。
 */
type OtaTrace = {
  framesSent: number;
  nonCmd: number;
  /** 帧文本 -> {首次出现在第几帧后, 累计条数}。 */
  seen: Map<string, {first: number; count: number}>;
  /** 数据阶段设备主动回的命令帧总数（OTA_READY 不计）。 */
  strayTotal: number;
  /** 上述应答的当前连击长度，以及上次出现的时刻/帧号——用于识别「逐帧回话」。 */
  strayRun: number;
  lastStrayFrame: number;
  lastStrayAt: number;
  /**
   * 判定「连击」的时间窗。原来按帧号算（相隔 ≤2 帧即连击），但发帧下沉到原生后
   * JS 只在每 1% 收一次进度，帧号是粗的，按帧号会把每秒一条的 RT 帧也串成连击。
   * 帧是定时发的，改按时间算等价且对两条发送路径都成立。
   */
  strayWindowMs: number;
  /** 写入被设备背压阻塞（≥200ms）的帧数。仅 JS 兜底路径有意义（原生路径不等写入）。 */
  stalls: number;
  /** 数据阶段就收到 OT&OVER / OT&ERR：设备已提前结束，继续发没有意义。 */
  fatal: string | null;
  /** JS 兜底路径的耗时取证：写入累计、休眠累计/次数。 */
  writeMs: number;
  sleptMs: number;
  gaps: number;
  /** 帧首到帧首的实测周期：累计/样本数/最大值/超预算帧数。两条路径都填。 */
  periodMs: number;
  periods: number;
  maxPeriodMs: number;
  overBudget: number;
};

/**
 * 两种 OTA（MCU / WiFi 模组）的差异点。除了这三项，流程完全一样——
 * 起始指令不同、失败文案里的对象不同、WiFi 多一步「等模组刷完」。
 * 抽成配置而不是复制一遍两百行：那两条路的 MTU 校验、无应答写校验、
 * 掉出接收态判定、取证日志必须逐字一致，复制出去早晚会分叉。
 */
type OtaPlan = {
  /** 日志与错误文案里的对象名，如「MCU」「WiFi 模组」。 */
  label: string;
  /** 起始指令（协议 R42 的 OTA&LEN / R62 的 OTA&WIFI&LEN）。 */
  startCommand: (len: number) => string;
  /**
   * 收尾步骤。MCU 没有；WiFi 模组要再等它把固件烧进去（WIFIS&5→0）。
   *
   * 返回的监听器在发 OT&OVER **之前**就挂上：设备可能在回 OT&OVER 的同一批通知里
   * 就推 WIFIS&5，等收到 OT&OVER 再挂监听会漏掉它，然后对着永不再来的 5 干等到超时。
   */
  startTailWatch?: () => {done: Promise<void>; cancel: (err: Error) => void};
};

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
  // 非 null 表示正在跑 OTA：handleFrame 会把设备推上来的帧抄进 OTA 日志。
  // 注意是**按内容去重**记录，不是逐帧打印：otaLog 只有 300 条环形缓冲，
  // 设备若逐帧回话（3536 帧）会把开头全部挤掉，恰好挤掉「第几帧开始异常」这条关键证据。
  private otaTrace: OtaTrace | null = null;
  /** 原生定时发帧正在跑时挂在这里：设备中途乱回话，handleFrame 直接叫停它。 */
  private otaNativeAbort: (() => void) | null = null;
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

  /** 上一条日志的时刻，用来算相邻两行的间隔。0 = 还没打过。 */
  private lastLogAt = 0;

  /**
   * 往协议调试日志里记一行。**public**：编排层（如 mr20WifiSync 的入网重试）也需要把
   * 「试了哪几个密码、设备自报的是什么」记进同一条日志流——排查时只有把 BLE 往返和
   * 上层决策放在一起看，才分得清是设备回错了还是我们挑错了。
   *
   * 每行自动带上 `[时:分:秒.毫秒 +间隔]`，两个都不能省：
   *   - **绝对时钟**用来和设备端对时。像「reset 之后指示灯闪 3 秒」这种只能靠眼睛看的现象，
   *     没有墙上时间就没法和日志对上，也没法把日志发给固件方让他们比对自己的串口输出。
   *   - **距上一行的间隔**用来一眼看出「等够了没有」。真机上出现过发完 SK **0.2 秒**就报
   *     「设备完全不应答」的日志——当时每行都没有时间，那 0.2 秒是靠人肉推算才发现的。
   */
  log(msg: string): void {
    const now = Date.now();
    const d = new Date(now);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    const clock = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(
      d.getMilliseconds(),
      3,
    )}`;
    const gap = this.lastLogAt ? (now - this.lastLogAt) / 1000 : 0;
    this.lastLogAt = now;
    this.emit('log', `[${clock} +${gap.toFixed(2)}s] ${msg}`);
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
      // 原生 WiFi 入网过程的逐步日志。入网走 NEHotspotConfiguration，**一个字节都不经过
      // 蓝牙**，而协议日志只记 BLE 收发——不把这条通道接进来，这一段在日志上就是纯黑，
      // 只剩相邻两行之间莫名其妙的几十秒间隔。「系统里能连、App 里连不上」的证据全在这段里。
      mr20Emitter.addListener('onWifiLog', (d: any) =>
        this.log(`[wifi/ios] ${String(d?.msg ?? d)}`),
      ),
    );
  }

  private handleFrame(bytes: Uint8Array, charUuid = ''): void {
    const ascii = bytesToAscii(bytes);
    // OTA 期间把设备推上来的**每一帧**都记进 OTA 日志。否则「设备没应答」和
    // 「设备应答了但我们没认出来」在日志里长得一模一样，没法区分。
    if (this.otaTrace) {
      if (isCommandFrame(ascii)) {
        const text = ascii.replace(/\0+$/g, '');
        const rec = this.otaTrace.seen.get(text);
        if (rec) {
          rec.count += 1;
        } else {
          this.otaTrace.seen.set(text, {first: this.otaTrace.framesSent, count: 1});
          otaLog(`<= 设备帧「${text}」（第 ${this.otaTrace.framesSent} 帧后首次出现）`);
        }
        const parsed = parseDeviceMessage(ascii);
        if (parsed.type === 'OTA_ERR' || parsed.type === 'OTA_DONE') {
          // 还没发 OT&OVER 就收到结论帧——此刻没有 collector 在等，这条会被丢掉，
          // 之后我们会对着一个永远不会再来的应答干等 180 秒。记下来让发送循环提前收手。
          this.otaTrace.fatal = text;
          this.otaNativeAbort?.();
        } else if (parsed.type !== 'OTA_READY') {
          const t = this.otaTrace;
          t.strayTotal += 1;
          // 逐帧回话时两条应答之间只隔一个帧周期；录音中每秒一条的 RT 帧远在窗口之外，
          // 会把连击清零，不会被误判成异常。
          const now = Date.now();
          t.strayRun = now - t.lastStrayAt <= t.strayWindowMs ? t.strayRun + 1 : 1;
          t.lastStrayFrame = t.framesSent;
          t.lastStrayAt = now;
          if (t.strayRun >= OTA_STRAY_RUN_LIMIT) {
            this.otaNativeAbort?.();
          }
        }
      } else {
        this.otaTrace.nonCmd += 1;
        if (this.otaTrace.nonCmd <= 5) {
          const hex = Array.from(bytes.subarray(0, 8))
            .map(b => b.toString(16).padStart(2, '0'))
            .join(' ');
          otaLog(
            `<= 非命令帧 ${bytes.length}B [${hex}…] 来自 ${charUuid.slice(
              0,
              8,
            )}`,
            'warn',
          );
        }
      }
    }
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

  /**
   * OTA 事务自己要发的那几条指令（起始 / 结束）。除此之外的任何指令在 OTA 期间都会被拦下，
   * 见 write()：协议明确「OTA 过程中禁止 APP 发送其他指令，否则会 OTA 失败」。
   */
  private static isOtaOwnCommand(command: string): boolean {
    return (
      command.startsWith(`${CMD_PREFIX}&OTA&`) || // MCU / WiFi（OTA&WIFI&LEN）
      command.startsWith(`${CMD_PREFIX}&WIFI&OTA&`) || // WiFi 的 R43 拼法
      command === Cmd.otaOver()
    );
  }

  private async write(command: string): Promise<void> {
    // 请求-应答类指令都排在 txChain 上，OTA 独占该锁期间自然进不来；但 startRec /
    // setUsb / changeWifi 这类「发了不等应答」的指令不走锁，会直接插进 OTA 的写队列，
    // 而那正是协议禁止的事——一条就足以让整包固件白发。宁可让那个操作报错。
    if (this.otaTrace && !Mr20Client.isOtaOwnCommand(command)) {
      otaLog(
        `拦截 OTA 期间的其他指令「${command}」：协议禁止，放行会导致本次升级失败`,
        'warn',
      );
      throw new Error('设备正在升级固件，请等升级完成后再操作');
    }
    this.log(`=> ${command}`);
    // OTA 期间把下发的指令原文也记进 OTA 日志。此前只记设备回的帧，日志里看不到
    // 「GJJY_BLE&OTA&862720」「GJJY_BLE&OT&OVER」到底发没发、发的是什么，
    // 排查时只能靠翻代码确认，很容易被误判成漏发。
    if (this.otaTrace) {
      otaLog(`=> 下发指令「${command}」`);
    }
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
      // 和 setBindKey 一样截到 8 位。协议 0801：「PWD：8 位（超过 8 位取前 8 位）」——
      // 设备两边都会截，所以效果相同；但**发出去的字节必须一致**，否则日志里会出现
      // `SK&SeeMemoryMR20K01`（重连）和 `SK&SeeMemor`（配网）两种写法，排查时根本分不清
      // 到底哪一把才是设备上那把。真要有固件没照协议截断，不一致还会直接变成 SK&ERR。
      Cmd.bindKey(toDeviceKey(key)),
      m => m.type === 'SK_OK' || m.type === 'SK_ERR',
      WIFI_TIMING.SK_ACK_MS,
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

  /**
   * 查询 WiFi 状态码，取值见 {@link WifiState}。
   *
   * 解析不出来返回 -1（UNKNOWN）而**不是 0**：旧实现写 `parseInt(...) || 0`，设备回一个空的
   * `WIFIS&` 或非数字时会被当成「0=WiFi 已关闭」，openWifi 随即误判要补发 WIFIO——而协议明说
   * 反复开关会把 WiFi 模组搞卡。未知就当未知，交给状态机继续等。
   */
  async getWifiState(): Promise<number> {
    const m = await this.sendAndWait(
      Cmd.getWifiState(),
      x => x.type === 'WIFI_STATE',
    );
    if (m.type !== 'WIFI_STATE') {
      return WifiState.UNKNOWN;
    }
    const n = parseInt(m.state, 10);
    return Number.isFinite(n) ? n : WifiState.UNKNOWN;
  }

  /** 获取热点 SSID/密码。 */
  async getWifiCredentials(): Promise<{ssid: string; pwd: string}> {
    const m = await this.sendAndWait(Cmd.getWifi(), x => x.type === 'WIFI_CRED');
    return m.type === 'WIFI_CRED'
      ? {ssid: m.ssid, pwd: m.pwd}
      : {ssid: '', pwd: ''};
  }

  /**
   * 开热点并等到 AP 就绪，实现协议 0801「WiFi上传文件流程」第 1 步：
   * 发 WIFIO，然后每秒发 WIFIS 轮询，直到状态到 2（AP 起、无客户端）。
   * **只发 WIFIO + 轮询 WIFIS，绝不发 SK**。
   *
   * 注意：协议说「设备收到密钥后才自动配 WiFi 密码」，但本 App 走裸连探测(不发 SK)，且部分设备
   * 出厂预绑厂商密钥、对我们的密钥永远 SK&ERR（见 [[mr20-sk-binding-key]]）——**在此发 SK 会打断
   * 会话、把连接搞断**。所以这里坚决不发 SK；WiFi 能否开由设备侧决定，开不起来就如实报「末态 X」。
   *
   * 状态机（0801「WiFi功能使用」段落是各分支的依据）：
   *   1/2  AP 就绪 → 返回；调用方须在 30s 内连上，否则设备自动关（见 WIFI_TIMING）
   *   0/7  已关闭 → 发 WIFIO（节流 ≥6s，反复开关会把模组搞卡）
   *   3    等待开启 → 等；这也是设备自行复位时停的地方（约 6s）。**超过 12s 还在 3 就补一次
   *        WIFIO**：旧实现在 3 上从不重发，复位完没人再踢一脚就一直干等到超时，然后报
   *        「模组卡死请断电重启」——多数情况其实只是少发了一条 WIFIO。
   *   4/6  配密码周期（首连/重置后设备自动跑，4→6 约 8s，再 5s 自动关）→ **只能等**，
   *        协议明说 4/5/6 期间无法用指令关 WiFi。等它落到 0/7 后要**立刻**补发 WIFIO，
   *        故此处清零节流计时。
   *   5    OTA 中 → 直接抛错，别干等到超时。
   *   -1   WIFIS 无应答（BLE 忙）→ 等。
   *
   * 默认窗口 60s 而非 30s：最坏路径是「撞上配密码周期 8s + 自动关 5s + WIFIO 起热点 ~5s +
   * 模组复位 6s」，30s 根本包不住，真机上表现为「明明快开好了却报未就绪」。
   */
  async openWifi(opts: {maxWaitMs?: number} = {}): Promise<void> {
    const {maxWaitMs = 60000} = opts;
    const usable = (s: number) => s === WifiState.LINKED || s === WifiState.AP_IDLE;
    const deadline = Date.now() + maxWaitMs;
    let lastOpenAt = 0;
    let openingSince = 0; // 进入状态 3 的时刻，用于「卡 3 太久补发 WIFIO」
    let lastState: number = WifiState.UNKNOWN;
    let sawPwdCycle = false;
    while (Date.now() < deadline) {
      const s = await this.getWifiState().catch(() => WifiState.UNKNOWN);
      lastState = s;
      if (usable(s)) {
        this.log(`[wifi] 热点就绪（WIFIS=${s}），30s 内需完成入网`);
        return;
      }
      if (s === WifiState.OTA) {
        throw new Error('设备正在升级 WiFi 固件（WIFIS=5），请等升级完成后再用 WiFi 快传。');
      }
      if (s === WifiState.PWD_CHANGING || s === WifiState.PWD_DONE) {
        // 配密码周期无法打断；记下来并清零节流，等它一落到 0/7 就马上发 WIFIO。
        sawPwdCycle = true;
        lastOpenAt = 0;
        openingSince = 0;
      } else if (s === WifiState.OPENING) {
        if (openingSince === 0) {
          openingSince = Date.now();
        } else if (Date.now() - openingSince > WIFI_TIMING.RESET_MS * 2) {
          // 复位窗口（6s）都过去一倍了还在 3：多半是那条 WIFIO 丢了，补一发再等。
          this.log('[wifi] WIFIS 长时间停在 3，补发 WIFIO');
          openingSince = Date.now();
          lastOpenAt = Date.now();
          await this.sendAndWait(
            Cmd.wifiOpen(),
            x => x.type === 'WIFI_OPENED',
            3000,
          ).catch(() => undefined);
        }
      } else {
        openingSince = 0;
        // 只有明确的「关闭态」(0/7) 才发 WIFIO，节流 ≥6s——正常 WIFIO 约 4s 到 2。
        // -1（WIFIS 无应答）不发：那多半是 BLE 正忙，不是 WiFi 真关了，误发只会白折腾模组。
        if (
          (s === WifiState.OFF || s === WifiState.AUTO_OFF) &&
          Date.now() - lastOpenAt > 6000
        ) {
          lastOpenAt = Date.now();
          await this.sendAndWait(
            Cmd.wifiOpen(),
            x => x.type === 'WIFI_OPENED',
            3000,
          ).catch(() => undefined); // 个别固件不回 WIFIO，靠轮询兜底
        }
      }
      await new Promise<void>(resolve => setTimeout(() => resolve(), 1000));
    }
    if (lastState === WifiState.OPENING) {
      throw new Error(
        '设备 WiFi 模组卡在「等待开启」（WIFIS=3）——请将录音设备断电重启后再试。',
      );
    }
    if (sawPwdCycle) {
      throw new Error(
        `设备正在初始化 WiFi 密码（WIFIS=${lastState}），整个过程约需 15 秒，请稍候重试。`,
      );
    }
    // 其它末态便于定位：-1=WIFIS 无应答；0=发了 WIFIO 仍未开。
    throw new Error(`设备 WiFi 热点未就绪（末态 ${lastState}）`);
  }

  /**
   * 关热点，协议 0801 流程第 5 步。设备 30s 无连接也会自动关、BLE 一断也会关，故失败可容忍。
   *
   * 先查一次状态：协议明说**状态 4/5/6（配密码/OTA/待复位）时无法通过指令关闭 WiFi**，
   * 此时发 WIFIC 只会白等一次 4s 超时，还可能插在配密码周期中间干扰设备。
   */
  async closeWifi(): Promise<void> {
    const s = await this.getWifiState().catch(() => WifiState.UNKNOWN);
    if (s === WifiState.PWD_CHANGING || s === WifiState.OTA || s === WifiState.PWD_DONE) {
      this.log(`[wifi] WIFIS=${s}，协议规定此时无法关闭 WiFi，跳过 WIFIC`);
      return;
    }
    if (s === WifiState.OFF || s === WifiState.AUTO_OFF) {
      return; // 已经是关闭态，不用再折腾模组
    }
    await this.sendAndWait(
      Cmd.wifiClose(),
      x => x.type === 'WIFI_CLOSED',
      4000,
    ).catch(() => undefined);
  }

  /**
   * 发 `WIFI&CH` 后**每秒轮询 WIFIS，跟完整个改密周期**。协议 R33：MCU 对 WIFI&CH 不回包，
   * 命令有没有被接受、改完没有，只能从状态序列里读出来。
   *
   * 判读规则（依据 0801「WiFi功能使用」：状态 4 → 6，约 8 秒，再 5 秒后自动关闭复位）：
   *   见到 4 → 命令被接受（sawChanging）
   *   见到 6 → 明确改完（sawDone），周期结束
   *   进过 4 之后回落到 0/1/2/7 → 设备已复位重启 WiFi，同样算这一轮走完了
   *   全程没进过 4 → 设备根本没把它当改密命令
   *
   * 抽成一个方法是因为它有三个调用方（快传主路径的 provisionWifiPassword、WiFi 管理页的
   * initWifiPassword、配网自检），各写一份的话判读口径迟早会走偏——真机上这段状态序列
   * 本来就是唯一的证据来源，三处读法不一致等于三个不同的结论。
   */
  async awaitPwdSyncCycle(
    opts: {
      maxWaitMs?: number;
      /**
       * 「这么久还没进过状态 4 就别等了」。协议说整个周期约 8s、固件方说约 10s，所以超过这个
       * 时长仍未见 4，基本可判定该固件没实现 WIFI&CH，再等只是白站着。
       * 主路径要传（每次首连都白等满 30s 是实打实的体验损失）；自检不传，宁可等满看全序列。
       */
      bailIfNoChangeMs?: number;
      onState?: (s: number) => void;
    } = {},
  ): Promise<{seq: number[]; sawChanging: boolean; sawDone: boolean; lastState: number}> {
    const {maxWaitMs = 30000, bailIfNoChangeMs, onState} = opts;
    const startedAt = Date.now();
    const deadline = startedAt + maxWaitMs;
    const seq: number[] = [];
    let sawChanging = false;
    let sawDone = false;
    let lastState: number = WifiState.UNKNOWN;
    while (Date.now() < deadline) {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 1000));
      const s = await this.getWifiState().catch(() => WifiState.UNKNOWN);
      lastState = s;
      seq.push(s);
      onState?.(s);
      if (s === WifiState.PWD_CHANGING) {
        sawChanging = true;
      }
      if (s === WifiState.PWD_DONE) {
        sawDone = true;
        break;
      }
      if (
        sawChanging &&
        (s === WifiState.OFF ||
          s === WifiState.LINKED ||
          s === WifiState.AP_IDLE ||
          s === WifiState.AUTO_OFF)
      ) {
        break;
      }
      if (
        !sawChanging &&
        bailIfNoChangeMs !== undefined &&
        Date.now() - startedAt >= bailIfNoChangeMs
      ) {
        break;
      }
    }
    return {seq, sawChanging, sawDone, lastState};
  }

  /**
   * 快传主路径上的「配网初始化」：**先 SK 设密钥，再 WIFI&CH 把热点密码同步成这把密钥**。
   *
   * 这是固件方给的原话流程（2026-08-04）：「第一次发 SK 设置之后，发 BLE&WIFI&CH 初始化下
   * WiFi，WiFi 连接流程不变」，协议 SK&PWD 行也写着「后需发 GJJY_BLE&WIFI&CH 指令同步更改
   * WiFi 密码，需 10s 左右」。
   *
   * ⚠️ 这一步解释了之前那个反直觉的现象：设备 `WIFI` 指令自报的密码看着是对的（`SeeMemor`），
   * 拿去入网却一直「无法加入网络」。因为**自报的是 MCU 里存的值，WiFi 模组里生效的密码要等
   * WIFI&CH 才会被刷进去**——没跑过 WIFI&CH 的设备，这两个值根本不是一回事。
   *
   * 与 {@link initWifiPassword} 的分工：那个是 WiFi 管理页的显式操作，失败要抛错给用户看；
   * 这个是主路径上的前置步骤，**任何一步失败都只记日志不抛错**——SK 被拒/无应答时设备多半
   * 仍能用出厂密码连上，为一步没走通就断掉整次快传是因小失大。
   */
  async provisionWifiPassword(
    key: string,
    opts: {maxWaitMs?: number} = {},
  ): Promise<{sk: 'ok' | 'err' | 'timeout'; confirmed: boolean; lastState: number}> {
    const {maxWaitMs = 30000} = opts;
    const devKey = toDeviceKey(key);

    const sk = await this.setBindKey(devKey).catch(
      () => 'timeout' as const,
    );
    this.log(
      `[wifi] SK&${devKey} → ${
        sk === 'ok'
          ? 'SK&OK'
          : sk === 'err'
          ? 'SK&ERR'
          : '无应答（照样往下发 WIFI&CH，真正的判据是 WIFIS）'
      }`,
    );
    if (sk === 'err') {
      // 设备绑在另一把密钥上，此时 WIFI&CH 只会把热点密码同步成那把我们不知道的密钥，
      // 白等 10s 还把 WiFi 模组复位一遍。不如直接往下走，用设备自报的密码碰运气。
      this.log('[wifi] 设备已绑定其它密钥，跳过 WIFI&CH（同步过去我们也不知道那把密钥）');
      return {sk, confirmed: false, lastState: WifiState.UNKNOWN};
    }

    if (await this.isPwdCycleRunning()) {
      this.log('[wifi] 设备已经在自己跑改密周期（协议：重置后收到密钥会自动配密码），不补发 WIFI&CH');
    } else {
      this.log('[wifi] 发 WIFI&CH 同步热点密码（协议：约 10s，MCU 不回包，靠 WIFIS 判读）');
      await this.syncWifiPassword().catch(() => undefined);
    }
    const cycle = await this.awaitPwdSyncCycle({maxWaitMs, bailIfNoChangeMs: 12000});
    this.log(
      `[wifi] WIFIS 序列：${cycle.seq.join(' → ') || '（无）'}；${
        cycle.sawDone
          ? '出现 6，密码已改写'
          : cycle.sawChanging
          ? '出现过 4 未到 6，命令已被接受'
          : '全程未进 4，设备可能没实现 WIFI&CH'
      }`,
    );
    if (cycle.sawChanging || cycle.sawDone) {
      // 协议：状态 6 之后 5 秒自动关闭并复位。不等它走完就发 WIFIO，热点会被这次复位带走。
      this.log('[wifi] 等待 WiFi 模组复位…');
      await new Promise<void>(r => setTimeout(() => r(), WIFI_TIMING.RESET_MS));
    }
    return {sk, confirmed: cycle.sawDone || cycle.sawChanging, lastState: cycle.lastState};
  }

  /**
   * WiFi 管理页的「初始化热点密码」：把设备绑定密钥和热点密码都设成 `key`。
   *
   * 与主路径的 {@link provisionWifiPassword} 同一套指令（SK → WIFI&CH → 轮询 WIFIS），
   * 区别只在**这里每一步失败都抛错**，因为它是用户点出来的显式操作，需要看到失败原因。
   */
  async initWifiPassword(
    key: string,
    opts: {maxWaitMs?: number} = {},
  ): Promise<string> {
    const {maxWaitMs = 30000} = opts;
    const devKey = toDeviceKey(key);
    if (!isValidDeviceKey(devKey)) {
      throw new Error('WiFi 密码必须是 8 位英文字母或数字（不能含中文、空格）。');
    }

    // 第 1 步：设密钥。SK&ERR 说明被别的密钥绑了，此时设备未做任何改动 —— 只有这一种是硬失败。
    // 无应答**不算失败**：固件方说这条应答本来就要 10s 左右，而且设备收到密钥后是靠自动跑
    // 一轮改密（WIFIS 4 → 6）来生效的，那一轮才是真正的判据。这里提前抛错，等于把一次
    // 可能已经成功的配网当场判死。
    const sk = await this.setBindKey(devKey);
    if (sk === 'err') {
      throw new Error(
        '设备拒绝了新密钥（SK&ERR）——它已被另一把密钥绑定（多为出厂预绑）。' +
          '请先用「重置设备密钥」解绑（会断开蓝牙，需重新连接），再重新设置。',
      );
    }
    this.log(
      sk === 'ok'
        ? '[wifi] SK&OK，绑定密钥已设置，开始同步热点密码'
        : '[wifi] SK 无应答，仍按协议发 WIFI&CH，用 WIFIS 判断密钥到底进没进去',
    );

    // 第 2 步：同步热点密码。MCU 不回包，直接写，随后轮询 WIFIS。
    // 设备已经在自己跑改密周期时不补发（见 isPwdCycleRunning）。
    if (await this.isPwdCycleRunning()) {
      this.log('[wifi] 设备已在自己跑改密周期，不补发 WIFI&CH，等它跑完');
    } else {
      await this.syncWifiPassword();
    }
    const cycle = await this.awaitPwdSyncCycle({maxWaitMs});
    if (cycle.sawDone) {
      this.log('[wifi] WIFIS=6，热点密码已同步，设备将复位');
      return devKey;
    }
    if (cycle.sawChanging) {
      return devKey; // 进过改密态又回落 = 设备已复位重启 WiFi，视为已应用
    }
    // 密钥确实已经写进设备了（SK&OK），只是没看到 4/6 那一段。协议说设备收到密钥后会自动
    // 配 WiFi 密码，所以大概率已生效——如实说明「未确认」，但上层仍应把密钥存下来别丢。
    throw new Error(
      `密钥已设置成功，但没等到设备确认热点密码已同步（末态 ${cycle.lastState}，未进入修改态）。` +
        '密码已按新值保存，可稍等约 10 秒后重新开启热点试连；若仍连不上请再执行一次。',
    );
  }

  /**
   * 只发 `SK&<8位>` 设绑定密钥，返回设备的原始反馈。
   * 与 {@link syncWifiPassword} 拆开，是为了让配网自检能分步观察每条指令的结果——
   * 「SK 通没通」和「WIFI&CH 生没生效」是两个完全不同的故障点，合在一起就分不出来了。
   */
  async setBindKey(
    key: string,
    timeoutMs = WIFI_TIMING.SK_ACK_MS,
  ): Promise<'ok' | 'err' | 'timeout'> {
    const startedAt = Date.now();
    const m = await this.sendAndWait(
      Cmd.bindKey(toDeviceKey(key)),
      x => x.type === 'SK_OK' || x.type === 'SK_ERR',
      timeoutMs,
    ).catch((e: Error) => {
      // 这里以前是 `.catch(() => null)`，把「等满了没等到」和「链路当场断了 / 写失败」
      // 压成同一个 timeout。真机日志因此出现过极具误导性的一行：发完 SK **0.2 秒**就
      // 报「设备对 SK 完全不应答」——根本没等，却读起来像等够了。原因必须留在日志里。
      const dt = ((Date.now() - startedAt) / 1000).toFixed(1);
      this.log(`[wifi] SK 没拿到应答（等了 ${dt}s）：${String(e?.message || e)}`);
      return null;
    });
    if (!m) {
      return 'timeout';
    }
    return m.type === 'SK_OK' ? 'ok' : 'err';
  }

  /** 只发 `WIFI&CH`（无参）让设备把热点密码同步成 SK 密钥。MCU 不回包，结果靠轮询 WIFIS。 */
  async syncWifiPassword(): Promise<void> {
    await this.write(Cmd.syncWifiPassword());
  }

  /**
   * 发 `WIFI&CH` 之前先看一眼 WIFIS：设备可能已经在自己跑改密周期了，这时候别再补一条。
   *
   * 协议「WiFi功能使用」段：**「设备首次连接 APP 或者重置后连接 APP，设备接收到密钥后，
   * 会自动打开 WiFi 并设置 WiFi 密码，WiFi 状态为 '4'，设置密码成功后状态为 '6'」**。
   * 也就是说**刚重置过的设备，一条 SK 就足以触发改密**，`WIFI&CH` 是给「已经绑好、事后要
   * 改密码」那条路准备的显式触发器。这同时解释了 SK 的应答为什么要等 10s——设备是把这一轮
   * 跑完才回话的。
   *
   * 往一个正在跑的周期里插命令没有好处：协议还写明状态 4/5/6 期间连关 WiFi 的指令都不生效。
   * 返回 true 表示「设备已经在改了，让它跑完就行」。
   */
  async isPwdCycleRunning(): Promise<boolean> {
    const s = await this.getWifiState().catch(() => WifiState.UNKNOWN);
    return s === WifiState.PWD_CHANGING || s === WifiState.PWD_DONE;
  }

  /**
   * 重置设备绑定密钥（`SK&RESET`）。协议：「如连接将断开连接，后需用 SK&PWD 重新设置密钥」。
   * 设备不回应答且会当场断链，所以只写不等——由上层负责提示用户重新连接。
   *
   * ⚠️ 别和 {@link factoryReset}（`BLE&RESET`）搞混：那条协议写明「断开 BLE 连接，**格式化磁盘**」，
   * 会把设备上的录音全部抹掉。两条命令只差一个字段，这里只发 `SK&RESET`。
   */
  async resetDeviceKey(): Promise<void> {
    await this.write(Cmd.resetKey());
    // 协议表这一行的「设备发给APP」两列是空的，本来就没有应答；而且它的作用就是断链，
    // 应答也无从回来。日志里发完这条就没下文是**正常**的——写一句免得下次对着空白纳闷。
    this.log('[wifi] SK&RESET 无应答（协议未定义），设备会就此断开蓝牙');
  }

  /** 当前连着的设备（重连用）。SK&RESET 会断链，断完要靠它把同一台连回来。 */
  get currentDevice(): Mr20Device | null {
    return this.device;
  }

  /**
   * 等设备**自己**把链路断掉，最多 `timeoutMs`。返回 true 表示确实断了。
   * 用来验证 SK&RESET 这类「没有应答、唯一后果就是断链」的命令到底有没有被执行。
   */
  private waitForDisconnect(timeoutMs: number): Promise<boolean> {
    if (this.connState === 'disconnected' || this.connState === 'idle') {
      return Promise.resolve(true);
    }
    return new Promise<boolean>(resolve => {
      const finish = (v: boolean) => {
        clearTimeout(timer);
        off();
        resolve(v);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      const off = this.on('stateChange', s => {
        if (s === 'disconnected' || s === 'idle') {
          finish(true);
        }
      });
    });
  }

  /**
   * 「重置密钥 → 重连」：发 `SK&RESET`，等设备把链路断掉，再把同一台重新连回来。
   *
   * 为什么要重连：协议 SK&RESET 行写着「如连接将断开连接，后需用 GJJY_BLE&SK&PWD 重新设置密钥」
   * ——**重新设密钥必须在新的一次 BLE 连接里**（SK&PWD 行：「BLE 连接之后第一次发送为设置密钥」）。
   * 在旧链路上接着发 SK 是发不出去的，设备那头已经断了。
   *
   * 重连后不发任何密钥：密钥刚被清掉，此时设备应当对裸连指令开放，用 {@link probe} 确认。
   *
   * ⚠️ **「GATT 连上了」远不等于「固件能应答了」。** SK&RESET 之后设备要重启一段时间，而
   * CoreBluetooth 只要对方在广播就会把 connect 兑现、把特征发现完 —— 真机上见过 connect 只花
   * 1.3s 就回来，紧接着 FW 连等 8s 都没回音，日志写成「蓝牙链路本身不通」，完全误导。
   * 所以这里**反复探测直到设备真的开口**，而不是连上就算数、只打一枪。
   *
   * 返回 `droppedByDevice`（设备自己断没断，见下）与 `ready`（重连后有没有应答）。
   */
  async resetDeviceKeyAndReconnect(
    opts: {
      onLog?: (msg: string) => void;
      /**
       * 断链之后等多久再去重连。真机观察：`SK&RESET` 之后设备指示灯**闪 3 秒**才重新起来，
       * 所以 3000 正好卡在它自我复位的最后一刻——这时候 connect 很可能连上的是还没退干净的
       * 旧广播，GATT 是通的、固件却没启动完。留够余量，宁可多等 2 秒。
       */
      settleMs?: number;
      /** 重连后等设备「开口」的总时长。设备重启慢，这个要给够。 */
      readyWaitMs?: number;
      /** 发完 SK&RESET 后，观察设备自己断不断链的时长。断没断是这条命令唯一的可观测后果。 */
      observeMs?: number;
    } = {},
  ): Promise<{droppedByDevice: boolean; ready: boolean}> {
    const {onLog, settleMs = 5000, readyWaitMs = 20000, observeMs = 4000} = opts;
    const say = (m: string) => {
      onLog?.(m);
      this.log(`[wifi] ${m}`);
    };
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(() => r(), ms));
    const dev = this.device;
    if (!dev) {
      throw new Error('当前没有已连接的设备，无法重置密钥。');
    }

    say('发 GJJY_BLE&SK&RESET 重置绑定密钥（无应答，协议说设备会当场断开蓝牙）');
    // 走 resetDeviceKey 而不是自己 write：这条命令只该在一个地方构造。
    await this.resetDeviceKey().catch(() => undefined);

    // 先**看设备自己断不断**，再决定要不要我们动手。
    //
    // 这条命令没有应答，协议给的唯一可观测后果就是「如连接将断开连接」——那么断没断，
    // 本身就是「这条命令有没有被执行」的唯一证据。早先不管三七二十一先 disconnect()，
    // 等于亲手把这个证据擦掉了：设备明明没理这条命令，日志看起来却和执行了一模一样。
    const droppedByDevice = await this.waitForDisconnect(observeMs);
    if (droppedByDevice) {
      say('设备按协议主动断开了蓝牙 —— 这条命令确实被执行了');
    } else {
      say(
        `等了 ${(observeMs / 1000).toFixed(0)}s 设备没有断开。协议写明「如连接将断开连接」，` +
          '没断说明固件很可能忽略了这条命令（协议：密钥绑定功能默认关闭，需改固件打开）',
      );
      await this.disconnect().catch(() => undefined);
    }
    say(`等待设备复位 ${(settleMs / 1000).toFixed(0)}s 后重连…`);
    await sleep(settleMs);

    // 原生 connect 要求设备还在扫描缓存里（`discovered[id]`）。设备重启后广播地址不变，
    // 缓存通常还在；万一被系统清了就补一次扫描，别直接把「重置完连不回来」甩给用户。
    try {
      await this.connect(dev.id, dev.name);
    } catch (e) {
      say(`直连失败（${String((e as Error)?.message || e)}），补一次扫描再连…`);
      await this.startScan().catch(() => undefined);
      await sleep(4000);
      this.stopScan();
      await this.connect(dev.id, dev.name);
    }
    // 「连上了」在这里只意味着**系统蓝牙层握完手、特征也发现完了**，不代表设备那边的程序
    // 已经跑起来能回话——重启中的设备照样在广播，iOS 照样连得上。这两件事必须在日志里
    // 说成两句话：真机上就出现过 connect 只花 1.3s 就回来、紧接着 FW 等 8s 没回音，
    // 于是被写成「蓝牙链路本身不通」的误报。
    say('蓝牙已连上（系统层握手完成，还不代表设备程序起来了），开始逐次探测它能不能回话…');

    const deadline = Date.now() + readyWaitMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt += 1;
      if (await this.probe().catch(() => false)) {
        this.markConnected();
        say(`第 ${attempt} 次探测有应答，设备已就绪（密钥已清空）`);
        return {droppedByDevice, ready: true};
      }
      say(`第 ${attempt} 次探测无应答，设备大概还在重启，继续等…`);
      await sleep(1500);
    }
    // 不 markConnected：状态留在 pairing，紧接着的 SK 才是真正的握手。
    say(`等了 ${(readyWaitMs / 1000).toFixed(0)}s 仍无应答 —— 直接发 SK 试试`);
    return {droppedByDevice, ready: false};
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

  /**
   * 直接发送原始字节帧（OTA 固件数据）。不做 GJJY ASCII 封装，仅 bytes->base64 写入写特征。
   * 一律无应答写（ATT Write Command）——协议文档描述的就是这一种，固件方也只按这种收。
   */
  private async writeRaw(bytes: Uint8Array): Promise<void> {
    const b64 = bytesToBase64(bytes);
    await Mr20Native.writeNoResponse(MR20_UUID.service, MR20_UUID.write, b64);
  }

  /**
   * 写一帧并加超时兜底。原生的无响应写在队列满时会挂起等 peripheralIsReady，
   * 若那次唤醒因任何原因没来（历史上出现过丢唤醒的竞态），promise 既不 resolve
   * 也不 reject，OTA 会永远停在某个百分比。宁可超时报错让用户重试。
   */
  private async writeRawWithTimeout(
    bytes: Uint8Array,
    timeoutMs: number,
    label: string,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 超时胜出时这条仍挂在原生的 pendingWrite 里，之后无论成败都没人接——
    // 拒绝会变成未处理拒绝（真机上见过一条飘出来的红屏错误）。先吞掉。
    const write = this.writeRaw(bytes);
    write.catch(() => undefined);
    try {
      await Promise.race([
        write,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `${label} 写入超时（${timeoutMs}ms 无响应），蓝牙链路可能已断`,
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * 设备在数据阶段自曝已不在 OTA 接收态时抛出对应的错误；正常则返回。
   * 两条发送路径（原生定时器 / JS 循环）共用，措辞必须一致——这两句是排障时最常被引用的。
   */
  private throwIfDeviceBailed(trace: OtaTrace, frameCount: number): void {
    if (trace.fatal) {
      otaLog(
        `设备在数据阶段（第 ${trace.framesSent}/${frameCount} 帧）就回了「${trace.fatal}」，已提前终止`,
        'error',
      );
      throw new Error(
        '设备在固件传输途中就报了结束，未收完数据。请断电重启设备后重试',
      );
    }
    if (trace.strayRun >= OTA_STRAY_RUN_LIMIT) {
      const worst = [...trace.seen.entries()].sort(
        (a, b) => b[1].count - a[1].count,
      )[0];
      const from = Math.max(1, trace.framesSent - trace.strayRun + 1);
      otaLog(
        `设备从第 ${from}/${frameCount} 帧起对固件数据逐帧回话` +
          `（连续 ${trace.strayRun} 条，最多的是「${worst?.[0] ?? '?'}」），` +
          '它已不在 OTA 接收态，继续发送无意义，已提前终止',
        'error',
      );
      throw new Error(
        `设备在第 ${from}/${frameCount} 帧掉出 OTA 接收状态：` +
          `此后把固件数据当成指令逐帧回「${worst?.[0] ?? '未知帧'}」。` +
          '请断电重启设备后重试；若仍停在同一位置，需固件侧确认 MCU OTA 流程',
      );
    }
  }

  /**
   * 把整个固件交给原生，由 GCD 定时器按 periodMs **严格**打点发送，不等任何一帧写入完成。
   *
   * 这是生产路径。JS 侧在此期间只做两件事：收 onOtaProgress 更新进度、盯着设备有没有
   * 中途乱回话（有就调 otaAbort 掐掉定时器）。3536 次过桥变成 1 次，节奏与 JS 线程忙不忙无关。
   */
  private async otaSendFramesNative(
    bin: Uint8Array,
    frameSize: number,
    periodMs: number,
    frameCount: number,
    trace: OtaTrace,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    const total = bin.length;
    let nextMark = 10;
    const startedAt = Date.now();
    const sub = mr20Emitter.addListener('onOtaProgress', (d: any) => {
      const sent = Math.min(Number(d?.sent) || 0, total);
      // 帧号是按进度反推的粗值（每 1% 才回一次），只用于日志里的「第几帧」。
      trace.framesSent = Math.ceil(sent / frameSize);
      onProgress?.(sent, total);
      const pct = Math.floor((sent / total) * 100);
      if (pct >= nextMark) {
        otaLog(
          `已发送 ${pct}%（${sent}/${total} 字节，耗时 ${(
            (Date.now() - startedAt) /
            1000
          ).toFixed(1)}s）`,
        );
        nextMark = Math.floor(pct / 10) * 10 + 10;
      }
    });
    // 设备中途乱回话时 handleFrame 会调它，把原生定时器掐掉——否则要白发满两分钟。
    this.otaNativeAbort = () => {
      Mr20Native.otaAbort().catch(() => undefined);
    };
    try {
      const r = await Mr20Native.otaSendFrames(
        MR20_UUID.service,
        MR20_UUID.write,
        bytesToBase64(bin),
        frameSize,
        periodMs,
      );
      trace.framesSent = Number(r?.frames) || frameCount;
      trace.periods = Math.max(0, trace.framesSent - 1);
      trace.maxPeriodMs = Math.round(Number(r?.maxPeriodMs) || 0);
      trace.periodMs = (Number(r?.avgPeriodMs) || 0) * trace.periods;
      const avg = Number(r?.avgPeriodMs) || 0;
      const notReady = Number(r?.notReady) || 0;
      otaLog(
        `固件帧发送完毕（${(Number(r?.elapsedMs) / 1000).toFixed(1)}s，原生定时器）：` +
          `${trace.framesSent} 帧，实测帧周期平均 ${avg.toFixed(1)}ms` +
          `（设定 ${periodMs}ms，最大 ${trace.maxPeriodMs}ms）`,
      );
      if (notReady > 0) {
        // 这是唯一能看见「iOS 可能没把帧发出去」的信号：发这些帧时本机发送队列已满。
        // 按约定我们照发不误，不为它放慢节奏——但它必须出现在日志里，否则丢包无从解释。
        otaLog(
          `其中 ${notReady}/${trace.framesSent} 帧在本机发送队列已满时发出` +
            `（占 ${((notReady / Math.max(1, trace.framesSent)) * 100).toFixed(1)}%）：` +
            '这些帧可能被 iOS 控制器丢弃。若设备回 OT&ERR 且此数很大，说明链路吃不下当前速率',
          'warn',
        );
      }
    } catch (e) {
      // 原生因中止/断连而 reject 时，真正的原因在 trace 里（设备乱回话/提前结束）。
      this.throwIfDeviceBailed(trace, frameCount);
      throw e;
    } finally {
      sub.remove();
      this.otaNativeAbort = null;
    }
    this.throwIfDeviceBailed(trace, frameCount);
  }

  /**
   * JS 逐帧发送——仅用于没有原生定时发帧的旧二进制。
   *
   * 按截止时刻倒扣着睡（写入耗时算进周期里），已经是纯 JS 能做到的最好水平，
   * 但 setTimeout 精度 + 桥往返决定了真实周期仍会飘到 25~35ms，做不到严格 20ms。
   */
  private async otaSendFramesJs(
    bin: Uint8Array,
    frameSize: number,
    periodMs: number,
    frameCount: number,
    trace: OtaTrace,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    const total = bin.length;
    let sent = 0;
    let nextMark = 10;
    const sendStartedAt = Date.now();
    // 下一帧「应当开始写」的时刻，以及 setTimeout 的滚动超调估计（见常量注释）。
    let dueAt = sendStartedAt;
    let timerBias = 0;
    let prevFrameAt = 0;
    for (let off = 0; off < total; off += frameSize) {
      // 等到本帧的截止时刻再写。剩余时间已扣掉上一帧的写入耗时和定时器超调，
      // 所以设备看到的是尽量贴近 periodMs 的周期，而不是「写完再睡 periodMs」。
      if (periodMs > 0) {
        const want = dueAt - Date.now();
        if (want > 0) {
          const ask = Math.max(0, want - timerBias);
          const sleepAt = Date.now();
          await new Promise<void>(resolve => setTimeout(() => resolve(), ask));
          const slept = Date.now() - sleepAt;
          trace.sleptMs += slept;
          trace.gaps += 1;
          if (ask > 0) {
            timerBias = Math.min(
              OTA_TIMER_BIAS_MAX_MS,
              Math.max(0, timerBias * 0.7 + (slept - ask) * 0.3),
            );
          }
        }
      }
      const frameAt = Date.now();
      if (prevFrameAt) {
        const period = frameAt - prevFrameAt;
        trace.periodMs += period;
        trace.periods += 1;
        if (period > trace.maxPeriodMs) {
          trace.maxPeriodMs = period;
        }
        if (periodMs > 0 && period > periodMs + OTA_PERIOD_SLACK_MS) {
          trace.overBudget += 1;
        }
      }
      prevFrameAt = frameAt;
      // 下一帧的截止时刻。落后时不做「补发」——落后的原因是写入本身耗时，
      // 硬追只会连发几帧把间隔挤到协议下限 8ms 以下，反而更容易丢包。
      dueAt = Math.max(frameAt, dueAt) + periodMs;
      const frame = bin.subarray(off, Math.min(off + frameSize, total));
      const idx = Math.floor(off / frameSize) + 1;
      // 固件方反馈「收到的帧长不是 244」，这里把 App 侧实际写出的长度钉死：
      // 除最后一帧外必须整 244，不满即中止，别让长度问题混在别的现象里。
      if (frame.length !== frameSize && off + frameSize < total) {
        throw new Error(
          `第 ${idx}/${frameCount} 帧长度 ${frame.length} ≠ ${frameSize}，已中止`,
        );
      }
      if (idx === 1 || idx === frameCount) {
        otaLog(`第 ${idx}/${frameCount} 帧实际写出 ${frame.length} 字节`);
      }
      const wroteAt = Date.now();
      await this.writeRawWithTimeout(
        frame,
        OTA_FRAME_WRITE_TIMEOUT_MS,
        `第 ${idx}/${frameCount} 帧`,
      );
      const blocked = Date.now() - wroteAt;
      trace.writeMs += blocked;
      if (blocked >= OTA_SLOW_WRITE_LOG_MS) {
        trace.stalls += 1;
        if (trace.stalls <= 40) {
          otaLog(
            `第 ${idx}/${frameCount} 帧写入耗时 ${blocked}ms（本机发送队列满，等它腾空）`,
            'warn',
          );
        }
      }
      sent += frame.length;
      trace.framesSent += 1;
      onProgress?.(sent, total);
      this.throwIfDeviceBailed(trace, frameCount);
      // 帧级日志量太大，每 10% 打一条即可定位卡死位置。
      const pct = Math.floor((sent / total) * 100);
      if (pct >= nextMark) {
        otaLog(
          `已发送 ${pct}%（${sent}/${total} 字节，耗时 ${(
            (Date.now() - sendStartedAt) /
            1000
          ).toFixed(1)}s）`,
        );
        nextMark = Math.floor(pct / 10) * 10 + 10;
      }
      // 帧间等待放在循环开头（按截止时刻倒扣），这里不再补睡——最后一帧后也无需再等。
    }
    const avgPeriod = trace.periodMs / Math.max(1, trace.periods);
    otaLog(
      `固件帧发送完毕（${((Date.now() - sendStartedAt) / 1000).toFixed(
        1,
      )}s，JS 兜底）：${trace.framesSent} 帧，实测帧周期平均 ${avgPeriod.toFixed(
        1,
      )}ms（设定 ${periodMs}ms，最大 ${trace.maxPeriodMs}ms，` +
        `超出 ${periodMs + OTA_PERIOD_SLACK_MS}ms 的有 ${trace.overBudget} 帧）；` +
        `其中平均写入 ${(
          trace.writeMs / Math.max(1, trace.framesSent)
        ).toFixed(1)}ms/帧，帧间休眠 ${trace.gaps} 次、平均 ${(
          trace.sleptMs / Math.max(1, trace.gaps)
        ).toFixed(1)}ms`,
    );
    if (periodMs > 0 && avgPeriod > periodMs + OTA_PERIOD_SLACK_MS) {
      otaLog(
        `实测帧周期 ${avgPeriod.toFixed(1)}ms 超过设定的 ${periodMs}ms：` +
          'JS 路径已无法再压缩，需用带原生定时发帧的新二进制',
        'warn',
      );
    }
  }

  /**
   * MCU OTA 升级。协议 R42/R44/R61：
   *   1. 发 `OTA&<LEN 6位>` → 等 `DEV&OTA` 就绪；
   *   2. 按 244 字节/帧发送固件原始字节，帧首到帧首严格 20ms（协议下限 8ms、iOS 建议 20ms），
   *      **不等任何一帧写入完成**——这一步整个下沉到原生定时器，见 otaSendFramesNative；
   *   3. 发完 `OT&OVER` → 等 `DEV&OT&OVER`（成功）/ `OT&ERR`（失败）。
   *      OT&OVER 与数据帧走同一条无应答写队列，链路层 FIFO 保证它排在所有数据帧之后。
   *
   * 成功后设备自行复位（BLE 断开是预期的）。
   */
  async otaUpdateMcu(
    bin: Uint8Array,
    opts: {
      onProgress?: (sent: number, total: number) => void;
      frameSize?: number;
      frameIntervalMs?: number;
    } = {},
  ): Promise<void> {
    return this.otaRun(bin, opts, {
      label: 'MCU',
      startCommand: len => Cmd.otaStart(len),
    });
  }

  /**
   * WiFi 模组 OTA 升级。协议 R62——前三步与 MCU **完全一样**，只有起始指令换成
   * `OTA&WIFI&<LEN 6位>`，外加第 4 步：
   *   4. 设备回 `DEV&OT&OVER` 只代表**数据收全了**，此后模组才开始真正烧写，
   *      期间推 `WIFIS&5`（状态 5=OTA 中），烧完回落 `WIFIS&0`；烧写失败推 `OW&ERR`。
   *
   * 注意 `OT&ERR` 与 `OW&ERR` 是两回事：前者「数据没收全」（重发有用），
   * 后者「收全了但刷进模组时挂了」（重发同一个包多半还是挂，得查固件包本身）。
   *
   * ⚠️ 起始指令的拼法在两版协议里自相矛盾（见 Cmd.otaWifiStart 的注释）。
   * 真机若对 `OTA&WIFI&LEN` 不回 `DEV&OTA`，换 `Cmd.otaWifiStartAlt` 再试。
   */
  async otaUpdateWifi(
    bin: Uint8Array,
    opts: {
      onProgress?: (sent: number, total: number) => void;
      frameSize?: number;
      frameIntervalMs?: number;
      /** 起始指令用 R43 命令表的另一种拼法（WIFI&OTA&LEN），供真机对拍。 */
      useAltStartCommand?: boolean;
    } = {},
  ): Promise<void> {
    const {useAltStartCommand = false} = opts;
    return this.otaRun(bin, opts, {
      label: 'WiFi 模组',
      startCommand: len =>
        useAltStartCommand ? Cmd.otaWifiStartAlt(len) : Cmd.otaWifiStart(len),
      startTailWatch: () => this.watchWifiModuleFlash(),
    });
  }

  /**
   * 协议 R62 第 4/5 步：等 WiFi 模组把固件烧进去。
   *
   * 判据必须是「先见 5、再见 0」而不是「见到 0」：0 是模组的静息态（0=关），
   * 烧写还没开始时它本来就可能是 0，只认 0 会在设备还没动手时就报成功。
   *
   * 全程只听不发。协议写死「OTA 过程中禁止 APP 发送其他指令，否则会 OTA 失败」，
   * 所以这里不轮询 WIFIS——哪怕代价是设备不推送时只能等到超时。
   */
  private watchWifiModuleFlash(): {
    done: Promise<void>;
    cancel: (err: Error) => void;
  } {
    let sawFlashing = false;
    const startedAt = Date.now();
    // reducer 里**不能抛**：collectors 是在通知回调里裸调的（onDeviceMessage 无 try），
    // 抛出去会掀掉整个通知处理、后面的 collector 也收不到消息。失败一律走 cancel 拒绝。
    let failWith: ((err: Error) => void) | null = null;
    const {promise, cancel} = this.collect<void>(msg => {
      if (msg.type === 'WIFI_OTA_ERR') {
        otaLog('设备回 OW&ERR：数据已收全，但刷写 WiFi 模组失败', 'error');
        failWith?.(
          new Error(
            '设备已收全固件数据，但刷写 WiFi 模组时失败（OW&ERR）。' +
              '数据是完整的，重发同一个包多半仍会失败——请确认该固件包确实是 WiFi 模组的固件',
          ),
        );
        return {done: false};
      }
      if (msg.type !== 'WIFI_STATE') {
        return {done: false};
      }
      const state = parseInt(msg.state, 10);
      if (state === 5) {
        if (!sawFlashing) {
          sawFlashing = true;
          otaLog(
            `WiFi 模组开始烧写（WIFIS&5，OT&OVER 后 ${Date.now() - startedAt}ms），等它回落到 0`,
          );
        }
        return {done: false};
      }
      // 回落到 0 才算烧完；没见过 5 之前的 0 是静息态，忽略。
      if (state === 0 && sawFlashing) {
        return {done: true, value: undefined};
      }
      return {done: false};
    }, OTA_WIFI_FLASH_TIMEOUT_MS);
    failWith = cancel;
    // 这个监听器在发 OT&OVER 之前就挂上，但要等 OT&OVER 有结果后才被 await。
    // 中间这段窗口里若它先失败（如提前收到 OW&ERR），没人接住就是一条未处理拒绝。
    promise.catch(() => undefined);
    return {done: promise, cancel};
  }

  /**
   * 两种 OTA 的共同流程，差异由 plan 描述（见 OtaPlan）。
   *
   * 全程 `runExclusive` 独占 BLE 串行锁：协议明确「OTA 期间禁发其他指令，否则会 OTA 失败」。
   * LEN 固定 6 位 → 固件必须 ≤999999 字节（≈1MB）。
   * 传输中断/校验失败会使设备卡在 OTA 等待态，需断电重启——故失败文案提示重启。
   */
  private async otaRun(
    bin: Uint8Array,
    opts: {
      onProgress?: (sent: number, total: number) => void;
      frameSize?: number;
      frameIntervalMs?: number;
    },
    plan: OtaPlan,
  ): Promise<void> {
    const {onProgress, frameSize = 244, frameIntervalMs = 20} = opts;
    const total = bin.length;
    if (total <= 0) {
      otaLog('固件为空，拒绝下发', 'error');
      throw new Error('固件为空');
    }
    if (total > 999999) {
      otaLog(`固件 ${total} 字节超出协议上限，拒绝下发`, 'error');
      throw new Error(
        '固件超过 1MB（协议 OTA LEN 6 位上限），无法通过 BLE OTA 下发',
      );
    }
    const frameCount = Math.ceil(total / frameSize);
    return this.runExclusive(async () => {
      const trace = {
        framesSent: 0,
        nonCmd: 0,
        seen: new Map<string, {first: number; count: number}>(),
        strayTotal: 0,
        strayRun: 0,
        lastStrayFrame: -99,
        lastStrayAt: 0,
        // 连击窗口取 3 个帧周期（至少 60ms）：逐帧回话落在窗内，每秒一条的 RT 帧落在窗外。
        strayWindowMs: Math.max(60, frameIntervalMs * 3),
        stalls: 0,
        // 各段耗时分开记（字段说明见 OtaTrace）：设备端只回一句成功/失败，
        // 「是不是发得太慢」全靠收尾日志里的实测周期说话，只靠总耗时反推没人信。
        writeMs: 0,
        sleptMs: 0,
        gaps: 0,
        periodMs: 0,
        periods: 0,
        maxPeriodMs: 0,
        overBudget: 0,
        fatal: null as string | null,
      };
      this.otaTrace = trace;
      try {
        // 帧长必须 ≤ 协商 MTU：超了会被 CoreBluetooth 静默截断，设备收不满 LEN，
        // 表现为「App 进度 100% 但设备立刻回 OT&ERR」。宁可发前就报错。
        try {
          const {withoutResponse} = await Mr20Native.maxWriteLength();
          otaLog(
            `当前连接单帧可写上限 ${withoutResponse} 字节（需 ≥ ${frameSize}）`,
          );
          if (withoutResponse > 0 && withoutResponse < frameSize) {
            otaLog(
              `MTU 不足：单帧 ${frameSize}B 会被截断成 ${withoutResponse}B，设备必然收不满，已终止`,
              'error',
            );
            throw new Error(
              `蓝牙 MTU 不足（单帧上限 ${withoutResponse} 字节 < 协议要求的 ${frameSize} 字节），` +
                '请断开重连设备后重试；若持续如此需固件侧提高 MTU',
            );
          }
        } catch (e) {
          // 旧二进制没有 maxWriteLength 方法，此时只记录、不阻断。
          if ((e as Error)?.message?.includes('MTU 不足')) {
            throw e;
          }
          otaLog(
            `无法读取 MTU 上限（原生未提供，需重新构建）：${String(
              (e as Error)?.message || e,
            )}`,
            'warn',
          );
        }
        // 数据帧一律走无应答写（ATT Write Command），这是协议文档描述的形态，
        // 也是固件方 2026-08-02 明确要求的「每次只发 244 字节 bin 数据」。
        //
        // 曾改成带应答写（ATT Write Request）试图排除丢包，结果固件方日志里每帧长度
        // 变成 65527、累计收到两百多 M——它们的接收侧根本没按预期路径拿到长度。
        // 带应答写是我们自己加的变量，先去掉，别再往链路里塞文档没写的东西。
        try {
          const info = await Mr20Native.characteristicInfo(
            MR20_UUID.service,
            MR20_UUID.write,
          );
          otaLog(
            `写特征 ${MR20_UUID.write} 属性 ${info.properties}，` +
              `无应答单帧上限 ${info.maxWithoutResponse}B`,
          );
          if (!info.writeWithoutResponse) {
            otaLog(
              '写特征不支持无应答写（writeWithoutResponse），OTA 无法按协议进行',
              'error',
            );
            throw new Error(
              `写特征不支持无应答写（当前属性：${info.properties}），无法进行 OTA`,
            );
          }
        } catch (e) {
          if ((e as Error)?.message?.includes('无应答写')) {
            throw e;
          }
          otaLog(
            `读取写特征属性失败（不阻断）：${String((e as Error)?.message || e)}`,
            'warn',
          );
        }
        // 节奏照文档给的来：「每帧数据至少间隔 8MS 以上，IOS 建议 20MS」。
        // 注意这是**帧首到帧首的周期**：写一帧本身要过 RN 桥，那段时间也算在 20ms 里，
        // 不能写完再睡满 20ms（那样真实周期 = 写入 + 20ms + 定时器超调，必然超）。
        const periodMs = frameIntervalMs;

        // 1) 发起 OTA，等设备就绪。
        otaLog(
          `发起 ${plan.label} OTA：${total} 字节 / ${frameCount} 帧（${frameSize}B、帧周期 ${periodMs}ms/帧首到帧首）`,
        );
        const readyAt = Date.now();
        try {
          await this.sendAndWaitLocked(
            plan.startCommand(total),
            m => m.type === 'OTA_READY',
            8000,
          );
        } catch {
          // 上一次 OTA 中断后设备会卡在 OTA 等待态，此后对 OTA&LEN 一律不应答。
          // 直接抛「设备应答超时」会让人以为是这次的问题，于是反复点重试——而不重启
          // 就永远不会成功。这里把话说明白。
          otaLog(
            `设备未应答 OTA 起始指令（等待 ${Date.now() - readyAt}ms）：` +
              '多半仍卡在上一次中断的 OTA 等待态',
            'error',
          );
          throw new Error(
            '设备没有响应升级指令。上次升级中断后设备会卡在等待态，' +
              '直接重试不会成功——请先把设备断电重启，重新连接后再升级',
          );
        }
        otaLog(
          `设备已回就绪应答「GJJY_DEV&OTA」（等待 ${
            Date.now() - readyAt
          }ms），开始发送固件帧`,
        );
        // 2) 流式发送固件帧（原始字节，非 ASCII 命令）。
        // 优先把整个发送循环交给原生定时器：JS 逐帧 await 的真实周期是 25~35ms，
        // 固件方据此判定「发得太慢」。旧二进制没有这个方法时退回 JS 循环。
        onProgress?.(0, total);
        if (isMr20OtaSenderAvailable) {
          await this.otaSendFramesNative(bin, frameSize, periodMs, frameCount, trace, onProgress);
        } else {
          otaLog(
            '原生定时发帧不可用（旧二进制，需 pod install + 重新构建），' +
              '退回 JS 逐帧发送——节奏保证不了 20ms',
            'warn',
          );
          await this.otaSendFramesJs(bin, frameSize, periodMs, frameCount, trace, onProgress);
        }
        otaLog(
          `发送 OT&OVER，最多等待 ${OTA_OVER_TIMEOUT_MS / 1000}s`,
        );
        // 收尾监听器必须先于 OT&OVER 挂上（WiFi 才有，见 OtaPlan.startTailWatch）。
        const tail = plan.startTailWatch?.();
        // 3) 通知发送完成，等设备擦写 flash 后回结果。
        // 862KB 写进 flash（擦块 + 写入 + 校验）实测远超 30s，超时给到 3 分钟；
        // 期间打心跳，把「设备在忙」和「App 卡死」在日志里区分开。
        const overAt = Date.now();
        const heartbeat = setInterval(() => {
          otaLog(
            `仍在等待设备应答…（已等 ${Math.round(
              (Date.now() - overAt) / 1000,
            )}s）`,
          );
        }, OTA_OVER_HEARTBEAT_MS);
        let done: DeviceMessage;
        try {
          done = await this.sendAndWaitLocked(
            Cmd.otaOver(),
            m => m.type === 'OTA_DONE' || m.type === 'OTA_ERR',
            OTA_OVER_TIMEOUT_MS,
          );
        } catch (e) {
          tail?.cancel(e as Error);
          throw e;
        } finally {
          clearInterval(heartbeat);
        }
        if (done.type === 'OTA_ERR') {
          otaLog(
            `设备回 OT&ERR（等待 ${Date.now() - overAt}ms），固件接收失败`,
            'error',
          );
          tail?.cancel(new Error('设备固件接收失败'));
          throw new Error('设备固件接收失败，请断电重启设备后重试');
        }
        if (!tail) {
          otaLog(
            `设备回 OT&OVER（等待 ${
              Date.now() - overAt
            }ms），升级成功，设备将复位`,
          );
          return;
        }
        // 4) WiFi 模组独有：OT&OVER 只代表「数据收全」，模组这才开始烧。
        otaLog(
          `设备回 OT&OVER（等待 ${Date.now() - overAt}ms），数据已全部收下；` +
            `接下来等 ${plan.label}把固件烧进去（最多 ${
              OTA_WIFI_FLASH_TIMEOUT_MS / 1000
            }s）`,
        );
        const flashAt = Date.now();
        const flashBeat = setInterval(() => {
          otaLog(
            `${plan.label}仍在烧写…（已等 ${Math.round(
              (Date.now() - flashAt) / 1000,
            )}s）`,
          );
        }, OTA_OVER_HEARTBEAT_MS);
        try {
          await tail.done;
          otaLog(
            `${plan.label}烧写完成（WIFIS 回落到 0，耗时 ${
              Date.now() - flashAt
            }ms），升级成功`,
          );
        } catch (e) {
          const msg = String((e as Error)?.message || e);
          // 超时 ≠ 失败：设备已经确认收全数据了，此刻报「升级失败」多半是冤枉它——
          // 更可能是这版固件根本不推 WIFIS。所以只警告，不把整个流程判死，
          // 但要给一条能自证的下一步，别让人对着一个「成功了吗？」的结局干瞪眼。
          if (msg.includes('设备应答超时')) {
            otaLog(
              `等了 ${Math.round(
                (Date.now() - flashAt) / 1000,
              )}s 没等到 WIFIS&5→0：数据设备已确认收全，但无法确认模组是否刷写成功。` +
                '请到 WiFi 管理页读一次模组版本号（WF 指令）核对',
              'warn',
            );
            return;
          }
          throw e;
        } finally {
          clearInterval(flashBeat);
        }
      } finally {
        otaLog(
          `本次写入方式：无应答写（ATT Write Command），` +
            `共发 ${trace.framesSent}/${frameCount} 帧、每帧 ${frameSize}B`,
        );
        if (trace.seen.size) {
          const summary = [...trace.seen.entries()]
            .map(
              ([text, r]) => `「${text}」×${r.count}（首现于第 ${r.first} 帧后）`,
            )
            .join('；');
          otaLog(`OTA 期间设备共回 ${trace.seen.size} 类命令帧：${summary}`);
        }
        if (trace.stalls) {
          otaLog(
            `本次共 ${trace.stalls} 帧写入耗时 ≥${OTA_SLOW_WRITE_LOG_MS}ms` +
              (trace.stalls > 40 ? '（只展开了前 40 条）' : ''),
          );
        }
        if (trace.nonCmd > 5) {
          otaLog(`（OTA 期间另有 ${trace.nonCmd - 5} 条非命令帧未展开）`);
        }
        this.otaTrace = null;
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
