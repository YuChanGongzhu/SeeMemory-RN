/**
 * MR20 WiFi 快传编排：控制信令走 BLE，文件字节走 WiFi TCP（192.168.200.1:8475）。
 *
 * 与 mr20Sync（BLE）同构，但「下载」这一段换成 WiFi 长连接：先程序化加入设备热点，
 * 再建**一条** TCP 长连接、逐个文件在同一 socket 上收流落盘（wifiOpenShared/wifiReceiveShared/
 * wifiCloseShared），消除逐条重连空档。落盘后复用既有 markSynced / recordSyncedFile 入库管线。
 *
 * 连接阶段（开热点→取凭据→入网）单独抽出，方便 UI 的「连接中」清单逐步打勾；
 * 自动入网失败时上层可降级到「引导手动连接」，再调 wifiSyncFiles 续传。
 */
import {Mr20Client, Mr20File} from '../native/mr20/Mr20Client';
import {Mr20Native} from '../native/mr20/Mr20Native';
import {MR20_PAIR_KEY, toDeviceKey} from '../native/mr20/protocol';
import {
  clearWifiProvisionedKey,
  getWifiPassword,
  getWifiProvisionedKey,
  markSynced,
  saveWifiPassword,
  saveWifiProvisionedKey,
} from './mr20Storage';
import {recordSyncedFile, Mr20InboxItem} from './mr20Ingest';
import {mr20FileRelPath} from './mr20Sync';

/** 设备热点固定网关与快传端口（见 MR20通信协议）。 */
export const DEVICE_WIFI_HOST = '192.168.200.1';
export const DEVICE_WIFI_PORT = 8475;
/**
 * 设备热点默认密码。**所有出厂设备都是这个值**（2026-08-03 确认）。
 *
 * 它不是随便挑的常量，而是 {@link MR20_PAIR_KEY} 的前 8 位——因为「热点密码 == SK 绑定密钥前
 * 8 位」（协议推导 + 真机 `GJJY_DEV&WIFI&YLF20_f006c25b&SeeMemor` 证实），而设备出厂即绑定在
 * 本 App 这把密钥上。所以这里**用 toDeviceKey 现算而不是写死字面量**：万一哪天改了
 * MR20_PAIR_KEY，两边不会悄悄走偏成两个值。
 *
 * 历史：曾误以为默认值是协议早期文档里的 `12345678`，把它排在入网候选第一位，
 * 结果每次都先用错密码撞一次 iOS 的「无法加入网络」模态框，白烧掉 30s 窗口的一大截。
 */
export const DEVICE_WIFI_DEFAULT_PWD = toDeviceKey(MR20_PAIR_KEY);
/**
 * 协议 0801：「WiFi 开启后，30 秒内没有设备连接将自动关闭」。入网 + 建 socket 必须挤进这个窗口，
 * 超了就得重新 WIFIO 起一轮，而不是对着已经关掉的热点反复重连。
 */
export const AP_IDLE_WINDOW_MS = 30000;
/** 入网（NEHotspotConfiguration 关联）超时。留足给系统弹确认框 + 用户点「加入」。 */
const WIFI_JOIN_TIMEOUT_MS = 20000;

/** 连接阶段步骤，用于 UI「连接中」清单逐步打勾。 */
export type WifiConnectStep = 'provision' | 'open' | 'join' | 'reachable';
export type WifiStepState = 'pending' | 'active' | 'done' | 'failed';

export interface WifiConnectResult {
  ssid: string;
  pwd: string;
  host: string;
  port: number;
  /** true=程序化自动入网成功；false=需降级到引导手动连接。 */
  joined: boolean;
  /** AP 就绪（WIFIS 到 1/2）的时刻；协议的 30s 空闲自动关窗口从此刻开始计。 */
  apReadyAt: number;
  /**
   * 设备通过 `GJJY_BLE&WIFI` **自报**的热点密码，且是**热点起来之后**读的那一份。
   *
   * 单独返回而不是并进 `pwd`：`pwd` 是我们最后实际拿去入网的那个值（候选里挑的），
   * 两者可能不同。入网失败时要给用户看的恰恰是这一个——密码本来就能从设备查出来，
   * 没有理由让他去猜、去问固件方。
   */
  reported: string;
}

export interface WifiTransferProgress {
  total: number; // 本次快传文件总数
  completed: number; // 已完成
  current?: {dir: string; fname: string; received: number; size: number};
}

export interface WifiSyncResult {
  file: Mr20File;
  localPath: string;
  ingest?: Mr20InboxItem;
  error?: string;
}

