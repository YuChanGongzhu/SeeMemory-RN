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
  Mr20Status,
} from '../native/mr20/Mr20Client';
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
  scanDeviceFiles,
  syncAllFiles,
  Mr20DeviceFiles,
  SyncProgress,
} from '../services/mr20Sync';

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
  clearPairing: (deviceId: string, name: string) => Promise<void>;
  disconnect: () => Promise<void>;
  syncNow: () => Promise<void>;
  stopSync: () => void;
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
  clearPairing: noop,
  disconnect: noop,
  syncNow: noop,
  stopSync: () => {},
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
  // 同步中断标志：stopSync 置 true，syncAllFiles 每个文件前检查并停下。
  const syncCancelRef = useRef(false);

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
      setDeviceFiles(await scanDeviceFiles(client));
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
  }, [connState, syncing]);

  const syncNow = useCallback(async () => {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    setError(null);
    syncCancelRef.current = false;
    setSyncing(true);
    setSyncProgress({total: 0, completed: 0});
    try {
      // 只下载到手机并登记为「已同步·待处理」；上传 COS / 批处理由用户手动触发。
      await syncAllFiles(client, {
        onProgress: p => setSyncProgress(p),
        shouldCancel: () => syncCancelRef.current,
      });
      await refreshInbox();
      // 重新统计设备文件，刷新「待同步」数（同步完应归零/减少）。
      setDeviceFiles(await scanDeviceFiles(client).catch(() => null));
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setSyncing(false);
    }
  }, [refreshInbox]);

  // 中断同步：置中断标志 + 打断正在传输的当前文件（SHUT），即时停下整批。
  // 已下好的录音保留在收件箱可直接试听；未传的下次同步自动补齐。
  const stopSync = useCallback(() => {
    syncCancelRef.current = true;
    clientRef.current?.abortTransfer().catch(() => undefined);
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
    [finishBatch],
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
    clearPairing,
    disconnect,
    syncNow,
    stopSync,
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
    factoryReset,
    clearError: () => setError(null),
  };

  return <Mr20Context.Provider value={value}>{children}</Mr20Context.Provider>;
}

export const useMr20 = () => useContext(Mr20Context);
