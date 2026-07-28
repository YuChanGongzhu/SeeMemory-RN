import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  clearSession as clearStorageSession,
  getSelectedDevice,
  getStoredApiEnv,
  getToken,
  getUserId,
  saveSelectedDevice,
  saveToken,
  saveUserId,
  type SelectedDevice,
} from '../services/storage';
import {setMr20Scope} from '../services/mr20Scope';
import {setApiEnvInMemory, type ApiEnv} from '../apis/core/env';
import {clearAllChatHistory} from '../services/chatHistoryStore';
import {
  clearSession as clearSessionSingleton,
  setAuthToken,
  setDeviceContext,
  setUnauthorizedHandler,
} from '../apis/core/session';
import {getDeviceList, type MemoryStudio} from '../apis/requests/device';
import {
  deleteAccount as deleteAccountRequest,
  getUserInfo,
  loginWithPhoneNumber,
  type UserInfo,
} from '../apis/requests/user';

function toSelectedDevice(d: MemoryStudio): SelectedDevice {
  return {id: d.id, name: d.name, subDomain: d.subDomain, deviceToken: d.deviceToken};
}

function pickDefaultDevice(
  devices: MemoryStudio[],
  current: SelectedDevice | null,
): SelectedDevice | null {
  if (devices.length === 0) {
    return null;
  }
  if (current) {
    const stillExists = devices.find(d => d.id === current.id || d.subDomain === current.subDomain);
    if (stillExists) {
      return toSelectedDevice(stillExists);
    }
  }
  const active = devices.find(d => d.isCurrent) || devices[0];
  return toSelectedDevice(active);
}

