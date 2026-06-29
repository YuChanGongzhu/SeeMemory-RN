import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {View, Text, Image, ScrollView, TouchableOpacity, ActivityIndicator, Alert, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronLeft, Bluetooth, BatteryLow, Cloud, Play, Pause, RefreshCw, AlertCircle, Upload, Trash2, CheckSquare, Square} from 'lucide-react-native';
import {colors, radius, shadow} from '../design/tokens';
import {GradientBg} from '../ui/Gradient';
import {images} from '../design/assets';
import {useNav} from '../navigation/nav';
import {useMr20} from '../hooks/useMr20';
import {useMr20Playback} from '../hooks/useMr20Playback';
import type {Mr20InboxItem} from '../services/mr20Ingest';

function fmtDuration(total: number): string {
  const s = Math.max(0, Math.round(total));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function fmtBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(0)} KB`;
  }
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) {
    return hm;
  }
  const yesterday = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) {
    return `昨天 ${hm}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

const STATUS_LABEL: Record<Mr20InboxItem['status'], string> = {
  synced: '待处理',
  uploaded: '已上传',
  queued: '处理中',
  done: '已归档',
  error: '失败',
};

/** 记忆粒(MR20) — 真机 BLE 连接 / 同步 / 入库，接 useMr20。 */
export function HardwarePage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const {
    connState,
    devices,
    connectedDevice,
    status,
    syncing,
    syncProgress,
    deviceFiles,
    inbox,
    processingIds,
    error,
    startScan,
    stopScan,
    connectAndPair,
    disconnect,
    syncNow,
    stopSync,
    refreshDeviceFiles,
    processInboxItem,
    processItems,
    deleteItems,
    refreshStatus,
    clearError,
  } = useMr20();
  const playback = useMr20Playback();

  // 多选模式 + 已选中的条目 id。
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const connected = connState === 'connected';
  const busy = connState === 'scanning' || connState === 'connecting' || connState === 'pairing';
  // 自动连接：扫到第一台（信号最强）记忆粒就直接配对，符合原型「一键配对」交互。
  const autoTriedRef = useRef<string | null>(null);

  useEffect(() => {
    if (connState !== 'scanning' || !devices.length) {
      return;
    }
    const best = [...devices].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999))[0];
    if (best && autoTriedRef.current !== best.id) {
      autoTriedRef.current = best.id;
      connectAndPair(best.id, best.name).catch(() => undefined);
    }
  }, [connState, devices, connectAndPair]);

  // 离开页面时停掉扫描，避免后台空转。
  useEffect(() => () => stopScan(), [stopScan]);

  // 连上后主动拉一次设备状态（电量/容量/固件）+ 扫描设备文件数。协议 GJJY_BLE&BAT/
  // &SPACE/&LIST_DIRS 设备都不主动上报，必须 App 发指令查询。串行执行（先状态后文件），
  // 避免两类命令的应答交错。
  useEffect(() => {
    if (!connected) {
      return;
    }
    let alive = true;
    (async () => {
      await refreshStatus().catch(() => undefined);
      if (alive) {
        await refreshDeviceFiles().catch(() => undefined);
      }
    })();
    return () => {
      alive = false;
    };
  }, [connected, refreshStatus, refreshDeviceFiles]);

  const pair = useCallback(() => {
    autoTriedRef.current = null;
    clearError();
    startScan().catch(() => undefined);
  }, [startScan, clearError]);

  const cancelPairing = useCallback(() => {
    stopScan();
    autoTriedRef.current = null;
    disconnect().catch(() => undefined);
  }, [stopScan, disconnect]);

  const onPlay = useCallback(
    (item: Mr20InboxItem) => {
      playback.toggle(item.id, item.localPath).catch(e =>
        Alert.alert('播放失败', String((e as Error)?.message || e)),
      );
    },
    [playback],
  );

  const canUpload = useCallback(
    (item: Mr20InboxItem) =>
      item.status === 'synced' || item.status === 'uploaded' || item.status === 'error',
    [],
  );

  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectedItems = useMemo(
    () => inbox.filter(i => selected.has(i.id)),
    [inbox, selected],
  );
  const allSelected = inbox.length > 0 && selected.size === inbox.length;

  // 删除（单条/多选都走这里）：删前若正在播放被删项，先停掉。二次确认防误删。
  const confirmDelete = useCallback(
    (items: Mr20InboxItem[]) => {
      if (!items.length) {
        return;
      }
      Alert.alert(
        '删除录音',
        `确定删除选中的 ${items.length} 条录音？本地文件会一并清除，不可恢复。`,
        [
          {text: '取消', style: 'cancel'},
          {
            text: '删除',
            style: 'destructive',
            onPress: async () => {
              if (items.some(i => i.id === playback.playingId)) {
                await playback.stop().catch(() => undefined);
              }
              await deleteItems(items);
              exitSelect();
            },
          },
        ],
      );
    },
    [deleteItems, playback, exitSelect],
  );

  const uploadSelected = useCallback(async () => {
    const targets = selectedItems.filter(canUpload);
    if (!targets.length) {
      Alert.alert('无可上传项', '选中的录音都已入库或正在处理中。');
      return;
    }
    await processItems(targets);
    exitSelect();
  }, [selectedItems, canUpload, processItems, exitSelect]);

  const battery = status.battery;
  const cur = syncProgress?.current;
  const curPct = cur && cur.size > 0 ? Math.min(100, Math.round((cur.received / cur.size) * 100)) : 0;

  return (
    <View style={styles.root}>
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <TouchableOpacity onPress={nav.pop} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <ChevronLeft size={26} strokeWidth={2} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>记忆粒</Text>
        {connected ? (
          <TouchableOpacity onPress={() => disconnect()} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Text style={styles.disconnect}>断开</Text>
          </TouchableOpacity>
        ) : (
          <View style={{width: 26}} />
        )}
      </View>

      {error ? (
        <TouchableOpacity style={styles.errorBar} onPress={clearError} activeOpacity={0.8}>
          <AlertCircle size={16} color="#fff" />
          <Text style={styles.errorText} numberOfLines={3}>{error}</Text>
        </TouchableOpacity>
      ) : null}

      {!connected ? (
        <View style={{flex: 1}}>
          <ScrollView contentContainerStyle={styles.unpairedBody} showsVerticalScrollIndicator={false}>
            <Image source={images.device} style={styles.product} resizeMode="cover" />
            <Text style={styles.heroTitle}>无感记录{'\n'}留住每一个高光时刻</Text>
            <Text style={styles.heroDesc}>佩戴记忆粒，AI 自动在后台捕捉你的灵感与重要对话。</Text>
          </ScrollView>
          <View style={[styles.bottomBar, {paddingBottom: insets.bottom + 24}]}>
            <TouchableOpacity style={styles.buyBtn}>
              <Text style={styles.buyBtnText}>前往淘宝购买</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pairBtn} onPress={pair} disabled={busy}>
              <Text style={styles.pairBtnText}>我已有设备，立即配对</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
        <ScrollView contentContainerStyle={styles.pairedBody} showsVerticalScrollIndicator={false}>
          <View style={styles.statusCard}>
            <GradientBg radius={radius.bigCard} />
            <View style={styles.statusHead}>
              <View style={styles.btIcon}><Bluetooth size={24} color={colors.focus} /></View>
              <View>
                <Text style={styles.devName}>{connectedDevice?.name || '记忆粒 imemory'}</Text>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
                  <View style={styles.greenDot} />
                  <Text style={styles.connected}>已连接</Text>
                </View>
              </View>
            </View>
            <View style={{flexDirection: 'row', gap: 16}}>
              <View style={styles.statBox}>
                <BatteryLow size={18} color={colors.textSub} />
                <Text style={styles.statNum}>{battery != null ? `${battery}%` : '—'}</Text>
                <Text style={styles.statLabel}>剩余电量</Text>
              </View>
              <TouchableOpacity
                style={styles.statBox}
                activeOpacity={0.7}
                onPress={() => refreshDeviceFiles()}>
                <Cloud size={18} color={colors.textSub} />
                <Text style={styles.statNum}>
                  {deviceFiles ? `${deviceFiles.total} 个` : '—'}
                </Text>
                <Text style={styles.statLabel}>
                  {deviceFiles
                    ? `待同步 ${deviceFiles.pending} · ${fmtBytes(deviceFiles.bytes)}`
                    : '设备文件 · 点按刷新'}
                </Text>
              </TouchableOpacity>
            </View>
            {syncing ? (
              <View style={styles.syncProgress}>
                <View style={styles.syncProgressHead}>
                  <Text style={styles.syncProgressTitle}>正在同步录音…</Text>
                  <Text style={styles.syncProgressCount}>
                    {syncProgress ? `${syncProgress.completed}/${syncProgress.total}` : ''}
                  </Text>
                </View>
                {cur ? (
                  <>
                    <Text style={styles.syncFile} numberOfLines={1}>{cur.dir}/{cur.fname}</Text>
                    <View style={styles.syncBar}>
                      <View style={[styles.syncFill, {width: `${curPct}%`}]} />
                    </View>
                    <Text style={styles.syncBytes}>
                      {fmtBytes(cur.received)}{cur.size > 0 ? ` / ${fmtBytes(cur.size)}` : ''}
                    </Text>
                  </>
                ) : null}
                <TouchableOpacity style={styles.stopBtn} onPress={stopSync}>
                  <Text style={styles.stopBtnText}>停止同步</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.syncBtn} onPress={() => syncNow()}>
                <RefreshCw size={16} color="#fff" />
                <Text style={styles.syncBtnText}>
                  {deviceFiles && deviceFiles.pending > 0
                    ? `同步设备录音（待同步 ${deviceFiles.pending}）`
                    : '立即同步设备录音'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>设备录音记录</Text>
            {inbox.length ? (
              selectMode ? (
                <View style={{flexDirection: 'row', gap: 16}}>
                  <TouchableOpacity
                    onPress={() =>
                      setSelected(allSelected ? new Set() : new Set(inbox.map(i => i.id)))
                    }>
                    <Text style={styles.headerAction}>{allSelected ? '取消全选' : '全选'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={exitSelect}>
                    <Text style={styles.headerAction}>完成</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity onPress={() => setSelectMode(true)}>
                  <Text style={styles.headerAction}>多选</Text>
                </TouchableOpacity>
              )
            ) : null}
          </View>

          {inbox.length === 0 ? (
            <Text style={styles.empty}>暂无录音。点上方「立即同步」从记忆粒拉取。</Text>
          ) : (
            <View style={{gap: 12, paddingBottom: selectMode ? 96 : 0}}>
              {inbox.map(item => {
                const isPlaying = playback.playingId === item.id;
                const isProcessing = processingIds.includes(item.id);
                const uploadable = canUpload(item);
                const isSel = selected.has(item.id);
                return (
                  <TouchableOpacity
                    key={item.id}
                    activeOpacity={selectMode ? 0.7 : 1}
                    onPress={selectMode ? () => toggleSelect(item.id) : undefined}
                    style={[styles.recCard, selectMode && isSel && styles.recCardSel]}>
                    {selectMode ? (
                      <View style={styles.recPlay}>
                        {isSel ? (
                          <CheckSquare size={22} color={colors.focus} />
                        ) : (
                          <Square size={22} color={colors.textSub} />
                        )}
                      </View>
                    ) : (
                      <TouchableOpacity style={styles.recPlay} onPress={() => onPlay(item)}>
                        {isPlaying ? (
                          <Pause size={18} fill={colors.textMain} color={colors.textMain} />
                        ) : (
                          <Play size={18} fill={colors.textMain} color={colors.textMain} style={{marginLeft: 3}} />
                        )}
                      </TouchableOpacity>
                    )}

                    <View style={{flex: 1}}>
                      <Text style={styles.recTitle} numberOfLines={1}>
                        {item.transcript?.trim() || item.fname}
                      </Text>
                      <Text style={styles.recMeta}>
                        {fmtTime(item.createdAt)} · {fmtDuration(item.seconds)} ·{' '}
                        {isProcessing ? (
                          <Text style={{color: colors.focus}}>入库中…</Text>
                        ) : (
                          <Text style={{color: item.status === 'done' ? colors.focus : colors.textSub}}>
                            {STATUS_LABEL[item.status]}
                          </Text>
                        )}
                      </Text>
                    </View>

                    {!selectMode ? (
                      <View style={styles.recActions}>
                        {uploadable ? (
                          <TouchableOpacity
                            style={styles.recBtn}
                            disabled={isProcessing}
                            onPress={() => processInboxItem(item)}>
                            {isProcessing ? (
                              <ActivityIndicator size="small" color={colors.focus} />
                            ) : (
                              <Upload size={18} color={colors.focus} />
                            )}
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity style={styles.recBtn} onPress={() => confirmDelete([item])}>
                          <Trash2 size={18} color="#C0392B" />
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>
        {selectMode && selected.size > 0 ? (
          <View style={[styles.actionBar, {paddingBottom: insets.bottom + 12}]}>
            <TouchableOpacity style={styles.actionUpload} onPress={uploadSelected}>
              <Upload size={18} color="#fff" />
              <Text style={styles.actionUploadText}>上传入库（{selected.size}）</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionDelete} onPress={() => confirmDelete(selectedItems)}>
              <Trash2 size={18} color="#fff" />
              <Text style={styles.actionDeleteText}>删除（{selected.size}）</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        </>
      )}

      {busy ? (
        <View style={styles.connOverlay}>
          <View style={styles.connOrb}>
            <Bluetooth size={32} color="#fff" />
          </View>
          <ActivityIndicator color={colors.textMain} style={{marginBottom: 16}} />
          <Text style={styles.connTitle}>
            {connState === 'scanning' ? '正在寻找附近的记忆粒...' : '正在连接...'}
          </Text>
          <Text style={styles.connSub}>请确保设备已开机并靠近手机</Text>
          <TouchableOpacity style={styles.cancelBtn} onPress={cancelPairing}>
            <Text style={styles.cancelText}>取消</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.dark},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)'},
  headerTitle: {fontSize: 18, fontWeight: '700', color: '#fff'},
  disconnect: {fontSize: 14, color: 'rgba(255,255,255,0.7)', fontWeight: '600'},
  errorBar: {flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#C0392B', paddingHorizontal: 16, paddingVertical: 10},
  errorText: {flex: 1, color: '#fff', fontSize: 13, lineHeight: 18},
  unpairedBody: {padding: 20, paddingBottom: 200, backgroundColor: colors.bgApp, minHeight: '100%'},
  product: {width: '100%', height: 260, borderRadius: radius.bigCard, marginBottom: 32},
  heroTitle: {fontSize: 24, fontWeight: '700', color: colors.textMain, textAlign: 'center', lineHeight: 32, marginBottom: 12},
  heroDesc: {fontSize: 15, color: colors.textSub, textAlign: 'center', lineHeight: 24, paddingHorizontal: 12},
  bottomBar: {position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 24, gap: 12, backgroundColor: 'rgba(0,0,0,0.85)'},
  buyBtn: {height: 54, backgroundColor: '#fff', borderRadius: 27, alignItems: 'center', justifyContent: 'center', ...shadow.fab},
  buyBtnText: {color: '#000', fontSize: 16, fontWeight: '700'},
  pairBtn: {height: 54, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 27, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)'},
  pairBtnText: {color: '#fff', fontSize: 16, fontWeight: '600'},
  pairedBody: {padding: 20, backgroundColor: colors.bgApp, minHeight: '100%'},
  statusCard: {borderRadius: radius.bigCard, padding: 24, marginBottom: 32, overflow: 'hidden', backgroundColor: colors.darkCard, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)'},
  statusHead: {flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24},
  btIcon: {width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center'},
  devName: {fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 4},
  greenDot: {width: 6, height: 6, borderRadius: 3, backgroundColor: colors.focus},
  connected: {fontSize: 13, color: colors.focus, fontWeight: '500'},
  statBox: {flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16, gap: 4},
  statNum: {fontSize: 20, fontWeight: '700', color: '#fff'},
  statLabel: {fontSize: 12, color: colors.textSub},
  syncBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, height: 48, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)'},
  syncBtnText: {color: '#fff', fontSize: 15, fontWeight: '600'},
  syncProgress: {marginTop: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16, padding: 16},
  syncProgressHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8},
  syncProgressTitle: {color: '#fff', fontSize: 14, fontWeight: '700'},
  syncProgressCount: {color: colors.focus, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums']},
  syncFile: {color: colors.textSub, fontSize: 12, marginBottom: 6},
  syncBar: {height: 6, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden'},
  syncFill: {height: '100%', borderRadius: 4, backgroundColor: colors.focus},
  syncBytes: {color: colors.textSub, fontSize: 11, marginTop: 5, fontVariant: ['tabular-nums']},
  stopBtn: {marginTop: 14, height: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(192,57,43,0.9)'},
  stopBtnText: {color: '#fff', fontSize: 14, fontWeight: '700'},
  sectionRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16},
  sectionTitle: {fontSize: 16, fontWeight: '700', color: colors.textMain},
  headerAction: {fontSize: 14, color: colors.focus, fontWeight: '600'},
  empty: {fontSize: 14, color: colors.textSub, textAlign: 'center', paddingVertical: 32},
  recCard: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg, borderRadius: radius.pill, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.03)'},
  recCardSel: {borderColor: colors.focus, borderWidth: 1, backgroundColor: 'rgba(52,199,89,0.06)'},
  recPlay: {width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center'},
  recTitle: {fontSize: 16, fontWeight: '600', color: colors.textMain, marginBottom: 4},
  recMeta: {fontSize: 13, color: colors.textSub},
  recActions: {flexDirection: 'row', alignItems: 'center', gap: 4},
  recBtn: {width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgSecondary},
  actionBar: {position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.9)'},
  actionUpload: {flex: 1, flexDirection: 'row', gap: 8, height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.focus},
  actionUploadText: {color: '#fff', fontSize: 15, fontWeight: '700'},
  actionDelete: {flex: 1, flexDirection: 'row', gap: 8, height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: '#C0392B'},
  actionDeleteText: {color: '#fff', fontSize: 15, fontWeight: '700'},
  connOverlay: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center'},
  connOrb: {width: 72, height: 72, borderRadius: 36, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center', marginBottom: 24},
  connTitle: {fontSize: 18, fontWeight: '700', color: colors.textMain, marginBottom: 8},
  connSub: {fontSize: 14, color: colors.textSub},
  cancelBtn: {marginTop: 28, paddingHorizontal: 32, paddingVertical: 12, borderRadius: radius.pill, backgroundColor: colors.dark},
  cancelText: {color: '#fff', fontSize: 15, fontWeight: '600'},
});