/**
 * 连接阶段，对应协议 0801「WiFi上传文件流程」第 1~2 步：
 * 取凭据 → 开热点(WIFIO + 轮询 WIFIS 到 2) → 程序化加入。
 * 每步通过 onStep 回传状态，供「连接中」清单展示。
 * 自动入网失败不抛错，返回 joined=false 让上层降级引导手动连。
 *
 * ⚠️ **取 SSID/密码必须在开热点之前**。协议写死「WiFi 开启后 30 秒内没有设备连接将自动关闭」，
 * 这 30s 从 AP 起来那刻开始算。旧实现 openWifi() → getWifiCredentials() → wifiJoin()，
 * 那次取凭据的 BLE 往返（1~4s）白白吃掉窗口，再叠上 iOS 入网 + DHCP 拿 192.168.200.x，
 * 常常刚连上就被设备关掉。WIFI 指令在 WiFi 关闭态也能读到凭据，挪到前面零代价。
 *
 * ⚠️ **开热点之前必须先跑一次 SK + WIFI&CH**（固件方 2026-08-04 给的原话流程，协议 SK&PWD 行
 * 也写着「后需发 GJJY_BLE&WIFI&CH 指令同步更改 WiFi 密码，需 10s 左右」）。这一步解释了之前
 * 那个反直觉的现象：设备自报的密码看着完全正确（`SeeMemor`），拿去入网却始终「无法加入网络」
 * ——自报的是 MCU 里存的值，**WiFi 模组里真正生效的密码要等 WIFI&CH 才会被刷进去**。
 * 只在没跑过（或换了密钥）时跑：它要 10s 且会复位 WiFi 模组，每次快传都跑等于白搭 10 秒。
 */
