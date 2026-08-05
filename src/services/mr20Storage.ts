/**
 * MR20 本地持久化：已配对设备（含 16 位密钥，用于自动重连）+ 已同步文件集合。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {scopedKey} from './mr20Scope';

// 各 key 按当前登录账号取作用域（scope=null 时回退旧全局 key）。必须在**调用点**现取，
// 不能在模块加载时求值——作用域会随登录/退登在运行时切换。
const KEYS = {
  PAIRED: () => scopedKey('paired'),
  SYNCED: () => scopedKey('synced'),
  BATCH: () => scopedKey('batch'), // 当前/最近一次提交的后端批处理 groupId
  WIFI_PWD: () => scopedKey('wifiPwd'), // 用户设置/确认过的热点密码（= SK 8 位密钥）
  WIFI_PROV: () => scopedKey('wifiProv'), // 已成功跑过 SK+WIFI&CH 初始化的那把密钥
  BATCH_TRACKING: () => scopedKey('batch_tracking_v2'), // 新 App 轮询用；旧 App 忽略
};

export interface Mr20PairedDevice {
  id: string; // ble-plx 设备 id
  name: string;
  mac?: string;
  key: string; // 16 位绑定密钥
}

export async function savePairedDevice(device: Mr20PairedDevice): Promise<void> {
  await AsyncStorage.setItem(KEYS.PAIRED(), JSON.stringify(device));
}

export async function getPairedDevice(): Promise<Mr20PairedDevice | null> {
  const raw = await AsyncStorage.getItem(KEYS.PAIRED());
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
  await AsyncStorage.removeItem(KEYS.PAIRED());
}

// ---------------------------------------------------------------------------
// 热点密码（= SK 8 位绑定密钥，见 protocol.ts 的 Cmd.syncWifiPassword）
// ---------------------------------------------------------------------------

/**
 * 存用户初始化/手填过的热点密码。
 *
 * 为什么要本地存一份而不是每次现问设备：`GJJY_BLE&WIFI` 回的 PWD 在部分固件上是**旧值/默认值**，
 * 拿它去 NEHotspotConfiguration 入网就得到 iOS 那句「无法加入网络 YLF20_xxxx」。
 * 用户在 App 里亲手设过的值最可信，故入网时优先用这里的，设备回的只作兜底。
 */
export async function saveWifiPassword(pwd: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.WIFI_PWD(), pwd);
}

export async function getWifiPassword(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.WIFI_PWD());
}

export async function clearWifiPassword(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.WIFI_PWD());
}

/**
 * 记下「已经对这把密钥跑过 SK + WIFI&CH 初始化」。
 *
 * 存的是**密钥本身而不是布尔值**：换密码后旧标记必须自动失效，否则会拿新密码去连按旧密码
 * 配的热点。判定就是 `getWifiProvisionedKey() === 要用的密钥`。
 *
 * 为什么要记：WIFI&CH 每跑一次要 10s 还会把 WiFi 模组复位一遍（协议 0801），
 * 每次快传都跑等于白搭 10 秒。而它是一次性的——固件方原话是「第一次发 SK 设置之后」。
 * 入网全部失败时会清掉这个标记，下次自动重跑，避免设备被恢复出厂后永远卡在旧结论上。
 */
export async function saveWifiProvisionedKey(key: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.WIFI_PROV(), key);
}

export async function getWifiProvisionedKey(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.WIFI_PROV());
}

export async function clearWifiProvisionedKey(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.WIFI_PROV());
}

// ---------------------------------------------------------------------------
// 已同步文件集合（key = `${dir}/${fname}`）
// ---------------------------------------------------------------------------

function fileKey(dir: string, fname: string): string {
  return `${dir}/${fname}`;
}

export async function getSyncedSet(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(KEYS.SYNCED());
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
  await AsyncStorage.setItem(KEYS.SYNCED(), JSON.stringify([...set]));
}

/** 清空「已同步」集合，使下次同步重新拉取全部文件（修了解码 bug 后需重拉）。 */
export async function clearSyncedSet(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.SYNCED());
}

// ---------------------------------------------------------------------------
// 当前后端批处理 groupId（持久化，App 重启后仍能续看进度/结果）
// ---------------------------------------------------------------------------

export async function saveBatchGroupId(groupId: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.BATCH(), groupId);
}

export async function getBatchGroupId(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.BATCH());
}

/**
 * 保存新版 App 实际需要轮询的 ID。canonical groupId 仍单独写入旧 key，
 * 保证旧版 App / App 回滚后能继续按 manager-api 的聚合 ID 查询。
 */
export async function saveBatchTrackingGroupIds(
  groupId: string,
  pollingGroupIds: string[],
): Promise<void> {
  await AsyncStorage.setItem(
    KEYS.BATCH_TRACKING(),
    JSON.stringify({groupId, pollingGroupIds}),
  );
}

/** 读取并校验新版轮询信息；旧数据、损坏数据一律安全回退到 canonical groupId。 */
export async function getBatchTrackingGroupIds(
  groupId: string,
): Promise<string[]> {
  const raw = await AsyncStorage.getItem(KEYS.BATCH_TRACKING());
  if (!raw) {
    return [groupId];
  }
  try {
    const parsed = JSON.parse(raw) as {
      groupId?: unknown;
      pollingGroupIds?: unknown;
    };
    if (parsed.groupId !== groupId || !Array.isArray(parsed.pollingGroupIds)) {
      return [groupId];
    }
    const ids = [...new Set(parsed.pollingGroupIds.filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0,
    ))];
    return ids.length ? ids : [groupId];
  } catch {
    return [groupId];
  }
}

export async function clearBatchGroupId(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(KEYS.BATCH()),
    AsyncStorage.removeItem(KEYS.BATCH_TRACKING()),
  ]);
}
