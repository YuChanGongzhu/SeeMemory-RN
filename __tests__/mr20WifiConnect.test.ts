/**
 * connectWifi 的配网初始化、密码选取与指令顺序单测。
 *
 * 锁的是固件方 2026-08-04 给的流程：**第一次发 SK 设置密钥，再发 BLE&WIFI&CH 初始化 WiFi，
 * 之后连接流程不变**（协议 SK&PWD 行：「后需发 GJJY_BLE&WIFI&CH 指令同步更改 WiFi 密码，
 * 需 10s 左右」）。
 *
 * 这条流程解释了真机日志里那个反直觉的现象（YLF20_f006c25b）：
 * ```
 * <= GJJY_DEV&WIFI&YLF20_f006c25b&SeeMemor   ← 设备自报的密码看着完全正确
 * ```
 * 可拿它入网照样被 iOS 拒。因为**自报的是 MCU 里存的值，WiFi 模组里真正生效的密码要等
 * WIFI&CH 才会被刷进去**——没跑过 WIFI&CH 的设备，这两个值根本不是一回事。
 *
 * 上一版实现据此得出过一个错误结论「设备报得出密码就别碰 SK」，把 SK+CH 从主路径整个删掉，
 * 于是永远连不上。这里的用例就是防它再被删回去的。
 */
import {Mr20Native} from '../src/native/mr20/Mr20Native';
import {Mr20Client} from '../src/native/mr20/Mr20Client';
import {connectWifi, rejoinWifiWithPassword} from '../src/services/mr20WifiSync';
import {runHotspotJoinTest} from '../src/services/mr20WifiDiagnose';
import {
  clearWifiProvisionedKey,
  getWifiPassword,
  getWifiProvisionedKey,
  saveWifiPassword,
  saveWifiProvisionedKey,
} from '../src/services/mr20Storage';
import {DEVICE_WIFI_DEFAULT_PWD} from '../src/services/mr20WifiSync';
import {base64ToBytes, bytesToAscii} from '../src/native/mr20/protocol';

jest.mock('../src/native/mr20/Mr20Native', () => ({
  isMr20NativeAvailable: true,
  isMr20WifiAvailable: true,
  isMr20AckWriteAvailable: true,
  isMr20OtaSenderAvailable: true,
  Mr20Native: {
    writeNoResponse: jest.fn(),
    writeWithResponse: jest.fn(),
    characteristicInfo: jest.fn(),
    maxWriteLength: jest.fn(),
    wifiJoin: jest.fn(),
    wifiLeave: jest.fn(),
  },
  mr20Emitter: {addListener: () => ({remove: () => {}})},
}));

jest.mock('../src/services/mr20Storage', () => ({
  getWifiPassword: jest.fn(),
  saveWifiPassword: jest.fn().mockResolvedValue(undefined),
  getWifiProvisionedKey: jest.fn(),
  saveWifiProvisionedKey: jest.fn().mockResolvedValue(undefined),
  clearWifiProvisionedKey: jest.fn().mockResolvedValue(undefined),
  markSynced: jest.fn().mockResolvedValue(undefined),
}));

// connectWifi 用不到入库管线，但模块导入会拉进来——挡掉，避免牵出 AsyncStorage 等原生依赖。
jest.mock('../src/services/mr20Ingest', () => ({recordSyncedFile: jest.fn()}));
jest.mock('../src/services/mr20Sync', () => ({mr20FileRelPath: () => 'x.mp3'}));

const say = (client: Mr20Client, msg: any): void =>
  (client as any).onDeviceMessage(msg);

/**
 * 假设备，按协议建模而不是照脚本念状态码——否则很容易写出「AP 早就是 2」这种
 * 现实里不存在的初态，反而把正确实现judged成错的（openWifi 见状态已是 2 就不该再发 WIFIO）。
 *
 *   初始 WIFIS = 0（关闭）
 *   收到 SK      → 回 SK&OK（可用 skReply 改成 SK&ERR / 不回）
 *   收到 WIFI&CH → 随后两次 WIFIS 依次回 4（配密码中）、6（完成），模拟协议的改密周期
 *   收到 WIFIO   → 之后 WIFIS 回 2（AP 起、无客户端）
 */
