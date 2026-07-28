import {baseRequest} from '../core/request';

/**
 * 记忆活跃度统计 — manager-api 网关 /app/memory/stats/activity（auth_token，
 * 后端按登录用户解析当前设备记忆身份）。纯 SQL 聚合，不触发 LLM。
 */

// 与后端 ActivityStatsModel 对齐（snake_case）。
export interface ActivityStatsResponse {
  total: number; // 全部记忆条数（全量）
  active_days: number; // 有记忆的自然日总数（全量）
  streak: number; // 截至今天的连续天数
  daily: {day: string; count: number}[]; // 窗口内每日条数，仅含有记录的天
}

// GET /app/memory/stats/activity — days 为贡献热力图窗口长度（默认 105 = 15 周）。
export function getActivityStats(days = 105): Promise<ActivityStatsResponse> {
  return baseRequest<ActivityStatsResponse>({
    method: 'GET',
    path: '/app/memory/stats/activity',
    query: {days},
  });
}
