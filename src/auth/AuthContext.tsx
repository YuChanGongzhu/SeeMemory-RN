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
  getToken,
  saveSelectedDevice,
  saveToken,
  type SelectedDevice,
} from '../services/storage';
import {
  clearSession as clearSessionSingleton,
  setAuthToken,
  setDeviceContext,
  setUnauthorizedHandler,
} from '../apis/core/session';
import {getDeviceList, type MemoryStudio} from '../apis/requests/device';
import {getUserInfo, loginWithPhoneNumber, type UserInfo} from '../apis/requests/user';

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
  user: UserInfo | null;
  devices: MemoryStudio[];
  selectedDevice: SelectedDevice | null;
  login: (phone: string, captcha: string) => Promise<void>;
  logout: () => Promise<void>;
  selectDevice: (device: MemoryStudio | SelectedDevice) => Promise<void>;
  refreshDevices: () => Promise<MemoryStudio[]>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({children}: {children: ReactNode}) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [authToken, setAuthTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
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

  const logout = useCallback(async () => {
    await clearStorageSession();
    clearSessionSingleton();
    setAuthTokenState(null);
    setUser(null);
    setDevices([]);
    applySelectedDevice(null);
  }, [applySelectedDevice]);

  // Hydrate persisted session on startup.
  useEffect(() => {
    let active = true;
    (async () => {
      const [token, device] = await Promise.all([getToken(), getSelectedDevice()]);
      if (!active) {
        return;
      }
      if (token) {
        setAuthToken(token);
        setAuthTokenState(token);
      }
      if (device) {
        applySelectedDevice(device);
      }
      setIsHydrated(true);
      if (token) {
        // Best-effort background refresh; ignore failures so the app still opens.
        getUserInfo()
          .then(info => active && setUser(info))
          .catch(() => {});
        refreshDevices().catch(() => {});
      }
    })();
    return () => {
      active = false;
    };
  }, [applySelectedDevice, refreshDevices]);

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
      try {
        const info = await getUserInfo();
        setUser(info);
      } catch {
        // non-fatal
      }
      await refreshDevices();
    },
    [refreshDevices],
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
      user,
      devices,
      selectedDevice,
      login,
      logout,
      selectDevice,
      refreshDevices,
    }),
    [isHydrated, authToken, user, devices, selectedDevice, login, logout, selectDevice, refreshDevices],
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
