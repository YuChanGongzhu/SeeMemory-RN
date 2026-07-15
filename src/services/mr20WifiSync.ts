/**
 * MR20 WiFi 快传编排：控制信令走 BLE，文件字节走 WiFi TCP（192.168.200.1:8475）。
 *
 * 与 mr20Sync（BLE）同构，但「下载」这一段换成 WiFi 长连接：先程序化加入设备热点，
 * 再建**一条** TCP 长连接、逐个文件在同一 socket 上收流落盘（wifiOpenShared/wifiReceiveShared/
 * wifiCloseShared），消除逐条重连空档。落盘后复用既有 markSynced / recordSyncedFile 入库管线。
 *
 * 连接阶段（开热点→取凭据→入网）单独抽出，方便 UI 的「连接中」清单逐步打勾；
 * 自动入网失败时上层可降级到「引导手动连接」，再调 wifiSyncFiles 续传。
 */
import {Mr20Client, Mr20File} from '../native/mr20/Mr20Client';
import {Mr20Native} from '../native/mr20/Mr20Native';
import {markSynced} from './mr20Storage';
import {recordSyncedFile, Mr20InboxItem} from './mr20Ingest';
import {mr20FileRelPath} from './mr20Sync';

/** 设备热点固定网关与快传端口（见 MR20通信协议）。 */
export const DEVICE_WIFI_HOST = '192.168.200.1';
export const DEVICE_WIFI_PORT = 8475;
/** 设备热点默认密码（协议/测试报告：GJJY_DEV&WIFI&SSID&12345678）。设备未回密码时兜底用。 */
export const DEVICE_WIFI_DEFAULT_PWD = '12345678';

/** 连接阶段步骤，用于 UI「连接中」清单逐步打勾。 */
export type WifiConnectStep = 'open' | 'join' | 'reachable';
export type WifiStepState = 'pending' | 'active' | 'done' | 'failed';

export interface WifiConnectResult {
  ssid: string;
  pwd: string;
  host: string;
  port: number;
  /** true=程序化自动入网成功；false=需降级到引导手动连接。 */
  joined: boolean;
}

export interface WifiTransferProgress {
  total: number; // 本次快传文件总数
  completed: number; // 已完成
  current?: {dir: string; fname: string; received: number; size: number};
}

export interface WifiSyncResult {
  file: Mr20File;
  localPath: string;
  ingest?: Mr20InboxItem;
  error?: string;
}

/**
 * 连接阶段：开热点 → 取 SSID/密码 → 程序化加入。每步通过 onStep 回传状态，
 * 供「连接中」清单展示。自动入网失败不抛错，返回 joined=false 让上层降级引导手动连。
 */
export async function connectWifi(
  client: Mr20Client,
  onStep?: (step: WifiConnectStep, state: WifiStepState) => void,
): Promise<WifiConnectResult> {
  onStep?.('open', 'active');
  await client.openWifi();
  onStep?.('open', 'done');

  const cred = await client.getWifiCredentials();
  const ssid = cred.ssid;
  // 设备偶发不回密码时，回退到协议默认密码 12345678，避免入网因空密码失败。
  const pwd = cred.pwd || DEVICE_WIFI_DEFAULT_PWD;
  if (!ssid) {
    onStep?.('join', 'failed');
    throw new Error('未取到设备热点信息');
  }

  onStep?.('join', 'active');
  // 原生未更新时 wifiJoin 为 undefined，按未入网处理 → 上层降级引导手动连。
  const joinFn = (Mr20Native as {wifiJoin?: typeof Mr20Native.wifiJoin}).wifiJoin;
  const joined =
    typeof joinFn === 'function'
      ? await Mr20Native.wifiJoin(ssid, pwd, 20000).catch(() => false)
      : false;
  onStep?.('join', joined ? 'done' : 'failed');

  return {ssid, pwd, host: DEVICE_WIFI_HOST, port: DEVICE_WIFI_PORT, joined};
}

/**
 * 释放手机侧热点配置。**不主动发 WIFIC**——设备 30s 无连接会自动关、BLE 断也会关；
 * 频繁 WIFIO/WIFIC 反复开关会触发 WiFi 模组卡死（见 data/测试报告.md），故收尾少折腾。
 */
