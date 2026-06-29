import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import {RecDot} from '../Animated';
import type {Mr20ConnState, Mr20Status} from '../../native/mr20/Mr20Client';

interface Props {
  deviceName: string;
  connState: Mr20ConnState;
  status: Mr20Status;
  recording: {fname: string; seconds: number} | null;
}

function fmtSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function Mr20StatusCard({deviceName, connState, status, recording}: Props) {
  const {theme} = useTheme();
  const c = theme.colors;

  const connected = connState === 'connected';
  const dotColor = connected
    ? c.statusConnected
    : connState === 'connecting' || connState === 'pairing'
      ? c.statusConnecting
      : c.statusOffline;
  const connLabel = connected
    ? '已连接'
    : connState === 'connecting'
      ? '连接中…'
      : connState === 'pairing'
        ? '配对中…'
        : connState === 'scanning'
          ? '扫描中…'
          : '未连接';

  const total = status.spaceTotalMb ?? 0;
  const free = status.spaceFreeMb ?? 0;
  const used = Math.max(0, total - free);
  const usedPct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const full = total > 0 && free <= 0;

  return (
    <View style={[styles.card, {backgroundColor: c.bgCard, borderColor: c.border}]}>
      <View style={styles.head}>
        <View style={{flex: 1}}>
          <Text style={[styles.name, {color: c.text}]}>{deviceName || '记忆粒'}</Text>
          <View style={styles.connRow}>
            <View style={[styles.dot, {backgroundColor: dotColor}]} />
            <Text style={[styles.connText, {color: c.textSecondary}]}>{connLabel}</Text>
            {status.recMode ? (
              <Text style={[styles.mode, {color: c.textMuted}]}>
                · {status.recMode === 'call' ? '通话模式' : '对话模式'}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{alignItems: 'flex-end'}}>
          <Text style={[styles.battery, {color: c.text}]}>
            {status.battery != null ? `${status.battery}%` : '—'}
          </Text>
          <Text style={[styles.batteryLabel, {color: c.textMuted}]}>电量</Text>
        </View>
      </View>

      {/* 容量 */}
      <View style={[styles.storageBar, {backgroundColor: c.bgSecondary}]}>
        <View
          style={[
            styles.storageFill,
            {width: `${usedPct}%`, backgroundColor: full ? c.error : c.accent},
          ]}
        />
      </View>
      <View style={styles.storageInfo}>
        <Text style={[styles.storageText, {color: full ? c.error : c.textSecondary}]}>
          {total > 0
            ? `已用 ${used} / ${total} MB${full ? ' · 存储已满' : ''}`
            : '容量未知'}
        </Text>
        <Text style={[styles.fw, {color: c.textMuted}]}>
          {status.firmware ? `固件 ${status.firmware}` : ''}
        </Text>
      </View>

      {status.mac ? (
        <Text style={[styles.mac, {color: c.textMuted}]}>MAC {status.mac}</Text>
      ) : null}

      {recording ? (
        <View style={[styles.recRow, {borderTopColor: c.border}]}>
          <RecDot size={9} color={c.recordDot} />
          <Text style={[styles.recText, {color: c.text}]} numberOfLines={1}>
            正在录音 · {recording.fname || '未命名'}
          </Text>
          <Text style={[styles.recTime, {color: c.accent}]}>
            {fmtSeconds(recording.seconds)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {borderWidth: 1, borderRadius: 20, padding: 16},
  head: {flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14},
  name: {fontSize: 17, fontWeight: '700'},
  connRow: {flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 6},
  dot: {width: 7, height: 7, borderRadius: 4},
  connText: {fontSize: 12, fontWeight: '600'},
  mode: {fontSize: 12},
  battery: {fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] as any},
  batteryLabel: {fontSize: 10.5, marginTop: 1},
  storageBar: {height: 8, borderRadius: 5, overflow: 'hidden'},
  storageFill: {height: '100%', borderRadius: 5},
  storageInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  storageText: {fontSize: 11.5},
  fw: {fontSize: 11.5},
  mac: {fontSize: 11, marginTop: 6, fontVariant: ['tabular-nums'] as any},
  recRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  recText: {flex: 1, fontSize: 12.5},
  recTime: {fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] as any},
});
