import React, {useState} from 'react';
import {View, Text, Image, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronLeft, Archive, ChevronRight} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {emoji} from '../design/assets';
import {useNav} from '../navigation/nav';
import {loadEventDrillCard} from '../apis/mappers/fragment';
import type {DailyStatus, HistoricalMemory} from '../types/memory';

const EMO = [
  {label: '专注', key: 'focus' as const, color: '#34C759'},
  {label: '焦虑', key: 'anxiety' as const, color: '#FF3B30'},
  {label: '兴奋', key: 'excitement' as const, color: '#FFCC00'},
  {label: '疲惫', key: 'fatigue' as const, color: '#8E8E93'},
];
function dominant(e: DailyStatus['emotion']): keyof typeof emoji {
  const max = Math.max(e.focus, e.anxiety, e.excitement, e.fatigue);
  if (max === e.focus) return 'focus';
  if (max === e.anxiety) return 'anxiety';
  if (max === e.excitement) return 'excitement';
  return 'fatigue';
}

/**
 * 今日报告 / 历史每日沉淀 — faithful to prototype DailyStatusDetail (App.jsx:845).
 * `dark` renders the historical dark variant.
 */
export function StatusDetail({dark}: {dark?: boolean}) {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const [drilling, setDrilling] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const data: DailyStatus | HistoricalMemory = nav.current.params?.data;
  if (!data) return <View style={{flex: 1, backgroundColor: dark ? colors.darkCard : colors.bg}} />;

  const fg = dark ? '#fff' : colors.textMain;
  const sub = dark ? 'rgba(255,255,255,0.5)' : colors.textSub;
  const cardBg = dark ? 'rgba(255,255,255,0.05)' : colors.nested;
  const track = dark ? 'rgba(255,255,255,0.1)' : colors.bgSecondary;
  const fill = dark ? '#fff' : colors.textMain;
  const topics = data.stats.topics.split(/[·,]/).map(t => t.trim()).filter(Boolean);

  // 真实活跃热力（24 小时原始计数 → 归一到 0-100 高度）；无数据时显示空态，不再回落示例。
  const rawHeat = 'heatmap' in data ? data.heatmap : undefined;
  const hasHeat = !!(rawHeat && rawHeat.some(h => h > 0));
  const heatBars: number[] = hasHeat
    ? (() => {
        const max = Math.max(...rawHeat!, 1);
        return rawHeat!.map(h => Math.round((h / max) * 100));
      })()
    : [];
  // 真实事件回溯（今日卡才有）；无数据时显示空态，不再回落内置示例。
  const realRecall = 'eventRecall' in data ? data.eventRecall : undefined;

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };
  // 钻取源文件：拉取该事件组的碎片合并成一张卡，打开详情页；无源/失败给 toast，不跳转。
  const openDrill = async (r: NonNullable<DailyStatus['eventRecall']>[number], i: number) => {
    if (drilling !== null) return;
    setDrilling(i);
    try {
      const card = await loadEventDrillCard(r);
      if (card) nav.push('memoryDetail', {card});
      else flash('暂无可钻取的源文件');
    } catch {
      flash('加载失败，请稍后重试');
    } finally {
      setDrilling(null);
    }
  };

  return (
    <View style={{flex: 1, backgroundColor: dark ? colors.darkCard : colors.bg}}>
      <View style={[styles.header, {paddingTop: insets.top + 8, backgroundColor: dark ? 'rgba(28,28,30,0.9)' : 'rgba(255,255,255,0.9)'}]}>
        <TouchableOpacity style={[styles.backBtn, {backgroundColor: dark ? 'rgba(255,255,255,0.1)' : colors.bgSecondary}]} onPress={nav.pop}>
          <ChevronLeft size={24} strokeWidth={2.4} color={fg} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, {color: fg}]}>{dark ? '每日沉淀' : '今日报告'}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.emojiWrap}>
          <View style={[styles.glow, {backgroundColor: EMO.find(e => e.key === dominant(data.emotion))?.color + '22'}]} />
          <Image source={emoji[dominant(data.emotion)]} style={{width: 72, height: 72}} resizeMode="contain" />
        </View>

        <Text style={[styles.title, {color: fg}]}>{data.title}</Text>
        <Text style={[styles.insight, {color: sub, borderLeftColor: fg}]}>"{data.insight}"</Text>

        {/* Emotion spectrum */}
        <View style={[styles.section, {backgroundColor: cardBg, borderColor: dark ? 'rgba(255,255,255,0.08)' : colors.bgSecondary}]}>
          <Text style={[styles.sectionLabel, {color: sub}]}>情绪频谱</Text>
          {EMO.map(e => {
            const pct = (data.emotion as any)[e.key] as number;
            return (
              <View key={e.key} style={styles.barRow}>
                <View style={styles.barLabelWrap}>
                  <Image source={emoji[e.key]} style={{width: 18, height: 18}} resizeMode="contain" />
                  <Text style={[styles.barLabel, {color: fg}]}>{e.label}</Text>
                </View>
                <View style={[styles.barTrack, {backgroundColor: track}]}>
                  <View style={[styles.barFill, {width: `${pct}%`, backgroundColor: fill}]}>
                    <View style={[styles.barGlow, {backgroundColor: e.color, shadowColor: e.color}]} />
                  </View>
                </View>
                <Text style={[styles.barPct, {color: sub}]}>{pct}%</Text>
              </View>
            );
          })}
        </View>

        {/* Stats grid */}
        <View style={styles.statsGrid}>
          {[
            {n: String(data.stats.count), l: '条记忆'},
            {n: data.stats.activePeriod.split(/[–-]/)[0].trim(), l: '活跃极值'},
            {n: topics[0] || '—', l: '核心聚焦'},
          ].map(s => (
            <View key={s.l} style={[styles.statCell, {backgroundColor: track}]}>
              <Text style={[styles.statNum, {color: fg}]}>{s.n}</Text>
              <Text style={[styles.statLabel, {color: sub}]}>{s.l}</Text>
            </View>
          ))}
        </View>

        {/* Heatmap */}
        <Text style={[styles.sectionLabel, {color: sub, marginBottom: 20}]}>活跃热力分布</Text>
        {hasHeat ? (
          <>
            <View style={styles.heat}>
              {heatBars.map((h, i) => (
                <View key={i} style={[styles.heatBar, {height: `${h}%`, backgroundColor: h > 50 ? fill : h > 20 ? (dark ? 'rgba(255,255,255,0.3)' : 'rgba(26,26,26,0.3)') : (dark ? 'rgba(255,255,255,0.08)' : 'rgba(26,26,26,0.06)')}]} />
              ))}
            </View>
            <View style={styles.heatAxis}>
              <Text style={[styles.axisText, {color: sub}]}>08:00</Text>
              <Text style={[styles.axisText, {color: sub}]}>14:00</Text>
              <Text style={[styles.axisText, {color: sub}]}>22:00</Text>
            </View>
          </>
        ) : (
          <Text style={[styles.recallEmpty, {color: sub}]}>今天还没有足够的活跃数据</Text>
        )}

        {/* Word cloud */}
        <Text style={[styles.sectionLabel, {color: sub, marginTop: 40, marginBottom: 16}]}>高频思维词云</Text>
        <View style={styles.cloud}>
          {topics.map((t, i) => (
            <View key={t} style={[styles.cloudTag, {backgroundColor: i === 0 ? fill : track}]}>
              <Text style={{color: i === 0 ? (dark ? colors.textMain : '#fff') : fg, fontSize: i === 0 ? 15 : 13, fontWeight: i === 0 ? '700' : '600'}}>#{t}</Text>
            </View>
          ))}
        </View>

        {/* Event recall (today only) — 真实事件回溯；无数据显示空态，不再回落示例 */}
        {!dark ? (
          <>
            <Text style={[styles.sectionLabel, {color: sub, marginTop: 40, marginBottom: 16}]}>事件回溯与源文件钻取</Text>
            {realRecall && realRecall.length ? (
              <View style={{gap: 16}}>
                {realRecall.map((r, i) => (
                  <TouchableOpacity
                    key={`r${i}`}
                    style={styles.recall}
                    activeOpacity={0.7}
                    disabled={drilling !== null}
                    onPress={() => openDrill(r, i)}>
                    <View style={{flex: 1}}>
                      <Text style={styles.recallRange}>{r.time_range}</Text>
                      <Text style={styles.recallTitle}>{r.title}</Text>
                      <View style={styles.recallBadge}>
                        <Archive size={12} color={colors.textSub} />
                        <Text style={styles.recallBadgeText}>包含 {r.count} 个记忆碎片</Text>
                      </View>
                    </View>
                    <View style={styles.recallChevron}>
                      {drilling === i ? (
                        <ActivityIndicator size="small" color={colors.textMain} />
                      ) : (
                        <ChevronRight size={18} color={colors.textMain} />
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={styles.recallEmpty}>今天还没有可回溯的事件</Text>
            )}
          </>
        ) : null}
        <View style={{height: 60}} />
      </ScrollView>

      {toast ? (
        <View style={[styles.toast, {bottom: insets.bottom + 60}]}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingBottom: 16},
  backBtn: {width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center'},
  headerTitle: {fontSize: 16, fontWeight: '700'},
  body: {paddingHorizontal: 24},
  emojiWrap: {alignItems: 'center', marginTop: 24, marginBottom: 32},
  glow: {position: 'absolute', width: 120, height: 120, borderRadius: 60, top: -24},
  title: {fontSize: 28, fontWeight: '800', lineHeight: 36, textAlign: 'center', marginBottom: 16},
  insight: {fontSize: 15, fontStyle: 'italic', borderLeftWidth: 3, paddingLeft: 12, lineHeight: 24, marginBottom: 40},
  section: {padding: 24, borderRadius: radius.bigCard, borderWidth: StyleSheet.hairlineWidth, marginBottom: 40},
  sectionLabel: {fontSize: 13, fontWeight: '700', letterSpacing: 1, marginBottom: 24},
  barRow: {flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16},
  barLabelWrap: {flexDirection: 'row', alignItems: 'center', gap: 6, width: 64},
  barLabel: {fontSize: 13, fontWeight: '600'},
  barTrack: {flex: 1, height: 8, borderRadius: 4},
  barFill: {height: 8, borderRadius: 4, justifyContent: 'center'},
  barGlow: {position: 'absolute', right: 0, top: -1, bottom: -1, width: 6, borderRadius: 4, shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: {width: 0, height: 0}, elevation: 4},
  barPct: {fontSize: 13, fontWeight: '600', width: 34, textAlign: 'right'},
  statsGrid: {flexDirection: 'row', gap: 12, marginBottom: 40},
  statCell: {flex: 1, borderRadius: radius.pill, paddingVertical: 16, paddingHorizontal: 8, alignItems: 'center'},
  statNum: {fontSize: 20, fontWeight: '800', marginBottom: 4},
  statLabel: {fontSize: 11, fontWeight: '600'},
  heat: {flexDirection: 'row', gap: 4, alignItems: 'flex-end', height: 60},
  heatBar: {flex: 1, borderTopLeftRadius: 4, borderTopRightRadius: 4},
  heatAxis: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 12},
  axisText: {fontSize: 11, fontWeight: '600'},
  cloud: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  cloudTag: {paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill},
  recall: {flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: colors.nested, borderRadius: radius.bigCard, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.bgSecondary, padding: 20},
  recallRange: {fontSize: 12, color: colors.textSub, fontWeight: '600', marginBottom: 6},
  recallTitle: {fontSize: 16, color: colors.textMain, fontWeight: '600', marginBottom: 12},
  recallBadge: {flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: colors.bgSecondary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6},
  recallBadgeText: {fontSize: 11, color: colors.textMain, fontWeight: '600'},
  recallChevron: {width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center'},
  recallEmpty: {fontSize: 14, color: colors.textSub, lineHeight: 22},
  toast: {position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(26,26,26,0.92)', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14},
  toastText: {color: '#fff', fontSize: 14, fontWeight: '500'},
});
