import {useCallback, useEffect, useRef, useState} from 'react';
import {getPointAccount, type UserPointAccount} from '../apis/requests/point';
import {useAuth} from '../auth/AuthContext';

/** 余额为 0 时的补拉时机（毫秒）。注册赠送异步发放，实测约 1s 后到账。 */
const ZERO_RETRY_DELAYS = [1200, 3000];

/**
 * Real points/积分 account from /point/account (ms gateway). Null for guests or
 * before load. Matches see-mem-studio-web: balance = `balancePoints`.
 *
 * 新注册用户会补拉：注册赠送走 ActivityGrantManager.grantOnRegister 且标了 @Async，
 * 登录接口不等它完成就返回，此时首拉必然是 0（实测建号与入账相差约 1s）。
 * 余额为 0 时按 ZERO_RETRY_DELAYS 再拉两次，拿到非 0 即停。
 * 老用户余额本就非 0，首拉即命中，不会产生额外请求。
 */
export function usePoints(): UserPointAccount | null {
  const {authToken, isGuest} = useAuth();
  const [account, setAccount] = useState<UserPointAccount | null>(null);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => {
    if (!authToken || isGuest) {
      setAccount(null);
      return;
    }
    let alive = true;

    const load = () =>
      getPointAccount()
        .then(a => {
          if (!alive) {
            return;
          }
          setAccount(a);
          // 已到账就没必要再补拉，撤掉后续定时器。
          if ((a?.balancePoints ?? 0) > 0) {
            clearTimers();
          }
        })
        .catch(() => {});

    void load();
    timers.current = ZERO_RETRY_DELAYS.map(delay => setTimeout(() => void load(), delay));

    return () => {
      alive = false;
      clearTimers();
    };
  }, [authToken, isGuest, clearTimers]);

  return account;
}
