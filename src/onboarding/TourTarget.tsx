/**
 * 引导步骤的高亮目标包裹层：只负责测量自身在屏幕上的绝对坐标并注册进
 * TourContext，不拦截/包裹真实的 onPress——业务代码该怎么写还怎么写，只需要
 * 在自己的 onPress 里额外调一行 useTour().notifyPress(id)。
 */
import React, {useCallback, useEffect, useRef} from 'react';
import {View, type LayoutChangeEvent, type StyleProp, type ViewStyle} from 'react-native';
import {useTour} from './TourContext';
import type {StepMount} from './steps';

interface TourTargetProps {
  id: string;
  mount?: StepMount;
  /** 传给外层包裹 View——目标处在 flex 布局里（比如两栏等宽的格子）时用来保持原有尺寸。 */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function TourTarget({id, mount = 'root', style, children}: TourTargetProps) {
  const {registerTarget, unregisterTarget, currentStep} = useTour();
  const viewRef = useRef<View>(null);
  const isCurrentTarget = currentStep?.targetId === id;

  const measure = useCallback(() => {
    viewRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        registerTarget(id, mount, {x, y, width, height});
      }
    });
  }, [id, mount, registerTarget]);

  const onLayout = useCallback(
    (_e: LayoutChangeEvent) => {
      // measureInWindow 在 onLayout 触发的同一帧里跑可能还没提交，下一帧再测更稳。
      requestAnimationFrame(measure);
    },
    [measure],
  );

  // 成为当前高亮目标时再测几轮：像 AppDrawer 的滑入那种纯 transform 动画不会触发
  // onLayout，只能按时间兜底重测，覆盖动画跑完之后的真实落点。
  useEffect(() => {
    if (!isCurrentTarget) {
      return;
    }
    const timers = [0, 150, 320].map(delay => setTimeout(measure, delay));
    return () => timers.forEach(clearTimeout);
  }, [isCurrentTarget, measure]);

  useEffect(() => {
    return () => unregisterTarget(id);
  }, [id, unregisterTarget]);

  return (
    <View ref={viewRef} style={style} onLayout={onLayout} collapsable={false}>
      {children}
    </View>
  );
}
