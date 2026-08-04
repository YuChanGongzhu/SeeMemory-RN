/**
 * MCU OTA 原生定时发帧路径的单测（生产路径）。
 *
 * 与 mr20Ota.test.ts 分成两个文件是因为「原生是否具备 otaSendFrames」在模块加载时
 * 就固化成了常量（isMr20OtaSenderAvailable），同一文件里没法两种都测。
 * 那个文件覆盖 JS 兜底路径，这个文件覆盖原生路径。
 */
import {Mr20Native} from '../src/native/mr20/Mr20Native';
import {Mr20Client} from '../src/native/mr20/Mr20Client';
import {asciiToBytes, base64ToBytes, bytesToAscii, isCommandFrame} from '../src/native/mr20/protocol';

// 事件源：测试里手动 emit onOtaProgress，模拟原生定时器的进度回调。
const otaProgressListeners: Array<(d: any) => void> = [];

jest.mock('../src/native/mr20/Mr20Native', () => ({
  isMr20NativeAvailable: true,
  isMr20WifiAvailable: true,
  isMr20AckWriteAvailable: true,
  isMr20OtaSenderAvailable: true, // ← 与 mr20Ota.test.ts 的唯一区别
  Mr20Native: {
    writeNoResponse: jest.fn(),
    writeWithResponse: jest.fn(),
    characteristicInfo: jest.fn(),
    maxWriteLength: jest.fn(),
    otaSendFrames: jest.fn(),
    otaAbort: jest.fn(),
  },
  mr20Emitter: {
    addListener: (name: string, cb: (d: any) => void) => {
      if (name === 'onOtaProgress') {
        otaProgressListeners.push(cb);
      }
      return {
        remove: () => {
          const i = otaProgressListeners.indexOf(cb);
          if (i >= 0) {
            otaProgressListeners.splice(i, 1);
          }
        },
      };
    },
  },
}));

function emitOtaProgress(sent: number, total: number): void {
  otaProgressListeners.slice().forEach(cb => cb({sent, total}));
}

/** 假设备：只处理命令帧（原生发帧不过 JS，故这里不会看到数据帧）。 */
function mockDevice(client: Mr20Client, overReply: 'OTA_DONE' | 'OTA_ERR' = 'OTA_DONE'): string[] {
  const commands: string[] = [];
  (Mr20Native.writeNoResponse as jest.Mock).mockImplementation(
    async (_svc: string, _ch: string, b64: string) => {
      const ascii = bytesToAscii(base64ToBytes(b64));
      if (!isCommandFrame(ascii)) {
        throw new Error(`原生发帧路径下 JS 不应再写数据帧（收到 ${ascii.length}B）`);
      }
      commands.push(ascii);
      if (ascii.startsWith('GJJY_BLE&OTA&')) {
        setTimeout(() => (client as any).onDeviceMessage({type: 'OTA_READY'}), 0);
      } else if (ascii === 'GJJY_BLE&OT&OVER') {
        setTimeout(() => (client as any).onDeviceMessage({type: overReply}), 0);
      }
    },
  );
  return commands;
}

function makeBin(n: number): Uint8Array {
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    bin[i] = (i * 7 + 3) % 256;
  }
  return bin;
}

/** 原生 otaSendFrames 的默认实现：立刻回一份「一切正常」的统计。 */
function okSummary(bin: Uint8Array, frameSize = 244, periodMs = 20) {
  const frames = Math.ceil(bin.length / frameSize);
  return {
    frames,
    sent: bin.length,
    total: bin.length,
    elapsedMs: frames * periodMs,
    avgPeriodMs: periodMs,
    maxPeriodMs: periodMs + 1,
    notReady: 0,
  };
}

