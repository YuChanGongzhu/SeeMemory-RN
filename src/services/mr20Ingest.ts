/**
 * MR20 联动入库（后端 batch/audios 版）。
 *
 * 链路：BLE 同步落盘 -> 收件箱登记 synced -> 手动触发：上传 COS（复用 api.ts 的
 * uploadAudioSegment）-> 提交后端 `/audio/batch`（见 audioBatch.ts）-> 轮询结果，
 * 按文件名把服务端转写回填到收件箱。**不再用客户端 Amphion ASR**——转写、场景
 * 总结、问题都由后端批处理产出。
 *
 * 本文件只管收件箱状态与单步动作；批处理编排（提交/轮询）在 useMr20。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {uploadAudioSegment} from './api';
import {resolveLocalPath} from './mr20Sync';
import {AudioFileResult} from './audioBatch';
import {fileEpoch, itemEpoch, batchDate} from './mr20FileTime';

const INBOX_KEY = '@ringmemory:mr20:inbox';

export type Mr20IngestStatus =
  | 'synced' // 已下载到手机，等待上传/批处理
  | 'uploaded' // 已上传 COS（有 audioUrl），尚未/正在批处理
  | 'queued' // 已提交后端批处理，等待结果
  | 'done' // 批处理完成，拿到转写
  | 'error'; // 上传或批处理失败

export interface Mr20InboxItem {
  id: string; // `${dir}/${fname}`
  dir: string;
  fname: string;
  localPath: string;
  seconds: number;
  sizeBytes?: number; // 文件大小（字节，来自设备文件列表），仅作展示
  audioUrl?: string; // COS objectUrl（上传后）
  batchGroupId?: string; // 所属后端批处理 groupId
  transcript?: string; // 后端转写文本
  status: Mr20IngestStatus;
  error?: string;
  createdAt: number;
}

export interface IngestInput {
  localPath: string;
  dir: string;
  fname: string;
  seconds: number;
  sizeBytes?: number;
  recMode?: 'call' | 'conversation';
}

/** 提交给后端批处理用的文件名：保证带 .mp3，仅作展示与回填匹配（后端不再据此解析时间）。 */
export function batchFileName(item: {fname: string}): string {
  return /\.mp3$/i.test(item.fname) ? item.fname : `${item.fname}.mp3`;
}

// 设备命名 → 录音时刻的纯解析工具在 mr20FileTime（无 RN 依赖，便于单测）；此处透传给现有引用方。
export {fileEpoch, itemEpoch, batchDate};

async function readInbox(): Promise<Mr20InboxItem[]> {
  const raw = await AsyncStorage.getItem(INBOX_KEY);
  if (!raw) {
    return [];
  }
  try {
    const arr = JSON.parse(raw) as Mr20InboxItem[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeInbox(items: Mr20InboxItem[]): Promise<void> {
  await AsyncStorage.setItem(INBOX_KEY, JSON.stringify(items));
}

export async function getInbox(): Promise<Mr20InboxItem[]> {
  const items = await readInbox();
  // 按录音（设备命名）时间倒序：新录音在前。历史条目命名解析不出时退回 createdAt。
  return items.sort((a, b) => itemEpoch(b) - itemEpoch(a));
}

/** 清空收件箱（配合 clearSyncedSet 做「清除本地缓存并重新同步」）。 */
export async function clearInbox(): Promise<void> {
  await AsyncStorage.removeItem(INBOX_KEY);
}

/**
 * 从收件箱删除指定条目（按 id），返回删除后的列表。不动「已同步集合」——
 * 故删掉的录音不会在下次同步时重新下载；本地 MP3 文件由调用方另行清理。
 */
export async function removeInboxItems(ids: string[]): Promise<Mr20InboxItem[]> {
  const idSet = new Set(ids);
  const next = (await readInbox()).filter(i => !idSet.has(i.id));
  await AsyncStorage.setItem(INBOX_KEY, JSON.stringify(next));
  return next.sort((a, b) => itemEpoch(b) - itemEpoch(a));
}

async function upsertInbox(item: Mr20InboxItem): Promise<void> {
  await upsertInboxMany([item]);
}

/**
 * 批量 upsert：只读一次、写一次整箱。批量同步收尾时用，避免每文件都读+写整个
 * inbox（原来 N 个文件是 O(N²) 的 AsyncStorage 往返，会卡住进度条）。
 */
export async function upsertInboxMany(incoming: Mr20InboxItem[]): Promise<void> {
  if (!incoming.length) {
    return;
  }
  const items = await readInbox();
  const idxById = new Map(items.map((it, i) => [it.id, i]));
  for (const item of incoming) {
    const idx = idxById.get(item.id);
    if (idx !== undefined) {
      items[idx] = item;
    } else {
      idxById.set(item.id, items.length);
      items.push(item);
    }
  }
  await writeInbox(items);
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise<void>(resolve =>
          setTimeout(() => resolve(), 500 * 2 ** attempt),
        );
      }
    }
  }
  throw lastErr;
}

