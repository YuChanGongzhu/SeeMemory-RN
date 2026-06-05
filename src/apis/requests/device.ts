import {baseRequest} from '../core/request';

export interface MemoryStudio {
  id: string;
  macAddress: string;
  model: string;
  name: string;
  llmToken: string;
  deviceToken: string;
  subDomain: string;
  userId: string;
  memoryId: string;
  studioType?: string;
  isCurrent?: boolean;
  ctime: string;
  utime: string;
}

export interface PageResult<T> {
  total: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
  list: T[];
}

export type MigrationStage = 'EXPORTING' | 'IMPORTING' | 'SWITCHING' | 'FINALIZING';

export interface MigrationProgress {
  id: string;
  type: string;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  stage?: MigrationStage | null;
  error?: string | null;
  fromName?: string | null;
  toName?: string | null;
  fromStudioId?: string | null;
  toStudioId?: string | null;
}

export function getDeviceList(pageNum = 1, pageSize = 100): Promise<PageResult<MemoryStudio>> {
  return baseRequest<PageResult<MemoryStudio>>({
    method: 'GET',
    path: '/memorystudio/list',
    query: {pageNum, pageSize},
  });
}

export function switchMemoryStudio(targetStudioId: string): Promise<{progressId: string}> {
  return baseRequest<{progressId: string}>({
    method: 'POST',
    path: '/memorystudio/switch',
    body: {targetStudioId},
    // 切换是异步迁移，但发起请求本身应很快返回 progressId
    timeout: 30000,
  });
}

export function getMigrationProgress(progressId: string): Promise<MigrationProgress> {
  return baseRequest<MigrationProgress>({
    method: 'GET',
    path: `/memorystudio/progress/${progressId}`,
  });
}

export function getCurrentMigration(): Promise<Partial<MigrationProgress>> {
  return baseRequest<Partial<MigrationProgress>>({
    method: 'GET',
    path: '/memorystudio/migration/current',
  });
}

export function renameMemoryStudio(memoryStudioId: string, name: string): Promise<null> {
  return baseRequest<null>({
    method: 'PUT',
    path: `/memorystudio/${memoryStudioId}/name`,
    body: {name},
  });
}