export async function connectWifi(
  client: Mr20Client,
  onStep?: (step: WifiConnectStep, state: WifiStepState) => void,
): Promise<WifiConnectResult> {
  // 1) 先问设备要凭据（不占 30s 窗口）。协议注明 PWD 就是 WiFi 密码，但**它只是 MCU 里存的值**，
  //    要等 WIFI&CH 刷进 WiFi 模组才真的生效——所以下一步的初始化不能省。
  const cred = await client
    .getWifiCredentials()
    .catch(() => ({ssid: '', pwd: ''}));
  let ssid = cred.ssid;
  let reported = cred.pwd;

  // 2) 首次配网：SK 设密钥 → WIFI&CH 同步到 WiFi 模组。必须在开热点**之前**——WIFI&CH 结束时
  //    设备会复位 WiFi 模组（协议：状态 6 后 5 秒自动关闭），先开的热点会被这次复位带走。
  const wantKey = (await getWifiPassword().catch(() => null)) || DEVICE_WIFI_DEFAULT_PWD;
  const provisionedKey = await getWifiProvisionedKey().catch(() => null);
  let justProvisioned = false;
  if (provisionedKey !== wantKey) {
    onStep?.('provision', 'active');
    client.log(
      `[wifi] 尚未对密钥「${wantKey}」做过配网初始化，按协议先跑 SK + WIFI&CH（约 10~20s，仅首次）`,
    );
    // 失败不抛错：设备多半仍能用出厂密码连上，为一步没走通断掉整次快传是因小失大。
    const prov = await client
      .provisionWifiPassword(wantKey)
      .catch(e => {
        client.log(`[wifi] 配网初始化异常：${String((e as Error)?.message || e)}`);
        return null;
      });
    // SK&ERR 是唯一「设备明确没收下」的情况。无应答不算失败——协议这条应答本就要 10s 左右，
    // 而且设备是靠自动跑一轮改密（WIFIS 4 → 6）来生效的，那一轮才是真判据。
    const sentKey = prov !== null && prov.sk !== 'err';
    if (sentKey) {
      // 密钥可能已经进设备了，本地必须留一份，否则下次连接拿不出正确的 SK 就被锁在门外。
      justProvisioned = true;
      await saveWifiPassword(wantKey).catch(() => undefined);
    }
    // 「已初始化」标记要严格得多：只有 SK&OK 或 WIFIS 真动过才算，否则下次快传会跳过这一步，
    // 拿着一把从没生效过的密码去撞同一堵墙。
    if (prov?.sk === 'ok' || prov?.confirmed) {
      await saveWifiProvisionedKey(wantKey).catch(() => undefined);
    }
    onStep?.('provision', prov?.confirmed || prov?.sk === 'ok' ? 'done' : 'failed');
  }

  // 3) 开热点并等到 WIFIS=2（或 1）。「开启热点」这一步到这里才真的开始——配网初始化可能
  //    要跑 10~20s，提前点亮会让用户对着一个不动的「开启设备热点」等半天。
  onStep?.('open', 'active');
  await client.openWifi();
  const apReadyAt = Date.now();
  onStep?.('open', 'done');

  // 热点起来之后**无条件重读一次** GJJY_BLE&WIFI，不再只在第一次读空时才补。
  //
  // 步骤 1 那次是在 SK + WIFI&CH 之前读的，而 WIFI&CH 的收尾会复位 WiFi 模组——热点是带着
  // 复位之后的配置起来的。所以「热点已经开着」时读到的这一份，才是和眼前这个 AP 同一时刻的
  // 值；之前那份属于上一个配置世代。早先只在读空时才补读，等于在跑过 CH 的情况下必然拿旧值
  // 去入网，而这恰恰是最需要新值的场合。
  //
  // 代价是一次 BLE 往返（真机实测 0.14~0.34s），从 30s 窗口里扣掉——换取「拿对密码」，值。
  const fresh = await client.getWifiCredentials().catch(() => ({ssid: '', pwd: ''}));
  if (fresh.ssid || fresh.pwd) {
    // 两次读到的不一样时必须说出来。这正是那个反直觉现象的现场：设备自报的密码看着完全
    // 正确、拿去入网却被拒——因为报的是哪一个世代的值，光看一次读数根本分不出来。
    if ((fresh.pwd || '') !== (reported || '')) {
      client.log(
        `[wifi] 热点开启后重读 WIFI：密码「${fresh.pwd || '（空）'}」` +
          `≠ 开热点前读到的「${reported || '（空）'}」，以热点开启后这份为准`,
      );
    } else {
      client.log(
        `[wifi] 热点开启后重读 WIFI：SSID「${fresh.ssid || '（空）'}」` +
          `密码「${fresh.pwd || '（空）'}」（与开热点前一致）`,
      );
    }
    ssid = fresh.ssid || ssid;
    reported = fresh.pwd || reported;
  }
  if (!ssid) {
    onStep?.('join', 'failed');
    throw new Error('未取到设备热点信息');
  }

  /**
   * 候选密码，按「谁更可能是真的」排序。每猜错一次 iOS 都会弹一个「无法加入网络」的模态框、
   * 并吃掉 30s 窗口里的几秒，所以顺序不是无所谓的小事：
   *   - 刚跑完 SK + WIFI&CH 时，`wantKey` 是**我们刚要求刷进 WiFi 模组的那个值**，排第一。
   *     `reported` 现在已经是热点开起来之后重读的了（不再是旧世代的值），但它读的仍然是
   *     **MCU 里存的**，而热点上真正生效的密码在 WiFi 模组里——两者要 WIFI&CH 跑通才会一致。
   *     所以刚跑完 CH 时仍以我们下发的值为准，`reported` 退到第二位互为兜底。
   *   - 没跑初始化时，设备自报的 `reported` 排第一（协议注明「PWD:WIFI 密码」）。
   *   - `DEVICE_WIFI_DEFAULT_PWD`（= `SeeMemor`）兜底，用于设备偶发报空。
   * 正常情况下这几个是同一个值，去重后只会试一次。
   */
  const candidates = (
    justProvisioned
      ? [wantKey, reported, DEVICE_WIFI_DEFAULT_PWD]
      : [reported, wantKey, DEVICE_WIFI_DEFAULT_PWD]
  ).filter((p, i, a): p is string => Boolean(p) && a.indexOf(p) === i);
  let pwd = candidates[0] ?? DEVICE_WIFI_DEFAULT_PWD;

  // 4) 立刻入网，别在这之间插任何 BLE 往返。
  onStep?.('join', 'active');
  // 原生未更新时 wifiJoin 为 undefined，按未入网处理 → 上层降级引导手动连。
  const joinFn = (Mr20Native as {wifiJoin?: typeof Mr20Native.wifiJoin}).wifiJoin;
  let joined = false;
  let windowExpired = false;
  if (typeof joinFn === 'function') {
    for (const cand of candidates) {
      // **先看热点还在不在。** 每个候选最多耗 WIFI_JOIN_TIMEOUT_MS（20s），而协议给的空闲
      // 窗口只有 30s——排到第三个时热点早被设备自己关了，那次尝试**必然失败，且和密码对不对
      // 无关**。更糟的是失败结果会往下走到 clearWifiProvisionedKey()，拿一个无意义的失败
      // 去作废「已初始化」标记。真机日志里那段 61.93s 的空白就是这么来的：3 × 20s。
      const left = AP_IDLE_WINDOW_MS - (Date.now() - apReadyAt);
      if (left <= 0) {
        windowExpired = true;
        client.log(
          `[wifi] 热点的 ${AP_IDLE_WINDOW_MS / 1000}s 空闲窗口已用完，设备多半已自动关掉热点；` +
            `剩下的密码（${candidates
              .slice(candidates.indexOf(cand))
              .map(c => `「${c}」`)
              .join('、')}）不再试——此时失败说明不了任何问题`,
        );
        break;
      }
      // 这一行不是可有可无的旁白：iOS 入网（NEHotspotConfiguration）**完全不走蓝牙**，
      // 而协议日志只记 BLE 收发。不在进出口各打一行的话，这最长 20s 就是一段纯黑，
      // 日志上表现为两条相邻记录之间莫名其妙隔了几十秒，看不出中间发生过什么。
      client.log(
        `[wifi] 用密码「${cand}」加入热点「${ssid}」…（最多 ${
          WIFI_JOIN_TIMEOUT_MS / 1000
        }s，这段不走蓝牙、日志会静默；热点窗口还剩 ${(left / 1000).toFixed(0)}s）`,
      );
      const startedAt = Date.now();
      // 原生失败时会 reject 并带上具体原因（密码非法 / 用户取消 / 找不到网络…），
      // 一律记进协议日志——吞掉的话排查时只剩一句「无法加入网络」，什么也定位不了。
      joined = await Mr20Native.wifiJoin(ssid, cand, WIFI_JOIN_TIMEOUT_MS).catch(e => {
        client.log(`[wifi] 密码「${cand}」入网失败：${String((e as Error)?.message || e)}`);
        return false;
      });
      const took = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (joined) {
        pwd = cand;
        await saveWifiPassword(cand).catch(() => undefined);
        client.log(`[wifi] 已加入热点「${ssid}」（密码 ${cand}，耗时 ${took}s）`);
        break;
      }
      // 原生旧版本会 resolve(false) 而不是 reject，那样上面的 catch 不会触发，
      // 这一整次尝试将不留任何痕迹。所以「没成」这件事必须在循环里无条件记一行。
      client.log(`[wifi] 密码「${cand}」没能入网（耗时 ${took}s）`);
    }
  }
  // 一个都没成：把试过什么如实记下来，否则分不清是我们没试对还是设备自报的就是错的。
  if (!joined) {
    client.log(
      `[wifi] 入网全部失败。SSID「${ssid}」，已试密码：${candidates
        .map(c => `「${c}」`)
        .join('、')}；设备 WIFI 指令自报「${reported || '（空）'}」` +
        (windowExpired ? '；⚠ 其中有尝试是在热点窗口关闭后发生的，不足为凭' : ''),
    );
    // 作废「已初始化」标记：下次快传会重跑 SK + WIFI&CH。设备被恢复出厂 / 换了一台设备 /
    // 上次那轮 WIFI&CH 其实没刷进模组，都会落到这里——不清掉的话会永远跳过初始化，
    // 拿着一个从没生效过的密码一次次撞同一堵墙。
    //
    // **但窗口过期那次不算数。** 热点已经被设备关掉时，密码再对也连不上；据此作废标记
    // 等于用一个和密码无关的失败去否定一次可能完全成功的配网，下次还得白跑 10s 的 SK+CH。
    if (windowExpired) {
      client.log('[wifi] 本次失败发生在热点窗口关闭之后，不据此作废「已完成配网初始化」标记');
    } else {
      await clearWifiProvisionedKey().catch(() => undefined);
    }
  }
  onStep?.('join', joined ? 'done' : 'failed');

  return {
    ssid,
    pwd,
    host: DEVICE_WIFI_HOST,
    port: DEVICE_WIFI_PORT,
    joined,
    apReadyAt,
    reported: reported || '',
  };
}

