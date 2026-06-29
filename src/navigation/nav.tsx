import React, {createContext, useCallback, useContext, useMemo, useState} from 'react';

/** Hub-and-spoke routes (faithful to prototype: no bottom tab bar). */
export type ScreenName =
  | 'home'
  | 'chat'
  | 'archive'
  | 'hardware'
  | 'todo'
  | 'editor'
  | 'memoryDetail'
  | 'dailyStatus'
  | 'topicSummary'
  | 'historical'
  | 'membership'
  | 'powerStore'
  | 'profile'
  | 'timeline';

export interface Frame {
  name: ScreenName;
  params?: any;
}

interface NavApi {
  stack: Frame[];
  current: Frame;
  push: (name: ScreenName, params?: any) => void;
  pop: () => void;
  home: () => void;
  replace: (name: ScreenName, params?: any) => void;
}

const NavContext = createContext<NavApi | undefined>(undefined);

export function NavProvider({children}: {children: React.ReactNode}) {
  const [stack, setStack] = useState<Frame[]>([{name: 'home'}]);

  const push = useCallback((name: ScreenName, params?: any) => {
    setStack(s => [...s, {name, params}]);
  }, []);
  const pop = useCallback(() => {
    setStack(s => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);
  const home = useCallback(() => setStack([{name: 'home'}]), []);
  const replace = useCallback((name: ScreenName, params?: any) => {
    setStack(s => [...s.slice(0, -1), {name, params}]);
  }, []);

  const value = useMemo<NavApi>(
    () => ({stack, current: stack[stack.length - 1], push, pop, home, replace}),
    [stack, push, pop, home, replace],
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): NavApi {
  const ctx = useContext(NavContext);
  if (!ctx) {
    throw new Error('useNav must be used within NavProvider');
  }
  return ctx;
}
