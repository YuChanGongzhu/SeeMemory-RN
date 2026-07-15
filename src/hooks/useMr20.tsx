/**
 * useMr20 — 记忆粒(MR20) 连接/同步/入库的全局 Provider。
 *
 * 持有单例 Mr20Client（懒加载：仅在首次扫描/连接时 new，避免原生未链接时崩溃），
 * 把 BLE 事件映射成 React 状态，并暴露给 UI 的动作方法。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Mr20Client,
  Mr20ConnState,
  Mr20Device,
  Mr20File,
  Mr20Status,
} from '../native/mr20/Mr20Client';
import {Mr20Native, isMr20NativeAvailable, isMr20WifiAvailable} from '../native/mr20/Mr20Native';
import {MR20_PAIR_KEY} from '../native/mr20/protocol';
import {
  clearBatchGroupId,
  clearPairedDevice,
  clearSyncedSet,
  getBatchGroupId,
  getPairedDevice,
  savePairedDevice,
  saveBatchGroupId,
} from '../services/mr20Storage';
import {
  applyBatchResult,
  batchDate,
  batchFileName,
  clearInbox,
  getInbox,
  markItemsQueued,
  Mr20InboxItem,
  removeInboxItems,
  uploadSyncedFile,
} from '../services/mr20Ingest';
import {
  createAudioBatch,
  getBatchProgress,
  getBatchResult,
  isBatchTerminal,
  retryBatch,
} from '../services/audioBatch';
import {
  deleteAllLocalFiles,
  deleteLocalFiles,
  listAllDeviceFiles as listAllDeviceFilesSvc,
  listPendingFiles,
  scanDeviceFiles,
  syncAllFiles,
  syncFiles,
  Mr20DeviceFiles,
  SyncProgress,
} from '../services/mr20Sync';
import {
  connectWifi,
  disconnectWifi,
  wifiSyncFiles,
  WifiConnectStep,
  WifiStepState,
  WifiTransferProgress,
} from '../services/mr20WifiSync';

/** WiFi 快传整体阶段。 */
export type WifiPhase =
  | 'idle'
  | 'connecting' // 开热点 + 入网（连接中清单展示）
  | 'manual' // 自动入网失败，等用户手动连热点
  | 'transferring' // 收流中
  | 'done'
  | 'error';

/** WiFi 快传完成后的汇总（喂给完成页）。 */
export interface WifiTransferSummary {
  count: number; // 成功传输的文件数
  bytes: number; // 成功传输的总字节
  failed: number; // 失败数
}

/** 当前/最近一次后端批处理的轻量快照（喂给 UI 的进度/结果卡）。 */
export interface Mr20BatchState {
  groupId: string;
  status: string;
  completed: number;
  total: number;
  summary?: string;
  questions?: string[];
}

interface Mr20ContextType {
  // 弹窗
  screenOpen: boolean;
  openScreen: () => void;
  closeScreen: () => void;
  // 连接
  connState: Mr20ConnState;
  devices: Mr20Device[];
  connectedDevice: Mr20Device | null;
  status: Mr20Status;
  recording: {fname: string; seconds: number} | null;
  // 同步
  syncing: boolean;
  syncProgress: SyncProgress | null;
  // WiFi 快传
  wifiPhase: WifiPhase;
  wifiSteps: Record<WifiConnectStep, WifiStepState>;
  wifiProgress: WifiTransferProgress | null;
  wifiCred: {ssid: string; pwd: string} | null; // 手动连接引导用
  wifiSummary: WifiTransferSummary | null;
  // 设备上当前的录音文件统计（总数 / 待同步 / 字节）
  deviceFiles: Mr20DeviceFiles | null;
  inbox: Mr20InboxItem[];
  // 正在上传/提交的收件箱条目 id
  processingIds: string[];
  // 当前后端批处理状态（转写 + 总结 + 问题）
  currentBatch: Mr20BatchState | null;
  // 其它
  error: string | null;
  logs: string[];
  hasPaired: boolean;
  // 动作
  startScan: () => Promise<void>;
  stopScan: () => void;
  connectAndPair: (deviceId: string, name: string) => Promise<void>;
  // 自动/手动重连上一次配对过的设备（静默扫描→匹配 id→连接）。首页用。
  // force=true 用于用户手动「重新连接」，绕过「每会话只自动一次」的门控。
  reconnectSaved: (force?: boolean) => Promise<void>;
  clearPairing: (deviceId: string, name: string) => Promise<void>;
  disconnect: () => Promise<void>;
  syncNow: () => Promise<void>;
  // 同步勾选的设备文件子集到「我的录音」（设备文件浏览页用）。
  syncSelected: (files: Mr20File[]) => Promise<void>;
  stopSync: () => void;
  // 列出设备上「全部」录音文件（设备文件浏览页用，含已传输，可重传覆盖本地）。
  listAllDeviceFiles: () => Promise<Mr20File[]>;
  // WiFi 热点管理（WifiManage 页用）：开/关热点、读当前 SSID/密码/状态。
  openHotspot: () => Promise<void>;
  closeHotspot: () => Promise<void>;
  getHotspotInfo: () => Promise<{ssid: string; pwd: string; state: number} | null>;
  // WiFi 快传：传入用户勾选的文件子集，自动走「开热点→入网→逐个收流→入库」。
  startWifiTransfer: (files: Mr20File[]) => Promise<void>;
  // WiFi 快传「全部待同步」（首页一键快传用）：内部列出未同步文件后走 startWifiTransfer。
  startWifiTransferPending: () => Promise<void>;
  // 自动入网失败后，用户已手动连上热点，点此继续传输。
  continueWifiAfterManualJoin: () => Promise<void>;
  cancelWifiTransfer: () => void;
  resetWifiTransfer: () => void;
  refreshDeviceFiles: () => Promise<void>;
  processInboxItem: (item: Mr20InboxItem) => Promise<void>;
  processItems: (items: Mr20InboxItem[]) => Promise<void>;
  processAllPending: () => Promise<void>;
  deleteItems: (items: Mr20InboxItem[]) => Promise<void>;
  retryFailedBatch: () => Promise<void>;
  clearLocalCache: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  refreshInbox: () => Promise<void>;
  syncTime: () => Promise<void>;
  forgetDevice: () => Promise<void>;
  factoryReset: () => Promise<void>;
  clearError: () => void;
}

