import React, {useEffect, useState} from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';
import {Clock, Users, Activity, Calendar, Sparkles, X, Check} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {BottomSheet} from '../ui/BottomSheet';
import {
  listPersonOptions, searchTopicEvents,
  type PersonOption, type TopicEventOption,
} from '../apis/requests/memory';
import {
  createMemorySummary,
  type MemorySummaryDetail, type SummaryType, type SummaryPeriodType,
} from '../apis/requests/summaries';
import {useAIConsent} from '../privacy/AIConsentContext';

type Dim = SummaryType; // 'time' | 'person' | 'event'

const DIMS: {id: Dim; label: string; Icon: typeof Clock}[] = [
  {id: 'time', label: '按时间', Icon: Clock},
  {id: 'person', label: '按人物', Icon: Users},
  {id: 'event', label: '按事情', Icon: Activity},
];

const GRANS: {id: SummaryPeriodType; label: string}[] = [
  {id: 'daily', label: '每日'},
  {id: 'weekly', label: '每周'},
  {id: 'monthly', label: '每月'},
  {id: 'custom', label: '自定义'},
];

const MAX_TARGETS = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** daily=今天；weekly=近 7 天；monthly=近 30 天（滚动窗口，均以今天为结束）。 */
function autoRange(gran: SummaryPeriodType): {start: string; end: string} {
  const today = new Date();
  const end = ymd(today);
  if (gran === 'daily') return {start: end, end};
  const s = new Date(today);
  s.setDate(s.getDate() - (gran === 'weekly' ? 6 : 29));
  return {start: ymd(s), end};
}

