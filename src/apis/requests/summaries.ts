import {baseRequest} from '../core/request';
import {assertAiConsentGranted} from '../../privacy/consentRuntime';

type SummaryPeriodType = 'daily' | 'weekly' | 'monthly' | 'custom';
type SummaryType = 'time' | 'person' | 'event';
type SummaryStatus = 'completed' | 'failed';

export interface MemorySummaryCard {
  summary_id: string;
  summary_type: SummaryType;
  period_type: SummaryPeriodType;
  start_time: string;
  end_time: string;
  status: SummaryStatus;
  title: string;
  brief: string;
  segment_count: number;
  target_ids: string[];
  target_labels: string[];
  created_at: string;
  updated_at: string;
}

export interface MemorySummaryDetail extends MemorySummaryCard {
  keywords: string[];
  active_days: number;
  main_themes: string[];
  reflection: string;
  timeline: {anchor: string; content: string; session_count: number; session_ids: string[]}[];
  source_event_ids: string[];
  source_session_ids: string[];
  key_actors?: {name: string; entity_id: string; role: string}[];
}

export interface ListMemorySummaryRequest {
  summary_type?: SummaryType;
  period_type?: SummaryPeriodType;
  status?: SummaryStatus;
  start_time?: string;
  end_time?: string;
  page: number;
  page_size: number;
}

export interface ListMemorySummaryResponse {
  items: MemorySummaryCard[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export function listMemorySummaries(
  data: ListMemorySummaryRequest,
): Promise<ListMemorySummaryResponse> {
  return baseRequest<ListMemorySummaryResponse>({
    method: 'POST',
    path: '/app/memory/summary/list',
    body: data,
  });
}

export function getMemorySummary(summaryId: string): Promise<MemorySummaryDetail> {
  return baseRequest<MemorySummaryDetail>({
    method: 'GET',
    path: `/app/memory/summary/${summaryId}`,
  });
}

export interface SummaryTimelineEntry {
  timestamp: string;
  session_id: string;
  content: string;
  topic_events?: {topic_id: string; topic_name: string; category: string; event_content: string}[];
}

export interface SummaryTimelineBucket {
  anchor: string;
  session_count: number;
  entries: SummaryTimelineEntry[];
}

export interface MemorySummaryTimeline {
  summary_id: string;
  period_type: string;
  level: string;
  buckets: SummaryTimelineBucket[];
  topics: unknown[];
}

// GET /app/memory/summary/{id}/timeline — 详情页时序记忆线：按桶聚合的真实 sessions（含 content）。
export function getMemorySummaryTimeline(summaryId: string): Promise<MemorySummaryTimeline> {
  return baseRequest<MemorySummaryTimeline>({
    method: 'GET',
    path: `/app/memory/summary/${summaryId}/timeline`,
  });
}

export interface CreateMemorySummaryRequest {
  summary_type: SummaryType;
  /** time 模式必填。 */
  period_type?: SummaryPeriodType;
  /** time 模式必填，YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS。 */
  start_time?: string;
  end_time?: string;
  /** person=人物 entity_id 列表 / event=事件 event_id 列表（1~10 个）。 */
  target_ids?: string[];
}

// POST /app/memory/summary — 由 AI 生成一份多维总结，返回生成好的详情。
export function createMemorySummary(
  req: CreateMemorySummaryRequest,
): Promise<MemorySummaryDetail> {
  assertAiConsentGranted();
  return baseRequest<MemorySummaryDetail>({
    method: 'POST',
    path: '/app/memory/summary',
    // 生成涉及 LLM，放宽超时。
    timeout: 60000,
    body: req,
  });
}

export type {SummaryType, SummaryPeriodType, SummaryStatus};
