/**
 * MR20 录音同步编排：列目录/文件 -> 与已同步集合做差集 -> 串行 BLE 拉取 ->
 * 落盘 MP3 -> 自动入库（mr20Ingest）。BLE 单连接，串行 concurrency=1。
 */
import {Mr20Client, Mr20File} from '../native/mr20/Mr20Client';
import {Mr20Native} from '../native/mr20/Mr20Native';
import {bytesToBase64} from '../native/mr20/protocol';
import {getSyncedSet, markSynced} from './mr20Storage';
import {recordSyncedFile, Mr20InboxItem} from './mr20Ingest';

export interface SyncProgress {
  total: number; // 待同步文件总数
  completed: number; // 已完成
  current?: {dir: string; fname: string; received: number; size: number};
}

export interface SyncFileResult {
  file: Mr20File;
  localPath: string;
  ingest?: Mr20InboxItem;
  error?: string;
}

export interface SyncOptions {
  onProgress?: (p: SyncProgress) => void;
  // 同步只下载到手机并登记为 synced；上传 COS + 后端批处理由用户手动触发。
  deleteAfter?: boolean; // 默认 false：同步成功后删除设备文件
  // 返回 true 则停止同步（每个文件开始前检查）。配合 client.abortTransfer() 可中断
  // 正在传输的当前文件，从而即时停下整批同步。
  shouldCancel?: () => boolean;
}

export interface Mr20DeviceFiles {
  total: number; // 设备上当前录音文件总数（所有日期文件夹）
  pending: number; // 其中尚未同步到手机的数量
  bytes: number; // 设备录音文件总字节数
}

/**
 * 扫一遍设备上全部录音（listDirs + 每个 dir listFiles），一次性算出
 * 总数 / 待同步数 / 总字节。用于设备状态卡展示「设备共有 N 个文件」。
 * 与同步/状态查询是同类 BLE 命令，调用方需串行触发，避免命令-应答交错。
 */
export async function scanDeviceFiles(
  client: Mr20Client,
  shouldCancel?: () => boolean,
): Promise<Mr20DeviceFiles> {
  const dirs = await client.listDirs();
  const synced = await getSyncedSet();
  let total = 0;
  let pending = 0;
  let bytes = 0;
  for (const dir of dirs) {
    // 让位于用户传输：传输开始后中止后台扫描，避免占着 BLE 让传输卡很久。
    if (shouldCancel?.()) {
      break;
    }
    const files = await client.listFiles(dir);
    for (const f of files) {
      total += 1;
      bytes += f.size || 0;
      if (!synced.has(`${f.dir}/${f.fname}`)) {
        pending += 1;
      }
    }
  }
  return {total, pending, bytes};
}

/** 列出设备上所有「尚未同步」的录音文件（供自动同步 syncAllFiles 用，不重拉已传）。 */
export async function listPendingFiles(client: Mr20Client): Promise<Mr20File[]> {
  const dirs = await client.listDirs();
  const synced = await getSyncedSet();
  const pending: Mr20File[] = [];
  for (const dir of dirs) {
    const files = await client.listFiles(dir);
    for (const f of files) {
      if (!synced.has(`${f.dir}/${f.fname}`)) {
        pending.push(f);
      }
    }
  }
  return pending;
}

/**
 * 列出设备上「全部」录音文件（不按已同步集合过滤）。供「设备文件」浏览页展示完整设备清单，
 * 已传输的也保留在列表里，允许用户重新传输覆盖本地同名文件。
 */
export async function listAllDeviceFiles(
  client: Mr20Client,
  shouldCancel?: () => boolean,
): Promise<Mr20File[]> {
  const dirs = await client.listDirs();
  const all: Mr20File[] = [];
  for (const dir of dirs) {
    // 让位于用户传输：传输开始后中止后台扫描，避免占着 BLE 让传输卡很久。
    if (shouldCancel?.()) {
      break;
    }
    const files = await client.listFiles(dir);
    all.push(...files);
  }
  return all;
}

function ensureMp3Name(fname: string): string {
  return /\.mp3$/i.test(fname) ? fname : `${fname}.mp3`;
}

/** 同步录音在手机 Documents 下的根目录（落盘到 mr20/<dir>/<fname>.mp3）。 */
export const MR20_FILES_ROOT = 'mr20';

/** 录音在 Documents 下的相对路径 mr20/<dir>/<fname>.mp3（BLE 与 WiFi 落盘共用）。 */
export function mr20FileRelPath(dir: string, fname: string): string {
  return `${MR20_FILES_ROOT}/${dir}/${ensureMp3Name(fname)}`;
}

