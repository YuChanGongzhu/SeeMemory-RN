/**
 * MCU OTA 发送逻辑单测 —— 用假原生模块捕获实际写出的帧。
 * 真机验收阻塞于固件方提供 ≤1MB 的 OTA 专用 bin，故此处以回环测覆盖协议关键点：
 * OTA&<LEN 6位> 发起 → 等 DEV&OTA → 244B/帧顺序发送 → OT&OVER 收尾。
 */
import {Mr20Native} from '../src/native/mr20/Mr20Native';
import {Mr20Client} from '../src/native/mr20/Mr20Client';
import {asciiToBytes, base64ToBytes, bytesToAscii, isCommandFrame} from '../src/native/mr20/protocol';

jest.mock('../src/native/mr20/Mr20Native', () => ({
  isMr20NativeAvailable: true,
  isMr20WifiAvailable: true,
  isMr20AckWriteAvailable: true,
  Mr20Native: {
    writeNoResponse: jest.fn(),
    writeWithResponse: jest.fn(),
    characteristicInfo: jest.fn(),
    maxWriteLength: jest.fn(),
  },
  mr20Emitter: {addListener: jest.fn(() => ({remove: () => {}}))},
}));

type Writer = (svc: string, ch: string, b64: string) => Promise<void>;
type Captured = {commands: string[]; frames: Uint8Array[]};

/**
 * 装一个假设备：命令帧记进 commands、二进制帧记进 frames；
 * 收到 OTA&LEN 回 OTA_READY，收到 OT&OVER 回 overReply（默认成功）。
 *
 * 同一个 handler 同时装在 writeNoResponse 和 writeWithResponse 上：指令走前者，
 * OTA 数据帧走后者（生产路径），断言不必关心走的是哪条。
 */
function mockDevice(client: Mr20Client, overReply: 'OTA_DONE' | 'OTA_ERR' = 'OTA_DONE'): Captured {
  const cap: Captured = {commands: [], frames: []};
  const handler: Writer = async (_svc, _ch, b64) => {
    const bytes = base64ToBytes(b64);
    const ascii = bytesToAscii(bytes);
    if (isCommandFrame(ascii)) {
      cap.commands.push(ascii);
      if (ascii.startsWith('GJJY_BLE&OTA&')) {
        setTimeout(() => (client as any).onDeviceMessage({type: 'OTA_READY'}), 0);
      } else if (ascii === 'GJJY_BLE&OT&OVER') {
        setTimeout(() => (client as any).onDeviceMessage({type: overReply}), 0);
      }
    } else {
      cap.frames.push(bytes);
    }
  };
  (Mr20Native.writeNoResponse as jest.Mock).mockImplementation(handler);
  (Mr20Native.writeWithResponse as jest.Mock).mockImplementation(handler);
  return cap;
}

/** 在假设备之上再套一层：每写出一个数据帧后执行 after（用于模拟设备乱回话）。 */
function afterEachDataFrame(cb: (b64: string) => void): void {
  for (const m of [Mr20Native.writeWithResponse, Mr20Native.writeNoResponse] as jest.Mock[]) {
    const inner = m.getMockImplementation()! as Writer;
    m.mockImplementation(async (svc: string, ch: string, b64: string) => {
      await inner(svc, ch, b64);
      if (!isCommandFrame(bytesToAscii(base64ToBytes(b64)))) {
        cb(b64);
      }
    });
  }
}

function makeBin(n: number): Uint8Array {
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    bin[i] = (i * 7 + 3) % 256; // 非 0 且非 'GJJY_' 开头，避免被当成命令帧
  }
  return bin;
}

