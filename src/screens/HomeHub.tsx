import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {View, Text, SectionList, TouchableOpacity, ActivityIndicator, StyleSheet, Alert} from 'react-native';
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
import {searchMemoryFragments} from '../apis/requests/memory';
import {submitMemoryCorrection, newCorrectionRequestId} from '../apis/requests/corrections';
import {consumeMemoryDirty} from '../apis/core/memoryDirty';
import {fragmentToCard, parseTime, shortTime} from '../apis/mappers/fragment';
import {getTodayMood, getMoodHistory, moodToDailyStatus, moodToHistorical} from '../apis/requests/mood';
import {HomeFilterSheet, type SortBy, type MediaType} from '../components/HomeFilterSheet';
import {HomeDeviceButton} from '../components/HomeDeviceButton';
import {TransferBadge} from '../screens/hardware/TransferBadge';
import {WELCOME_MEMORY, DEMO_MEMORIES, DAILY_STATUS, HISTORICAL_MEMORIES} from '../data/mock';
import type {MemoryCard as MemoryCardModel, DailyStatus, HistoricalMemory} from '../types/memory';

/** 记忆碎片每页条数：首屏与后续滚动加载共用。 */
const PAGE_SIZE = 20;

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
  // 真实情绪卡：今日 + 历史（按日期匹配）。null/空时回落 mock，不影响碎片列表。
  const [todayMood, setTodayMood] = useState<DailyStatus | null>(null);
  const [moodHistory, setMoodHistory] = useState<HistoricalMemory[]>([]);

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
    // 情绪卡（今日 + 历史）与碎片列表并行拉取；失败静默回落 mock，不阻断首页。
    getTodayMood()
      .then(m => mountedRef.current && setTodayMood(m ? moodToDailyStatus(m) : null))
      .catch(() => {});
    getMoodHistory(1, 14)
      .then(r => mountedRef.current && setMoodHistory((r.items || []).map(moodToHistorical)))
      .catch(() => {});
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

  // 写操作（新建 / 修正 / 删除）后回到首页时补一次刷新。
  // RootView 把整个栈都挂载着、首页不会重挂，所以靠「首页重回栈顶」当焦点信号（home 恒在 index 0）。
  const isFocused = nav.stack.length === 1;
  useEffect(() => {
    if (isFocused && consumeMemoryDirty()) {
      refresh();
    }
  }, [isFocused, refresh]);

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
        // 优先真实情绪历史卡（按日期匹配）；无则回落 mock。
        historical:
          moodHistory.find(m => m.date === normalizeDateStr(g.date)) ||
          HISTORICAL_MEMORIES.find(m => m.date === normalizeDateStr(g.date)) ||
          {...HISTORICAL_MEMORIES[gi % HISTORICAL_MEMORIES.length], date: g.date, id: `mock_${gi}`},
      })),
    [groups, moodHistory],
  );

  /**
   * 删除 = 提交一条 forget 修正命令（后端蒸馏成 forget 意图后异步重建）。
   * 受理即本地移除做乐观更新——重建是异步的，等它跑完再消失反而像卡住了；
   * 失败则把卡片放回去，不留下「以为删了其实还在」的假象。
   */
  const deleteCard = (card: MemoryCardModel) => {
    const anchorId = card.fragmentId;
    if (!anchorId) return; // 调用方已按 writable 过滤，这里只是兜底
    Alert.alert('删除这条记忆？', '将让 AI 忘记这条记忆及其关联内容，需要一点时间处理，不可撤销。', [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          // 回滚要恢复原位次，所以整份快照，不是把卡片 append 回去。
          let snapshot: MemoryCardModel[] = [];
          setMemories(list => {
            snapshot = list;
            return list.filter(c => c.id !== card.id);
          });
          submitMemoryCorrection({
            anchorType: 'fragment',
            anchorId,
            instruction: '忘记这条记忆',
            requestId: newCorrectionRequestId(anchorId),
          }).catch(e => {
            if (!mountedRef.current) return;
            setMemories(snapshot);
            Alert.alert('删除失败', e instanceof Error ? e.message : '请稍后重试');
          });
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <HomeHeader
        onOpenDrawer={openDrawer}
        query={query}
        onChangeQuery={setQuery}
        right={<HomeDeviceButton />}
      />
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
                data={isGuest ? DAILY_STATUS : todayMood ?? DAILY_STATUS}
                isGuest={isGuest}
                onPress={() =>
                  isGuest ? undefined : nav.push('dailyStatus', {data: todayMood ?? DAILY_STATUS})
                }
                onOpenHistorical={h => nav.push('historical', {data: h})}
              />
            ) : !isGuest ? (
              <HistoricalCard data={section.historical} onPress={() => nav.push('historical', {data: section.historical})} />
            ) : null}
          </View>
        )}
        renderItem={({item: card}) => {
          const blurred = isGuest && card.tag !== '公告';
          // 只有真碎片能改：空态/离线态顶上来的欢迎卡没有 fragmentId，露出编辑删除只会打到 404。
          const writable = !!card.fragmentId;
          return (
            <View style={styles.memRow}>
              <Text style={styles.time}>{shortTime(card.time)}</Text>
              <View style={{flex: 1, minWidth: 0}}>
                <MemoryCard
                  card={card}
                  blurred={blurred}
                  onPress={() => (blurred ? undefined : nav.push('memoryDetail', {card}))}
                  onShare={() => {}}
                  onEdit={writable ? () => gate(() => nav.push('editor', {mode: 'edit', card})) : undefined}
                  onAppend={writable ? () => gate(() => nav.push('editor', {mode: 'append', card})) : undefined}
                  onDelete={writable ? () => gate(() => deleteCard(card)) : undefined}
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

      {/* 记忆粒同步 / WiFi 快传进度浮标（读全局 useMr20，与设备页共用一套状态）。
          抬高到 FAB 胶囊之上，避免与底部悬浮按钮重叠。 */}
      <TransferBadge bottom={120} />
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
