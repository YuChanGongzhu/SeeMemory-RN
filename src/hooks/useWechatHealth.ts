import {useCallback, useEffect, useState} from 'react';
import {getWechatStatus} from '../apis/requests/wechat';
import {useAuth} from '../auth/AuthContext';

/**
 * 微信健康度（已绑定 + 未禁用 + 会话未掉线）。待办提醒到点靠微信推送，
 * 创建提醒前端要用它决定是先弹绑定二维码还是直接打开新建任务表单。
 * healthy=null 表示还没查到（游客 / 加载中），不能当"未绑定"处理。
 */
export function useWechatHealth() {
  const {authToken, isGuest} = useAuth();
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!authToken || isGuest) {
      setHealthy(null);
      return Promise.resolve(null);
    }
    setLoading(true);
    return getWechatStatus()
      .then(res => {
        setHealthy(res.healthy);
        return res.healthy;
      })
      .catch(() => {
        setHealthy(null);
        return null;
      })
      .finally(() => setLoading(false));
  }, [authToken, isGuest]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {healthy, loading, refresh};
}
