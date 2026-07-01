import {baseRequest, BizError} from '../core/request';

// 与 see-mem-studio-web 的 apis/requests/memory/reminders.ts 对齐：
// 走 manager-api /app/cron（auth_token），后端按当前记忆 mode 分流云端/本地。
// 形状以云端为准：list 返回 {items}，job 用 {prompt,kind,when}（kind: once|recurring）。
export type ScheduleKind = 'once' | 'recurring';

export interface ScheduleJob {
  id: string;
  name: string;
  prompt: string;
  kind: ScheduleKind;
  cron: string | null;
  fire_at: string | null;
  next_fire_at: string | null;
  enabled: boolean;
}

export interface ListRemindersResponse {
  items: ScheduleJob[];
}

export interface CreateReminderParams {
  /** 到点要做/说的事（必填） */
  prompt: string;
  kind: ScheduleKind;
  /** once: ISO 时间串；recurring: 5 段 cron 表达式 */
  when: string;
  /** 可选，留空后端从 prompt 截取 */
  name?: string;
}

export interface UpdateReminderParams {
  name?: string;
  prompt?: string;
  when?: string;
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
    baseRequest<ListRemindersResponse>({method: 'GET', path: '/app/cron'}),
    '获取任务失败',
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
