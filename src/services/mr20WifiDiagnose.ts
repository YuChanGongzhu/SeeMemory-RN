/**
 * WiFi 配网自检 —— 按协议 0801 把整条链路**完整走一遍**，每条指令的下发与回包都记进日志。
 *
 * 为什么要这个：常规快传失败时只能看到「无法加入网络」这一个终点现象，而链路上有五个完全不同
 * 的故障点（BLE 不通 / SK 被拒 / WIFI&CH 不生效 / 热点起不来 / 密码不对），日志不分步就分不出
 * 是哪一个。这里按协议原文顺序逐步执行、逐步记录，最后给一句可执行的结论。
 *
 * ⚠️ 关键前提：设备 `WIFI` 指令自报的密码是 **MCU 里存的值**，而热点上真正生效的密码在
 * WiFi 模组里，要发过 `WIFI&CH` 才会被刷进去。所以「设备报得出密码」完全不代表「这个密码能连」
 * ——真机上正是这个差异让人白排查了好几轮。自检因此每次都完整走 SK → WIFI&CH，不走捷径。
 *
 * 依据的协议原文（`data/通信协议_硅基记忆_0801.xlsx`）：
 *   「SK&PWD」行：第一次发送为设置密钥，后需发 WIFI&CH 同步更改 WiFi 密码，需 10s 左右
 *   「WiFi功能使用」：设备接收到密钥后，会自动打开 WiFi 并设置 WiFi 密码，状态 '4' → '6'，
 *                     并在 5 秒后自动关闭；整个过程大概需要 8 秒
 *   「WiFi上传文件流程」：1. WIFIO + 每秒 WIFIS  2. 状态 '2' 时连手机 WiFi + 建 socket
 *                         5. 结束发 WIFIC
 */
import {Mr20Client} from '../native/mr20/Mr20Client';
import {Mr20Native} from '../native/mr20/Mr20Native';
import {
  MR20_KEY_LEN,
  WIFI_TIMING,
  WifiState,
  isValidDeviceKey,
  toDeviceKey,
} from '../native/mr20/protocol';
import {
  AP_IDLE_WINDOW_MS,
  DEVICE_WIFI_HOST,
  DEVICE_WIFI_PORT,
} from './mr20WifiSync';
import {saveWifiPassword, saveWifiProvisionedKey} from './mr20Storage';

