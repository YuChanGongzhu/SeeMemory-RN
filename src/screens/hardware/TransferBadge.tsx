/**
 * 传输状态浮标 —— 替代原来居中的「正在传输…」阻塞弹窗。传输/连接进行时只在底部浮一个
 * 小「传输中」药丸，用户可继续浏览/返回做别的事；点一下展开详情条(进度 + 取消/继续/知道了)。
 *
 * 同时覆盖两条链路：WiFi 快传(useMr20.wifi* 状态机) 与 蓝牙同步(syncing/syncProgress)。
 * 读全局状态，故在设备文件页 / 设备主页 / WiFi 快传页任意挂载都一致。
 */
import React, {useState} from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {AlertCircle, CheckCircle2, ChevronUp, Rocket, X} from 'lucide-react-native';
import {ProgressBar} from '../../ui/kit';
import {useMr20} from '../../hooks/useMr20';
import {HW} from './parts';

const stripMp3 = (n: string) => n.replace(/\.mp3$/i, '');

export function TransferBadge() {
  const {
    syncing,
    syncProgress,
    stopSync,
    wifiPhase,
    wifiProgress,
    wifiSummary,
    wifiCred,
    cancelWifiTransfer,
    continueWifiAfterManualJoin,
    resetWifiTransfer,
    error,
  } = useMr20();

  const [expanded, setExpanded] = useState(false);

  const wifiActive = wifiPhase !== 'idle';
  const bleActive = syncing && !wifiActive;
  if (!wifiActive && !bleActive) {
    return null;
  }

  // 归一化出「显示态」，两条链路共用一套浮标。
  const kind: 'progress' | 'connecting' | 'manual' | 'done' | 'error' = bleActive
    ? 'progress'
    : wifiPhase === 'connecting'
    ? 'connecting'
    : wifiPhase === 'manual'
    ? 'manual'
    : wifiPhase === 'done'
    ? 'done'
    : wifiPhase === 'error'
    ? 'error'
    : 'progress';

  const prog = bleActive ? syncProgress : wifiProgress;
  const done = kind === 'done';
  const failed = kind === 'error';
  const busy = kind === 'progress' || kind === 'connecting';

  const label =
    kind === 'connecting'
      ? '连接设备热点…'
      : kind === 'manual'
      ? '请完成热点连接'
      : kind === 'done'
      ? `已同步 ${wifiSummary?.count ?? 0} 个`
      : kind === 'error'
      ? '同步失败'
      : prog
      ? `传输中 ${prog.completed}/${prog.total}`
      : '传输中…';

  const cancel = () => (bleActive ? stopSync() : cancelWifiTransfer());
  const dismiss = () => {
    setExpanded(false);
    resetWifiTransfer();
  };

  const Icon = done ? CheckCircle2 : failed || kind === 'manual' ? AlertCircle : null;
  const tint = done ? HW.green : failed || kind === 'manual' ? HW.red : HW.blue;

  return (
    <View style={st.wrap} pointerEvents="box-none">
      {expanded ? (
        <View style={st.card}>
          <View style={st.cardHead}>
            <Text style={st.cardTitle}>{label}</Text>
            <TouchableOpacity onPress={() => setExpanded(false)} hitSlop={st.hit}>
              <X size={18} color={HW.textSub} />
            </TouchableOpacity>
          </View>

          {busy && prog?.current ? (
            <>
              <Text style={st.file} numberOfLines={1}>
                {stripMp3(prog.current.fname)}
              </Text>
              <View style={st.progressWrap}>
                <ProgressBar
                  value={prog.current.received}
                  total={prog.current.size}
                  color={HW.blue}
                  height={6}
                />
              </View>
            </>
          ) : null}

          {kind === 'manual' ? (
            <Text style={st.hintText}>
              自动连接未成功。请到系统「设置 → 无线局域网」连接热点
              {wifiCred?.ssid ? ` ${wifiCred.ssid}` : ''}
              {wifiCred?.pwd ? `（密码 ${wifiCred.pwd}）` : ''}，连上后点「我已连接」。
            </Text>
          ) : null}
          {failed ? (
            <Text style={st.hintText}>{error || '已传完的录音已保留，可重试剩余文件。'}</Text>
          ) : null}

          <View style={st.actions}>
            {kind === 'manual' ? (
              <>
                <TouchableOpacity style={st.ghostBtn} onPress={() => Linking.openSettings()}>
                  <Text style={st.ghostBtnText}>去系统设置</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={st.primaryBtn}
                  onPress={() => continueWifiAfterManualJoin().catch(() => undefined)}>
                  <Text style={st.primaryBtnText}>我已连接</Text>
                </TouchableOpacity>
              </>
            ) : busy ? (
              <TouchableOpacity style={st.ghostBtn} onPress={cancel}>
                <Text style={st.ghostBtnText}>取消传输</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={st.primaryBtn} onPress={dismiss}>
                <Text style={st.primaryBtnText}>知道了</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : null}

      {/* 折叠药丸：常驻底部，点开/收起详情 */}
      <TouchableOpacity
        style={st.pill}
        activeOpacity={0.85}
        onPress={() => setExpanded(v => !v)}>
        {busy ? (
          <ActivityIndicator size="small" color={tint} />
        ) : Icon ? (
          <Icon size={18} color={tint} />
        ) : (
          <Rocket size={16} color={tint} />
        )}
        <Text style={st.pillText} numberOfLines={1}>
          {label}
        </Text>
        <ChevronUp
          size={16}
          color={HW.textTertiary}
          style={expanded ? st.chevOpen : undefined}
        />
      </TouchableOpacity>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: {position: 'absolute', left: 0, right: 0, bottom: 28, alignItems: 'center'},
  pill: {flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '86%', backgroundColor: '#fff', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: {width: 0, height: 4}, elevation: 6},
  pillText: {flexShrink: 1, fontSize: 14, color: HW.textMain, fontWeight: '600'},
  chevOpen: {transform: [{rotate: '180deg'}]},

  card: {width: '86%', backgroundColor: '#fff', borderRadius: 18, padding: 16, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: {width: 0, height: 6}, elevation: 8},
  cardHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  cardTitle: {fontSize: 15, fontWeight: '700', color: HW.textMain},
  hit: {top: 8, bottom: 8, left: 8, right: 8},
  file: {fontSize: 13, color: HW.textSub, marginTop: 10},
  progressWrap: {marginTop: 8},
  hintText: {fontSize: 13, color: HW.textBody, lineHeight: 19, marginTop: 10},
  actions: {flexDirection: 'row', gap: 10, marginTop: 14},
  ghostBtn: {flex: 1, height: 42, borderRadius: 12, backgroundColor: HW.fill, alignItems: 'center', justifyContent: 'center'},
  ghostBtnText: {fontSize: 14, color: HW.textMain, fontWeight: '600'},
  primaryBtn: {flex: 1, height: 42, borderRadius: 12, backgroundColor: HW.blue, alignItems: 'center', justifyContent: 'center'},
  primaryBtnText: {fontSize: 14, color: '#fff', fontWeight: '700'},
});
