/**
 * 录音时长/大小的人类可读格式化（自适应量级）。
 * 设备录音常是几秒、几十 KB，用「分钟/MB」会全被截成 0，故短的用「秒/KB」。
 */

/** 时长（秒）→ <60s「X 秒」；<1h「M 分[ S 秒]」；否则「H 小时 M 分」。 */
export function fmtDurationHuman(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  if (s < 60) {
    return `${s} 秒`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h} 小时 ${m} 分`;
  }
  return sec ? `${m} 分 ${sec} 秒` : `${m} 分钟`;
}

/** 文件大小（字节）→ <1MB 用 KB，否则 MB（≥100MB 取整）。 */
export function fmtSize(bytes: number): string {
  const b = Math.max(0, bytes || 0);
  if (b < 1024 * 1024) {
    return `${Math.round(b / 1024)}KB`;
  }
  const mb = b / (1024 * 1024);
  return mb >= 100 ? `${Math.round(mb)}MB` : `${mb.toFixed(1)}MB`;
}
