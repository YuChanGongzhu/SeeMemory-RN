import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {X, Sparkles, Image as ImageIcon, Video, Mic, Paperclip, AlertCircle, ChevronDown} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {TimelineNode} from '../ui/TimelineNode';
import {useAudioPlayback} from '../hooks/useAudioPlayback';
import {useNav} from '../navigation/nav';
import type {TimelineRecord} from '../types/memory';
import {saveMemory} from '../apis/requests/memory';
import {
  submitMemoryCorrection,
  submitTimelineMemoryCorrection,
  getMemoryCorrection,
  retryMemoryCorrection,
  correctionStageLabel,
  newCorrectionRequestId,
  INSTRUCTION_MAX_LEN,
  TIMELINE_EDIT_MAX_LEN,
  type MemoryCorrection,
} from '../apis/requests/corrections';
import {markMemoryDirty} from '../apis/core/memoryDirty';
import {useAIConsent} from '../privacy/AIConsentContext';

/** 手记正文块。媒体块（图/视频/录音/附件）等 presigned URL 上传接通后再加回来。 */
type Block = {id: string; type: 'text'; value: string};

let seq = 0;
const uid = () => `b_${++seq}`;

type EditorMode = 'new' | 'edit' | 'append' | 'timeline';

/**
 * 编辑器 —— 按 mode 分两条完全不同的路径：
 * - new：块编辑器写一条新记忆，走 POST /app/memory/save。
 * - edit / append：**修正指令**面板。后端 corrections 收的是自然语言指令而非改后的文本。
 * - timeline：时间流对象直接提交结构化节点快照，后端做并发校验并重建记忆链。
 */
export function EditorPage() {
  const nav = useNav();
  const mode: EditorMode = nav.current.params?.mode || 'new';
  return mode === 'new' ? <NewMemoryEditor /> : <CorrectionPanel mode={mode} />;
}

// ==================== new：块编辑器 → /app/memory/save ====================

