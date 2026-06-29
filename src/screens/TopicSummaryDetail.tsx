import React from 'react';
import {View, Text, ScrollView, TouchableOpacity, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronLeft, ChevronRight, Sparkles, Archive as ArchiveIcon, User, Tag as TagIcon} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {useNav} from '../navigation/nav';
import type {TopicArchive} from '../types/memory';

function icon(tag: string) {
  if (tag === '人物') return <User size={14} color="#fff" />;
  if (tag === '话题') return <TagIcon size={14} color="#fff" />;
  return <ArchiveIcon size={14} color="#fff" />;
}

/** 话题沉淀详情 (dark) — Prototype TopicSummaryDetail (App.jsx:2501). */
export function TopicSummaryDetail() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const data: TopicArchive = nav.current.params?.data;
  if (!data) return <View style={{flex: 1, backgroundColor: colors.darkCard}} />;

  return (
    <View style={{flex: 1, backgroundColor: colors.darkCard}}>
      <View style={[styles.aura, {backgroundColor: data.auraColor, opacity: 0.18}]} />
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <TouchableOpacity style={styles.backBtn} onPress={nav.pop}>
          <ChevronLeft size={24} strokeWidth={2.4} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={{alignItems: 'center', marginBottom: 40}}>
          <View style={styles.entityPill}>
            {icon(data.tag)}
            <Text style={styles.entityText}>{data.tag}: {data.entity}</Text>
          </View>
          <Text style={styles.title}>{data.title}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>生成于 {data.date}</Text>
            <Text style={styles.meta}>共 {data.count} 碎片</Text>
            <Text style={styles.meta}>{data.timespan}</Text>
          </View>
        </View>

        <View style={styles.insightCard}>
          <View style={styles.insightHead}>
            <Sparkles size={16} color={data.auraColor} />
            <Text style={styles.insightHeadText}>全息洞察摘要</Text>
          </View>
          <Text style={styles.insightText}>{data.insight}</Text>
          <View style={styles.kwRow}>
            {data.keywords.map(kw => (
              <View key={kw} style={styles.kw}><Text style={styles.kwText}>#{kw}</Text></View>
            ))}
          </View>
        </View>

        <Text style={styles.sectionLabel}>相关记忆</Text>
        <View style={{gap: 16}}>
          {data.topicGroups.length ? (
            data.topicGroups.map(g => (
              <TouchableOpacity key={g.id} style={styles.group} activeOpacity={0.85} onPress={() => nav.push('memoryDetail', {card: g.drillDownCard})}>
                <View style={{flex: 1}}>
                  <Text style={styles.groupRange}>{g.timeRange}</Text>
                  <Text style={styles.groupTitle}>{g.title}</Text>
                  <View style={styles.groupBadge}>
                    <ArchiveIcon size={12} color="rgba(255,255,255,0.5)" />
                    <Text style={styles.groupBadgeText}>包含 {g.count} 个碎片</Text>
                  </View>
                </View>
                <View style={styles.groupChevron}>
                  <ChevronRight size={18} color="#fff" />
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <Text style={styles.emptyGroups}>暂无子议题钻取记录</Text>
          )}
        </View>
        <View style={{height: 60}} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  aura: {position: 'absolute', top: -100, left: 0, right: 0, height: 360, borderRadius: 200},
  header: {paddingHorizontal: 20, paddingBottom: 12},
  backBtn: {width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center'},
  body: {paddingHorizontal: 24, paddingTop: 8},
  entityPill: {flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginBottom: 20},
  entityText: {color: '#fff', fontSize: 12, fontWeight: '700'},
  title: {fontSize: 26, fontWeight: '800', color: '#fff', lineHeight: 34, textAlign: 'center', marginBottom: 24},
  metaRow: {flexDirection: 'row', gap: 16},
  meta: {fontSize: 13, color: 'rgba(255,255,255,0.6)'},
  insightCard: {backgroundColor: 'rgba(255,255,255,0.03)', padding: 24, borderRadius: radius.bigCard, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 40},
  insightHead: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20},
  insightHeadText: {fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.5)'},
  insightText: {fontSize: 15, color: 'rgba(255,255,255,0.85)', lineHeight: 27, marginBottom: 20},
  kwRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  kw: {backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6},
  kwText: {color: 'rgba(255,255,255,0.7)', fontSize: 12},
  sectionLabel: {fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.5)', letterSpacing: 1, marginBottom: 20},
  group: {flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radius.pill, padding: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.05)'},
  groupRange: {fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: '600', marginBottom: 6},
  groupTitle: {fontSize: 16, color: '#fff', fontWeight: '600', marginBottom: 12},
  groupBadge: {flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6},
  groupBadgeText: {fontSize: 11, color: 'rgba(255,255,255,0.9)', fontWeight: '600'},
  groupChevron: {width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center'},
  emptyGroups: {textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: 20},
});
