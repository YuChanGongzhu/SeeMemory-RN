import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronLeft, Sparkles, Archive as ArchiveIcon, User, Tag as TagIcon} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {useNav} from '../navigation/nav';
import {useAuth} from '../auth/AuthContext';
import {
  listMemorySummaries, getMemorySummary, getMemorySummaryTimeline,
  type ListMemorySummaryRequest,
} from '../apis/requests/summaries';
import {summaryCardToArchive, summaryDetailToArchive} from '../apis/mappers/summary';
import {DEMO_TOPIC_ARCHIVES} from '../data/mock';
import type {TopicArchive} from '../types/memory';

const PAGE_SIZE = 20;

// 过滤芯片 → 后端 list 参数（summary_type / period_type）。列表接口无文本检索，关键词走客户端。
const FILTERS = ['全部', '人物', '项目', '周期', '自定义'] as const;
const FILTER_PARAMS: Record<string, Pick<ListMemorySummaryRequest, 'summary_type' | 'period_type'>> = {
  全部: {},
  人物: {summary_type: 'person'},
  项目: {summary_type: 'event'},
  周期: {summary_type: 'time'},
  自定义: {period_type: 'custom'},
};

function topicIcon(tag: string, color = 'rgba(255,255,255,0.9)') {
  if (tag === '人物') return <User size={14} color={color} />;
  if (tag === '话题') return <TagIcon size={14} color={color} />;
  return <ArchiveIcon size={14} color={color} />;
}

function TopicCard({data, onPress}: {data: TopicArchive; onPress: () => void}) {
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={styles.card}>
      <View style={[styles.aura, {backgroundColor: data.auraColor}]} />
      <View style={styles.tagPill}>
        {topicIcon(data.tag)}
        <Text style={styles.tagPillText}>{data.tag}: {data.entity}</Text>
      </View>
      <Text style={styles.cardTitle}>{data.title}</Text>
      <View style={styles.metaRow}>
        <View style={styles.metaLeft}>
          <ArchiveIcon size={14} color="rgba(255,255,255,0.5)" />
          <Text style={styles.meta}>关联 {data.count} 碎片</Text>
        </View>
        <Text style={styles.meta}>跨度: {data.timespan}</Text>
      </View>
    </TouchableOpacity>
  );
}

