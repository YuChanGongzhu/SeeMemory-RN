/**
 * 【临时调试设施】OTA 过程日志：内存环形缓冲 + 订阅。
 *
 * OTA 失败的代价是设备卡在等待态、需断电重启，而现场只能看到一句「升级失败」，
 * 无从判断断在下载、校验、就绪应答还是帧传输。这里把每一步记下来供面板展示/导出。
 * 真机验证收敛后，连同 OtaLogPanel 一并删除即可（otaLog 调用点是纯副作用，删了不影响逻辑）。
 */

export type OtaLogLevel = 'info' | 'warn' | 'error';

export interface OtaLogEntry {
  t: number;
  level: OtaLogLevel;
  msg: string;
}

/** 帧级日志量大，限长防止长时间停留把内存吃满。 */
const MAX_ENTRIES = 300;

let entries: OtaLogEntry[] = [];
const listeners = new Set<(list: OtaLogEntry[]) => void>();

const emit = () => {
  const snapshot = entries;
  listeners.forEach(fn => fn(snapshot));
};

export const otaLog = (msg: string, level: OtaLogLevel = 'info') => {
  // 整个数组换新引用，订阅方靠引用变化触发重渲染。
  entries = entries.concat({t: Date.now(), level, msg}).slice(-MAX_ENTRIES);
  if (__DEV__) {
    const tag = level === 'error' ? '[OTA][ERR]' : level === 'warn' ? '[OTA][WARN]' : '[OTA]';
    console.log(tag, msg);
  }
  emit();
};

export const clearOtaLog = () => {
  entries = [];
  emit();
};

export const subscribeOtaLog = (fn: (list: OtaLogEntry[]) => void) => {
  listeners.add(fn);
  fn(entries);
  return () => {
    listeners.delete(fn);
  };
};

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** 时:分:秒.毫秒 —— 帧间隔是 20ms 量级，秒级精度不够看。 */
export const formatOtaTime = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

/** 导出成纯文本，附相对首条的耗时，便于贴给固件同事定位卡在哪一步。 */
export const formatOtaLog = (list: OtaLogEntry[]) => {
  if (!list.length) {
    return '';
  }
  const start = list[0].t;
  return list
    .map(e => {
      const delta = `+${((e.t - start) / 1000).toFixed(2)}s`;
      const level = e.level === 'info' ? '' : `[${e.level.toUpperCase()}] `;
      return `${formatOtaTime(e.t)} ${delta.padStart(8)} ${level}${e.msg}`;
    })
    .join('\n');
};
