/**
 * MR20 设备命名 → 录音时刻解析（排序 / /batch event time 一致性）。
 */
import {fileEpoch, itemEpoch, batchDate} from '../src/services/mr20FileTime';

describe('mr20Ingest 文件命名时间解析', () => {
  const epochOf = (y: number, mo: number, d: number, h: number, mi: number, s: number) =>
    new Date(y, mo - 1, d, h, mi, s).getTime();

  test('fileEpoch：fname 自带完整日期时间', () => {
    expect(fileEpoch('2026-06-30', '2026-06-30 18-14-46.mp3')).toBe(
      epochOf(2026, 6, 30, 18, 14, 46),
    );
  });

  test('fileEpoch：日期取自 dir（fname 只带时间）', () => {
    expect(fileEpoch('2026-06-30', '18-14-46.mp3')).toBe(
      epochOf(2026, 6, 30, 18, 14, 46),
    );
  });

  test('fileEpoch：dir 无日期时退回 fname 前缀日期', () => {
    expect(fileEpoch('', '2026-01-02 09-16-48.mp3')).toBe(
      epochOf(2026, 1, 2, 9, 16, 48),
    );
  });

  test('fileEpoch：解析不出返回 null', () => {
    expect(fileEpoch('misc', 'note.mp3')).toBeNull();
  });

  test('itemEpoch：解析不出时退回 createdAt', () => {
    const createdAt = 1_700_000_000_000;
    expect(itemEpoch({dir: 'misc', fname: 'note.mp3', createdAt})).toBe(createdAt);
  });

  test('batchDate：始终回传文件命名时间（yyyy-MM-dd HH:mm:ss）', () => {
    expect(
      batchDate({dir: '2026-06-30', fname: '18-14-46.mp3', createdAt: 0}),
    ).toBe('2026-06-30 18:14:46');
  });
});
