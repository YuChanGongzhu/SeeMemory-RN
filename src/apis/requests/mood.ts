import {baseRequest} from '../core/request';
import type {DailyStatus, HistoricalMemory} from '../../types/memory';

/**
 * 每日情绪卡（mood）接口 — manager-api 网关 /app/memory/mood/*（auth_token，
 * 后端按登录用户解析当前设备记忆身份）。生成是后端事件驱动异步，GET 只读：
 * 未生成时 data=null，前端回落 mock/空态。
 */

// 与后端 DailyMoodModel 对齐（snake_case）。
export interface DailyMoodResponse {
  day: string; // YYYY-MM-DD
  status: string; // completed/failed
  dominant_emotion: string; // joy/sadness/anger/fear/surprise/disgust/anticipation/neutral
  valence: number;
  arousal: number;
  emotions: Record<string, number>; // 7 类标准情绪 0-100
  energy: Record<string, number>; // {focus, fatigue} 0-100
  title: string;
  insight: string;
  stats: {
    count?: number;
    diff?: string;
    active_period?: string;
    topics?: string[];
    weekday?: string;
  };
  detail: {
    heatmap?: number[]; // 24 小时活跃分桶
    word_cloud?: {term: string; weight: number}[];
    event_recall?: {time_range: string; title: string; count: number; event_ids?: string[]; fragment_ids?: string[]}[];
  };
  generated_at?: string | null;
}

export interface MoodHistoryResponse {
  items: DailyMoodResponse[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// GET /app/memory/mood/today — 今日情绪卡；未生成返回 null。
export function getTodayMood(): Promise<DailyMoodResponse | null> {
  return baseRequest<DailyMoodResponse | null>({
    method: 'GET',
    path: '/app/memory/mood/today',
  });
}

// GET /app/memory/mood/history — 历史情绪卡分页（按天倒序，不含今日）。
export function getMoodHistory(page = 1, pageSize = 14): Promise<MoodHistoryResponse> {
  return baseRequest<MoodHistoryResponse>({
    method: 'GET',
    path: '/app/memory/mood/history',
    query: {page, pageSize},
  });
}

// GET /app/memory/mood/range — [start, end] 闭区间情绪卡（升序，YYYY-MM-DD）。
// 心情日历一次拉整月；只回已生成的天，无卡的日子前端渲染空格。
export function getMoodRange(start: string, end: string): Promise<DailyMoodResponse[]> {
  return baseRequest<DailyMoodResponse[]>({
    method: 'GET',
    path: '/app/memory/mood/range',
    query: {start, end},
  });
}

// —— 过渡映射：后端新模型（7 类标准情绪 + 能量轴）→ 现有 UI 的 4 轴 Emotion ——
// UI（MoodCard/StatusDetail/HistoricalCard）目前按 专注/焦虑/兴奋/疲惫 渲染；
// 全量改造成 7 类频谱需要新表情资产，先用语义最近的映射把真实数据接上：
//   专注/疲惫 ← energy（后端本来就是独立能量轴）；焦虑 ← fear；兴奋 ← max(joy, surprise)。
function toFourAxis(m: DailyMoodResponse) {
  const e = m.emotions || {};
  const g = m.energy || {};
  return {
    focus: Math.round(g.focus ?? 0),
    fatigue: Math.round(g.fatigue ?? 0),
    anxiety: Math.round(e.fear ?? 0),
    excitement: Math.round(Math.max(e.joy ?? 0, e.surprise ?? 0)),
  };
}

/** generated_at（格式化时间串）→ 'HH:MM 更新'；无值回空串。 */
function updateLabel(generatedAt?: string | null): string {
  if (!generatedAt) {
    return '';
  }
  const m = generatedAt.match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]} 更新` : '';
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function weekdayOf(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return isNaN(d.getTime()) ? '' : WEEKDAYS[d.getDay()];
}

/** 今日卡 → 首页 MoodCard / 今日报告用的 DailyStatus。 */
export function moodToDailyStatus(m: DailyMoodResponse): DailyStatus {
  return {
    date: '今天',
    time: updateLabel(m.generated_at),
    title: m.title || '今天的情绪画像',
    emotion: toFourAxis(m),
    stats: {
      count: m.stats?.count ?? 0,
      diff: m.stats?.diff ?? '0',
      activePeriod: m.stats?.active_period || '—',
      topics: (m.stats?.topics || []).join(' · '),
    },
    insight: m.insight || '',
    heatmap: m.detail?.heatmap,
    eventRecall: m.detail?.event_recall,
  };
}

/** 历史卡 → 信息流「每日沉淀」用的 HistoricalMemory。 */
export function moodToHistorical(m: DailyMoodResponse): HistoricalMemory {
  return {
    id: `mood_${m.day}`,
    date: m.day.replace(/-/g, '.'),
    title: m.title || '这一天的情绪记录',
    emotion: toFourAxis(m),
    stats: {
      count: m.stats?.count ?? 0,
      activePeriod: m.stats?.active_period || '—',
      weekday: m.stats?.weekday || weekdayOf(m.day),
      topics: (m.stats?.topics || []).join(', '),
    },
    insight: m.insight || '',
    heatmap: m.detail?.heatmap,
  };
}
