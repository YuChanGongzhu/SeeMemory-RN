/**
 * mr20Scope：作用域键/路径的拼装。
 * - scope=null 回退旧全局 key/扁平目录（＝改造前行为，保证过渡/未迁移不丢数据）；
 * - scope=userId 加 `u:<id>` 前缀 / `mr20/u_<id>` 目录；
 * - keyForUser/fileRootForUser 按显式 userId 构造，不依赖当前内存作用域（迁移用）。
 */
import {
  setMr20Scope,
  getMr20Scope,
  scopedKey,
  scopedFileRoot,
  keyForUser,
  fileRootForUser,
  legacyKey,
  LEGACY_FILE_ROOT,
} from '../src/services/mr20Scope';

afterEach(() => setMr20Scope(null));

describe('mr20Scope', () => {
  test('scope=null → 旧全局 key/扁平目录', () => {
    setMr20Scope(null);
    expect(getMr20Scope()).toBeNull();
    expect(scopedKey('inbox')).toBe('@ringmemory:mr20:inbox');
    expect(scopedFileRoot()).toBe('mr20');
  });

  test('scope=userId → 带前缀 key / u_ 目录', () => {
    setMr20Scope('u42');
    expect(getMr20Scope()).toBe('u42');
    expect(scopedKey('inbox')).toBe('@ringmemory:mr20:u:u42:inbox');
    expect(scopedKey('paired')).toBe('@ringmemory:mr20:u:u42:paired');
    expect(scopedFileRoot()).toBe('mr20_u_u42');
  });

  test('空串 userId 视为无作用域', () => {
    setMr20Scope('');
    expect(getMr20Scope()).toBeNull();
    expect(scopedKey('batch')).toBe('@ringmemory:mr20:batch');
  });

  test('keyForUser/fileRootForUser 不依赖当前作用域', () => {
    setMr20Scope('someoneElse');
    expect(keyForUser('u7', 'synced')).toBe('@ringmemory:mr20:u:u7:synced');
    expect(fileRootForUser('u7')).toBe('mr20_u_u7');
    // 当前作用域不受影响
    expect(getMr20Scope()).toBe('someoneElse');
  });

  test('legacyKey / LEGACY_FILE_ROOT 恒为旧全局形态', () => {
    setMr20Scope('u42');
    expect(legacyKey('inbox')).toBe('@ringmemory:mr20:inbox');
    expect(LEGACY_FILE_ROOT).toBe('mr20');
  });
});
