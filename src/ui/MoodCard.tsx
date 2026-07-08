import React from 'react';
import {View, Text, Image, TouchableOpacity, StyleSheet} from 'react-native';
import {Sparkles} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {emoji} from '../design/assets';
import {GradientBg} from './Gradient';
import type {DailyStatus, HistoricalMemory} from '../types/memory';

// 一周情绪轨迹：过去几天是固定 mock 情绪（各带日期，可点开当日沉淀），「今日」格
// 不写死，渲染时跟随真实主导情绪变化；周六/日为未来占位。仿原型 DailyStatusCard weekDays。
const WEEK: {day: string; key?: keyof typeof emoji; type: 'past' | 'today' | 'future'; date?: string}[] = [
  {day: '一', key: 'focus', type: 'past', date: '2026.06.17'},
  {day: '二', key: 'fatigue', type: 'past', date: '2026.06.18'},
  {day: '三', key: 'excitement', type: 'past', date: '2026.06.19'},
  {day: '四', key: 'anxiety', type: 'past', date: '2026.06.20'},
  {day: '今日', type: 'today'},
  {day: '六', type: 'future'},
  {day: '日', type: 'future'},
];

/** 过去某天的情绪轨迹格 → 该日「每日沉淀」详情（情绪由当天主导表情派生），仿原型 weekDays 点击。 */
function historicalFromDay(d: (typeof WEEK)[number], i: number): HistoricalMemory {
  const k = d.key;
  return {
    id: `hist_${i}`,
    date: d.date || '',
    title: '情绪起伏的日常记录',
    emotion: {
      focus: k === 'focus' ? 60 : 20,
      anxiety: k === 'anxiety' ? 50 : 10,
      excitement: k === 'excitement' ? 60 : 15,
      fatigue: k === 'fatigue' ? 55 : 20,
    },
    stats: {count: 8 + i, activePeriod: '10:00 - 15:00', weekday: `周${d.day}`, topics: '日常 · 工作'},
    insight: '偶尔的波动是正常的，保持对生活的感知力。',
  };
}

function dominant(e: DailyStatus['emotion']) {
  const max = Math.max(e.focus, e.anxiety, e.excitement, e.fatigue);
  if (max === e.focus) return {name: '专注', color: '#4ADE80', bg: 'rgba(74,222,128,0.15)', key: 'focus' as const};
  if (max === e.anxiety) return {name: '焦虑', color: '#F87171', bg: 'rgba(248,113,113,0.15)', key: 'anxiety' as const};
  if (max === e.excitement) return {name: '兴奋', color: '#FDE047', bg: 'rgba(253,224,71,0.15)', key: 'excitement' as const};
  return {name: '疲惫', color: '#E5E5EA', bg: 'rgba(229,229,234,0.15)', key: 'fatigue' as const};
}

/**
 * 首页心情卡 (情绪轨迹) — dark gradient card with a week emoji row + bottom
 * dashboard. Faithful to prototype DailyStatusCard (App.jsx:2573).
 */
export function MoodCard({
  data,
  isGuest,
  onPress,
  onOpenHistorical,
}: {
  data: DailyStatus;
  isGuest?: boolean;
  onPress?: () => void;
  onOpenHistorical?: (data: HistoricalMemory) => void;
}) {
  const dom = dominant(data.emotion);

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={styles.card}>
      <GradientBg radius={radius.bigCard} />

      <View style={styles.head}>
        <Text style={styles.headTitle}>✦ 情绪轨迹</Text>
        {!isGuest ? <Text style={styles.time}>{data.time}</Text> : null}
      </View>

      <View style={styles.week}>
        {WEEK.map((d, i) => {
          const today = d.type === 'today';
          const future = d.type === 'future';
          // 今日格跟随真实主导情绪（dom），过去几天用固定 mock 表情。
          const emojiKey = today ? dom.key : d.key;
          const showEmoji = !isGuest && !!emojiKey;
          return (
            <TouchableOpacity
              key={i}
              activeOpacity={d.type === 'past' ? 0.6 : 1}
              onPress={() => d.type === 'past' && onOpenHistorical?.(historicalFromDay(d, i))}
              style={styles.weekCol}>
              <Text style={[styles.weekDay, today && styles.weekDayToday]}>{d.day}</Text>
              <View
                style={[
                  styles.weekDot,
                  today && styles.weekDotToday,
                  future && styles.weekDotFuture,
                  !today && !future && styles.weekDotPast,
                ]}>
                {showEmoji ? (
                  <Image source={emoji[emojiKey!]} style={{width: 22, height: 22, opacity: d.type === 'past' ? 0.7 : 1}} resizeMode="contain" />
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.dash}>
        {isGuest ? (
          <View style={styles.guestRow}>
            <View style={styles.guestIcon}>
              <Sparkles size={20} color={colors.premium} />
            </View>
            <View style={{flex: 1}}>
              <Text style={styles.dashTitle}>登录记录记忆</Text>
              <Text style={styles.dashSub}>为您记录每一天的记忆，分析专注及情绪</Text>
            </View>
          </View>
        ) : (
          <>
            <View style={{flex: 1}}>
              <Text style={styles.dashTitle} numberOfLines={1}>{data.title}</Text>
              <View style={styles.domRow}>
                <Text style={styles.dashSub}>今日主导情绪：</Text>
                <Text style={[styles.domTag, {color: dom.color, backgroundColor: dom.bg}]}>{dom.name}</Text>
              </View>
            </View>
            <View style={{alignItems: 'flex-end'}}>
              <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 4}}>
                <Text style={styles.count}>{data.stats.count}</Text>
                <Text style={styles.countUnit}>条沉淀</Text>
              </View>
              <Text style={styles.diff}>↑ 较昨日 {data.stats.diff}</Text>
            </View>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.bigCard,
    paddingVertical: 20,
    paddingHorizontal: 24,
    marginBottom: 24,
    overflow: 'hidden',
    backgroundColor: colors.darkCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  head: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20},
  headTitle: {fontSize: 16, fontWeight: '700', color: '#fff'},
  time: {fontSize: 12, fontWeight: '500', color: colors.textSub},
  week: {flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24},
  weekCol: {alignItems: 'center', gap: 8},
  weekDay: {fontSize: 11, fontWeight: '600', color: colors.textSub},
  weekDayToday: {color: '#fff', fontWeight: '800'},
  weekDot: {width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center'},
  weekDotToday: {backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 2, borderColor: '#fff'},
  weekDotFuture: {borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)'},
  weekDotPast: {backgroundColor: 'rgba(255,255,255,0.05)'},
  dash: {flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16},
  guestRow: {flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1},
  guestIcon: {backgroundColor: 'rgba(255,255,255,0.1)', padding: 8, borderRadius: 12},
  dashTitle: {fontSize: 14, fontWeight: '700', color: '#fff'},
  dashSub: {fontSize: 11, fontWeight: '500', color: colors.textSub},
  domRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4},
  domTag: {fontSize: 10, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden'},
  count: {fontSize: 20, fontWeight: '800', color: '#fff'},
  countUnit: {fontSize: 11, fontWeight: '600', color: colors.textSub},
  diff: {fontSize: 11, fontWeight: '700', color: colors.textMain, backgroundColor: '#fff', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, overflow: 'hidden', marginTop: 4},
});
