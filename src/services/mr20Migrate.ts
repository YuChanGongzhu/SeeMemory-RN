/**
 * MR20 历史数据迁移：把**旧全局**（不绑账号）的本地记忆粒数据一次性归到当前登录账号下。
 *
 * 背景：改造前 inbox/paired/synced/batch/alias/autodl 用全局 key、录音文件在扁平
 * `Documents/mr20/`，均不绑账号。加了账号分区后，登录账号读的是 `…:u:<userId>:*`
 * 与 `mr20/u_<userId>/`，故这些历史数据在新账号视角下「消失」了——它们还在，只是没归属。
 *
 * 本模块提供**用户手动触发**（点按钮）的迁移：把全局 key 搬到该 userId 的 scoped key，
 * 并把整个旧 `mr20` 目录物理搬进 `mr20/u_<userId>`（原生 moveRelativePath）。迁移是
 * 幂等的（全局标记守卫），只发生一次。
 *
 * ⚠️ 已知局限：改造前设备是全局共享的，无法区分这些历史录音原本属于谁——它们会**整体**
 * 归到「点迁移按钮的这个账号」。若此前多个账号在同一台手机上共用过记忆粒，这份历史数据
 * 也只能整体归一。按钮文案需向用户说明这一点。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LEGACY_FILE_ROOT,
  fileRootForUser,
  keyForUser,
  legacyKey,
} from './mr20Scope';
import {moveDir} from './mr20Sync';

// 需要搬迁的全局存储项（与 mr20Ingest/mr20Storage/HardwarePage 里的 base 名一致）。
const MIGRATABLE_BASES = [
  'inbox',
  'paired',
  'synced',
  'batch',
  'alias',
  'autodl',
] as const;

// 一次性迁移标记（**全局**，每台设备只跑一次；迁移后按钮不再出现）。
const MIGRATED_FLAG = legacyKey('migrated'); // '@ringmemory:mr20:migrated'

/** 原生 moveRelativePath 未链接（旧二进制未重新构建）时抛此错，UI 据此提示「需更新 App」。 */
export class Mr20MigrateNeedsRebuildError extends Error {
  constructor() {
    super('记忆粒文件迁移需要更新 App：请更新到最新版本后重试。');
    this.name = 'Mr20MigrateNeedsRebuildError';
  }
}

/** 读旧全局 inbox 的条数（不解析排序，仅计数，供发现性/按钮文案用）。 */
async function legacyInboxCount(): Promise<number> {
  const raw = await AsyncStorage.getItem(legacyKey('inbox'));
  if (!raw) {
    return 0;
  }
  try {
    const arr = JSON.parse(raw) as unknown[];
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

/**
 * 迁移发现信息：是否已迁移 + 旧全局 inbox 条数。
 * 按钮仅在 `!migrated && count > 0` 时出现。
 */
export async function getLegacyMigrationInfo(): Promise<{
  migrated: boolean;
  count: number;
}> {
  const [flag, count] = await Promise.all([
    AsyncStorage.getItem(MIGRATED_FLAG),
    legacyInboxCount(),
  ]);
  return {migrated: flag != null, count};
}

/**
 * 把全局 MR20 数据迁到指定 userId 名下。幂等。
 * 顺序：先物理搬文件（失败/未链接则整体中止，不动 key，按钮保留），再搬 AsyncStorage
 * key，最后置标记——避免「key 已迁但文件还在旧目录」的半迁移不一致。
 * 返回迁移的 inbox 条数（供 UI 反馈）。
 */
export async function migrateLegacyToScope(userId: string): Promise<number> {
  if (!userId) {
    return 0;
  }
  // 幂等守卫。
  if ((await AsyncStorage.getItem(MIGRATED_FLAG)) != null) {
    return 0;
  }

  const count = await legacyInboxCount();

  // 1) 先搬文件：mr20 → mr20/u_<userId>。原生未链接返回 false → 抛错中止（不动 key）。
  const moved = await moveDir(LEGACY_FILE_ROOT, fileRootForUser(userId));
  if (!moved) {
    throw new Mr20MigrateNeedsRebuildError();
  }

  // 2) 搬 AsyncStorage key：读全局 → 写该 userId 的 scoped key → 删全局。
  //    按传入 userId **显式**构造目标 key，不依赖当前内存作用域，避免时序 bug。
  for (const base of MIGRATABLE_BASES) {
    const from = legacyKey(base);
    const raw = await AsyncStorage.getItem(from);
    if (raw == null) {
      continue;
    }
    await AsyncStorage.setItem(keyForUser(userId, base), raw);
    await AsyncStorage.removeItem(from);
  }

  // 3) 置迁移标记（幂等来源）。
  await AsyncStorage.setItem(MIGRATED_FLAG, '1');
  return count;
}
