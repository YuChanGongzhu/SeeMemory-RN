/**
 * 引导步骤的高亮目标包裹层。业务代码该怎么写还怎么写，不拦截真实的
 * onPress——只需要在自己的 onPress 里额外调一行 useTour().notifyPress(id)。
 *
 * mount="root"/"drawer"（普通页面、AppDrawer）：测量自身屏幕绝对坐标并注册进
 * TourContext，真正的高亮/气泡由挂在对应位置的 TourSpotlight 画（App 根部一份，
 * AppDrawer 的 Modal 内部再单独一份——Modal 是独立原生层，根部那份盖不上去）。
 *
 * mount="more"（BottomSheet「更多」弹层）：不做 measureInWindow——弹层贴底、
 * 高度跟内容走，量出来的屏幕绝对坐标跟挂在别处的高亮层坐标系对不上，试过几版
 * 按时间兜底重测都没能稳定复现正确位置。改成自己在本地画高亮环 + 气泡——气泡
 * 就是紧跟在目标后面的普通兄弟节点，走正常布局流，不需要任何跨边界测量，代价
 * 是没有「暗掉其余内容」的镂空效果。
 */
import React, {useCallback, useEffect, useRef} from 'react';
import {StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle} from 'react-native';
import {colors, radius} from '../design/tokens';
import {useTour} from './TourContext';
import {TourBubble} from './TourBubble';
import type {StepMount} from './steps';

interface TourTargetProps {
  id: string;
  mount?: StepMount;
  /** 传给外层包裹 View——目标处在 flex 布局里（比如两栏等宽的格子）时用来保持原有尺寸。 */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function TourTarget({id, mount = 'root', style, children}: TourTargetProps) {
  const {registerTarget, unregisterTarget, currentStep, advance, finish} = useTour();
  const viewRef = useRef<View>(null);
  const isCurrentTarget = currentStep?.targetId === id;
  const local = mount === 'more';

  const measure = useCallback(() => {
    viewRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        registerTarget(id, mount, {x, y, width, height});
      }
    });
  }, [id, mount, registerTarget]);

  const onLayout = useCallback(
    (_e: LayoutChangeEvent) => {
      requestAnimationFrame(measure);
    },
    [measure],
  );

  useEffect(() => {
    if (local || !isCurrentTarget) {
      return undefined;
    }
    measure();
    const interval = setInterval(measure, 100);
    const stop = setTimeout(() => clearInterval(interval), 1200);
    return () => {
      clearInterval(interval);
      clearTimeout(stop);
    };
  }, [local, isCurrentTarget, measure]);

  useEffect(() => {
    if (local) {
      return undefined;
    }
    return () => unregisterTarget(id);
  }, [id, local, unregisterTarget]);

  const handleSkip = () => advance();
  const handleCta = () => (currentStep?.isFinal ? finish() : advance());

  if (local) {
    return (
      <View style={style}>
        <View style={isCurrentTarget ? styles.activeRing : undefined}>{children}</View>
        {isCurrentTarget && currentStep ? (
          <TourBubble step={currentStep} onSkip={handleSkip} onCta={handleCta} style={styles.localBubble} />
        ) : null}
      </View>
    );
  }

  return (
    <View ref={viewRef} style={style} onLayout={onLayout} collapsable={false}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  activeRing: {
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  localBubble: {
    marginTop: 8,
    marginBottom: 4,
  },
});
