import React, {useEffect, useMemo, useState} from 'react';
import {View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet} from 'react-native';
import {Bell, BellOff} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {BottomSheet} from '../ui/BottomSheet';
import {
  createReminder,
  updateReminder,
  type CreateReminderParams,
  type ScheduleJob,
  type ScheduleKind,
  type UpdateReminderParams,
} from '../apis/requests/reminders';

// 与 see-mem-studio-web 的 task-dialog.tsx 对齐：once → ISO 时间；recurring → 5 段 cron。
// RN 无 datetime/cron 原生控件，这里用纯输入/选择器实现，输出形状一致。

type CronFrequency = 'daily' | 'weekly' | 'monthly';

const TASK_TYPE_LABELS: Record<ScheduleKind, string> = {once: '一次性', recurring: '周期性'};
const TASK_TYPE_HINTS: Record<ScheduleKind, string> = {
  once: '只在指定时间执行一次',
  recurring: '按设定频率循环提醒（每天 / 每周 / 每月）',
};
const FREQUENCY_LABELS: Record<CronFrequency, string> = {daily: '每天', weekly: '每周', monthly: '每月'};
// cron 星期 0-6，0=周日
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const MONTH_DAYS = Array.from({length: 31}, (_, i) => i + 1);
const DEFAULT_TIME = '09:00';

const pad2 = (v: number) => String(v).padStart(2, '0');

const buildCron = (frequency: CronFrequency, time: string, weekday: number, monthday: number) => {
  const [hp, mp] = time.split(':');
  const hour = Number(hp);
  const minute = Number(mp);
  if (frequency === 'weekly') return `${minute} ${hour} * * ${weekday}`;
  if (frequency === 'monthly') return `${minute} ${hour} ${monthday} * *`;
  return `${minute} ${hour} * * *`;
};

type CronParts = {frequency: CronFrequency; time: string; weekday: number; monthday: number};

// 把简单 cron 还原成「每天/每周/每月 + 时间」；不匹配返回 null（走高级模式）。
const parseCron = (expr: string): CronParts | null => {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const mm = Number(minute);
  const hh = Number(hour);
  if (!Number.isInteger(mm) || mm < 0 || mm > 59) return null;
  if (!Number.isInteger(hh) || hh < 0 || hh > 23) return null;
  if (month !== '*') return null;
  const time = `${pad2(hh)}:${pad2(mm)}`;
  if (dayOfMonth === '*' && dayOfWeek === '*') return {frequency: 'daily', time, weekday: 1, monthday: 1};
  if (dayOfMonth === '*' && /^[0-6]$/.test(dayOfWeek)) {
    return {frequency: 'weekly', time, weekday: Number(dayOfWeek), monthday: 1};
  }
  if (dayOfWeek === '*' && /^([1-9]|[12]\d|3[01])$/.test(dayOfMonth)) {
    return {frequency: 'monthly', time, weekday: 1, monthday: Number(dayOfMonth)};
  }
  return null;
};

