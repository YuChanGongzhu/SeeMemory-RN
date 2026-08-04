/**
 * `SK&RESET` 重置密钥 + 重连的单测。
 *
 * 这条流程有两个必须锁死的点，都不是「代码能跑」层面的：
 *   1. **发的是 `GJJY_BLE&SK&RESET`，绝不能是 `GJJY_BLE&BLE&RESET`。**
 *      协议 0801 里后者写着「断开 BLE 连接，格式化磁盘」——发错一次，用户设备上的录音全没。
 *      两条命令长得几乎一样，靠人眼 review 迟早出事，所以在这儿写死。
 *   2. **重连必须夹在 SK&RESET 和新 SK 之间。** 协议 SK&PWD 行：「BLE 连接之后第一次发送为
 *      设置密钥」——在被重置指令打断的旧链路上接着发 SK 是发不出去的。
 */
import {Mr20Native} from '../src/native/mr20/Mr20Native';
import {Mr20Client} from '../src/native/mr20/Mr20Client';
import {base64ToBytes, bytesToAscii} from '../src/native/mr20/protocol';
import {splitStamp} from '../src/components/mr20/Mr20DebugLog';

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
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(async () => undefined),
    monitor: jest.fn(async () => undefined),
    stopScan: jest.fn(async () => undefined),
  },
  mr20Emitter: {addListener: () => ({remove: () => {}})},
}));

const say = (client: Mr20Client, msg: any): void =>
  (client as any).onDeviceMessage(msg);

/**
 * 时间线：命令用 `>` 前缀，原生连接动作用 `native:` 前缀，合在一条数组里好断言先后。
 *
 * `probeAnswers` 传数字 = **前 N 条 FW 装死，第 N+1 条才回**，用来模拟真机上最要命的那种情形：
 * SK&RESET 之后 GATT 秒连上了，固件却还在重启、连着好几秒不吭声。
 */
function mockDevice(
  client: Mr20Client,
  opts: {probeAnswers?: boolean | number; disconnectsOnReset?: boolean} = {},
) {
  const {probeAnswers = true, disconnectsOnReset = false} = opts;
  let fwSeen = 0;
  const timeline: string[] = [];
  (Mr20Native.connect as jest.Mock).mockImplementation(async () => {
    timeline.push('native:connect');
  });
  (Mr20Native.disconnect as jest.Mock).mockImplementation(async () => {
    timeline.push('native:disconnect');
  });
  (Mr20Native.writeNoResponse as jest.Mock).mockImplementation(
    async (_svc: string, _ch: string, b64: string) => {
      const ascii = bytesToAscii(base64ToBytes(b64));
      timeline.push(`>${ascii}`);
      if (ascii === 'GJJY_BLE&SK&RESET' && disconnectsOnReset) {
        // 协议：「如连接将断开连接」。照做的固件长这样。
        setTimeout(() => (client as any).handleDisconnect('SK&RESET'), 0);
      }
      if (ascii === 'GJJY_BLE&FW') {
        fwSeen += 1;
        const answers =
          typeof probeAnswers === 'number' ? fwSeen > probeAnswers : probeAnswers;
        if (answers) {
          setTimeout(() => say(client, {type: 'FIRMWARE', version: '1.0'}), 0);
        }
      } else if (ascii.startsWith('GJJY_BLE&SK&') && ascii !== 'GJJY_BLE&SK&RESET') {
        setTimeout(() => say(client, {type: 'SK_OK'}), 0);
      }
    },
  );
  return timeline;
}

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
  for (let i = 0; i < 400 && !settled; i += 1) {
    await Promise.resolve();
    jest.advanceTimersByTime(250);
    await Promise.resolve();
  }
  return tracked;
}

