import {baseRequest} from '../core/request';

type MediaGroup = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other';

export interface MemoryFileResource {
  id: string;
  url: string;
  mime_type: string;
  file_name: string | null;
  description: string | null;
  tags: string[];
  face_annotations: unknown[] | null;
  meta: Record<string, unknown> | null;
  created_at: string | null;
}

export interface MemoryFileSearchResponse {
  items: MemoryFileResource[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface SearchMemoryFilesParams {
  query?: string;
  mediaTypes?: MediaGroup[];
  startTime?: string;
  endTime?: string;
  page?: number;
  pageSize?: number;
}

// POST /app/memory/media/search — manager-api（auth_token，后端按 user 解析当前设备）
// 请求体用 snake_case 对齐后端 ApiSearchMemoryMediasRequest；user_id 由后端注入，不传。
export function searchMemoryFiles(params: SearchMemoryFilesParams): Promise<MemoryFileSearchResponse> {
  return baseRequest<MemoryFileSearchResponse>({
    method: 'POST',
    path: '/app/memory/media/search',
    body: {
      query: params.query,
      media_types: params.mediaTypes,
      start_time: params.startTime,
      end_time: params.endTime,
      page: params.page,
      page_size: params.pageSize,
    },
  });
}

export interface FragmentTimelineItem {
  time: string;
  content: string;
}

export interface MemoryFragmentMedia {
  id: string;
  url: string;
  mime_type: string;
  file_name: string | null;
  description: string | null;
  tags: string[];
  meta: Record<string, unknown> | null;
  created_at: string | null;
}

export interface MemoryFragment {
  id: string;
  session_id: string;
  title: string;
  keywords: string[];
  brief: string;
  start_time: string;
  end_time: string;
  update_time: string;
  timeline: FragmentTimelineItem[];
  files: MemoryFragmentMedia[];
}

export interface SearchMemoryFragmentsResponse {
  items: MemoryFragment[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface SearchMemoryFragmentsParams {
  startTime?: string;
  endTime?: string;
  page?: number;
  pageSize?: number;
}

// POST /app/memory/fragments/search — manager-api（auth_token，user_id 由后端注入不传）
// 按时间范围 + 分页返回记忆碎片，按 start_time 倒序；无关键词字段。
export function searchMemoryFragments(
  params: SearchMemoryFragmentsParams = {},
): Promise<SearchMemoryFragmentsResponse> {
  return baseRequest<SearchMemoryFragmentsResponse>({
    method: 'POST',
    path: '/app/memory/fragments/search',
    body: {
      start_time: params.startTime,
      end_time: params.endTime,
      page: params.page ?? 1,
      page_size: params.pageSize ?? 30,
    },
  });
}

export type {MediaGroup};