export async function disconnectWifi(client: Mr20Client): Promise<void> {
  // 1) 手机侧退出设备热点网络（iOS removeConfiguration 后系统自动回连此前 WiFi）。
  // 原生未更新时 wifiLeave 为 undefined，直接调用会同步抛错；先判存在再调。
  const leaveFn = (Mr20Native as {wifiLeave?: typeof Mr20Native.wifiLeave}).wifiLeave;
  if (typeof leaveFn === 'function') {
    await Mr20Native.wifiLeave().catch(() => undefined);
  }
  // 2) 设备侧关闭热点（BLE WIFIC），传输/取消结束后省设备电量。之前只退了手机网络、
  // 没关设备热点，导致「传输结束后设备热点一直开着」。失败忽略（可能已关/断连）。
  await client.closeWifi().catch(() => undefined);
}

export interface WifiSyncOptions {
  host?: string;
  port?: number;
  onProgress?: (p: WifiTransferProgress) => void;
  // 返回 true 则停止（每个文件开始前检查）。
  shouldCancel?: () => boolean;
  // 同步成功后是否删除设备文件，默认 false。
  deleteAfter?: boolean;
}

/** 单个文件 WiFi 收流的最大尝试次数：瞬时失败（截断/连接掉线）退避重连可恢复。 */
const WIFI_MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * 整批 WiFi 拉取给定文件并入库。**只建一次 TCP 长连接**，之后逐个文件在同一 socket 上收流
 * （消除逐条重连的空档）；串行执行，单个失败只记录错误、断连后重连续传下一个。
 * 入参 files 为用户勾选的子集（手动快传场景）。
 */
export async function wifiSyncFiles(
  client: Mr20Client,
  files: Mr20File[],
  options: WifiSyncOptions = {},
): Promise<WifiSyncResult[]> {
  const {
    host = DEVICE_WIFI_HOST,
    port = DEVICE_WIFI_PORT,
    onProgress,
    shouldCancel,
    deleteAfter = false,
  } = options;
  const results: WifiSyncResult[] = [];
  let completed = 0;
  onProgress?.({total: files.length, completed});

  // 整批复用一条长连接；出错(断连)时置 false，下个尝试自动重连续传。
  let opened = false;
  const ensureOpen = async () => {
    if (!opened) {
      await client.wifiOpenShared(host, port);
      opened = true;
    }
  };

  try {
    for (const file of files) {
      if (shouldCancel?.()) {
        break; // 用户中断：已下好的保留在收件箱，未传的留待下次补齐。
      }
      // 单文件多次尝试：截断/连接掉线等瞬时失败重连重试，避免半包被丢弃。
      let localPath = '';
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= WIFI_MAX_ATTEMPTS; attempt++) {
        if (shouldCancel?.()) {
          break;
        }
        try {
          await ensureOpen();
          const res = await client.wifiReceiveShared(file.dir, file.fname, {
            relativePath: mr20FileRelPath(file.dir, file.fname),
            onProgress: (received, size) => {
              onProgress?.({
                total: files.length,
                completed,
                current: {
                  dir: file.dir,
                  fname: file.fname,
                  received,
                  size: size > 0 ? size : file.size,
                },
              });
            },
          });
          localPath = res.path;
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          // 出错时长连接可能已被原生拆掉：关旧连、置未连，下个尝试重连续传。
          opened = false;
          await client.wifiCloseShared().catch(() => undefined);
          if (attempt < WIFI_MAX_ATTEMPTS) {
            await sleep(300 * attempt); // 退避，给设备 socket 服务重置的时间
          }
        }
      }
      try {
        if (localPath) {
          await markSynced(file.dir, file.fname);
          const ingest = await recordSyncedFile({
            localPath,
            dir: file.dir,
            fname: file.fname,
            seconds: file.seconds,
            sizeBytes: file.size,
          });
          if (deleteAfter) {
            await client.deleteFile(file.dir, file.fname).catch(() => undefined);
          }
          results.push({file, localPath, ingest});
        } else {
          results.push({
            file,
            localPath: '',
            error: String((lastErr as Error)?.message || lastErr || '传输失败'),
          });
        }
      } finally {
        completed += 1;
        onProgress?.({total: files.length, completed});
      }
    }
  } finally {
    // 批末统一关闭长连接（用户取消/异常也要关，避免 socket 悬空）。
    if (opened) {
      await client.wifiCloseShared().catch(() => undefined);
    }
  }

  return results;
}
