import {deviceRequest} from '../core/request';

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

// POST /memory/files/search — device backend (ms-backend → memory service)
export function searchMemoryFiles(params: SearchMemoryFilesParams): Promise<MemoryFileSearchResponse> {
  return deviceRequest<MemoryFileSearchResponse>({
    method: 'POST',
    path: '/memory/files/search',
    body: params,
  });
}

export type {MediaGroup};
