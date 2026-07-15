/**
 * applyBatchResult 增量回填：轮询中会以「部分结果」反复调用，需保证
 * 1) 只回填命中的条目，未在 results 里的保持原状；
 * 2) failed→error / completed→done + 写入转写；
 * 3) 无变化时不再写盘（避免每 tick 刷 AsyncStorage）。
 */

// 内存版 AsyncStorage，并记录 setItem 次数以验证「无变化不写盘」。
const store: Record<string, string> = {};
let setItemCalls = 0;
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in store ? store[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => {
      setItemCalls += 1;
      store[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete store[k];
    }),
  },
}));

// mr20Ingest 顶层 import 了 ./api（含 RN 网络），本测试不触及，mock 掉即可。
jest.mock('../src/services/api', () => ({
  uploadAudioSegment: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {applyBatchResult, type Mr20InboxItem} from '../src/services/mr20Ingest';
import type {AudioFileResult} from '../src/services/audioBatch';

const INBOX_KEY = '@ringmemory:mr20:inbox';

function item(fname: string, over: Partial<Mr20InboxItem> = {}): Mr20InboxItem {
  return {
    id: `dir/${fname}`,
    dir: 'dir',
    fname,
    localPath: `/tmp/${fname}`,
    seconds: 60,
    status: 'queued',
    createdAt: 0,
    ...over,
  };
}

function result(fname: string, over: Partial<AudioFileResult> = {}): AudioFileResult {
  return {fileName: `${fname}.mp3`, status: 'completed', transcription: `T-${fname}`, ...over} as AudioFileResult;
}

async function seed(items: Mr20InboxItem[]) {
  for (const k of Object.keys(store)) {
    delete store[k];
  }
  store[INBOX_KEY] = JSON.stringify(items);
  setItemCalls = 0;
  (AsyncStorage.setItem as jest.Mock).mockClear();
}

async function readBack(): Promise<Mr20InboxItem[]> {
  return JSON.parse(store[INBOX_KEY]) as Mr20InboxItem[];
}

describe('applyBatchResult 增量回填', () => {
  test('部分结果只回填命中条目，其余保持 queued', async () => {
    await seed([item('a'), item('b'), item('c')]);

    const hit = await applyBatchResult('g1', [result('a')]);

    expect(hit).toBe(1);
    const inbox = await readBack();
    const byFname = Object.fromEntries(inbox.map(i => [i.fname, i]));
    expect(byFname.a.status).toBe('done');
    expect(byFname.a.transcript).toBe('T-a');
    expect(byFname.a.batchGroupId).toBe('g1');
    expect(byFname.b.status).toBe('queued');
    expect(byFname.b.transcript).toBeUndefined();
    expect(byFname.c.status).toBe('queued');
  });

  test('failed → error 并带错误信息', async () => {
    await seed([item('a')]);

    await applyBatchResult('g1', [result('a', {status: 'failed', errorMessage: '识别为空'})]);

    const [a] = await readBack();
    expect(a.status).toBe('error');
    expect(a.error).toBe('识别为空');
    expect(a.transcript).toBeUndefined();
  });

  test('无变化的重复调用不再写盘', async () => {
    await seed([item('a'), item('b')]);

    // 第一次：a 完成 → 有变化 → 写盘一次
    await applyBatchResult('g1', [result('a')]);
    expect((AsyncStorage.setItem as jest.Mock).mock.calls.length).toBe(1);

    // 第二次：同样的部分结果，a 已是 done+同转写 → 无变化 → 不写盘
    await applyBatchResult('g1', [result('a')]);
    expect((AsyncStorage.setItem as jest.Mock).mock.calls.length).toBe(1);

    // 第三次：新增 b 完成 → 有变化 → 再写一次
    await applyBatchResult('g1', [result('a'), result('b')]);
    expect((AsyncStorage.setItem as jest.Mock).mock.calls.length).toBe(2);

    const inbox = await readBack();
    expect(inbox.every(i => i.status === 'done')).toBe(true);
  });
});
