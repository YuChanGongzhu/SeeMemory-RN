import {baseRequest} from '../core/request';

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