describe('MCU OTA · 原生定时发帧', () => {
  beforeEach(() => {
    otaProgressListeners.length = 0;
    (Mr20Native.writeNoResponse as jest.Mock).mockReset();
    (Mr20Native.writeWithResponse as jest.Mock).mockReset();
    (Mr20Native.otaAbort as jest.Mock).mockReset().mockResolvedValue(undefined);
    (Mr20Native.maxWriteLength as jest.Mock).mockReset().mockResolvedValue({
      withoutResponse: 244,
      withResponse: 244,
    });
    (Mr20Native.characteristicInfo as jest.Mock).mockReset().mockResolvedValue({
      write: true,
      writeWithoutResponse: true,
      notify: false,
      properties: 'write+writeWithoutResponse',
      maxWithResponse: 244,
      maxWithoutResponse: 244,
    });
  });

  it('整包一次交给原生，JS 侧不再逐帧过桥', async () => {
    const client = new Mr20Client();
    const commands = mockDevice(client);
    const bin = makeBin(244 * 10 + 7);
    (Mr20Native.otaSendFrames as jest.Mock).mockResolvedValue(okSummary(bin));

    await client.otaUpdateMcu(bin, {frameIntervalMs: 20});

    // 指令仍走 JS（只有起始和结束两条），数据帧一条都没经过 writeNoResponse。
    expect(commands).toEqual(['GJJY_BLE&OTA&002447', 'GJJY_BLE&OT&OVER']);
    const [svc, ch, b64, frameSize, periodMs] = (
      Mr20Native.otaSendFrames as jest.Mock
    ).mock.calls[0];
    expect(svc).toBeTruthy();
    expect(ch).toBeTruthy();
    expect(frameSize).toBe(244);
    expect(periodMs).toBe(20);
    // 交给原生的字节必须与原始 bin 逐字节一致。
    expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(bin));
  });

  it('进度来自 onOtaProgress 事件', async () => {
    const client = new Mr20Client();
    mockDevice(client);
    const bin = makeBin(1000);
    const progress: Array<[number, number]> = [];
    (Mr20Native.otaSendFrames as jest.Mock).mockImplementation(async () => {
      emitOtaProgress(500, 1000);
      emitOtaProgress(1000, 1000);
      return okSummary(bin);
    });

    await client.otaUpdateMcu(bin, {
      frameIntervalMs: 20,
      onProgress: (sent, total) => progress.push([sent, total]),
    });

    // 首帧前的 0% + 两次事件
    expect(progress).toEqual([
      [0, 1000],
      [500, 1000],
      [1000, 1000],
    ]);
  });

  it('设备中途逐帧回话时掐掉原生定时器，并报「掉出 OTA 接收状态」', async () => {
    // 原生不看设备回话，只按点发；判死仍在 JS，靠 otaAbort 把定时器停掉，
    // 否则要对着一个已经不在接收态的设备白发满两分钟。
    const client = new Mr20Client();
    mockDevice(client);
    const bin = makeBin(244 * 500);
    (Mr20Native.otaSendFrames as jest.Mock).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          // 模拟设备对每一帧都回一条协议里没有的应答（20ms 一条，落在连击窗内）。
          const junk = asciiToBytes('GJJY_DEV&UNKNOWN');
          const timer = setInterval(() => (client as any).handleFrame(junk, ''), 1);
          (Mr20Native.otaAbort as jest.Mock).mockImplementation(async () => {
            clearInterval(timer);
            reject(Object.assign(new Error('OTA 发送已被中止'), {code: 'OTA_ABORTED'}));
          });
        }),
    );

    await expect(
      client.otaUpdateMcu(bin, {frameIntervalMs: 20}),
    ).rejects.toThrow(/掉出 OTA 接收状态/);
    expect(Mr20Native.otaAbort as jest.Mock).toHaveBeenCalled();
  });

  it('数据阶段就收到 OT&ERR 时掐掉定时器并立即终止', async () => {
    const client = new Mr20Client();
    mockDevice(client);
    const bin = makeBin(244 * 500);
    (Mr20Native.otaSendFrames as jest.Mock).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          (Mr20Native.otaAbort as jest.Mock).mockImplementation(async () => {
            reject(Object.assign(new Error('OTA 发送已被中止'), {code: 'OTA_ABORTED'}));
          });
          setTimeout(
            () => (client as any).handleFrame(asciiToBytes('GJJY_DEV&OT&ERR'), ''),
            1,
          );
        }),
    );

    await expect(
      client.otaUpdateMcu(bin, {frameIntervalMs: 20}),
    ).rejects.toThrow(/传输途中就报了结束/);
    expect(Mr20Native.otaAbort as jest.Mock).toHaveBeenCalled();
  });

  it('原生发送失败（断连等）原样报出去，不吞', async () => {
    const client = new Mr20Client();
    mockDevice(client);
    const bin = makeBin(500);
    (Mr20Native.otaSendFrames as jest.Mock).mockRejectedValue(
      new Error('OTA 发送途中连接已断开'),
    );

    await expect(client.otaUpdateMcu(bin, {frameIntervalMs: 20})).rejects.toThrow(
      /连接已断开/,
    );
  });

  it('设备回 OT&ERR 时报错并提示断电重启', async () => {
    const client = new Mr20Client();
    mockDevice(client, 'OTA_ERR');
    const bin = makeBin(500);
    (Mr20Native.otaSendFrames as jest.Mock).mockResolvedValue(okSummary(bin));

    await expect(client.otaUpdateMcu(bin, {frameIntervalMs: 20})).rejects.toThrow(
      /断电重启/,
    );
  });

  it('OTA 期间其他指令被拦下，不许挤进链路（协议：禁发其他指令）', async () => {
    const client = new Mr20Client();
    const commands = mockDevice(client);
    const bin = makeBin(500);
    // 让发帧一直挂着，模拟「正在传固件」的那两分钟。
    let finishSend: (v: unknown) => void = () => {};
    (Mr20Native.otaSendFrames as jest.Mock).mockImplementation(
      () => new Promise<unknown>(resolve => (finishSend = resolve)),
    );

    const ota = client.otaUpdateMcu(bin, {frameIntervalMs: 20});
    await new Promise<void>(r => setTimeout(() => r(), 5));
    // startRecording 不走 txChain（发了不等应答），以前会直接写进 OTA 的写队列。
    await expect(client.startRecording()).rejects.toThrow(/正在升级固件/);
    expect(commands).toEqual(['GJJY_BLE&OTA&000500']);

    finishSend(okSummary(bin));
    await ota;
    expect(commands).toEqual(['GJJY_BLE&OTA&000500', 'GJJY_BLE&OT&OVER']);
  });
});
