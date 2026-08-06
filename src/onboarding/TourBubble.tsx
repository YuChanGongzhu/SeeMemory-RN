/**
 * 引导气泡的纯展示内容（标题/正文/「跳过」+ 主按钮），只管自己的视觉，不管
 * 怎么被摆放——TourSpotlight（mount="root"，绝对定位贴在测量出来的坐标上）
 * 和 TourTarget 的本地渲染分支（drawer/more，跟着正常布局流走，不挂 position:
 * absolute）两处共用同一份。
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, radius, space, type as T} from '../design/tokens';
import type {TourStep} from './steps';

export function TourBubble({
  step,
  onSkip,
  onCta,
  style,
}: {
  step: TourStep;
  onSkip: () => void;
  onCta: () => void;
  style?: object;
}) {
  // info 步骤自带更具体的按钮文案（「下一步」/「完成引导」）；其余步骤只有标了
  // manualCompleteLabel 的才给主按钮（目前是 record-audio/check-ota——设备物理
  // 操作或第三方状态，App 里没有对应可点目标 / 检测不到）。「跳过」永远都在，
  // 任何一步卡住都能手动往下走一格，不结束整个引导。
  const ctaLabel = step.kind === 'info' ? (step.ctaLabel ?? '下一步') : step.manualCompleteLabel;

  return (
    <View style={[styles.bubble, style]}>
      <Text style={styles.title}>{step.title}</Text>
      <Text style={styles.body}>{step.body}</Text>
      <View style={styles.footer}>
        <Pressable onPress={onSkip} hitSlop={8}>
          <Text style={styles.skipLink}>跳过</Text>
        </Pressable>
        {ctaLabel ? (
          <Pressable onPress={onCta} style={styles.ctaBtn} hitSlop={8}>
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: space.lg,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 8,
  },
  title: {...T.sysTitle, color: colors.textMain, marginBottom: 4},
  body: {...T.sysBody, color: colors.textSub},
  footer: {
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
});
