import {useEffect, useState} from 'react';
import {getActivityStats, type ActivityStatsResponse} from '../apis/requests/stats';
import {useAuth} from '../auth/AuthContext';

/** 贡献热力图窗口：15 列 × 7 行 = 105 天。 */
export const ACTIVITY_WINDOW_DAYS = 105;

/**
 * 抽屉页的记忆活跃度统计。enabled（抽屉打开）时拉一次，关闭不请求；
 * 游客与未登录返回 null，由调用方走空态。
 */
export function useActivityStats(enabled: boolean): ActivityStatsResponse | null {
  const {authToken, isGuest} = useAuth();
  const [stats, setStats] = useState<ActivityStatsResponse | null>(null);

  useEffect(() => {
    if (!enabled || !authToken || isGuest) {
      return;
    }
    let alive = true;
    getActivityStats(ACTIVITY_WINDOW_DAYS)
      .then(s => alive && setStats(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled, authToken, isGuest]);

  useEffect(() => {
    if (!authToken || isGuest) {
      setStats(null);
    }
  }, [authToken, isGuest]);

  return stats;
}