const noop = async () => {};
const Mr20Context = createContext<Mr20ContextType>({
  screenOpen: false,
  openScreen: () => {},
  closeScreen: () => {},
  connState: 'idle',
  devices: [],
  connectedDevice: null,
  status: {},
  recording: null,
  syncing: false,
  syncProgress: null,
  wifiPhase: 'idle',
  wifiSteps: {open: 'pending', join: 'pending', reachable: 'pending'},
  wifiProgress: null,
  wifiCred: null,
  wifiSummary: null,
  deviceFiles: null,
  inbox: [],
  processingIds: [],
  currentBatch: null,
  error: null,
  logs: [],
  hasPaired: false,
  startScan: noop,
  stopScan: () => {},
  connectAndPair: noop,
  reconnectSaved: noop,
  clearPairing: noop,
  disconnect: noop,
  syncNow: noop,
  syncSelected: noop,
  stopSync: () => {},
  listAllDeviceFiles: async () => [],
  openHotspot: noop,
  closeHotspot: noop,
  getHotspotInfo: async () => null,
  startWifiTransfer: noop,
  startWifiTransferPending: noop,
  continueWifiAfterManualJoin: noop,
  cancelWifiTransfer: () => {},
  resetWifiTransfer: () => {},
  refreshDeviceFiles: noop,
  processInboxItem: noop,
  processItems: noop,
  processAllPending: noop,
  deleteItems: noop,
  retryFailedBatch: noop,
  clearLocalCache: noop,
  startRecording: noop,
  stopRecording: noop,
  refreshStatus: noop,
  refreshInbox: noop,
  syncTime: noop,
  forgetDevice: noop,
  factoryReset: noop,
  clearError: () => {},
});

const MAX_LOGS = 200;

/**
 * SK 握手兜底。仅在「裸连探测」失败（设备对只读指令静默）后才调用。
 * - SK&OK：握手通过，正常进主页。
 * - SK&ERR：设备绑了别的密钥。注意：BLE&RESET/BLE&OFF 在未鉴权时会被固件忽略
 *   （日志实测发完照样 ERR），物理恢复出厂也可能因**出厂预绑定**而无效——这种
 *   设备需要厂商的出厂密钥，或让厂商关掉预绑定，App 侧无法绕过。
 * - 超时：设备没开机 / 太远 / 不在范围。
 */
async function authenticateOrGuide(client: Mr20Client): Promise<void> {
  try {
    await client.authenticate(MR20_PAIR_KEY);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (msg === 'SK_ERR') {
      throw new Error(
        '设备拒绝了密钥（SK&ERR），且对裸连只读指令也不应答 —— 它被另一把密钥绑定了。' +
          'App 的「清除配对」(BLE&RESET) 在未鉴权时会被固件忽略，长按恢复出厂也可能因出厂' +
          '预绑定而无效。请向厂商确认这台 YLF20 的出厂密钥，或让其关闭出厂预绑定。',
      );
    }
    throw new Error('设备未响应，请确认记忆粒已开机并贴近手机后重试。');
  }
}

