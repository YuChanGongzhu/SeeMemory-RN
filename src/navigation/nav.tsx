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
  /** 稳定标识，供 RootView 作 React key，保证同一帧在栈变化时不被重挂。 */
  key?: string;
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

/**
 * 当前渲染帧。RootView 把整个 stack 都挂载着（下层隐藏、保留滚动位置/状态），
 * 每一帧包一层 FrameProvider，让该屏 useNav().current 拿到自己的 frame，
 * 而不是全局栈顶那一帧（否则被压在下面的屏会读到上层的 params）。
 */
const FrameContext = createContext<Frame | null>(null);

export function FrameProvider({frame, children}: {frame: Frame; children: React.ReactNode}) {
  return <FrameContext.Provider value={frame}>{children}</FrameContext.Provider>;
}

export function NavProvider({children}: {children: React.ReactNode}) {
  const seq = React.useRef(0);
  const nextKey = (name: ScreenName) => `${name}-${seq.current++}`;
  const [stack, setStack] = useState<Frame[]>(() => [{name: 'home', key: 'home-root'}]);

  const push = useCallback((name: ScreenName, params?: any) => {
    setStack(s => [...s, {name, params, key: nextKey(name)}]);
  }, []);
  const pop = useCallback(() => {
    setStack(s => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);
  const home = useCallback(() => setStack([{name: 'home', key: 'home-root'}]), []);
  const replace = useCallback((name: ScreenName, params?: any) => {
    setStack(s => [...s.slice(0, -1), {name, params, key: nextKey(name)}]);
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
  const frame = useContext(FrameContext);
  // 在某一帧内部，current 指向该帧自身；栈顶等其余 api 仍走全局。
  return frame ? {...ctx, current: frame} : ctx;
}