/** 沉淀 ArchiveTab — 多维总结的浏览/检索：芯片走后端 summary/list（type/period），文本关键词客户端过滤，滚动分页。 */
export function ArchivePage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const {isGuest} = useAuth();

  const [filter, setFilter] = useState<string>('全部');
  const [query, setQuery] = useState('');

  const [items, setItems] = useState<TopicArchive[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqSeq = useRef(0);

  const fetchPage = useCallback(
    (targetPage: number, replace: boolean) => {
      // 游客没有云端沉淀，直接展示 demo。
      if (isGuest) {
        setItems(DEMO_TOPIC_ARCHIVES);
        setTotalPages(1);
        setLoading(false);
        return;
      }
      const seq = ++reqSeq.current;
      if (replace) setLoading(true); else setLoadingMore(true);
      setError(null);
      listMemorySummaries({...FILTER_PARAMS[filter], page: targetPage, page_size: PAGE_SIZE})
        .then(res => {
          if (seq !== reqSeq.current) return; // 丢弃过期响应（快速切芯片）
          const mapped = (res.items || []).map(summaryCardToArchive);
          setItems(prev => (replace ? mapped : [...prev, ...mapped]));
          setPage(res.page || targetPage);
          setTotalPages(res.total_pages || 1);
        })
        .catch(e => {
          if (seq !== reqSeq.current) return;
          if (replace) setItems([]);
          setError(e instanceof Error ? e.message : '加载失败');
        })
        .finally(() => {
          if (seq !== reqSeq.current) return;
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [filter, isGuest],
  );

  // 切换芯片：回到第 1 页重拉。
  useEffect(() => {
    fetchPage(1, true);
  }, [fetchPage]);

  const loadMore = () => {
    if (loading || loadingMore || page >= totalPages) return;
    fetchPage(page + 1, false);
  };

  // 关键词检索：列表接口无 query 字段，对已加载项做标题/实体/洞察/关键词客户端过滤。
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(a =>
      [a.title, a.entity, a.insight, ...(a.keywords || [])].join(' ').toLowerCase().includes(q),
    );
  }, [items, query]);

  const openTopic = (a: TopicArchive) => {
    Promise.all([
      getMemorySummary(String(a.id)),
      getMemorySummaryTimeline(String(a.id)).catch(() => undefined),
    ])
      .then(([d, tl]) => nav.push('topicSummary', {data: summaryDetailToArchive(d, tl)}))
      .catch(() => nav.push('topicSummary', {data: a}));
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={nav.pop} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <ChevronLeft size={24} color={colors.textMain} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>我的沉淀</Text>
        </View>
      </View>

      {/* 常驻搜索栏，与 HomeHub 一致（客户端过滤已加载项）。 */}
      <View style={styles.searchRow}>
        <Sparkles size={16} color={colors.textSub} />
        <TextInput
          style={styles.searchInput}
          placeholder="搜索沉淀"
          placeholderTextColor={colors.textSub}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>

      <View style={styles.filterBar}>
        <FlatList
          horizontal
          data={FILTERS as unknown as string[]}
          keyExtractor={f => f}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterContent}
          renderItem={({item: f}) => (
            <TouchableOpacity onPress={() => setFilter(f)} style={[styles.filterChip, {backgroundColor: filter === f ? colors.primary : colors.border}]}>
              <Text style={[styles.filterText, {color: filter === f ? '#fff' : colors.textSub}]}>{f}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {loading && items.length === 0 ? (
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={a => a.id}
          renderItem={({item}) => <TopicCard data={item} onPress={() => openTopic(item)} />}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.textSub} style={{marginVertical: 20}} /> : null}
          ListEmptyComponent={
            <View style={styles.empty}>
              <ArchiveIcon size={48} color={colors.border} />
              <Text style={styles.emptyText}>
                {error ? `加载失败：${error}` : query.trim() ? `没有匹配「${query.trim()}」的沉淀` : '暂无相关维度的沉淀档案'}
              </Text>
              {error ? (
                <TouchableOpacity style={styles.retry} onPress={() => fetchPage(1, true)}>
                  <Text style={styles.retryText}>重试</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bgApp},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16},
  headerLeft: {flexDirection: 'row', alignItems: 'center', gap: 12},
  headerTitle: {fontSize: 22, fontWeight: '800', color: colors.textMain},
  searchRow: {flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, marginHorizontal: 20, marginBottom: 16, paddingHorizontal: 14, borderRadius: radius.lg, backgroundColor: colors.bgSecondary},
  searchInput: {flex: 1, fontSize: 15, color: colors.textMain, padding: 0},
  filterBar: {paddingBottom: 16},
  filterContent: {gap: 10, paddingHorizontal: 20},
  filterChip: {paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill},
  filterText: {fontSize: 13, fontWeight: '600'},
  spinner: {marginTop: 40},
  body: {paddingHorizontal: 20, paddingBottom: 120, flexGrow: 1},
  card: {backgroundColor: colors.darkCard, borderRadius: radius.bigCard, padding: 24, marginBottom: 16, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)'},
  aura: {position: 'absolute', top: -40, right: -40, width: 120, height: 120, borderRadius: 60, opacity: 0.25},
  tagPill: {flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, marginBottom: 16},
  tagPillText: {color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '700'},
  cardTitle: {fontSize: 20, fontWeight: '700', color: '#fff', lineHeight: 28, marginBottom: 16},
  metaRow: {flexDirection: 'row', alignItems: 'center', gap: 16},
  metaLeft: {flexDirection: 'row', alignItems: 'center', gap: 4},
  meta: {fontSize: 13, color: 'rgba(255,255,255,0.5)'},
  empty: {alignItems: 'center', marginTop: 60, gap: 16},
  emptyText: {color: colors.textTertiary, fontSize: 14, textAlign: 'center', paddingHorizontal: 40},
  retry: {paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: colors.bgSecondary},
  retryText: {fontSize: 14, fontWeight: '600', color: colors.textMain},
});