/** 新建总结弹窗 — 三维度（时间/人物/事件），人物/事件走真实选择器，生成后由 onGenerated 回传详情。 */
export function CreateSummarySheet({
  visible,
  onClose,
  onGenerated,
}: {
  visible: boolean;
  onClose: () => void;
  onGenerated: (detail: MemorySummaryDetail) => void | Promise<void>;
}) {
  const {requestAiConsent} = useAIConsent();
  const [dim, setDim] = useState<Dim>('time');
  const [gran, setGran] = useState<SummaryPeriodType>('daily');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [personQuery, setPersonQuery] = useState('');
  const [personOpts, setPersonOpts] = useState<PersonOption[]>([]);
  const [personLoading, setPersonLoading] = useState(false);
  const [pickedPersons, setPickedPersons] = useState<Set<string>>(new Set());

  const [eventQuery, setEventQuery] = useState('');
  const [eventOpts, setEventOpts] = useState<TopicEventOption[]>([]);
  const [eventLoading, setEventLoading] = useState(false);
  const [pickedEvents, setPickedEvents] = useState<Set<string>>(new Set());

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 打开时重置到初始态。
  useEffect(() => {
    if (!visible) return;
    setDim('time');
    setGran('daily');
    setCustomStart('');
    setCustomEnd('');
    setPersonQuery('');
    setPickedPersons(new Set());
    setEventQuery('');
    setPickedEvents(new Set());
    setError(null);
  }, [visible]);

  // 人物选择器：query 变化 300ms 防抖拉取。
  useEffect(() => {
    if (!visible || dim !== 'person') return;
    let alive = true;
    setPersonLoading(true);
    const t = setTimeout(() => {
      listPersonOptions(personQuery.trim())
        .then(opts => alive && setPersonOpts(opts || []))
        .catch(() => alive && setPersonOpts([]))
        .finally(() => alive && setPersonLoading(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [visible, dim, personQuery]);

  // 事件选择器：同上。
  useEffect(() => {
    if (!visible || dim !== 'event') return;
    let alive = true;
    setEventLoading(true);
    const t = setTimeout(() => {
      searchTopicEvents({query: eventQuery.trim(), pageSize: 20})
        .then(res => alive && setEventOpts(res.items || []))
        .catch(() => alive && setEventOpts([]))
        .finally(() => alive && setEventLoading(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [visible, dim, eventQuery]);

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) {
      next.delete(id);
    } else {
      if (next.size >= MAX_TARGETS) {
        setError(`最多选择 ${MAX_TARGETS} 个`);
        return;
      }
      next.add(id);
    }
    setError(null);
    apply(next);
  };

  const customValid = DATE_RE.test(customStart) && DATE_RE.test(customEnd);
  const canGenerate = !generating && (
    dim === 'time' ? (gran !== 'custom' || customValid)
      : dim === 'person' ? pickedPersons.size > 0
      : pickedEvents.size > 0
  );

  const onGenerate = async () => {
    if (!canGenerate) return;
    const allowed = await requestAiConsent({
      data: '所选时间、人物或事件范围内的记忆内容',
      purpose: '发送给第三方 AI 服务生成多维总结',
    });
    if (!allowed) {
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      let req;
      if (dim === 'time') {
        const r = gran === 'custom' ? {start: customStart, end: customEnd} : autoRange(gran);
        req = {summary_type: 'time' as const, period_type: gran, start_time: r.start, end_time: r.end};
      } else if (dim === 'person') {
        // person/event 的时间窗可选，但后端 period_type 恒为必填，用 custom 表示无固定周期。
        req = {summary_type: 'person' as const, period_type: 'custom' as const, target_ids: [...pickedPersons]};
      } else {
        req = {summary_type: 'event' as const, period_type: 'custom' as const, target_ids: [...pickedEvents]};
      }
      const detail = await createMemorySummary(req);
      await onGenerated(detail);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败，请稍后再试');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{flex: 1}}>
          <Text style={styles.title}>新建总结</Text>
          <Text style={styles.subtitle}>选择维度（时间 / 人物 / 事件），由 AI 提炼一份记忆总结。</Text>
        </View>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <X size={16} strokeWidth={2.5} color={colors.textMain} />
        </TouchableOpacity>
      </View>

      {/* Dimension */}
      <Text style={styles.label}>生成方式</Text>
      <View style={styles.dimRow}>
        {DIMS.map(({id, label, Icon}) => {
          const on = dim === id;
          return (
            <TouchableOpacity key={id} activeOpacity={0.85} onPress={() => setDim(id)} style={[styles.dimBtn, on && styles.dimBtnOn]}>
              <Icon size={16} color={on ? colors.premium : colors.textSub} />
              <Text style={[styles.dimText, on && styles.dimTextOn]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Time granularity */}
      {dim === 'time' ? (
        <>
          <Text style={styles.label}>时间粒度</Text>
          <View style={styles.granRow}>
            {GRANS.map(g => {
              const on = gran === g.id;
              return (
                <TouchableOpacity key={g.id} activeOpacity={0.85} onPress={() => setGran(g.id)} style={[styles.granBtn, on && styles.granBtnOn]}>
                  <Text style={[styles.granText, on && styles.granTextOn]}>{g.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {gran === 'custom' ? (
            <View style={styles.dateRow}>
              <TextInput style={styles.dateInput} placeholder="开始 2026-06-01" placeholderTextColor={colors.textTertiary} value={customStart} onChangeText={setCustomStart} autoCapitalize="none" />
              <Text style={styles.dateSep}>~</Text>
              <TextInput style={styles.dateInput} placeholder="结束 2026-06-30" placeholderTextColor={colors.textTertiary} value={customEnd} onChangeText={setCustomEnd} autoCapitalize="none" />
            </View>
          ) : (
            <View style={styles.rangeHint}>
              <Calendar size={16} color={colors.textSub} />
              <Text style={styles.rangeHintText}>
                {(() => { const r = autoRange(gran); return r.start === r.end ? r.start : `${r.start} ~ ${r.end}`; })()}
              </Text>
            </View>
          )}
        </>
      ) : null}

      {/* Person picker */}
      {dim === 'person' ? (
        <>
          <Text style={styles.label}>选择人物 <Text style={styles.req}>*</Text> {pickedPersons.size ? `已选 ${pickedPersons.size}` : ''}</Text>
          <TextInput style={styles.search} placeholder="搜索人物，例如：老板、张三" placeholderTextColor={colors.textTertiary} value={personQuery} onChangeText={setPersonQuery} autoCapitalize="none" />
          <PickerList
            loading={personLoading}
            empty={personOpts.length === 0}
            emptyText="没有匹配的人物"
            rows={personOpts.map(p => ({id: p.entity_id, title: p.name, sub: p.description || p.labels?.join(' · ') || undefined}))}
            selected={pickedPersons}
            onToggle={id => toggle(pickedPersons, id, setPickedPersons)}
          />
        </>
      ) : null}

      {/* Event picker */}
      {dim === 'event' ? (
        <>
          <Text style={styles.label}>选择事件 <Text style={styles.req}>*</Text> {pickedEvents.size ? `已选 ${pickedEvents.size}` : ''}</Text>
          <TextInput style={styles.search} placeholder="搜索事件，例如：年度复盘、出差" placeholderTextColor={colors.textTertiary} value={eventQuery} onChangeText={setEventQuery} autoCapitalize="none" />
          <PickerList
            loading={eventLoading}
            empty={eventOpts.length === 0}
            emptyText="没有匹配的事件"
            rows={eventOpts.map(e => ({id: e.event_id, title: e.content, sub: e.timestamp}))}
            selected={pickedEvents}
            onToggle={id => toggle(pickedEvents, id, setPickedEvents)}
          />
        </>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerHint}>AI 通常需要 5-30 秒生成</Text>
        <TouchableOpacity
          style={[styles.genBtn, !canGenerate && styles.genBtnOff]}
          activeOpacity={0.85}
          disabled={!canGenerate}
          onPress={onGenerate}>
          {generating ? <ActivityIndicator size="small" color="#fff" /> : <Sparkles size={16} color={colors.premium} />}
          <Text style={styles.genText}>{generating ? '生成中…' : '生成总结'}</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

function PickerList({
  loading, empty, emptyText, rows, selected, onToggle,
}: {
  loading: boolean;
  empty: boolean;
  emptyText: string;
  rows: {id: string; title: string; sub?: string}[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (loading) {
    return <ActivityIndicator style={{marginVertical: 24}} color={colors.textSub} />;
  }
  if (empty) {
    return <Text style={styles.pickerEmpty}>{emptyText}</Text>;
  }
  return (
    <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {rows.map(r => {
        const on = selected.has(r.id);
        return (
          <TouchableOpacity key={r.id} activeOpacity={0.7} onPress={() => onToggle(r.id)} style={styles.pickerRow}>
            <View style={{flex: 1, minWidth: 0}}>
              <Text style={styles.pickerTitle} numberOfLines={1}>{r.title}</Text>
              {r.sub ? <Text style={styles.pickerSub} numberOfLines={1}>{r.sub}</Text> : null}
            </View>
            <View style={[styles.checkbox, on && styles.checkboxOn]}>
              {on ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {flexDirection: 'row', alignItems: 'flex-start', marginBottom: 24},
  title: {fontSize: 18, fontWeight: '700', color: colors.textMain, marginBottom: 6},
  subtitle: {fontSize: 13, color: colors.textSub, lineHeight: 18},
  closeBtn: {width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center', marginLeft: 12},
  label: {fontSize: 14, fontWeight: '600', color: colors.textMain, marginBottom: 12, marginTop: 8},
  req: {color: colors.anxiety},
  dimRow: {flexDirection: 'row', gap: 12},
  dimBtn: {flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.xxl, backgroundColor: colors.bgSecondary},
  dimBtnOn: {backgroundColor: colors.textMain},
  dimText: {fontSize: 14, fontWeight: '600', color: colors.textSub},
  dimTextOn: {color: '#fff'},
  granRow: {flexDirection: 'row', gap: 6, backgroundColor: colors.bgSecondary, borderRadius: radius.xxl, padding: 4},
  granBtn: {flex: 1, paddingVertical: 8, borderRadius: radius.lg, alignItems: 'center'},
  granBtnOn: {backgroundColor: colors.bg},
  granText: {fontSize: 13, fontWeight: '600', color: colors.textSub},
  granTextOn: {color: colors.textMain},
  rangeHint: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: radius.xxl, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.bg},
  rangeHintText: {fontSize: 15, color: colors.textMain},
  dateRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12},
  dateInput: {flex: 1, paddingVertical: 14, paddingHorizontal: 14, borderRadius: radius.xxl, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, fontSize: 14, color: colors.textMain, backgroundColor: colors.bg},
  dateSep: {color: colors.textSub, fontSize: 14},
  search: {paddingVertical: 14, paddingHorizontal: 16, borderRadius: radius.xxl, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, fontSize: 15, color: colors.textMain, backgroundColor: colors.bg},
  pickerList: {maxHeight: 220, marginTop: 8},
  pickerEmpty: {textAlign: 'center', color: colors.textSub, fontSize: 13, paddingVertical: 24},
  pickerRow: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.bgSecondary},
  pickerTitle: {fontSize: 15, fontWeight: '600', color: colors.textMain},
  pickerSub: {fontSize: 12, color: colors.textSub, marginTop: 2},
  checkbox: {width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center'},
  checkboxOn: {backgroundColor: colors.textMain, borderColor: colors.textMain},
  error: {color: colors.anxiety, fontSize: 13, marginTop: 14},
  footer: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24},
  footerHint: {fontSize: 12, color: colors.textSub, flex: 1},
  genBtn: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 24, borderRadius: radius.xxl, backgroundColor: colors.textMain},
  genBtnOff: {opacity: 0.4},
  genText: {fontSize: 15, fontWeight: '600', color: '#fff'},
});