function NewMemoryEditor() {
  const nav = useNav();
  const {requestAiConsent} = useAIConsent();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([{id: uid(), type: 'text', value: ''}]);
  const [saving, setSaving] = useState(false);

  // 只按文本判定：媒体本期不提交，若把媒体块也算进来，就会出现「按钮可点但点了没反应」。
  const bodyText = blocks
    .filter((b): b is Extract<Block, {type: 'text'}> => b.type === 'text')
    .map(b => b.value.trim())
    .filter(Boolean)
    .join('\n');
  const content = title.trim() ? `${title.trim()}\n${bodyText}` : bodyText;
  const hasContent = content.length > 0;

  const setText = (id: string, value: string) =>
    setBlocks(prev => prev.map(b => (b.id === id && b.type === 'text' ? {...b, value} : b)));

  // 媒体上传（presigned URL）是独立一期。在那之前不插占位块——插了也提交不上去，
  // 只会让用户以为附件存下来了。
  const notifyMediaUnsupported = () =>
    Alert.alert('暂不支持', '图片、录音和附件还在开发中，当前只能保存文字。');

  const save = async () => {
    if (!hasContent || saving) return;
    const allowed = await requestAiConsent({
      data: '你输入的标题与记忆正文',
      purpose: '保存到云端并进行 AI 整理',
    });
    if (!allowed) {
      return;
    }
    setSaving(true);
    try {
      await saveMemory(content);
      // 刻意不调 markMemoryDirty()：碎片有 ≥300s 的滑动防抖（见 saveMemory 注释），
      // 立刻刷新列表拿到的必是旧数据，反而让人以为没保存成功。
      Alert.alert('已保存', '记忆正在整理，几分钟后会出现在列表里。');
      nav.pop();
    } catch (e) {
      setSaving(false);
      Alert.alert('保存失败', e instanceof Error ? e.message : '请稍后重试');
    }
  };

  return (
    // 底部工具栏紧贴多行输入，iOS 不避让键盘就会把工具栏压在键盘下（沿用 ChatPage/LoginScreen 写法）。
    <KeyboardAvoidingView
      style={[styles.root, {paddingTop: insets.top + 8}]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeBtn} onPress={nav.pop}>
          <X size={20} strokeWidth={2.4} color={colors.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>记录思绪</Text>
        <TouchableOpacity
          style={[styles.saveBtn, {backgroundColor: hasContent ? colors.primary : colors.border}]}
          onPress={save}
          disabled={!hasContent || saving}>
          {saving ? <Sparkles size={14} color="#fff" /> : null}
          <Text style={[styles.saveText, {color: hasContent ? '#fff' : colors.textSub}]}>{saving ? '保存中' : '保存'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{flex: 1}} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.title}
          placeholder="标题 (可选)"
          placeholderTextColor={colors.textTertiary}
          value={title}
          onChangeText={setTitle}
        />
        {blocks.map((b, idx) => (
          <TextInput
            key={b.id}
            style={styles.text}
            placeholder={idx === 0 ? '现在的想法是...' : '继续输入...'}
            placeholderTextColor={colors.textTertiary}
            value={b.value}
            onChangeText={t => setText(b.id, t)}
            multiline
          />
        ))}
      </ScrollView>

      <View style={[styles.toolbar, {paddingBottom: insets.bottom + 16}]}>
        <TouchableOpacity style={styles.polish}>
          <Sparkles size={16} fill="#fff" color="#fff" />
          <Text style={styles.polishText}>AI 帮你润色</Text>
        </TouchableOpacity>
        <View style={{flexDirection: 'row', gap: 12}}>
          <TouchableOpacity style={styles.mediaBtn} onPress={notifyMediaUnsupported}><ImageIcon size={20} strokeWidth={2.2} color={colors.textMain} /></TouchableOpacity>
          <TouchableOpacity style={styles.mediaBtn} onPress={notifyMediaUnsupported}><Video size={20} strokeWidth={2.2} color={colors.textMain} /></TouchableOpacity>
          <TouchableOpacity style={styles.mediaBtn} onPress={notifyMediaUnsupported}><Mic size={20} strokeWidth={2.2} color={colors.textMain} /></TouchableOpacity>
          <TouchableOpacity style={styles.mediaBtn} onPress={notifyMediaUnsupported}><Paperclip size={20} strokeWidth={2.2} color={colors.textMain} /></TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ==================== edit / append：修正指令 + 轮询 ====================

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;

const PLACEHOLDER: Record<'edit' | 'append', string> = {
  edit: '哪里错了？该改成什么？\n例如：把「小李」改成「小张」',
  append: '想补充点什么？\n例如：那天下午还去了海边',
};

function CorrectionPanel({mode}: {mode: Exclude<EditorMode, 'new'>}) {
  const nav = useNav();
  const {requestAiConsent} = useAIConsent();
  const insets = useSafeAreaInsets();
  const card = nav.current.params?.card;
  const timelineRecord: TimelineRecord | undefined = nav.current.params?.timelineRecord;
  const timelineMode = mode === 'timeline';
  const headerTitle = timelineMode ? '编辑时间流' : mode === 'append' ? '追加细节' : '编辑记忆';

  const [instruction, setInstruction] = useState(() => timelineMode ? timelineRecord?.content || '' : '');
  const [correction, setCorrection] = useState<MemoryCorrection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const player = useAudioPlayback();
  const anchorBrief: string = card?.aiSummary || card?.content || '';
  const timelineRecords: TimelineRecord[] = card?.timelineRecords || [];
  // 摘要短到不会被截、又没有时间流时，展开按钮没有任何内容可给，就别放出来。
  const canExpand = timelineRecords.length > 0 || anchorBrief.length > 60;

  // 轮询状态放 ref：定时器要在卸载时清掉，且回调里不能读到陈旧的 state。
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const deadlineRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  const leave = useCallback(() => {
    // 时间流详情当前持有的是进入页面时的卡片快照；完成后回首页让列表重新拉取，
    // 避免返回一个看起来“没改成功”的旧时间流。整条记忆编辑保持既有返回行为。
    if (timelineMode) nav.home();
    else nav.pop();
  }, [nav, timelineMode]);

  const finish = useCallback(() => {
    markMemoryDirty();
    leave();
  }, [leave]);

  /** 轮询超时：后端仍在跑，只是不再占着这个页面。不标 dirty——重建没完，刷新只会拿到旧数据。 */
  const bailOutStillRunning = useCallback(() => {
    setBusy(false);
    Alert.alert('仍在处理中', '修正已受理，完成后回列表刷新即可看到。');
    leave();
  }, [leave]);

  const poll = useCallback(
    async (correctionId: string) => {
      if (!mountedRef.current) return;
      // 超时判定放在请求之前：放在成功分支里的话，poll 一抛错就再也走不到这里。
      if (Date.now() > deadlineRef.current) {
        bailOutStillRunning();
        return;
      }
      try {
        const next = await getMemoryCorrection(correctionId);
        if (!mountedRef.current) return;
        setCorrection(next);

        if (next.status === 'completed') {
          setBusy(false);
          finish();
          return;
        }
        if (next.status === 'failed') {
          setBusy(false);
          setError(next.last_error || '修正失败');
          return;
        }
        timerRef.current = setTimeout(() => poll(correctionId), POLL_INTERVAL_MS);
      } catch (e) {
        if (!mountedRef.current) return;
        setBusy(false);
        setError(e instanceof Error ? e.message : '获取修正状态失败');
      }
    },
    [finish, bailOutStillRunning],
  );

  const startPolling = useCallback(
    (correctionId: string) => {
      deadlineRef.current = Date.now() + POLL_TIMEOUT_MS;
      timerRef.current = setTimeout(() => poll(correctionId), POLL_INTERVAL_MS);
    },
    [poll],
  );

  /** 受理后的共同处理：立即终态就地收尾，否则开轮询。 */
  const handleAccepted = useCallback(
    (result: MemoryCorrection) => {
      setCorrection(result);
      if (result.status === 'completed') {
        setBusy(false);
        finish();
        return;
      }
      if (result.status === 'failed') {
        setBusy(false);
        setError(result.last_error || '修正失败');
        return;
      }
      startPolling(result.correction_id);
    },
    [finish, startPolling],
  );

  const submit = async () => {
    const editedText = instruction.trim();
    if (!editedText || busy) return;
    const anchorId = card?.fragmentId;
    if (!anchorId) {
      setError('这条记忆不支持修改');
      return;
    }
    if (timelineMode && (!timelineRecord?.timelineTarget || !card?.fragmentUpdateTime)) {
      setError('这条时间流记录已不存在，请返回后重试');
      return;
    }
    const allowed = await requestAiConsent({
      data: timelineMode ? '修改后的时间流文字及对应记忆内容' : '修正指令及对应的记忆内容',
      purpose: timelineMode ? '发送给第三方 AI 服务修正时间流并重建关联记忆' : '发送给第三方 AI 服务重写并更新记忆',
    });
    if (!allowed) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const requestId = newCorrectionRequestId(anchorId);
      const result = timelineMode
        ? await submitTimelineMemoryCorrection({
            fragmentId: anchorId,
            expectedUpdateTime: card.fragmentUpdateTime!,
            target: timelineRecord!.timelineTarget!,
            correctedText: editedText,
            requestId,
          })
        : await submitMemoryCorrection({
            anchorType: 'fragment',
            anchorId,
            instruction: editedText,
            requestId,
          });
      if (!mountedRef.current) return;
      handleAccepted(result);
    } catch (e) {
      if (!mountedRef.current) return;
      setBusy(false);
      setError(e instanceof Error ? e.message : '提交修正失败');
    }
  };

  const retry = async () => {
    if (!correction || busy) return;
    const allowed = await requestAiConsent({
      data: '此前提交的修正指令及对应记忆内容',
      purpose: '重新执行 AI 记忆修正',
    });
    if (!allowed) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await retryMemoryCorrection(correction.correction_id);
      if (!mountedRef.current) return;
      handleAccepted(result);
    } catch (e) {
      if (!mountedRef.current) return;
      setBusy(false);
      setError(e instanceof Error ? e.message : '重试失败');
    }
  };

  const originalTimelineText = timelineRecord?.content?.trim() || '';
  const canSubmit = instruction.trim().length > 0
    && (!timelineMode || instruction.trim() !== originalTimelineText)
    && !busy;

  return (
    <KeyboardAvoidingView
      style={[styles.root, {paddingTop: insets.top + 8}]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeBtn} onPress={nav.pop}>
          <X size={20} strokeWidth={2.4} color={colors.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        <TouchableOpacity
          style={[styles.saveBtn, {backgroundColor: canSubmit ? colors.primary : colors.border}]}
          onPress={submit}
          disabled={!canSubmit}>
          <Text style={[styles.saveText, {color: canSubmit ? '#fff' : colors.textSub}]}>
            {busy ? '处理中' : '提交'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{flex: 1}} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {timelineMode ? (
          <View style={styles.anchorCard}>
            <Text style={styles.anchorLabel}>正在编辑时间流对象</Text>
            {card?.title ? <Text style={styles.anchorTitle}>{card.title}</Text> : null}
            {timelineRecord ? (
              <View style={styles.timelineTarget}>
                <Text style={styles.anchorNodeTime}>{timelineRecord.time || '未标注时间'}</Text>
                <View style={{flex: 1}}>
                  <TimelineNode
                    node={timelineRecord}
                    playing={!!timelineRecord.url && player.playingId === timelineRecord.url}
                    onTogglePlay={url => player.toggle(url, url).catch(() => {})}
                    playbackTime={player.playingId === timelineRecord.url ? player.currentTime : undefined}
                    playbackDuration={player.playingId === timelineRecord.url ? player.duration : undefined}
                  />
                </View>
              </View>
            ) : <Text style={styles.anchorBrief}>时间流对象不存在</Text>}
          </View>
        ) : (
          /* 只读回显。要说清「哪里错了」就得能看到原文，所以摘要之外还能展开全量时间流。 */
          <View style={styles.anchorCard}>
            <Text style={styles.anchorLabel}>正在修正</Text>
            {card?.title ? <Text style={styles.anchorTitle}>{card.title}</Text> : null}
            {anchorBrief ? (
              <Text style={styles.anchorBrief} numberOfLines={expanded ? undefined : 4}>
                {anchorBrief}
              </Text>
            ) : null}

            {expanded && timelineRecords.length ? (
              <View style={styles.anchorTimeline}>
                {timelineRecords.map(node => (
                  <View key={node.id} style={styles.anchorNode}>
                    <Text style={styles.anchorNodeTime}>{node.time}</Text>
                    <View style={{flex: 1}}>
                      <TimelineNode
                        node={node}
                        playing={!!node.url && player.playingId === node.url}
                        onTogglePlay={url => player.toggle(url, url).catch(() => {})}
                        playbackTime={player.playingId === node.url ? player.currentTime : undefined}
                        playbackDuration={player.playingId === node.url ? player.duration : undefined}
                      />
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {canExpand ? (
              <TouchableOpacity style={styles.anchorToggle} onPress={() => setExpanded(v => !v)}>
                <Text style={styles.anchorToggleText}>{expanded ? '收起' : '展开全文'}</Text>
                <ChevronDown
                  size={14}
                  strokeWidth={2.4}
                  color={colors.textSub}
                  style={expanded ? styles.anchorToggleIconUp : undefined}
                />
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        <TextInput
          style={styles.instruction}
          placeholder={timelineMode ? '输入修改后的时间流内容' : PLACEHOLDER[mode]}
          placeholderTextColor={colors.textTertiary}
          value={instruction}
          onChangeText={t => {
            setInstruction(t);
            if (error) setError(null);
          }}
          editable={!busy}
          multiline
          maxLength={timelineMode ? TIMELINE_EDIT_MAX_LEN : INSTRUCTION_MAX_LEN}
        />
        <Text style={styles.counter}>
          {instruction.length}/{timelineMode ? TIMELINE_EDIT_MAX_LEN : INSTRUCTION_MAX_LEN}
        </Text>

        {/* 整卡编辑可能先跑 LLM 蒸馏；时间流结构化入口则直接受理。 */}
        {busy ? (
          <View style={styles.progress}>
            <ActivityIndicator size="small" color={colors.textMain} />
            <Text style={styles.progressText}>
              {correction ? correctionStageLabel(correction.stage) : '正在理解你的修改…'}
            </Text>
          </View>
        ) : null}

        {/* AI 蒸馏出的原子操作。纯回显、不拦截——理解错了由用户再发一条修正纠正，
            不显示的话用户根本无从知道改歪了。 */}
        {correction?.operations?.length ? (
          <View style={styles.opsBox}>
            <Text style={styles.opsLabel}>AI 理解为</Text>
            {correction.operations.map((op, i) => (
              <Text key={i} style={styles.opsItem}>
                {op.intent === 'forget'
                  ? '• 忘记这条记忆'
                  : op.wrong_text
                    ? `• 把「${op.wrong_text}」改成「${op.corrected_text}」`
                    : `• 补充：${op.corrected_text}`}
              </Text>
            ))}
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <AlertCircle size={16} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {correction?.status === 'failed' && !busy ? (
          <TouchableOpacity style={styles.retryBtn} onPress={retry}>
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.hint}>
          {timelineMode
            ? '保存后会提交针对这条时间流的修正，并重新整理受影响的摘要与关联记忆。'
            : '说清楚「哪里不对、应该是什么」即可，AI 会理解并重新整理这条记忆及其关联内容。'}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bgApp},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16},
  closeBtn: {width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center'},
  headerTitle: {fontSize: 16, fontWeight: '700', color: colors.textMain},
  saveBtn: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20},
  saveText: {fontSize: 14, fontWeight: '600'},
  body: {paddingHorizontal: 24, paddingVertical: 24},
  title: {fontSize: 24, fontWeight: '700', color: colors.textMain, marginBottom: 20, padding: 0},
  text: {fontSize: 17, lineHeight: 27, color: colors.textMain, marginBottom: 12, padding: 0, minHeight: 40},
  mediaBlock: {width: '100%', borderRadius: 16, overflow: 'hidden', backgroundColor: colors.border, marginVertical: 8},
  mediaImg: {width: '100%', aspectRatio: 4 / 3},
  videoPlay: {position: 'absolute', top: '50%', left: '50%', marginLeft: -20, marginTop: -20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center'},
  removeMedia: {position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center'},
  audio: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.dark, borderRadius: radius.pill, padding: 14, marginVertical: 8},
  audioPlay: {width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center'},
  audioName: {fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 4},
  audioDur: {fontSize: 12, color: 'rgba(255,255,255,0.5)'},
  removeChip: {position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center'},
  doc: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bgSecondary, borderRadius: 16, padding: 16, marginVertical: 8},
  docIcon: {width: 40, height: 40, borderRadius: 12, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center'},
  docName: {flex: 1, fontSize: 15, fontWeight: '600', color: colors.textMain},
  toolbar: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(0,0,0,0.04)'},
  polish: {flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.dark, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16},
  polishText: {fontSize: 14, fontWeight: '600', color: '#fff'},
  mediaBtn: {width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center'},

  // —— 修正指令面板 ——
  anchorCard: {backgroundColor: colors.bg, borderRadius: radius.card, padding: 16, marginBottom: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  anchorLabel: {fontSize: 12, fontWeight: '600', color: colors.textSub, marginBottom: 8},
  anchorTitle: {fontSize: 16, fontWeight: '700', color: colors.textMain, marginBottom: 6},
  anchorBrief: {fontSize: 14, lineHeight: 21, color: colors.textSub},
  anchorTimeline: {marginTop: 14, gap: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 14},
  anchorNode: {flexDirection: 'row', gap: 10},
  timelineTarget: {flexDirection: 'row', gap: 10, marginTop: 10, alignItems: 'flex-start'},
  anchorNodeTime: {width: 40, fontSize: 12, fontWeight: '600', color: colors.textTertiary, paddingTop: 2},
  anchorToggle: {flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, alignSelf: 'flex-start'},
  anchorToggleText: {fontSize: 13, fontWeight: '600', color: colors.textSub},
  anchorToggleIconUp: {transform: [{rotate: '180deg'}]},
  instruction: {fontSize: 17, lineHeight: 26, color: colors.textMain, backgroundColor: colors.bg, borderRadius: radius.xxl, padding: 16, minHeight: 140, textAlignVertical: 'top', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  counter: {fontSize: 12, color: colors.textTertiary, textAlign: 'right', marginTop: 8},
  progress: {flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20, backgroundColor: colors.bgSecondary, borderRadius: radius.xxl, padding: 14},
  progressText: {fontSize: 14, fontWeight: '600', color: colors.textMain},
  opsBox: {marginTop: 12, backgroundColor: colors.bg, borderRadius: radius.xxl, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  opsLabel: {fontSize: 12, fontWeight: '600', color: colors.textSub, marginBottom: 8},
  opsItem: {fontSize: 14, lineHeight: 22, color: colors.textMain},
  errorBox: {flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 20, backgroundColor: colors.dangerSoft, borderRadius: radius.xxl, padding: 14},
  errorText: {flex: 1, fontSize: 14, lineHeight: 21, color: colors.danger},
  retryBtn: {marginTop: 12, alignSelf: 'flex-start', backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.pill},
  retryText: {fontSize: 14, fontWeight: '600', color: '#fff'},
  hint: {fontSize: 13, lineHeight: 20, color: colors.textTertiary, marginTop: 24},
});
