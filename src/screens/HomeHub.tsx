import React, {useMemo, useState} from 'react';
import {View, Text, ScrollView, TouchableOpacity, StyleSheet} from 'react-native';
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
import {DEMO_MEMORIES, DAILY_STATUS, HISTORICAL_MEMORIES} from '../data/mock';
import type {MemoryCard as MemoryCardModel} from '../types/memory';

/** Minutes-since-midnight for sorting; non-time labels sort last. */
function parseTime(t?: string): number {
  if (!t) return -1;
  const m = t.match(/(\d{1,2}):(\d{2})/);
  if (!m) return t.includes('刚刚') ? 24 * 60 + 1 : -1;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
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
  const [memories, setMemories] = useState<MemoryCardModel[]>(DEMO_MEMORIES);
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? memories.filter(c =>
          [c.title, c.content, c.aiSummary, ...(c.tags || [])].join(' ').toLowerCase().includes(q),
        )
      : memories;
    const map = new Map<string, {date: string; items: MemoryCardModel[]}>();
    const sorted = [...matched].sort((a, b) => {
      if (a.tag === '公告' && b.tag !== '公告') return -1;
      if (b.tag === '公告' && a.tag !== '公告') return 1;
      return parseTime(b.time) - parseTime(a.time);
    });
    sorted.forEach(card => {
      const [dateStr, timeStr] = card.time ? card.time.split(' ') : ['', ''];
      const key = timeStr ? dateStr : '更早';
      if (!map.has(key)) map.set(key, {date: key, items: []});
      map.get(key)!.items.push(card);
    });
    return Array.from(map.values());
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
