/**
 * 新手引导状态机。挂在 Mr20Provider 内部，直接读 useMr20() 的真实业务状态
 * （connState/needsKeySetup/syncing/wifiPhase）来驱动「等待型」步骤自动前进，
 * 不需要 HardwarePage 之类的调用方手动上报——只有 tap 步骤需要调用方在自己
 * 的 onPress 里补一行 notifyPress(id)。完成/跳过状态按账号持久化，见
 * [[mr20-account-binding-flow]] 的 scopedKey 用法。
 */
import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useMr20} from '../hooks/useMr20';
import {scopedKey} from '../services/mr20Scope';
import {TOUR_STEPS, type StepMount, type TourStep} from './steps';

export interface TourRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TourContextValue {
  currentStep: TourStep | null;
  getTargetRect: (id: string) => TourRect | undefined;
  registerTarget: (id: string, mount: StepMount, rect: TourRect) => void;
  unregisterTarget: (id: string) => void;
  notifyPress: (id: string) => void;
  advance: () => void;
  finish: () => void;
  /** 不管有没有走完过，直接从头开始——目前只给「查看指导」调试入口用。 */
  restart: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

const doneKey = () => scopedKey('tourV1Done');

/** 从 fromIndex 起找第一个不该被跳过的步骤；越界返回 -1（=引导结束）。 */
function resolveVisibleIndex(fromIndex: number, needsKeySetup: boolean): number {
  for (let i = fromIndex; i < TOUR_STEPS.length; i++) {
    const step = TOUR_STEPS[i];
    if (step.skipWhenKeyAlreadyBound && !needsKeySetup) {
      continue;
    }
    return i;
  }
  return -1;
}

export function TourProvider({children}: {children: React.ReactNode}) {
  const {connState, needsKeySetup, syncing, wifiPhase, recording} = useMr20();
  const [stepIndex, setStepIndex] = useState(-1);
  const targetsRef = useRef<Map<string, {mount: StepMount; rect: TourRect}>>(new Map());
  // 只用来在 target 注册/反注册时让下面的 useMemo 换一个新的 value 引用——
  // TourSpotlight 靠 useContext 订阅，引用不变就不会重渲染、拿不到最新 rect。
  const [targetsVersion, bumpTargets] = useState(0);
  const needsKeySetupRef = useRef(needsKeySetup);
  needsKeySetupRef.current = needsKeySetup;

  // 首次挂载时判断要不要自动开始；引导中途 needsKeySetup 的变化不应该重新触发
  // 这个副作用，故意只在挂载时跑一次。
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(doneKey())
      .then(done => {
        if (!cancelled && done !== 'true') {
          setStepIndex(resolveVisibleIndex(0, needsKeySetupRef.current));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const currentStep = stepIndex >= 0 ? (TOUR_STEPS[stepIndex] ?? null) : null;

  const finish = useCallback(() => {
    setStepIndex(-1);
    AsyncStorage.setItem(doneKey(), 'true').catch(() => undefined);
  }, []);

  const advance = useCallback(() => {
    setStepIndex(i => {
      const next = resolveVisibleIndex(i + 1, needsKeySetupRef.current);
      if (next === -1) {
        AsyncStorage.setItem(doneKey(), 'true').catch(() => undefined);
      }
      return next;
    });
  }, []);

  const restart = useCallback(() => {
    setStepIndex(resolveVisibleIndex(0, needsKeySetupRef.current));
  }, []);

  const notifyPress = useCallback(
    (id: string) => {
      if (currentStep && currentStep.kind === 'tap' && currentStep.targetId === id) {
        advance();
      }
    },
    [currentStep, advance],
  );

  const registerTarget = useCallback((id: string, mount: StepMount, rect: TourRect) => {
    targetsRef.current.set(id, {mount, rect});
    bumpTargets(n => n + 1);
  }, []);

  const unregisterTarget = useCallback((id: string) => {
    if (targetsRef.current.delete(id)) {
      bumpTargets(n => n + 1);
    }
  }, []);

  const getTargetRect = useCallback((id: string) => targetsRef.current.get(id)?.rect, []);

  // 'recorded' 靠设备物理按键触发，进这一步时录没录不确定，不能像其它等待步骤
  // 那样直接判目标值——万一进来时设备恰好已经在录，会被误判成「已完成」。
  const wasRecordingRef = useRef(false);

  // 等待型步骤：'keyBound'/'uploadDone' 都紧跟在触发它的 tap 步骤之后，进入时
  // 业务状态必然是「未达成」，直接判目标值即可；'connected'/'recorded' 单独
  // 处理，见各自分支的注释。
  useEffect(() => {
    if (!currentStep || currentStep.kind !== 'wait') {
      wasRecordingRef.current = false;
      return;
    }
    if (currentStep.waitKey === 'connected') {
      if (connState !== 'connected') {
        return;
      }
      if (needsKeySetup) {
        // 已经查到需要设置密钥，不用再等，直接走——下一步 resolveVisibleIndex
        // 会正确地不跳过 setup-key/wait-key。
        advance();
        return;
      }
      // needsKeySetup 还是 false：可能是真已绑定过，也可能是连接建立后台那次
      // checkDeviceBinding（BLE 读 MAC + 查后端）还没跑完。连上的瞬间就立刻
      // resolveVisibleIndex 会拿到一个还没更新的 needsKeySetup，把「设置密钥」
      // 两步整个误判成「已绑定」跳过去——给个宽限期，真等到了就走快速路径。
      const timer = setTimeout(advance, 1500);
      return () => clearTimeout(timer);
    }
    if (currentStep.waitKey === 'recorded') {
      if (recording) {
        wasRecordingRef.current = true;
      } else if (wasRecordingRef.current) {
        wasRecordingRef.current = false;
        advance();
      }
      return;
    }
    wasRecordingRef.current = false;
    const reached =
      (currentStep.waitKey === 'keyBound' && !needsKeySetup) ||
      (currentStep.waitKey === 'uploadDone' &&
        !syncing &&
        wifiPhase !== 'transferring' &&
        wifiPhase !== 'connecting');
    if (reached) {
      advance();
    }
  }, [currentStep, connState, needsKeySetup, syncing, wifiPhase, recording, advance]);

  const value = useMemo<TourContextValue>(
    () => ({
      currentStep,
      getTargetRect,
      registerTarget,
      unregisterTarget,
      notifyPress,
      advance,
      finish,
      restart,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetsVersion 只用来强制换引用，故意不进 value 本身
    [currentStep, getTargetRect, registerTarget, unregisterTarget, notifyPress, advance, finish, restart, targetsVersion],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) {
    throw new Error('useTour must be used within TourProvider');
  }
  return ctx;
}
