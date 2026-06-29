/**
 * MR20 本地持久化：已配对设备（含 16 位密钥，用于自动重连）+ 已同步文件集合。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  PAIRED: '@ringmemory:mr20:paired',
  SYNCED: '@ringmemory:mr20:synced',
  BATCH: '@ringmemory:mr20:batch', // 当前/最近一次提交的后端批处理 groupId
};

export interface Mr20PairedDevice {
  id: string; // ble-plx 设备 id
  name: string;
  mac?: string;
  key: string; // 16 位绑定密钥
}

export async function savePairedDevice(device: Mr20PairedDevice): Promise<void> {
  await AsyncStorage.setItem(KEYS.PAIRED, JSON.stringify(device));
}

export async function getPairedDevice(): Promise<Mr20PairedDevice | null> {
  const raw = await AsyncStorage.getItem(KEYS.PAIRED);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Mr20PairedDevice>;
    if (!parsed.id || !parsed.key) {
      return null;
    }
    return {
      id: parsed.id,
      name: parsed.name || '记忆粒',
      mac: parsed.mac,
      key: parsed.key,
    };
  } catch {
    return null;
  }
}

export async function clearPairedDevice(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.PAIRED);
}

// ---------------------------------------------------------------------------
// 已同步文件集合（key = `${dir}/${fname}`）
// ---------------------------------------------------------------------------

function fileKey(dir: string, fname: string): string {
  return `${dir}/${fname}`;
}

export async function getSyncedSet(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(KEYS.SYNCED);
  if (!raw) {
    return new Set();
  }
  try {
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export async function isSynced(dir: string, fname: string): Promise<boolean> {
  const set = await getSyncedSet();
  return set.has(fileKey(dir, fname));
}

export async function markSynced(dir: string, fname: string): Promise<void> {
  const set = await getSyncedSet();
  set.add(fileKey(dir, fname));
  await AsyncStorage.setItem(KEYS.SYNCED, JSON.stringify([...set]));
}

/** 清空「已同步」集合，使下次同步重新拉取全部文件（修了解码 bug 后需重拉）。 */
export async function clearSyncedSet(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.SYNCED);
}

// ---------------------------------------------------------------------------
// 当前后端批处理 groupId（持久化，App 重启后仍能续看进度/结果）
// ---------------------------------------------------------------------------

export async function saveBatchGroupId(groupId: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.BATCH, groupId);
}

export async function getBatchGroupId(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.BATCH);
}

export async function clearBatchGroupId(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.BATCH);
}
