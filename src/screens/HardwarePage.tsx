/**
 * 记忆粒(MR20) — 忠实还原 app-prototype「我的设备」整套交互（App.jsx:3186–4285）。
 *
 * 真机能力复用 useMr20（扫描/自动配对/电量/容量/录音状态/同步/收件箱上传转写/删除）；
 * 协议层无支持的 WiFi 热点 / OTA 做成忠实模拟子页。子页用内部状态机切换（非独立路由）。
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AlertCircle,
  AlertTriangle,
  Bluetooth,
  Bookmark,
  BatteryLow,
  Check,
  CheckCircle2,
  ChevronLeft,
  Cloud,
  Mic,
  MoreHorizontal,
  Pause,
  Play,
  Rocket,
  Trash2,
  Upload,
} from 'lucide-react-native';
import {colors, radius, shadow} from '../design/tokens';
import {GradientBg} from '../ui/Gradient';
import {BottomSheet} from '../ui/BottomSheet';
import {images} from '../design/assets';
import {useNav} from '../navigation/nav';
import {useMr20} from '../hooks/useMr20';
import {useMr20Playback} from '../hooks/useMr20Playback';
import type {Mr20InboxItem} from '../services/mr20Ingest';
import {IosAlert, HW, type HwSubPage} from './hardware/parts';
import {DeviceSettings} from './hardware/DeviceSettings';
import {WifiManage} from './hardware/WifiManage';
import {WifiTransfer} from './hardware/WifiTransfer';
import {TimeSync} from './hardware/TimeSync';
import {RecordMode} from './hardware/RecordMode';
import {OtaUpdate} from './hardware/OtaUpdate';
import {AboutDevice} from './hardware/AboutDevice';
import {HelpFeedback} from './hardware/HelpFeedback';

const ALIAS_KEY = '@ringmemory:mr20:alias';
const AUTODL_KEY = '@ringmemory:mr20:autodl';

function fmtDuration(total: number): string {
  const s = Math.max(0, Math.round(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtHuman(total: number): string {
  const s = Math.max(0, Math.round(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) {
    return `${h} 小时 ${m} 分`;
  }
  return `${m} 分钟`;
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return '今天';
  }
  if (d.toDateString() === new Date(now.getTime() - 86400000).toDateString()) {
    return '昨天';
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const STATUS_LABEL: Record<Mr20InboxItem['status'], string> = {
  synced: '待处理',
  uploaded: '已上传',
  queued: '处理中',
  done: '已归档',
  error: '失败',
};

export function HardwarePage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const mr = useMr20();
  const {
    connState,
    devices,
    connectedDevice,
    status,
    recording,
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
    deleteItems,
    refreshStatus,
    clearError,
    forgetDevice,
  } = mr;
  const playback = useMr20Playback();

  const [subPage, setSubPage] = useState<HwSubPage>('main');
  const [moreOpen, setMoreOpen] = useState(false);
  const [disconnectAsk, setDisconnectAsk] = useState(false);
  const [unbindAsk, setUnbindAsk] = useState(false);
  const [alias, setAlias] = useState('MR20 记忆粒');
  const [autoDownload, setAutoDownload] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const connected = connState === 'connected';
  const busy = connState === 'scanning' || connState === 'connecting' || connState === 'pairing';
  const autoTriedRef = useRef<string | null>(null);
  const autoDlRef = useRef(false);

  // 本地偏好：设备别名 + 自动下载开关。
  useEffect(() => {
    AsyncStorage.getItem(ALIAS_KEY).then(v => v && setAlias(v)).catch(() => undefined);
    AsyncStorage.getItem(AUTODL_KEY).then(v => setAutoDownload(v === '1')).catch(() => undefined);
  }, []);

  // 扫到信号最强的记忆粒就自动配对（原型「一键配对」）。
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

  // 离开页面停扫描。
  useEffect(() => () => stopScan(), [stopScan]);

  // 连上后拉一次状态 + 设备文件（串行，避免命令应答交错）。
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

  // 成功态闪现：连上后短暂显示绿勾再进 dashboard。
  useEffect(() => {
    if (connected) {
      setShowSuccess(true);
      const t = setTimeout(() => setShowSuccess(false), 1400);
      return () => clearTimeout(t);
    }
    setShowSuccess(false);
  }, [connected]);

  // 自动下载：开启且有待同步文件时，连上后自动同步一次。
  useEffect(() => {
    if (connected && autoDownload && !syncing && (deviceFiles?.pending ?? 0) > 0 && !autoDlRef.current) {
      autoDlRef.current = true;
      syncNow().catch(() => undefined);
    }
    if (!connected) {
      autoDlRef.current = false;
    }
  }, [connected, autoDownload, syncing, deviceFiles, syncNow]);

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

  const confirmDelete = useCallback(
    (item: Mr20InboxItem) => {
      Alert.alert('删除录音', '确定删除这条录音？本地文件会一并清除，不可恢复。', [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            if (item.id === playback.playingId) {
              await playback.stop().catch(() => undefined);
            }
            await deleteItems([item]);
          },
        },
      ]);
    },
    [deleteItems, playback],
  );

  const saveAlias = useCallback((name: string) => {
    setAlias(name);
    AsyncStorage.setItem(ALIAS_KEY, name).catch(() => undefined);
  }, []);

  const toggleAutoDownload = useCallback(() => {
    setAutoDownload(v => {
      const next = !v;
      AsyncStorage.setItem(AUTODL_KEY, next ? '1' : '0').catch(() => undefined);
      return next;
    });
  }, []);

  // 录音按天分组（今天/昨天/更早）。
  const groups = useMemo(() => {
    const map = new Map<string, Mr20InboxItem[]>();
    for (const it of inbox) {
      const label = dayLabel(it.createdAt);
      const arr = map.get(label) ?? [];
      arr.push(it);
      map.set(label, arr);
    }
    return Array.from(map.entries());
  }, [inbox]);

  const battery = status.battery;
  const lowBattery = battery != null && battery <= 20;
  const freeMb = status.spaceFreeMb;
  const totalMb = status.spaceTotalMb;
  const freeGb = freeMb != null ? Math.round(freeMb / 1024) : null;
  const usedRatio = freeMb != null && totalMb ? Math.max(0, Math.min(1, 1 - freeMb / totalMb)) : 0;
  const storageWarn = freeMb != null && totalMb ? freeMb / totalMb < 0.1 : false;
  const deviceName = alias || connectedDevice?.name || 'MR20 记忆粒';

  // ---- 子页路由（原型 activeSubPage 状态机） ----
  if (subPage === 'settings') {
    return <DeviceSettings onBack={() => setSubPage('main')} onNavigate={setSubPage} />;
  }
  if (subPage === 'wifi') {
    return <WifiManage onBack={() => setSubPage('settings')} />;
  }
  if (subPage === 'wifiTransfer') {
    return <WifiTransfer onBack={() => setSubPage('main')} />;
  }
  if (subPage === 'time') {
    return <TimeSync onBack={() => setSubPage('settings')} />;
  }
  if (subPage === 'recordMode') {
    return <RecordMode onBack={() => setSubPage('settings')} />;
  }
  if (subPage === 'ota') {
    return <OtaUpdate onBack={() => setSubPage('settings')} fwVersion={status.firmware || 'V1.0'} />;
  }
  if (subPage === 'about') {
    return (
      <AboutDevice
        onBack={() => setSubPage('settings')}
        deviceName={deviceName}
        onRename={saveAlias}
        onHelp={() => setSubPage('help')}
      />
    );
  }
  if (subPage === 'help') {
    return <HelpFeedback onBack={() => setSubPage('about')} />;
  }

  return (
    <View style={st.root}>
      {/* Header */}
      <View style={[st.header, {paddingTop: insets.top + 10}]}>
        <TouchableOpacity onPress={nav.pop} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}} style={st.headerBtn}>
          <ChevronLeft size={26} color={HW.textMain} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>我的设备</Text>
        <TouchableOpacity
          style={st.headerBtn}
          disabled={!connected}
          onPress={() => setMoreOpen(true)}>
          <MoreHorizontal size={24} color={HW.textMain} style={{opacity: connected ? 1 : 0.3}} />
        </TouchableOpacity>
      </View>

      {error ? (
        <TouchableOpacity style={st.errorBar} onPress={clearError} activeOpacity={0.8}>
          <AlertCircle size={16} color="#fff" />
          <Text style={st.errorText} numberOfLines={3}>{error}</Text>
        </TouchableOpacity>
      ) : null}

      {!connected ? (
        /* ---- 未配对 ---- */
        <ScrollView contentContainerStyle={st.unpairedBody} showsVerticalScrollIndicator={false}>
          <Image source={images.device} style={st.hero} resizeMode="contain" />
          <Text style={st.brand}>SEEMEMORY</Text>
          <View style={st.featGrid}>
            {[
              {icon: <Mic size={18} color={HW.textSub} />, t: '现场/通话双录'},
              {icon: <Cloud size={18} color={HW.textSub} />, t: '无限转写时长'},
              {icon: <BatteryLow size={18} color={HW.textSub} />, t: '35小时长续航'},
              {icon: <Bookmark size={18} color={HW.textSub} />, t: '一键Mark重点'},
            ].map(f => (
              <View key={f.t} style={st.featCard}>
                {f.icon}
                <Text style={st.featText}>{f.t}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={st.connectBtn} onPress={pair} disabled={busy}>
            <Text style={st.connectBtnText}>连接设备</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.buyBtn}>
            <Text style={st.buyBtnText}>前往购买</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        /* ---- 已配对 dashboard ---- */
        <ScrollView contentContainerStyle={st.pairedBody} showsVerticalScrollIndicator={false}>
          <View style={st.dashCard}>
            <GradientBg radius={radius.bigCard} from={colors.darkCard} to="#2C2C2E" />
            {/* Row1 设备 + 连接状态 */}
            <View style={st.dashRow1}>
              <View style={st.devIconWrap}>
                <Bluetooth size={20} color="#fff" />
              </View>
              <Text style={st.devName} numberOfLines={1}>{deviceName}</Text>
              <View style={st.connBadge}>
                <View style={st.connDot} />
                <Text style={st.connBadgeText}>蓝牙已连接</Text>
              </View>
            </View>

            {/* Row2 录音状态 */}
            {recording ? (
              <View style={st.recBanner}>
                <View style={st.recBannerDot} />
                <Text style={st.recBannerText}>正在录音 · 已录制 {fmtDuration(recording.seconds)}</Text>
              </View>
            ) : (
              <View style={st.idleBanner}>
                <View style={st.idleDot} />
                <Text style={st.idleText}>
                  当前待机{inbox.length ? ` · 本地 ${inbox.length} 段录音` : ''}
                </Text>
              </View>
            )}

            {/* Row3 电量/存储 */}
            <View style={st.statGrid}>
              <View style={[st.statCard, lowBattery && st.statCardWarn]}>
                <Text style={[st.statBig, lowBattery && {color: HW.red}]}>
                  {battery != null ? `${battery}%` : '—'}
                </Text>
                <Text style={[st.statSub, lowBattery && {color: HW.red}]}>
                  {lowBattery ? '电量不足，请充电' : '剩余电量'}
                </Text>
              </View>
              <View style={[st.statCard, storageWarn && st.statCardWarn]}>
                <Text style={[st.statBig, storageWarn && {color: HW.red}]}>
                  {freeGb != null ? (
                    <>
                      <Text style={st.statBigUnit}>剩余 </Text>
                      {freeGb}
                      <Text style={st.statBigUnit}>GB</Text>
                    </>
                  ) : (
                    '—'
                  )}
                </Text>
                {totalMb ? (
                  <View style={st.storageBar}>
                    <View style={[st.storageFill, {width: `${usedRatio * 100}%`, backgroundColor: storageWarn ? HW.red : HW.blue}]} />
                  </View>
                ) : null}
                <Text style={[st.statSub, storageWarn && {color: HW.red}]}>
                  {storageWarn ? '存储空间即将用完' : '可用存储'}
                </Text>
              </View>
            </View>
          </View>

          {/* WiFi 快传入口：大文件走热点高速直传，比蓝牙快 10× */}
          <TouchableOpacity
            style={st.wifiCta}
            activeOpacity={0.85}
            onPress={() => setSubPage('wifiTransfer')}>
            <View style={st.wifiCtaIcon}>
              <Rocket size={18} color={HW.blue} />
            </View>
            <View style={{flex: 1}}>
              <Text style={st.wifiCtaTitle}>WiFi 快传</Text>
              <Text style={st.wifiCtaSub}>
                {deviceFiles && deviceFiles.pending > 0
                  ? `${deviceFiles.pending} 个待传录音 · 热点直传更快`
                  : '长录音热点直传，比蓝牙快 10 倍'}
              </Text>
            </View>
            <ChevronLeft size={20} color={HW.textTertiary} style={{transform: [{rotate: '180deg'}]}} />
          </TouchableOpacity>

          {/* 录音列表 */}
          <View style={st.listHead}>
            <Text style={st.listTitle}>我的录音</Text>
            <TouchableOpacity
              style={[st.downloadAll, syncing && st.downloadAllSyncing]}
              onPress={() => (syncing ? stopSync() : syncNow())}>
              <Text style={[st.downloadAllText, syncing && st.downloadAllSyncingText]}>
                {syncing
                  ? syncProgress && syncProgress.total > 0
                    ? `暂停同步 ${syncProgress.completed}/${syncProgress.total}`
                    : '暂停同步'
                  : deviceFiles && deviceFiles.pending > 0
                  ? `全部下载 (${deviceFiles.pending})`
                  : '全部下载'}
              </Text>
            </TouchableOpacity>
          </View>

          {inbox.length === 0 ? (
            <Text style={st.empty}>暂无录音。点「全部下载」从记忆粒同步。</Text>
          ) : (
            groups.map(([label, items]) => (
              <View key={label} style={{marginBottom: 8}}>
                <Text style={st.groupLabel}>{label}</Text>
                <View style={{gap: 12}}>
                  {items.map(item => {
                    const isPlaying = playback.playingId === item.id;
                    const isProcessing = processingIds.includes(item.id);
                    const archived = item.status === 'done';
                    const uploadable = item.status === 'synced' || item.status === 'uploaded' || item.status === 'error';
                    return (
                      <View key={item.id} style={st.recCard}>
                        <TouchableOpacity style={st.recIcon} onPress={() => onPlay(item)}>
                          {isPlaying ? (
                            <Pause size={18} color={HW.blue} fill={HW.blue} />
                          ) : archived ? (
                            <CheckCircle2 size={20} color={HW.textSub} />
                          ) : (
                            <Cloud size={20} color={HW.blue} />
                          )}
                        </TouchableOpacity>
                        <View style={{flex: 1}}>
                          <Text style={st.recTitle} numberOfLines={1}>
                            {item.transcript?.trim() || `录音 ${clock(item.createdAt)}`}
                          </Text>
                          <Text style={st.recMeta}>时长 {fmtHuman(item.seconds)}</Text>
                        </View>
                        {isProcessing ? (
                          <ActivityIndicator size="small" color={HW.blue} />
                        ) : archived ? (
                          <View style={st.localTag}>
                            <Check size={15} color={HW.textSub} strokeWidth={3} />
                            <Text style={st.localTagText}>已归档</Text>
                          </View>
                        ) : (
                          <View style={st.recActions}>
                            {uploadable ? (
                              <TouchableOpacity style={st.recActionBtn} onPress={() => processInboxItem(item)}>
                                <Upload size={17} color={HW.blue} />
                              </TouchableOpacity>
                            ) : null}
                            <TouchableOpacity style={st.recActionBtn} onPress={() => confirmDelete(item)}>
                              <Trash2 size={17} color={HW.red} />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            ))
          )}

          {/* 自动下载开关 */}
          <View style={st.autoCard}>
            <View style={{flex: 1, paddingRight: 16}}>
              <Text style={st.autoTitle}>自动下载新录音</Text>
              <Text style={st.autoSub}>连接设备后自动下载新录音，建议开启 WiFi 时使用</Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={toggleAutoDownload}
              style={[st.toggle, {backgroundColor: autoDownload ? HW.green : '#E5E5EA'}]}>
              <View style={[st.knob, {left: autoDownload ? 22 : 2}]} />
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* 配对覆盖层：扫描 / 配置 / 成功 */}
      {(busy || showSuccess) && !error ? (
        <View style={st.overlay}>
          {showSuccess ? (
            <>
              <View style={st.successOrb}>
                <Check size={40} color="#fff" strokeWidth={3} />
              </View>
              <Text style={st.overlayTitle}>连接成功</Text>
            </>
          ) : connState === 'scanning' ? (
            <>
              <View style={st.scanOrb}>
                <Bluetooth size={48} color={HW.blue} />
              </View>
              <Text style={st.overlayTitle}>正在寻找附近的录音设备...</Text>
              <Text style={st.overlaySub}>请确保设备已开机，且靠近手机{'\n'}（建议 1 米内）</Text>
              <TouchableOpacity style={st.cancelBtn} onPress={cancelPairing}>
                <Text style={st.cancelText}>取消</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color={HW.textMain} style={{marginBottom: 24}} />
              <Text style={st.overlayTitle}>正在连接并配置设备...</Text>
              <Text style={st.overlaySub}>请勿关闭页面或远离设备</Text>
              <TouchableOpacity style={st.cancelBtn} onPress={cancelPairing}>
                <Text style={st.cancelText}>取消</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : null}

      {/* More 菜单 */}
      <BottomSheet visible={moreOpen} onClose={() => setMoreOpen(false)}>
        <View style={st.sheetCard}>
          <TouchableOpacity
            style={[st.sheetRow, st.sheetRowBorder]}
            onPress={() => {
              setMoreOpen(false);
              setSubPage('settings');
            }}>
            <Text style={st.sheetRowText}>设备设置</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={st.sheetRow}
            onPress={() => {
              setMoreOpen(false);
              setDisconnectAsk(true);
            }}>
            <Text style={st.sheetRowText}>断开连接</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[st.sheetCard, {marginTop: 12}]}
          onPress={() => {
            setMoreOpen(false);
            setUnbindAsk(true);
          }}>
          <View style={st.sheetRow}>
            <Text style={[st.sheetRowText, {color: HW.red}]}>解除设备绑定</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={[st.sheetCard, {marginTop: 12}]} onPress={() => setMoreOpen(false)}>
          <View style={st.sheetRow}>
            <Text style={[st.sheetRowText, {color: HW.blue, fontWeight: '600'}]}>取消</Text>
          </View>
        </TouchableOpacity>
      </BottomSheet>

      {/* 断开确认 */}
      <IosAlert
        visible={disconnectAsk}
        onClose={() => setDisconnectAsk(false)}
        title="确定断开设备连接吗？"
        message="断开后无法实时查看状态和下载录音，下次打开 APP 将自动重连。"
        buttons={[
          {text: '取消', onPress: () => setDisconnectAsk(false)},
          {
            text: '断开',
            bold: true,
            onPress: () => {
              setDisconnectAsk(false);
              disconnect().catch(() => undefined);
            },
          },
        ]}
      />

      {/* 解除绑定确认（高危） */}
      <IosAlert
        visible={unbindAsk}
        onClose={() => setUnbindAsk(false)}
        title="确定解除与该设备的绑定？"
        titleColor={HW.red}
        icon={<AlertTriangle size={32} color={HW.red} />}
        message="解除后将清空配对关系，无法自动连接，需重新配对才能使用。已下载到手机的录音文件不会被删除。"
        buttons={[
          {text: '取消', onPress: () => setUnbindAsk(false)},
          {
            text: '解除绑定',
            danger: true,
            onPress: () => {
              setUnbindAsk(false);
              forgetDevice().catch(() => undefined);
            },
          },
        ]}
      />
    </View>
  );
}

const st = StyleSheet.create({
  root: {flex: 1, backgroundColor: HW.pageBg},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: 'rgba(249,249,251,0.95)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HW.divider,
  },
  headerBtn: {width: 40, height: 36, alignItems: 'center', justifyContent: 'center'},
  headerTitle: {flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: HW.textMain},
  errorBar: {flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: HW.red, paddingHorizontal: 16, paddingVertical: 10},
  errorText: {flex: 1, color: '#fff', fontSize: 13, lineHeight: 18},

  // 未配对
  unpairedBody: {padding: 20, alignItems: 'center'},
  hero: {width: '85%', height: 240, marginTop: 8, marginBottom: 8},
  brand: {fontSize: 34, fontWeight: '800', color: HW.textMain, letterSpacing: -0.5, marginTop: 8, marginBottom: 32},
  featGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 12, maxWidth: 360, marginBottom: 32},
  featCard: {width: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: HW.fill, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 14},
  featText: {fontSize: 14, fontWeight: '600', color: '#3A3A3C'},
  connectBtn: {width: '100%', height: 56, backgroundColor: colors.darkCard, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 12},
  connectBtnText: {color: '#fff', fontSize: 16, fontWeight: '700'},
  buyBtn: {width: '100%', height: 56, backgroundColor: HW.fill, borderRadius: 16, alignItems: 'center', justifyContent: 'center'},
  buyBtnText: {color: HW.textMain, fontSize: 16, fontWeight: '700'},

  // 已配对
  pairedBody: {padding: 20},
  dashCard: {borderRadius: radius.bigCard, padding: 20, marginBottom: 24, overflow: 'hidden', backgroundColor: colors.darkCard, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)'},
  dashRow1: {flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16},
  devIconWrap: {width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center'},
  devName: {flex: 1, fontSize: 16, fontWeight: '600', color: '#fff'},
  connBadge: {flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: 'rgba(52,199,89,0.1)'},
  connDot: {width: 6, height: 6, borderRadius: 3, backgroundColor: HW.green},
  connBadgeText: {fontSize: 12, color: HW.green, fontWeight: '500'},
  recBanner: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(52,199,89,0.15)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(52,199,89,0.3)', borderRadius: 16, padding: 16, marginBottom: 16},
  recBannerDot: {width: 10, height: 10, borderRadius: 5, backgroundColor: HW.red},
  recBannerText: {fontSize: 15, color: HW.green, fontWeight: '600'},
  idleBanner: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16, marginBottom: 16},
  idleDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: HW.textSub},
  idleText: {fontSize: 14, color: '#D1D1D6', fontWeight: '500'},
  statGrid: {flexDirection: 'row', gap: 12},
  statCard: {flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16},
  statCardWarn: {backgroundColor: 'rgba(255,59,48,0.15)'},
  statBig: {fontSize: 28, fontWeight: '700', color: '#fff', lineHeight: 32, marginBottom: 8},
  statBigUnit: {fontSize: 13, color: '#8E8E93', fontWeight: '400'},
  statSub: {fontSize: 12, color: HW.textSub, fontWeight: '500'},
  storageBar: {height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)', marginBottom: 6, overflow: 'hidden'},
  storageFill: {height: '100%', borderRadius: 2},

  wifiCta: {flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: HW.card, borderRadius: 20, padding: 16, marginBottom: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: HW.cardBorder, ...shadow.soft},
  wifiCtaIcon: {width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0F8FF', alignItems: 'center', justifyContent: 'center'},
  wifiCtaTitle: {fontSize: 16, fontWeight: '700', color: HW.textMain, marginBottom: 2},
  wifiCtaSub: {fontSize: 12, color: HW.textSub},
  listHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16},
  listTitle: {fontSize: 19, fontWeight: '700', color: HW.textMain, letterSpacing: -0.4},
  downloadAll: {backgroundColor: 'rgba(10,132,255,0.08)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16},
  downloadAllText: {fontSize: 14, color: HW.blue, fontWeight: '600'},
  downloadAllSyncing: {backgroundColor: 'rgba(255,59,48,0.1)'},
  downloadAllSyncingText: {color: HW.red},
  empty: {fontSize: 14, color: HW.textSub, textAlign: 'center', paddingVertical: 32},
  groupLabel: {fontSize: 15, fontWeight: '700', color: HW.textMain, marginBottom: 12, paddingHorizontal: 4},
  recCard: {flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: HW.card, borderRadius: 20, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HW.cardBorder, ...shadow.soft},
  recIcon: {width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0F8FF', alignItems: 'center', justifyContent: 'center'},
  recTitle: {fontSize: 16, fontWeight: '600', color: HW.textMain, marginBottom: 2, letterSpacing: -0.2},
  recMeta: {fontSize: 13, color: HW.textSub, fontWeight: '500'},
  recActions: {flexDirection: 'row', alignItems: 'center', gap: 4},
  recActionBtn: {width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: HW.fill},
  localTag: {flexDirection: 'row', alignItems: 'center', gap: 4},
  localTagText: {fontSize: 13, fontWeight: '700', color: HW.textSub},
  autoCard: {flexDirection: 'row', alignItems: 'center', backgroundColor: HW.pageBg, borderRadius: 20, padding: 16, marginTop: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HW.cardBorder},
  autoTitle: {fontSize: 14, fontWeight: '700', color: HW.textMain, marginBottom: 4},
  autoSub: {fontSize: 12, color: HW.textSub, lineHeight: 17},
  toggle: {width: 44, height: 24, borderRadius: 12, justifyContent: 'center'},
  knob: {position: 'absolute', width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.12, shadowRadius: 2, elevation: 2},

  // 覆盖层
  overlay: {...StyleSheet.absoluteFillObject, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 40},
  scanOrb: {width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(10,132,255,0.05)', alignItems: 'center', justifyContent: 'center', marginBottom: 40},
  successOrb: {width: 80, height: 80, borderRadius: 40, backgroundColor: HW.green, alignItems: 'center', justifyContent: 'center', marginBottom: 32},
  overlayTitle: {fontSize: 18, fontWeight: '600', color: HW.textMain, marginBottom: 12, textAlign: 'center'},
  overlaySub: {fontSize: 14, color: HW.textSub, textAlign: 'center', lineHeight: 21},
  cancelBtn: {marginTop: 28, paddingHorizontal: 32, paddingVertical: 12, borderRadius: radius.pill, backgroundColor: HW.fill},
  cancelText: {color: HW.textMain, fontSize: 15, fontWeight: '600'},

  // More 菜单
  sheetCard: {backgroundColor: HW.card, borderRadius: 16, overflow: 'hidden'},
  sheetRow: {paddingVertical: 16, alignItems: 'center', justifyContent: 'center'},
  sheetRowBorder: {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HW.divider},
  sheetRowText: {fontSize: 17, color: HW.textMain},
});