/**
 * 仅把「已下载到手机」的文件登记进收件箱，状态 synced——**不**上传、**不**转写。
 * 真正的上传 + 批处理由用户手动触发。若该文件此前已 done，保留结果不回退。
 */
export async function recordSyncedFile(input: IngestInput): Promise<Mr20InboxItem> {
  const items = await readInbox();
  const id = `${input.dir}/${input.fname}`;
  const idx = items.findIndex(i => i.id === id);
  const existing = idx >= 0 ? items[idx] : undefined;
  if (existing && existing.status === 'done') {
    return existing;
  }
  const item: Mr20InboxItem = {
    id,
    dir: input.dir,
    fname: input.fname,
    localPath: input.localPath,
    seconds: input.seconds,
    sizeBytes: input.sizeBytes ?? existing?.sizeBytes,
    audioUrl: existing?.audioUrl,
    batchGroupId: existing?.batchGroupId,
    transcript: existing?.transcript,
    status: 'synced',
    // createdAt 用文件命名时间（录音时刻），使「我的录音」按录音时间排序；
    // 命名解析不出再退回当前（传输）时刻。历史条目保留原 createdAt。
    createdAt: existing?.createdAt ?? fileEpoch(input.dir, input.fname) ?? Date.now(),
  };
  if (idx >= 0) {
    items[idx] = item;
  } else {
    items.push(item);
  }
  await writeInbox(items); // 单次读+写，避免 recordSyncedFile 内再走 upsert 二次读
  return item;
}

/**
 * 把一条已落盘录音上传到 COS（复用 uploadAudioSegment），写回 audioUrl + status
 * uploaded。已经有 audioUrl 的直接复用、不重复上传。返回更新后的条目。
 */
export async function uploadSyncedFile(item: Mr20InboxItem): Promise<Mr20InboxItem> {
  let audioUrl = item.audioUrl;
  if (!audioUrl) {
    const ts = Date.now();
    const durationMs = Math.max(0, Math.round((item.seconds || 0) * 1000));
    // 用现算的本地绝对路径（当前 Documents + 相对路径），不信任持久化的 item.localPath——
    // 容器 UUID 会随重装/恢复变化导致旧绝对路径失效（读取本地录音失败）。
    const localPath = await resolveLocalPath(item);
    const res = await withRetry(() =>
      uploadAudioSegment(undefined, localPath, durationMs, ts),
    );
    audioUrl = res.result?.objectUrl as string | undefined;
    if (!audioUrl) {
      throw new Error('上传成功但未拿到 objectUrl');
    }
  }
  const updated: Mr20InboxItem = {
    ...item,
    audioUrl,
    status: 'uploaded',
    error: undefined,
  };
  await upsertInbox(updated);
  return updated;
}

/** 把一批条目标记为已进某批处理（status queued + batchGroupId）。 */
export async function markItemsQueued(
  ids: string[],
  groupId: string,
): Promise<void> {
  const items = await readInbox();
  const idSet = new Set(ids);
  for (const it of items) {
    if (idSet.has(it.id)) {
      it.status = 'queued';
      it.batchGroupId = groupId;
      it.error = undefined;
    }
  }
  await writeInbox(items);
}

/**
 * 把后端批处理结果回填到收件箱：按文件名（带 .mp3）匹配条目，写入转写文本，
 * completed→done / failed→error。返回回填命中的条目数。
 */
export async function applyBatchResult(
  groupId: string,
  results: AudioFileResult[],
): Promise<number> {
  const items = await readInbox();
  const byName = new Map<string, AudioFileResult>();
  for (const r of results) {
    if (r.fileName) {
      byName.set(r.fileName, r);
    }
  }
  let hit = 0;
  let changed = 0;
  for (const it of items) {
    const r = byName.get(batchFileName(it));
    if (!r) {
      continue;
    }
    hit += 1;
    const before = `${it.status}|${it.transcript ?? ''}|${it.error ?? ''}|${it.batchGroupId ?? ''}`;
    it.batchGroupId = groupId;
    if (r.status === 'failed') {
      it.status = 'error';
      it.error = r.errorMessage || '后端处理失败';
    } else {
      it.transcript = r.transcription || it.transcript;
      it.status = 'done';
      it.error = undefined;
    }
    const after = `${it.status}|${it.transcript ?? ''}|${it.error ?? ''}|${it.batchGroupId ?? ''}`;
    if (before !== after) {
      changed += 1;
    }
  }
  // 轮询中会反复以部分结果调用本函数，无变化时跳过写盘，避免每 tick 都刷 AsyncStorage。
  if (changed > 0) {
    await writeInbox(items);
  }
  return hit;
}