/**
 * 当前沙盒 Documents 绝对路径（每会话缓存一次）。旧二进制无 getDocumentsDir
 * 原生方法时返回 null，让调用方兜底到历史绝对路径。
 */
let docsDirCache: string | null = null;
export async function getDocsDir(): Promise<string | null> {
  if (docsDirCache) {
    return docsDirCache;
  }
  const fn = (Mr20Native as {getDocumentsDir?: () => Promise<string>})
    .getDocumentsDir;
  if (typeof fn !== 'function') {
    return null;
  }
  try {
    docsDirCache = await fn();
    return docsDirCache;
  } catch {
    return null;
  }
}

/**
 * 现算某条录音的本地绝对路径：当前 Documents 目录 + 相对路径 mr20/<dir>/<fname>.mp3。
 * 不再信任持久化的 item.localPath（容器 UUID 会随重装/恢复变化而失效）；
 * 拿不到 Documents 目录时兜底旧绝对路径（不比现状差）。
 */
export async function resolveLocalPath(item: {
  dir: string;
  fname: string;
  localPath?: string;
}): Promise<string> {
  const rel = mr20FileRelPath(item.dir, item.fname);
  const docs = await getDocsDir();
  return docs ? `${docs}/${rel}` : item.localPath ?? rel;
}

/** 把 MP3 字节落盘到 Documents/mr20/<dir>/<fname>，返回绝对路径。 */
export async function writeMp3ToDisk(
  dir: string,
  fname: string,
  bytes: Uint8Array,
): Promise<string> {
  return Mr20Native.writeBase64File(
    mr20FileRelPath(dir, fname),
    bytesToBase64(bytes),
  );
}

/**
 * 删除指定录音的本地 MP3 文件（逐条）。原生 deleteRelativePath 未链接时静默跳过——
 * 删 inbox 条目仍会成功，文件只是变孤儿（clearLocalCache 会整目录清掉）。
 */
export async function deleteLocalFiles(
  items: {dir: string; fname: string}[],
): Promise<void> {
  const del = (Mr20Native as {deleteRelativePath?: (p: string) => Promise<void>})
    .deleteRelativePath;
  if (typeof del !== 'function') {
    return;
  }
  for (const it of items) {
    const rel = `${MR20_FILES_ROOT}/${it.dir}/${ensureMp3Name(it.fname)}`;
    await Mr20Native.deleteRelativePath(rel).catch(() => undefined);
  }
}

/**
 * 删除手机上所有已同步的 MR20 录音文件（整个 mr20 目录）。
 * 原生 deleteRelativePath 未链接（未重新构建）时静默跳过，不阻断清缓存流程。
 */
export async function deleteAllLocalFiles(): Promise<void> {
  const del = (Mr20Native as {deleteRelativePath?: (p: string) => Promise<void>})
    .deleteRelativePath;
  if (typeof del === 'function') {
    await Mr20Native.deleteRelativePath(MR20_FILES_ROOT).catch(() => undefined);
  }
}

/**
 * 同步全部待同步文件。串行执行；单个文件失败只记录错误、继续下一个。
 */
export async function syncAllFiles(
  client: Mr20Client,
  options: SyncOptions = {},
): Promise<SyncFileResult[]> {
  const pending = await listPendingFiles(client);
  return syncFiles(client, pending, options);
}

/**
 * 同步「指定」的文件子集（设备文件浏览页勾选后调用）。串行 BLE 拉取；
 * 单个文件失败只记录错误、继续下一个。与 syncAllFiles 共用同一落盘/入库管线。
 */
export async function syncFiles(
  client: Mr20Client,
  files: Mr20File[],
  options: SyncOptions = {},
): Promise<SyncFileResult[]> {
  const {onProgress, deleteAfter = false, shouldCancel} = options;
  const results: SyncFileResult[] = [];
  let completed = 0;
  onProgress?.({total: files.length, completed});

  for (const file of files) {
    if (shouldCancel?.()) {
      break; // 用户中断：已下好的保留在收件箱，未传的留待下次同步补齐。
    }
    try {
      const bytes = await client.pullFile(file.dir, file.fname, (received, size) => {
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
      });
      const localPath = await writeMp3ToDisk(file.dir, file.fname, bytes);
      await markSynced(file.dir, file.fname);

      // 同步只下载并登记为「已同步·待处理」；上传 COS + 后端批处理由用户手动触发。
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
