import {deviceRequest, BizError} from '../core/request';

export type ScheduleKind = 'once' | 'cron';

export interface ScheduleJob {
  id: string;
  name: string;
  description?: string | null;
  taskType: ScheduleKind;
  schedule: string;
  enabled?: boolean | null;
}

export interface ListRemindersResponse {
  message: string;
  jobs: ScheduleJob[];
}

export interface CreateReminderParams {
  name: string;
  description?: string;
  taskType: ScheduleKind;
  schedule: string;
}

export interface UpdateReminderParams {
  name: string;
  description?: string;
  taskType: ScheduleKind;
  schedule: string;
  enabled?: boolean;
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof BizError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

async function withErrorMessage<T>(promise: Promise<T>, fallback: string): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    throw new Error(extractErrorMessage(error, fallback));
  }
}

export function listReminders(): Promise<ListRemindersResponse> {
  return withErrorMessage(
    deviceRequest<ListRemindersResponse>({method: 'GET', path: '/cron'}),
    '获取任务失败',
  );
}

export function createReminder(data: CreateReminderParams): Promise<{message: string}> {
  return withErrorMessage(
    deviceRequest<{message: string}>({method: 'POST', path: '/cron', body: data}),
    '创建失败',
  );
}

export function updateReminder(id: string, data: UpdateReminderParams): Promise<{message: string}> {
  return withErrorMessage(
    deviceRequest<{message: string}>({method: 'PATCH', path: `/cron/${id}`, body: data}),
    '更新失败',
  );
}

export function deleteReminder(id: string): Promise<{message: string}> {
  return withErrorMessage(
    deviceRequest<{message: string}>({method: 'DELETE', path: `/cron/${id}`}),
    '删除失败',
  );
}
