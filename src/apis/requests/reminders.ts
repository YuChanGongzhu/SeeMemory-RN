import {baseRequest, BizError} from '../core/request';

// 与 see-mem-studio-web 的 apis/requests/memory/reminders.ts 对齐：
// 走 manager-api /app/cron（auth_token）→ imemory-agent /v1/agreements（记挂簿）。
// 形状以 imemory-agent 的 AgreementCreate/AgreementOut 为准：
// job 用 {note,schedule_spec,status}，不是 {prompt,kind,when,enabled}。
export type ScheduleKind = 'once' | 'recurring';
export type AgreementStatus = 'active' | 'paused' | 'done';

export type ScheduleSpec =
  | {type: 'once'; at: string}
  | {type: 'cron'; cron: string}
  | {type: 'random'; gap_days: number; window?: string};

export interface ScheduleJob {
  id: string;
  status: AgreementStatus;
  name: string | null;
  note: string;
  schedule_spec: ScheduleSpec;
  next_fire_at: string | null;
}

export interface ListRemindersResponse {
  items: ScheduleJob[];
}

export interface CreateReminderParams {
  /** 到点要做/说的事（必填） */
  note: string;
  schedule_spec: ScheduleSpec;
  /** 可选，留空后端从 note 截取 */
  name?: string;
}

export interface UpdateReminderParams {
  name?: string;
  note?: string;
  schedule_spec?: ScheduleSpec;
  status?: 'active' | 'paused';
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
    baseRequest<ListRemindersResponse>({method: 'GET', path: '/app/cron'}),
    '获取任务失败',
  );
}

/** 单条详情：note 全文（list 里截前 100 字），编辑前拉取用。 */
export function getReminder(id: string): Promise<ScheduleJob> {
  return withErrorMessage(
    baseRequest<ScheduleJob>({method: 'GET', path: `/app/cron/${id}`}),
    '获取任务详情失败',
  );
}

export function createReminder(data: CreateReminderParams): Promise<ScheduleJob> {
  return withErrorMessage(
    baseRequest<ScheduleJob>({method: 'POST', path: '/app/cron', body: data}),
    '创建失败',
  );
}

export function updateReminder(id: string, data: UpdateReminderParams): Promise<ScheduleJob> {
  return withErrorMessage(
    baseRequest<ScheduleJob>({method: 'PATCH', path: `/app/cron/${id}`, body: data}),
    '更新失败',
  );
}

export function deleteReminder(id: string): Promise<{ok: boolean}> {
  return withErrorMessage(
    baseRequest<{ok: boolean}>({method: 'DELETE', path: `/app/cron/${id}`}),
    '删除失败',
  );
}