describe('resetDeviceKeyAndReconnect · 协议 0801', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('发 SK&RESET → 断开 → 重连 → 再发新 SK，顺序不能乱', async () => {
    const client = new Mr20Client();
    const timeline = mockDevice(client);
    await runWithFakeClock(client.connect('dev-1', 'YLF20_f006c25b'));

    await runWithFakeClock(client.resetDeviceKeyAndReconnect());
    await runWithFakeClock(client.setBindKey('SeeMemor'));

    const iReset = timeline.indexOf('>GJJY_BLE&SK&RESET');
    const iDisc = timeline.indexOf('native:disconnect');
    // 首次 connect 也会 push 一条，重连是第二条。
    const iReconnect = timeline.indexOf('native:connect', iReset);
    const iNewKey = timeline.indexOf('>GJJY_BLE&SK&SeeMemor');

    expect(iReset).toBeGreaterThanOrEqual(0);
    expect(iDisc).toBeGreaterThan(iReset);
    expect(iReconnect).toBeGreaterThan(iDisc);
    expect(iNewKey).toBeGreaterThan(iReconnect);
  });

  it('全程不出现 BLE&RESET（那条会格式化磁盘）', async () => {
    const client = new Mr20Client();
    const timeline = mockDevice(client);
    await runWithFakeClock(client.connect('dev-1', 'YLF20_f006c25b'));
    await runWithFakeClock(client.resetDeviceKeyAndReconnect());

    expect(timeline).not.toContain('>GJJY_BLE&BLE&RESET');
    expect(timeline.filter(t => t.includes('RESET'))).toEqual([
      '>GJJY_BLE&SK&RESET',
    ]);
  });

  it('GATT 连上但固件还在重启（前 3 次探测装死）→ 继续等，等到就绪为止', async () => {
    const client = new Mr20Client();
    const timeline = mockDevice(client, {probeAnswers: 3});
    await runWithFakeClock(client.connect('dev-1', 'YLF20_f006c25b'));

    // 只打一枪就下结论的话这里会是 false，然后整个自检被判成「蓝牙链路本身不通」——
    // 真机上就是这么误报的，而链路其实好好的，只是设备还没启动完。
    const r = await runWithFakeClock(client.resetDeviceKeyAndReconnect());
    expect(r.ready).toBe(true);
    expect(timeline.filter(t => t === '>GJJY_BLE&FW').length).toBeGreaterThan(3);
  });

  it('重连后设备对裸连静默也不抛错——真正的判据是紧接着那条 SK', async () => {
    const client = new Mr20Client();
    mockDevice(client, {probeAnswers: false});
    await runWithFakeClock(client.connect('dev-1', 'YLF20_f006c25b'));

    const r = await runWithFakeClock(client.resetDeviceKeyAndReconnect());
    expect(r.ready).toBe(false);
  });

  // ---- 「设备断没断」是这条无应答命令唯一的可观测后果，不能被我们自己的 disconnect 抹掉 ----

  it('设备照协议自己断链 → droppedByDevice=true', async () => {
    const client = new Mr20Client();
    mockDevice(client, {disconnectsOnReset: true});
    await runWithFakeClock(client.connect('dev-1', 'YLF20_f006c25b'));

    const r = await runWithFakeClock(client.resetDeviceKeyAndReconnect());
    expect(r.droppedByDevice).toBe(true);
  });

  it('设备赖着不断 → droppedByDevice=false（固件多半忽略了这条命令）', async () => {
    const client = new Mr20Client();
    mockDevice(client, {disconnectsOnReset: false});
    await runWithFakeClock(client.connect('dev-1', 'YLF20_f006c25b'));

    // 早先无条件先 disconnect()，两种情况的日志一模一样，等于把唯一的证据擦掉了。
    const r = await runWithFakeClock(client.resetDeviceKeyAndReconnect());
    expect(r.droppedByDevice).toBe(false);
  });

  // 日志时间戳的格式是 Mr20Client.log 和调试面板之间的**隐式契约**：面板靠正则把前缀
  // 拆出来单独调暗，并且要按剩下的正文开头判方向色。改了格式而不改正则，面板不会报错，
  // 只会安静地退化成「整行同色 + 时间戳跟帧内容抢眼睛」——正是当初加时间戳要解决的问题。
  it('每行日志都带 [时钟 +间隔]，且调试面板能原样拆开', async () => {
    const client = new Mr20Client();
    mockDevice(client);
    const lines: string[] = [];
    client.on('log', l => lines.push(l));
    await runWithFakeClock(client.connect('dev-1', 'YLF20_f006c25b'));
    await runWithFakeClock(client.getFirmware());

    const sent = lines.find(l => l.includes('=> GJJY_BLE&FW'));
    expect(sent).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3} \+\d+\.\d{2}s\] /);

    const {stamp, body} = splitStamp(sent!);
    expect(stamp).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3} \+\d+\.\d{2}s\]$/);
    // 方向色判的是正文开头——前缀必须被摘干净，否则所有行都会退成同一个颜色。
    expect(body.startsWith('=>')).toBe(true);
  });

  it('没连设备时直接抛错，不会盲发重置指令', async () => {
    const client = new Mr20Client();
    const timeline = mockDevice(client);
    await expect(client.resetDeviceKeyAndReconnect()).rejects.toThrow(
      /没有已连接的设备/,
    );
    expect(timeline).toEqual([]);
  });
});
