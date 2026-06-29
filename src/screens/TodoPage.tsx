import React, {useEffect, useState} from 'react';
import {View, Text, TextInput, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronLeft, Plus, Bell, Clock, PenLine, Trash2, X} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {BottomSheet} from '../ui/BottomSheet';
import {useWriteGate} from '../hooks/useWriteGate';
import {useNav} from '../navigation/nav';
import {useAuth} from '../auth/AuthContext';
import {listReminders, createReminder, deleteReminder, updateReminder, type ScheduleJob} from '../apis/requests/reminders';
import type {Todo} from '../types/memory';

const FILTERS = ['全部', '一次性', '周期性'] as const;

function toTodo(j: ScheduleJob): Todo {
  return {
    id: j.id,
    title: j.name,
    description: j.description || '',
    type: j.taskType === 'cron' ? '周期性' : '一次性',
    time: j.schedule,
    source: 'App',
    enabled: j.enabled !== false,
  };
}

/** 待办提醒 — Prototype TodoTab (App.jsx:2282). Wired to device /cron via reminders.ts. */
export function TodoPage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const gate = useWriteGate();
  const {selectedDevice} = useAuth();
  const [filter, setFilter] = useState<string>('全部');
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDesc, setDraftDesc] = useState('');

  const reload = () => {
    setLoading(true);
    listReminders()
      .then(res => setTodos((res.jobs || []).map(toTodo)))
      .catch(() => setTodos([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!selectedDevice) {
      setTodos([]);
      setLoading(false);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice?.subDomain]);

  const list = todos.filter(t => filter === '全部' || t.type === filter);

  const toggle = async (t: Todo) => {
    setTodos(ts => ts.map(x => (x.id === t.id ? {...x, enabled: !x.enabled} : x)));
    try {
      await updateReminder(String(t.id), {name: t.title, description: t.description, taskType: t.type === '周期性' ? 'cron' : 'once', schedule: t.time, enabled: !t.enabled});
    } catch {
      reload();
    }
  };

  const remove = async (id: Todo['id']) => {
    setTodos(ts => ts.filter(t => t.id !== id));
    try {
      await deleteReminder(String(id));
    } catch {
      reload();
    }
  };

  const create = async () => {
    if (!draftTitle.trim()) return;
    setCreating(false);
    try {
      await createReminder({name: draftTitle.trim(), description: draftDesc.trim(), taskType: 'once', schedule: '明天 09:00'});
      reload();
    } catch {
      // keep silent; reload to reflect server truth
      reload();
    }
    setDraftTitle('');
    setDraftDesc('');
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <TouchableOpacity onPress={nav.pop} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <ChevronLeft size={24} color={colors.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>待办提醒</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => gate(() => setCreating(true))}>
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
          {list.length === 0 ? (
            <Text style={styles.empty}>{selectedDevice ? '暂无待办，点右上角 + 新建' : '请先绑定设备后查看待办'}</Text>
          ) : null}
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
                <TouchableOpacity onPress={() => toggle(todo)} style={[styles.switch, {backgroundColor: todo.enabled ? colors.primary : colors.border}]}>
                  <View style={[styles.knob, {left: todo.enabled ? 22 : 2}]} />
                </TouchableOpacity>
              </View>

              {todo.description ? <Text style={styles.desc} numberOfLines={3}>{todo.description}</Text> : null}

              <View style={styles.cardFooter}>
                <Text style={styles.status}>{todo.enabled ? '已启用' : '已停用'}</Text>
                <View style={{flexDirection: 'row', gap: 16}}>
                  <TouchableOpacity><PenLine size={16} color={colors.textSub} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => remove(todo.id)}><Trash2 size={16} color={colors.textSub} /></TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
          <View style={{height: 40}} />
        </ScrollView>
      )}

      <BottomSheet visible={creating} onClose={() => setCreating(false)}>
        <View style={styles.sheetHead}>
          <View>
            <Text style={styles.sheetTitle}>新建任务</Text>
            <Text style={styles.sheetSub}>填写名称、类型和提醒时间。</Text>
          </View>
          <TouchableOpacity style={styles.sheetClose} onPress={() => setCreating(false)}>
            <X size={16} strokeWidth={2.4} color={colors.textMain} />
          </TouchableOpacity>
        </View>
        <Text style={styles.fieldLabel}>任务名称 *</Text>
        <TextInput style={styles.field} placeholder="例如：每天提醒喝水" placeholderTextColor={colors.textSub} value={draftTitle} onChangeText={setDraftTitle} />
        <Text style={styles.fieldLabel}>描述</Text>
        <TextInput style={[styles.field, {height: 72}]} placeholder="可选" placeholderTextColor={colors.textSub} value={draftDesc} onChangeText={setDraftDesc} multiline />
        <TouchableOpacity style={[styles.createBtn, {opacity: draftTitle.trim() ? 1 : 0.4}]} onPress={create} disabled={!draftTitle.trim()}>
          <Text style={styles.createBtnText}>创建任务</Text>
        </TouchableOpacity>
      </BottomSheet>
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
  sheetHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24},
  sheetTitle: {fontSize: 18, fontWeight: '700', color: colors.textMain, marginBottom: 6},
  sheetSub: {fontSize: 13, color: colors.textSub},
  sheetClose: {width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center'},
  fieldLabel: {fontSize: 14, fontWeight: '600', color: colors.textMain, marginBottom: 12, marginTop: 4},
  field: {backgroundColor: colors.bgSecondary, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: colors.textMain, marginBottom: 20},
  createBtn: {backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 4},
  createBtnText: {color: '#fff', fontSize: 16, fontWeight: '700'},
});
