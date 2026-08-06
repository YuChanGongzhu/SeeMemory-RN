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
import {isMr20NativeAvailable, isMr20WifiAvailable} from '../native/mr20/Mr20Native';
import {MR20_KEY_LEN, isValidDeviceKey, toDeviceKey} from '../native/mr20/protocol';
import {
  runHotspotJoinTest,
  runWifiSetupDiagnostic,
  WifiDiagReport,
} from '../services/mr20WifiDiagnose';
import {
  clearBatchGroupId,
  clearPairedDevice,
  clearSyncedSet,
  clearWifiPassword,
  clearWifiProvisionedKey,
  getBatchGroupId,
  getBatchTrackingGroupIds,
  getSyncedSet,
  getPairedDevice,
  getWifiPassword,
  savePairedDevice,
  saveBatchGroupId,
  saveWifiPassword,
  saveWifiProvisionedKey,
  saveBatchTrackingGroupIds,
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
  mergeBatchProgress,
  mergeBatchResults,
  resolveBatchPollingGroupIds,
  retryBatch,
} from '../services/audioBatch';
import {
  deleteAllLocalFiles,
  deleteDeviceFiles as deleteDeviceFilesSvc,
  deleteLocalFiles,
  listAllDeviceFiles as listAllDeviceFilesSvc,
  listPendingFiles,
  scanDeviceFiles,
  syncAllFiles,
  syncFiles,
  Mr20DeviceFiles,
  SyncProgress,
  DeleteProgress,
  DeleteFileResult,
} from '../services/mr20Sync';
import {
  connectWifi,
  disconnectWifi,
  rejoinWifiWithPassword,
  wifiSyncFiles,
  WifiConnectStep,
  WifiStepState,
  WifiTransferProgress,
} from '../services/mr20WifiSync';
import {setMr20Scope} from '../services/mr20Scope';
import {useAuth} from '../auth/AuthContext';
import {useAIConsent} from '../privacy/AIConsentContext';
import {BizError} from '../apis/core/request';
import {
  bindDevice,
  listMyDevices,
  unbindDevice,
  updateDeviceKey,
  DEVICE_ALREADY_BOUND,
  DEVICE_BOUND_BY_OTHER,
  type UserDeviceVO,
} from '../apis/requests/deviceBinding';

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
  /** 实际轮询 ID：新版服务端为聚合父 ID；旧拆组服务端为全部子组 ID。 */
  pollingGroupIds?: string[];
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
  // 删除设备文件（同样独占 BLE）
  deletingDevice: boolean;
  deleteProgress: DeleteProgress | null;
  // WiFi 快传
  wifiPhase: WifiPhase;
  wifiSteps: Record<WifiConnectStep, WifiStepState>;
  wifiProgress: WifiTransferProgress | null;
  /**
   * 手动连接引导用。`pwd` 是我们实际拿去入网的那个值；`reported` 是**设备自报**的
   * （热点开启后读的 `GJJY_BLE&WIFI`）——密码本来就能从设备查出来，失败时要露给用户看的是它。
   */
  wifiCred: {ssid: string; pwd: string; reported: string} | null;
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
  // 连接成功后台后台查了一次后端绑定状态，这台设备还没绑定到当前账号——
  // 不影响已经建立的 BLE 连接，UI 拿这个提示引导用户去 WifiManage 用「重置密钥后重新配网」
  // 设置密钥；密钥设置成功（resetFirst 自检 report.ok）后会自动登记到后端，见 diagnoseWifiSetup。
  needsKeySetup: boolean;
  // 动作
  startScan: () => Promise<void>;
  stopScan: () => void;
  connectAndPair: (deviceId: string, name: string) => Promise<void>;
  // 用户不想现在设置：只清提示，不断开连接，下次重连还会再提示一次。
  cancelNewDevicePairing: () => void;
  // 空白设备首次设密钥：向后端登记这台设备并拿回它签发的密钥（不接受客户端自定义值），
  // 拿到后交给 diagnoseWifiSetup(resetFirst) 写进设备。失败返回 null，错误已写进 error。
  issueBackendKey: () => Promise<string | null>;
  // 自动/手动重连上一次配对过的设备（静默扫描→匹配 id→连接）。首页用。
  // force=true 用于用户手动「重新连接」，绕过「每会话只自动一次」的门控。
  reconnectSaved: (force?: boolean) => Promise<void>;
  clearPairing: (deviceId: string, name: string) => Promise<void>;
  disconnect: () => Promise<void>;
  syncNow: () => Promise<void>;
  // 同步勾选的设备文件子集到「我的录音」（设备文件浏览页用）。
  syncSelected: (files: Mr20File[]) => Promise<void>;
  stopSync: () => void;
  // 删除**设备上**的录音文件（腾设备空间）。注意与 deleteItems 区分：后者只删手机本地。
  // 返回逐文件结果，供调用方 splice 自己的列表并报告部分失败。
  deleteDeviceFiles: (files: Mr20File[]) => Promise<DeleteFileResult[]>;
  stopDeleteDeviceFiles: () => void;
  // 列出设备上「全部」录音文件（设备文件浏览页用，含已传输，可重传覆盖本地）。
  listAllDeviceFiles: () => Promise<Mr20File[]>;
  // WiFi 热点管理（WifiManage 页用）：开/关热点、读当前 SSID/密码/状态、改名改密。
  openHotspot: () => Promise<void>;
  closeHotspot: () => Promise<void>;
  getHotspotInfo: () => Promise<{
    ssid: string;
    pwd: string;
    state: number;
    /** 用户在 App 里设过的密码；null 表示还没设过，pwd 是设备回的值。 */
    savedPwd: string | null;
    /**
     * `pwd` 这个值是谁给的：`device` = 设备自报，`local` = 设备没回、用的手机本地兜底。
     * 两个来源可能给出同一串字符，分不清来源就分不清「设备还是出厂态」和「设备没回话」。
     */
    pwdFrom: 'device' | 'local' | null;
  } | null>;
  // 初始化/重设热点密码：SK&<8位> + WIFI&CH（无参）。热点密码就是 SK 绑定密钥。
  // 会改变设备绑定状态：设备已被别的密钥绑定时抛 SK&ERR 错误，需先 resetHotspotKey。
  initHotspotPassword: (pwd: string) => Promise<void>;
  // 只存本地（用户已知道密码时用），不下发指令、零风险。
  saveHotspotPassword: (pwd: string) => Promise<void>;
  // 重置设备绑定密钥（SK&RESET）。设备会当场断开 BLE。
  resetHotspotKey: () => Promise<void>;
  // 配网自检：按协议 0801 完整走一遍链路，逐步回调日志行。约需 1 分钟。
  // resetFirst：先发 SK&RESET 清掉旧密钥并自动重连，再走 SK → WIFI&CH（不格式化磁盘）。
  diagnoseWifiSetup: (
    key: string,
    onLine?: (line: string) => void,
    opts?: {resetFirst?: boolean},
  ) => Promise<WifiDiagReport>;
  /**
   * 只验一个密码能不能连上设备热点：开热点 → 读 WIFI → 用这个密码入网 → 建 socket。
   * **一条写指令都不发**，不改设备任何配置。约 10~30 秒。
   */
  testHotspotJoin: (
    pwd: string,
    onLine?: (line: string) => void,
  ) => Promise<WifiDiagReport>;
  // WiFi 快传：传入用户勾选的文件子集，自动走「开热点→入网→逐个收流→入库」。
  startWifiTransfer: (files: Mr20File[]) => Promise<void>;
  // WiFi 快传「全部待同步」（首页一键快传用）：内部列出未同步文件后走 startWifiTransfer。
  startWifiTransferPending: () => Promise<void>;
  // 蓝牙同步进行中，一键切到 WiFi 快传：打断 BLE，剩余未同步文件改走 WiFi（不重传已传完的）。
  switchToWifiTransfer: () => Promise<void>;
  // 自动入网失败后，用户已手动连上热点，点此继续传输。
  continueWifiAfterManualJoin: () => Promise<void>;
  /**
   * 自动入网失败时，用用户手输的热点密码重试（会先把热点重新开一遍再连）。
   * 成功则存为本地密码并接着传；失败留在 manual 态，允许当场改一位再试。
   */
  retryWifiJoinWithPassword: (pwd: string) => Promise<void>;
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
  // 读取设备当前时间（GT），返回原始 14 位串 yyyymmddhhmmss；读不到为空串。
  getDeviceTime: () => Promise<string>;
  // MCU OTA 升级：传入固件字节，流式发送并回调进度（sent/total 字节）。
  runOtaMcu: (
    bin: Uint8Array,
    onProgress?: (sent: number, total: number) => void,
  ) => Promise<void>;
  // WiFi 模组 OTA 升级。传输过程与 MCU 相同，但 onProgress 走完 100% 之后还要等
  // 模组把固件烧进去（协议 R62 第 4 步），这段没有进度、只能等，界面别按 100% 就收工。
  runOtaWifi: (
    bin: Uint8Array,
    onProgress?: (sent: number, total: number) => void,
  ) => Promise<void>;
  forgetDevice: () => Promise<void>;
  factoryReset: () => Promise<void>;
  // 解绑密钥：设备侧 SK&RESET + 后端解绑，不动本机已下载的录音/收件箱数据，也不动设备本体的录音。
  unbindKey: () => Promise<void>;
  // 解绑并格式化设备：设备侧发 BLE&RESET（恢复出厂：重置密钥+格式化磁盘，抹掉设备本体录音）
  // + 后端解绑，比 unbindKey 更彻底、不可逆。不碰手机本地已下载的录音/收件箱/批处理缓存。
  unbindAndDeleteData: () => Promise<void>;
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
  deletingDevice: false,
  deleteProgress: null,
  wifiPhase: 'idle',
  wifiSteps: {provision: 'pending', open: 'pending', join: 'pending', reachable: 'pending'},
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
  needsKeySetup: false,
  startScan: noop,
  stopScan: () => {},
  connectAndPair: noop,
  cancelNewDevicePairing: () => {},
  issueBackendKey: async () => null,
  reconnectSaved: noop,
  clearPairing: noop,
  disconnect: noop,
  syncNow: noop,
  syncSelected: noop,
  stopSync: () => {},
  deleteDeviceFiles: async () => [],
  stopDeleteDeviceFiles: () => {},
  listAllDeviceFiles: async () => [],
  openHotspot: noop,
  closeHotspot: noop,
  getHotspotInfo: async () => null,
  initHotspotPassword: noop,
  saveHotspotPassword: noop,
  resetHotspotKey: noop,
  diagnoseWifiSetup: async () => ({
    lines: [],
    verdict: '未连接设备',
    ok: false,
    ssid: '',
    pwd: '',
  }),
  testHotspotJoin: async () => ({
    lines: [],
    verdict: '未连接设备',
    ok: false,
    ssid: '',
    pwd: '',
  }),
  startWifiTransfer: noop,
  startWifiTransferPending: noop,
  switchToWifiTransfer: noop,
  continueWifiAfterManualJoin: noop,
  retryWifiJoinWithPassword: noop,
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
  getDeviceTime: async () => '',
  runOtaMcu: noop,
  runOtaWifi: noop,
  forgetDevice: noop,
  factoryReset: noop,
  unbindKey: noop,
  unbindAndDeleteData: noop,
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
/**
 * 候选密钥依次去认证——**不再兜底内置共享密钥 MR20_PAIR_KEY**。后端是密钥的唯一标准，
 * 所以候选顺序按"新鲜度"排：
 *   1. 本机已经知道这台设备是谁（`getPairedDevice().mac` 对得上）时，后端那条记录当前
 *      的 `accessKey`——这是最新值，即使密钥被别的手机改过，这里也能拿到改后的。
 *   2. 当前账号名下其它设备登记过的密钥——覆盖"换新手机/本地数据被清、不知道这是哪台
 *      设备"的场景，只能挨个试。
 *   3. 本机缓存的旧密码——**只在后端查不到（离线/未登录）时**才用得上，纯粹是兜底，
 *      不会排在后端最新值前面，避免用一个可能已经过期的本地值抢答。
 *
 * 厂商确认：这批设备出厂时蓝牙裸连（GATT）本来就不需要密钥，probe 应该直接有应答；
 * probe 失败说明这台设备已经被某把密钥"认领"过。继续拿一个 App 内置、所有设备共享的
 * 固定值去自动认证，等于自动把它也焊死在这把共享值上——这正是过去设备被"认领"成共享默认
 * 密钥的真正机制（`SK&<任意值>` 在设备当前没有密钥时会被当场原样接受），也是这条候选被
 * 从这里删掉的原因。
 *
 * 换后台候选而不是共享密钥，是因为这批候选**只来自当前登录账号自己名下的设备**，不是
 * 全 App 共享的固定值，不会把陌生设备焊死成同一把密钥。SK&ERR 是设备主动拒绝的应答
 * （不是超时），可以放心连续试下一个候选。认证成功后核对一下 MAC 是否正好对应后端那条
 * 记录，对得上才把这把密钥缓存到本机——避免"两台不同设备刚好选了同一个密码"这种小概率
 * 巧合被误当成"就是那台记录里的设备"长期记到本地。见 [[mr20-account-binding-flow]]。
 */
