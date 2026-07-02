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
  ChevronLeft,
  ChevronRight,
  Cloud,
  Mic,
  MoreHorizontal,
  Pause,
  Play,
  Trash2,
} from 'lucide-react-native';
import {colors, radius, shadow} from '../design/tokens';
import {GradientBg} from '../ui/Gradient';
import {BottomSheet} from '../ui/BottomSheet';
import {images} from '../design/assets';
import {useNav} from '../navigation/nav';
import {useMr20} from '../hooks/useMr20';
import {useMr20Playback} from '../hooks/useMr20Playback';
import {itemEpoch, type Mr20InboxItem} from '../services/mr20Ingest';
import {fmtDurationHuman as fmtHuman, fmtSize as fmtMB} from '../services/mediaFormat';
import {IosAlert, SubHeader, HW, type HwSubPage} from './hardware/parts';
import {DeviceSettings} from './hardware/DeviceSettings';
import {WifiManage} from './hardware/WifiManage';
import {DeviceFiles} from './hardware/DeviceFiles';
import {TransferBadge} from './hardware/TransferBadge';
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

// 分组 key：本地日期 YYYY-MM-DD。避免跨年同月日（如 2025-06-30 与
// 2026-06-30）撞进同一组，也用于组间倒序排序。
function dayKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// 折叠日期行的标题：对齐原型「2026年6月29日」。
function dayFull(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 录音时刻精确到秒（同一分钟内常有多条，用它区分并对应设备文件名）。
function clockSec(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 尚可上传到云端的条目（未入库、未在批处理中）。
function isUploadable(it: Mr20InboxItem): boolean {
  return it.status === 'synced' || it.status === 'uploaded' || it.status === 'error';
}

// RSSI(dBm) → 信号格数 0~3：≥-60 强(3)、≥-75 中(2)、其余弱(1)、无值(0)。
function rssiLevel(rssi: number | null): number {
  if (rssi == null) {
    return 0;
  }
  if (rssi >= -60) {
    return 3;
  }
  if (rssi >= -75) {
    return 2;
  }
  return 1;
}

export function HardwarePage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const {
    connState,
    devices,
    connectedDevice,
    status,
    recording,
    syncing,
    wifiPhase,
    deviceFiles,
    inbox,
    processingIds,
    error,
    startScan,
    stopScan,
    connectAndPair,
    disconnect,
    syncNow,
    refreshDeviceFiles,
    processItems,
    deleteItems,
    refreshStatus,
    clearError,
    forgetDevice,
  } = useMr20();
  const playback = useMr20Playback();

  const [subPage, setSubPage] = useState<HwSubPage>('main');
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null); // 展开查看某天录音
  const [uploadSel, setUploadSel] = useState<Set<string>>(new Set()); // 当天录音的批量上传勾选
  const [moreOpen, setMoreOpen] = useState(false);
  const [disconnectAsk, setDisconnectAsk] = useState(false);
  const [unbindAsk, setUnbindAsk] = useState(false);
  const [alias, setAlias] = useState('');
  const [autoDownload, setAutoDownload] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [pendingName, setPendingName] = useState(''); // 正在连接的设备名（覆盖层展示）

  const connected = connState === 'connected';
  const busy = connState === 'scanning' || connState === 'connecting' || connState === 'pairing';
  const autoDlRef = useRef(false);
  // 门控「传输完成自动返回主页」：记录上一拍的传输态，只在真正发生过传输后
  // 触发一次返回，避免初始 false / 误触发。
  const bleWasSyncingRef = useRef(false);
  const wifiWasActiveRef = useRef(false);

  // 本地偏好：设备别名 + 自动下载开关。
  useEffect(() => {
    AsyncStorage.getItem(ALIAS_KEY).then(v => v && setAlias(v)).catch(() => undefined);
    AsyncStorage.getItem(AUTODL_KEY).then(v => setAutoDownload(v === '1')).catch(() => undefined);
  }, []);

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

  // 蓝牙同步完成（syncing true→false）后，若还停在设备文件页且无错误，自动回主页。
  useEffect(() => {
    const was = bleWasSyncingRef.current;
    bleWasSyncingRef.current = syncing;
    if (was && !syncing && !error && subPage === 'deviceFiles') {
      setSubPage('main');
    }
  }, [syncing, error, subPage]);

  // WiFi 快传完成（wifiPhase→'done'）后，若发起自设备文件页则自动回主页；
  // 'manual'/'error'/'idle' 不返回（保留手动引导或错误在原页可见）。
  useEffect(() => {
    if (wifiPhase === 'connecting' || wifiPhase === 'transferring' || wifiPhase === 'manual') {
      wifiWasActiveRef.current = true;
      return;
    }
    if (wifiPhase === 'done' && wifiWasActiveRef.current) {
      wifiWasActiveRef.current = false;
      if (subPage === 'deviceFiles') {
        setSubPage('main');
      }
    }
    if (wifiPhase === 'idle' || wifiPhase === 'error') {
      wifiWasActiveRef.current = false;
    }
  }, [wifiPhase, subPage]);

  const pair = useCallback(() => {
    setPendingName('');
    clearError();
    startScan().catch(() => undefined);
  }, [startScan, clearError]);

  const cancelPairing = useCallback(() => {
    stopScan();
    setPendingName('');
    disconnect().catch(() => undefined);
  }, [stopScan, disconnect]);

  // 用户从扫描列表点选某台设备 → 连接并配对（多台时不再自动连最强）。
  const chooseDevice = useCallback(
    (dev: {id: string; name: string}) => {
      setPendingName(dev.name);
      connectAndPair(dev.id, dev.name).catch(() => undefined);
    },
    [connectAndPair],
  );

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

  const toggleUploadSel = useCallback((id: string) => {
    setUploadSel(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAutoDownload = useCallback(() => {
    setAutoDownload(v => {
      const next = !v;
      AsyncStorage.setItem(AUTODL_KEY, next ? '1' : '0').catch(() => undefined);
      return next;
    });
  }, []);

  // 录音按天分组（今天/昨天/更早）：按 dayKey 分组避免跨年撞组，
  // 组间按日期倒序（新的在前）、组内按录音时刻倒序，标题用 dayLabel 展示。
  const groups = useMemo(() => {
    const map = new Map<string, Mr20InboxItem[]>();
    for (const it of inbox) {
      const key = dayKey(itemEpoch(it));
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, items]) => ({
        key,
        items: [...items].sort((a, b) => itemEpoch(b) - itemEpoch(a)),
      }));
  }, [inbox]);

  const battery = status.battery;
  const lowBattery = battery != null && battery <= 20;
  const freeMb = status.spaceFreeMb;
  const totalMb = status.spaceTotalMb;
  // 剩余空间按 GB + MB 展示。
  const freeMbWhole = freeMb != null ? Math.max(0, Math.round(freeMb)) : null;
  const freeGb = freeMbWhole != null ? Math.floor(freeMbWhole / 1024) : null;
  const freeMbRem = freeMbWhole != null ? freeMbWhole % 1024 : null;
  const usedRatio = freeMb != null && totalMb ? Math.max(0, Math.min(1, 1 - freeMb / totalMb)) : 0;
  const storageWarn = freeMb != null && totalMb ? freeMb / totalMb < 0.1 : false;
  const deviceName = alias || connectedDevice?.name || 'MR20 记忆粒';

  // 单条录音卡片（主页折叠→当天子页、以及后续复用）。
  const renderRecCard = (item: Mr20InboxItem) => {
    const isPlaying = playback.playingId === item.id;
    const isProcessing = processingIds.includes(item.id);
    const archived = item.status === 'done';
    const uploadable = isUploadable(item);
    const selected = uploadSel.has(item.id);
    return (
      <View key={item.id} style={st.recCard}>
        <TouchableOpacity style={st.recIcon} onPress={() => onPlay(item)}>
          {isPlaying ? (
            <Pause size={18} color={HW.blue} fill={HW.blue} />
          ) : (
            <Play size={18} color={HW.blue} fill={HW.blue} />
          )}
        </TouchableOpacity>
        <View style={st.flex1}>
          <Text style={st.recTitle} numberOfLines={1}>
            {item.transcript?.trim() || `录音 ${clock(itemEpoch(item))}`}
          </Text>
          <Text style={st.recMeta}>
            {clockSec(itemEpoch(item))} · 时长 {fmtHuman(item.seconds)}
            {item.sizeBytes ? ` · ${fmtMB(item.sizeBytes)}` : ''}
          </Text>
        </View>
        {isProcessing ? (
          <ActivityIndicator size="small" color={HW.blue} />
        ) : (
          <View style={st.recActions}>
            {archived ? (
              <View style={st.localTag}>
                <Check size={15} color={HW.textSub} strokeWidth={3} />
                <Text style={st.localTagText}>已归档</Text>
              </View>
            ) : uploadable ? (
              <TouchableOpacity
                style={st.recActionBtn}
                onPress={() => toggleUploadSel(item.id)}>
                <View style={[st.checkbox, selected && st.checkboxOn]}>
                  {selected ? <Check size={13} color="#fff" strokeWidth={3} /> : null}
                </View>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={st.recActionBtn} onPress={() => confirmDelete(item)}>
              <Trash2 size={17} color={HW.red} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  // ---- 子页路由（原型 activeSubPage 状态机） ----
  // 某天录音子页（原型 date_recordings）：从折叠日期行点进来。
  if (selectedDayKey) {
    const group = groups.find(g => g.key === selectedDayKey);
    const dayItems = group?.items ?? [];
    const uploadables = dayItems.filter(isUploadable);
    const selCount = uploadables.filter(i => uploadSel.has(i.id)).length;
    const allSel = uploadables.length > 0 && selCount === uploadables.length;
    const closeDay = () => {
      setUploadSel(new Set());
      setSelectedDayKey(null);
    };
    const toggleAllUpload = () =>
      setUploadSel(allSel ? new Set() : new Set(uploadables.map(i => i.id)));
    const uploadSelected = () => {
      const chosen = uploadables.filter(i => uploadSel.has(i.id));
      if (!chosen.length) {
        return;
      }
      setUploadSel(new Set());
      // 一次性上传并提交为同一个批次（/app/audio/batch）。
      processItems(chosen).catch(() => undefined);
    };
    return (
      <View style={st.root}>
        <SubHeader
          title={group ? dayFull(itemEpoch(group.items[0])) : '录音'}
          onBack={closeDay}
          right={
            uploadables.length ? (
              <TouchableOpacity
                onPress={toggleAllUpload}
                hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
                <Text style={st.selectAllText}>{allSel ? '取消全选' : '全选'}</Text>
              </TouchableOpacity>
            ) : undefined
          }
        />
        <ScrollView
          contentContainerStyle={[st.pairedBody, selCount > 0 && st.pairedBodyPad]}
          showsVerticalScrollIndicator={false}>
          {dayItems.length ? (
            <View style={{gap: 12}}>{dayItems.map(renderRecCard)}</View>
          ) : (
            <Text style={st.empty}>这天的录音已清空。</Text>
          )}
        </ScrollView>
        {selCount > 0 ? (
          <View style={st.footer}>
            <TouchableOpacity style={st.startBtn} onPress={uploadSelected}>
              <Text style={st.startBtnText}>上传选中（{selCount} 段）</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <TransferBadge />
      </View>
    );
  }
  if (subPage === 'settings') {
    return <DeviceSettings onBack={() => setSubPage('main')} onNavigate={setSubPage} />;
  }
  if (subPage === 'wifi') {
    return <WifiManage onBack={() => setSubPage('settings')} />;
  }
  if (subPage === 'deviceFiles') {
    return <DeviceFiles onBack={() => setSubPage('main')} />;
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
                      <Text style={st.statBigUnit}>GB {freeMbRem}MB</Text>
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

          {/* 录音列表 */}
          <View style={st.listHead}>
            <Text style={st.listTitle}>我的录音</Text>
            <TouchableOpacity style={st.downloadAll} onPress={() => setSubPage('deviceFiles')}>
              <Text style={st.downloadAllText}>设备文件</Text>
            </TouchableOpacity>
          </View>

          {inbox.length === 0 ? (
            <Text style={st.empty}>暂无录音。点「查看全部」从记忆粒同步。</Text>
          ) : (
            <View style={{gap: 12}}>
              {groups.map(group => (
                <TouchableOpacity
                  key={group.key}
                  activeOpacity={0.7}
                  style={st.dateRow}
                  onPress={() => setSelectedDayKey(group.key)}>
                  <Text style={st.dateRowTitle}>{dayFull(itemEpoch(group.items[0]))}</Text>
                  <View style={st.dateRowRight}>
                    <Text style={st.dateRowCount}>共 {group.items.length} 条</Text>
                    <ChevronRight size={18} color={HW.textTertiary} />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
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
              <Text style={st.overlayTitle}>
                {devices.length ? '选择要连接的设备' : '正在寻找附近的录音设备...'}
              </Text>
              <Text style={st.overlaySub}>请确保设备已开机，且靠近手机（建议 1 米内）</Text>
              {devices.length ? (
                <View style={st.devList}>
                  {[...devices]
                    .sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999))
                    .map(d => (
                      <TouchableOpacity
                        key={d.id}
                        style={st.devRow}
                        activeOpacity={0.7}
                        onPress={() => chooseDevice(d)}>
                        <Bluetooth size={18} color={HW.blue} />
                        <Text style={st.devRowName} numberOfLines={1}>
                          {d.name || d.id}
                        </Text>
                        <View style={st.sig}>
                          {[0, 1, 2].map(i => (
                            <View
                              key={i}
                              style={[
                                st.sigBar,
                                {height: 5 + i * 4},
                                i < rssiLevel(d.rssi) ? st.sigOn : st.sigOff,
                              ]}
                            />
                          ))}
                        </View>
                        {d.rssi != null ? (
                          <Text style={st.devRowRssi}>{d.rssi} dBm</Text>
                        ) : null}
                        <ChevronRight size={18} color={HW.textTertiary} />
                      </TouchableOpacity>
                    ))}
                </View>
              ) : (
                <ActivityIndicator size="small" color={HW.blue} style={{marginTop: 16}} />
              )}
              <TouchableOpacity style={st.cancelBtn} onPress={cancelPairing}>
                <Text style={st.cancelText}>取消</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color={HW.textMain} style={{marginBottom: 24}} />
              <Text style={st.overlayTitle}>
                {pendingName ? `正在连接 ${pendingName}…` : '正在连接并配置设备...'}
              </Text>
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

      {/* 非阻塞传输浮标：从设备文件页发起同步后返回主页仍能看到进度、继续操作 */}
      <TransferBadge />
    </View>
  );
}

const st = StyleSheet.create({
  root: {flex: 1, backgroundColor: HW.pageBg},
  flex1: {flex: 1},
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
  pairedBodyPad: {paddingBottom: 110},
  selectAllText: {fontSize: 15, color: HW.blue, fontWeight: '600'},
  checkbox: {width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: HW.textTertiary, alignItems: 'center', justifyContent: 'center'},
  checkboxOn: {backgroundColor: HW.blue, borderColor: HW.blue},
  footer: {position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, paddingTop: 12, backgroundColor: 'rgba(249,249,251,0.96)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HW.divider},
  startBtn: {height: 52, borderRadius: 16, backgroundColor: HW.blue, alignItems: 'center', justifyContent: 'center'},
  startBtnText: {color: '#fff', fontSize: 16, fontWeight: '700'},
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

  dateRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: HW.card, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HW.cardBorder, ...shadow.soft},
  dateRowTitle: {fontSize: 16, fontWeight: '600', color: HW.textMain},
  dateRowRight: {flexDirection: 'row', alignItems: 'center', gap: 8},
  dateRowCount: {fontSize: 14, color: HW.textSub, fontWeight: '500'},
  listHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16},
  listTitle: {fontSize: 19, fontWeight: '700', color: HW.textMain, letterSpacing: -0.4},
  downloadAll: {backgroundColor: 'rgba(10,132,255,0.08)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16},
  downloadAllText: {fontSize: 14, color: HW.blue, fontWeight: '600'},
  empty: {fontSize: 14, color: HW.textSub, textAlign: 'center', paddingVertical: 32},
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
  devList: {alignSelf: 'stretch', marginTop: 20, gap: 10},
  devRow: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: HW.card, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: HW.cardBorder},
  devRowName: {flex: 1, fontSize: 15, fontWeight: '600', color: HW.textMain},
  sig: {flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 13},
  sigBar: {width: 3, borderRadius: 1},
  sigOn: {backgroundColor: HW.blue},
  sigOff: {backgroundColor: HW.textTertiary},
  devRowRssi: {fontSize: 12, color: HW.textSub},
  cancelBtn: {marginTop: 28, paddingHorizontal: 32, paddingVertical: 12, borderRadius: radius.pill, backgroundColor: HW.fill},
  cancelText: {color: HW.textMain, fontSize: 15, fontWeight: '600'},

  // More 菜单
  sheetCard: {backgroundColor: HW.card, borderRadius: 16, overflow: 'hidden'},
  sheetRow: {paddingVertical: 16, alignItems: 'center', justifyContent: 'center'},
  sheetRowBorder: {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HW.divider},
  sheetRowText: {fontSize: 17, color: HW.textMain},
});