describe('MCU OTA', () => {
  beforeEach(() => {
    (Mr20Native.writeNoResponse as jest.Mock).mockReset();
    (Mr20Native.writeWithResponse as jest.Mock).mockReset();
    // 默认 MTU 足够；不足的场景在专门的用例里覆盖。
    (Mr20Native.maxWriteLength as jest.Mock).mockReset().mockResolvedValue({
      withoutResponse: 244,
      withResponse: 244,
    });
    // 默认写特征支持带应答写（真机 001120a2 的预期能力）。
    (Mr20Native.characteristicInfo as jest.Mock).mockReset().mockResolvedValue({
      write: true,
      writeWithoutResponse: true,
      notify: false,
      properties: 'write+writeWithoutResponse',
      maxWithResponse: 244,
      maxWithoutResponse: 244,
    });
  });

  it('MTU 不足单帧长度时直接终止，不发任何指令', async () => {
    // iOS 常见协商结果 182 < 244：超长写会被 CoreBluetooth 静默截断，
    // 设备收不满 LEN，表现为「App 进度 100% 但设备立刻回 OT&ERR」。
    (Mr20Native.maxWriteLength as jest.Mock).mockResolvedValue({
      withoutResponse: 182,
      withResponse: 182,
    });
    const client = new Mr20Client();
    const cap = mockDevice(client);
    await expect(client.otaUpdateMcu(makeBin(500))).rejects.toThrow(/MTU 不足/);
    expect(cap.commands).toEqual([]);
    expect(cap.frames).toEqual([]);
  });

  it('按 244B 切片、顺序完整、以 OTA&LEN 开头 OT&OVER 收尾', async () => {
    const client = new Mr20Client();
    const cap = mockDevice(client);
    const bin = makeBin(500); // 244 + 244 + 12

    const progress: Array<[number, number]> = [];
    await client.otaUpdateMcu(bin, {
      frameIntervalMs: 0,
      onProgress: (sent, total) => progress.push([sent, total]),
    });

    // 发起指令 LEN 必须补足 6 位
    expect(cap.commands[0]).toBe('GJJY_BLE&OTA&000500');
    expect(cap.commands[cap.commands.length - 1]).toBe('GJJY_BLE&OT&OVER');
    // 只有这两条命令，中间不夹杂其它指令（协议：OTA 期间禁发其他指令）
    expect(cap.commands).toHaveLength(2);
    // 帧切片：244/244/12
    expect(cap.frames.map(f => f.length)).toEqual([244, 244, 12]);
    // 拼回去必须与原始 bin 逐字节一致（顺序 + 内容）
    const joined = new Uint8Array(bin.length);
    let off = 0;
    for (const f of cap.frames) {
      joined.set(f, off);
      off += f.length;
    }
    expect(Array.from(joined)).toEqual(Array.from(bin));
    // 进度最终到满
    expect(progress[progress.length - 1]).toEqual([500, 500]);
  });

  it('整除时不产生空尾帧', async () => {
    const client = new Mr20Client();
    const cap = mockDevice(client);
    await client.otaUpdateMcu(makeBin(488), {frameIntervalMs: 0}); // 正好 2 帧
    expect(cap.frames.map(f => f.length)).toEqual([244, 244]);
    expect(cap.commands[0]).toBe('GJJY_BLE&OTA&000488');
  });

  it('超过 1MB（LEN 6 位上限）直接拒绝，不发任何指令', async () => {
    const client = new Mr20Client();
    const cap = mockDevice(client);
    await expect(client.otaUpdateMcu(makeBin(1000000), {frameIntervalMs: 0})).rejects.toThrow(/1MB/);
    expect(cap.commands).toHaveLength(0);
    expect(cap.frames).toHaveLength(0);
  });

  it('空固件直接拒绝', async () => {
    const client = new Mr20Client();
    mockDevice(client);
    await expect(client.otaUpdateMcu(new Uint8Array(0), {frameIntervalMs: 0})).rejects.toThrow(/固件为空/);
  });

  it('设备把固件数据当指令逐帧回话时提前终止，不把 3536 帧发满', async () => {
    // 真机现象：设备对每一帧固件数据都回 GJJY_DEV&UNKNOWN（协议里没有这条应答），
    // 说明它没进入 OTA 接收态。此时发满全部帧要 110s，最后照样 OT&ERR，纯属白等。
    const client = new Mr20Client();
    const cap = mockDevice(client);
    const junk = asciiToBytes('GJJY_DEV&UNKNOWN');
    afterEachDataFrame(() => (client as any).handleFrame(junk, ''));

    await expect(
      client.otaUpdateMcu(makeBin(244 * 200), {frameIntervalMs: 0}),
    ).rejects.toThrow(/第 1\/200 帧掉出 OTA 接收状态/);
    // 判死阈值是 16 帧，留些余量；关键是远小于 200 帧。
    expect(cap.frames.length).toBeLessThan(30);
  });

  it('数据阶段就收到 OT&ERR 时立即终止，不再干等 OT&OVER 应答', async () => {
    // 这条应答来时没有 collector 在等，会被丢掉；不记下来的话后面会对着一个
    // 永远不会再来的应答干等 180 秒。
    const client = new Mr20Client();
    const cap = mockDevice(client);
    let dataFrames = 0;
    afterEachDataFrame(() => {
      dataFrames += 1;
      if (dataFrames === 3) {
        (client as any).handleFrame(asciiToBytes('GJJY_DEV&OT&ERR'), '');
      }
    });

    await expect(
      client.otaUpdateMcu(makeBin(244 * 50), {frameIntervalMs: 0}),
    ).rejects.toThrow(/传输途中就报了结束/);
    expect(cap.frames.length).toBeLessThan(10);
  });

  it('固件帧和指令一律走无应答写，绝不走带应答写', async () => {
    // 2026-08-02 固件方反馈：改带应答写（ATT Write Request）后它们收到的帧长变成
    // 65527、累计两百多 M。文档描述的就是无应答写，别再往链路里塞别的写类型。
    const client = new Mr20Client();
    mockDevice(client);
    await client.otaUpdateMcu(makeBin(500), {frameIntervalMs: 0});
    expect(Mr20Native.writeWithResponse as jest.Mock).not.toHaveBeenCalled();
    // 3 个数据帧 + OTA&LEN + OT&OVER
    expect((Mr20Native.writeNoResponse as jest.Mock).mock.calls).toHaveLength(5);
  });

  it('写特征不支持无应答写时直接终止，不发任何指令', async () => {
    (Mr20Native.characteristicInfo as jest.Mock).mockResolvedValue({
      write: true,
      writeWithoutResponse: false,
      notify: false,
      properties: 'write',
      maxWithResponse: 512,
      maxWithoutResponse: 0,
    });
    const client = new Mr20Client();
    const cap = mockDevice(client);
    await expect(
      client.otaUpdateMcu(makeBin(500), {frameIntervalMs: 0}),
    ).rejects.toThrow(/不支持无应答写/);
    expect(cap.commands).toEqual([]);
    expect(cap.frames).toEqual([]);
  });

  it('按文档节流：每帧之间真的等了 frameIntervalMs', async () => {
    // 「每帧数据至少间隔 8MS 以上，IOS 建议 20MS」是设备消化一帧所需的时间。
    const client = new Mr20Client();
    mockDevice(client);
    const startedAt = Date.now();
    await client.otaUpdateMcu(makeBin(244 * 5), {frameIntervalMs: 20});
    // 5 帧 → 帧间等 4 次；留足余量只断言下界。
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(60);
  });

  it('帧周期按帧首到帧首算：写入慢时挤占等待，不是写完再睡满 20ms', async () => {
    // iOS 侧要求帧节奏严格在 20ms 内。写一帧本身要过 RN 桥（这里用 8ms 模拟），
    // 若实现是「写完再 setTimeout(20)」，周期就会变成 28ms+ —— 那正是要防的回归。
    const client = new Mr20Client();
    mockDevice(client);
    const at: number[] = [];
    afterEachDataFrame(() => at.push(Date.now()));
    const inner = (Mr20Native.writeNoResponse as jest.Mock).getMockImplementation()!;
    (Mr20Native.writeNoResponse as jest.Mock).mockImplementation(
      async (svc: string, ch: string, b64: string) => {
        await new Promise<void>(r => setTimeout(r, 8));
        return inner(svc, ch, b64);
      },
    );

    await client.otaUpdateMcu(makeBin(244 * 16), {frameIntervalMs: 20});

    expect(at).toHaveLength(16);
    const periods = at.slice(1).map((t, i) => t - at[i]).sort((a, b) => a - b);
    // 用中位数而不是最大值：机器一忙 setTimeout 就会飘出个别 30ms+ 的尖峰，
    // 拿最大值断言必然偶发失败。要抓的回归是「写完再睡满 20ms」——那会把
    // 整条分布抬到 28ms 以上，中位数一样抓得住，且不受单点尖峰影响。
    const median = periods[Math.floor(periods.length / 2)];
    expect(median).toBeLessThanOrEqual(24);
    // 下界：也不能为了追进度连发，把间隔挤到协议下限 8ms 以下。
    expect(periods[0]).toBeGreaterThanOrEqual(8);
  });

  it('设备回 OT&ERR 时报错并提示断电重启', async () => {
    const client = new Mr20Client();
    mockDevice(client, 'OTA_ERR');
    await expect(client.otaUpdateMcu(makeBin(300), {frameIntervalMs: 0})).rejects.toThrow(/断电重启/);
  });
});