interface AuthContextValue {
  isHydrated: boolean;
  authToken: string | null;
  isGuest: boolean;
  user: UserInfo | null;
  /**
   * 持久化的当前用户 id（登录后由 getUserInfo 落库、hydrate 时从本地读回，**不依赖网络**）。
   * MR20 本地数据用它做账号分区键；离线启动也拿得到，故不能用 `user?.id`（后者离线为 null）。
   */
  userId: string | null;
  devices: MemoryStudio[];
  selectedDevice: SelectedDevice | null;
  login: (phone: string, captcha: string) => Promise<void>;
  loginAsGuest: () => void;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  selectDevice: (device: MemoryStudio | SelectedDevice) => Promise<void>;
  refreshDevices: () => Promise<MemoryStudio[]>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({children}: {children: ReactNode}) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [authToken, setAuthTokenState] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [devices, setDevices] = useState<MemoryStudio[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<SelectedDevice | null>(null);
  const selectedDeviceRef = useRef<SelectedDevice | null>(null);

  const applySelectedDevice = useCallback((device: SelectedDevice | null) => {
    selectedDeviceRef.current = device;
    setSelectedDevice(device);
    setDeviceContext(device ? {subDomain: device.subDomain, deviceToken: device.deviceToken} : null);
  }, []);

  const refreshDevices = useCallback(async (): Promise<MemoryStudio[]> => {
    const result = await getDeviceList();
    const list = result.list || [];
    setDevices(list);
    const next = pickDefaultDevice(list, selectedDeviceRef.current);
    if (next && next.subDomain !== selectedDeviceRef.current?.subDomain) {
      applySelectedDevice(next);
      await saveSelectedDevice(next);
    } else if (!next) {
      applySelectedDevice(null);
    }
    return list;
  }, [applySelectedDevice]);

  // 统一入口：持久化 userId（登录路径）+ 更新内存作用域 + React 状态。传 null＝退登，
  // MR20 作用域回落到 null（读旧全局 key，迁移后已空 → 退登态看不到任何 MR20 数据）。
  const applyUserId = useCallback(
    (id: string | null, persist: boolean) => {
      setMr20Scope(id);
      setUserId(id);
      if (persist && id) {
        saveUserId(id).catch(() => undefined);
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    await clearStorageSession();
    await clearAllChatHistory();
    clearSessionSingleton();
    setAuthTokenState(null);
    setIsGuest(false);
    setUser(null);
    applyUserId(null, false); // clearStorageSession 已删持久化 USER_ID
    setDevices([]);
    applySelectedDevice(null);
  }, [applySelectedDevice, applyUserId]);

  const loginAsGuest = useCallback(() => {
    setIsGuest(true);
    setAuthTokenState('guest-token');
  }, []);

  // 注销账号：服务端软删除成功后才清本地。顺序不能反——先清本地就没有 token 可用来调接口了。
  // 服务端抛错时保持登录态不变，由调用方提示失败。
  const deleteAccount = useCallback(async () => {
    await deleteAccountRequest();
    await logout();
  }, [logout]);

  // Hydrate persisted session on startup.
  useEffect(() => {
    let active = true;
    (async () => {
      // 读本地存储可能失败（如全新模拟器首启 AsyncStorage 未就绪）。无论成败都要
      // 置 isHydrated=true，否则 app 永远卡在启动闪屏进不去。失败即当作未登录。
      let token: string | null = null;
      let device: SelectedDevice | null = null;
      let env: ApiEnv = 'prod';
      let storedUserId: string | null = null;
      try {
        [token, device, env, storedUserId] = await Promise.all([
          getToken(),
          getSelectedDevice(),
          getStoredApiEnv(),
          getUserId(),
        ]);
      } catch (err) {
        console.warn('[Auth] session hydrate failed; starting logged-out', err);
      }
      if (!active) {
        return;
      }
      // 先把后端环境载入内存，保证后续任何请求（含下面的后台刷新）都打对主机。
      setApiEnvInMemory(env);
      if (token) {
        setAuthToken(token);
        setAuthTokenState(token);
        // **在 setIsHydrated(true) 之前**设好 MR20 作用域：App 在 isHydrated 前是启动屏，
        // 故 Mr20Provider 挂载、首次 getInbox 前作用域必已就绪 → 离线也能读到本人 inbox。
        if (storedUserId) {
          applyUserId(storedUserId, false);
        }
      }
      if (device) {
        applySelectedDevice(device);
      }
      setIsHydrated(true);
      if (token) {
        // Best-effort background refresh; ignore failures so the app still opens.
        getUserInfo()
          .then(info => {
            if (!active) {
              return;
            }
            setUser(info);
            // 首次拿到（或刷新到）真实 id：落库 + 校正作用域（幂等）。
            if (info.id) {
              applyUserId(info.id, true);
            }
          })
          .catch(() => {});
        refreshDevices().catch(() => {});
      }
    })();
    return () => {
      active = false;
    };
  }, [applySelectedDevice, refreshDevices, applyUserId]);

  // Drive back to the login gate on a 401 from any request.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void logout();
    });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const login = useCallback(
    async (phone: string, captcha: string) => {
      const {token} = await loginWithPhoneNumber(phone, captcha);
      await saveToken(token);
      setAuthToken(token);
      setAuthTokenState(token);
      setIsGuest(false);
      try {
        const info = await getUserInfo();
        setUser(info);
        if (info.id) {
          applyUserId(info.id, true); // 落库 + 设 MR20 作用域（迁移改由手动按钮触发）
        }
      } catch {
        // non-fatal
      }
      await refreshDevices();
    },
    [refreshDevices, applyUserId],
  );

  const selectDevice = useCallback(
    async (device: MemoryStudio | SelectedDevice) => {
      const next: SelectedDevice =
        'macAddress' in device ? toSelectedDevice(device as MemoryStudio) : (device as SelectedDevice);
      applySelectedDevice(next);
      await saveSelectedDevice(next);
    },
    [applySelectedDevice],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      isHydrated,
      authToken,
      isGuest,
      user,
      userId,
      devices,
      selectedDevice,
      login,
      loginAsGuest,
      logout,
      deleteAccount,
      selectDevice,
      refreshDevices,
    }),
    [isHydrated, authToken, isGuest, user, userId, devices, selectedDevice, login, loginAsGuest, logout, deleteAccount, selectDevice, refreshDevices],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
