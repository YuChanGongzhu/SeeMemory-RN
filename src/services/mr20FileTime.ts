/**
 * MR20 设备命名 → 录音时刻的纯解析工具（无 RN/存储依赖，便于单测）。
 *
 * 设备把当天录音放在日期文件夹 `dir`（`YYYY-MM-DD`）里，文件名 `fname` 结尾带
 * `HH-MM-SS`（时间段用 `-` 分隔），如 `2026-06-30 18-14-46.mp3` 或 `18-14-46.mp3`。
 * 这里统一解析出录音时刻，供列表排序、`/batch` event time、UI 展示共用。
 */

function formatEventTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * 从设备命名解析录音时刻（本地时区 epoch ms）。日期优先取自 `dir`；`dir` 无日期时
 * 退回 `fname` 前缀。时间取自 `fname` 结尾的 `HH-MM-SS`。解析不出返回 null。
 */
export function fileEpoch(dir: string, fname: string): number | null {
  const base = fname.replace(/\.mp3$/i, '').trim();
  const time = base.match(/(\d{2})-(\d{2})-(\d{2})$/); // 结尾的 HH-MM-SS
  if (!time) {
    return null;
  }
  const date =
    dir.match(/^(\d{4})-(\d{2})-(\d{2})$/) ??
    base.match(/^(\d{4})-(\d{2})-(\d{2})/); // 兜底：fname 前缀带日期
  if (!date) {
    return null;
  }
  const [, y, mo, d] = date;
  const [, h, mi, s] = time;
  const t = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  ).getTime();
  return Number.isFinite(t) ? t : null;
}

/** 收件箱条目用于排序 / 展示的录音时刻：优先文件命名时间，退回 createdAt（传输时刻）。 */
export function itemEpoch(item: {dir: string; fname: string; createdAt: number}): number {
  return fileEpoch(item.dir, item.fname) ?? item.createdAt;
}

/**
 * 后端 `/audio/batch` 必填的录制时刻（显式 event time），格式 `yyyy-MM-dd HH:mm:ss`。
 * 优先从设备命名（`dir` 日期 + `fname` 时间）解析，解析不出再退回 createdAt。
 */
export function batchDate(item: {dir: string; fname: string; createdAt: number}): string {
  const epoch = fileEpoch(item.dir, item.fname);
  return formatEventTime(new Date(epoch ?? item.createdAt));
}
