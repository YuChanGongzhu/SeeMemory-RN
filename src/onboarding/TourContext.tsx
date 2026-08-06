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
  skip: () => void;
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
  const {connState, needsKeySetup, syncing, wifiPhase} = useMr20();
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

  const skip = finish;

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

  // 等待型步骤：进入该步骤时业务状态必然是「未达成」（因为都是紧跟在触发它的
  // tap 步骤之后），所以直接判目标状态本身，不需要额外的 busy→idle 边沿检测。
  useEffect(() => {
    if (!currentStep || currentStep.kind !== 'wait') {
      return;
    }
    const reached =
      (currentStep.waitKey === 'connected' && connState === 'connected') ||
      (currentStep.waitKey === 'keyBound' && !needsKeySetup) ||
      (currentStep.waitKey === 'uploadDone' &&
        !syncing &&
        wifiPhase !== 'transferring' &&
        wifiPhase !== 'connecting');
    if (reached) {
      advance();
    }
  }, [currentStep, connState, needsKeySetup, syncing, wifiPhase, advance]);

  const value = useMemo<TourContextValue>(
    () => ({
      currentStep,
      getTargetRect,
      registerTarget,
      unregisterTarget,
      notifyPress,
      advance,
      skip,
      finish,
      restart,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetsVersion 只用来强制换引用，故意不进 value 本身
    [currentStep, getTargetRect, registerTarget, unregisterTarget, notifyPress, advance, skip, finish, restart, targetsVersion],
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
