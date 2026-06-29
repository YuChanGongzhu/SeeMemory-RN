/**
 * 后端批处理进度卡：上传后提交 /audio/batch，服务端转写期间显示已完成/总数。
 * 终态（completed / completed_with_error）后由 Mr20BatchResult 展示结果，这里隐藏。
 */
import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import {AnimatedWaveform} from '../Animated';
import {isBatchTerminal} from '../../services/audioBatch';
import type {Mr20BatchState} from '../../hooks/useMr20';

export function Mr20BatchProgress({batch}: {batch: Mr20BatchState | null}) {
  const {theme} = useTheme();
  const c = theme.colors;

  if (!batch || isBatchTerminal(batch.status)) {
    return null;
  }

  const pct =
    batch.total > 0
      ? Math.min(100, Math.round((batch.completed / batch.total) * 100))
      : 0;

  return (
    <View style={[styles.card, {backgroundColor: c.bgCard, borderColor: c.border}]}>
      <View style={styles.head}>
        <Text style={[styles.title, {color: c.text}]}>云端转写中…</Text>
        <Text style={[styles.count, {color: c.accent}]}>
          {batch.completed}/{batch.total}
        </Text>
      </View>
      <AnimatedWaveform barCount={20} color={c.accent} height={24} style={{marginVertical: 8}} />
      <View style={[styles.bar, {backgroundColor: c.bgSecondary}]}>
        <View style={[styles.fill, {width: `${pct}%`, backgroundColor: c.accent}]} />
      </View>
      <Text style={[styles.hint, {color: c.textMuted}]}>
        服务端正在转写并生成场景总结，可离开页面，完成后自动回填
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 12},
  head: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  title: {fontSize: 14, fontWeight: '700'},
  count: {fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] as any},
  bar: {height: 6, borderRadius: 4, overflow: 'hidden'},
  fill: {height: '100%', borderRadius: 4},
  hint: {fontSize: 11, marginTop: 8, lineHeight: 16},
});
