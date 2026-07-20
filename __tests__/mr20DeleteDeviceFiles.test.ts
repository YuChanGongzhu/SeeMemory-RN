/**
 * deleteDeviceFiles 单测 —— 删「设备上」的录音文件。
 * 它是对注入 client 的纯编排，故用假 client 覆盖：DELETE_ERR 继续 / 抛异常中断 /
 * 取消在文件边界生效，以及最关键的反向不变量：**绝不碰手机上已传输的录音**。
 */
// mr20Sync → mr20Storage 顶层 import 了 AsyncStorage（ESM，jest 不转译）。本测试不读写它，
// 内存桩即可。
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

import {deleteDeviceFiles} from '../src/services/mr20Sync';
import type {Mr20Client, Mr20File} from '../src/native/mr20/Mr20Client';
import {Mr20Native} from '../src/native/mr20/Mr20Native';
import * as storage from '../src/services/mr20Storage';
import * as ingest from '../src/services/mr20Ingest';

jest.mock('../src/native/mr20/Mr20Native', () => ({
  isMr20NativeAvailable: true,
  isMr20WifiAvailable: true,
  Mr20Native: {writeNoResponse: jest.fn(), deleteRelativePath: jest.fn()},
  mr20Emitter: {addListener: jest.fn(() => ({remove: () => {}}))},
}));

const file = (n: number): Mr20File => ({
  dir: '2025-08-13',
  fname: `rec00${n}.mp3`,
  seconds: 60,
  size: 1000 * n,
});

/** 假 client：只需要 deleteFile；impl 决定每次调用是成功/拒绝/抛。 */
const fakeClient = (impl: (dir: string, fname: string) => Promise<boolean>) => {
  const deleteFile = jest.fn(impl);
  return {client: {deleteFile} as unknown as Mr20Client, deleteFile};
};

beforeEach(() => jest.clearAllMocks());

describe('deleteDeviceFiles', () => {
  it('全部成功：逐条 ok，进度单调递增', async () => {
    const files = [file(1), file(2), file(3)];
    const {client, deleteFile} = fakeClient(async () => true);
    const seen: number[] = [];

    const results = await deleteDeviceFiles(client, files, {
      onProgress: p => seen.push(p.completed),
    });

    expect(deleteFile).toHaveBeenCalledTimes(3);
    expect(deleteFile).toHaveBeenCalledWith('2025-08-13', 'rec001.mp3');
    expect(results).toHaveLength(3);
    expect(results.every(r => r.ok)).toBe(true);
    // completed 只增不减，且最终等于总数
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen[seen.length - 1]).toBe(3);
  });

  it('DELETE_ERR（返回 false）：只记该条失败，后续文件照删', async () => {
    const files = [file(1), file(2), file(3)];
    const {client, deleteFile} = fakeClient(async (_d, f) => f !== 'rec002.mp3');

    const results = await deleteDeviceFiles(client, files);

    expect(deleteFile).toHaveBeenCalledTimes(3); // 没有提前中断
    expect(results.map(r => r.ok)).toEqual([true, false, true]);
    expect(results[1].error).toBeTruthy();
  });

  it('抛异常（断连/应答超时）：记录后中断，不再空烧后续文件的 8s 超时', async () => {
    const files = [file(1), file(2), file(3)];
    const {client, deleteFile} = fakeClient(async (_d, f) => {
      if (f === 'rec002.mp3') {
        throw new Error('设备应答超时');
      }
      return true;
    });

    const results = await deleteDeviceFiles(client, files);

    expect(deleteFile).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2); // < files.length ⇒ 调用方据此判断提前结束
    expect(results[1]).toMatchObject({ok: false, error: '设备应答超时'});
  });

  it('取消在文件边界生效', async () => {
    const files = [file(1), file(2), file(3), file(4)];
    let done = 0;
    const {client, deleteFile} = fakeClient(async () => {
      done += 1;
      return true;
    });

    const results = await deleteDeviceFiles(client, files, {
      shouldCancel: () => done >= 2,
    });

    expect(deleteFile).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
  });

  it('空输入：零调用', async () => {
    const {client, deleteFile} = fakeClient(async () => true);
    await expect(deleteDeviceFiles(client, [])).resolves.toEqual([]);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  // 守门员：删设备 ≠ 删手机。这条断言防的是「已传输录音必须存活」被悄悄改坏。
  it('绝不动手机上的已同步集合 / 收件箱 / 本地文件', async () => {
    const markSynced = jest.spyOn(storage, 'markSynced');
    const removeInboxItems = jest.spyOn(ingest, 'removeInboxItems');
    const {client} = fakeClient(async () => true);

    await deleteDeviceFiles(client, [file(1), file(2)]);

    expect(markSynced).not.toHaveBeenCalled();
    expect(removeInboxItems).not.toHaveBeenCalled();
    expect(Mr20Native.deleteRelativePath).not.toHaveBeenCalled();
  });
});
