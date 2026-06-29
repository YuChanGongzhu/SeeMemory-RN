import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import {AnimatedWaveform} from '../Animated';
import type {SyncProgress} from '../../services/mr20Sync';

interface Props {
  syncing: boolean;
  progress: SyncProgress | null;
}

function fmtBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(0)} KB`;
  }
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function Mr20SyncProgress({syncing, progress}: Props) {
  const {theme} = useTheme();
  const c = theme.colors;

  if (!syncing && !progress) {
    return null;
  }

  const total = progress?.total ?? 0;
  const completed = progress?.completed ?? 0;
  const current = progress?.current;
  const filePct =
    current && current.size > 0
      ? Math.min(100, Math.round((current.received / current.size) * 100))
      : 0;

  return (
    <View style={[styles.card, {backgroundColor: c.bgCard, borderColor: c.border}]}>
      <View style={styles.head}>
        <Text style={[styles.title, {color: c.text}]}>
          {syncing ? '正在同步录音…' : '同步完成'}
        </Text>
        <Text style={[styles.count, {color: c.accent}]}>
          {completed}/{total}
        </Text>
      </View>

      {syncing ? (
        <AnimatedWaveform barCount={20} color={c.accent} height={28} style={{marginVertical: 8}} />
      ) : null}

      {current ? (
        <>
          <Text style={[styles.fileName, {color: c.textSecondary}]} numberOfLines={1}>
            {current.dir}/{current.fname}
          </Text>
          <View style={[styles.bar, {backgroundColor: c.bgSecondary}]}>
            <View style={[styles.fill, {width: `${filePct}%`, backgroundColor: c.accent}]} />
          </View>
          <Text style={[styles.bytes, {color: c.textMuted}]}>
            {fmtBytes(current.received)}
            {current.size > 0 ? ` / ${fmtBytes(current.size)}` : ''}
          </Text>
        </>
      ) : total === 0 && !syncing ? (
        <Text style={[styles.empty, {color: c.textMuted}]}>没有待同步的录音</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 12},
  head: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  title: {fontSize: 14, fontWeight: '700'},
  count: {fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] as any},
  fileName: {fontSize: 12, marginTop: 4, marginBottom: 6},
  bar: {height: 6, borderRadius: 4, overflow: 'hidden'},
  fill: {height: '100%', borderRadius: 4},
  bytes: {fontSize: 11, marginTop: 5, fontVariant: ['tabular-nums'] as any},
  empty: {fontSize: 12.5, marginTop: 6},
});
