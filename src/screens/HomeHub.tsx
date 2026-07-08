import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {View, Text, SectionList, TouchableOpacity, ActivityIndicator, StyleSheet} from 'react-native';
import {SlidersHorizontal, RotateCw} from 'lucide-react-native';
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
import {HomeFilterSheet, type SortBy, type MediaType} from '../components/HomeFilterSheet';
import {WELCOME_MEMORY, DEMO_MEMORIES, DAILY_STATUS, HISTORICAL_MEMORIES} from '../data/mock';
import type {MemoryCard as MemoryCardModel, TimelineRecord} from '../types/memory';

/** 记忆碎片每页条数：首屏与后续滚动加载共用。 */
const PAGE_SIZE = 20;

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

/** files[].meta.duration_ms（毫秒）→ 'm:ss'；无效返回 undefined（时间流回落 0:00）。 */
function durationFromMeta(meta: Record<string, unknown> | null): string | undefined {
  const raw = meta?.duration_ms;
  const ms = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!isFinite(ms) || ms <= 0) {
    return undefined;
  }
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 记忆碎片 → 首页/详情页共用的 MemoryCard 模型。 */
function fragmentToCard(f: MemoryFragment): MemoryCardModel {
  const files = f.files || [];
  const imageFiles = files.filter(m => m.mime_type?.startsWith('image'));
  const audioFiles = files.filter(m => m.mime_type?.startsWith('audio'));
  const images = imageFiles.map(m => m.url);

  // 时间流：AI 概要 → 文本节点（默认「高光」视图）；图片 files → 图片节点、录音 files → 音频节点
  // （「全量」视图里图片直接铺图、录音可播放），转写/描述放在 content，仿原型 renderTimelineNode。
  const timeline = f.timeline || [];
  const records: TimelineRecord[] = timeline.map((t, i) => ({
    id: i,
    time: t.time,
    type: 'text',
    content: t.content,
  }));
  // files 无独立时间，按序等比锚定到概要时间点，保证「全量」视图里大致按时序排列。
  const anchorTime = (i: number, count: number) =>
    timeline.length
      ? timeline[Math.min(timeline.length - 1, Math.floor((i * timeline.length) / count))].time
      : shortTime(f.start_time);
  imageFiles.forEach((m, i) => {
    records.push({
      id: timeline.length + i,
      time: anchorTime(i, imageFiles.length),
      type: 'image',
      url: m.url,
      content: m.description || undefined,
      name: m.file_name || undefined,
    });
  });
  audioFiles.forEach((m, i) => {
    records.push({
      id: timeline.length + imageFiles.length + i,
      time: anchorTime(i, audioFiles.length),
      type: 'audio',
      name: `语音记录 ${i + 1}`,
      content: m.description || undefined,
      url: m.url,
      duration: durationFromMeta(m.meta),
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
  const {isGuest} = useAuth();
  const gate = useWriteGate();
  const nav = useNav();
  const [memories, setMemories] = useState<MemoryCardModel[]>([]);
  const [loading, setLoading] = useState(true); // 首屏加载
  const [loadingMore, setLoadingMore] = useState(false); // 翻页加载
  // 无真实记忆碎片时只展示欢迎卡：同时隐藏今日状态 / 历史等演示卡片。
  const [isEmpty, setIsEmpty] = useState(false);
  const [query, setQuery] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('created');
  const [mediaType, setMediaType] = useState<MediaType>('all');
  const searching = query.trim().length > 0;
  const filterActive = sortBy !== 'created' || mediaType !== 'all';

  // 分页游标（用 ref 避免闭包读到旧值 / 重复触发）。
  const pageRef = useRef(1);
  const hasMoreRef = useRef(false);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  // 是否成功载入过真实数据：用于区分「真的没有」与「接口请求失败」，失败时不清空已有内容。
  const hasDataRef = useRef(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  // 拉取首页记忆碎片（/app/memory/fragments/search，按时间倒序）。供首屏与右上角「刷新」复用。
  // 失败不再用欢迎卡冒充空态：有旧数据则保留，无数据才退化欢迎卡，并置 loadError 让用户可刷新重试。
  const refresh = useCallback(() => {
    if (inFlightRef.current) return;
    // 游客态（微信一键授权 / 随便看看）：直接展示整套演示记忆，跳过真实接口，
    // 首页即为丰满的 mock（供截图 / 体验）。与 ArchivePage 的 isGuest→DEMO_ 同款。
    if (isGuest) {
      hasDataRef.current = true;
      hasMoreRef.current = false;
      setMemories(DEMO_MEMORIES);
      setIsEmpty(false);
      setLoadError(false);
      setLoading(false);
      return;
    }
    inFlightRef.current = true;
    setLoading(true);
    setLoadError(false);
    searchMemoryFragments({page: 1, pageSize: PAGE_SIZE})
      .then(res => {
        if (!mountedRef.current) return;
        const mapped = (res.items || []).map(fragmentToCard);
        pageRef.current = res.page ?? 1;
        hasMoreRef.current = (res.page ?? 1) < (res.total_pages ?? 1);
        hasDataRef.current = mapped.length > 0;
        setMemories(mapped.length ? mapped : [WELCOME_MEMORY]);
        setIsEmpty(mapped.length === 0);
        setLoadError(false);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        hasMoreRef.current = false;
        setLoadError(true);
        // 只有从未载入过真实数据时才退化欢迎卡；否则保留已有内容，避免把真实记忆清成空态。
        if (!hasDataRef.current) {
          setMemories([WELCOME_MEMORY]);
          setIsEmpty(true);
        }
      })
      .finally(() => {
        if (!mountedRef.current) return;
        inFlightRef.current = false;
        setLoading(false);
      });
  }, [isGuest]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 滚动到底加载下一页：空态 / 无更多 / 已在加载时跳过。客户端搜索仍在已载入集合内过滤，
  // 继续翻页可扩大可搜索范围。
  const loadMore = useCallback(() => {
    if (isEmpty || !hasMoreRef.current || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoadingMore(true);
    const next = pageRef.current + 1;
    searchMemoryFragments({page: next, pageSize: PAGE_SIZE})
      .then(res => {
        const mapped = (res.items || []).map(fragmentToCard);
        pageRef.current = res.page ?? next;
        hasMoreRef.current = (res.page ?? next) < (res.total_pages ?? next);
        setMemories(prev => {
          const seen = new Set(prev.map(c => c.id));
          return [...prev, ...mapped.filter(c => !seen.has(c.id))];
        });
      })
      .catch(() => {
        hasMoreRef.current = false;
      })
      .finally(() => {
        inFlightRef.current = false;
        setLoadingMore(false);
      });
  }, [isEmpty]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? memories.filter(c =>
          [c.title, c.content, c.aiSummary, ...(c.tags || [])].join(' ').toLowerCase().includes(q),
        )
      : memories;

    // 内容载体过滤（原型 HomeTab：语音 / 图像 / 纯文字）。图片/视频/录音既看顶层字段也看时间流。
    const typed = mediaType === 'all' ? matched : matched.filter(c => {
      const topVisual = !!c.image || !!(c.images && c.images.length) || !!c.video;
      const nestedAudio = c.timelineRecords?.some(r => r.type === 'audio' || !!r.audio);
      const nestedVisual = c.timelineRecords?.some(
        r => r.type === 'image' || r.type === 'video' || !!(r.images && r.images.length) || !!r.video,
      );
      const isAudio = !!c.audioCount || !!c.audioDuration || !!nestedAudio;
      const isVisual = topVisual || !!nestedVisual;
      if (mediaType === 'audio') return isAudio;
      if (mediaType === 'visual') return isVisual;
      return !isAudio && !isVisual; // 纯文字
    });

    // 「按最近活跃」用 updateTime 排序（RN 卡片 updateTime 只有 HH:MM，无日期）；日期分组仍按记录日。
    const timeSrc = (c: MemoryCardModel) => (sortBy === 'updated' ? c.updateTime || c.time : c.time);
    const map = new Map<string, {date: string; items: MemoryCardModel[]}>();
    // 公告 置顶；其余按 记录日期 + 所选时间源 倒序。
    const rankCard = (c: MemoryCardModel) =>
      c.tag === '公告' ? Infinity : dateRank(dateOf(c.time)) + parseTime(timeSrc(c)) * 60000;
    const sorted = [...typed].sort((a, b) => rankCard(b) - rankCard(a));
    sorted.forEach(card => {
      const [dateStr, timeStr] = card.time ? card.time.split(' ') : ['', ''];
      const key = timeStr ? dateStr : '更早';
      if (!map.has(key)) map.set(key, {date: key, items: []});
      map.get(key)!.items.push(card);
    });
    // 日期分组也按日期倒序（今天 → 昨天 → 更早日期 → 更早）。
    return Array.from(map.values()).sort((a, b) => dateRank(b.date) - dateRank(a.date));
  }, [memories, query, mediaType, sortBy]);

  // SectionList 分区：由日期分组派生，预算好每组的 mood/historical 头部数据，避免在
  // renderSectionHeader 里靠索引取值。
  const sections = useMemo(
    () =>
      groups.map((g, gi) => ({
        date: g.date,
        data: g.items,
        historical:
          HISTORICAL_MEMORIES.find(m => m.date === normalizeDateStr(g.date)) ||
          {...HISTORICAL_MEMORIES[gi % HISTORICAL_MEMORIES.length], date: g.date, id: `mock_${gi}`},
      })),
    [groups],
  );

  const removeCard = (id: string) => setMemories(list => list.filter(c => c.id !== id));

  return (
    <View style={styles.root}>
      <HomeHeader onOpenDrawer={openDrawer} query={query} onChangeQuery={setQuery} />
      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        ListHeaderComponent={
          <View>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>记忆碎片</Text>
              <View style={styles.headActions}>
                <TouchableOpacity
                  hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
                  disabled={loading}
                  onPress={refresh}>
                  {loading ? (
                    <ActivityIndicator size="small" color={colors.textMain} />
                  ) : (
                    <RotateCw size={19} color={loadError ? '#E5484D' : colors.textMain} />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
                  onPress={() => setShowFilter(true)}>
                  <SlidersHorizontal size={20} color={colors.textMain} />
                  {filterActive ? <View style={styles.filterDot} /> : null}
                </TouchableOpacity>
              </View>
            </View>
            {loadError && !loading ? (
              <Text style={styles.loadErrorText}>加载失败，点右上角刷新重试</Text>
            ) : null}
          </View>
        }
        renderSectionHeader={({section}) => (
          <View>
            <Text style={styles.dateLabel}>{section.date}</Text>
            {searching || isEmpty ? null : section.date === '今天' ? (
              <MoodCard
                data={DAILY_STATUS}
                isGuest={isGuest}
                onPress={() => (isGuest ? undefined : nav.push('dailyStatus', {data: DAILY_STATUS}))}
                onOpenHistorical={h => nav.push('historical', {data: h})}
              />
            ) : !isGuest ? (
              <HistoricalCard data={section.historical} onPress={() => nav.push('historical', {data: section.historical})} />
            ) : null}
          </View>
        )}
        renderItem={({item: card}) => {
          const blurred = isGuest && card.tag !== '公告';
          return (
            <View style={styles.memRow}>
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
        }}
        renderSectionFooter={() => <View style={{height: 16}} />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{marginTop: 40}} color={colors.textSub} />
          ) : searching ? (
            <Text style={styles.searchEmpty}>没有找到「{query.trim()}」相关的记忆</Text>
          ) : null
        }
        ListFooterComponent={
          <>
            {loadingMore ? <ActivityIndicator style={{marginVertical: 8}} color={colors.textSub} /> : null}
            <View style={{height: 130}} />
          </>
        }
      />

      <FabCapsule onChat={() => gate(() => nav.push('chat'))} onNote={() => gate(() => nav.push('editor', {mode: 'new'}))} />

      <HomeFilterSheet
        visible={showFilter}
        onClose={() => setShowFilter(false)}
        sortBy={sortBy}
        onSortBy={setSortBy}
        mediaType={mediaType}
        onMediaType={setMediaType}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bgApp},
  body: {paddingHorizontal: space.page, paddingTop: 4},
  sectionHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 20},
  headActions: {flexDirection: 'row', alignItems: 'center', gap: 16},
  loadErrorText: {fontSize: 12, color: '#E5484D', marginTop: -8, marginBottom: 16},
  sectionTitle: {fontSize: 18, fontWeight: '700', color: colors.textMain},
  filterDot: {position: 'absolute', top: -2, right: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textMain, borderWidth: 2, borderColor: colors.bgApp},
  dateLabel: {fontSize: 16, fontWeight: '700', color: colors.textMain, marginBottom: 16},
  memRow: {flexDirection: 'row', gap: 16, alignItems: 'flex-start', marginBottom: 16},
  time: {width: 44, fontSize: 15, fontWeight: '700', color: colors.textMain, marginTop: 16},
  searchEmpty: {textAlign: 'center', color: colors.textSub, fontSize: 14, marginTop: 40},
});
