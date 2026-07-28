import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {View, Text, ScrollView, Image, TouchableOpacity, ActivityIndicator, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronLeft, ChevronRight, Activity, Target, Archive, Lightbulb} from 'lucide-react-native';
import {colors} from '../design/tokens';
import {emoji} from '../design/assets';
import {useNav} from '../navigation/nav';
import {HistoricalCard} from '../ui/HistoricalCard';
import {MemoryCard} from '../ui/MemoryCard';
import {dominant} from '../ui/MoodCard';
import {getMoodRange, moodToHistorical, type DailyMoodResponse} from '../apis/requests/mood';
import {getActivityStats} from '../apis/requests/stats';
import {searchMemoryFragments} from '../apis/requests/memory';
import {fragmentToCard} from '../apis/mappers/fragment';
import type {HistoricalMemory, MemoryCard as MemoryCardModel} from '../types/memory';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

// 记忆热力图：16 个过去周 + 本周 = 17 列 × 7 行（周一起始，与月历一致；
// 原型的 7 个未来占位列砍掉，省横向空间）。
const HEAT_PAST_WEEKS = 16;
const HEAT_COLS = HEAT_PAST_WEEKS + 1;
const HEAT_DAYS = HEAT_COLS * 7;
const HEAT_CELL = 14;
const HEAT_GAP = 4;

/** 本地日期 → YYYY-MM-DD（与后端 day 字段对齐；不能用 toISOString 会掉时区）。 */
function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** 条数 → 热力档位（原型绝对阈值：0 / ≤1 / ≤3 / >3，跨用户语义固定，配「少→多」图例）。 */
function heatLevel(count: number): number {
  if (count === 0) {
    return 0;
  }
  if (count <= 1) {
    return 1;
  }
  if (count <= 3) {
    return 2;
  }
  return 3;
}

/** 主导情绪 → 日历格底色（浅色版，仿原型：绿=专注 红=焦虑 黄=兴奋 灰=疲惫）。 */
const CELL_BG: Record<string, string> = {
  focus: '#E8F5E9',
  anxiety: '#FFEBEE',
  excitement: '#FFF9C4',
  fatigue: '#F2F2F7',
};

/**
 * 记忆脉络 — 双视图（原型 MemoryTimelinePage，App.jsx:4843）：
 * - 记忆热力：GitHub 式热力图（/app/memory/stats/activity），点某天联动当日碎片列表
 *   （/app/memory/fragments/search 按天查，复用首页 MemoryCard）。
 * - 心情日历：月历按主导情绪上色+表情（/app/memory/mood/range 一次拉整月），
 *   点某天联动当日心情总结卡。
 */
