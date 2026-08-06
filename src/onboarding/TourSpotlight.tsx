/**
 * 引导步骤的可视化渲染：镂空高亮 + 气泡；目标当前没在屏幕可见范围内注册
 * （子页还没切过去、或被滚动到看不见）时退化成右上角浮动提示卡，不强行滚动
 * 或跳转，等用户自己走到那一步再切回真高亮。
 *
 * 要挂两处：App 根部（mount="root"）覆盖普通页面；AppDrawer 的 Modal 内部
 * （mount="drawer"）覆盖侧边栏——RN 的 Modal 是独立原生层，根部这层普通的
 * 绝对定位 View 盖不上去，只能在 Modal 内容里单独再挂一份。
 */
import React, {useEffect} from 'react';
import {Dimensions, Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Animated, {useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import Svg, {Defs, Mask, Rect} from 'react-native-svg';
import {colors, radius, space, type as T} from '../design/tokens';
import {useTour} from './TourContext';
import type {StepMount} from './steps';

const PAD = 8;
// 目标中心离屏幕上下边缘小于这个距离，就当它「当前看不见」，走浮动提示卡。
const EDGE_MARGIN = 60;

export function TourSpotlight({mount}: {mount: StepMount}) {
  const {currentStep, getTargetRect, advance, skip, finish} = useTour();
  const insets = useSafeAreaInsets();
  const opacity = useSharedValue(0);
  const active = currentStep?.mount === mount;

  useEffect(() => {
    opacity.value = withTiming(active ? 1 : 0, {duration: 160});
  }, [active, opacity]);

  const fadeStyle = useAnimatedStyle(() => ({opacity: opacity.value}));

  if (!currentStep || !active) {
    return null;
  }

  const {width: screenW, height: screenH} = Dimensions.get('window');
  const rawRect = currentStep.targetId ? getTargetRect(currentStep.targetId) : undefined;
  const onScreen = !!rawRect && rawRect.y + rawRect.height > EDGE_MARGIN && rawRect.y < screenH - EDGE_MARGIN;

  const handleSkip = () => skip();
  const handleCta = () => (currentStep.isFinal ? finish() : advance());

  if (!onScreen) {
    return (
      <Animated.View pointerEvents="box-none" style={[styles.fallbackWrap, {top: insets.top + space.md}, fadeStyle]}>
        <View style={styles.fallbackCard}>
          <Text style={styles.fallbackText} numberOfLines={2}>
            {currentStep.fallbackText}
          </Text>
          <Pressable onPress={handleSkip} hitSlop={8}>
            <Text style={styles.fallbackSkip}>跳过</Text>
          </Pressable>
        </View>
      </Animated.View>
    );
  }

  const rect = rawRect!;
  const hx = Math.max(0, rect.x - PAD);
  const hy = Math.max(0, rect.y - PAD);
  const hw = rect.width + PAD * 2;
  const hh = rect.height + PAD * 2;

  const bubbleW = Math.min(300, screenW - space.page * 2);
  const spaceBelow = screenH - (hy + hh);
  const placeBelow = spaceBelow > 160 || hy < 160;
  const bubbleTop = placeBelow ? hy + hh + 12 : undefined;
  const bubbleBottom = placeBelow ? undefined : screenH - hy + 12;
  const bubbleLeft = Math.min(
    Math.max(rect.x + rect.width / 2 - bubbleW / 2, space.page),
    screenW - space.page - bubbleW,
  );

  return (
    <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, fadeStyle]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width={screenW} height={screenH}>
          <Defs>
            <Mask id="tourMask">
              <Rect x={0} y={0} width={screenW} height={screenH} fill="#fff" />
              <Rect x={hx} y={hy} width={hw} height={hh} rx={14} ry={14} fill="#000" />
            </Mask>
          </Defs>
          <Rect x={0} y={0} width={screenW} height={screenH} fill="rgba(0,0,0,0.6)" mask="url(#tourMask)" />
        </Svg>
        <View style={[styles.ring, {left: hx, top: hy, width: hw, height: hh}]} />
      </View>
      <View style={[styles.bubble, {width: bubbleW, left: bubbleLeft, top: bubbleTop, bottom: bubbleBottom}]}>
        <Text style={styles.bubbleTitle}>{currentStep.title}</Text>
        <Text style={styles.bubbleBody}>{currentStep.body}</Text>
        <View style={styles.bubbleFooter}>
          <Pressable onPress={handleSkip} hitSlop={8}>
            <Text style={styles.skipLink}>跳过引导</Text>
          </Pressable>
          {currentStep.kind === 'info' ? (
            <Pressable onPress={handleCta} style={styles.ctaBtn} hitSlop={8}>
              <Text style={styles.ctaText}>{currentStep.ctaLabel ?? '下一步'}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#fff',
  },
  bubble: {
    position: 'absolute',
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: space.lg,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 8,
  },
  bubbleTitle: {...T.sysTitle, color: colors.textMain, marginBottom: 4},
  bubbleBody: {...T.sysBody, color: colors.textSub},
  bubbleFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.md,
  },
  skipLink: {fontSize: 13, color: colors.textSub, fontWeight: '500'},
  ctaBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: space.lg,
  },
  ctaText: {fontSize: 14, fontWeight: '600', color: '#fff'},
  fallbackWrap: {
    position: 'absolute',
    left: space.page,
    right: space.page,
    alignItems: 'flex-end',
  },
  fallbackCard: {
    backgroundColor: colors.dark,
    borderRadius: radius.pill,
    paddingVertical: 10,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    maxWidth: '100%',
  },
  fallbackText: {fontSize: 13, color: '#fff', fontWeight: '500', flexShrink: 1},
  fallbackSkip: {fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: '600'},
});
