/**
 * MR20「记忆粒」GJJY 通信协议 — 纯 TS 实现（依据《MR20通信协议_硅基记忆.xlsx》）。
 *
 * 传输层：BLE GATT。
 *   - 主服务      001120a0-...
 *   - 音频 notify  001120a1-...（录音时实时 MP3 流）
 *   - 指令 notify  001120a3-...（设备 -> App 指令 / 文件数据）
 *   - 写特征      001120a2-...（App -> 设备 指令）
 *
 * 应用层：ASCII 字符串命令，`&` 分隔。
 *   - App -> 设备 前缀 `GJJY_BLE&`
 *   - 设备 -> App 前缀 `GJJY_DEV&`（少数事件用 `GJJY_EV&`）
 *
 * 二进制数据（实时音频帧 / 文件同步帧）不带 `GJJY_` 前缀，按原始字节全部保留。
 *
 * 本文件只做「编解码」，不碰蓝牙；BLE 收发在 Mr20Client.ts。
 */

// ---------------------------------------------------------------------------
// UUID
// ---------------------------------------------------------------------------

export const MR20_UUID = {
  service: '001120a0-2233-4455-6677-88995a5b5c5d',
  audioNotify: '001120a1-2233-4455-6677-88995a5b5c5d',
  write: '001120a2-2233-4455-6677-88995a5b5c5d',
  cmdNotify: '001120a3-2233-4455-6677-88995a5b5c5d',
} as const;

export const CMD_PREFIX = 'GJJY_BLE';
const DEVICE_PREFIXES = ['GJJY_DEV&', 'GJJY_EV&'];
/** 一个 ASCII 帧若以此开头则视为「命令/文本帧」，否则视为二进制数据帧。 */
const DEVICE_FRAME_MARKER = 'GJJY_';

// ---------------------------------------------------------------------------
// 低层 base64 / ASCII 编解码（ble-plx 的特征值读写都是 base64 字符串）
// ---------------------------------------------------------------------------

const B64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: number[] = (() => {
  const t = new Array(256).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i += 1) {
    t[B64_CHARS.charCodeAt(i)] = i;
  }
  return t;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64_CHARS[(n >> 18) & 63] +
      B64_CHARS[(n >> 12) & 63] +
      B64_CHARS[(n >> 6) & 63] +
      B64_CHARS[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      B64_CHARS[(n >> 18) & 63] +
      B64_CHARS[(n >> 12) & 63] +
      B64_CHARS[(n >> 6) & 63] +
      '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  // 注意：clean 已剥掉 '=' 填充，所以 floor(clean.length*3/4) 就是正确字节数。
  // 旧实现又减了一次 pad → 每个非 3 字节倍数的帧都少 1~2 字节，多帧累积把 MP3
  // 文件传坏（播放报 OSStatus 'wht?'、ASR 报 no audio）。务必不要再减 pad。
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const outLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(outLen > 0 ? outLen : 0);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = B64_LOOKUP[clean.charCodeAt(i)] ?? 0;
    const b = B64_LOOKUP[clean.charCodeAt(i + 1)] ?? 0;
    const c = B64_LOOKUP[clean.charCodeAt(i + 2)] ?? 0;
    const d = B64_LOOKUP[clean.charCodeAt(i + 3)] ?? 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < outLen) {
      out[o++] = (n >> 16) & 0xff;
    }
    if (o < outLen) {
      out[o++] = (n >> 8) & 0xff;
    }
    if (o < outLen) {
      out[o++] = n & 0xff;
    }
  }
  return out;
}

export function asciiToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