export function TimelinePage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();

  const today = useMemo(() => new Date(), []);
  const todayKey = dayKey(today);
  const [viewMode, setViewMode] = useState<'heat' | 'mood'>('heat');
  const [selected, setSelected] = useState(todayKey);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // —— 记忆热力：活跃统计（一次拉 17 周窗口） ——
  const [heatCounts, setHeatCounts] = useState<Map<string, number> | null>(null);
  const [heatError, setHeatError] = useState(false);

  const loadHeat = useCallback(() => {
    setHeatError(false);
    getActivityStats(HEAT_DAYS)
      .then(s => {
        if (mountedRef.current) {
          setHeatCounts(new Map((s.daily || []).map(d => [d.day, d.count])));
        }
      })
      .catch(() => mountedRef.current && setHeatError(true));
  }, []);

  useEffect(() => {
    if (!heatCounts) {
      loadHeat();
    }
  }, [heatCounts, loadHeat]);

  // 热力窗口起点：本周周一往回推 16 周。
  const heatStart = useMemo(
    () => addDays(today, -((today.getDay() + 6) % 7) - HEAT_PAST_WEEKS * 7),
    [today],
  );

  // 月份刻度：每列（周一）进入新月份时标一次。
  const heatMonths = useMemo(() => {
    const marks: {text: string; col: number}[] = [];
    let last = -1;
    for (let c = 0; c < HEAT_COLS; c++) {
      const d = addDays(heatStart, c * 7);
      if (d.getMonth() !== last) {
        marks.push({text: `${d.getMonth() + 1}月`, col: c});
        last = d.getMonth();
      }
    }
    return marks;
  }, [heatStart]);

  // —— 当日碎片列表（按天查 + 缓存） ——
  const [dayCards, setDayCards] = useState<Record<string, MemoryCardModel[]>>({});
  const [dayLoading, setDayLoading] = useState(false);

  useEffect(() => {
    if (viewMode !== 'heat' || dayCards[selected]) {
      return;
    }
    const day = selected;
    setDayLoading(true);
    searchMemoryFragments({
      startTime: day,
      endTime: dayKey(addDays(new Date(`${day}T00:00:00`), 1)),
      pageSize: 50,
    })
      .then(res => {
        if (mountedRef.current) {
          setDayCards(prev => ({...prev, [day]: (res.items || []).map(fragmentToCard)}));
        }
      })
      .catch(() => {})
      .finally(() => mountedRef.current && setDayLoading(false));
  }, [viewMode, selected, dayCards]);

  // —— 心情日历：按月拉情绪卡（缓存） ——
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [moodsByMonth, setMoodsByMonth] = useState<Record<string, Record<string, DailyMoodResponse>>>({});
  const [moodLoading, setMoodLoading] = useState(false);
  const [moodError, setMoodError] = useState(false);

  const mKey = monthKey(month);
  const monthMoods = moodsByMonth[mKey];

  const loadMonth = useCallback((m: Date) => {
    const key = monthKey(m);
    const start = dayKey(new Date(m.getFullYear(), m.getMonth(), 1));
    const end = dayKey(new Date(m.getFullYear(), m.getMonth() + 1, 0));
    setMoodLoading(true);
    setMoodError(false);
    getMoodRange(start, end)
      .then(items => {
        if (!mountedRef.current) {
          return;
        }
        const byDay: Record<string, DailyMoodResponse> = {};
        (items || []).forEach(it => {
          byDay[it.day] = it;
        });
        setMoodsByMonth(prev => ({...prev, [key]: byDay}));
      })
      .catch(() => mountedRef.current && setMoodError(true))
      .finally(() => mountedRef.current && setMoodLoading(false));
  }, []);

  useEffect(() => {
    if (viewMode === 'mood' && !moodsByMonth[mKey]) {
      loadMonth(month);
    }
  }, [viewMode, mKey, month, moodsByMonth, loadMonth]);

  // 月历格：前置空位对齐周一起始。
  const grid = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // 周一=0
    const cells: (Date | null)[] = Array.from({length: lead}, () => null);
    for (let i = 1; i <= daysInMonth; i++) {
      cells.push(new Date(month.getFullYear(), month.getMonth(), i));
    }
    return cells;
  }, [month]);

  const selectedMood = monthMoods?.[selected];
  const selectedHistorical: HistoricalMemory | null = useMemo(
    () => (selectedMood ? moodToHistorical(selectedMood) : null),
    [selectedMood],
  );

  const prevMonth = () => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  const nextMonth = () => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  const atCurrentMonth = month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth();

  const selectedDate = new Date(`${selected}T00:00:00`);
  const selectedLabel = `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`;
  const selectedCards = dayCards[selected];
  const heatPalette = [colors.bgSecondary, colors.textTertiary, colors.textSub, colors.textMain];

  return (
    <View style={styles.root}>
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <TouchableOpacity onPress={nav.pop} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <ChevronLeft size={28} color={colors.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>记忆脉络</Text>
        {/* 视图切换（仿原型右上角圆钮 + 底部小字标注当前视图） */}
        <TouchableOpacity
          style={styles.toggleBtn}
          onPress={() => setViewMode(v => (v === 'heat' ? 'mood' : 'heat'))}>
          {viewMode === 'heat' ? (
            <Activity size={18} color={colors.textMain} />
          ) : (
            <Target size={18} color={colors.textMain} />
          )}
          <Text style={styles.toggleLabel}>{viewMode === 'heat' ? '记忆热力' : '心情日历'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {viewMode === 'heat' ? (
          <>
            <View style={styles.heatHead}>
              <Text style={styles.month}>记忆热力图</Text>
              <Text style={styles.heatSub}>近 {HEAT_COLS} 周轨迹</Text>
            </View>

            {!heatCounts && !heatError ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color={colors.textMain} />
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.heatScroll}>
                <View>
                  <View style={styles.heatGrid}>
                    {/* 列主序：一列一周，行=周几 */}
                    {Array.from({length: HEAT_COLS}, (_, c) => (
                      <View key={c} style={styles.heatCol}>
                        {Array.from({length: 7}, (__, r) => {
                          const d = addDays(heatStart, c * 7 + r);
                          const key = dayKey(d);
                          const future = key > todayKey;
                          const level = future ? 0 : heatLevel(heatCounts?.get(key) ?? 0);
                          const on = selected === key;
                          return (
                            <TouchableOpacity
                              key={r}
                              disabled={future}
                              onPress={() => setSelected(key)}
                              style={[
                                styles.heatCell,
                                {backgroundColor: heatPalette[level]},
                                on && styles.heatCellSelected,
                              ]}
                            />
                          );
                        })}
                      </View>
                    ))}
                  </View>
                  <View style={styles.heatMonthRow}>
                    {heatMonths.map((m, i) => (
                      <Text key={i} style={[styles.heatMonthText, {left: m.col * (HEAT_CELL + HEAT_GAP)}]}>
                        {m.text}
                      </Text>
                    ))}
                  </View>
                </View>
              </ScrollView>
            )}
            {heatError ? <Text style={styles.errorText}>加载失败，返回重进重试</Text> : null}

            <View style={styles.legendRow}>
              <Text style={styles.legendText}>少</Text>
              {heatPalette.map((c, i) => (
                <View key={i} style={[styles.legendCell, {backgroundColor: c}]} />
              ))}
              <Text style={styles.legendText}>多</Text>
            </View>

            <Text style={styles.sectionTitle}>
              {selectedLabel} · 记忆
              <Text style={styles.sectionSub}>
                {'  '}共 {selectedCards?.length ?? 0} 条记忆碎片
              </Text>
            </Text>
            {dayLoading && !selectedCards ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color={colors.textMain} />
              </View>
            ) : selectedCards && selectedCards.length > 0 ? (
              selectedCards.map(card => (
                <MemoryCard key={card.id} card={card} onPress={() => nav.push('memoryDetail', {card})} />
              ))
            ) : (
              <View style={styles.empty}>
                <Archive size={40} color={colors.textTertiary} />
                <Text style={styles.emptyText}>这一天没有记录记忆碎片</Text>
              </View>
            )}
          </>
        ) : (
          <>
            <View style={styles.monthRow}>
              <TouchableOpacity onPress={prevMonth} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                <ChevronLeft size={20} color={colors.textMain} />
              </TouchableOpacity>
              <Text style={styles.month}>
                {month.getFullYear()}年 {month.getMonth() + 1}月
              </Text>
              <TouchableOpacity
                onPress={nextMonth}
                disabled={atCurrentMonth}
                hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                <ChevronRight size={20} color={atCurrentMonth ? colors.textTertiary : colors.textMain} />
              </TouchableOpacity>
            </View>

            <View style={styles.weekRow}>
              {WEEK.map(w => (
                <Text key={w} style={styles.weekLabel}>
                  {w}
                </Text>
              ))}
            </View>

            {moodLoading && !monthMoods ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color={colors.textMain} />
              </View>
            ) : (
              <View style={styles.grid}>
                {grid.map((d, i) => {
                  if (!d) {
                    return <View key={`pad_${i}`} style={styles.cell} />;
                  }
                  const key = dayKey(d);
                  const mood = monthMoods?.[key];
                  const dom = mood ? dominant(moodToHistorical(mood).emotion) : null;
                  const on = selected === key;
                  const isToday = key === todayKey;
                  const future = key > todayKey;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={styles.cell}
                      disabled={future}
                      onPress={() => setSelected(key)}>
                      <View
                        style={[
                          styles.dayBox,
                          dom ? {backgroundColor: CELL_BG[dom.key]} : null,
                          isToday && styles.dayBoxToday,
                          on && styles.dayBoxSelected,
                        ]}>
                        <Text style={[styles.dayNum, future && styles.dayNumFuture]}>{d.getDate()}</Text>
                        {dom ? (
                          <Image source={emoji[dom.key]} style={styles.dayEmoji} resizeMode="contain" />
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            {moodError ? <Text style={styles.errorText}>加载失败，翻月重试</Text> : null}

            <Text style={styles.sectionTitle}>{selectedLabel} · 心情总结</Text>
            {selectedHistorical ? (
              <HistoricalCard
                data={selectedHistorical}
                onPress={() => nav.push('historical', {data: selectedHistorical})}
              />
            ) : (
              <View style={styles.empty}>
                <Lightbulb size={40} color={colors.textTertiary} />
                <Text style={styles.emptyText}>这一天没有生成心情总结</Text>
              </View>
            )}
          </>
        )}
        <View style={styles.bottomSpace} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bgApp},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16, backgroundColor: colors.bg},
  headerTitle: {flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.textMain},
  toggleBtn: {width: 44, alignItems: 'center', gap: 2},
  toggleLabel: {fontSize: 9, color: colors.textSub, fontWeight: '600'},
  body: {padding: 20},
  // —— 记忆热力 ——
  heatHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16},
  heatSub: {fontSize: 12, color: colors.textSub, fontWeight: '500'},
  heatScroll: {paddingBottom: 4},
  heatGrid: {flexDirection: 'row', gap: HEAT_GAP},
  heatCol: {gap: HEAT_GAP},
  heatCell: {width: HEAT_CELL, height: HEAT_CELL, borderRadius: 3},
  heatCellSelected: {borderWidth: 2, borderColor: colors.textMain},
  heatMonthRow: {height: 16, marginTop: 4},
  heatMonthText: {position: 'absolute', fontSize: 10, color: colors.textTertiary, fontWeight: '600'},
  legendRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 8, marginBottom: 24},
  legendCell: {width: 10, height: 10, borderRadius: 2},
  legendText: {fontSize: 10, color: colors.textSub, fontWeight: '600'},
  sectionSub: {fontSize: 13, color: colors.textSub, fontWeight: '500'},
  // —— 心情日历 ——
  monthRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16},
  month: {fontSize: 18, fontWeight: '700', color: colors.textMain},
  weekRow: {flexDirection: 'row', marginBottom: 8},
  weekLabel: {flex: 1, textAlign: 'center', fontSize: 12, color: colors.textSub, fontWeight: '600'},
  grid: {flexDirection: 'row', flexWrap: 'wrap', marginBottom: 24},
  cell: {width: `${100 / 7}%`, alignItems: 'center', marginBottom: 8},
  dayBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBoxToday: {borderWidth: 1, borderColor: colors.textTertiary},
  dayBoxSelected: {borderWidth: 2, borderColor: colors.textMain},
  dayNum: {position: 'absolute', top: 3, left: 6, fontSize: 10, fontWeight: '600', color: colors.textSub},
  dayNumFuture: {color: colors.textTertiary},
  dayEmoji: {width: 26, height: 26, marginTop: 6},
  // —— 共用 ——
  loadingBox: {height: 200, alignItems: 'center', justifyContent: 'center'},
  errorText: {fontSize: 12, color: '#E5484D', textAlign: 'center', marginBottom: 12},
  sectionTitle: {fontSize: 16, fontWeight: '700', color: colors.textMain, marginBottom: 16},
  empty: {alignItems: 'center', marginTop: 32, gap: 12},
  emptyText: {fontSize: 14, color: colors.textSub},
  bottomSpace: {height: 40},
});
