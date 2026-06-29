import {useEffect, useState} from 'react';
import {getPointAccount, type UserPointAccount} from '../apis/requests/point';
import {useAuth} from '../auth/AuthContext';

/**
 * Real points/积分 account from /point/account (ms gateway). Null for guests or
 * before load. Matches see-mem-studio-web: balance = `balancePoints`.
 */
export function usePoints(): UserPointAccount | null {
  const {authToken, isGuest} = useAuth();
  const [account, setAccount] = useState<UserPointAccount | null>(null);

  useEffect(() => {
    if (!authToken || isGuest) {
      setAccount(null);
      return;
    }
    let alive = true;
    getPointAccount()
      .then(a => alive && setAccount(a))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [authToken, isGuest]);

  return account;
}