/**
 * 用**用户手输的密码**重新入网。自动入网连不上时的兜底。
 *
 * 为什么需要它：自动入网的候选密码全部来自「设备自报」「本地存过」「出厂默认」这三个来源，
 * 一旦设备上的真实热点密码不在其中（换过密钥、出厂预绑定、WIFI&CH 从没刷进模组…），
 * 自动这条路**再重试多少次都是同一批错密码**。此时用户从设备背面/固件方那里拿到正确密码，
 * 却只能去系统设置手输——而那一趟又必然超时 30s 窗口。不如让他直接在 App 里输。
 *
 * **必须先把热点重新开一遍。** 走到这一步时，iOS 弹过「无法加入网络」、用户还敲了 8 个字符，
 * 早就超出协议的 30s 空闲窗口，设备多半已经自己把 AP 关了。不重开的话是拿正确的密码去连一个
 * 不存在的热点，然后得出「这个密码也不对」的错误结论。
 */
export async function rejoinWifiWithPassword(
  client: Mr20Client,
  ssid: string,
  pwd: string,
): Promise<{joined: boolean; apReadyAt: number}> {
  client.log(`[wifi] 用手动输入的密码「${pwd}」重试：先把热点重新开起来`);
  await client.openWifi();
  const apReadyAt = Date.now();
  client.log(
    `[wifi] 加入热点「${ssid}」…（最多 ${WIFI_JOIN_TIMEOUT_MS / 1000}s，这段不走蓝牙）`,
  );
  const joined = await Mr20Native.wifiJoin(ssid, pwd, WIFI_JOIN_TIMEOUT_MS).catch(e => {
    client.log(`[wifi] 手输密码「${pwd}」入网失败：${String((e as Error)?.message || e)}`);
    return false;
  });
  if (joined) {
    // 存下来，下次快传第一顺位就用它，不必再让用户输一遍。
    await saveWifiPassword(pwd).catch(() => undefined);
    client.log(`[wifi] 手输密码「${pwd}」入网成功，已存为本地热点密码`);
  } else {
    client.log(`[wifi] 手输密码「${pwd}」也没能入网`);
  }
  return {joined, apReadyAt};
}

