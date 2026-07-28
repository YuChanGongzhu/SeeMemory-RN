/**
 * MR20 本地数据的「账号作用域」内存单例。
 *
 * 记忆粒的本地存储（inbox / paired / synced / batch / alias / autodl 等 AsyncStorage
 * key，以及 Documents 下的录音文件目录）原本是**设备级全局**的——不绑登录账号，导致
 * A 退登、B 登录后能看到并播放 A 的录音、还会自动重连 A 的设备。本模块给这些本地数据
 * 加一个 userId 维度：登录谁就把 key/路径打上谁的前缀，跨账号天然隔离。
 *
 * 服务层（mr20Ingest/mr20Storage/mr20Sync）是纯模块、非 React，拿不到 AuthContext，
 * 故用这个内存单例同步读取当前作用域（仿 apis/core/session.ts 的 authToken 单例）。
 * AuthContext 负责在 hydrate/login/logout 时调用 setMr20Scope。
 *
 * ⚠️ scope=null（未登录/hydrate 未完成/迁移前）时刻意回退到**旧全局** key/路径，
 * 使行为完全等于改造前——保证过渡期与「历史数据尚未迁移」时读得到既有数据、不丢。
 */

const PREFIX = '@ringmemory:mr20';

let currentUserId: string | null = null;

export function setMr20Scope(userId: string | null): void {
  currentUserId = userId || null;
}

export function getMr20Scope(): string | null {
  return currentUserId;
}

/**
 * 某个本地存储项的 AsyncStorage key。
 * - 无作用域：`@ringmemory:mr20:<base>`（旧全局 key，等于现状）。
 * - 有作用域：`@ringmemory:mr20:u:<userId>:<base>`。
 */
export function scopedKey(base: string): string {
  return currentUserId
    ? `${PREFIX}:u:${currentUserId}:${base}`
    : `${PREFIX}:${base}`;
}

/**
 * 录音文件在 Documents 下的根目录（相对路径）。
 * - 无作用域：`mr20`（旧扁平目录，等于现状）。
 * - 有作用域：`mr20_u_<userId>`。
 * ⚠️ 刻意用旧 `mr20` 的**同级**目录、而非其子目录 `mr20/u_<id>`——迁移是把整个 `mr20`
 * 目录搬过去，而 FileManager 不允许把目录移动进它自己的子目录（会报
 * "mr20 couldn't be moved to mr20"）。同级目录之间搬移才合法。
 */
export function scopedFileRoot(): string {
  return currentUserId ? `mr20_u_${currentUserId}` : 'mr20';
}

/** 迁移用：为**指定** userId 显式构造 key/路径，不依赖当前内存作用域（避免时序 bug）。 */
export function keyForUser(userId: string, base: string): string {
  return `${PREFIX}:u:${userId}:${base}`;
}

export function legacyKey(base: string): string {
  return `${PREFIX}:${base}`;
}

export function fileRootForUser(userId: string): string {
  return `mr20_u_${userId}`;
}

export const LEGACY_FILE_ROOT = 'mr20';
