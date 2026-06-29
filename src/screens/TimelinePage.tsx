import React, {useState} from 'react';
import {View, Text, ScrollView, TouchableOpacity, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronLeft} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {useNav} from '../navigation/nav';
import {HISTORICAL_MEMORIES} from '../data/mock';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

/** 记忆时间轴 — month calendar (heat dots) + selected day list. Prototype App.jsx:3160. */
export function TimelinePage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState(21);

  // June 2026 starts on a Monday (offset 0); 30 days.
  const days = Array.from({length: 30}, (_, i) => i + 1);
  const heat = (d: number) => (d % 7 === 0 ? 3 : d % 3 === 0 ? 2 : d % 2 === 0 ? 1 : 0);
  const palette = [colors.bgSecondary, colors.textTertiary, colors.textSub, colors.textMain];

  return (
    <View style={styles.root}>
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <TouchableOpacity onPress={nav.pop} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <ChevronLeft size={28} color={colors.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>记忆时间轴</Text>
        <View style={{width: 28}} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.month}>2026年 6月</Text>
        <View style={styles.weekRow}>
          {WEEK.map(w => <Text key={w} style={styles.weekLabel}>{w}</Text>)}
        </View>
        <View style={styles.grid}>
          {days.map(d => {
            const on = selected === d;
            return (
              <TouchableOpacity key={d} style={styles.cell} onPress={() => setSelected(d)}>
                <View style={[styles.dayDot, {backgroundColor: on ? colors.primary : palette[heat(d)]}]}>
                  <Text style={[styles.dayText, {color: on || heat(d) >= 2 ? '#fff' : colors.textMain}]}>{d}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>6月{selected}日 · 记忆</Text>
        {HISTORICAL_MEMORIES.map(h => (
          <TouchableOpacity key={h.id} style={styles.dayCard} onPress={() => nav.push('historical', {data: h})}>
            <Text style={styles.dayCardTitle}>{h.title}</Text>
            <Text style={styles.dayCardMeta}>沉淀 {h.stats.count} 条 · {h.stats.activePeriod}</Text>
          </TouchableOpacity>
        ))}
        <View style={{height: 40}} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bgApp},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16, backgroundColor: colors.bg},
  headerTitle: {flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.textMain},
  body: {padding: 20},
  month: {fontSize: 18, fontWeight: '700', color: colors.textMain, marginBottom: 16},
  weekRow: {flexDirection: 'row', marginBottom: 8},
  weekLabel: {flex: 1, textAlign: 'center', fontSize: 12, color: colors.textSub, fontWeight: '600'},
  grid: {flexDirection: 'row', flexWrap: 'wrap', marginBottom: 32},
  cell: {width: `${100 / 7}%`, alignItems: 'center', marginBottom: 8},
  dayDot: {width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center'},
  dayText: {fontSize: 13, fontWeight: '600'},
  sectionTitle: {fontSize: 16, fontWeight: '700', color: colors.textMain, marginBottom: 16},
  dayCard: {backgroundColor: colors.bg, borderRadius: radius.xxl, padding: 16, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.03)'},
  dayCardTitle: {fontSize: 15, fontWeight: '600', color: colors.textMain, marginBottom: 4},
  dayCardMeta: {fontSize: 13, color: colors.textSub},
});
