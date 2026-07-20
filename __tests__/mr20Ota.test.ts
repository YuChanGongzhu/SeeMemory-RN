/**
 * MCU OTA 发送逻辑单测 —— 用假原生模块捕获实际写出的帧。
 * 真机验收阻塞于固件方提供 ≤1MB 的 OTA 专用 bin，故此处以回环测覆盖协议关键点：
 * OTA&<LEN 6位> 发起 → 等 DEV&OTA → 244B/帧顺序发送 → OT&OVER 收尾。
 */
import {Mr20Native} from '../src/native/mr20/Mr20Native';
import {Mr20Client} from '../src/native/mr20/Mr20Client';
import {base64ToBytes, bytesToAscii, isCommandFrame} from '../src/native/mr20/protocol';

jest.mock('../src/native/mr20/Mr20Native', () => ({
  isMr20NativeAvailable: true,
  isMr20WifiAvailable: true,
  Mr20Native: {writeNoResponse: jest.fn()},
  mr20Emitter: {addListener: jest.fn(() => ({remove: () => {}}))},
}));

type Captured = {commands: string[]; frames: Uint8Array[]};

/**
 * 装一个假设备：命令帧记进 commands、二进制帧记进 frames；
 * 收到 OTA&LEN 回 OTA_READY，收到 OT&OVER 回 overReply（默认成功）。
 */
function mockDevice(client: Mr20Client, overReply: 'OTA_DONE' | 'OTA_ERR' = 'OTA_DONE'): Captured {
  const cap: Captured = {commands: [], frames: []};
  (Mr20Native.writeNoResponse as jest.Mock).mockImplementation(
    async (_svc: string, _ch: string, b64: string) => {
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
    },
  );
  return cap;
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

  it('设备回 OT&ERR 时报错并提示断电重启', async () => {
    const client = new Mr20Client();
    mockDevice(client, 'OTA_ERR');
    await expect(client.otaUpdateMcu(makeBin(300), {frameIntervalMs: 0})).rejects.toThrow(/断电重启/);
  });
});