const describeCron = (frequency: CronFrequency, time: string, weekday: number, monthday: number) => {
  if (!time) return '请选择提醒时间';
  if (frequency === 'weekly') return `每${WEEKDAYS[weekday]} ${time} 提醒`;
  if (frequency === 'monthly') return `每月 ${monthday} 号 ${time} 提醒`;
  return `每天 ${time} 提醒`;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

const toDateStr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toTimeStr = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// once 输入按设备本地时区解读，转 UTC ISO（与 web 的 dayjs.tz(...).toISOString() 等价于本地用户）。
const onceToIso = (dateStr: string, timeStr: string): string | null => {
  if (!DATE_RE.test(dateStr) || !TIME_RE.test(timeStr)) return null;
  const [y, mo, da] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const d = new Date(y, mo - 1, da, h, mi, 0, 0);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

const defaultOnce = () => {
  const d = new Date(Date.now() + 10 * 60 * 1000);
  return {date: toDateStr(d), time: toTimeStr(d)};
};

type Mode = 'create' | 'edit';

interface Props {
  visible: boolean;
  mode: Mode;
  task: ScheduleJob | null;
  onClose: () => void;
  onSaved: () => void;
}

export function TaskDialog({visible, mode, task, onClose, onSaved}: Props) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState<ScheduleKind>('once');
  const [onceDate, setOnceDate] = useState('');
  const [onceTime, setOnceTime] = useState('');
  const [frequency, setFrequency] = useState<CronFrequency>('daily');
  const [timeOfDay, setTimeOfDay] = useState(DEFAULT_TIME);
  const [weekday, setWeekday] = useState(1);
  const [monthday, setMonthday] = useState(1);
  const [cronAdvanced, setCronAdvanced] = useState(false);
  const [cronText, setCronText] = useState(buildCron('daily', DEFAULT_TIME, 1, 1));
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    // 重置默认值
    setError('');
    setSaving(false);
    setFrequency('daily');
    setTimeOfDay(DEFAULT_TIME);
    setWeekday(1);
    setMonthday(1);
    setCronAdvanced(false);
    setCronText(buildCron('daily', DEFAULT_TIME, 1, 1));
    const def = defaultOnce();
    setOnceDate(def.date);
    setOnceTime(def.time);

    if (task) {
      setName(task.name);
      setPrompt(task.prompt ?? '');
      setKind(task.kind);
      setEnabled(task.enabled);
      if (task.kind === 'once') {
        const d = task.fire_at ? new Date(task.fire_at) : null;
        if (d && !isNaN(d.getTime())) {
          setOnceDate(toDateStr(d));
          setOnceTime(toTimeStr(d));
        }
        return;
      }
      const parsed = parseCron(task.cron ?? '');
      if (parsed) {
        setFrequency(parsed.frequency);
        setTimeOfDay(parsed.time);
        setWeekday(parsed.weekday);
        setMonthday(parsed.monthday);
        setCronText(task.cron ?? '');
      } else {
        setCronAdvanced(true);
        setCronText(task.cron || buildCron('daily', DEFAULT_TIME, 1, 1));
      }
      return;
    }
    setName('');
    setPrompt('');
    setKind('once');
    setEnabled(true);
  }, [visible, task]);

  const cronPreview = useMemo(
    () => describeCron(frequency, timeOfDay, weekday, monthday),
    [frequency, timeOfDay, weekday, monthday],
  );

  const toggleAdvanced = () => {
    if (!cronAdvanced) {
      setCronText(buildCron(frequency, timeOfDay, weekday, monthday));
      setCronAdvanced(true);
      return;
    }
    const parsed = parseCron(cronText);
    if (parsed) {
      setFrequency(parsed.frequency);
      setTimeOfDay(parsed.time);
      setWeekday(parsed.weekday);
      setMonthday(parsed.monthday);
    }
    setCronAdvanced(false);
  };

  const submit = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError('请输入提醒内容');
      return;
    }
    const trimmedName = name.trim();

    let whenValue: string;
    if (kind === 'once') {
      const iso = onceToIso(onceDate, onceTime);
      if (!iso) {
        setError('一次性任务时间格式不正确（日期 YYYY-MM-DD，时间 HH:mm）');
        return;
      }
      whenValue = iso;
    } else if (cronAdvanced) {
      whenValue = cronText.trim();
      if (whenValue.split(/\s+/).length !== 5) {
        setError('Cron 表达式需为 5 段，例如 0 9 * * *');
        return;
      }
    } else {
      if (!TIME_RE.test(timeOfDay)) {
        setError('请填写正确的提醒时间（HH:mm）');
        return;
      }
      whenValue = buildCron(frequency, timeOfDay, weekday, monthday);
    }

    setError('');
    setSaving(true);
    try {
      if (mode === 'create') {
        const body: CreateReminderParams = {
          prompt: trimmedPrompt,
          kind,
          when: whenValue,
          ...(trimmedName ? {name: trimmedName} : {}),
        };
        await createReminder(body);
      } else if (task) {
        const body: UpdateReminderParams = {
          prompt: trimmedPrompt,
          when: whenValue,
          ...(trimmedName ? {name: trimmedName} : {}),
          ...(kind === 'recurring' ? {enabled} : {}),
        };
        await updateReminder(task.id, body);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : mode === 'create' ? '创建失败' : '更新失败');
    } finally {
      setSaving(false);
    }
  };

  const Chip = ({active, label, onPress, disabled}: {active: boolean; label: string; onPress: () => void; disabled?: boolean}) => (
    <TouchableOpacity
      onPress={disabled ? undefined : onPress}
      style={[styles.chip, {backgroundColor: active ? colors.primary : colors.bgSecondary, opacity: disabled ? 0.5 : 1}]}>
      <Text style={{fontSize: 13, fontWeight: '600', color: active ? '#fff' : colors.textMain}}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} title={mode === 'create' ? '新建任务' : '编辑任务'}>
      <ScrollView style={{maxHeight: 460}} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.label}>提醒内容 *</Text>
        <TextInput
          style={styles.field}
          placeholder="到点要做/说的事，例如：提醒我喝水"
          placeholderTextColor={colors.textSub}
          value={prompt}
          onChangeText={setPrompt}
        />

        <Text style={styles.label}>名称（可选）</Text>
        <TextInput
          style={styles.field}
          placeholder="留空则自动从内容截取"
          placeholderTextColor={colors.textSub}
          value={name}
          onChangeText={setName}
        />

        <Text style={styles.label}>任务类型</Text>
        <View style={styles.row}>
          {(['once', 'recurring'] as ScheduleKind[]).map(k => (
            <Chip key={k} active={kind === k} label={TASK_TYPE_LABELS[k]} disabled={mode === 'edit'} onPress={() => setKind(k)} />
          ))}
        </View>
        <Text style={styles.hint}>{TASK_TYPE_HINTS[kind]}</Text>

        {kind === 'once' ? (
          <>
            <Text style={styles.label}>执行时间</Text>
            <View style={styles.row}>
              <TextInput
                style={[styles.field, {flex: 1, marginBottom: 0}]}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSub}
                value={onceDate}
                onChangeText={setOnceDate}
                autoCapitalize="none"
              />
              <TextInput
                style={[styles.field, {width: 96, marginBottom: 0}]}
                placeholder="HH:mm"
                placeholderTextColor={colors.textSub}
                value={onceTime}
                onChangeText={setOnceTime}
              />
            </View>
          </>
        ) : (
          <>
            {!cronAdvanced ? (
              <>
                <Text style={styles.label}>重复频率</Text>
                <View style={styles.row}>
                  {(['daily', 'weekly', 'monthly'] as CronFrequency[]).map(f => (
                    <Chip key={f} active={frequency === f} label={FREQUENCY_LABELS[f]} onPress={() => setFrequency(f)} />
                  ))}
                </View>

                {frequency === 'weekly' ? (
                  <>
                    <Text style={styles.label}>星期</Text>
                    <View style={styles.wrapRow}>
                      {WEEKDAYS.map((w, i) => (
                        <Chip key={w} active={weekday === i} label={w} onPress={() => setWeekday(i)} />
                      ))}
                    </View>
                  </>
                ) : null}

                {frequency === 'monthly' ? (
                  <>
                    <Text style={styles.label}>日期</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingVertical: 2}}>
                      {MONTH_DAYS.map(d => (
                        <Chip key={d} active={monthday === d} label={`${d}`} onPress={() => setMonthday(d)} />
                      ))}
                    </ScrollView>
                  </>
                ) : null}

                <Text style={styles.label}>提醒时间</Text>
                <TextInput
                  style={[styles.field, {width: 120}]}
                  placeholder="HH:mm"
                  placeholderTextColor={colors.textSub}
                  value={timeOfDay}
                  onChangeText={setTimeOfDay}
                />
                <Text style={styles.previewText}>{cronPreview}</Text>
              </>
            ) : (
              <>
                <Text style={styles.label}>Cron 表达式</Text>
                <TextInput
                  style={styles.field}
                  placeholder="0 9 * * *"
                  placeholderTextColor={colors.textSub}
                  value={cronText}
                  onChangeText={setCronText}
                  autoCapitalize="none"
                />
                <Text style={styles.hint}>格式：分 时 日 月 周，例如 0 9 * * * 表示每天 9:00。</Text>
              </>
            )}
            <TouchableOpacity onPress={toggleAdvanced}>
              <Text style={styles.linkText}>{cronAdvanced ? '← 用简单方式设置' : '高级：直接填写 Cron 表达式'}</Text>
            </TouchableOpacity>
          </>
        )}

        {mode === 'edit' && kind === 'recurring' ? (
          <>
            <Text style={styles.label}>启用状态</Text>
            <TouchableOpacity
              style={[styles.enabledBtn, {backgroundColor: enabled ? colors.primary : colors.bgSecondary}]}
              onPress={() => setEnabled(v => !v)}>
              {enabled ? <Bell size={16} color="#fff" /> : <BellOff size={16} color={colors.textMain} />}
              <Text style={{fontWeight: '600', color: enabled ? '#fff' : colors.textMain}}>{enabled ? '启用' : '停用'}</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onClose} disabled={saving}>
            <Text style={styles.btnGhostText}>取消</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary, {opacity: saving ? 0.5 : 1}]} onPress={submit} disabled={saving}>
            <Text style={styles.btnPrimaryText}>{saving ? '提交中…' : mode === 'create' ? '创建' : '保存'}</Text>
          </TouchableOpacity>
        </View>
        <View style={{height: 8}} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  label: {fontSize: 14, fontWeight: '600', color: colors.textMain, marginBottom: 10, marginTop: 14},
  hint: {fontSize: 12, color: colors.textSub, marginTop: 8},
  previewText: {fontSize: 12, color: colors.primary, marginTop: 8},
  field: {backgroundColor: colors.bgSecondary, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: colors.textMain, marginBottom: 4},
  row: {flexDirection: 'row', gap: 10, alignItems: 'center'},
  wrapRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  chip: {paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill},
  enabledBtn: {flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14},
  error: {color: '#E5484D', fontSize: 13, marginTop: 14},
  actions: {flexDirection: 'row', gap: 12, marginTop: 22},
  btn: {flex: 1, borderRadius: 16, paddingVertical: 15, alignItems: 'center'},
  btnGhost: {backgroundColor: colors.bgSecondary},
  btnGhostText: {color: colors.textMain, fontSize: 16, fontWeight: '700'},
  btnPrimary: {backgroundColor: colors.primary},
  btnPrimaryText: {color: '#fff', fontSize: 16, fontWeight: '700'},
  linkText: {fontSize: 12, color: colors.textSub, marginTop: 12, textDecorationLine: 'underline'},
});
