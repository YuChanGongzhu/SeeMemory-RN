import {searchMemoryFragments, type MemoryFragment} from '../requests/memory';
import type {MemoryCard, TimelineRecord} from '../../types/memory';

/** Minutes-since-midnight for sorting; non-time labels sort last. */
export function parseTime(t?: string): number {
  if (!t) return -1;
  const m = t.match(/(\d{1,2}):(\d{2})/);
  if (!m) return t.includes('刚刚') ? 24 * 60 + 1 : -1;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function shortTime(time?: string): string {
  if (!time) return '';
  const part = time.split(' ')[1] || '';
  return part.split(':').slice(0, 2).join(':');
}

/** 'YYYY-MM-DD HH:MM:SS' → '今天 HH:MM' / '昨天 HH:MM' / 'YYYY.MM.DD HH:MM'（含空格，供 feed 分组）。 */
export function formatFragmentTime(ts?: string): string {
  if (!ts) return '';
  const [datePart, timePart = ''] = ts.split(' ');
  const hhmm = timePart.split(':').slice(0, 2).join(':');
  const today = new Date();
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (datePart === fmt(today)) return `今天 ${hhmm}`;
  if (datePart === fmt(yesterday)) return `昨天 ${hhmm}`;
  return `${datePart.replace(/-/g, '.')} ${hhmm}`;
}

/** files[].meta.duration_ms（毫秒）→ 'm:ss'；无效返回 undefined（时间流回落 0:00）。 */
export function durationFromMeta(meta: Record<string, unknown> | null): string | undefined {
  const raw = meta?.duration_ms;
  const ms = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!isFinite(ms) || ms <= 0) {
    return undefined;
  }
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 记忆碎片 → 首页/详情页共用的 MemoryCard 模型。 */
export function fragmentToCard(f: MemoryFragment): MemoryCard {
  const files = f.files || [];
  const imageFiles = files.filter(m => m.mime_type?.startsWith('image'));
  const audioFiles = files.filter(m => m.mime_type?.startsWith('audio'));
  const images = imageFiles.map(m => m.url);

  // 时间流：AI 概要 → 文本节点（默认「高光」视图）；图片 files → 图片节点、录音 files → 音频节点
  // （「全量」视图里图片直接铺图、录音可播放），转写/描述放在 content，仿原型 renderTimelineNode。
  const timeline = f.timeline || [];
  const records: TimelineRecord[] = timeline.map((t, i) => ({
    id: i,
    time: t.time,
    type: 'text',
    content: t.content,
  }));
  // files 无独立时间，按序等比锚定到概要时间点，保证「全量」视图里大致按时序排列。
  const anchorTime = (i: number, count: number) =>
    timeline.length
      ? timeline[Math.min(timeline.length - 1, Math.floor((i * timeline.length) / count))].time
      : shortTime(f.start_time);
  imageFiles.forEach((m, i) => {
    records.push({
      id: timeline.length + i,
      time: anchorTime(i, imageFiles.length),
      type: 'image',
      url: m.url,
      content: m.description || undefined,
      name: m.file_name || undefined,
    });
  });
  audioFiles.forEach((m, i) => {
    records.push({
      id: timeline.length + imageFiles.length + i,
      time: anchorTime(i, audioFiles.length),
      type: 'audio',
      name: `语音记录 ${i + 1}`,
      content: m.description || undefined,
      url: m.url,
      duration: durationFromMeta(m.meta),
    });
  });
  const timelineRecords = records.sort((a, b) => parseTime(a.time) - parseTime(b.time));

  return {
    id: f.id,
    type: 'memory',
    tag: f.keywords?.[0] || '记忆',
    time: formatFragmentTime(f.start_time),
    title: f.title,
    content: f.brief,
    hasAI: true,
    tags: f.keywords || [],
    images: images.length ? images : undefined,
    image: images[0],
    audioCount: audioFiles.length || undefined,
    updateTime: shortTime(f.update_time) || undefined,
    timelineRecords,
  };
}

type EventRecall = {time_range: string; title: string; count: number; fragment_ids?: string[]};

/**
 * 事件回溯「钻取源文件」：把一个事件组的 fragment_ids 拉成一张合并的 MemoryCard，供详情页展示。
 * 后端无「按 id 取碎片」接口，故取最新一页碎片（今日碎片按 start_time 倒序必在最前）再按 id 过滤；
 * 组内多个碎片的时间流合并、按时间重排。无 fragment_ids 或过滤为空则返回 null（调用方给空提示，不跳转）。
 */
export async function loadEventDrillCard(recall: EventRecall): Promise<MemoryCard | null> {
  const ids = recall.fragment_ids || [];
  if (!ids.length) return null;
  const res = await searchMemoryFragments({page: 1, pageSize: 100});
  const idSet = new Set(ids);
  const picked = (res.items || []).filter(f => idSet.has(f.id));
  if (!picked.length) return null;

  const cards = picked.map(fragmentToCard);
  const timelineRecords: TimelineRecord[] = cards
    .flatMap(c => c.timelineRecords || [])
    .sort((a, b) => parseTime(a.time) - parseTime(b.time))
    .map((r, i) => ({...r, id: i}));
  const tags = Array.from(new Set(cards.flatMap(c => c.tags || []))).slice(0, 6);
  const content = cards.map(c => c.content).filter(Boolean).join('\n\n');
  const startHHMM = recall.time_range.match(/\d{1,2}:\d{2}/)?.[0] || '';

  return {
    id: `event_${ids[0]}`,
    type: 'memory',
    tag: recall.title,
    time: startHHMM ? `今天 ${startHHMM}` : '今天',
    title: recall.title,
    content,
    hasAI: true,
    tags,
    timelineRecords,
  };
}
