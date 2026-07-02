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
 * 固定 16 位配对密钥。用确定值（而非随机）避免「密钥一旦没存住就再也配不上」：
 * 设备绑定后，之后每次必须发同一个密钥；固定值保证任何时候/任何手机都能对上。
 */
export const MR20_PAIR_KEY = 'SeeMemoryMR20K01';

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
  /** 绑定密钥配对，pwd 必须 16 位。 */
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
  /** 获取 WiFi 模组固件版本。 */
  getWifiVersion: () => buildCommand('WF'),
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
    default:
      return {type: 'UNKNOWN', raw, tokens};
  }
}