/**
 * 热点是否已经超出协议的 30s 空闲自动关窗口。用于在建 socket 失败时判断
 * 「是不是热点已经被设备自己关了」，从而决定重开 WIFIO 而不是死磕重连。
 */
export function isApWindowExpired(apReadyAt: number): boolean {
  return Date.now() - apReadyAt > AP_IDLE_WINDOW_MS;
}

/**
 * 释放手机侧热点配置。**不主动发 WIFIC**——设备 30s 无连接会自动关、BLE 断也会关；
 * 频繁 WIFIO/WIFIC 反复开关会触发 WiFi 模组卡死（见 data/测试报告.md），故收尾少折腾。
 */
export async function disconnectWifi(client: Mr20Client): Promise<void> {
  // 1) 手机侧退出设备热点网络（iOS removeConfiguration 后系统自动回连此前 WiFi）。
  // 原生未更新时 wifiLeave 为 undefined，直接调用会同步抛错；先判存在再调。
  const leaveFn = (Mr20Native as {wifiLeave?: typeof Mr20Native.wifiLeave}).wifiLeave;
  if (typeof leaveFn === 'function') {
    await Mr20Native.wifiLeave().catch(() => undefined);
  }
  // 2) 设备侧关闭热点（BLE WIFIC），传输/取消结束后省设备电量。之前只退了手机网络、
  // 没关设备热点，导致「传输结束后设备热点一直开着」。失败忽略（可能已关/断连）。
  await client.closeWifi().catch(() => undefined);
}

export interface WifiSyncOptions {
  host?: string;
  port?: number;
  onProgress?: (p: WifiTransferProgress) => void;
  // 返回 true 则停止（每个文件开始前检查）。
  shouldCancel?: () => boolean;
  // 同步成功后是否删除设备文件，默认 false。
  deleteAfter?: boolean;
  /**
   * AP 就绪时刻（connectWifi 返回的 apReadyAt）。用于判断建连失败是不是撞上了协议的
   * 30s 空闲自动关；不传按「刚就绪」算。
   */
  apReadyAt?: number;
  /**
   * 热点凭据（connectWifi 返回的 ssid/pwd）。重开热点后用来重新 apply 一次入网配置——
   * 设备 AP 关掉再起来是一个全新的 BSS，光靠 iOS 自己重连不保险。不传则只重开、不重连。
   */
  credentials?: {ssid: string; pwd: string};
}

/** 单个文件 WiFi 收流的最大尝试次数：瞬时失败（截断/连接掉线）退避重连可恢复。 */
const WIFI_MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * 整批 WiFi 拉取给定文件并入库。**只建一次 TCP 长连接**，之后逐个文件在同一 socket 上收流
 * （消除逐条重连的空档）；串行执行，单个失败只记录错误、断连后重连续传下一个。
 * 入参 files 为用户勾选的子集（手动快传场景）。
 */
