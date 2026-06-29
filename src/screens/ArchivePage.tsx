import React, {useEffect, useState} from 'react';
import {View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronLeft, Search, Archive as ArchiveIcon, User, Tag as TagIcon} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {useNav} from '../navigation/nav';
import {useAuth} from '../auth/AuthContext';
import {listMemorySummaries, getMemorySummary, type MemorySummaryCard, type MemorySummaryDetail} from '../apis/requests/summaries';
import {DEMO_TOPIC_ARCHIVES} from '../data/mock';
import type {TopicArchive} from '../types/memory';

const FILTERS = ['全部', '人物', '项目', '周期', '自定义'];
const FILTER_TYPE: Record<string, 'person' | 'event' | 'time' | undefined> = {
  全部: undefined, 人物: 'person', 项目: 'event', 周期: 'time', 自定义: undefined,
};
const TYPE_TAG: Record<string, '人物' | '项目' | '话题'> = {person: '人物', event: '项目', time: '话题'};

function cardToArchive(c: MemorySummaryCard): TopicArchive {
  return {
    id: c.summary_id,
    tag: TYPE_TAG[c.summary_type] || '话题',
    entity: c.target_labels?.[0] || c.title,
    title: c.title,
    date: (c.created_at || '').slice(0, 10).replace(/-/g, '.'),
    count: c.segment_count,
    timespan: c.period_type,
    auraColor: c.summary_type === 'person' ? '#BF5AF2' : '#0A84FF',
    insight: c.brief,
    keywords: [],
    topicGroups: [],
  };
}

function detailToArchive(base: TopicArchive, d: MemorySummaryDetail): TopicArchive {
  return {
    ...base,
    insight: d.reflection || d.brief || base.insight,
    keywords: d.keywords || [],
    topicGroups: (d.timeline || []).map((t, i) => ({
      id: `${base.id}_${i}`,
      timeRange: t.anchor,
      title: t.content,
      count: t.session_count,
      drillDownCard: {id: `${base.id}_${i}`, type: 'memory', tag: base.tag, time: t.anchor, title: t.content, aiSummary: t.content, hasAI: true},
    })),
  };
}

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
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
          <ArchiveIcon size={14} color="rgba(255,255,255,0.5)" />
          <Text style={styles.meta}>关联 {data.count} 碎片</Text>
        </View>
        <Text style={styles.meta}>跨度: {data.timespan}</Text>
      </View>
    </TouchableOpacity>
  );
}

/** 沉淀 ArchiveTab — Prototype App.jsx:2875. Wired to /v1/memory/summary/list (device); mock fallback. */
export function ArchivePage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const {selectedDevice} = useAuth();
  const [filter, setFilter] = useState('全部');
  const [items, setItems] = useState<TopicArchive[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!selectedDevice) {
      setItems(DEMO_TOPIC_ARCHIVES);
      setLoading(false);
      return;
    }
    setLoading(true);
    listMemorySummaries({summary_type: FILTER_TYPE[filter], page: 1, page_size: 20})
      .then(res => {
        if (!alive) return;
        const mapped = (res.items || []).map(cardToArchive);
        setItems(mapped.length ? mapped : DEMO_TOPIC_ARCHIVES);
      })
      .catch(() => alive && setItems(DEMO_TOPIC_ARCHIVES))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [filter, selectedDevice?.subDomain]);

  const list = filter === '全部' ? items : items.filter(a => a.tag === TYPE_TAG[FILTER_TYPE[filter] || ''] || FILTER_TYPE[filter] === undefined);

  const openTopic = (a: TopicArchive) => {
    getMemorySummary(String(a.id))
      .then(d => nav.push('topicSummary', {data: detailToArchive(a, d)}))
      .catch(() => nav.push('topicSummary', {data: a}));
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
          <TouchableOpacity onPress={nav.pop} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <ChevronLeft size={24} color={colors.textMain} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>我的沉淀</Text>
        </View>
        <View style={styles.searchBtn}>
          <Search size={18} color={colors.textMain} />
        </View>
      </View>

      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 10, paddingHorizontal: 20}}>
          {FILTERS.map(f => (
            <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.filterChip, {backgroundColor: filter === f ? colors.primary : colors.border}]}>
              <Text style={{fontSize: 13, fontWeight: '600', color: filter === f ? '#fff' : colors.textSub}}>{f}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{marginTop: 40}} />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {list.length ? (
            list.map(a => <TopicCard key={a.id} data={a} onPress={() => openTopic(a)} />)
          ) : (
            <View style={styles.empty}>
              <ArchiveIcon size={48} color={colors.border} />
              <Text style={styles.emptyText}>暂无相关维度的沉淀档案</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bgApp},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16},
  headerTitle: {fontSize: 22, fontWeight: '800', color: colors.textMain},
  searchBtn: {width: 36, height: 36, borderRadius: 18, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center'},
  filterBar: {paddingBottom: 16},
  filterChip: {paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill},
  body: {paddingHorizontal: 20, paddingBottom: 120},
  card: {backgroundColor: colors.darkCard, borderRadius: radius.bigCard, padding: 24, marginBottom: 16, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)'},
  aura: {position: 'absolute', top: -40, right: -40, width: 120, height: 120, borderRadius: 60, opacity: 0.25},
  tagPill: {flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, marginBottom: 16},
  tagPillText: {color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '700'},
  cardTitle: {fontSize: 20, fontWeight: '700', color: '#fff', lineHeight: 28, marginBottom: 16},
  metaRow: {flexDirection: 'row', alignItems: 'center', gap: 16},
  meta: {fontSize: 13, color: 'rgba(255,255,255,0.5)'},
  empty: {alignItems: 'center', marginTop: 60, gap: 16},
  emptyText: {color: colors.textTertiary, fontSize: 14},
});
