import React, {useEffect, useState} from 'react';
import {View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronLeft, Plus, Bell, Clock, PenLine, Trash2} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {useWriteGate} from '../hooks/useWriteGate';
import {useNav} from '../navigation/nav';
import {listReminders, deleteReminder, updateReminder, type ScheduleJob} from '../apis/requests/reminders';
import {TaskDialog} from './TaskDialog';
import type {Todo} from '../types/memory';

const FILTERS = ['全部', '一次性', '周期性'] as const;

/** once 显示执行时间(MM/DD HH:mm)，recurring 显示 cron。 */
function formatWhen(j: ScheduleJob): string {
  if (j.kind === 'once') {
    if (!j.fire_at) return '-';
    const d = new Date(j.fire_at);
    if (isNaN(d.getTime())) return j.fire_at;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  return j.cron || '-';
}

function toTodo(j: ScheduleJob): Todo {
  return {
    id: j.id,
    title: j.name,
    description: j.prompt || '',
    type: j.kind === 'recurring' ? '周期性' : '一次性',
    time: formatWhen(j),
    source: 'App',
    enabled: j.enabled !== false,
  };
}

/** 待办提醒 — Prototype TodoTab (App.jsx:2282). Wired to manager-api /app/cron via reminders.ts。 */
export function TodoPage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const gate = useWriteGate();
  const [filter, setFilter] = useState<string>('全部');
  const [jobs, setJobs] = useState<ScheduleJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [editing, setEditing] = useState<ScheduleJob | null>(null);

  const reload = () => {
    setLoading(true);
    listReminders()
      .then(res => setJobs(res.items || []))
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // /app/cron 按登录用户维度，后端解析当前设备，无需选中盒子。
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const todos = jobs.map(toTodo);
  const list = todos.filter(t => filter === '全部' || t.type === filter);

  const openCreate = () => {
    setDialogMode('create');
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (id: Todo['id']) => {
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    setDialogMode('edit');
    setEditing(job);
    setDialogOpen(true);
  };

  const toggle = async (t: Todo) => {
    const next = !t.enabled;
    setJobs(js => js.map(j => (j.id === t.id ? {...j, enabled: next} : j)));
    try {
      await updateReminder(String(t.id), {enabled: next});
    } catch {
      reload();
    }
  };

  const remove = async (id: Todo['id']) => {
    setJobs(js => js.filter(j => j.id !== id));
    try {
      await deleteReminder(String(id));
    } catch {
      reload();
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <TouchableOpacity onPress={nav.pop} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <ChevronLeft size={24} color={colors.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>待办提醒</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => gate(openCreate)}>
          <Plus size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.filterBar}>
        {FILTERS.map(f => (
          <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.chip, {backgroundColor: filter === f ? colors.primary : colors.bgSecondary}]}>
            <Text style={{fontSize: 14, fontWeight: '600', color: filter === f ? '#fff' : colors.textMain}}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{marginTop: 40}} />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {list.length === 0 ? <Text style={styles.empty}>暂无待办，点右上角 + 新建</Text> : null}
          {list.map(todo => (
            <View key={todo.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={{flexDirection: 'row', gap: 12, flex: 1}}>
                  <View style={styles.bell}>
                    <Bell size={18} color={colors.textMain} />
                  </View>
                  <View style={{flex: 1}}>
                    <Text style={styles.title}>{todo.title}</Text>
                    <View style={styles.badges}>
                      <View style={styles.badge}><Text style={styles.badgeText}>{todo.type}</Text></View>
                      <View style={styles.badge}><Text style={styles.badgeText}>来源: {todo.source}</Text></View>
                      <View style={styles.badge}><Clock size={10} color={colors.textSub} /><Text style={[styles.badgeText, {color: colors.textSub}]}> {todo.time}</Text></View>
                    </View>
                  </View>
                </View>
                <TouchableOpacity onPress={() => gate(() => toggle(todo))} style={[styles.switch, {backgroundColor: todo.enabled ? colors.primary : colors.border}]}>
                  <View style={[styles.knob, {left: todo.enabled ? 22 : 2}]} />
                </TouchableOpacity>
              </View>

              {todo.description ? <Text style={styles.desc} numberOfLines={3}>{todo.description}</Text> : null}

              <View style={styles.cardFooter}>
                <Text style={styles.status}>{todo.enabled ? '已启用' : '已停用'}</Text>
                <View style={{flexDirection: 'row', gap: 16}}>
                  <TouchableOpacity onPress={() => gate(() => openEdit(todo.id))}><PenLine size={16} color={colors.textSub} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => gate(() => remove(todo.id))}><Trash2 size={16} color={colors.textSub} /></TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
          <View style={{height: 40}} />
        </ScrollView>
      )}

      <TaskDialog
        visible={dialogOpen}
        mode={dialogMode}
        task={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={reload}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bgApp},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12},
  headerTitle: {fontSize: 18, fontWeight: '700', color: colors.textMain},
  addBtn: {width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'},
  filterBar: {flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 16},
  chip: {paddingHorizontal: 16, paddingVertical: 6, borderRadius: radius.pill},
  body: {paddingHorizontal: 20, paddingBottom: 40},
  empty: {textAlign: 'center', color: colors.textSub, marginTop: 40, fontSize: 14},
  card: {backgroundColor: colors.bg, borderRadius: radius.bigCard, padding: 20, marginBottom: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.03)'},
  cardTop: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16},
  bell: {width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center'},
  title: {fontSize: 16, fontWeight: '700', color: colors.textMain, marginBottom: 8},
  badges: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  badge: {flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgSecondary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10},
  badgeText: {fontSize: 11, fontWeight: '600', color: colors.textMain},
  switch: {width: 44, height: 24, borderRadius: 12, marginLeft: 12},
  knob: {width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', position: 'absolute', top: 2},
  desc: {fontSize: 14, color: colors.textSub, lineHeight: 21, marginBottom: 16},
  cardFooter: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.bgSecondary},
  status: {fontSize: 12, color: colors.textSub, fontWeight: '600'},
});
