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
  FileText,
  Mic,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  Trash2,
} from 'lucide-react-native';
import {colors, radius, shadow} from '../design/tokens';
import {GradientBg} from '../ui/Gradient';
import {BottomSheet} from '../ui/BottomSheet';
import {images} from '../design/assets';
import {useNav} from '../navigation/nav';
import {useMr20} from '../hooks/useMr20';
import {useAudioPlayback} from '../hooks/useAudioPlayback';
import {itemEpoch, type Mr20InboxItem} from '../services/mr20Ingest';
import {resolveLocalPath} from '../services/mr20Sync';
import {scopedKey} from '../services/mr20Scope';
import {
  getLegacyMigrationInfo,
  migrateLegacyToScope,
  Mr20MigrateNeedsRebuildError,
} from '../services/mr20Migrate';
import {useAuth} from '../auth/AuthContext';
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

// 别名/自动同步/自动转文字偏好也按登录账号取作用域（scope=null 时回退旧全局 key）。在调用点现取。
const aliasKey = () => scopedKey('alias');
const autodlKey = () => scopedKey('autodl'); // 自动同步（设备→手机下载）
const autotxKey = () => scopedKey('autotx'); // 自动转文字（同步后自动上传转写）

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
    hasPaired,
    needsKeySetup,
    startScan,
    stopScan,
    connectAndPair,
    cancelNewDevicePairing,
    reconnectSaved,
    disconnect,
    syncNow,
    syncSelected,
    refreshDeviceFiles,
    processItems,
    processAllPending,
    deleteItems,
    refreshStatus,
    refreshInbox,
    clearError,
    unbindKey,
    unbindAndDeleteData,
  } = useMr20();
  const playback = useAudioPlayback();
  const {userId} = useAuth();

  const [subPage, setSubPage] = useState<HwSubPage>('main');
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null); // 展开查看某天录音
  const [uploadSel, setUploadSel] = useState<Set<string>>(new Set()); // 当天录音的批量上传勾选
  // 重新处理模式：勾选「已归档(done)」录音重新聚合成新 group（后端复用已有转写、不重跑 ASR）。
  const [reprocessMode, setReprocessMode] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<Mr20InboxItem | null>(null); // 查看录音转写全文
  const [disconnectAsk, setDisconnectAsk] = useState(false);
  const [unbindKeyAsk, setUnbindKeyAsk] = useState(false);
  const [unbindDeleteAsk, setUnbindDeleteAsk] = useState(false);
  const [alias, setAlias] = useState('');
  const [autoDownload, setAutoDownload] = useState(false); // 自动同步（设备→手机）
  // 自动转文字（同步后自动上传转写）：**默认开启**，本地无记录时按开处理。
  // autoTxLoaded 在偏好从 AsyncStorage 读回来前挡住自动触发——否则用户明明关过，
  // 读盘前的这一瞬 true 会抢跑一次上传 + 全屏 AI 授权弹窗。
  const [autoTranscribe, setAutoTranscribe] = useState(true);
  const [autoTxLoaded, setAutoTxLoaded] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [settling, setSettling] = useState(false); // 连上后 2s 稳定期（期间显示缓冲，不发命令）
  const [pendingName, setPendingName] = useState(''); // 正在连接的设备名（覆盖层展示）
  // 「重新连接」进行中：静默重连已知设备，不弹全屏配对覆盖层——否则会盖住离线态下
  // 正在浏览/播放的本地录音，还会把只该自动连的已配对设备变成一次设备选择。
  const [silentReconnect, setSilentReconnect] = useState(false);
  // 历史（旧全局、不绑账号）本地录音的迁移入口：{migrated, count}；仅在未迁移且有条数时提示。
  const [migrateInfo, setMigrateInfo] = useState<{migrated: boolean; count: number} | null>(null);
  const [migrating, setMigrating] = useState(false);

  const connected = connState === 'connected';
  const busy = connState === 'scanning' || connState === 'connecting' || connState === 'pairing';
  // 营销首屏只留给「真·新用户」：没配过设备且本地一条录音都没有。
  // 配过设备（或手里有本地录音）的用户即使当前没连上，也要进 dashboard——
  // 「我的录音」是纯本地数据（AsyncStorage + Documents），离线完全可播可上传转写，
  // 不该被连接状态挡在门外。
  const showHero = !connected && !hasPaired && inbox.length === 0;
  const autoDlRef = useRef(false);
  // 自动转文字重入闩：busy 防并发触发；key 记住「上一批已自动提交过的 synced 集合」，
  // 使同一批只自动触发一次——即便用户在同意弹窗里取消（条目仍为 synced）也不会反复弹窗。
  const autoTxBusyRef = useRef(false);
  const autoTxKeyRef = useRef('');
  // 门控「传输完成自动返回主页」：记录上一拍的传输态，只在真正发生过传输后
  // 触发一次返回，避免初始 false / 误触发。
  const bleWasSyncingRef = useRef(false);
  const wifiWasActiveRef = useRef(false);

  // 本地偏好：设备别名 + 自动同步 + 自动转文字开关。
  useEffect(() => {
    AsyncStorage.getItem(aliasKey()).then(v => v && setAlias(v)).catch(() => undefined);
    AsyncStorage.getItem(autodlKey()).then(v => setAutoDownload(v === '1')).catch(() => undefined);
    // 只有显式存过 '0' 才算关；null（从没动过）走默认开启。读盘失败也保持默认开。
    AsyncStorage.getItem(autotxKey())
      .then(v => setAutoTranscribe(v == null ? true : v === '1'))
      .catch(() => undefined)
      .finally(() => setAutoTxLoaded(true));
  }, []);

  // 检测是否有旧全局（不绑账号）本地录音待归入当前账号。随 userId 变化重查。
  useEffect(() => {
    getLegacyMigrationInfo().then(setMigrateInfo).catch(() => undefined);
  }, [userId]);

  // 手动迁移：把历史本地录音（key + 文件）归入当前账号，然后刷新「我的录音」。
  const runMigrate = useCallback(async () => {
    if (!userId || migrating) {
      return;
    }
    setMigrating(true);
    try {
      const n = await migrateLegacyToScope(userId);
      await refreshInbox();
      const info = await getLegacyMigrationInfo();
      setMigrateInfo(info);
      Alert.alert('已归入当前账号', `${n} 条本地录音已归入，可在「我的录音」查看。`);
    } catch (e) {
      if (e instanceof Mr20MigrateNeedsRebuildError) {
        Alert.alert('需要更新 App', '迁移本地录音文件需更新到最新版本后重试。');
      } else {
        Alert.alert('迁移失败', String((e as Error)?.message || e));
      }
    } finally {
      setMigrating(false);
    }
  }, [userId, migrating, refreshInbox]);

  const showMigrateBanner =
    !!migrateInfo && !migrateInfo.migrated && migrateInfo.count > 0;

  // 离开页面停扫描。
  useEffect(() => () => stopScan(), [stopScan]);

  // 连上后拉一次状态 + 设备文件（串行，避免命令应答交错）。
  // 刚连上时链路还不稳，立刻发列目录命令容易无应答卡死：先等 2s 让连接稳定
  //（期间 settling=true 显示缓冲动画），再开始发命令。
  useEffect(() => {
    if (!connected) {
      setSettling(false);
      return;
    }
    let alive = true;
    setSettling(true);
    const timer = setTimeout(() => {
      (async () => {
        try {
          await refreshStatus().catch(() => undefined);
          if (alive) {
            await refreshDeviceFiles().catch(() => undefined);
          }
        } finally {
          if (alive) {
            setSettling(false);
          }
        }
      })();
    }, 2000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [connected, refreshStatus, refreshDeviceFiles]);

  // 成功态闪现：仅在「本页在场时真正从未连接→连上」才短暂显示绿勾。
  // 若进入本页时设备已连着（如首页自动重连后再进来），不应再闪一次「连接成功」。
  const prevConnectedRef = useRef(connected);
  useEffect(() => {
    const was = prevConnectedRef.current;
    prevConnectedRef.current = connected;
    if (connected && !was) {
      setShowSuccess(true);
      const t = setTimeout(() => setShowSuccess(false), 1400);
      return () => clearTimeout(t);
    }
    if (!connected) {
      setShowSuccess(false);
    }
  }, [connected]);

  // 自动下载：开启且有待同步文件时，连上后自动同步一次。
  // wifiPhase 必须为 idle——切到 WiFi 快传后 syncing 立刻落回 false，只看 !syncing 会让
  // 蓝牙自动同步在 WiFi 传输进行中被拉起来，两条链路抢 BLE 打架。
  useEffect(() => {
    if (
      connected &&
      autoDownload &&
      !syncing &&
      wifiPhase === 'idle' &&
      (deviceFiles?.pending ?? 0) > 0 &&
      !autoDlRef.current
    ) {
      autoDlRef.current = true;
      syncNow().catch(() => undefined);
    }
    if (!connected) {
      autoDlRef.current = false;
    }
  }, [connected, autoDownload, syncing, wifiPhase, deviceFiles, syncNow]);

  // 自动转文字：开启后，把「已同步(synced)但尚未上传」的录音自动上传并提交转写。
  // 与自动同步相互独立——用户可只开其一。为避免与手动/进行中的批处理打架，且不在
  // 同意弹窗被取消后反复弹窗，用 busy + key 双闩：key 记住已自动提交过的 synced 集合，
  // 同一批只触发一次；有新录音同步进来（集合变化）才会再次自动触发。
  useEffect(() => {
    if (!autoTxLoaded) {
      return; // 偏好还没读回来，默认值可能与用户实际设置相反，先按兵不动
    }
    if (!autoTranscribe) {
      autoTxKeyRef.current = '';
      return;
    }
    if (autoTxBusyRef.current || processingIds.length > 0) {
      return;
    }
    // 传输中先等它结束，好让同一批同步的录音合并成一个批次一起上传转写。
    if (syncing || wifiPhase === 'connecting' || wifiPhase === 'transferring') {
      return;
    }
    const pendingIds = inbox
      .filter(it => it.status === 'synced')
      .map(it => it.id)
      .sort();
    if (pendingIds.length === 0) {
      return;
    }
    const key = pendingIds.join('|');
    if (key === autoTxKeyRef.current) {
      return; // 这一批已自动提交过（可能用户在同意弹窗里取消），不重复触发/弹窗
    }
    autoTxKeyRef.current = key;
    autoTxBusyRef.current = true;
    processAllPending().finally(() => {
      autoTxBusyRef.current = false;
    });
  }, [autoTxLoaded, autoTranscribe, syncing, wifiPhase, processingIds, inbox, processAllPending]);

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

  // 扫描配对：走全屏覆盖层的设备选择流程（换设备/连别的记忆粒都走这里）。
  // 必须显式复位 silentReconnect——否则上一次静默重连若在扫描起来前就失败返回
  //（蓝牙关着、没配对记录…），闩会一直挂着，把这次手动扫描的设备列表也一起吞掉。
  const pair = useCallback(() => {
    setSilentReconnect(false);
    setPendingName('');
    clearError();
    startScan().catch(() => undefined);
  }, [startScan, clearError]);

  // 离线卡片上的主按钮：配过设备就静默重连（force 绕过「每会话只自动重连一次」的门控），
  // 没配过才走扫描配对。
  const reconnect = useCallback(() => {
    clearError();
    if (hasPaired) {
      // reconnectSaved 的 promise 在扫描起来时就 resolve（连接还在后台跑），
      // 所以退出条件不看它，交给下面的 busy effect 复位。
      setSilentReconnect(true);
      reconnectSaved(true).catch(() => undefined);
      return;
    }
    setSilentReconnect(false);
    setPendingName('');
    startScan().catch(() => undefined);
  }, [hasPaired, reconnectSaved, startScan, clearError]);

  // 静默重连结束（连上、超时回 idle 或被打断）后复位，让后续手动配对仍能看到覆盖层。
  useEffect(() => {
    if (!busy) {
      setSilentReconnect(false);
    }
  }, [busy]);

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
    async (item: Mr20InboxItem) => {
      // 现算本地绝对路径（当前 Documents + 相对路径），不信任持久化的 localPath。
      const path = await resolveLocalPath(item);
      playback.toggle(item.id, path).catch(() => {
        // 播放失败多为本地文件缺失/损坏/半包：给出从设备重传覆盖的补救路径（无 exists 探测，错误驱动）。
        if (connState !== 'connected') {
          Alert.alert(
            '无法播放',
            '本地录音文件缺失或损坏。请先连接记忆粒，再从「设备文件」重新传输以覆盖本地。',
          );
          return;
        }
        Alert.alert('无法播放', '本地录音文件缺失或损坏，是否从设备重新传输并覆盖？', [
          {text: '取消', style: 'cancel'},
          {
            text: '重新传输',
            onPress: async () => {
              try {
                await syncSelected([
                  {
                    dir: item.dir,
                    fname: item.fname,
                    seconds: item.seconds,
                    size: item.sizeBytes ?? 0,
                  },
                ]);
                await playback.toggle(item.id, await resolveLocalPath(item));
              } catch (e) {
                Alert.alert('播放失败', String((e as Error)?.message || e));
              }
            },
          },
        ]);
      });
    },
    [playback, connState, syncSelected],
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
    AsyncStorage.setItem(aliasKey(), name).catch(() => undefined);
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
      AsyncStorage.setItem(autodlKey(), next ? '1' : '0').catch(() => undefined);
      return next;
    });
  }, []);

  const toggleAutoTranscribe = useCallback(() => {
    setAutoTranscribe(v => {
      const next = !v;
      AsyncStorage.setItem(autotxKey(), next ? '1' : '0').catch(() => undefined);
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
        <TouchableOpacity
          style={st.flex1}
          activeOpacity={0.6}
          onPress={() => setDetailItem(item)}>
          <Text style={st.recTitle} numberOfLines={1}>
            {item.transcript?.trim() ||
              (item.status === 'queued'
                ? '转写中…'
                : `录音 ${clock(itemEpoch(item))}`)}
          </Text>
          <Text style={st.recMeta}>
            {clockSec(itemEpoch(item))} · 时长 {fmtHuman(item.seconds)}
            {item.sizeBytes ? ` · ${fmtMB(item.sizeBytes)}` : ''}
          </Text>
        </TouchableOpacity>
        {isProcessing ? (
          <ActivityIndicator size="small" color={HW.blue} />
        ) : (
          <View style={st.recActions}>
            {reprocessMode ? (
              // 重新处理模式：只有已归档(done)项可勾选重新聚合；其余项不可选。
              archived ? (
                <TouchableOpacity
                  style={st.recActionBtn}
                  onPress={() => toggleUploadSel(item.id)}>
                  <View style={[st.checkbox, selected && st.checkboxOn]}>
                    {selected ? <Check size={13} color="#fff" strokeWidth={3} /> : null}
                  </View>
                </TouchableOpacity>
              ) : null
            ) : archived ? (
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

  // 录音转写全文弹层：主页面和「某天录音」子页都渲染（子页是提前 return 的独立
  // 分支，只放在主页面 JSX 里会导致子页点卡片后要退回主页弹层才出现）。
  const transcriptSheet = (
    <BottomSheet
      visible={!!detailItem}
      onClose={() => setDetailItem(null)}
      title="录音转写">
      {detailItem ? (
        <>
          <Text style={st.detailMeta}>
            {dayFull(itemEpoch(detailItem))} {clockSec(itemEpoch(detailItem))} ·
            时长 {fmtHuman(detailItem.seconds)}
            {detailItem.sizeBytes ? ` · ${fmtMB(detailItem.sizeBytes)}` : ''}
          </Text>
          <ScrollView
            style={st.detailScroll}
            contentContainerStyle={st.detailScrollBody}
            showsVerticalScrollIndicator>
            {detailItem.transcript?.trim() ? (
              <Text style={st.detailText} selectable>
                {detailItem.transcript.trim()}
              </Text>
            ) : detailItem.status === 'queued' ? (
              <Text style={st.detailPlaceholder}>转写中…请稍候</Text>
            ) : detailItem.status === 'error' ? (
              <Text style={st.detailPlaceholder}>
                转写失败：{detailItem.error || '未知错误'}
              </Text>
            ) : (
              <Text style={st.detailPlaceholder}>暂无转写文本</Text>
            )}
          </ScrollView>
          <TouchableOpacity
            style={st.detailPlayBtn}
            activeOpacity={0.8}
            onPress={() => onPlay(detailItem)}>
            {playback.playingId === detailItem.id ? (
              <Pause size={18} color="#fff" fill="#fff" />
            ) : (
              <Play size={18} color="#fff" fill="#fff" />
            )}
            <Text style={st.detailPlayText}>
              {playback.playingId === detailItem.id ? '暂停' : '播放录音'}
            </Text>
          </TouchableOpacity>
        </>
      ) : null}
    </BottomSheet>
  );

  // ---- 子页路由（原型 activeSubPage 状态机） ----
  // 某天录音子页（原型 date_recordings）：从折叠日期行点进来。
  if (selectedDayKey) {
    const group = groups.find(g => g.key === selectedDayKey);
    const dayItems = group?.items ?? [];
    // 普通模式选未处理项做首次上传；重新处理模式选已归档(done)项重新聚合。两种互斥。
    const reprocessables = dayItems.filter(i => i.status === 'done');
    const activeSet = reprocessMode
      ? reprocessables
      : dayItems.filter(isUploadable);
    const selCount = activeSet.filter(i => uploadSel.has(i.id)).length;
    const allSel = activeSet.length > 0 && selCount === activeSet.length;
    const closeDay = () => {
      setUploadSel(new Set());
      setReprocessMode(false);
      setSelectedDayKey(null);
    };
    const toggleReprocessMode = () => {
      setUploadSel(new Set());
      setReprocessMode(m => !m);
    };
    const toggleAllActive = () =>
      setUploadSel(allSel ? new Set() : new Set(activeSet.map(i => i.id)));
    const submitSelected = () => {
      const chosen = activeSet.filter(i => uploadSel.has(i.id));
      if (!chosen.length) {
        return;
      }
      setUploadSel(new Set());
      setReprocessMode(false);
      // 一次性提交为同一个批次（/app/audio/batch）；重新处理时 payload 带 transcript，后端复用不重跑 ASR。
      processItems(chosen).catch(() => undefined);
    };
    return (
      <View style={st.root}>
        <SubHeader
          title={group ? dayFull(itemEpoch(group.items[0])) : '录音'}
          onBack={closeDay}
          right={
            reprocessables.length || activeSet.length ? (
              <View style={st.dayHeadActions}>
                {reprocessables.length ? (
                  <TouchableOpacity
                    onPress={toggleReprocessMode}
                    hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
                    <Text style={st.selectAllText}>
                      {reprocessMode ? '完成' : '重新处理'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {activeSet.length ? (
                  <TouchableOpacity
                    onPress={toggleAllActive}
                    hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
                    <Text style={st.selectAllText}>{allSel ? '取消全选' : '全选'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : undefined
          }
        />
        {reprocessMode ? (
          <Text style={st.reprocessHint}>
            勾选已归档录音重新归入一个新场景（复用已有转写，不重复消耗转写额度）。
          </Text>
        ) : null}
        <ScrollView
          contentContainerStyle={[st.pairedBody, selCount > 0 && st.pairedBodyPad]}
          showsVerticalScrollIndicator={false}>
          {dayItems.length ? (
            <View style={st.dayList}>{dayItems.map(renderRecCard)}</View>
          ) : (
            <Text style={st.empty}>这天的录音已清空。</Text>
          )}
        </ScrollView>
        {selCount > 0 ? (
          <View style={st.footer}>
            <TouchableOpacity style={st.startBtn} onPress={submitSelected}>
              <Text style={st.startBtnText}>
                {reprocessMode
                  ? `重新处理（${selCount} 段）`
                  : `上传选中（${selCount} 段）`}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {transcriptSheet}
        <TransferBadge />
      </View>
    );
  }
  if (subPage === 'settings') {
    return <DeviceSettings onBack={() => setSubPage('main')} onNavigate={setSubPage} />;
  }
  if (subPage === 'wifi') {
    return <WifiManage onBack={() => setSubPage('settings')} autoInit={needsKeySetup} />;
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

      {/* 历史本地录音归入当前账号：改造前录音不绑账号，登录后需手动一键归入才在「我的录音」可见。
          连接与否都显示——离线的老用户也在这个页面（未配对视图）。 */}
      {showMigrateBanner ? (
        <View style={st.migrateBar}>
          <View style={st.flex1}>
            <Text style={st.migrateTitle}>
              检测到 {migrateInfo?.count} 条本地录音
            </Text>
            <Text style={st.migrateSub}>
              这些录音尚未归入任何账号，点「归入」后即可在「我的录音」查看和播放。
            </Text>
          </View>
          <TouchableOpacity
            style={[st.migrateBtn, migrating && st.migrateBtnDisabled]}
            disabled={migrating}
            onPress={runMigrate}>
            {migrating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={st.migrateBtnText}>归入</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {/* 连接建立之后才查后端绑定状态（见 useMr20.checkDeviceBinding），不打断连接过程本身；
          未绑定才出这条提示。「设置密钥」引导去 WifiManage，密钥由后端签发（见
          issueBackendKey），WifiManage 在 autoInit 效果里回显给用户确认后才真正写进设备。 */}
      {connected && needsKeySetup ? (
        <View style={st.migrateBar}>
          <View style={st.flex1}>
            <Text style={st.migrateTitle}>这台设备还没有绑定到你的账号</Text>
            <Text style={st.migrateSub}>设置一把专属密钥后才能正常同步和转手管理</Text>
          </View>
          <TouchableOpacity style={st.migrateBtn} onPress={() => setSubPage('wifi')}>
            <Text style={st.migrateBtnText}>设置密钥</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={cancelNewDevicePairing} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Text style={st.migrateSub}>暂不</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {showHero ? (
        /* ---- 未配对且无本地录音 ---- */
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
        </ScrollView>
      ) : (
        /* ---- 已配对 dashboard（未连接时为离线态：设备数据隐藏，本地录音照常） ---- */
        <ScrollView contentContainerStyle={st.pairedBody} showsVerticalScrollIndicator={false}>
          <View style={st.dashCard}>
            <GradientBg radius={radius.bigCard} from={colors.darkCard} to="#2C2C2E" />
            {/* Row1 设备 + 连接状态 */}
            <View style={st.dashRow1}>
              <View style={st.devIconWrap}>
                <Bluetooth size={20} color={connected ? '#fff' : 'rgba(255,255,255,0.45)'} />
              </View>
              <Text style={st.devName} numberOfLines={1}>{deviceName}</Text>
              {connected ? (
                <View style={st.connBadge}>
                  <View style={st.connDot} />
                  <Text style={st.connBadgeText}>蓝牙已连接</Text>
                </View>
              ) : (
                <View style={st.offBadge}>
                  <View style={st.offDot} />
                  <Text style={st.offBadgeText}>未连接</Text>
                </View>
              )}
            </View>

            {/* Row2 录音状态 */}
            {!connected ? (
              /* 离线：只给状态 + 重连入口；电量/存储在下面一并隐藏 */
              <>
                <View style={st.idleBanner}>
                  <View style={st.idleDot} />
                  <Text style={st.idleText}>
                    {inbox.length
                      ? `设备未连接 · 本地 ${inbox.length} 段录音可直接播放`
                      : '设备未连接 · 连接后可同步设备里的录音'}
                  </Text>
                </View>
                <TouchableOpacity style={st.reconnectBtn} onPress={reconnect} disabled={busy}>
                  {busy ? (
                    <View style={st.reconnectBusy}>
                      <ActivityIndicator size="small" color="#fff" />
                      <Text style={st.reconnectBtnText}>正在连接…</Text>
                    </View>
                  ) : (
                    <Text style={st.reconnectBtnText}>{hasPaired ? '重新连接' : '连接设备'}</Text>
                  )}
                </TouchableOpacity>
                {/* 「重新连接」只连已保存的那台，换设备/连别的记忆粒必须还有扫描入口。
                    未配对时上面的主按钮本身就是扫描，不再重复。 */}
                {hasPaired && !busy ? (
                  <TouchableOpacity style={st.scanOtherBtn} onPress={pair}>
                    <Text style={st.scanOtherText}>搜索并连接其他设备</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : recording ? (
              <View style={st.recBanner}>
                <View style={st.recBannerDot} />
                <Text style={st.recBannerText}>正在录音 · 已录制 {fmtDuration(recording.seconds)}</Text>
              </View>
            ) : settling ? (
              <View style={st.idleBanner}>
                <ActivityIndicator size="small" color={HW.blue} />
                <Text style={st.idleText}>正在读取设备数据…</Text>
              </View>
            ) : (
              <View style={st.idleBanner}>
                <View style={st.idleDot} />
                <Text style={st.idleText}>
                  当前待机{inbox.length ? ` · 本地 ${inbox.length} 段录音` : ''}
                </Text>
              </View>
            )}

            {/* Row3 电量/存储：仅连接时展示——断开后 status 里还是上次连上时的旧值，
                摆着比不摆更误导。 */}
            {connected ? (
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
            ) : null}
          </View>

          {/* 自动化两格：自动同步 + 自动转文字（独立开关，整格可点） */}
          <View style={st.autoGrid}>
            <TouchableOpacity
              style={st.autoTile}
              activeOpacity={0.7}
              onPress={toggleAutoDownload}>
              <View style={st.autoTileTop}>
                <View style={[st.autoIcon, autoDownload && st.autoIconOn]}>
                  <RefreshCw size={16} color={autoDownload ? HW.green : HW.textTertiary} />
                </View>
                <View style={[st.toggle, {backgroundColor: autoDownload ? HW.green : '#E5E5EA'}]}>
                  <View style={[st.knob, {left: autoDownload ? 22 : 2}]} />
                </View>
              </View>
              <Text style={st.autoLabel} numberOfLines={1}>自动同步</Text>
              <Text style={st.autoHint} numberOfLines={1}>新录音自动下载</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={st.autoTile}
              activeOpacity={0.7}
              onPress={toggleAutoTranscribe}>
              <View style={st.autoTileTop}>
                <View style={[st.autoIcon, autoTranscribe && st.autoIconOn]}>
                  <FileText size={16} color={autoTranscribe ? HW.green : HW.textTertiary} />
                </View>
                <View style={[st.toggle, {backgroundColor: autoTranscribe ? HW.green : '#E5E5EA'}]}>
                  <View style={[st.knob, {left: autoTranscribe ? 22 : 2}]} />
                </View>
              </View>
              <Text style={st.autoLabel} numberOfLines={1}>自动转文字</Text>
              <Text style={st.autoHint} numberOfLines={1}>下载后自动转写</Text>
            </TouchableOpacity>
          </View>

          {/* 录音列表 */}
          <View style={st.listHead}>
            <Text style={st.listTitle}>我的录音</Text>
            {/* 设备文件页要发 BLE 列目录命令，没连上进去只有一句提示——离线时不给这个死胡同入口 */}
            {connected ? (
              <TouchableOpacity style={st.downloadAll} onPress={() => setSubPage('deviceFiles')}>
                <Text style={st.downloadAllText}>设备文件</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {inbox.length === 0 ? (
            <Text style={st.empty}>
              {connected
                ? '暂无录音。点「设备文件」从记忆粒同步。'
                : '暂无本地录音。连接记忆粒后可把设备里的录音同步到这里。'}
            </Text>
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
        </ScrollView>
      )}

      {/* 配对覆盖层：扫描 / 配置 / 成功 */}
      {(busy || showSuccess) && !error && !silentReconnect ? (
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
        <View style={[st.sheetCard, {marginTop: 12}]}>
          <TouchableOpacity
            style={[st.sheetRow, st.sheetRowBorder]}
            onPress={() => {
              setMoreOpen(false);
              setUnbindKeyAsk(true);
            }}>
            <Text style={[st.sheetRowText, {color: HW.red}]}>解绑密钥</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={st.sheetRow}
            onPress={() => {
              setMoreOpen(false);
              setUnbindDeleteAsk(true);
            }}>
            <Text style={[st.sheetRowText, {color: HW.red}]}>解绑并删除数据</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={[st.sheetCard, {marginTop: 12}]} onPress={() => setMoreOpen(false)}>
          <View style={st.sheetRow}>
            <Text style={[st.sheetRowText, {color: HW.blue, fontWeight: '600'}]}>取消</Text>
          </View>
        </TouchableOpacity>
      </BottomSheet>

      {/* 录音转写全文（transcriptSheet 定义在子页路由前，两个分支共用） */}
      {transcriptSheet}

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

      {/* 解绑密钥确认（高危）：设备需已连接，SK&RESET + 后端解绑，不删本机录音 */}
      <IosAlert
        visible={unbindKeyAsk}
        onClose={() => setUnbindKeyAsk(false)}
        title="确定解绑密钥？"
        titleColor={HW.red}
        icon={<AlertTriangle size={32} color={HW.red} />}
        message="设备上的密钥将被清除并与你的账号解绑，需重新设置密钥才能再次使用（含转手给其他人）。已下载到手机的录音文件不会被删除。"
        buttons={[
          {text: '取消', onPress: () => setUnbindKeyAsk(false)},
          {
            text: '解绑密钥',
            danger: true,
            onPress: () => {
              setUnbindKeyAsk(false);
              unbindKey().catch(() => undefined);
            },
          },
        ]}
      />

      {/* 解绑并删除数据确认（更高危）：在解绑密钥基础上，再清本机录音/收件箱缓存 */}
      <IosAlert
        visible={unbindDeleteAsk}
        onClose={() => setUnbindDeleteAsk(false)}
        title="确定解绑并删除数据？"
        titleColor={HW.red}
        icon={<AlertTriangle size={32} color={HW.red} />}
        message="除了清除设备密钥并与账号解绑外，还会删除本机已下载的录音、收件箱和处理记录，操作不可撤销。"
        buttons={[
          {text: '取消', onPress: () => setUnbindDeleteAsk(false)},
          {
            text: '解绑并删除',
            danger: true,
            onPress: () => {
              setUnbindDeleteAsk(false);
              unbindAndDeleteData().catch(() => undefined);
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
  migrateBar: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(10,132,255,0.08)', marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(10,132,255,0.2)'},
  migrateTitle: {fontSize: 14, fontWeight: '700', color: HW.textMain, marginBottom: 2},
  migrateSub: {fontSize: 12, color: HW.textSub, lineHeight: 17},
  migrateBtn: {paddingHorizontal: 18, height: 36, borderRadius: 18, backgroundColor: HW.blue, alignItems: 'center', justifyContent: 'center'},
  migrateBtnDisabled: {backgroundColor: HW.textTertiary},
  migrateBtnText: {color: '#fff', fontSize: 14, fontWeight: '700'},
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

  // 已配对
  pairedBody: {padding: 20},
  pairedBodyPad: {paddingBottom: 110},
  selectAllText: {fontSize: 15, color: HW.blue, fontWeight: '600'},
  dayHeadActions: {flexDirection: 'row', alignItems: 'center', gap: 16},
  dayList: {gap: 12},
  reprocessHint: {fontSize: 12, color: HW.textSub, lineHeight: 18, paddingHorizontal: 20, paddingTop: 12},
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
  // 离线态徽标：与 connBadge 同形，改中性灰——未连接是常态，不用红色报警
  offBadge: {flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)'},
  offDot: {width: 6, height: 6, borderRadius: 3, backgroundColor: HW.textSub},
  offBadgeText: {fontSize: 12, color: '#D1D1D6', fontWeight: '500'},
  reconnectBtn: {height: 48, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center'},
  reconnectBtnText: {fontSize: 15, color: '#fff', fontWeight: '600'},
  reconnectBusy: {flexDirection: 'row', alignItems: 'center', gap: 8},
  scanOtherBtn: {alignItems: 'center', paddingVertical: 12, marginTop: 4},
  scanOtherText: {fontSize: 14, color: '#8AB4F8', fontWeight: '600'},
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
  // 自动化两格：与上方 statGrid 同构（flex:1 + gap:12），材质对齐页面里的白卡
  // （HW.card + shadow.soft + radius 20，同 dateRow）。早先用 HW.pageBg 与页面同色，
  // 只剩一条 0.03 的淡边，整块发虚——白卡+软阴影才立得起来。
  autoGrid: {flexDirection: 'row', gap: 12, marginBottom: 24},
  autoTile: {flex: 1, backgroundColor: HW.card, borderRadius: 20, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HW.cardBorder, ...shadow.soft},
  autoTileTop: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14},
  autoIcon: {width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: HW.fill},
  autoIconOn: {backgroundColor: 'rgba(52,199,89,0.12)'}, // 开启态跟随开关的绿，图标一起变绿
  autoLabel: {fontSize: 15, fontWeight: '700', color: HW.textMain, letterSpacing: -0.2, marginBottom: 3},
  autoHint: {fontSize: 11, color: HW.textSub, fontWeight: '500'},
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
  // 转写全文弹层
  detailMeta: {fontSize: 13, color: HW.textSub, fontWeight: '500', marginBottom: 12},
  detailScroll: {maxHeight: 320, backgroundColor: HW.card, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HW.cardBorder},
  detailScrollBody: {padding: 16},
  detailText: {fontSize: 16, lineHeight: 26, color: HW.textMain, letterSpacing: -0.2},
  detailPlaceholder: {fontSize: 15, color: HW.textSub, textAlign: 'center', paddingVertical: 24},
  detailPlayBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: HW.blue, borderRadius: 14, paddingVertical: 14, marginTop: 16},
  detailPlayText: {fontSize: 16, fontWeight: '600', color: '#fff'},
});
