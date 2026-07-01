/**
 * MR20 WiFi 快传编排：控制信令走 BLE，文件字节走 WiFi TCP（192.168.200.1:8475）。
 *
 * 与 mr20Sync（BLE）同构，但「下载」这一段换成 client.pullFileWifi：先程序化加入
 * 设备热点，再逐个 TCP 收流落盘。落盘后复用既有 markSynced / recordSyncedFile 入库管线。
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

  const {ssid, pwd} = await client.getWifiCredentials();
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
export async function disconnectWifi(_client: Mr20Client): Promise<void> {
  // 原生未更新时 wifiLeave 为 undefined，直接调用会同步抛错；先判存在再调。
  const leaveFn = (Mr20Native as {wifiLeave?: typeof Mr20Native.wifiLeave}).wifiLeave;
  if (typeof leaveFn === 'function') {
    await Mr20Native.wifiLeave().catch(() => undefined);
  }
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

/**
 * 逐个 WiFi 拉取给定文件并入库。串行执行；单个失败只记录错误、继续下一个。
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

  for (const file of files) {
    if (shouldCancel?.()) {
      break; // 用户中断：已下好的保留在收件箱，未传的留待下次补齐。
    }
    try {
      const {path: localPath} = await client.pullFileWifi(file.dir, file.fname, {
        host,
        port,
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
      await markSynced(file.dir, file.fname);

      const ingest = await recordSyncedFile({
        localPath,
        dir: file.dir,
        fname: file.fname,
        seconds: file.seconds,
      });
      if (deleteAfter) {
        await client.deleteFile(file.dir, file.fname).catch(() => undefined);
      }
      results.push({file, localPath, ingest});
    } catch (e) {
      results.push({
        file,
        localPath: '',
        error: String((e as Error)?.message || e),
      });
    } finally {
      completed += 1;
      onProgress?.({total: files.length, completed});
    }
  }

  return results;
}