async function authenticateOrGuide(client: Mr20Client): Promise<void> {
  const saved = await getWifiPassword().catch(() => null);
  const pairedMac = (await getPairedDevice().catch(() => null))?.mac || null;
  let backendDevices: UserDeviceVO[] = [];
  let backendReachable = true;
  try {
    backendDevices = await listMyDevices();
  } catch {
    // 查询失败（离线/未登录）：候选只能退回本机缓存的旧密码。
    backendReachable = false;
  }
  const candidates: string[] = [];
  if (backendReachable) {
    const known = pairedMac ? backendDevices.find(d => d.uid === pairedMac) : null;
    if (known?.accessKey) {
      candidates.push(known.accessKey);
    }
    for (const d of backendDevices) {
      if (d.accessKey && !candidates.includes(d.accessKey)) {
        candidates.push(d.accessKey);
      }
    }
  }
  if (saved && !candidates.includes(saved)) {
    candidates.push(saved);
  }
  if (candidates.length === 0) {
    throw new Error(
      '设备对裸连只读指令没有应答，且本机没有保存过密钥、账号名下也没有登记过设备，无法自动重连。' +
        '如果这是你自己的设备，请到「WiFi 管理」用「重置密钥后重新配网」设置一个新密码；' +
        '如果不是，说明它已经被别的账号占用了。',
    );
  }
  for (const key of candidates) {
    try {
      await client.authenticate(key);
      const mac = await client.getMac().catch(() => '');
      const matchesBackendRecord = backendDevices.some(d => d.accessKey === key && d.uid === mac);
      if (matchesBackendRecord || key === saved) {
        await saveWifiPassword(key).catch(() => undefined);
      }
      return;
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      if (msg !== 'SK_ERR') {
        throw new Error('设备未响应，请确认记忆粒已开机并贴近手机后重试。');
      }
      // SK_ERR：设备主动拒绝，换下一个候选再试。
    }
  }
  throw new Error(
    '设备拒绝了本机保存的密钥及账号名下所有登记过的密钥（SK&ERR）—— 它现在绑的是另一把密钥。' +
      '请到「WiFi 管理」用「重置密钥后重新配网」重新设置。',
  );
}

