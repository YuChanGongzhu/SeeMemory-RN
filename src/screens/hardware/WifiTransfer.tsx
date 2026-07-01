/**
 * WiFi 快传子页 —— 控制走 BLE，文件字节走设备热点 TCP（192.168.200.1:8475），
 * 长录音比蓝牙快 ~10×。交互仿 Plaud：勾选文件 → 底部「连接中」清单逐步打勾 → 快传进度 → 完成。
 *
 * 真实链路在 useMr20.startWifiTransfer（mr20WifiSync 编排）；本页只管选择与状态展示。
 * 自动入网失败时降级为「引导手动连接」。
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Circle,
  Rocket,
  Settings,
  Wifi,
} from 'lucide-react-native';
import {BottomSheet} from '../../ui/BottomSheet';
import {ProgressBar} from '../../ui/kit';
import {Mr20DebugLog} from '../../components/mr20/Mr20DebugLog';
import {useMr20} from '../../hooks/useMr20';
import type {Mr20File} from '../../native/mr20/Mr20Client';
import type {WifiConnectStep, WifiStepState} from '../../services/mr20WifiSync';
import {SubHeader, Card, HW} from './parts';

function fmtHuman(total: number): string {
  const s = Math.max(0, Math.round(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

function fmtMB(bytes: number): string {
  const mb = (bytes || 0) / (1024 * 1024);
  return mb >= 100 ? `${Math.round(mb)}MB` : `${mb.toFixed(1)}MB`;
}

const keyOf = (f: Mr20File) => `${f.dir}/${f.fname}`;
const stripMp3 = (n: string) => n.replace(/\.mp3$/i, '');

const STEP_META: {key: WifiConnectStep; label: (ssid?: string) => string}[] = [
  {key: 'open', label: () => '开启设备 WiFi 热点'},
  {key: 'join', label: ssid => `连接到设备热点${ssid ? `（${ssid}）` : ''}`},
  {key: 'reachable', label: () => '校验高速通道 192.168.200.1:8475'},
];

function StepIcon({state}: {state: WifiStepState}) {
  if (state === 'done') {
    return <CheckCircle2 size={20} color={HW.green} />;
  }
  if (state === 'failed') {
    return <AlertCircle size={20} color={HW.red} />;
  }
  if (state === 'active') {
    return <ActivityIndicator size="small" color={HW.blue} />;
  }
  return <Circle size={20} color={HW.textTertiary} />;
}

export function WifiTransfer({onBack}: {onBack: () => void}) {
  const {
    connState,
    listPendingDeviceFiles,
    startWifiTransfer,
    continueWifiAfterManualJoin,
    cancelWifiTransfer,
    resetWifiTransfer,
    wifiPhase,
    wifiSteps,
    wifiProgress,
    wifiCred,
    wifiSummary,
    error,
    logs,
  } = useMr20();

  const [files, setFiles] = useState<Mr20File[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 进页面拉一次待同步文件列表。
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await listPendingDeviceFiles();
      if (!alive) {
        return;
      }
      setFiles(list);
      setSelected(new Set(list.map(keyOf))); // 默认全选
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [listPendingDeviceFiles]);

  // 离开页面释放热点。
  useEffect(() => () => resetWifiTransfer(), [resetWifiTransfer]);

  const groups = useMemo(() => {
    const map = new Map<string, Mr20File[]>();
    for (const f of files) {
      const arr = map.get(f.dir) ?? [];
      arr.push(f);
      map.set(f.dir, arr);
    }
    return Array.from(map.entries());
  }, [files]);

  const selectedFiles = useMemo(
    () => files.filter(f => selected.has(keyOf(f))),
    [files, selected],
  );
  const selectedBytes = selectedFiles.reduce((n, f) => n + (f.size || 0), 0);
  const allSelected = files.length > 0 && selected.size === files.length;

  const toggleOne = useCallback((f: Mr20File) => {
    setSelected(prev => {
      const next = new Set(prev);
      const k = keyOf(f);
      if (next.has(k)) {
        next.delete(k);
      } else {
        next.add(k);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected(prev =>
      prev.size === files.length ? new Set() : new Set(files.map(keyOf)),
    );
  }, [files]);

  const start = useCallback(() => {
    if (selectedFiles.length) {
      startWifiTransfer(selectedFiles).catch(() => undefined);
    }
  }, [selectedFiles, startWifiTransfer]);

  const finishAndBack = useCallback(() => {
    resetWifiTransfer();
    onBack();
  }, [resetWifiTransfer, onBack]);

  const cancel = useCallback(() => {
    cancelWifiTransfer();
  }, [cancelWifiTransfer]);

  const connecting = wifiPhase === 'connecting' || wifiPhase === 'manual';
  const overlay = wifiPhase === 'transferring' || wifiPhase === 'done' || wifiPhase === 'error';

  return (
    <View style={st.root}>
      <SubHeader title="WiFi 快传" onBack={onBack} />

      <ScrollView contentContainerStyle={st.body} showsVerticalScrollIndicator={false}>
        <Card style={st.intro}>
          <View style={st.introIcon}>
            <Wifi size={20} color={HW.blue} />
          </View>
          <Text style={st.introText}>
            通过设备专属热点高速直传，下载长录音比蓝牙快 10 倍以上。
          </Text>
        </Card>

        {connState !== 'connected' ? (
          <Text style={st.hint}>请先连接设备蓝牙，再使用 WiFi 快传。</Text>
        ) : loading ? (
          <ActivityIndicator color={HW.blue} style={{marginTop: 40}} />
        ) : files.length === 0 ? (
          <Text style={st.hint}>没有待传输的录音，所有录音都已同步。</Text>
        ) : (
          <>
            <View style={st.selectHead}>
              <Text style={st.selectTitle}>选择要快传的录音</Text>
              <TouchableOpacity onPress={toggleAll} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                <Text style={st.selectAll}>{allSelected ? '取消全选' : '全选'}</Text>
              </TouchableOpacity>
            </View>

            {groups.map(([dir, items]) => (
              <View key={dir} style={{marginBottom: 8}}>
                <Text style={st.groupLabel}>{dir}</Text>
                <View style={{gap: 10}}>
                  {items.map(f => {
                    const checked = selected.has(keyOf(f));
                    return (
                      <TouchableOpacity
                        key={keyOf(f)}
                        activeOpacity={0.7}
                        style={st.fileRow}
                        onPress={() => toggleOne(f)}>
                        <View style={[st.checkbox, checked && st.checkboxOn]}>
                          {checked ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
                        </View>
                        <View style={{flex: 1}}>
                          <Text style={st.fileName} numberOfLines={1}>
                            {stripMp3(f.fname)}
                          </Text>
                          <Text style={st.fileMeta}>
                            {fmtHuman(f.seconds)} · {fmtMB(f.size)}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </>
        )}

        {/* 协议调试日志：定位开热点(WIFIO/WIFIS)真实往返用 */}
        <Mr20DebugLog logs={logs} />
      </ScrollView>

      {/* 底部固定行动按钮 */}
      {connState === 'connected' && files.length > 0 ? (
        <View style={st.footer}>
          <TouchableOpacity
            style={[st.startBtn, selectedFiles.length === 0 && st.startBtnDisabled]}
            disabled={selectedFiles.length === 0}
            onPress={start}>
            <Rocket size={18} color="#fff" />
            <Text style={st.startBtnText}>
              开始快传{selectedFiles.length ? `（${selectedFiles.length} 个文件 · ${fmtMB(selectedBytes)}）` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* 连接中 / 引导手动连接 清单 */}
      <BottomSheet visible={connecting} onClose={cancel} title="连接中">
        <View style={st.steps}>
          {STEP_META.map(s => (
            <View key={s.key} style={st.stepRow}>
              <StepIcon state={wifiSteps[s.key]} />
              <Text style={st.stepLabel}>{s.label(wifiCred?.ssid)}</Text>
            </View>
          ))}
        </View>

        {wifiPhase === 'manual' ? (
          <View style={st.manualBox}>
            <Text style={st.manualText}>
              自动连接未成功。请到系统「设置 → 无线局域网」连接热点
              {wifiCred?.ssid ? ` ${wifiCred.ssid}` : ''}
              {wifiCred?.pwd ? `（密码 ${wifiCred.pwd}）` : ''}
              ，请在 30 秒内连上并尽快回到 App 点下方继续（超时设备热点会自动关闭）。
            </Text>
            <TouchableOpacity style={st.manualBtn} onPress={() => Linking.openSettings()}>
              <Settings size={16} color={HW.blue} />
              <Text style={st.manualBtnText}>去系统设置连接</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={st.primaryBtn}
              onPress={() => continueWifiAfterManualJoin().catch(() => undefined)}>
              <Text style={st.primaryBtnText}>我已连接，继续</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={st.connectingHint}>请保持设备靠近手机，按提示在弹窗中点「加入」。</Text>
        )}

        <TouchableOpacity style={st.cancelLink} onPress={cancel}>
          <Text style={st.cancelLinkText}>取消</Text>
        </TouchableOpacity>
      </BottomSheet>

      {/* 传输中 / 完成 / 失败 覆盖层 */}
      {overlay ? (
        <View style={st.overlay}>
          {wifiPhase === 'transferring' ? (
            <View style={st.overlayCard}>
              <Text style={st.overlayTitle}>正在快传…</Text>
              <Text style={st.overlayCount}>
                {wifiProgress ? `${wifiProgress.completed} / ${wifiProgress.total}` : ''}
              </Text>
              {wifiProgress?.current ? (
                <>
                  <Text style={st.overlayFile} numberOfLines={1}>
                    {stripMp3(wifiProgress.current.fname)}
                  </Text>
                  <View style={{width: '100%', marginTop: 12}}>
                    <ProgressBar
                      value={wifiProgress.current.received}
                      total={wifiProgress.current.size}
                      color={HW.blue}
                      height={8}
                    />
                  </View>
                  <Text style={st.overlayBytes}>
                    {fmtMB(wifiProgress.current.received)} / {fmtMB(wifiProgress.current.size)}
                  </Text>
                </>
              ) : (
                <ActivityIndicator color={HW.blue} style={{marginTop: 16}} />
              )}
              <TouchableOpacity style={st.cancelBtn} onPress={cancel}>
                <Text style={st.cancelBtnText}>取消快传</Text>
              </TouchableOpacity>
            </View>
          ) : wifiPhase === 'done' ? (
            <View style={st.overlayCard}>
              <View style={st.successOrb}>
                <Check size={36} color="#fff" strokeWidth={3} />
              </View>
              <Text style={st.overlayTitle}>快传成功</Text>
              <Text style={st.overlaySub}>
                {wifiSummary
                  ? `${wifiSummary.count} 个文件 · ${fmtMB(wifiSummary.bytes)}`
                  : ''}
                {wifiSummary && wifiSummary.failed > 0 ? `（${wifiSummary.failed} 个失败）` : ''}
              </Text>
              <Text style={st.overlayNote}>已自动入库，可在录音列表继续上传转写。</Text>
              <TouchableOpacity style={st.primaryBtn} onPress={finishAndBack}>
                <Text style={st.primaryBtnText}>完成</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={st.overlayCard}>
              <View style={st.errorOrb}>
                <AlertCircle size={36} color="#fff" />
              </View>
              <Text style={st.overlayTitle}>快传中断</Text>
              <Text style={st.overlaySub}>{error || '已传完的录音已保留，可重试剩余文件。'}</Text>
              <TouchableOpacity style={st.primaryBtn} onPress={start}>
                <Text style={st.primaryBtnText}>重试</Text>
              </TouchableOpacity>
              {/* 关闭弹窗但留在本页，便于展开下方「协议调试日志」查看往返 */}
              <TouchableOpacity style={st.cancelBtn} onPress={resetWifiTransfer}>
                <Text style={st.cancelBtnText}>返回</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  root: {flex: 1, backgroundColor: HW.pageBg},
  body: {padding: 20, paddingBottom: 120},
  intro: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16},
  introIcon: {width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0F8FF', alignItems: 'center', justifyContent: 'center'},
  introText: {flex: 1, fontSize: 13, color: HW.textBody, lineHeight: 19},
  hint: {fontSize: 14, color: HW.textSub, textAlign: 'center', paddingVertical: 40, lineHeight: 21},

  selectHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 14},
  selectTitle: {fontSize: 17, fontWeight: '700', color: HW.textMain},
  selectAll: {fontSize: 14, color: HW.blue, fontWeight: '600'},
  groupLabel: {fontSize: 14, fontWeight: '700', color: HW.textMain, marginBottom: 10, paddingHorizontal: 4},
  fileRow: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: HW.card, borderRadius: 16, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: HW.cardBorder},
  checkbox: {width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: HW.textTertiary, alignItems: 'center', justifyContent: 'center'},
  checkboxOn: {backgroundColor: HW.blue, borderColor: HW.blue},
  fileName: {fontSize: 15, fontWeight: '600', color: HW.textMain, marginBottom: 2},
  fileMeta: {fontSize: 12, color: HW.textSub},

  footer: {position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, paddingTop: 12, backgroundColor: 'rgba(249,249,251,0.96)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HW.divider},
  startBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 16, backgroundColor: HW.blue},
  startBtnDisabled: {backgroundColor: HW.textTertiary},
  startBtnText: {color: '#fff', fontSize: 16, fontWeight: '700'},

  steps: {gap: 18, paddingVertical: 8},
  stepRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  stepLabel: {flex: 1, fontSize: 15, color: HW.textMain},
  connectingHint: {fontSize: 13, color: HW.textSub, marginTop: 16, lineHeight: 19},
  manualBox: {marginTop: 16, gap: 10},
  manualText: {fontSize: 13, color: HW.textBody, lineHeight: 20},
  manualBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 12, backgroundColor: HW.fill},
  manualBtnText: {fontSize: 15, color: HW.blue, fontWeight: '600'},

  primaryBtn: {height: 50, borderRadius: 14, backgroundColor: HW.blue, alignItems: 'center', justifyContent: 'center', marginTop: 8, paddingHorizontal: 32},
  primaryBtnText: {color: '#fff', fontSize: 16, fontWeight: '700'},
  cancelLink: {alignItems: 'center', paddingVertical: 14, marginTop: 4},
  cancelLinkText: {fontSize: 15, color: HW.textSub},

  overlay: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 28},
  overlayCard: {width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 24, padding: 28, alignItems: 'center'},
  overlayTitle: {fontSize: 18, fontWeight: '700', color: HW.textMain, marginBottom: 6},
  overlayCount: {fontSize: 14, color: HW.textSub, marginBottom: 8},
  overlayFile: {fontSize: 14, color: HW.textMain, fontWeight: '500'},
  overlayBytes: {fontSize: 12, color: HW.textSub, marginTop: 8},
  overlaySub: {fontSize: 14, color: HW.textBody, textAlign: 'center', lineHeight: 20},
  overlayNote: {fontSize: 12, color: HW.textSub, textAlign: 'center', marginTop: 8, lineHeight: 18},
  successOrb: {width: 72, height: 72, borderRadius: 36, backgroundColor: HW.green, alignItems: 'center', justifyContent: 'center', marginBottom: 16},
  errorOrb: {width: 72, height: 72, borderRadius: 36, backgroundColor: HW.red, alignItems: 'center', justifyContent: 'center', marginBottom: 16},
  cancelBtn: {marginTop: 16, paddingHorizontal: 28, paddingVertical: 10},
  cancelBtnText: {fontSize: 15, color: HW.textSub, fontWeight: '600'},
});
