/**
 * mr20Migrate：把旧全局（不绑账号）MR20 数据一次性归入当前账号。
 * - 成功：全局 key → `u:<id>` scoped key，删全局，置迁移标记，返回条数；
 * - 幂等：已迁移后再调返回 0、不动数据；
 * - 原生未链接（moveDir=false）：抛 Mr20MigrateNeedsRebuildError，且**不动 key/不置标记**
 *   （避免 key 已迁但文件还在旧目录的半迁移不一致）。
 */

// 内存版 AsyncStorage。
const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in store ? store[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete store[k];
    }),
  },
}));

// 隔离掉文件搬移（真实实现依赖原生）：用可控 mock 验证成功/未链接两条路径。
jest.mock('../src/services/mr20Sync', () => ({
  moveDir: jest.fn(),
}));

import {moveDir} from '../src/services/mr20Sync';
import {
  getLegacyMigrationInfo,
  migrateLegacyToScope,
  Mr20MigrateNeedsRebuildError,
} from '../src/services/mr20Migrate';

const G = (base: string) => `@ringmemory:mr20:${base}`;
const U = (id: string, base: string) => `@ringmemory:mr20:u:${id}:${base}`;
const MARKER = '@ringmemory:mr20:migrated';

function reset() {
  for (const k of Object.keys(store)) {
    delete store[k];
  }
  (moveDir as jest.Mock).mockReset();
}

beforeEach(reset);

function seedLegacy() {
  store[G('inbox')] = JSON.stringify([{id: 'a'}, {id: 'b'}]);
  store[G('paired')] = JSON.stringify({id: 'dev', key: 'k'});
  store[G('synced')] = JSON.stringify(['a', 'b']);
  store[G('alias')] = '我的记忆粒';
}

describe('getLegacyMigrationInfo', () => {
  test('未迁移 + 旧 inbox 条数', async () => {
    seedLegacy();
    expect(await getLegacyMigrationInfo()).toEqual({migrated: false, count: 2});
  });

  test('已迁移标记 → migrated:true', async () => {
    store[MARKER] = '1';
    expect((await getLegacyMigrationInfo()).migrated).toBe(true);
  });

  test('无旧数据 → count 0', async () => {
    expect(await getLegacyMigrationInfo()).toEqual({migrated: false, count: 0});
  });
});

describe('migrateLegacyToScope', () => {
  test('成功：全局→scoped、删全局、置标记、返回条数', async () => {
    seedLegacy();
    (moveDir as jest.Mock).mockResolvedValue(true);

    const n = await migrateLegacyToScope('u42');

    expect(n).toBe(2);
    expect(moveDir).toHaveBeenCalledWith('mr20', 'mr20_u_u42');
    // 全局已清
    expect(store[G('inbox')]).toBeUndefined();
    expect(store[G('paired')]).toBeUndefined();
    expect(store[G('synced')]).toBeUndefined();
    expect(store[G('alias')]).toBeUndefined();
    // scoped 已写入且内容一致
    expect(JSON.parse(store[U('u42', 'inbox')])).toHaveLength(2);
    expect(store[U('u42', 'alias')]).toBe('我的记忆粒');
    // 标记已置
    expect(store[MARKER]).toBe('1');
  });

  test('幂等：已迁移后再调返回 0、不再搬', async () => {
    store[MARKER] = '1';
    store[G('inbox')] = JSON.stringify([{id: 'x'}]);
    (moveDir as jest.Mock).mockResolvedValue(true);

    const n = await migrateLegacyToScope('u42');

    expect(n).toBe(0);
    expect(moveDir).not.toHaveBeenCalled();
    expect(store[G('inbox')]).toBeDefined(); // 未动
  });

  test('原生未链接：抛错且不动 key/不置标记', async () => {
    seedLegacy();
    (moveDir as jest.Mock).mockResolvedValue(false);

    await expect(migrateLegacyToScope('u42')).rejects.toBeInstanceOf(
      Mr20MigrateNeedsRebuildError,
    );

    expect(store[G('inbox')]).toBeDefined(); // 全局仍在
    expect(store[U('u42', 'inbox')]).toBeUndefined(); // 未写 scoped
    expect(store[MARKER]).toBeUndefined(); // 未置标记 → 按钮保留
  });

  test('空 userId 直接返回 0', async () => {
    seedLegacy();
    expect(await migrateLegacyToScope('')).toBe(0);
    expect(moveDir).not.toHaveBeenCalled();
  });
});