export function Mr20Provider({children}: {children: React.ReactNode}) {
  const clientRef = useRef<Mr20Client | null>(null);
  const {requestAiConsent} = useAIConsent();

  const [screenOpen, setScreenOpen] = useState(false);
  const [connState, setConnState] = useState<Mr20ConnState>('idle');
  const [devices, setDevices] = useState<Mr20Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Mr20Device | null>(null);
  const [status, setStatus] = useState<Mr20Status>({});
  const [recording, setRecording] = useState<{fname: string; seconds: number} | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  // 删除**设备上**的录音（与 deleteItems 的「删本地」不同）：同样独占 BLE，故单独计状态。
  const [deletingDevice, setDeletingDevice] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<DeleteProgress | null>(null);
  const [wifiPhase, setWifiPhase] = useState<WifiPhase>('idle');
  const [wifiSteps, setWifiSteps] = useState<Record<WifiConnectStep, WifiStepState>>({
    provision: 'pending',
    open: 'pending',
    join: 'pending',
    reachable: 'pending',
  });
  const [wifiProgress, setWifiProgress] = useState<WifiTransferProgress | null>(null);
  const [wifiCred, setWifiCred] = useState<{
    ssid: string;
    pwd: string;
    reported: string;
  } | null>(null);
  const [wifiSummary, setWifiSummary] = useState<WifiTransferSummary | null>(null);
  const [deviceFiles, setDeviceFiles] = useState<Mr20DeviceFiles | null>(null);
  const [inbox, setInbox] = useState<Mr20InboxItem[]>([]);
  const [processingIds, setProcessingIds] = useState<string[]>([]);
  const [currentBatch, setCurrentBatch] = useState<Mr20BatchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [hasPaired, setHasPaired] = useState(false);
  const [needsKeySetup, setNeedsKeySetup] = useState(false);
  // 记「已经为这个 deviceId 查过一次后端绑定状态」，防止 connState 抖动/重渲染
  // 触发 checkDeviceBinding 的 effect 反复发请求；换一台设备/重新连接会换新 id 自然重查。
  const bindCheckedRef = useRef<string | null>(null);
  // OTA 进行中：独占 BLE，期间不刷新状态/不扫描/不自动重连（协议要求 OTA 期间禁发其他指令）。
  const [otaActive, setOtaActive] = useState(false);
  const otaActiveRef = useRef(false);
  useEffect(() => {
    otaActiveRef.current = otaActive;
  }, [otaActive]);

  // 批处理轮询：activeGroupRef 标记当前正在轮询的 groupId（新批次会顶掉旧的）。
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeGroupRef = useRef<string | null>(null);
  // 轮询中已增量回填过的「已完成数」；completedFiles 增长时才去拉一次 /result 逐条回填。
  const lastResultCompletedRef = useRef(0);
  // 同步中断标志：stopSync 置 true，syncAllFiles 每个文件前检查并停下。
  const syncCancelRef = useRef(false);
  // syncing 的实时镜像：switchToWifiTransfer 要轮询等 runSync 收尾，闭包读 React 态会拿到旧值。
  const syncingRef = useRef(false);
  useEffect(() => {
    syncingRef.current = syncing;
  }, [syncing]);
  // 设备删除中断标志 + 实时镜像（供 runSync/startWifiTransfer 读，避免闭包旧值）。
  const deleteCancelRef = useRef(false);
  const deletingDeviceRef = useRef(false);
  useEffect(() => {
    deletingDeviceRef.current = deletingDevice;
  }, [deletingDevice]);
  // WiFi 快传中断标志 + 待传文件（手动入网后续传用）。
  const wifiCancelRef = useRef(false);
  const wifiFilesRef = useRef<Mr20File[]>([]);
  // 传输进行中标志：BLE 同步 or WiFi 快传（含连接/手动引导）期间为 true，
  // 让后台设备文件扫描（scanDeviceFiles/listAllDeviceFiles）中途让位，避免占着 BLE 让传输卡住。
  const transferActiveRef = useRef(false);
  useEffect(() => {
    transferActiveRef.current =
      syncing ||
      otaActive ||
      deletingDevice ||
      wifiPhase === 'connecting' ||
      wifiPhase === 'transferring' ||
      wifiPhase === 'manual';
  }, [syncing, otaActive, deletingDevice, wifiPhase]);

  // 刚连上后的稳定期：BLE 链路建立初期不稳，立刻发列目录命令容易无应答卡死。
  // 记录连上时刻，所有文件列表读取先等满 2s 再发（已过稳定期则不等）。
  const connectedAtRef = useRef(0);
  const waitLinkSettle = useCallback(async () => {
    const remain = 2000 - (Date.now() - connectedAtRef.current);
    if (remain > 0) {
      await new Promise<void>(r => setTimeout(r, remain));
    }
  }, []);

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
    client.on('connected', d => {
      connectedAtRef.current = Date.now();
      setConnectedDevice(d);
    });
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

  // 当前登录账号 id（持久化、离线可得）——MR20 本地数据按它分区。
  const {userId} = useAuth();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  // 启动 + 账号切换时载入**本账号**的本地数据。作用域已由 AuthContext 在 hydrate/login/
  // logout 设好；这里防御性再设一次（幂等），并按新作用域重载 paired/inbox。
  useEffect(() => {
    setMr20Scope(userId);
    getPairedDevice()
      .then(p => setHasPaired(!!p))
      .catch(() => undefined);
    getInbox().then(setInbox).catch(() => undefined);
    // 真正换账号（非首次挂载）：清掉上个账号残留的批处理/处理中态，避免串号。
    if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
      setCurrentBatch(null);
      setProcessingIds([]);
    }
    prevUserIdRef.current = userId;
  }, [userId]);

  // 卸载时销毁 BLE client（仅一次，勿绑 userId——否则账号变动会误销毁连接）。
  useEffect(() => {
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

        // 记的密钥同样以用户设过的为准，不再兜底共享默认值——openWithoutKey 时设备当前
        // 确实没有生效的密钥，记一个假的 MR20_PAIR_KEY 反而是错误信息（见 authenticateOrGuide
        // 上方注释）。真没有就存空字符串，等用户走「重置密钥后重新配网」再补上真值。
        const usedKey = (await getWifiPassword().catch(() => null)) || '';
        await savePairedDevice({id: deviceId, name, key: usedKey});
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
    // 断开后清掉「已查过绑定状态」的记号——下次（哪怕是同一台设备）重连都要重新查一次，
    // 尤其是解绑之后：不清的话 bindCheckedRef 还记着旧 id，checkDeviceBinding 会误判成
    // 「查过了」直接跳过，永远不会再提示设置密钥。
    bindCheckedRef.current = null;
  }, []);

  /**
   * 连接建立**之后**才查后端绑定状态——不掺进 connectAndPair 的握手过程，连接本身完全
   * 按老路径走（探测/候选密钥，谁也不碰），避免在设备还没真正连稳时就抢发 SK 指令。
   * 未绑定才提示 needsKeySetup；已绑定或读不到 mac（极少数固件没实现 MAC 指令）就不打扰。
   */
  const checkDeviceBinding = useCallback(async (deviceId: string) => {
    if (bindCheckedRef.current === deviceId) {
      return;
    }
    bindCheckedRef.current = deviceId;
    const client = clientRef.current;
    if (!client || client.state !== 'connected') {
      return;
    }
    const mac = await client.getMac().catch(() => '');
    if (!mac) {
      return;
    }
    try {
      const mine = await listMyDevices();
      if (!mine.some(d => d.uid === mac)) {
        setNeedsKeySetup(true);
      }
    } catch {
      // 查询本身失败（网络/未登录等）不影响正常使用，安静放弃，不提示。
    }
  }, []);

  /**
   * 空白设备首次设密钥：密钥由后端签发，不再让用户在这一步自己手输——`bind()` 不带
   * `accessKey`，服务端随机生成落库并把它带回来。App 把这把密钥回显给用户，用户确认后
   * 交给 `diagnoseWifiSetup(key, ..., {resetFirst: true})` 走完整协议真正写进设备。
   * 用户事后不满意这把密钥，走「重置密钥后重新配网」输入自己想要的值即可——那条路径
   * 走完会经 `syncDeviceKey` 把新值同步回后端，不需要在这一步给"自定义密钥"开口子。
   */
  const issueBackendKey = useCallback(async (): Promise<string | null> => {
    const client = clientRef.current;
    const dev = client?.currentDevice;
    if (!client || !dev) {
      return null;
    }
    const mac = await client.getMac().catch(() => '');
    const uid = mac || dev.id;
    if (!uid) {
      return null;
    }
    try {
      const vo = await bindDevice({uid, type: 'recorder', model: 'MR20'});
      return vo.accessKey;
    } catch (e) {
      if (e instanceof BizError && e.code === DEVICE_ALREADY_BOUND) {
        // 上次生成过密钥但没走完写入这一步就退出了：查列表把同一把取回来，不重新生成，
        // 否则用户会看到"密钥变了"，且旧密钥万一已经写进设备就对不上了。
        const mine = await listMyDevices().catch(() => []);
        return mine.find(d => d.uid === uid)?.accessKey || null;
      }
      setError(
        e instanceof BizError && e.code === DEVICE_BOUND_BY_OTHER
          ? '这台设备已被其他账号绑定，请联系原机主先解绑。'
          : `向后端申请设备密钥失败（${String((e as Error)?.message || e)}），请重试`,
      );
      return null;
    }
  }, []);

  /**
   * 设备密钥已经通过 `diagnoseWifiSetup`（resetFirst）成功设置/确认之后，补一次后端登记，
   * 把 App 刚写进设备的这把 key 带上去——后端落库的就是这个值，不再是它自己随机生成的那把。
   * 不再自己发任何 BLE 指令——密钥怎么设、走不走 resetFirst，完全交给已经在真机上验证过的
   * 配网自检流程决定（用户原话："要让用户输入密码再进行完整的那个协议流程"），这里只做
   * "把已经生效的密钥记到后端" 这一件事，失败也不倒推设备侧的成功。
   */
  const registerDeviceBinding = useCallback(async (key: string) => {
    const client = clientRef.current;
    const dev = client?.currentDevice;
    if (!client || !dev) {
      return;
    }
    const mac = await client.getMac().catch(() => '');
    const uid = mac || dev.id;
    try {
      await bindDevice({uid, type: 'recorder', model: 'MR20', accessKey: key});
    } catch (e) {
      if (e instanceof BizError && e.code === DEVICE_ALREADY_BOUND) {
        // 已绑在自己名下（如上一次登记网络重试）：改成同步密钥，保证后端记的还是
        // 设备上当前真正生效的这把。
        await updateDeviceKey(uid, key).catch(() => undefined);
      } else {
        setError(
          e instanceof BizError && e.code === DEVICE_BOUND_BY_OTHER
            ? '设备密钥已设置成功，但这台设备的后端记录显示被其他账号绑定，请联系原机主处理。'
            : `设备密钥已设置成功，但后端绑定登记未同步（${String((e as Error)?.message || e)}），可稍后重试`,
        );
      }
    }
    await savePairedDevice({id: dev.id, name: dev.name, mac, key});
    setNeedsKeySetup(false);
  }, []);

  /**
   * 已绑定设备改密后同步：跟 {@link registerDeviceBinding} 是同一件"把生效密钥记到后端"的
   * 事，区别只是这台设备本来就已经绑在自己名下（不走 `bindDevice`，直接 PUT 改密接口）。
   */
  const syncDeviceKey = useCallback(async (key: string) => {
    const client = clientRef.current;
    const dev = client?.currentDevice;
    if (!client || !dev) {
      return;
    }
    const mac = await client.getMac().catch(() => '');
    const uid = mac || dev.id;
    if (!uid) {
      return;
    }
    try {
      await updateDeviceKey(uid, key);
    } catch (e) {
      setError(
        `密钥已在设备上生效，但后端记录同步失败（${String((e as Error)?.message || e)}），可稍后重试`,
      );
    }
    await savePairedDevice({id: dev.id, name: dev.name, mac, key});
  }, []);

  /** 用户暂时不想设置：只收起提示，不影响已经建立的连接；下次重连会再查一次再提示。 */
  const cancelNewDevicePairing = useCallback(() => {
    setNeedsKeySetup(false);
  }, []);

  // 连接一旦建立就顺带查一次后端绑定状态——不掺进连接过程本身，纯粹是连上之后的
  // 后台核对，查询失败/迟到都不影响已经在用的设备。
  useEffect(() => {
    if (connState !== 'connected') {
      return;
    }
    const dev = clientRef.current?.currentDevice;
    if (dev) {
      checkDeviceBinding(dev.id).catch(() => undefined);
    }
  }, [connState, checkDeviceBinding]);

  const refreshInbox = useCallback(async () => {
    setInbox(await getInbox());
  }, []);

  // 扫描设备当前录音（总数/待同步/字节）。仅在已连接、且没在同步时跑，
  // 避免列目录命令与同步/状态查询的命令-应答交错。
  const refreshDeviceFiles = useCallback(async () => {
    const client = clientRef.current;
    if (
      !client ||
      connState !== 'connected' ||
      syncing ||
      deletingDevice ||
      otaActiveRef.current
    ) {
      return;
    }
    try {
      await waitLinkSettle();
      setDeviceFiles(
        await scanDeviceFiles(client, () => transferActiveRef.current),
      );
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
  }, [connState, syncing, deletingDevice, waitLinkSettle]);

  // 同步执行体：files 为空 = 全部待同步（syncAllFiles）；否则 = 勾选的子集（syncFiles）。
  const runSync = useCallback(
    async (files?: Mr20File[]) => {
      const client = clientRef.current;
      if (!client) {
        return;
      }
      if (deletingDeviceRef.current) {
        setError('正在删除设备录音，请稍后再传输。');
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

  /**
   * 删除**设备上**的录音文件（腾设备空间），手机里已传输的录音不受影响。
   * 返回逐文件结果：调用方（设备文件页）的列表只在挂载时加载一次、之后不重拉，
   * 需要靠它 splice 本地列表并报告部分失败，故这里不返回 void。
   */
  const deleteDeviceFiles = useCallback(
    async (files: Mr20File[]): Promise<DeleteFileResult[]> => {
      const client = clientRef.current;
      if (!client || connState !== 'connected' || !files.length) {
        return [];
      }
      if (transferActiveRef.current) {
        setError('正在传输中，请等传输结束后再删除设备录音。');
        return [];
      }
      // 正在录制的那条不删：设备还在写它，固件多半回 D&ERR。提前剔除，把一个莫名失败变成 no-op。
      // （recording 只有 fname 没有 dir，只能按文件名比。）
      const targets = files.filter(f => f.fname !== recording?.fname);
      if (!targets.length) {
        return [];
      }

      setError(null);
      deleteCancelRef.current = false;
      setDeletingDevice(true);
      setDeleteProgress({total: targets.length, completed: 0});
      try {
        // 先取已同步集合：删完再取算不出哪些原本是「待同步」。
        const synced = await getSyncedSet();
        const results = await deleteDeviceFilesSvc(client, targets, {
          onProgress: p => setDeleteProgress(p),
          shouldCancel: () => deleteCancelRef.current,
        });
        const okFiles = results.filter(r => r.ok).map(r => r.file);
        const okBytes = okFiles.reduce((n, f) => n + (f.size || 0), 0);
        // 删已传输的文件只减 total/bytes，不动 pending。
        const okPending = okFiles.filter(
          f => !synced.has(`${f.dir}/${f.fname}`),
        ).length;
        // 乐观本地递减，不做昂贵的 BLE 全盘重扫（同 runSync 的收尾方式）。
        setDeviceFiles(prev =>
          prev
            ? {
                total: Math.max(0, prev.total - okFiles.length),
                pending: Math.max(0, prev.pending - okPending),
                bytes: Math.max(0, prev.bytes - okBytes),
              }
            : prev,
        );
        return results;
      } catch (e) {
        setError(String((e as Error)?.message || e));
        return [];
      } finally {
        setDeletingDevice(false);
        setDeleteProgress(null);
      }
    },
    [connState, recording],
  );

  // 中断设备删除。与 stopSync 不同，**没有 abortTransfer 的对应物**——协议无法打断已发出的
  // D 指令，所以只在下一个文件边界生效，当前这条若卡住最多再等 8s（应答超时）。
  // UI 必须等 deletingDevice 翻 false 才收状态，不能乐观提前关闭。
  const stopDeleteDeviceFiles = useCallback(() => {
    deleteCancelRef.current = true;
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
    await waitLinkSettle();
    return listAllDeviceFilesSvc(client, () => transferActiveRef.current).catch(
      () => [],
    );
  }, [connState, waitLinkSettle]);

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
    // 展示的密码以**设备自报的**为准：协议注明「PWD:WIFI 密码」。本地保存的只在设备报空时
    // 兜底——否则界面会显示一个连不上的密码，用户照着手输还是连不上。
    //
    // `pwdFrom` 不是锦上添花，是排查刚需：两个来源都可能给出同一个 `SeeMemor`
    // （设备 MCU 里存的出厂值 / 我们本地兜底的 `DEVICE_WIFI_DEFAULT_PWD`），
    // 界面上却长得一模一样。分不清来源时，「密码一直是 SeeMemor」既可能说明设备真的还是
    // 出厂状态，也可能说明设备**根本没回话**、屏幕上是我们自己填的值——两者的下一步完全不同。
    const saved = await getWifiPassword().catch(() => null);
    return {
      ssid: cred.ssid,
      pwd: cred.pwd || saved || '',
      state,
      savedPwd: saved,
      pwdFrom: cred.pwd ? ('device' as const) : saved ? ('local' as const) : null,
    };
  }, [connState]);

  /**
   * 初始化/重设热点密码：`SK&<8位>` → `WIFI&CH`（无参）→ 轮询 WIFIS 到 6。
   * 无论确认与否都把密码存本地——密钥在 SK&OK 那刻就已经写进设备了，丢了反而再也连不上。
   */
  const initHotspotPassword = useCallback(
    async (pwd: string) => {
      const client = clientRef.current;
      if (!client || connState !== 'connected') {
        throw new Error('请先连接设备蓝牙');
      }
      try {
        const applied = await client.initWifiPassword(pwd);
        await saveWifiPassword(applied);
        // 这一次就是完整的 SK + WIFI&CH，记下来，快传主路径不必再跑一遍（要 10s）。
        await saveWifiProvisionedKey(applied).catch(() => undefined);
      } catch (e) {
        // 「已设置但未确认」这条错误里密钥其实已生效，必须存下来；SK&ERR / 格式错则没动过设备。
        // 但**不记「已初始化」**：没看到 4/6 就等于没有证据说明密码真刷进了 WiFi 模组，
        // 让快传主路径再跑一次 WIFI&CH 才是对的。
        const msg = String((e as Error)?.message || e);
        if (msg.includes('密钥已设置成功')) {
          await saveWifiPassword(toDeviceKey(pwd)).catch(() => undefined);
        }
        throw e;
      }
    },
    [connState],
  );

  /** 只改本地保存的密码（用户已知道热点密码时用），不下发任何指令、零风险。 */
  const saveHotspotPassword = useCallback(async (pwd: string) => {
    await saveWifiPassword(pwd);
  }, []);

  /** 重置设备绑定密钥（SK&RESET）。设备会当场断开 BLE，本地保存的密码也一并清掉。 */
  const resetHotspotKey = useCallback(async () => {
    const client = clientRef.current;
    if (!client || connState !== 'connected') {
      throw new Error('请先连接设备蓝牙');
    }
    await client.resetDeviceKey();
    await clearWifiPassword().catch(() => undefined);
    // 密钥都解绑了，「已完成配网初始化」自然作废——留着会让下次快传跳过 SK+WIFI&CH。
    await clearWifiProvisionedKey().catch(() => undefined);
  }, [connState]);

  /**
   * 配网自检：按协议完整走一遍并逐行回调日志，见 services/mr20WifiDiagnose。
   * `opts.resetFirst` 会在最前面加一步 `SK&RESET`（重置绑定密钥 + 自动重连），
   * 之后照旧 SK → WIFI&CH。**只重置密钥，不格式化磁盘**。
   */
  const diagnoseWifiSetup = useCallback(
    async (
      key: string,
      onLine?: (line: string) => void,
      opts: {resetFirst?: boolean} = {},
    ) => {
      const client = clientRef.current;
      if (!client || connState !== 'connected') {
        throw new Error('请先连接设备蓝牙');
      }
      if (opts.resetFirst) {
        // 只作废「已完成初始化」标记，**不清本地密码**。
        //
        // 一度在这里把 wifiPwd 也清了，理由是「密钥都重置了，旧密码没意义」。那会开出一个
        // 能把设备锁死的窗口：SK 把新密钥写进去了、WIFI&CH 那步却失败提前 return，此时设备
        // 上有一把密钥而手机上一个都没有 —— authenticateOrGuide 不再兜底任何共享默认密钥
        // （见其函数注释），本机没存密码就直接判定「无法自动重连」，用户会被卡在门外。
        // 旧密码留着最多是多试一个候选，代价小得多。
        await clearWifiProvisionedKey().catch(() => undefined);
      }
      const report = await runWifiSetupDiagnostic(client, key, onLine, opts);
      // 自检确认密钥真的生效了（WIFIS 走到过 6，report.ok）才同步后端，不追加任何新的
      // BLE 指令，纯粹是自检成功之后的收尾：
      // - needsKeySetup：这台设备之前后端核对是「未绑定」的，首次登记。
      // - 否则只有 resetFirst（真的重置改密了）才同步新密钥；不带 resetFirst 的自检只是
      //   验证已有密钥能不能用，没有变化，不用碰后端。
      if (report.ok) {
        const finalKey = report.pwd || key;
        if (needsKeySetup) {
          await registerDeviceBinding(finalKey).catch(() => undefined);
        } else if (opts.resetFirst) {
          await syncDeviceKey(finalKey).catch(() => undefined);
        }
      }
      return report;
    },
    [connState, needsKeySetup, registerDeviceBinding, syncDeviceKey],
  );

  /**
   * 单点验证一个密码。和 {@link diagnoseWifiSetup} 的区别是**只读**：不发 SK、不发 WIFI&CH，
   * 不动设备上的任何配置，所以随便跑多少次都没有副作用。
   */
  const testHotspotJoin = useCallback(
    async (pwd: string, onLine?: (line: string) => void) => {
      const client = clientRef.current;
      if (!client || connState !== 'connected') {
        throw new Error('请先连接设备蓝牙');
      }
      return runHotspotJoinTest(client, pwd.trim(), onLine);
    },
    [connState],
  );

  // 传输循环（连接就绪后调用）：逐个 WiFi 收流落盘 → 登记入库 → 汇总。
  // apReadyAt = 热点就绪时刻（connectWifi 返回）；wifiSyncFiles 据此判断建连失败是不是
  // 撞上协议的 30s 空闲自动关，是就重发 WIFIO 起新一轮而不是白白重连。
  const runWifiTransferLoop = useCallback(
    async (
      client: Mr20Client,
      files: Mr20File[],
      apReadyAt?: number,
      credentials?: {ssid: string; pwd: string},
    ) => {
      setWifiPhase('transferring');
      setWifiSteps(prev => ({...prev, reachable: 'done'}));
      const results = await wifiSyncFiles(client, files, {
        onProgress: p => setWifiProgress(p),
        shouldCancel: () => wifiCancelRef.current,
        apReadyAt,
        credentials,
      });
      const ok = results.filter(r => !r.error);
      // 全部失败（且非用户主动取消）：多半是热点已关/未连上，报错让其重来，别误显示「成功」。
      if (ok.length === 0 && results.length > 0 && !wifiCancelRef.current) {
        setError('热点已关闭或未连接，请重新点开始快传（连热点后请尽快回到 App）。');
        setWifiPhase('error');
        // 失败也要退热点：否则手机一直挂在没有外网的设备 AP 上，用户既上不了网、
        // 也没法重试上传（COS 走公网）。之前只在成功路径退，是「传完还连着设备 WiFi」的一个来源。
        disconnectWifi(client).catch(() => undefined);
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
      if (deletingDeviceRef.current) {
        setError('正在删除设备录音，请稍后再传输。');
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
      setWifiSteps({provision: 'pending', open: 'pending', join: 'pending', reachable: 'pending'});
      setWifiPhase('connecting');
      try {
        const conn = await connectWifi(client, (step, state) =>
          setWifiSteps(prev => ({...prev, [step]: state})),
        );
        setWifiCred({ssid: conn.ssid, pwd: conn.pwd, reported: conn.reported});
        if (!conn.joined) {
          // 自动入网被拒/失败 → 引导用户去系统设置手动连，再 continueWifiAfterManualJoin。
          setWifiPhase('manual');
          return;
        }
        await runWifiTransferLoop(client, files, conn.apReadyAt, {
          ssid: conn.ssid,
          pwd: conn.pwd,
        });
      } catch (e) {
        setError(String((e as Error)?.message || e));
        setWifiPhase('error');
        // 连接/传输抛错同样退热点，别把手机留在设备 AP 上。
        disconnectWifi(client).catch(() => undefined);
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
    setWifiSteps({provision: 'pending', open: 'pending', join: 'pending', reachable: 'pending'});
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

  /**
   * 传输中途把「蓝牙同步」切成「WiFi 快传」：打断 BLE → 等它收尾 → 剩余未同步文件改走 WiFi。
   * 已下好的文件此时已进「已同步集合」，listPendingFiles 会跳过，不会重传。
   *
   * 不只是为了快：BLE 文件流与实时录音流共用 a1 特征值，设备边录边传会污染文件流导致
   * 传输永久卡死（进度条满格但 OFF 不来）。此时 WiFi（字节走 TCP）是唯一的自救路径。
   */
  const switchToWifiTransfer = useCallback(async () => {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    if (!isMr20WifiAvailable) {
      setError('WiFi 快传需要更新原生模块：请 cd ios && pod install 后重新编译运行 App。');
      return;
    }
    // 1) 打断当前 BLE 传输（同 stopSync：置中断标志 + SHUT 打断在传的那条）。
    syncCancelRef.current = true;
    await client.abortTransfer().catch(() => undefined);
    // 2) 等 runSync 的 finally 落下 syncing。BLE 命令必须串行——抢跑会让 WiFi 流程的
    //    列目录命令与同步的收尾应答交错，两边都可能卡住。最多等 10s。
    for (let i = 0; i < 50 && syncingRef.current; i += 1) {
      await new Promise<void>(resolve => setTimeout(resolve, 200));
    }
    if (syncingRef.current) {
      setError('蓝牙传输未能及时停止，请先取消传输后再用 WiFi 快传。');
      return;
    }
    // 3) 剩余未同步文件走 WiFi（内部自己开热点→入网→收流，失败会引导手动连）。
    await startWifiTransferPending();
  }, [startWifiTransferPending]);

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
      // 手动连接路径：用户去系统设置连热点这段时间基本必然超过协议的 30s 空闲窗口，
      // 设备很可能已经把 AP 自动关了。传 0（视为已过期）让首次建连失败时直接重发 WIFIO
      // 起新一轮，而不是对着已关闭的热点重连三次然后报「传输失败」。
      await runWifiTransferLoop(client, files, 0);
    } catch (e) {
      setError(String((e as Error)?.message || e));
      setWifiPhase('error');
      disconnectWifi(client).catch(() => undefined);
    }
  }, [runWifiTransferLoop]);

  /**
   * 用**用户手输的密码**重试入网，成功就直接接着传。
   *
   * 自动入网的候选密码只有三个来源（设备自报 / 本地存过 / 出厂默认），设备上的真实密码不在
   * 其中时，自动这条路重试多少次都是同一批错密码。把输入框摆在失败现场，比让用户跑一趟
   * 系统设置强得多——去系统设置那一趟本身还必然超出协议的 30s 窗口。
   */
  const retryWifiJoinWithPassword = useCallback(
    async (input: string) => {
      const client = clientRef.current;
      const files = wifiFilesRef.current;
      const ssid = wifiCred?.ssid;
      if (!client || !files.length || !ssid) {
        return;
      }
      // **这里故意不套 isValidDeviceKey / toDeviceKey。**
      //
      // 那两个管的是「SK 绑定密钥必须是 8 位」，是我们对设备的假设；而走到手输这一步，
      // 恰恰说明这个假设在这台设备上不成立（自动候选全是按它推出来的，全错）。escape hatch
      // 还按同一个假设卡格式，就不成其为 escape hatch 了。
      //
      // 这个值直接交给 iOS 的 NEHotspotConfiguration，所以只按 WPA2 自己的规矩验：8~63 位。
      const key = input.trim();
      if (key.length < 8 || key.length > 63) {
        setError('WiFi 密码需要 8~63 位（WPA2 的规定）。');
        return;
      }
      if (!isValidDeviceKey(key)) {
        // 不拦，只记一笔：和协议说的「${MR20_KEY_LEN} 位」不一样时，值得在日志里留个痕迹。
        client.log(
          `[wifi] 手输密码长度 ${key.length}，与协议说的 ${MR20_KEY_LEN} 位不符——照样试`,
        );
      }
      setError(null);
      wifiCancelRef.current = false;
      setWifiPhase('connecting');
      setWifiSteps(prev => ({...prev, open: 'active', join: 'active'}));
      try {
        const r = await rejoinWifiWithPassword(client, ssid, key);
        setWifiCred({ssid, pwd: key, reported: wifiCred?.reported ?? ''});
        if (!r.joined) {
          // 回到手动页而不是错误页：用户多半只是输错了一位，应该能当场再试一次。
          setWifiSteps(prev => ({...prev, open: 'done', join: 'failed'}));
          setError(`用密码「${key}」还是连不上热点 ${ssid}，请确认密码后再试一次。`);
          setWifiPhase('manual');
          return;
        }
        setWifiSteps(prev => ({...prev, open: 'done', join: 'done'}));
        await runWifiTransferLoop(client, files, r.apReadyAt, {ssid, pwd: key});
      } catch (e) {
        setError(String((e as Error)?.message || e));
        setWifiPhase('error');
        disconnectWifi(client).catch(() => undefined);
      }
    },
    [runWifiTransferLoop, wifiCred],
  );

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
    setWifiSteps({provision: 'pending', open: 'pending', join: 'pending', reachable: 'pending'});
  }, []);

  const loadBatchProgress = useCallback(
    async (groupId: string, pollingGroupIds: string[]) => {
      const groups = await Promise.all(
        pollingGroupIds.map(id => getBatchProgress(id)),
      );
      return mergeBatchProgress(groupId, groups);
    },
    [],
  );

  const loadBatchResult = useCallback(
    async (groupId: string, pollingGroupIds: string[]) => {
      const groups = await Promise.all(
        pollingGroupIds.map(id => getBatchResult(id)),
      );
      return mergeBatchResults(groupId, groups);
    },
    [],
  );

  // 批处理完成：拉聚合父组或全部旧版子组结果，回填转写 + 总结 + 问题。
  const finishBatch = useCallback(
    async (groupId: string, pollingGroupIds: string[]) => {
      try {
        const res = await loadBatchResult(groupId, pollingGroupIds);
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
    [loadBatchResult, refreshInbox],
  );

  // 轮询聚合父组；若接入旧拆组 manager-api，则遍历所有子组后在本地合并。
  // 用 activeGroupRef 保证只有最新批次在轮询；进度查询偶发失败不中断、继续重试。
  const pollBatch = useCallback(
    (groupId: string, pollingGroupIds: string[]) => {
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
          const p = await loadBatchProgress(groupId, pollingGroupIds);
          setCurrentBatch(prev =>
            prev && prev.groupId === groupId
              ? {...prev, status: p.status, completed: p.completedFiles, total: p.totalFiles}
              : prev,
          );
          // 完成数增长 → 拉一次部分结果，逐条回填转写（未完成的条目不在列表里，applyBatchResult 会跳过）。
          // 常规 tick 只发轻量进度请求；仅在有新完成时才多发一次 /result。
          if (p.completedFiles > lastResultCompletedRef.current) {
            try {
              const res = await loadBatchResult(groupId, pollingGroupIds);
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
            await finishBatch(groupId, pollingGroupIds);
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
    [finishBatch, loadBatchProgress, loadBatchResult, refreshInbox],
  );

  // 上传一批已同步文件到 COS → 提交后端批处理 → 标记 queued → 启动轮询。
  // 单条/全部都走这里（单条 = 单元素数组）。
  const uploadAndSubmit = useCallback(
    async (items: Mr20InboxItem[]) => {
      if (!items.length) {
        return;
      }
      const allowed = await requestAiConsent({
        data: `${items.length} 条设备录音及其已有转写文本`,
        purpose: '上传录音并进行语音转写、场景总结和问题生成',
      });
      if (!allowed) {
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
        const pollingGroupIds = resolveBatchPollingGroupIds(group);
        await markItemsQueued(uploaded.map(u => u.id), group.groupId);
        await Promise.all([
          saveBatchGroupId(group.groupId),
          saveBatchTrackingGroupIds(group.groupId, pollingGroupIds),
        ]);
        setCurrentBatch({
          groupId: group.groupId,
          pollingGroupIds,
          status: group.status || 'pending',
          completed: 0,
          total: group.totalFiles || uploaded.length,
        });
        await refreshInbox();
        pollBatch(group.groupId, pollingGroupIds);
      } catch (e) {
        setError(String((e as Error)?.message || e));
      } finally {
        setProcessingIds(prev => prev.filter(id => !ids.includes(id)));
      }
    },
    [refreshInbox, pollBatch, requestAiConsent],
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
    const pollingGroupIds = currentBatch.pollingGroupIds?.length
      ? currentBatch.pollingGroupIds
      : [groupId];
    setError(null);
    try {
      await Promise.all(pollingGroupIds.map(id => retryBatch(id)));
      pollBatch(groupId, pollingGroupIds);
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
  }, [currentBatch, pollBatch]);

  // 清除本地缓存：清「已同步」集合 + 收件箱 + 批处理记录，使下次同步全量重拉。
  // 修了解码 bug 后，之前下坏的文件需要这样清掉再重新同步。
  // ⚠️ 对已用 deleteDeviceFiles 从设备删掉的录音，这一步是**不可逆**的——设备上已无副本可重拉。
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
      .then(async gid => {
        if (!gid) {
          return;
        }
        const pollingGroupIds = await getBatchTrackingGroupIds(gid);
        const p = await loadBatchProgress(gid, pollingGroupIds);
        setCurrentBatch({
          groupId: gid,
          pollingGroupIds,
          status: p.status,
          completed: p.completedFiles,
          total: p.totalFiles,
        });
        if (isBatchTerminal(p.status)) {
          finishBatch(gid, pollingGroupIds);
        } else {
          pollBatch(gid, pollingGroupIds);
        }
      })
      .catch(() => undefined);
    return () => {
      activeGroupRef.current = null;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [finishBatch, loadBatchProgress, pollBatch]);

  const startRecording = useCallback(async () => {
    await clientRef.current?.startRecording();
  }, []);

  const stopRecording = useCallback(async () => {
    await clientRef.current?.stopRecording();
    setRecording(null);
  }, []);

  const refreshStatus = useCallback(async () => {
    if (clientRef.current && connState === 'connected' && !otaActiveRef.current) {
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
    // 因「暂时性」原因放弃时要把占位还回去，否则烧掉了本会话唯一一次自动重连机会。
    const releaseLatch = () => {
      if (!force) {
        reconnectStartedRef.current = false;
      }
    };
    if (!isMr20NativeAvailable) {
      return; // 原生未链接（模拟器/未构建）：本会话不可能好转，保持占位
    }
    if (connStateRef.current !== 'idle' && connStateRef.current !== 'disconnected') {
      releaseLatch();
      return; // 用户已在手动扫描/连接，让位（其手动流程失败回 idle 后仍可自动重试）
    }
    let saved: Awaited<ReturnType<typeof getPairedDevice>>;
    try {
      saved = await getPairedDevice();
    } catch {
      releaseLatch(); // 读盘偶发失败，不该赔上整个会话
      return;
    }
    if (!saved?.id) {
      return; // 未配对过：保持占位
    }
    // 冷启动时 CoreBluetooth 先报 unknown，几百毫秒后才转 poweredOn。这里必须**等**而不是
    // 立刻放弃——早先直接读 getBleState() 撞上 unknown 就 return，而占位已置，导致整个 App
    // 会话再也不自动重连（表现为设备明明就在旁边、手动扫得到 -55dBm，弹层却说「不在附近，
    // 或蓝牙未开启」）。ensurePoweredOn 会监听 onBleState 等到就绪（最多 6s）。
    try {
      await getClient().ensurePoweredOn();
    } catch {
      releaseLatch(); // 蓝牙真的关着/未授权：用户开了之后还能再自动试
      return;
    }
    // 等待期间用户可能自己发起了扫描/连接，重新让位。
    if (connStateRef.current !== 'idle' && connStateRef.current !== 'disconnected') {
      releaseLatch();
      return;
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
          // 刚连上时链路还不稳，立刻发列目录命令容易无应答卡死：等满稳定期再发。
          await waitLinkSettle();
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
  }, [getClient, connectAndPair, waitLinkSettle]);

  // 挂载后自动尝试一次重连（内部有 ref/idle/BLE 门控，重复调用安全幂等）。
  useEffect(() => {
    reconnectSaved().catch(() => undefined);
  }, [reconnectSaved]);

  // 一键校准设备时间（BLE 真实操作，连接时已自动调用一次；时间校准页手动重发）。
  const syncTime = useCallback(async () => {
    await clientRef.current?.syncTime();
  }, []);

  // 读取设备当前时间（GT）；未连接/读不到返回空串，交 UI 兜底。
  const getDeviceTime = useCallback(async (): Promise<string> => {
    const client = clientRef.current;
    if (!client || connState !== 'connected') {
      return '';
    }
    return client.getTime().catch(() => '');
  }, [connState]);

  // MCU OTA：置 otaActive 独占 BLE（暂停状态刷新/扫描/重连）→ 流式发送固件 → 收尾。
  // 成功后设备复位断连，随后自动重连的 connect-effect 会回读新 FW 版本。
  const runOtaMcu = useCallback(
    async (
      bin: Uint8Array,
      onProgress?: (sent: number, total: number) => void,
    ) => {
      const client = clientRef.current;
      if (!client || connState !== 'connected') {
        throw new Error('请先连接设备');
      }
      setError(null);
      setOtaActive(true);
      try {
        // 帧周期不再由界面传：固定 20ms（帧首到帧首）由原生定时器保证，
        // 见 Mr20Client.otaUpdateMcu 的 frameIntervalMs 默认值。
        await client.otaUpdateMcu(bin, {onProgress});
      } finally {
        setOtaActive(false);
      }
    },
    [connState],
  );

  // WiFi 模组 OTA。与 runOtaMcu 同样独占 BLE，只是最后多一段「等模组烧写」——
  // 那段没有进度回调，otaActive 必须一直保持到它结束，否则状态轮询会插进去发指令，
  // 而协议明确「OTA 过程中禁止 APP 发送其他指令，否则会 OTA 失败」。
  const runOtaWifi = useCallback(
    async (
      bin: Uint8Array,
      onProgress?: (sent: number, total: number) => void,
    ) => {
      const client = clientRef.current;
      if (!client || connState !== 'connected') {
        throw new Error('请先连接设备');
      }
      setError(null);
      setOtaActive(true);
      try {
        await client.otaUpdateWifi(bin, {onProgress});
      } finally {
        setOtaActive(false);
      }
    },
    [connState],
  );

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

  /**
   * 解绑密钥：设备侧 `SK&RESET`（清掉设备上的绑定密钥，当场断开 BLE）+ 后端软删绑定关系。
   * 不清本机已下载的录音/收件箱数据。`disconnect()` 里会清掉 `bindCheckedRef`，所以下次
   * 任何人（含本人）重连这台设备，`checkDeviceBinding` 都会重新查一次后端、重新提示设置密钥。
   */
  const unbindKey = useCallback(async () => {
    const client = clientRef.current;
    if (!client || connState !== 'connected') {
      throw new Error('请先连接设备蓝牙');
    }
    setError(null);
    const paired = await getPairedDevice();
    const uid = paired?.mac || status.mac || paired?.id || '';
    // 写指令本身失败（如链路当场断了）就不清本地状态——不确定设备上的密钥有没有真的被清掉，
    // 留着本地记录至少还能按老密钥重连一次重试，比留一个「本机以为没配对、设备却还锁着」的
    // 假态更安全。
    await client.resetDeviceKey();
    await clearWifiPassword().catch(() => undefined);
    await clearWifiProvisionedKey().catch(() => undefined);
    await clearPairedDevice();
    setHasPaired(false);
    await disconnect();
    if (uid) {
      // 设备侧已经清掉了，后端软删失败不该把用户卡住——记错误，用户可再解绑一次重试
      // （UserDeviceManager.unbind 按 uid 查当前有效行，天然幂等）。
      await unbindDevice(uid).catch(e => {
        setError(`设备密钥已清除，但后端解绑记录未同步（${String((e as Error)?.message || e)}），可稍后重试`);
      });
    }
  }, [connState, status, disconnect]);

  /**
   * 解绑并格式化设备：设备侧发 `BLE&RESET`（恢复出厂：重置密钥 + 格式化磁盘，抹掉设备本体的
   * 全部录音）+ 后端软删绑定关系。不可逆。
   *
   * ⚠️ **只清设备和账号的绑定关系，不碰手机本地已下载的录音/收件箱/批处理缓存**——这条命令
   * 的操作对象是设备本身，不是手机；本机文件删不删是使用者自己的选择，不该被这条命令顺手
   * 带走（早先版本把 `clearLocalCache()` 塞在这里一起清，被指出是错的，已去掉）。真要清本机
   * 缓存得用别的入口。
   *
   * 跟 `unbindKey`（只发 `SK&RESET`，只清密钥不动录音）刻意分成两档：普通「解绑密钥」用于
   * 转手给别人但设备录音还想留着的场景，这条「解绑并格式化设备」才是真正要把设备本体录音
   * 清空的场景，对应 More 菜单里两个不同二次确认按钮的措辞。
   *
   * `BLE&RESET` 本身就会重置密钥（协议：恢复出厂=重置密钥+格式化磁盘，见 `clearPairing`
   * 里同一条命令的注释），所以这里不用再叠发一次 `SK&RESET`——两条都会让设备当场断链，
   * 叠着发只是无意义的双重断链。当前连接已经是鉴权过的（`connState==='connected'`），
   * 不是 `clearPairing` 应对的「被别的密钥锁住」的裸连场景，直接发就行，不用先探测。
   */
  const unbindAndDeleteData = useCallback(async () => {
    const client = clientRef.current;
    if (!client || connState !== 'connected') {
      throw new Error('请先连接设备蓝牙');
    }
    setError(null);
    const paired = await getPairedDevice();
    const uid = paired?.mac || status.mac || paired?.id || '';
    await client.factoryReset().catch(() => undefined); // BLE&RESET：重置密钥 + 格式化磁盘
    await clearWifiPassword().catch(() => undefined);
    await clearWifiProvisionedKey().catch(() => undefined);
    await clearPairedDevice();
    setHasPaired(false);
    await disconnect();
    if (uid) {
      await unbindDevice(uid).catch(e => {
        setError(`设备已格式化，但后端解绑记录未同步（${String((e as Error)?.message || e)}），可稍后重试`);
      });
    }
  }, [connState, status, disconnect]);

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
    deletingDevice,
    deleteProgress,
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
    needsKeySetup,
    startScan,
    stopScan,
    connectAndPair,
    cancelNewDevicePairing,
    issueBackendKey,
    reconnectSaved,
    clearPairing,
    disconnect,
    syncNow,
    syncSelected,
    stopSync,
    deleteDeviceFiles,
    stopDeleteDeviceFiles,
    listAllDeviceFiles,
    openHotspot,
    closeHotspot,
    getHotspotInfo,
    initHotspotPassword,
    saveHotspotPassword,
    resetHotspotKey,
    diagnoseWifiSetup,
    testHotspotJoin,
    startWifiTransfer,
    startWifiTransferPending,
    switchToWifiTransfer,
    continueWifiAfterManualJoin,
    retryWifiJoinWithPassword,
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
    getDeviceTime,
    runOtaMcu,
    runOtaWifi,
    forgetDevice,
    factoryReset,
    unbindKey,
    unbindAndDeleteData,
    clearError: () => setError(null),
  };

  return <Mr20Context.Provider value={value}>{children}</Mr20Context.Provider>;
}

export const useMr20 = () => useContext(Mr20Context);