function mockDevice(
  client: Mr20Client,
  cred: {ssid: string; pwd: string} = {ssid: 'YLF20_f006c25b', pwd: ''},
  skReply: 'ok' | 'err' | 'silent' = 'ok',
): string[] {
  const commands: string[] = [];
  let chSent = false;
  let chPolls = 0;
  let wifioSent = false;
  (Mr20Native.writeNoResponse as jest.Mock).mockImplementation(
    async (_svc: string, _ch: string, b64: string) => {
      const ascii = bytesToAscii(base64ToBytes(b64));
      commands.push(ascii);
      if (ascii.startsWith('GJJY_BLE&SK&')) {
        if (skReply !== 'silent') {
          setTimeout(
            () => say(client, {type: skReply === 'ok' ? 'SK_OK' : 'SK_ERR'}),
            0,
          );
        }
      } else if (ascii === 'GJJY_BLE&WIFI&CH') {
        chSent = true;
      } else if (ascii === 'GJJY_BLE&WIFIO') {
        wifioSent = true;
        setTimeout(() => say(client, {type: 'WIFI_OPENED'}), 0);
      } else if (ascii === 'GJJY_BLE&WIFI') {
        setTimeout(() => say(client, {type: 'WIFI_CRED', ...cred}), 0);
      } else if (ascii === 'GJJY_BLE&WIFIS') {
        let s = 0;
        if (chSent && chPolls < 2) {
          chPolls += 1;
          s = chPolls === 1 ? 4 : 6;
        } else if (wifioSent) {
          s = 2;
        }
        setTimeout(() => say(client, {type: 'WIFI_STATE', state: String(s)}), 0);
      }
    },
  );
  return commands;
}

/** 推进假定时器直到 promise 落定（轮询/等待复位都靠假时钟走完）。 */
async function runWithFakeClock<T>(p: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = p.then(
    v => {
      settled = true;
      return v;
    },
    e => {
      settled = true;
      throw e;
    },
  );
  tracked.catch(() => undefined);
  for (let i = 0; i < 800 && !settled; i += 1) {
    await Promise.resolve();
    jest.advanceTimersByTime(250);
    await Promise.resolve();
  }
  return tracked;
}

