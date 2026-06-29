import React from 'react';
import {View, Text, Image, TouchableOpacity, StyleSheet} from 'react-native';
import {Calendar} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {emoji} from '../design/assets';
import {GradientBg} from './Gradient';
import type {HistoricalMemory} from '../types/memory';

function dominantKey(e: HistoricalMemory['emotion']): keyof typeof emoji {
  const max = Math.max(e.focus, e.anxiety, e.excitement, e.fatigue);
  if (max === e.focus) return 'focus';
  if (max === e.anxiety) return 'anxiety';
  if (max === e.excitement) return 'excitement';
  return 'fatigue';
}

/** 历史每日沉淀卡 (feed, past days) — dark gradient. Prototype App.jsx:2708. */
export function HistoricalCard({data, onPress}: {data: HistoricalMemory; onPress?: () => void}) {
  const bars: {label: string; pct: number}[] = [
    {label: '专注', pct: data.emotion.focus},
    {label: '焦虑', pct: data.emotion.anxiety},
    {label: '兴奋', pct: data.emotion.excitement},
    {label: '疲惫', pct: data.emotion.fatigue},
  ];
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={styles.card}>
      <GradientBg radius={radius.bigCard} />

      <View style={styles.emojiBadge}>
        <Image source={emoji[dominantKey(data.emotion)]} style={{width: 24, height: 24}} resizeMode="contain" />
      </View>

      <View style={styles.dateRow}>
        <Calendar size={13} color={colors.textSub} />
        <Text style={styles.date}> {data.date} 记忆总结</Text>
      </View>
      <Text style={styles.title}>{data.title}</Text>

      <View style={styles.barsGrid}>
        {bars.map(b => (
          <View key={b.label} style={styles.barRow}>
            <Text style={styles.barLabel}>{b.label}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, {width: `${b.pct}%`}]} />
            </View>
          </View>
        ))}
      </View>

      <Text style={styles.stat}>沉淀 {data.stats.count} 条 · 最活跃 {data.stats.activePeriod} · {data.stats.weekday}</Text>
      <Text style={[styles.stat, {marginBottom: 12}]}>核心话题：{data.stats.topics}</Text>

      <View style={styles.quoteRow}>
        <View style={styles.quoteBar} />
        <Text style={styles.quote}>"{data.insight}"</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {borderRadius: radius.bigCard, padding: 24, marginBottom: 16, overflow: 'hidden', backgroundColor: colors.darkCard, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)'},
  emojiBadge: {position: 'absolute', top: 20, right: 20, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center'},
  dateRow: {flexDirection: 'row', alignItems: 'center', marginBottom: 10},
  date: {fontSize: 12, color: colors.textSub, fontWeight: '500'},
  title: {fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 16, paddingRight: 40},
  barsGrid: {flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16},
  barRow: {width: '50%', flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 16, marginBottom: 8},
  barLabel: {fontSize: 11, color: colors.textSub, width: 24},
  barTrack: {flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden'},
  barFill: {height: 4, borderRadius: 2, backgroundColor: '#fff'},
  stat: {fontSize: 12, color: colors.textSub, marginBottom: 4},
  quoteRow: {flexDirection: 'row', gap: 8},
  quoteBar: {width: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.2)'},
  quote: {flex: 1, fontSize: 12, color: '#fff', fontStyle: 'italic', lineHeight: 17},
});