export function Mr20Provider({children}: {children: React.ReactNode}) {
  const clientRef = useRef<Mr20Client | null>(null);

  const [screenOpen, setScreenOpen] = useState(false);
  const [connState, setConnState] = useState<Mr20ConnState>('idle');
  const [devices, setDevices] = useState<Mr20Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Mr20Device | null>(null);
  const [status, setStatus] = useState<Mr20Status>({});
  const [recording, setRecording] = useState<{fname: string; seconds: number} | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [wifiPhase, setWifiPhase] = useState<WifiPhase>('idle');
  const [wifiSteps, setWifiSteps] = useState<Record<WifiConnectStep, WifiStepState>>({
    open: 'pending',
    join: 'pending',
    reachable: 'pending',
  });
  const [wifiProgress, setWifiProgress] = useState<WifiTransferProgress | null>(null);
  const [wifiCred, setWifiCred] = useState<{ssid: string; pwd: string} | null>(null);
  const [wifiSummary, setWifiSummary] = useState<WifiTransferSummary | null>(null);
  const [deviceFiles, setDeviceFiles] = useState<Mr20DeviceFiles | null>(null);
  const [inbox, setInbox] = useState<Mr20InboxItem[]>([]);
  const [processingIds, setProcessingIds] = useState<string[]>([]);
  const [currentBatch, setCurrentBatch] = useState<Mr20BatchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [hasPaired, setHasPaired] = useState(false);

  // 批处理轮询：activeGroupRef 标记当前正在轮询的 groupId（新批次会顶掉旧的）。
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeGroupRef = useRef<string | null>(null);
  // 轮询中已增量回填过的「已完成数」；completedFiles 增长时才去拉一次 /result 逐条回填。
  const lastResultCompletedRef = useRef(0);
  // 同步中断标志：stopSync 置 true，syncAllFiles 每个文件前检查并停下。
  const syncCancelRef = useRef(false);
  // WiFi 快传中断标志 + 待传文件（手动入网后续传用）。
  const wifiCancelRef = useRef(false);
  const wifiFilesRef = useRef<Mr20File[]>([]);
  // 传输进行中标志：BLE 同步 or WiFi 快传（含连接/手动引导）期间为 true，
  // 让后台设备文件扫描（scanDeviceFiles/listAllDeviceFiles）中途让位，避免占着 BLE 让传输卡住。
  const transferActiveRef = useRef(false);
  useEffect(() => {
    transferActiveRef.current =
      syncing ||
      wifiPhase === 'connecting' ||
      wifiPhase === 'transferring' ||
      wifiPhase === 'manual';
  }, [syncing, wifiPhase]);

  // 自动重连：每个 App 会话只自动跑一次；connStateRef 供重连状态机读取实时连接态
  // （避免闭包读到旧值）。
  const reconnectStartedRef = useRef(false);
  const connStateRef = useRef(connState);
  useEffect(() => {
    connStateRef.current = connState;
  }, [connState]);

  // 懒加载 client + 绑定事件
  const getClient = useCallback((): Mr20Client => {
    if (clientRef.current) {
      return clientRef.current;
    }
    const client = new Mr20Client();
    client.on('stateChange', s => setConnState(s));
    client.on('deviceFound', d =>
      setDevices(prev => (prev.some(x => x.id === d.id) ? prev : [...prev, d])),
    );
    client.on('connected', d => setConnectedDevice(d));
    client.on('disconnected', () => {
      setConnectedDevice(null);
      setRecording(null);
    });
    client.on('status', patch => setStatus(prev => ({...prev, ...patch})));
    client.on('recording', r => setRecording(r));
    client.on('recState', r => {
      if (!r.recording) {
        setRecording(null);
      }
    });
    client.on('error', e => setError(e.message));
    client.on('log', line =>
      setLogs(prev => {
        const next = [...prev, line];
        return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
      }),
    );
    clientRef.current = client;
    return client;
  }, []);

  // 启动时检查是否已有配对设备
  useEffect(() => {
    getPairedDevice()
      .then(p => setHasPaired(!!p))
      .catch(() => undefined);
    getInbox().then(setInbox).catch(() => undefined);
    return () => {
      clientRef.current?.destroy();
      clientRef.current = null;
    };
  }, []);

  const startScan = useCallback(async () => {
    setError(null);
    setDevices([]);
    try {
      await getClient().startScan();
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
  }, [getClient]);

  const stopScan = useCallback(() => {
    clientRef.current?.stopScan();
  }, []);

  const connectAndPair = useCallback(
    async (deviceId: string, name: string) => {
      setError(null);
      const client = getClient();
      try {
        await client.connect(deviceId, name);

        // 最简连接：先**不发任何密钥**，裸连探测设备是否响应只读指令（FW）。
        // 很多固件并不强制 SK——能直接读到就免密钥用，这是最稳的连接路径，
        // 也避免把本可直接用的设备卡在 SK&ERR 上。
        const openWithoutKey = await client.probe();
        if (openWithoutKey) {
          client.markConnected(); // 免密钥直接就绪
        } else {
          // 设备对裸连静默 → 退回 SK 握手兜底。
          await authenticateOrGuide(client);
        }

        await savePairedDevice({id: deviceId, name, key: MR20_PAIR_KEY});
        setHasPaired(true);
        client.syncTime().catch(() => undefined);
      } catch (e) {
        setError(String((e as Error)?.message || e));
        // 失败收尾：断开回到可重试的扫描态，避免卡在「配对中」忙态。
        await client.disconnect().catch(() => undefined);
        throw e;
      }
    },
    [getClient],
  );

  // 强制清除配对：连上后发 BLE&RESET（恢复出厂：重置密钥 + 格式化磁盘）。
  // 用于设备被别的密钥锁住、SK&ERR 时的"软清除"。注意会清空设备录音；若固件要求
  // 鉴权后才执行，此命令可能被忽略（那就只能长按物理键恢复出厂）。
  const clearPairing = useCallback(
    async (deviceId: string, name: string) => {
      setError(null);
      const client = getClient();
      try {
        await client.connect(deviceId, name);
        await client.factoryReset(); // BLE&RESET
        await clearPairedDevice();
        setHasPaired(false);
        setError('已发送恢复出厂指令。请等设备指示灯复位（约 10 秒）后，重新点设备连接。');
      } catch (e) {
        setError(String((e as Error)?.message || e));
      } finally {
        await client.disconnect().catch(() => undefined);
      }
    },
    [getClient],
  );

  const disconnect = useCallback(async () => {
    await clientRef.current?.disconnect();
    setConnectedDevice(null);
    setRecording(null);
    setDeviceFiles(null);
  }, []);

  const refreshInbox = useCallback(async () => {
    setInbox(await getInbox());
  }, []);

  // 扫描设备当前录音（总数/待同步/字节）。仅在已连接、且没在同步时跑，
  // 避免列目录命令与同步/状态查询的命令-应答交错。
  const refreshDeviceFiles = useCallback(async () => {
    const client = clientRef.current;
    if (!client || connState !== 'connected' || syncing) {
      return;
    }
    try {
      setDeviceFiles(
        await scanDeviceFiles(client, () => transferActiveRef.current),
      );
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
  }, [connState, syncing]);

  // 同步执行体：files 为空 = 全部待同步（syncAllFiles）；否则 = 勾选的子集（syncFiles）。
  const runSync = useCallback(
    async (files?: Mr20File[]) => {
      const client = clientRef.current;
      if (!client) {
        return;
      }
      setError(null);
      syncCancelRef.current = false;
      setSyncing(true);
      setSyncProgress({total: files?.length ?? 0, completed: 0});
      try {
        // 只下载到手机并登记为「已同步·待处理」；上传 COS / 批处理由用户手动触发。
        const opts = {
          onProgress: (p: SyncProgress) => setSyncProgress(p),
          shouldCancel: () => syncCancelRef.current,
        };
        const results = files
          ? await syncFiles(client, files, opts)
          : await syncAllFiles(client, opts);
        const ok = results.filter(r => !r.error).length;
        // 立即收尾，不做昂贵的 BLE 全盘重扫：刷新收件箱 + 「待同步」数按成功数本地递减。
        refreshInbox().catch(() => undefined);
        setDeviceFiles(prev =>
          prev ? {...prev, pending: Math.max(0, prev.pending - ok)} : prev,
        );
      } catch (e) {
        setError(String((e as Error)?.message || e));
      } finally {
        setSyncing(false);
      }
    },
    [refreshInbox],
  );

  const syncNow = useCallback(() => runSync(), [runSync]);
  const syncSelected = useCallback(
    (files: Mr20File[]) => runSync(files),
    [runSync],
  );

  // 中断同步：置中断标志 + 打断正在传输的当前文件（SHUT），即时停下整批。
  // 已下好的录音保留在收件箱可直接试听；未传的下次同步自动补齐。
  const stopSync = useCallback(() => {
    syncCancelRef.current = true;
    clientRef.current?.abortTransfer().catch(() => undefined);
  }, []);

  // -------------------------------------------------------------------------
  // WiFi 快传
  // -------------------------------------------------------------------------

  // 列设备上「全部」录音文件（设备文件浏览页用，含已传输）。与 BLE 列目录同类命令，串行触发。
  const listAllDeviceFiles = useCallback(async (): Promise<Mr20File[]> => {
    const client = clientRef.current;
    if (!client || connState !== 'connected') {
      return [];
    }
    return listAllDeviceFilesSvc(client, () => transferActiveRef.current).catch(
      () => [],
    );
  }, [connState]);

  // 热点管理：开/关热点、读 SSID/密码/状态。BLE 命令串行，getHotspotInfo 顺序发。
  const openHotspot = useCallback(async () => {
    await clientRef.current?.openWifi();
  }, []);
  const closeHotspot = useCallback(async () => {
    await clientRef.current?.closeWifi();
  }, []);
  const getHotspotInfo = useCallback(async () => {
    const client = clientRef.current;
    if (!client || connState !== 'connected') {
      return null;
    }
    const state = await client.getWifiState().catch(() => 0);
    const cred = await client.getWifiCredentials().catch(() => ({ssid: '', pwd: ''}));
    return {ssid: cred.ssid, pwd: cred.pwd, state};
  }, [connState]);

  // 传输循环（连接就绪后调用）：逐个 WiFi 收流落盘 → 登记入库 → 汇总。
  const runWifiTransferLoop = useCallback(
    async (client: Mr20Client, files: Mr20File[]) => {
      setWifiPhase('transferring');
      setWifiSteps(prev => ({...prev, reachable: 'done'}));
      const results = await wifiSyncFiles(client, files, {
        onProgress: p => setWifiProgress(p),
        shouldCancel: () => wifiCancelRef.current,
      });
      const ok = results.filter(r => !r.error);
      // 全部失败（且非用户主动取消）：多半是热点已关/未连上，报错让其重来，别误显示「成功」。
      if (ok.length === 0 && results.length > 0 && !wifiCancelRef.current) {
        setError('热点已关闭或未连接，请重新点开始快传（连热点后请尽快回到 App）。');
        setWifiPhase('error');
        return;
      }
      setWifiSummary({
        count: ok.length,
        bytes: ok.reduce((n, r) => n + (r.file.size || 0), 0),
        failed: results.length - ok.length,
      });
      // 立即弹「快传成功」——不要等下面的 BLE 收尾。之前在这里 await scanDeviceFiles
      // （listDirs + 每个日期文件夹 listFiles，串行 BLE、每次超时 8s）会让进度到 100%
      // 后弹窗仍停在「正在快传」很久，是「图2 卡住/图2 后半天不出图3」的主因。
      setWifiPhase('done');
      // 完成即退设备热点（socket 已在 wifiSyncFiles 的 finally 关闭，此时退 AP 安全）：
      // iOS removeConfiguration 后系统自动回连此前记住的 WiFi，避免手机困在无网的设备
      // 热点上，也让随后走公网的 COS 上传/批处理能联网。用户点「知道了」时的 reset 再调
      // 一次是 no-op（joinedSSID 已置空）。
      disconnectWifi(client).catch(() => undefined);
      // 收尾（不阻塞成功弹窗）：刷新收件箱；「待同步」数按已成功数本地递减，
      // 跳过昂贵的 BLE 全盘重扫（下次进设备主页会自然重新统计）。
      refreshInbox().catch(() => undefined);
      setDeviceFiles(prev =>
        prev ? {...prev, pending: Math.max(0, prev.pending - ok.length)} : prev,
      );
    },
    [refreshInbox],
  );

  // 入口：开热点 → 取凭据 → 自动入网；成功直接传，失败转「引导手动连接」。
  const startWifiTransfer = useCallback(
    async (files: Mr20File[]) => {
      const client = clientRef.current;
      if (!client || !files.length) {
        return;
      }
      // 原生未更新（未 pod install + 重新编译）时，wifiJoin/wifiReceiveFile 不存在，
      // 直接调用会抛「undefined is not a function」。提前拦截给可操作提示。
      if (!isMr20WifiAvailable) {
        setError('WiFi 快传需要更新原生模块：请 cd ios && pod install 后重新编译运行 App。');
        setWifiPhase('error');
        return;
      }
      setError(null);
      wifiCancelRef.current = false;
      wifiFilesRef.current = files;
      setWifiSummary(null);
      setWifiProgress({total: files.length, completed: 0});
      setWifiSteps({open: 'pending', join: 'pending', reachable: 'pending'});
      setWifiPhase('connecting');
      try {
        const conn = await connectWifi(client, (step, state) =>
          setWifiSteps(prev => ({...prev, [step]: state})),
        );
        setWifiCred({ssid: conn.ssid, pwd: conn.pwd});
        if (!conn.joined) {
          // 自动入网被拒/失败 → 引导用户去系统设置手动连，再 continueWifiAfterManualJoin。
          setWifiPhase('manual');
          return;
        }
        await runWifiTransferLoop(client, files);
      } catch (e) {
        setError(String((e as Error)?.message || e));
        setWifiPhase('error');
      }
    },
    [runWifiTransferLoop],
  );

  // WiFi 快传「全部待同步」：先按已同步集合列出未传文件（与设备主页红点/待同步数同口径），
  // 再走 startWifiTransfer（自动开热点→入网→收流；自动入网失败由 TransferBadge 引导手动连）。
  const startWifiTransferPending = useCallback(async () => {
    const client = clientRef.current;
    if (!client || connStateRef.current !== 'connected') {
      return;
    }
    if (!isMr20WifiAvailable) {
      setError('WiFi 快传需要更新原生模块：请 cd ios && pod install 后重新编译运行 App。');
      setWifiPhase('error');
      return;
    }
    // 立即反馈：先进入「连接中」态，让 TransferBadge 立刻出现「连接设备热点…」，
    // 避免「点了 WiFi 快传后要过好几秒（BLE 列文件）才有反应」。
    setError(null);
    setWifiSummary(null);
    setWifiProgress(null);
    setWifiSteps({open: 'pending', join: 'pending', reachable: 'pending'});
    wifiCancelRef.current = false; // 清除上一次残留的取消标志
    setWifiPhase('connecting');
    let pending: Mr20File[] = [];
    try {
      pending = await listPendingFiles(client);
    } catch (e) {
      setError(String((e as Error)?.message || e));
      setWifiPhase('error');
      return;
    }
    // 列文件期间用户在浮标上点了取消 → 就此打住，别再启动传输。
    if (wifiCancelRef.current) {
      setWifiPhase('idle');
      return;
    }
    if (!pending.length) {
      setWifiPhase('idle'); // 无待同步，收起浮标
      return;
    }
    await startWifiTransfer(pending);
  }, [startWifiTransfer]);

  // 用户已手动连上热点 → 继续传输（沿用上次勾选的文件）。
  const continueWifiAfterManualJoin = useCallback(async () => {
    const client = clientRef.current;
    const files = wifiFilesRef.current;
    if (!client || !files.length) {
      return;
    }
    setError(null);
    wifiCancelRef.current = false;
    setWifiSteps(prev => ({...prev, join: 'done'}));
    try {
      await runWifiTransferLoop(client, files);
    } catch (e) {
      setError(String((e as Error)?.message || e));
      setWifiPhase('error');
    }
  }, [runWifiTransferLoop]);

  // 中断快传：置标志 + 关 socket 打断当前文件；已传完的保留在收件箱。退热点。
  const cancelWifiTransfer = useCallback(() => {
    wifiCancelRef.current = true;
    const client = clientRef.current;
    client?.abortWifi().catch(() => undefined);
    if (client) {
      disconnectWifi(client).catch(() => undefined);
    }
    setWifiPhase('idle');
  }, []);

  // 复位快传 UI 状态（关闭完成/失败页时调用）：顺手退热点释放设备电量。
  const resetWifiTransfer = useCallback(() => {
    wifiFilesRef.current = [];
    const client = clientRef.current;
    if (client) {
      disconnectWifi(client).catch(() => undefined);
    }
    setWifiPhase('idle');
    setWifiProgress(null);
    setWifiSummary(null);
    setWifiCred(null);
    setWifiSteps({open: 'pending', join: 'pending', reachable: 'pending'});
  }, []);

  // 批处理完成：拉结果，回填转写 + 总结 + 问题。
  const finishBatch = useCallback(
    async (groupId: string) => {
      try {
        const res = await getBatchResult(groupId);
        await applyBatchResult(groupId, res.results || []);
        setCurrentBatch(prev =>
          prev && prev.groupId === groupId
            ? {
                ...prev,
                status: res.status,
                completed: res.completedFiles ?? prev.completed,
                total: res.totalFiles ?? prev.total,
                summary: res.summary,
                questions: res.questions,
              }
            : prev,
        );
        await refreshInbox();
      } catch (e) {
        setError(String((e as Error)?.message || e));
      }
    },
    [refreshInbox],
  );

  // 轮询某批次进度直到终态（completed / completed_with_error），再拉结果。
  // 用 activeGroupRef 保证只有最新批次在轮询；进度查询偶发失败不中断、继续重试。
  const pollBatch = useCallback(
    (groupId: string) => {
      activeGroupRef.current = groupId;
      lastResultCompletedRef.current = 0;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      const tick = async () => {
        if (activeGroupRef.current !== groupId) {
          return; // 已被新批次顶替
        }
        try {
          const p = await getBatchProgress(groupId);
          setCurrentBatch(prev =>
            prev && prev.groupId === groupId
              ? {...prev, status: p.status, completed: p.completedFiles, total: p.totalFiles}
              : prev,
          );
          // 完成数增长 → 拉一次部分结果，逐条回填转写（未完成的条目不在列表里，applyBatchResult 会跳过）。
          // 常规 tick 只发轻量进度请求；仅在有新完成时才多发一次 /result。
          if (p.completedFiles > lastResultCompletedRef.current) {
            try {
              const res = await getBatchResult(groupId);
              if (activeGroupRef.current !== groupId) {
                return; // 拉结果期间被新批次顶替
              }
              await applyBatchResult(groupId, res.results || []);
              lastResultCompletedRef.current = p.completedFiles;
              await refreshInbox();
            } catch {
              // 结果查询失败：不推进 lastResultCompletedRef，下个 tick 再试。
            }
          }
          if (isBatchTerminal(p.status)) {
            activeGroupRef.current = null;
            await finishBatch(groupId);
            return;
          }
        } catch {
          // 进度查询失败：忽略本次，下个 tick 继续。
        }
        if (activeGroupRef.current === groupId) {
          pollTimerRef.current = setTimeout(tick, 2500);
        }
      };
      tick();
    },
    [finishBatch, refreshInbox],
  );

  // 上传一批已同步文件到 COS → 提交后端批处理 → 标记 queued → 启动轮询。
  // 单条/全部都走这里（单条 = 单元素数组）。
  const uploadAndSubmit = useCallback(
    async (items: Mr20InboxItem[]) => {
      if (!items.length) {
        return;
      }
      setError(null);
      const ids = items.map(i => i.id);
      setProcessingIds(prev => Array.from(new Set([...prev, ...ids])));
      const uploaded: Mr20InboxItem[] = [];
      const failures: string[] = [];
      try {
        for (const it of items) {
          try {
            uploaded.push(await uploadSyncedFile(it));
          } catch (e) {
            failures.push(`${it.fname}: ${String((e as Error)?.message || e)}`);
          }
          await refreshInbox();
        }
        if (!uploaded.length) {
          setError(`上传失败：${failures.join('；') || '无成功文件'}`);
          return;
        }
        const payload = uploaded.map(u => ({
          url: u.audioUrl as string,
          fileName: batchFileName(u),
          date: batchDate(u),
          durationMs: u.seconds > 0 ? Math.round(u.seconds * 1000) : undefined,
          // 已转写(重新聚合)的录音带上本地转写，后端据此跳过下载+ASR，不耗转写额度。
          transcription: u.transcript?.trim() || undefined,
        }));
        const group = await createAudioBatch(payload);
        await markItemsQueued(uploaded.map(u => u.id), group.groupId);
        await saveBatchGroupId(group.groupId);
        setCurrentBatch({
          groupId: group.groupId,
          status: group.status || 'pending',
          completed: 0,
          total: group.totalFiles || uploaded.length,
        });
        await refreshInbox();
        pollBatch(group.groupId);
      } catch (e) {
        setError(String((e as Error)?.message || e));
      } finally {
        setProcessingIds(prev => prev.filter(id => !ids.includes(id)));
      }
    },
    [refreshInbox, pollBatch],
  );

  // 单条：上传该条 + 起一个新批次。
  const processInboxItem = useCallback(
    async (item: Mr20InboxItem) => {
      await uploadAndSubmit([item]);
    },
    [uploadAndSubmit],
  );

  // 全部待处理（尚未入库、未在批处理中）→ 一次性上传并提交一个批次。
  const processAllPending = useCallback(async () => {
    const targets = (await getInbox()).filter(
      i => i.status === 'synced' || i.status === 'uploaded' || i.status === 'error',
    );
    await uploadAndSubmit(targets);
  }, [uploadAndSubmit]);

  // 删除收件箱里的录音（多选/单条都走这里）：移除条目 + 尽力删本地 MP3 文件。
  // 不动「已同步集合」，删掉的不会下次同步又被拉回来。
  const deleteItems = useCallback(async (items: Mr20InboxItem[]) => {
    if (!items.length) {
      return;
    }
    setError(null);
    try {
      const next = await removeInboxItems(items.map(i => i.id));
      setInbox(next);
      await deleteLocalFiles(items.map(i => ({dir: i.dir, fname: i.fname})));
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
  }, []);

  // 重试当前批次里失败的文件。
  const retryFailedBatch = useCallback(async () => {
    const groupId = currentBatch?.groupId;
    if (!groupId) {
      return;
    }
    setError(null);
    try {
      await retryBatch(groupId);
      pollBatch(groupId);
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
  }, [currentBatch, pollBatch]);

  // 清除本地缓存：清「已同步」集合 + 收件箱 + 批处理记录，使下次同步全量重拉。
  // 修了解码 bug 后，之前下坏的文件需要这样清掉再重新同步。
  const clearLocalCache = useCallback(async () => {
    syncCancelRef.current = true;
    activeGroupRef.current = null;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    await deleteAllLocalFiles(); // 删手机上的录音文件（原生未支持则静默跳过）
    await clearSyncedSet();
    await clearInbox();
    await clearBatchGroupId();
    setInbox([]);
    setCurrentBatch(null);
    setError(null);
  }, []);

  // 启动时若有未读完的批处理，恢复其进度/结果（杀进程重进可续看）。
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) {
      return;
    }
    restoredRef.current = true;
    getBatchGroupId()
      .then(gid => {
        if (!gid) {
          return;
        }
        return getBatchProgress(gid).then(p => {
          setCurrentBatch({
            groupId: gid,
            status: p.status,
            completed: p.completedFiles,
            total: p.totalFiles,
          });
          if (isBatchTerminal(p.status)) {
            finishBatch(gid);
          } else {
            pollBatch(gid);
          }
        });
      })
      .catch(() => undefined);
    return () => {
      activeGroupRef.current = null;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [finishBatch, pollBatch]);

  const startRecording = useCallback(async () => {
    await clientRef.current?.startRecording();
  }, []);

  const stopRecording = useCallback(async () => {
    await clientRef.current?.stopRecording();
    setRecording(null);
  }, []);

  const refreshStatus = useCallback(async () => {
    if (clientRef.current && connState === 'connected') {
      await clientRef.current.refreshStatus();
    }
  }, [connState]);

  // 自动重连上一次配对过的设备（首页无需跳设备页即可连上）。
  // 原生 connect(id) 依赖扫描到的句柄，无法免扫描直连，故走「静默扫描→匹配 saved.id→
  // connectAndPair（内部自动 stopScan）」。全程静默：失败/超时不弹错误，图标回到未连接态。
  const reconnectSaved = useCallback(async (force = false) => {
    if (!force && reconnectStartedRef.current) {
      return;
    }
    // 同步占位：自动路径每会话只跑一次，且防 StrictMode / 快速重渲染并发双跑
    // （下面有 await，若在此之后才置位会有并发窗口）。手动 force 不占位、可反复重试。
    if (!force) {
      reconnectStartedRef.current = true;
    }
    if (!isMr20NativeAvailable) {
      return; // 原生未链接（模拟器/未构建）
    }
    if (connStateRef.current !== 'idle') {
      return; // 用户已在手动扫描/连接，让位
    }
    let saved: Awaited<ReturnType<typeof getPairedDevice>>;
    try {
      saved = await getPairedDevice();
    } catch {
      return;
    }
    if (!saved?.id) {
      return; // 未配对过
    }
    let ble: string;
    try {
      ble = await Mr20Native.getBleState();
    } catch {
      return;
    }
    if (ble !== 'poweredOn') {
      return; // 蓝牙未开/未授权：自动尝试作罢，用户可用弹层「重新连接」手动重试
    }

    const client = getClient();
    const target = saved;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let off = () => {};
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      off();
    };
    off = client.on('deviceFound', d => {
      // 只认目标设备；done 保证单次触发。不读 connStateRef（React 态有滞后，
      // 可能漏掉扫描刚起就命中的快速 deviceFound）。
      if (done || d.id !== target.id) {
        return;
      }
      done = true;
      cleanup();
      // connectAndPair 内部会 stopScan + probe/authenticate + savePairedDevice。
      connectAndPair(target.id, target.name)
        .then(async () => {
          // 首页没有 HardwarePage 的「连上拉状态」effect，这里补一次。
          // 注意：不能调用 provider 的 refreshStatus/refreshDeviceFiles —— 它们在自动重连
          // 启动时（connState 还是 'idle'）被闭包捕获，内部 connState 守卫会判「未连接」而空转，
          // 导致首页电量/存储/待同步一直为空、要进设备页才刷新。故这里绕过守卫直连 client。
          const c = clientRef.current;
          if (!c) {
            return;
          }
          await c.refreshStatus().catch(() => undefined);
          try {
            setDeviceFiles(await scanDeviceFiles(c, () => transferActiveRef.current));
          } catch {
            // 静默
          }
        })
        .catch(() => setError(null)); // 静默：不在首页弹错误横幅
    });
    timer = setTimeout(() => {
      if (done) {
        return;
      }
      done = true;
      off();
      clientRef.current?.stopScan();
    }, 12000);
    try {
      await client.startScan();
    } catch {
      if (!done) {
        done = true;
        cleanup();
      }
    }
  }, [getClient, connectAndPair]);

  // 挂载后自动尝试一次重连（内部有 ref/idle/BLE 门控，重复调用安全幂等）。
  useEffect(() => {
    reconnectSaved().catch(() => undefined);
  }, [reconnectSaved]);

  // 一键校准设备时间（BLE 真实操作，连接时已自动调用一次；时间校准页手动重发）。
  const syncTime = useCallback(async () => {
    await clientRef.current?.syncTime();
  }, []);

  // 解除绑定：仅清本地配对关系 + 断开，不发 BLE&RESET（不格式化设备、不删已下载录音），
  // 符合原型「解除后已下载到手机的录音不会被删除」。设备被别的密钥锁住时另走 clearPairing。
  const forgetDevice = useCallback(async () => {
    await clearPairedDevice();
    setHasPaired(false);
    await disconnect();
  }, [disconnect]);

  const factoryReset = useCallback(async () => {
    await clientRef.current?.factoryReset().catch(() => undefined);
    await clearPairedDevice();
    setHasPaired(false);
    await disconnect();
  }, [disconnect]);

  const value: Mr20ContextType = {
    screenOpen,
    openScreen: () => setScreenOpen(true),
    closeScreen: () => setScreenOpen(false),
    connState,
    devices,
    connectedDevice,
    status,
    recording,
    syncing,
    syncProgress,
    wifiPhase,
    wifiSteps,
    wifiProgress,
    wifiCred,
    wifiSummary,
    deviceFiles,
    inbox,
    processingIds,
    currentBatch,
    error,
    logs,
    hasPaired,
    startScan,
    stopScan,
    connectAndPair,
    reconnectSaved,
    clearPairing,
    disconnect,
    syncNow,
    syncSelected,
    stopSync,
    listAllDeviceFiles,
    openHotspot,
    closeHotspot,
    getHotspotInfo,
    startWifiTransfer,
    startWifiTransferPending,
    continueWifiAfterManualJoin,
    cancelWifiTransfer,
    resetWifiTransfer,
    refreshDeviceFiles,
    processInboxItem,
    processItems: uploadAndSubmit,
    processAllPending,
    deleteItems,
    retryFailedBatch,
    clearLocalCache,
    startRecording,
    stopRecording,
    refreshStatus,
    refreshInbox,
    syncTime,
    forgetDevice,
    factoryReset,
    clearError: () => setError(null),
  };

  return <Mr20Context.Provider value={value}>{children}</Mr20Context.Provider>;
}

export const useMr20 = () => useContext(Mr20Context);