export async function wifiSyncFiles(
  client: Mr20Client,
  files: Mr20File[],
  options: WifiSyncOptions = {},
): Promise<WifiSyncResult[]> {
  const {
    host = DEVICE_WIFI_HOST,
    port = DEVICE_WIFI_PORT,
    onProgress,
    shouldCancel,
    deleteAfter = false,
    apReadyAt = Date.now(),
    credentials,
  } = options;
  const results: WifiSyncResult[] = [];
  let completed = 0;
  onProgress?.({total: files.length, completed});

  // 整批复用一条长连接；出错(断连)时置 false，下个尝试自动重连续传。
  let opened = false;
  // 热点窗口起点。重开热点后要刷新它，否则第二轮会被误判成「早就过期」。
  let apOpenedAt = apReadyAt;

  /**
   * 建连。若建连失败且热点已过 30s 空闲窗口（协议：无客户端连接即自动关），
   * 说明设备把 AP 关了——此时重连 socket 永远不会成功，必须重发 WIFIO 起新一轮再连。
   * 这是「传到一半设备关热点、后面所有文件全失败」的唯一自救路径。
   */
  const ensureOpen = async () => {
    if (opened) {
      return;
    }
    try {
      await client.wifiOpenShared(host, port);
    } catch (e) {
      if (!isApWindowExpired(apOpenedAt)) {
        throw e;
      }
      // 重开热点：openWifi 内部会轮询 WIFIS 直到 1/2。
      await client.openWifi();
      apOpenedAt = Date.now();
      // 再 apply 一次入网配置：设备 AP 关掉再起来是全新的 BSS，不能指望 iOS 自己接回去。
      // 配置还在时 apply 会返回 alreadyAssociated，原生按成功处理，重复调用无副作用。
      const joinFn = (Mr20Native as {wifiJoin?: typeof Mr20Native.wifiJoin}).wifiJoin;
      if (credentials?.ssid && typeof joinFn === 'function') {
        await Mr20Native.wifiJoin(
          credentials.ssid,
          credentials.pwd || DEVICE_WIFI_DEFAULT_PWD,
          WIFI_JOIN_TIMEOUT_MS,
        ).catch(() => false);
      }
      await client.wifiOpenShared(host, port);
    }
    opened = true;
  };

  try {
    for (const file of files) {
      if (shouldCancel?.()) {
        break; // 用户中断：已下好的保留在收件箱，未传的留待下次补齐。
      }
      // 单文件多次尝试：截断/连接掉线等瞬时失败重连重试，避免半包被丢弃。
      let localPath = '';
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= WIFI_MAX_ATTEMPTS; attempt++) {
        if (shouldCancel?.()) {
          break;
        }
        try {
          await ensureOpen();
          const res = await client.wifiReceiveShared(file.dir, file.fname, {
            relativePath: mr20FileRelPath(file.dir, file.fname),
            onProgress: (received, size) => {
              onProgress?.({
                total: files.length,
                completed,
                current: {
                  dir: file.dir,
                  fname: file.fname,
                  received,
                  size: size > 0 ? size : file.size,
                },
              });
            },
          });
          localPath = res.path;
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          // 出错时长连接可能已被原生拆掉：关旧连、置未连，下个尝试重连续传。
          opened = false;
          await client.wifiCloseShared().catch(() => undefined);
          if (attempt < WIFI_MAX_ATTEMPTS) {
            await sleep(300 * attempt); // 退避，给设备 socket 服务重置的时间
          }
        }
      }
      try {
        if (localPath) {
          await markSynced(file.dir, file.fname);
          const ingest = await recordSyncedFile({
            localPath,
            dir: file.dir,
            fname: file.fname,
            seconds: file.seconds,
            sizeBytes: file.size,
          });
          if (deleteAfter) {
            await client.deleteFile(file.dir, file.fname).catch(() => undefined);
          }
          results.push({file, localPath, ingest});
        } else {
          results.push({
            file,
            localPath: '',
            error: String((lastErr as Error)?.message || lastErr || '传输失败'),
          });
        }
      } finally {
        completed += 1;
        onProgress?.({total: files.length, completed});
      }
    }
  } finally {
    // 批末统一关闭长连接（用户取消/异常也要关，避免 socket 悬空）。
    if (opened) {
      await client.wifiCloseShared().catch(() => undefined);
    }
  }

  return results;
}
