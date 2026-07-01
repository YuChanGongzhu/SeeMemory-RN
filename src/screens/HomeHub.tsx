import React, {useEffect, useMemo, useState} from 'react';
import {View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet} from 'react-native';
import {SlidersHorizontal} from 'lucide-react-native';
import {colors, space} from '../design/tokens';
import {HomeHeader} from '../ui/Header';
import {FabCapsule} from '../ui/FabCapsule';
import {MoodCard} from '../ui/MoodCard';
import {MemoryCard} from '../ui/MemoryCard';
import {HistoricalCard} from '../ui/HistoricalCard';
import {useAppDrawer} from '../hooks/useAppDrawer';
import {useAuth} from '../auth/AuthContext';
import {useWriteGate} from '../hooks/useWriteGate';
import {useNav} from '../navigation/nav';
import {searchMemoryFragments, type MemoryFragment} from '../apis/requests/memory';
import {DEMO_MEMORIES, DAILY_STATUS, HISTORICAL_MEMORIES} from '../data/mock';
import type {MemoryCard as MemoryCardModel, TimelineRecord} from '../types/memory';

/** Minutes-since-midnight for sorting; non-time labels sort last. */
function parseTime(t?: string): number {
  if (!t) return -1;
  const m = t.match(/(\d{1,2}):(\d{2})/);
  if (!m) return t.includes('刚刚') ? 24 * 60 + 1 : -1;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Date-label portion of a card.time ('今天 09:00' → '今天'); '' when undated. */
function dateOf(time?: string): string {
  if (!time) return '';
  const [d, t] = time.split(' ');
  return t ? d : '';
}

/** Sortable rank for a feed date label ('今天'/'昨天'/'YYYY.MM.DD'); higher = more recent, undated last. */
function dateRank(dateStr: string): number {
  if (!dateStr) return -Infinity;
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  if (dateStr === '今天') return base.getTime();
  if (dateStr === '昨天') {
    base.setDate(base.getDate() - 1);
    return base.getTime();
  }
  const m = dateStr.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  return -Infinity;
}

function normalizeDateStr(d: string): string {
  const today = new Date();
  const fmt = (x: Date) => `${x.getFullYear()}.${String(x.getMonth() + 1).padStart(2, '0')}.${String(x.getDate()).padStart(2, '0')}`;
  if (!d) return fmt(today);
  if (d.startsWith('今天')) return fmt(today);
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (d.startsWith('昨天')) return fmt(y);
  return d.split(' ')[0].replace(/-/g, '.');
}

function shortTime(time?: string): string {
  if (!time) return '';
  const part = time.split(' ')[1] || '';
  return part.split(':').slice(0, 2).join(':');
}

/** 'YYYY-MM-DD HH:MM:SS' → '今天 HH:MM' / '昨天 HH:MM' / 'YYYY.MM.DD HH:MM'（含空格，供 feed 分组）。 */
function formatFragmentTime(ts?: string): string {
  if (!ts) return '';
  const [datePart, timePart = ''] = ts.split(' ');
  const hhmm = timePart.split(':').slice(0, 2).join(':');
  const today = new Date();
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (datePart === fmt(today)) return `今天 ${hhmm}`;
  if (datePart === fmt(yesterday)) return `昨天 ${hhmm}`;
  return `${datePart.replace(/-/g, '.')} ${hhmm}`;
}

/** 记忆碎片 → 首页/详情页共用的 MemoryCard 模型。 */
function fragmentToCard(f: MemoryFragment): MemoryCardModel {
  const files = f.files || [];
  const imageFiles = files.filter(m => m.mime_type?.startsWith('image'));
  const audioFiles = files.filter(m => m.mime_type?.startsWith('audio'));
  const images = imageFiles.map(m => m.url);

  // 时间流：AI 概要 → 文本节点（默认「高光」视图）；录音 files → 音频节点（「全量」视图可播放，
  // 转写文案放在 content，仿原型 renderTimelineNode 的 audio 暗色胶囊 + 转写块）。
  const timeline = f.timeline || [];
  const records: TimelineRecord[] = timeline.map((t, i) => ({
    id: i,
    time: t.time,
    type: 'text',
    content: t.content,
  }));
  audioFiles.forEach((m, i) => {
    // files 无录音时间，按序等比锚定到概要时间点，保证「全量」视图里大致按时序排列。
    const anchor = timeline.length
      ? timeline[Math.min(timeline.length - 1, Math.floor((i * timeline.length) / audioFiles.length))].time
      : shortTime(f.start_time);
    records.push({
      id: timeline.length + i,
      time: anchor,
      type: 'audio',
      name: `语音记录 ${i + 1}`,
      content: m.description || undefined,
      url: m.url,
    });
  });
  const timelineRecords = records.sort((a, b) => parseTime(a.time) - parseTime(b.time));

  return {
    id: f.id,
    type: 'memory',
    tag: f.keywords?.[0] || '记忆',
    time: formatFragmentTime(f.start_time),
    title: f.title,
    content: f.brief,
    hasAI: true,
    tags: f.keywords || [],
    images: images.length ? images : undefined,
    image: images[0],
    audioCount: audioFiles.length || undefined,
    updateTime: shortTime(f.update_time) || undefined,
    timelineRecords,
  };
}

/**
 * 首页 hub — frosted header + 记忆碎片 feed (mood card under 今天, historical
 * cards for past days, memory cards with left-swipe) + floating FAB capsule.
 * Faithful to prototype HomeTab (App.jsx:1877). Wires real A1/A5 data in a
 * later backend pass; uses mock data for now.
 */
export function HomeHub() {
  const {openDrawer} = useAppDrawer();
  const {isGuest, selectedDevice} = useAuth();
  const gate = useWriteGate();
  const nav = useNav();
  const [memories, setMemories] = useState<MemoryCardModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;

  // 记忆碎片信息流：拉取 /app/memory/fragments/search（按时间倒序）；无设备 / 失败 / 空 → 回退 mock。
  useEffect(() => {
    let alive = true;
    if (!selectedDevice) {
      setMemories(DEMO_MEMORIES);
      setLoading(false);
      return;
    }
    setLoading(true);
    searchMemoryFragments({page: 1, pageSize: 30})
      .then(res => {
        if (!alive) return;
        const mapped = (res.items || []).map(fragmentToCard);
        setMemories(mapped.length ? mapped : DEMO_MEMORIES);
      })
      .catch(() => alive && setMemories(DEMO_MEMORIES))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [selectedDevice?.subDomain]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? memories.filter(c =>
          [c.title, c.content, c.aiSummary, ...(c.tags || [])].join(' ').toLowerCase().includes(q),
        )
      : memories;
    const map = new Map<string, {date: string; items: MemoryCardModel[]}>();
    // 公告 置顶；其余按 完整日期+时间 倒序（跨天也正确）。
    const rankCard = (c: MemoryCardModel) =>
      c.tag === '公告' ? Infinity : dateRank(dateOf(c.time)) + parseTime(c.time) * 60000;
    const sorted = [...matched].sort((a, b) => rankCard(b) - rankCard(a));
    sorted.forEach(card => {
      const [dateStr, timeStr] = card.time ? card.time.split(' ') : ['', ''];
      const key = timeStr ? dateStr : '更早';
      if (!map.has(key)) map.set(key, {date: key, items: []});
      map.get(key)!.items.push(card);
    });
    // 日期分组也按日期倒序（今天 → 昨天 → 更早日期 → 更早）。
    return Array.from(map.values()).sort((a, b) => dateRank(b.date) - dateRank(a.date));
  }, [memories, query]);

  const removeCard = (id: string) => setMemories(list => list.filter(c => c.id !== id));

  return (
    <View style={styles.root}>
      <HomeHeader onOpenDrawer={openDrawer} query={query} onChangeQuery={setQuery} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>记忆碎片</Text>
          <TouchableOpacity hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <SlidersHorizontal size={20} color={colors.textMain} />
          </TouchableOpacity>
        </View>

        {loading ? <ActivityIndicator style={{marginTop: 40}} color={colors.textSub} /> : null}

        {groups.map((group, gi) => {
          const historical =
            HISTORICAL_MEMORIES.find(m => m.date === normalizeDateStr(group.date)) ||
            {...HISTORICAL_MEMORIES[gi % HISTORICAL_MEMORIES.length], date: group.date, id: `mock_${gi}`};
          return (
            <View key={group.date} style={{marginBottom: 32}}>
              <Text style={styles.dateLabel}>{group.date}</Text>

              {searching ? null : group.date === '今天' ? (
                <MoodCard
                  data={DAILY_STATUS}
                  isGuest={isGuest}
                  onPress={() => (isGuest ? undefined : nav.push('dailyStatus', {data: DAILY_STATUS}))}
                />
              ) : !isGuest ? (
                <HistoricalCard data={historical} onPress={() => nav.push('historical', {data: historical})} />
              ) : null}

              <View style={{gap: 16}}>
                {group.items.map(card => {
                  const blurred = isGuest && card.tag !== '公告';
                  return (
                    <View key={card.id} style={styles.memRow}>
                      <Text style={styles.time}>{shortTime(card.time)}</Text>
                      <View style={{flex: 1, minWidth: 0}}>
                        <MemoryCard
                          card={card}
                          blurred={blurred}
                          onPress={() => (blurred ? undefined : nav.push('memoryDetail', {card}))}
                          onShare={() => {}}
                          onEdit={() => gate(() => nav.push('editor', {mode: 'edit', card}))}
                          onAppend={() => gate(() => nav.push('editor', {mode: 'append', card}))}
                          onDelete={() => gate(() => removeCard(card.id))}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}

        {searching && groups.length === 0 ? (
          <Text style={styles.searchEmpty}>没有找到「{query.trim()}」相关的记忆</Text>
        ) : null}

        <View style={{height: 130}} />
      </ScrollView>

      <FabCapsule onChat={() => gate(() => nav.push('chat'))} onNote={() => gate(() => nav.push('editor', {mode: 'new'}))} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bgApp},
  body: {paddingHorizontal: space.page, paddingTop: 4},
  sectionHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 20},
  sectionTitle: {fontSize: 18, fontWeight: '700', color: colors.textMain},
  dateLabel: {fontSize: 16, fontWeight: '700', color: colors.textMain, marginBottom: 16},
  memRow: {flexDirection: 'row', gap: 16, alignItems: 'flex-start'},
  time: {width: 44, fontSize: 15, fontWeight: '700', color: colors.textMain, marginTop: 16},
  searchEmpty: {textAlign: 'center', color: colors.textSub, fontSize: 14, marginTop: 40},
});
