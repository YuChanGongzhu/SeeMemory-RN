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

  const timeline = f.timeline || [];
  const fileById = new Map(files.map(file => [file.id, file]));
  const referencedIds = new Set<string>();
  const records: TimelineRecord[] = timeline.map((t, i) => {
    const type: NonNullable<TimelineRecord['type']> =
      t.type && ['text', 'image', 'video', 'audio', 'doc'].includes(t.type)
        ? t.type
        : 'text';
    const mediaIds = t.media_ids || [];
    mediaIds.forEach(id => referencedIds.add(id));
    const media = mediaIds.map(id => fileById.get(id)).filter(Boolean) as MemoryFragment['files'];
    const first = media[0];
    const record: TimelineRecord = {
      id: i,
      time: t.time,
      type,
      content: t.content,
      timelineTarget: {index: i, time: t.time, type, content: t.content, mediaIds},
    };
    if (type === 'image') {
      record.images = media.map(item => item.url);
      record.url = record.images[0];
    } else if (type === 'audio' && first) {
      record.url = first.url;
      record.name = first.file_name || `语音记录 ${i + 1}`;
      record.duration = durationFromMeta(first.meta);
    } else if (type === 'video' && first) {
      record.url = first.url;
      record.name = first.file_name || undefined;
    } else if (type === 'doc' && first) {
      record.doc = {name: first.file_name || '附件'};
    }
    return record;
  });

  // 未被 timeline.media_ids 引用的旧媒体仍展示，但它们不是可编辑 timeline 对象。
  const unreferencedImages = imageFiles.filter(file => !referencedIds.has(file.id));
  const unreferencedAudio = audioFiles.filter(file => !referencedIds.has(file.id));
  const anchorTime = (i: number, count: number) =>
    timeline.length
      ? timeline[Math.min(timeline.length - 1, Math.floor((i * timeline.length) / count))].time
      : shortTime(f.start_time);
  unreferencedImages.forEach((m, i) => {
    records.push({
      id: timeline.length + i,
      time: anchorTime(i, unreferencedImages.length),
      type: 'image',
      url: m.url,
      content: m.description || undefined,
      name: m.file_name || undefined,
    });
  });
  unreferencedAudio.forEach((m, i) => {
    records.push({
      id: timeline.length + unreferencedImages.length + i,
      time: anchorTime(i, unreferencedAudio.length),
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
    // 唯一赋 fragmentId 的地方：只有真碎片才可作为修正锚点。合成卡/mock 卡一律不带。
    fragmentId: f.id,
    fragmentUpdateTime: f.update_time,
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