describe('connectWifi · 首次配网跑 SK + WIFI&CH', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (Mr20Native.writeNoResponse as jest.Mock).mockReset();
    (Mr20Native.wifiJoin as jest.Mock).mockReset().mockResolvedValue(true);
    (getWifiPassword as jest.Mock).mockReset().mockResolvedValue(null);
    (getWifiProvisionedKey as jest.Mock).mockReset().mockResolvedValue(null);
    (saveWifiProvisionedKey as jest.Mock).mockClear();
    (clearWifiProvisionedKey as jest.Mock).mockClear();
    // 少了这一行，「上一条用例存过什么密码」会漏进下一条的 not.toHaveBeenCalledWith 断言里，
    // 表现为一条无辜的用例莫名其妙地红。
    (saveWifiPassword as jest.Mock).mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // 全文件唯一一处写死字面量，而且是**故意**的：这条锚定「出厂默认密码到底等于什么」。
  // 其余用例一律用 DEVICE_WIFI_DEFAULT_PWD——它是 toDeviceKey(MR20_PAIR_KEY) 现算的，
  // 到处抄字面量的话，哪天 MR20_PAIR_KEY 改了，会有一堆用例为了错误的理由红掉，
  // 而真正该报警的只有这一条。
  it('出厂默认密码就是绑定密钥前 8 位（SeeMemor），不是早期文档里的 12345678', () => {
    expect(DEVICE_WIFI_DEFAULT_PWD).toBe('SeeMemor');
    expect(DEVICE_WIFI_DEFAULT_PWD).not.toBe('12345678');
  });

  it('没初始化过 → 先 SK 再 WIFI&CH，最后才 WIFIO（顺序不能乱）', async () => {
    const client = new Mr20Client();
    const commands = mockDevice(client, {
      ssid: 'YLF20_f006c25b',
      pwd: DEVICE_WIFI_DEFAULT_PWD,
    });

    const res = await runWithFakeClock(connectWifi(client));

    const iSk = commands.findIndex(c => c.startsWith('GJJY_BLE&SK&'));
    const iCh = commands.indexOf('GJJY_BLE&WIFI&CH');
    const iOpen = commands.indexOf('GJJY_BLE&WIFIO');
    expect(iSk).toBeGreaterThanOrEqual(0);
    expect(iCh).toBeGreaterThan(iSk);
    // WIFI&CH 结束时设备会复位 WiFi 模组，先开的热点会被复位带走——必须排在 WIFIO 之前。
    expect(iOpen).toBeGreaterThan(iCh);
    expect(commands[iSk]).toBe(`GJJY_BLE&SK&${DEVICE_WIFI_DEFAULT_PWD}`);
    expect(res.joined).toBe(true);
  });

  it('SK&OK 后把这把密钥记为「已初始化」', async () => {
    const client = new Mr20Client();
    mockDevice(client, {ssid: 'YLF20_x', pwd: DEVICE_WIFI_DEFAULT_PWD});

    await runWithFakeClock(connectWifi(client));

    expect(saveWifiProvisionedKey).toHaveBeenCalledWith(DEVICE_WIFI_DEFAULT_PWD);
  });

  it('已经初始化过同一把密钥 → 跳过 SK 和 WIFI&CH（省 10s，也别再复位模组）', async () => {
    (getWifiProvisionedKey as jest.Mock).mockResolvedValue(DEVICE_WIFI_DEFAULT_PWD);
    const client = new Mr20Client();
    const commands = mockDevice(client, {ssid: 'YLF20_x', pwd: DEVICE_WIFI_DEFAULT_PWD});

    await runWithFakeClock(connectWifi(client));

    expect(commands.some(c => c.startsWith('GJJY_BLE&SK&'))).toBe(false);
    expect(commands).not.toContain('GJJY_BLE&WIFI&CH');
    expect(commands).toContain('GJJY_BLE&WIFIO');
  });

  it('本地密码换了一把 → 旧的「已初始化」标记失效，重新跑一遍', async () => {
    (getWifiPassword as jest.Mock).mockResolvedValue('newpwd12');
    (getWifiProvisionedKey as jest.Mock).mockResolvedValue(DEVICE_WIFI_DEFAULT_PWD);
    const client = new Mr20Client();
    const commands = mockDevice(client, {ssid: 'YLF20_x', pwd: DEVICE_WIFI_DEFAULT_PWD});

    await runWithFakeClock(connectWifi(client));

    expect(commands).toContain('GJJY_BLE&SK&newpwd12');
    expect(commands).toContain('GJJY_BLE&WIFI&CH');
  });

  it('SK&ERR → 不发 WIFI&CH（同步过去也是我们不知道的那把密钥），也不记「已初始化」', async () => {
    const client = new Mr20Client();
    const commands = mockDevice(client, {ssid: 'YLF20_x', pwd: '87654321'}, 'err');

    const res = await runWithFakeClock(connectWifi(client));

    expect(commands).not.toContain('GJJY_BLE&WIFI&CH');
    expect(saveWifiProvisionedKey).not.toHaveBeenCalled();
    // 但快传本身不能因此中断——设备多半仍能用它自报的密码连上。
    expect(commands).toContain('GJJY_BLE&WIFIO');
    expect(res.joined).toBe(true);
    expect(res.pwd).toBe('87654321');
  });
});