export interface WifiDiagReport {
  /** 完整日志，每行一条，供页面展示 / 分享导出。 */
  lines: string[];
  /** 一句话结论 + 下一步该做什么。 */
  verdict: string;
  /** 整条链路是否走通（到 socket 建立为止）。 */
  ok: boolean;
  /** 最终确认可用的热点凭据（走通时才有意义）。 */
  ssid: string;
  pwd: string;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** WIFIS 状态码 → 人话，日志里直接看得懂，不用回头翻协议。 */
function stateName(s: number): string {
  switch (s) {
    case WifiState.OFF:
      return '0=WiFi关闭';
    case WifiState.LINKED:
      return '1=已有客户端连入';
    case WifiState.AP_IDLE:
      return '2=AP已起/无客户端';
    case WifiState.OPENING:
      return '3=等待WiFi开启';
    case WifiState.PWD_CHANGING:
      return '4=修改密码中';
    case WifiState.OTA:
      return '5=OTA中';
    case WifiState.PWD_DONE:
      return '6=密码修改成功/待复位';
    case WifiState.AUTO_OFF:
      return '7=自动关闭';
    default:
      return `${s}=无应答/无法解析`;
  }
}

/**
 * 跑一遍完整配网。`key` 是要设置的 8 位热点密码（同时也是 SK 绑定密钥）。
 *
 * `onLine` 每产生一行就回调一次，方便页面边跑边显示——整个流程最长可能跑 1 分多钟，
 * 全跑完才出结果的话用户会以为卡死了。
 *
 * `opts.resetFirst`：先发 `SK&RESET` 把设备上的旧密钥清掉、重连，再走 SK → WIFI&CH。
 * 设备被出厂预绑（SK&ERR）或跑过 CH 却仍连不上时用——**只清密钥，不动录音**
 * （格式化磁盘的是另一条 `BLE&RESET`，这里从不发它）。
 */
export async function runWifiSetupDiagnostic(
  client: Mr20Client,
  key: string,
  onLine?: (line: string) => void,
  opts: {resetFirst?: boolean} = {},
): Promise<WifiDiagReport> {
  const lines: string[] = [];
  const t0 = Date.now();
  const log = (msg: string) => {
    const dt = ((Date.now() - t0) / 1000).toFixed(1).padStart(5, ' ');
    const line = `[${dt}s] ${msg}`;
    lines.push(line);
    onLine?.(line);
  };
  const done = (ok: boolean, verdict: string, ssid = '', pwd = ''): WifiDiagReport => {
    log('');
    log(`结论：${verdict}`);
    return {lines, verdict, ok, ssid, pwd};
  };

  const devKey = toDeviceKey(key);
  if (!isValidDeviceKey(devKey)) {
    return done(false, `密码必须是 ${MR20_KEY_LEN} 位英文字母或数字（不能含中文、空格）。`);
  }

  // 步骤 0 发过 SK&RESET 但设备没断链 = 那条命令很可能被固件忽略了。这个信号要一直带到
  // 后面的结论里：同样是「SK 无应答」，重置生效过和压根没生效，该说的话完全不同。
  let resetIgnored = false;

  log('=== MR20 WiFi 配网自检（依据协议 0801）===');
  // 每行的 `[ 7.0s]` 是相对本次自检开头的秒数——窄，一屏放得下，看间隔最方便。
  // 但光有相对时间没法和设备端对上（「指示灯闪了 3 秒」发生在墙上时间的哪一刻？），
  // 所以在开头钉一个绝对时刻：任意一行的真实时间 = 这个起点 + 该行的秒数。
  const clock = new Date(t0);
  const pad = (n: number) => String(n).padStart(2, '0');
  log(
    `开始时刻 ${pad(clock.getHours())}:${pad(clock.getMinutes())}:${pad(
      clock.getSeconds(),
    )}（下面每行的秒数都是相对这一刻的偏移）`,
  );
  log(`目标密钥/热点密码：${devKey}`);
  if (opts.resetFirst) {
    log('本次先重置绑定密钥（SK&RESET）再重新配网');
  }
  log('');

  // ---------------------------------------------------------------- 步骤 0
  //
  // 只在显式要求时跑。SK&RESET 会当场断开 BLE，所以必须紧跟一次重连——协议 SK&PWD 行写着
  // 「BLE 连接之后**第一次发送**为设置密钥」，新密钥只能在重连后的那条链路上设。
  //
  // ⚠️ 发的是 SK&RESET（只重置密钥）。协议里长得很像的 BLE&RESET 是「断开 BLE 连接，
  //    **格式化磁盘**」——那条会抹掉设备上的全部录音，本流程任何一步都不碰它。
  if (opts.resetFirst) {
    log('【0/8】重置绑定密钥：发 GJJY_BLE&SK&RESET');
    log('  （协议 SK&RESET 行：重置密钥，如连接将断开连接，后需用 SK&PWD 重新设置密钥）');
    log('  ⓘ 只重置密钥，不动设备上的录音（格式化磁盘的是另一条 BLE&RESET，这里不发）');
    try {
      const r = await client.resetDeviceKeyAndReconnect({onLog: m => log(`  ${m}`)});
      // 「设备自己断没断」是这条无应答命令唯一的可观测后果，往下传给结论用。
      resetIgnored = !r.droppedByDevice;
      log(
        r.droppedByDevice
          ? '  ✓ 密钥已重置并重新连上，继续设新密钥'
          : '  ⚠ 设备始终没有断开 —— 这条命令很可能没被执行，密钥大概率还在',
      );
    } catch (e) {
      log(`  ✗ ${String((e as Error)?.message || e)}`);
      return done(
        false,
        `重置后没能重新连上设备（${String((e as Error)?.message || e)}）。` +
          '密钥多半已经清掉了——请回设备列表手动重连一次，再跑一次自检（这次不用勾重置）。',
      );
    }
    log('');
  }

  // ---------------------------------------------------------------- 步骤 1
  log('【1/8】蓝牙连通性：发 GJJY_BLE&FW');
  const fw = await client.getFirmware().catch(() => '');
  if (!fw) {
    log('  ✗ 设备没有回 FW');
    // **「FW 不回」绝不等于「不能往下走」。**
    //
    // 协议 SK&PWD 行写得很清楚：「之后连接需密钥匹配后蓝牙指令才能生效」——设备手里握着一把
    // 我们不知道的密钥时，它对**裸发的 FW 本来就该沉默**。而让它重新开口的唯一手段，正是
    // 下面步骤 3 的那条 SK。所以在这里 return，等于「因为门锁着，所以不掏钥匙」。
    //
    // 真机上这个逻辑造成的后果很具体：步骤 0 自己刚打完「设备对裸连指令静默 —— 直接发 SK」，
    // 紧接着步骤 1 又拿同一条裸 FW 试一次，然后判「蓝牙链路本身不通」收场，SK 一次都没发出去。
    // 唯一该中断的情形是**链路真的断了**，那 GATT 状态会直说，不必靠 FW 去猜。
    const linkDown = client.state !== 'connected' && client.state !== 'pairing';
    if (linkDown) {
      return done(
        false,
        `蓝牙链路已断开（当前状态 ${client.state}），后面的步骤都无从谈起。` +
          '请确认记忆粒已开机、就在手机旁边，重新连接后再跑一次。',
      );
    }
    log('    ⓘ GATT 链路是通的，只是设备不应答裸指令 —— 协议：密钥不匹配时蓝牙指令不生效。');
    log('      这恰恰是要发 SK 的理由，继续往下走（能不能让它开口，看步骤 3）。');
  } else {
    log(`  ✓ 固件版本 ${fw}`);
    const wfv = await client.getWifiVersion().catch(() => '');
    log(`  WiFi 模组版本 ${wfv || '（未回）'}`);
    // 步骤 0（resetFirst）里 20s 探测窗口可能在设备真正开口前就到期，导致 connState 停在
    // 'pairing'——但这里已经实打实收到 FW 应答，link 明摆着是活的，不该继续让 UI 停在
    // 「正在连接并配置设备…」。跟 markConnected() 一样只是 setState + emit，重复调用无害。
    if (client.state !== 'connected') {
      client.markConnected();
    }
  }
  // 「设备一开始就沉默」要一路带到结论：同样是 SK 无应答，从沉默开始和从能应答开始，
  // 说明的问题完全不同（前者是密钥没对上，后者才轮得到怀疑 SK 这条指令本身）。
  const silentBeforeSk = !fw;

  // ---------------------------------------------------------------- 步骤 2
  log('');
  log('【2/8】读配网前的初始状态：WIFIS + WIFI');
  const state0 = await client.getWifiState().catch(() => WifiState.UNKNOWN);
  log(`  WIFIS = ${stateName(state0)}`);
  const cred0 = await client.getWifiCredentials().catch(() => ({ssid: '', pwd: ''}));
  log(`  WIFI  = SSID「${cred0.ssid || '（空）'}」PWD「${cred0.pwd || '（空）'}」`);
  log('  ⓘ 注意：这里报的是 MCU 里存的值。真正生效的热点密码在 WiFi 模组里，');
  log('     要发过 WIFI&CH 才会被刷进去——所以「报得出密码」≠「这个密码能连上」。');

  // ---------------------------------------------------------------- 步骤 3
  //
  // 曾经这里有个「设备已自报密码就跳过 SK+CH」的捷径，理由是「报得出密码说明早就配过了」。
  // 那个理由是错的：真机上设备自报 SeeMemor、拿去入网照样被拒，因为 WIFI&CH 从没跑过、
  // 密码压根没进 WiFi 模组。固件方 2026-08-04 确认流程就是 SK → WIFI&CH → 正常连接，
  // 所以自检**必须每次都完整走一遍**，否则它验的根本不是真实链路。
  log('');
  log(`【3/8】设置绑定密钥：发 GJJY_BLE&SK&${devKey}`);
  log('  （协议 SK&PWD 行：BLE 连接后第一次发送为设置密钥，之后连接需密钥匹配蓝牙指令才生效）');
  log(
    `  ⏱ 固件方：这条应答要 10s 左右（设备顺带把 WiFi 密码配一遍才回话），最多等 ${
      WIFI_TIMING.SK_ACK_MS / 1000
    }s`,
  );
  const sk = await client.setBindKey(devKey);
  // 无应答**不中断自检**。这条应答慢到 10s 是协议自带的，而且设备收到密钥后靠自动跑一轮
  // 改密（WIFIS 4 → 6）来生效——那一轮才是真判据。早先在这里 return，等于把一次可能已经
  // 成功的配网当场判死，日志还只留下「设备对 SK 完全不应答」这一句误导性的结论。
  if (sk === 'timeout') {
    log('  ⚠ 没等到 SK 应答 —— 不代表失败，继续发 WIFI&CH，看 WIFIS 有没有动');
  }
  if (sk === 'err') {
    // 设备**回话了**（只是说 ERR）。若它此前对裸 FW 沉默，这一条就同时证明了两件事：
    // 通知通道好着、密钥绑定功能是开着的。这个组合值得单独记一行，它把「设备坏了」排除掉了。
    if (silentBeforeSk) {
      log('  ⓘ 此前裸发 FW 没回、这条 SK 却回了 ERR —— 说明设备活着、通知通道也通，');
      log('     纯粹是密钥不匹配把其它指令挡住了（协议：密钥匹配后蓝牙指令才生效）。');
    }
    log('  ✗ 设备回 GJJY_DEV&SK&ERR');
    return done(
      false,
      resetIgnored
        ? '两条证据对上了：SK&RESET 之后设备没有按协议断开连接，SK 又回 SK&ERR —— ' +
          '这台固件忽略了重置指令，密钥根本没被清掉。多为出厂预绑定。' +
          '请把这份日志发给固件方，要这台 YLF20 的出厂密钥，或让其关闭出厂预绑定。'
        : opts.resetFirst
        ? '刚发过 SK&RESET 重置密钥（设备也确实断开重连了），设备仍回 SK&ERR —— ' +
          '重置执行了但密钥没清掉，多半是出厂预绑定。请把这份日志发给固件方。'
        : '设备已被另一把密钥绑定（多为出厂预绑）。请用「重置密钥后重新配网」再跑一次' +
          '（会先发 SK&RESET 解绑并自动重连，不影响设备上的录音）。',
    );
  }
  if (sk === 'ok') {
    log('  ✓ 设备回 GJJY_DEV&SK&OK，密钥已写入');
    // 收到 SK_OK 本身就是一轮完整的认证握手回包，跟步骤 1 的 FW 一样是「link 活着」的实证。
    if (client.state !== 'connected') {
      client.markConnected();
    }
  }

  // 步骤 1 沉默过的话，这里补一枪 FW —— 这是**最干净的一个判据**：
  //   现在能回 FW  = 刚才那把密钥对上了，设备被这条 SK 解锁了，链路完全正常；
  //   现在还是不回 = 沉默与密钥无关（通知通道/固件本身的问题），后面的 WIFIS 也别指望。
  // 不做这一步的话，「SK 无应答 + WIFIS 不动」会被含混地归到「固件没开密钥绑定」上，
  // 而它同样可能只是设备压根不说话——两者的下一步完全不同。
  let unlockedBySk = false;
  // （走到这里 sk 只可能是 'ok' / 'timeout'——'err' 上面已经 return 了。）
  if (silentBeforeSk) {
    log('  ↺ 步骤 1 时设备是沉默的，这里再发一次 FW 看它有没有被这条 SK 解锁…');
    const fw2 = await client.getFirmware().catch(() => '');
    unlockedBySk = !!fw2;
    log(
      fw2
        ? `  ✓ 这次回了固件版本 ${fw2} —— 密钥对上了，设备已解锁`
        : '  ✗ 仍然不回 FW —— 沉默和密钥无关，是设备/通知通道自己的问题',
    );
    if (fw2 && client.state !== 'connected') {
      client.markConnected();
    }
  }
  // **马上存**，别等 WIFI&CH 那步的结论。只要 SK 不是 ERR，设备就有可能已经把这把密钥收下了
  // （无应答尤其可能——协议这条应答本来就要 10s）。此时手机上必须有它：后面任何一步失败
  // 提前 return，都不能出现「设备有密钥、手机没有」的局面，那会让下次连接必然 SK&ERR。
  await saveWifiPassword(devKey).catch(() => undefined);
  log(`  已把 ${devKey} 存为本地热点密码（无论后面几步成不成，先保住重连的能力）`);

  // ---------------------------------------------------------------- 步骤 4
  log('');
  log('【4/8】同步热点密码：发 GJJY_BLE&WIFI&CH（无参）');
  log('  （协议原文：后需发 WIFI&CH 指令同步更改 WiFi 密码，需 10s 左右；MCU 不回包，靠轮询 WIFIS）');
  // 刚重置过的设备收到 SK 就会自己跑一轮改密（协议「WiFi功能使用」段），此时再插一条 CH
  // 是往正在跑的周期里塞命令——协议还写明 4/5/6 期间连关 WiFi 都不生效。让它跑完就行。
  if (await client.isPwdCycleRunning()) {
    log('  ⓘ WIFIS 已是 4/6 —— 设备收到密钥后自己就开始配密码了（协议：重置后连接即如此）');
    log('    这一步不补发 WIFI&CH，直接等它跑完');
  } else {
    await client.syncWifiPassword().catch(() => undefined);
  }

  const cycle = await client.awaitPwdSyncCycle({
    onState: s => log(`  WIFIS = ${stateName(s)}`),
  });
  log(`  状态序列：${cycle.seq.map(stateName).join(' → ') || '（无）'}`);
  if (cycle.sawDone) {
    log('  ✓ 出现状态 6，设备确认密码已改写');
  } else if (cycle.sawChanging) {
    log('  ⚠ 出现过状态 4 但没到 6 —— 命令被接受了，但没等到完成确认');
  } else {
    log('  ✗ 全程没进过状态 4 —— 设备没把 WIFI&CH 当成改密命令');
    // 四种「没进 4」长得一模一样，但病因完全不同，靠前面几步攒下的证据来分：
    //   ① 从头到尾一句话没回        → 设备根本不说话，先别怀疑配网
    //   ② SK 把它解锁了，但 WIFIS 不动 → 密钥这条通了，是 WIFI&CH 没实现
    //   ③ 只读指令通、写指令全哑     → 固件没打开密钥绑定功能
    //   ④ SK&OK 了但 WIFIS 不动      → 同 ②
    return done(
      false,
      silentBeforeSk && !unlockedBySk
        ? '设备从头到尾一条指令都没回过：FW 没回、SK 没回、WIFIS 也从没动过' +
          (resetIgnored ? '，SK&RESET 同样没让它断开连接' : '') +
          ' —— 这不是配网的问题，是设备在这条链路上压根不说话。' +
          '请先把记忆粒关机重开、重新连一次蓝牙，确认能读出固件版本之后再跑自检。' +
          '重开后仍然如此，就把这份日志发给固件方。'
        : unlockedBySk
        ? 'SK 之后设备恢复应答了（密钥这一步是通的），但 WIFI&CH 之后 WIFIS 从没进过状态 4 —— ' +
          '问题卡在「同步热点密码」这一条上，该固件没有实现它。' +
          '请把这份日志发给固件方，问这台 YLF20 的热点密码由什么决定、当前值是多少。'
        : sk === 'timeout'
        ? 'SK 没应答，WIFI&CH 之后 WIFIS 也从没进过状态 4' +
          (resetIgnored ? '，而 SK&RESET 也没让设备断开连接' : '') +
          ' —— 改配置的指令设备一条都没反应，而 FW/WIFI 这些只读指令是通的。' +
          '这几乎可以断定：这台固件没打开密钥绑定功能（协议：默认该功能关闭，需修改固件打开）。' +
          '请把这份日志发给固件方，问这台 YLF20 的热点密码由什么决定、当前值是多少。'
        : 'SK 设置成功，但设备对 WIFI&CH 无反应（从未进入状态 4）。' +
          '这说明该固件没有实现「WIFI&CH 同步热点密码」，App 侧无法设置密码 —— ' +
          '请把这份日志发给固件方，问这台 YLF20 的热点密码到底由什么决定、当前值是多少。',
    );
  }

  // 密码在步骤 3 之后就存过了，这里只补记「已完成配网初始化」——WIFIS 动过才算数，
  // 快传主路径据此跳过那 10s 的 SK + WIFI&CH。
  await saveWifiProvisionedKey(devKey).catch(() => undefined);
  log('  已记为「已完成配网初始化」，之后的快传不必再跑这 10 秒');

  // 协议：状态 6 之后 5 秒自动关闭并复位，得等它走完再开热点。
  log('  等待设备复位（协议：状态 6 后 5 秒自动关闭）…');
  await sleep(WIFI_TIMING.RESET_MS);

  return verifyJoin(client, log, done, cred0.ssid, [devKey]);
}

/**
 * 自检的后半程（开热点 → 取凭据 → 入网 → socket → 收尾）。
 * 配过密钥和没配过两条路走到这里就完全一样了，抽出来共用，免得两份实现慢慢走偏。
 *
 * `candidates` 是按可信度排好序的候选密码；每猜错一次 iOS 都会弹一次「无法加入网络」，
 * 所以顺序由调用方负责，这里只负责如实记录试了什么、结果如何。
 */
async function verifyJoin(
  client: Mr20Client,
  log: (msg: string) => void,
  done: (ok: boolean, verdict: string, ssid?: string, pwd?: string) => WifiDiagReport,
  ssid0: string,
  candidates0: string[],
): Promise<WifiDiagReport> {
  log('');
  log('【5/8】开热点：发 GJJY_BLE&WIFIO，每秒轮询 WIFIS 直到 2（协议流程第 1 步）');
  try {
    await client.openWifi();
  } catch (e) {
    log(`  ✗ ${String((e as Error)?.message || e)}`);
    return done(false, `热点没能起来：${String((e as Error)?.message || e)}`);
  }
  const apReadyAt = Date.now();
  const stateAp = await client.getWifiState().catch(() => WifiState.UNKNOWN);
  log(`  ✓ 热点已就绪，WIFIS = ${stateName(stateAp)}`);
  log('  ⏱ 协议：AP 起来后 30 秒内没有客户端连入就会自动关闭，下面要抓紧');

  log('');
  log('【6/8】取热点凭据：发 GJJY_BLE&WIFI（协议流程第 2 步）');
  const cred1 = await client.getWifiCredentials().catch(() => ({ssid: '', pwd: ''}));
  log(`  WIFI = SSID「${cred1.ssid || '（空）'}」PWD「${cred1.pwd || '（空）'}」`);
  const ssid = cred1.ssid || ssid0;
  if (!ssid) {
    return done(false, '设备没报出热点名称（SSID），无法入网。请断电重启设备后再跑一次。');
  }
  // 设备自报值永远排第一：协议注明「PWD:WIFI 密码」，真机也证实它报的就是真密码。
  const candidates = [cred1.pwd, ...candidates0].filter(
    (p, i, a): p is string => Boolean(p) && a.indexOf(p) === i,
  );

  log('');
  log(`【7/8】加入热点「${ssid}」（候选密码 ${candidates.length} 个）`);
  const joinFn = (Mr20Native as {wifiJoin?: typeof Mr20Native.wifiJoin}).wifiJoin;
  if (typeof joinFn !== 'function') {
    return done(false, '原生模块没有 wifiJoin —— 需要 cd ios && pod install 后重新编译 App。');
  }
  let joinedPwd = '';
  for (const cand of candidates) {
    log(`  尝试密码「${cand}」…`);
    // 原生失败会 reject 并带原因（密码非法 / 用户取消 / 找不到网络…），直接记进日志。
    const joined = await Mr20Native.wifiJoin(ssid, cand, 20000).catch(e => {
      log(`    ✗ ${String((e as Error)?.message || e)}`);
      return false;
    });
    if (joined) {
      joinedPwd = cand;
      log(`  ✓ 已加入热点（密码 ${cand}）`);
      break;
    }
  }
  if (!joinedPwd) {
    log(`  热点开启至今 ${((Date.now() - apReadyAt) / 1000).toFixed(1)}s`);
    return done(
      false,
      `候选密码 ${candidates.map(c => `「${c}」`).join('、')} 都被系统拒绝。` +
        '注意 iOS 这句提示在「SSID 当时没在广播」时也会出现，未必是密码错——' +
        '请把这份日志发给固件方，确认热点密码的真实来源。',
      ssid,
    );
  }
  await saveWifiPassword(joinedPwd).catch(() => undefined);

  log('');
  log(`【8/8】建立 socket：TCP ${DEVICE_WIFI_HOST}:${DEVICE_WIFI_PORT}（协议流程第 2 步末）`);
  try {
    await client.wifiOpenShared(DEVICE_WIFI_HOST, DEVICE_WIFI_PORT);
    log('  ✓ socket 已连通 —— 整条链路走通');
  } catch (e) {
    log(`  ✗ ${String((e as Error)?.message || e)}`);
    return done(
      false,
      `已连上热点但 socket 连不通（${String((e as Error)?.message || e)}）。` +
        '多半是手机没从设备拿到 192.168.200.x 地址，或热点在期间被自动关闭了。',
      ssid,
      joinedPwd,
    );
  } finally {
    await client.wifiCloseShared().catch(() => undefined);
  }

  log('');
  log('【收尾】发 GJJY_BLE&WIFIC 关热点（协议流程第 5 步）');
  await client.closeWifi().catch(() => undefined);
  await Mr20Native.wifiLeave?.().catch(() => undefined);
  log('  已退出设备热点');

  return done(
    true,
    `配网成功。热点「${ssid}」密码「${joinedPwd}」已保存，现在可以正常使用 WiFi 快传了。`,
    ssid,
    joinedPwd,
  );
}

/**
 * 「用我输的这个密码连一次热点」—— 单点验证，不碰设备任何配置。
 *
 * 和 {@link runWifiSetupDiagnostic} 的分工：那个是**改配置**的完整链路（SK → WIFI&CH → …），
 * 这个只做「开热点 → 读凭据 → 用指定密码入网 → 建 socket」，一条写指令都不发。
 * 用来回答一个很具体的问题：**这个密码到底能不能连上这台设备的热点。**
 *
 * 为什么值得单独做一个：用户在**系统 WiFi 设置**里手连时，几乎必然失败，而且和密码对不对无关——
 * 协议规定「AP 起来后 30 秒内没有客户端连入就自动关闭」，而切到设置 App、在列表里找到 SSID、
 * 敲 8 个字符、点加入，这一趟通常就把 30 秒用光了。等你点下「加入」，热点已经没了，
 * iOS 只会说一句「无法加入网络」——那句提示在「SSID 当时没在广播」时是同一个文案。
 * 在 App 里连就没有这个问题：热点是刚开的，密码是现成的，几百毫秒就发出去了。
 */
export async function runHotspotJoinTest(
  client: Mr20Client,
  pwd: string,
  onLine?: (line: string) => void,
): Promise<WifiDiagReport> {
  const lines: string[] = [];
  const t0 = Date.now();
  const log = (msg: string) => {
    const dt = ((Date.now() - t0) / 1000).toFixed(1).padStart(5, ' ');
    const line = `[${dt}s] ${msg}`;
    lines.push(line);
    onLine?.(line);
  };
  const done = (ok: boolean, verdict: string, ssid = '', p = ''): WifiDiagReport => {
    log('');
    log(`结论：${verdict}`);
    return {lines, verdict, ok, ssid, pwd: p};
  };

  const clock = new Date(t0);
  const pad = (n: number) => String(n).padStart(2, '0');
  log('=== 用指定密码连接设备热点（只读验证，不改设备配置）===');
  log(
    `开始时刻 ${pad(clock.getHours())}:${pad(clock.getMinutes())}:${pad(
      clock.getSeconds(),
    )}（下面每行的秒数都是相对这一刻的偏移）`,
  );
  log(`要试的密码：「${pwd}」（${pwd.length} 位）`);
  if (!isValidDeviceKey(pwd)) {
    // 不拦，只提示。协议说 8 位，但走到手输这一步本身就说明我们的假设可能不成立。
    log(`  ⓘ 协议说热点密码是 ${MR20_KEY_LEN} 位，这个是 ${pwd.length} 位 —— 照样试`);
  }
  log('');

  // ------------------------------------------------------------------ 1/4
  log('【1/4】开热点：发 GJJY_BLE&WIFIO，每秒轮询 WIFIS 直到 2');
  try {
    await client.openWifi();
  } catch (e) {
    log(`  ✗ ${String((e as Error)?.message || e)}`);
    return done(false, `热点没能起来：${String((e as Error)?.message || e)}`);
  }
  const apReadyAt = Date.now();
  log(`  ✓ 热点已就绪，WIFIS = ${stateName(await client.getWifiState().catch(() => WifiState.UNKNOWN))}`);
  log(`  ⏱ 协议：${AP_IDLE_WINDOW_MS / 1000}s 内没有客户端连入就自动关闭，下面每一步都会报还剩多少`);

  // ------------------------------------------------------------------ 2/4
  log('');
  log('【2/4】读热点凭据：发 GJJY_BLE&WIFI（热点已开着，读到的是当前生效的这一代）');
  const cred = await client.getWifiCredentials().catch(() => ({ssid: '', pwd: ''}));
  log(`  WIFI = SSID「${cred.ssid || '（空）'}」PWD「${cred.pwd || '（空）'}」`);
  if (cred.pwd && cred.pwd !== pwd) {
    // 这个对比是本次测试最有价值的一行：设备说的和你输的不一样，先看这里再谈别的。
    log(`  ⚠ 设备自报的密码「${cred.pwd}」和你输的「${pwd}」不一样`);
    log('    仍按你输的试。若失败，下一步就该拿设备自报的那个再跑一次本测试。');
  } else if (cred.pwd) {
    log('  ✓ 和你输的一致');
  }
  const ssid = cred.ssid;
  if (!ssid) {
    return done(false, '设备没报出热点名称（SSID），无法入网。请断电重启设备后再试。');
  }

  // ------------------------------------------------------------------ 3/4
  const leftBeforeJoin = AP_IDLE_WINDOW_MS - (Date.now() - apReadyAt);
  log('');
  log(`【3/4】加入热点「${ssid}」（热点窗口还剩 ${(leftBeforeJoin / 1000).toFixed(1)}s）`);
  const joinFn = (Mr20Native as {wifiJoin?: typeof Mr20Native.wifiJoin}).wifiJoin;
  if (typeof joinFn !== 'function') {
    return done(false, '原生模块没有 wifiJoin —— 需要 cd ios && pod install 后重新编译 App。');
  }
  log('  ⓘ 这一步走 iOS 的 NEHotspotConfiguration，不经过蓝牙，期间协议日志会静默');
  const joinStart = Date.now();
  const joined = await Mr20Native.wifiJoin(ssid, pwd, 20000).catch(e => {
    log(`  ✗ 系统拒绝：${String((e as Error)?.message || e)}`);
    return false;
  });
  const joinTook = ((Date.now() - joinStart) / 1000).toFixed(1);

  // 问系统自己：配置到底落地了没有、现在关联的是哪个网络。
  // 「系统设置里能连、App 里连不上」时这两行最有分量——它把「iOS 根本没收下我们的配置」
  // 和「收下了但关联不上」彻底分开，而光看 apply 的回调是分不出来的。
  const diagFn = (Mr20Native as {wifiDiagnostics?: () => Promise<any>}).wifiDiagnostics;
  if (typeof diagFn === 'function') {
    const sys = await Mr20Native.wifiDiagnostics().catch(() => null);
    if (sys) {
      log(
        `  系统侧：已保留的热点配置 [${(sys.configuredSSIDs || []).join('、') || '空'}]，` +
          `当前关联「${sys.currentSSID || '查不到'}」`,
      );
    }
  } else {
    log('  ⓘ 原生模块还没有 wifiDiagnostics（需重新编译 App），跳过系统侧核对');
  }

  if (!joined) {
    log(`  ✗ 没能加入（耗时 ${joinTook}s，热点开启至今 ${((Date.now() - apReadyAt) / 1000).toFixed(1)}s）`);
    return done(
      false,
      `用密码「${pwd}」没能加入热点「${ssid}」。` +
        (cred.pwd && cred.pwd !== pwd
          ? `设备自报的密码是「${cred.pwd}」，建议改用它再试一次。`
          : 'iOS 的「无法加入网络」在「SSID 当时没在广播」时是同一句提示，未必是密码错——' +
            '若设备自报的密码就是这个、连它也连不上，请把这份日志发给固件方。'),
      ssid,
    );
  }
  log(`  ✓ 已加入热点（耗时 ${joinTook}s）`);
  await saveWifiPassword(pwd).catch(() => undefined);
  log(`  已把「${pwd}」存为本地热点密码，下次快传第一顺位用它`);

  // ------------------------------------------------------------------ 4/4
  log('');
  log(`【4/4】建立 socket：TCP ${DEVICE_WIFI_HOST}:${DEVICE_WIFI_PORT}`);
  let sockOk = false;
  try {
    await client.wifiOpenShared(DEVICE_WIFI_HOST, DEVICE_WIFI_PORT);
    sockOk = true;
    log('  ✓ socket 已连通 —— 这个密码完全可用');
  } catch (e) {
    log(`  ✗ ${String((e as Error)?.message || e)}`);
  } finally {
    await client.wifiCloseShared().catch(() => undefined);
  }

  log('');
  log('【收尾】退出热点并发 GJJY_BLE&WIFIC 关闭设备热点');
  await Mr20Native.wifiLeave?.().catch(() => undefined);
  await client.closeWifi().catch(() => undefined);

  return done(
    sockOk,
    sockOk
      ? `密码「${pwd}」可用：热点「${ssid}」连上了，${DEVICE_WIFI_HOST}:${DEVICE_WIFI_PORT} 也通。已保存，直接用 WiFi 快传即可。`
      : `已连上热点「${ssid}」（密码「${pwd}」是对的），但 socket 连不通 —— ` +
        '多半是手机没从设备拿到 192.168.200.x 地址。密码这一环没问题，问题在后面。',
    ssid,
    pwd,
  );
}