export function bytesToAscii(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

/** 命令字符串 -> base64（写入 write 特征）。 */
export function encodeCommand(command: string): string {
  return bytesToBase64(asciiToBytes(command));
}

// ---------------------------------------------------------------------------
// 命令构造（App -> 设备）
// ---------------------------------------------------------------------------

function buildCommand(...parts: string[]): string {
  return [CMD_PREFIX, ...parts].join('&');
}

/** 把 Date 格式化为设备时间字符串 yyyymmddhhmmss。 */
export function formatDeviceTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

/**
 * {@link formatDeviceTime} 的逆函数：解析设备时间串 `yyyymmddhhmmss`（GT 应答 CT&<time>）为 Date。
 * 长度不足 14 位、含非数字、或月/日/时/分/秒越界一律返回 null（交由 UI 兜底显示 —）。
 */
export function parseDeviceTime(s: string): Date | null {
  const t = (s ?? '').trim();
  if (!/^\d{14}$/.test(t)) {
    return null;
  }
  const year = Number(t.slice(0, 4));
  const month = Number(t.slice(4, 6)); // 1~12
  const day = Number(t.slice(6, 8));
  const hour = Number(t.slice(8, 10));
  const min = Number(t.slice(10, 12));
  const sec = Number(t.slice(12, 14));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  if (hour > 23 || min > 59 || sec > 59) {
    return null;
  }
  const d = new Date(year, month - 1, day, hour, min, sec);
  // 借 Date 归一化反查非法日期（如 2 月 30 日会被进位到 3 月）。
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

/**
 * 固定 16 位配对密钥。用确定值（而非随机）避免「密钥一旦没存住就再也配不上」：
 * 设备绑定后，之后每次必须发同一个密钥；固定值保证任何时候/任何手机都能对上。
 * 设备只取前 {@link MR20_KEY_LEN} 位（0801 起协议如此规定），故等效于 'SeeMemor'。
 */
export const MR20_PAIR_KEY = 'SeeMemoryMR20K01';

/**
 * SK 绑定密钥长度。0801：「PWD：8 位（超过 8 位取前 8 位）」。
 * **这同时也是 WiFi 热点密码的长度**——见 {@link Cmd.syncWifiPassword}，两者是同一个值。
 * 8 位也正好卡在 WPA2 passphrase 的下限上，短一位就连不上热点。
 */
export const MR20_KEY_LEN = 8;

/** 设备只认前 8 位，UI 与入网都得用截断后的值，否则本地存的和热点上的对不上。 */
export function toDeviceKey(key: string): string {
  return key.slice(0, MR20_KEY_LEN);
}

/**
 * 密钥是否可用作 WPA2 热点密码：必须正好 8 位可打印 ASCII。
 * 含中文/空格会让 iOS 侧 passphrase 编码与设备端不一致，表现为「无法加入网络」。
 */
export function isValidDeviceKey(key: string): boolean {
  return /^[\x21-\x7e]{8}$/.test(key);
}

/** 随机生成 16 位绑定密钥（已不用，保留备查）。 */
export function generateBindKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let key = '';
  for (let i = 0; i < 16; i += 1) {
    key += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return key;
}

export const Cmd = {
  /**
   * 绑定密钥配对。0801 起协议把 PWD 从「16 characters」改成「8 位（超过 8 位取前 8 位）」，
   * 且**默认该功能是关闭的**——这也是本 App 走裸连探测能连上的原因（见 [[mr20-sk-binding-key]]）。
   * {@link MR20_PAIR_KEY} 仍是 16 位，设备只取前 8 位，行为不变，故不改值以免已绑设备对不上。
   */
  bindKey: (pwd: string) => buildCommand('SK', pwd),
  /** 设置设备时间。 */
  setTime: (date: Date) => buildCommand('T', formatDeviceTime(date)),
  /** 获取设备时间。 */
  getTime: () => buildCommand('GT'),
  /** 查询录音状态。 */
  getRecState: () => buildCommand('STE'),
  /** 开始录音。 */
  startRec: () => buildCommand('STA'),
  /** 停止并保存录音。 */
  stopRec: () => buildCommand('STO'),
  /** 获取电量。 */
  getBattery: () => buildCommand('BAT'),
  /** 查询容量（剩余/总，MB）。 */
  getSpace: () => buildCommand('SPACE'),
  /** 获取固件版本。 */
  getFirmware: () => buildCommand('FW'),
  /** 获取 BT MAC。 */
  getMac: () => buildCommand('MAC'),
  /** 获取录音模式。 */
  getRecMode: () => buildCommand('REC', 'SECEN'),
  /** 获取录音文件夹列表。 */
  listDirs: () => buildCommand('LIST_DIRS'),
  /** 获取某文件夹下的文件列表。 */
  listFiles: (dir: string) => buildCommand('LIST', dir),
  /** BLE 同步文件：App 无该文件时（拉全量）。 */
  syncFile: (dir: string, fname: string) => buildCommand('U', dir, fname),
  /** BLE 同步文件：App 已有 size 字节时（断点续传）。 */
  syncFileResume: (dir: string, fname: string, size: number) =>
    buildCommand('U', dir, fname, String(size)),
  /** 中断文件传输。 */
  shutTransfer: () => buildCommand('SHUT'),
  /** 删除设备上的文件。 */
  deleteFile: (dir: string, fname: string) => buildCommand('D', dir, fname),
  /** Type-C 文件读取开关，sta: 1 开 / 0 关。协议：GJJY_BLE&USB&<1|0>。 */
  setUsb: (sta: 0 | 1) => buildCommand('USB', String(sta)),
  /** 获取 Type-C 文件读取功能状态。 */
  getUsb: () => buildCommand('GET', 'USB'),
  /** 断开 BLE 并重置密钥。 */
  bleOff: () => buildCommand('BLE', 'OFF'),
  /** 断开 BLE、重置密钥并格式化磁盘。 */
  bleReset: () => buildCommand('BLE', 'RESET'),
  // --- WiFi 快传（控制信令走 BLE，文件字节走 WiFi TCP 192.168.200.1:8475）---
  /** 开启设备 WiFi 热点（进 AP 模式）。 */
  wifiOpen: () => buildCommand('WIFIO'),
  /** 关闭设备 WiFi 热点。 */
  wifiClose: () => buildCommand('WIFIC'),
  /** 获取热点 SSID 与密码。应答 GJJY_DEV&WIFI&SSID&PWD。 */
  getWifi: () => buildCommand('WIFI'),
  /** 查询 WiFi 状态（0~7）。应答 GJJY_DEV&WIFIS&STA。 */
  getWifiState: () => buildCommand('WIFIS'),
  /**
   * 把 WiFi 密码同步成当前 SK 绑定密钥。**不带任何参数**。
   *
   * 曾长期误实现为 `WIFI&CH&<ssid>&<pwd>`，怎么试都不生效（0703 固件报告记为「参数格式不明」）。
   * 0801 协议三处互相印证，实际语义是「无参 + 密码取自 SK」：
   *   1. 命令表里这一行是**光杆** `"GJJY_BLE&WIFI&CH"`——表内其它带参命令都写了占位符
   *      （`&PWD` `&LEN` `&VAL` `&time` `&DIR_NAME&FNAME`），只有它没有。
   *   2. SK 那行：「第一次发送为设置密钥（后需发 "GJJY_BLE&WIFI&CH" 指令**同步更改 WiFi 密码**，
   *      需 10s 左右）」。
   *   3. 「WiFi功能使用」：「设备**接收到密钥后**，会自动打开 WiFi 并设置 WiFi 密码，
   *      WiFi 状态为 '4'，设置密码成功后状态为 '6'」。
   * 即：**热点密码 == SK 密钥（8 位）**，SSID 是设备名、改不了。
   * MCU 不回包，结果靠轮询 WIFIS 推断（4=配密码中 → 6=改完待复位关机）。
   */
  syncWifiPassword: () => buildCommand('WIFI', 'CH'),
  /**
   * 重置绑定密钥。协议：「如连接将断开连接，后需用 GJJY_BLE&SK&PWD 重新设置密钥」。
   * 用于密钥设错/设备预绑厂商密钥时让用户主动解绑，**会当场断开 BLE**。
   */
  resetKey: () => buildCommand('SK', 'RESET'),
  /** 获取 WiFi 模组固件版本。 */
  getWifiVersion: () => buildCommand('WF'),
  // --- OTA 固件升级（MCU）。协议 R42/R44/R61：LEN 固定 6 位（≤999999B≈1MB）。---
  /** 发起 MCU OTA，len=固件字节数（补足 6 位）。应答 GJJY_DEV&OTA 就绪。 */
  otaStart: (len: number) => buildCommand('OTA', String(len).padStart(6, '0')),
  /**
   * 发起 **WiFi 模组** OTA（协议 R62 第 1 步）。应答同样是 GJJY_DEV&OTA。
   *
   * ⚠️ 命令名在 6.26 那份表里自相矛盾：R43 命令表写 `GJJY_BLE&WIFI&OTA&LEN`，
   * R62 功能说明写 `GJJY_BLE&OTA&WIFI&LEN`。这里取 R62 的写法（0703 那份也已统一成
   * OTA&WIFI）。若真机对它不回 DEV&OTA，第一件事就是换成 WIFI&OTA 再试。
   */
  otaWifiStart: (len: number) =>
    buildCommand('OTA', 'WIFI', String(len).padStart(6, '0')),
  /** 同上，R43 命令表的另一种拼法，留作真机对拍。 */
  otaWifiStartAlt: (len: number) =>
    buildCommand('WIFI', 'OTA', String(len).padStart(6, '0')),
  /** OTA 固件数据发送完毕。应答 GJJY_DEV&OT&OVER（成功）/ OT&ERR（失败）。 */
  otaOver: () => buildCommand('OT', 'OVER'),
  /** WiFi 传输文件：App 无该文件时（拉全量）。应答 GJJY_DEV&W&LEN。 */
  wifiFile: (dir: string, fname: string) => buildCommand('W', dir, fname),
  /** WiFi 传输文件：App 已有 size 字节时（断点续传）。 */
  wifiFileResume: (dir: string, fname: string, size: number) =>
    buildCommand('W', dir, fname, String(size)),
} as const;

/**
 * WiFi 传输流的结束标记：流的最后 5 字节固定为 BA 5A 02 8F 04。
 * 收到即停止读取，且**必须从落盘文件剥掉**（落盘大小 = 收到字节数 - 5）。
 * 原生 TCP 接收器持有一份相同常量做检测/剥离；此处导出供 JS 侧/单测引用。
 */
export const WIFI_END_MARKER = [0xba, 0x5a, 0x02, 0x8f, 0x04] as const;

/**
 * WIFIS 状态码（协议 0801「获取当前WiFi状态」一行的 STA 取值）。
 * 之前这些数字散在 Mr20Client 的注释和字面量里，状态机一改就容易对不上号。
 */
export const WifiState = {
  /** '0' WiFi 关闭。 */
  OFF: 0,
  /** '1' WiFi 连接（AP 已起且**已有客户端连入**）。 */
  LINKED: 1,
  /** '2' WiFi 未连接（AP 已起、还没客户端）——0801 流程第 2 步要求在此态才去连手机。 */
  AP_IDLE: 2,
  /** '3' 等待 WiFi 开启（WIFIO 之后的过渡态；设备内部复位也停在这，约 6s）。 */
  OPENING: 3,
  /** '4' 修改密码中。 */
  PWD_CHANGING: 4,
  /** '5' OTA 中。 */
  OTA: 5,
  /** '6' 密码修改成功，等待系统复位关机（之后 5s 自动关，回落到 0）。 */
  PWD_DONE: 6,
  /** '7' 自动关闭（开启后 30s 无人连接 / 客户端断开 5s 后）。 */
  AUTO_OFF: 7,
  /** 非协议值：WIFIS 无应答或应答无法解析。 */
  UNKNOWN: -1,
} as const;

/**
 * 协议 0801「WiFi功能使用」段落里写死的几个时间常量，状态机按这些数来定超时，
 * 而不是各处拍脑袋填。
 */
export const WIFI_TIMING = {
  /** AP 起来后 30s 内没有客户端连入就自动关闭——入网 + 建 socket 必须挤进这个窗口。 */
  IDLE_AUTO_CLOSE_MS: 30000,
  /** 「收到密钥 → 自动开 WiFi 配密码」整轮约 8s（状态 4 → 6），完成后再 5s 自动关。 */
  PWD_CYCLE_MS: 8000,
  /** WiFi 出问题时设备自行复位约 6s，期间 WIFIS 停在 3。 */
  RESET_MS: 6000,
  /**
   * 等 `SK&PWD` 应答的上限。**协议这条应答慢得反直觉：固件方说要 10s 左右**——
   * 因为设备收到密钥后要顺带把 WiFi 密码配一遍（「WiFi功能使用」段：收到密钥后自动开
   * WiFi 配密码，状态 4 → 6，整轮约 8s）才回话。
   *
   * 早先按普通命令的 8s 算，比应答本身还短，等于**每次都必然超时**；再加上 8s > 常规
   * 命令的体感，日志里看起来又像「设备不应答」。取 15s 留够余量。
   */
  SK_ACK_MS: 15000,
} as const;

// ---------------------------------------------------------------------------
// 应答解析（设备 -> App）
// ---------------------------------------------------------------------------

export type DeviceMessage =
  | {type: 'SK_OK'}
  | {type: 'SK_ERR'}
  | {type: 'REC_STATE'; recording: boolean}
  | {type: 'REC_START'; fname: string}
  | {type: 'REC_STOP'}
  | {type: 'RECORDING'; fname: string; seconds: number} // RT&REC_NAME&TIME
  | {type: 'REC_ERR'}
  | {type: 'DISK_ERR'}
  | {type: 'SPACE'; freeMb: number; totalMb: number}
  | {type: 'BATTERY'; rate: number}
  | {type: 'FIRMWARE'; version: string}
  | {type: 'WIFI_VERSION'; version: string}
  | {type: 'MAC'; mac: string}
  | {type: 'TIME'; time: string}
  | {type: 'TIME_SET_OK'}
  | {type: 'REC_MODE'; mode: 'call' | 'conversation'}
  | {type: 'DIR'; name: string} // DIRS&DIR_NAME（逐条）
  | {type: 'DIRS_DONE'; count: number} // DIRS_SUM&LEN
  | {type: 'FILE'; dir: string; fname: string; seconds: number; size: number} // F&...
  | {type: 'FILE_LIST_DONE'; count: number} // LIST&LEN
  | {type: 'FILE_DATA_LEN'; length: number} // U&LEN / W&LEN：后续即文件数据
  | {type: 'FILE_DATA_DONE'} // DEV&OFF：文件数据发送完毕
  | {type: 'FILE_DATA_ERR'} // U&ERR：无法打开文件
  | {type: 'DELETE_OK'}
  | {type: 'DELETE_ERR'}
  | {type: 'TRANSFER_SHUT'}
  | {type: 'USB_STATE'; sta: number} // USB&STA：Type-C 文件读取功能状态
  | {type: 'WIFI_STATE'; state: string} // WIFIS&STA：WiFi 状态码 0~7
  | {type: 'WIFI_CRED'; ssid: string; pwd: string} // WIFI&SSID&PWD：热点凭据
  | {type: 'WIFI_OPENED'} // WIFIO：热点已开
  | {type: 'WIFI_CLOSED'} // WIFIC：热点已关
  | {type: 'OTA_READY'} // DEV&OTA：设备已就绪，可发固件帧
  | {type: 'OTA_DONE'} // OT&OVER：固件数据接收完成
  | {type: 'OTA_ERR'} // OT&ERR：固件数据接收失败
  | {type: 'WIFI_OTA_ERR'} // OW&ERR：WiFi 模组烧录失败（数据已收全，刷写阶段挂了）
  | {type: 'UNKNOWN'; raw: string; tokens: string[]};

/** 一个收到的帧（已 ascii 化）是否是文本命令帧。 */
export function isCommandFrame(text: string): boolean {
  return text.startsWith(DEVICE_FRAME_MARKER);
}

const toInt = (s: string | undefined): number => {
  const n = parseInt((s ?? '').trim(), 10);
  return Number.isFinite(n) ? n : 0;
};

// 保留小数（如剩余空间 MB 带小数位），供需要 KB 级精度的字段用。
const toNum = (s: string | undefined): number => {
  const n = parseFloat((s ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * 解析设备文本命令帧。入参为去掉传输封装后的 ASCII 字符串，
 * 例如 "GJJY_DEV&SPA&512&8192"。无法识别返回 UNKNOWN。
 */
export function parseDeviceMessage(rawInput: string): DeviceMessage {
  const raw = rawInput.replace(/\0+$/g, '').trim();
  let body = raw;
  for (const p of DEVICE_PREFIXES) {
    if (raw.startsWith(p)) {
      body = raw.slice(p.length);
      break;
    }
  }
  const tokens = body.split('&');
  const head = tokens[0];

  switch (head) {
    case 'SK':
      // 协议：成功 SK&OK / 失败 SK&ERR。固件可能用变体（如 SK&0）表示成功，
      // 故除非显式 ERR，其余一律当成功，避免误判把能用的连接当失败。
      return tokens[1] === 'ERR' ? {type: 'SK_ERR'} : {type: 'SK_OK'};
    case 'STE':
      return {type: 'REC_STATE', recording: toInt(tokens[1]) === 1};
    case 'STA':
      return {type: 'REC_START', fname: tokens[1] ?? ''};
    case 'STO':
      return {type: 'REC_STOP'};
    case 'RT': {
      // GJJY_DEV&RT&REC_NAME&TIME 或 GJJY_DEV&RT&NAME&TIME
      const fname = tokens[1] ?? '';
      const seconds = toInt(tokens[2]);
      return {type: 'RECORDING', fname, seconds};
    }
    case 'REC':
      if (tokens[1] === 'ERR') {
        return {type: 'REC_ERR'};
      }
      if (tokens[1] === 'CALL') {
        return {type: 'REC_MODE', mode: 'call'};
      }
      if (tokens[1] === 'CON') {
        return {type: 'REC_MODE', mode: 'conversation'};
      }
      return {type: 'UNKNOWN', raw, tokens};
    case 'DISK':
      return {type: 'DISK_ERR'};
    case 'SPA':
      return {type: 'SPACE', freeMb: toNum(tokens[1]), totalMb: toNum(tokens[2])};
    case 'BAT':
      return {type: 'BATTERY', rate: toInt(tokens[1])};
    case 'FW':
      return {type: 'FIRMWARE', version: tokens[1] ?? ''};
    case 'WF':
      return {type: 'WIFI_VERSION', version: tokens[1] ?? ''};
    case 'MAC':
      return {type: 'MAC', mac: tokens[1] ?? ''};
    case 'CT':
      return {type: 'TIME', time: tokens[1] ?? ''};
    case 'T':
      return tokens[1] === 'OK'
        ? {type: 'TIME_SET_OK'}
        : {type: 'UNKNOWN', raw, tokens};
    case 'DIRS':
      return {type: 'DIR', name: tokens[1] ?? ''};
    case 'DIRS_SUM':
      return {type: 'DIRS_DONE', count: toInt(tokens[1])};
    case 'F':
      return {
        type: 'FILE',
        dir: tokens[1] ?? '',
        fname: tokens[2] ?? '',
        seconds: toInt(tokens[3]),
        size: toInt(tokens[4]),
      };
    case 'LIST':
      return {type: 'FILE_LIST_DONE', count: toInt(tokens[1])};
    case 'U':
    case 'W':
      if (tokens[1] === 'ERR') {
        return {type: 'FILE_DATA_ERR'};
      }
      return {type: 'FILE_DATA_LEN', length: toInt(tokens[1])};
    case 'OFF':
      return {type: 'FILE_DATA_DONE'};
    case 'D':
      return tokens[1] === 'ERR' ? {type: 'DELETE_ERR'} : {type: 'DELETE_OK'};
    case 'SHUT':
      return {type: 'TRANSFER_SHUT'};
    case 'USB':
      return {type: 'USB_STATE', sta: toInt(tokens[1])};
    case 'WIFIS':
      return {type: 'WIFI_STATE', state: tokens[1] ?? ''};
    case 'WIFI':
      // GJJY_DEV&WIFI&SSID&PWD。head 'WIFI' 与 'WIFIS' 是不同 token，互不冲突。
      return {type: 'WIFI_CRED', ssid: tokens[1] ?? '', pwd: tokens[2] ?? ''};
    case 'WIFIO':
      return {type: 'WIFI_OPENED'};
    case 'WIFIC':
      return {type: 'WIFI_CLOSED'};
    case 'OTA':
      // GJJY_DEV&OTA：设备进入 OTA 模式、就绪可收固件帧。
      return {type: 'OTA_READY'};
    case 'OT':
      // GJJY_DEV&OT&OVER 成功 / OT&ERR 失败。
      return tokens[1] === 'ERR' ? {type: 'OTA_ERR'} : {type: 'OTA_DONE'};
    case 'OW':
      // GJJY_DEV&OW&ERR：WiFi 模组**烧录**失败（R62 第 5 步）。注意与 OT&ERR 不同——
      // OT&ERR 是「数据没收全」，OW&ERR 是「收全了但刷进模组时失败」。
      return {type: 'WIFI_OTA_ERR'};
    default:
      return {type: 'UNKNOWN', raw, tokens};
  }
}