describe('connectWifi · 密码候选顺序', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (Mr20Native.writeNoResponse as jest.Mock).mockReset();
    (Mr20Native.wifiJoin as jest.Mock).mockReset().mockResolvedValue(true);
    (getWifiPassword as jest.Mock).mockReset().mockResolvedValue(null);
    (getWifiProvisionedKey as jest.Mock).mockReset().mockResolvedValue(null);
    (clearWifiProvisionedKey as jest.Mock).mockClear();
    // 少了这一行，「上一条用例存过什么密码」会漏进下一条的 not.toHaveBeenCalledWith 断言里，
    // 表现为一条无辜的用例莫名其妙地红。
    (saveWifiPassword as jest.Mock).mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('刚跑完 WIFI&CH → 用刚刷进模组的那把，而不是开热点前读到的旧自报值', async () => {
    (getWifiPassword as jest.Mock).mockResolvedValue('newpwd12');
    const client = new Mr20Client();
    mockDevice(client, {ssid: 'YLF20_x', pwd: 'oldpwd99'});

    const res = await runWithFakeClock(connectWifi(client));

    expect((Mr20Native.wifiJoin as jest.Mock).mock.calls[0][1]).toBe('newpwd12');
    expect(res.pwd).toBe('newpwd12');
  });

  it('没跑初始化时，设备自报的排第一', async () => {
    (getWifiPassword as jest.Mock).mockResolvedValue('abcd1234');
    (getWifiProvisionedKey as jest.Mock).mockResolvedValue('abcd1234');
    const client = new Mr20Client();
    mockDevice(client, {ssid: 'YLF20_x', pwd: '87654321'});
    (Mr20Native.wifiJoin as jest.Mock)
      .mockResolvedValueOnce(false) // 设备自报的 87654321 被拒
      .mockResolvedValueOnce(true); // 本地存的 abcd1234 成功

    const res = await runWithFakeClock(connectWifi(client));

    expect(res.pwd).toBe('abcd1234');
    const tried = (Mr20Native.wifiJoin as jest.Mock).mock.calls.map(c => c[1]);
    expect(tried).toEqual(['87654321', 'abcd1234']);
  });

  it('候选相同时去重，只尝试一次入网', async () => {
    (getWifiPassword as jest.Mock).mockResolvedValue(DEVICE_WIFI_DEFAULT_PWD);
    (getWifiProvisionedKey as jest.Mock).mockResolvedValue(DEVICE_WIFI_DEFAULT_PWD);
    const client = new Mr20Client();
    mockDevice(client, {ssid: 'YLF20_x', pwd: DEVICE_WIFI_DEFAULT_PWD});
    (Mr20Native.wifiJoin as jest.Mock).mockResolvedValue(false);

    await runWithFakeClock(connectWifi(client));

    // 猜错一次就弹一个 iOS 模态框、烧掉几秒 30s 窗口，重复尝试同一个值是净损失。
    expect(Mr20Native.wifiJoin).toHaveBeenCalledTimes(1);
  });

  it('原生带原因 reject 时，原因要落进日志（不能被 catch 吞掉）', async () => {
    const client = new Mr20Client();
    const logs: string[] = [];
    client.on('log', (l: string) => logs.push(l));
    mockDevice(client, {ssid: 'YLF20_x', pwd: DEVICE_WIFI_DEFAULT_PWD});
    (Mr20Native.wifiJoin as jest.Mock).mockRejectedValue(
      new Error('入网失败（密码不符 / 热点未广播 / 信号不可达）'),
    );

    await runWithFakeClock(connectWifi(client));

    // 只 resolve(false) 的话这行永远不存在，排查就只剩「无法加入网络」一句废话。
    expect(logs.some(l => l.includes('热点未广播'))).toBe(true);
  });

  it('全试完都连不上 → 记下试过哪些，并作废「已初始化」标记让下次重跑 WIFI&CH', async () => {
    (getWifiProvisionedKey as jest.Mock).mockResolvedValue(DEVICE_WIFI_DEFAULT_PWD);
    const client = new Mr20Client();
    const logs: string[] = [];
    client.on('log', (l: string) => logs.push(l));
    mockDevice(client, {ssid: 'YLF20_x', pwd: DEVICE_WIFI_DEFAULT_PWD});
    (Mr20Native.wifiJoin as jest.Mock).mockResolvedValue(false);

    const res = await runWithFakeClock(connectWifi(client));

    expect(res.joined).toBe(false);
    const failLine = logs.find(l => l.includes('已试密码'));
    expect(failLine).toBeDefined();
    expect(failLine).toContain(DEVICE_WIFI_DEFAULT_PWD);
    expect(failLine).toContain('YLF20_x');
    // 不清掉的话，会永远拿着一个从没生效过的密码撞同一堵墙。
    expect(clearWifiProvisionedKey).toHaveBeenCalled();
  });

  // 真机日志（18:12:49 热点就绪 → 18:13:51 才有下一行，中间空白 61.93s）暴露的问题：
  // 每个候选密码最多耗 20s，而协议给热点的空闲窗口只有 30s。排到第三个时热点早被设备
  // 自己关了，那次尝试**必然失败且与密码无关**，纯属白等 20 秒。
  it('热点 30s 空闲窗口用完后，剩下的候选密码不再试（试了也没意义）', async () => {
    (getWifiPassword as jest.Mock).mockResolvedValue('localpwd');
    (getWifiProvisionedKey as jest.Mock).mockResolvedValue('localpwd'); // 跳过 SK+CH
    const client = new Mr20Client();
    const logs: string[] = [];
    client.on('log', (l: string) => logs.push(l));
    // 三个互不相同的候选：设备自报的、本地存的、出厂兜底的。
    mockDevice(client, {ssid: 'YLF20_x', pwd: 'devpwdAA'});
    // 每次入网都耗满 20s 才失败——这正是真机的表现。
    (Mr20Native.wifiJoin as jest.Mock).mockImplementation(
      () => new Promise(r => setTimeout(() => r(false), 20000)),
    );

    const res = await runWithFakeClock(connectWifi(client));

    expect(res.joined).toBe(false);
    // 2 次就该收手：第 3 次开始时已经过了 40s > 30s 窗口。
    expect((Mr20Native.wifiJoin as jest.Mock).mock.calls.length).toBe(2);
    expect(logs.some(l => l.includes('空闲窗口已用完'))).toBe(true);
    // 窗口关了之后的失败和密码对不对无关，不能拿它去作废「已初始化」标记——
    // 否则下次快传还得白跑 10s 的 SK + WIFI&CH。
    expect(clearWifiProvisionedKey).not.toHaveBeenCalled();
  });

  // WIFI&CH 的收尾会复位 WiFi 模组，热点是带着复位之后的配置起来的。所以开热点**之前**读到的
  // 那份凭据属于上一个配置世代，必须在热点起来之后再读一次——早先只在第一次读空时才补读，
  // 等于在跑过 CH 的情况下必然拿旧值去入网，而这恰恰是最需要新值的场合。
  it('热点起来之后必定重读一次 GJJY_BLE&WIFI（哪怕开热点前已经读到了）', async () => {
    (getWifiProvisionedKey as jest.Mock).mockResolvedValue(DEVICE_WIFI_DEFAULT_PWD);
    const client = new Mr20Client();
    // 开热点前那次就能读到非空值——旧实现到这儿就不会再读了。
    const commands = mockDevice(client, {ssid: 'YLF20_x', pwd: DEVICE_WIFI_DEFAULT_PWD});

    await runWithFakeClock(connectWifi(client));

    const iOpen = commands.indexOf('GJJY_BLE&WIFIO');
    expect(iOpen).toBeGreaterThanOrEqual(0);
    expect(commands.indexOf('GJJY_BLE&WIFI', iOpen)).toBeGreaterThan(iOpen);
    // 一次在开热点前（拿 SSID 用）、一次在热点起来之后（拿当前世代的密码）。
    expect(commands.filter(c => c === 'GJJY_BLE&WIFI').length).toBe(2);
  });

  // 热点开着时设备自己就能报出密码，没有理由让用户去猜或者去问固件方——
  // 但前提是这个值得**从 connectWifi 里带出来**，否则它只存在于协议日志里，界面拿不到。
  it('设备自报的密码要随结果返回（入网失败时界面要拿它预填手输框）', async () => {
    (getWifiProvisionedKey as jest.Mock).mockResolvedValue(DEVICE_WIFI_DEFAULT_PWD);
    const client = new Mr20Client();
    mockDevice(client, {ssid: 'YLF20_x', pwd: 'devSaysX'});
    (Mr20Native.wifiJoin as jest.Mock).mockResolvedValue(false);

    const res = await runWithFakeClock(connectWifi(client));

    expect(res.joined).toBe(false);
    expect(res.reported).toBe('devSaysX');
  });

  // 手输密码兜底：自动入网的候选只来自「设备自报 / 本地存过 / 出厂默认」，真实密码不在
  // 其中时自动重试永远是同一批错密码，只能让用户自己填一个进来。
  it('手输密码重试：必须先把热点重新开一遍再连（此时 30s 窗口早过了）', async () => {
    const client = new Mr20Client();
    const commands = mockDevice(client, {ssid: 'YLF20_x', pwd: 'devpwdAA'});
    (Mr20Native.wifiJoin as jest.Mock).mockResolvedValue(true);
    (saveWifiPassword as jest.Mock).mockClear();

    const r = await runWithFakeClock(
      rejoinWifiWithPassword(client, 'YLF20_x', 'myPwd123'),
    );

    expect(r.joined).toBe(true);
    // 不重开的话，是拿着正确的密码去连一个已经被设备自己关掉的热点，
    // 然后得出「这个密码也不对」的错误结论。
    const iOpen = commands.indexOf('GJJY_BLE&WIFIO');
    expect(iOpen).toBeGreaterThanOrEqual(0);
    expect(Mr20Native.wifiJoin).toHaveBeenCalledWith(
      'YLF20_x',
      'myPwd123',
      expect.any(Number),
    );
    // 成功就存下来，下次快传第一顺位用它，不必再让用户输一遍。
    expect(saveWifiPassword).toHaveBeenCalledWith('myPwd123');
  });

  it('手输密码也连不上 → 返回 joined=false，且不把它存成本地密码', async () => {
    const client = new Mr20Client();
    mockDevice(client, {ssid: 'YLF20_x', pwd: 'devpwdAA'});
    (Mr20Native.wifiJoin as jest.Mock).mockResolvedValue(false);
    (saveWifiPassword as jest.Mock).mockClear();

    const r = await runWithFakeClock(
      rejoinWifiWithPassword(client, 'YLF20_x', 'wrongPwd'),
    );

    expect(r.joined).toBe(false);
    // 存错的密码会污染下次快传的候选首位，白烧一次 20s 的入网超时。
    expect(saveWifiPassword).not.toHaveBeenCalled();
  });

  // 「手动输入密码连接热点」是一把**只读的验证工具**：它存在的意义就是「随便试，试不坏」。
  // 一旦它开始发写指令（SK / WIFI&CH），用户为了排查连点几次就会把设备配置改得面目全非，
  // 排查本身反倒成了新的变量。
  it('手动测密码：只发 WIFIO/WIFI/WIFIS，绝不发 SK 或 WIFI&CH', async () => {
    const client = new Mr20Client();
    const commands = mockDevice(client, {ssid: 'YLF20_x', pwd: 'devSaysX'});
    (Mr20Native.wifiJoin as jest.Mock).mockResolvedValue(true);
    (Mr20Native.wifiLeave as jest.Mock).mockResolvedValue(undefined);

    await runWithFakeClock(runHotspotJoinTest(client, 'myPwd123'));

    expect(commands).toContain('GJJY_BLE&WIFIO');
    expect(commands).toContain('GJJY_BLE&WIFI');
    expect(commands.some(c => c.startsWith('GJJY_BLE&SK&'))).toBe(false);
    expect(commands).not.toContain('GJJY_BLE&WIFI&CH');
    // 用的必须是**用户输的那个**，不能被设备自报值或出厂默认顶掉——
    // 顶掉的话这个工具就答不了「我这个密码到底行不行」这个唯一的问题了。
    expect(Mr20Native.wifiJoin).toHaveBeenCalledTimes(1);
    expect(Mr20Native.wifiJoin).toHaveBeenCalledWith(
      'YLF20_x',
      'myPwd123',
      expect.any(Number),
    );
  });

  it('手动测密码：日志要写清设备自报值和用户输入不一致', async () => {
    const client = new Mr20Client();
    mockDevice(client, {ssid: 'YLF20_x', pwd: 'devSaysX'});
    (Mr20Native.wifiJoin as jest.Mock).mockResolvedValue(false);
    (Mr20Native.wifiLeave as jest.Mock).mockResolvedValue(undefined);

    const r = await runWithFakeClock(runHotspotJoinTest(client, 'myPwd123'));

    expect(r.ok).toBe(false);
    // 这一行是整份日志里最有价值的：先看设备说的和你输的是不是同一个，再谈别的。
    expect(r.lines.some(l => l.includes('devSaysX') && l.includes('myPwd123'))).toBe(true);
    // 失败时不能把这个没验证过的密码存成本地密码，否则污染下次快传的候选首位。
    expect(saveWifiPassword).not.toHaveBeenCalledWith('myPwd123');
  });

  it('入网这段不走蓝牙，进出口都要留痕（否则日志上是几十秒的纯黑）', async () => {
    (getWifiProvisionedKey as jest.Mock).mockResolvedValue(DEVICE_WIFI_DEFAULT_PWD);
    const client = new Mr20Client();
    const logs: string[] = [];
    client.on('log', (l: string) => logs.push(l));
    mockDevice(client, {ssid: 'YLF20_x', pwd: DEVICE_WIFI_DEFAULT_PWD});
    // 旧版原生 resolve(false) 而不是 reject：那样 .catch 不触发，这次尝试会一点痕迹不留。
    (Mr20Native.wifiJoin as jest.Mock).mockResolvedValue(false);

    await runWithFakeClock(connectWifi(client));

    expect(logs.some(l => l.includes('加入热点「YLF20_x」…'))).toBe(true);
    expect(logs.some(l => l.includes('没能入网'))).toBe(true);
  });
});
