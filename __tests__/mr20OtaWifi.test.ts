/**
 * WiFi 模组 OTA（协议 R62）的单测。
 *
 * 与 MCU OTA 的前三步共用一套实现（Mr20Client.otaRun），故这里**不重测**
 * MTU 校验、无应答写、掉出接收态那些——那些由 mr20Ota / mr20OtaNative 覆盖。
 * 这个文件只盯 WiFi 独有的两处：起始指令，以及 OT&OVER 之后的第 4 步。
 */
import {Mr20Native} from '../src/native/mr20/Mr20Native';
import {Mr20Client} from '../src/native/mr20/Mr20Client';
import {base64ToBytes, bytesToAscii, isCommandFrame} from '../src/native/mr20/protocol';

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
    otaSendFrames: jest.fn(),
    otaAbort: jest.fn(),
  },
  mr20Emitter: {addListener: () => ({remove: () => {}})},
}));

/** 让设备回消息。走 onDeviceMessage 而不是 handleFrame，省掉一层 ASCII 编解码。 */
function say(client: Mr20Client, msg: any): void {
  (client as any).onDeviceMessage(msg);
}

/** 假设备：命令帧照协议应答；OT&OVER 只回「数据收全」，模组烧写由测试自己驱动。 */
function mockDevice(client: Mr20Client): string[] {
  const commands: string[] = [];
  (Mr20Native.writeNoResponse as jest.Mock).mockImplementation(
    async (_svc: string, _ch: string, b64: string) => {
      const ascii = bytesToAscii(base64ToBytes(b64));
      if (!isCommandFrame(ascii)) {
        throw new Error(`原生发帧路径下 JS 不应再写数据帧（收到 ${ascii.length}B）`);
      }
      commands.push(ascii);
      if (ascii.includes('&OTA&') || ascii.includes('&WIFI&OTA&')) {
        setTimeout(() => say(client, {type: 'OTA_READY'}), 0);
      } else if (ascii === 'GJJY_BLE&OT&OVER') {
        setTimeout(() => say(client, {type: 'OTA_DONE'}), 0);
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

/** 等若干个宏任务，让 setTimeout(0) 链跑完。 */
const tick = (n = 3) =>
  new Promise<void>(resolve => {
    let left = n;
    const step = () => (left-- > 0 ? setTimeout(step, 0) : resolve());
    step();
  });

describe('WiFi 模组 OTA · 协议 R62', () => {
  beforeEach(() => {
    (Mr20Native.writeNoResponse as jest.Mock).mockReset();
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
    (Mr20Native.otaSendFrames as jest.Mock).mockReset().mockImplementation(
      async (_s: string, _c: string, b64: string) => {
        const n = base64ToBytes(b64).length;
        return {
          frames: Math.ceil(n / 244),
          sent: n,
          total: n,
          elapsedMs: 20,
          avgPeriodMs: 20,
          maxPeriodMs: 21,
          notReady: 0,
        };
      },
    );
  });

  it('起始指令是 OTA&WIFI&<6位>，不是 MCU 的 OTA&<6位>', async () => {
    const client = new Mr20Client();
    const commands = mockDevice(client);
    const bin = makeBin(1000);

    const p = client.otaUpdateWifi(bin);
    await tick();
    say(client, {type: 'WIFI_STATE', state: '5'});
    say(client, {type: 'WIFI_STATE', state: '0'});
    await p;

    expect(commands).toEqual(['GJJY_BLE&OTA&WIFI&001000', 'GJJY_BLE&OT&OVER']);
  });

  it('useAltStartCommand 换成 R43 命令表的 WIFI&OTA&<6位> 拼法', async () => {
    const client = new Mr20Client();
    const commands = mockDevice(client);

    const p = client.otaUpdateWifi(makeBin(500), {useAltStartCommand: true});
    await tick();
    say(client, {type: 'WIFI_STATE', state: '5'});
    say(client, {type: 'WIFI_STATE', state: '0'});
    await p;

    expect(commands[0]).toBe('GJJY_BLE&WIFI&OTA&000500');
  });

  it('OT&OVER 之后还要等 WIFIS&5→0：只收到 OT&OVER 不算升级完成', async () => {
    const client = new Mr20Client();
    mockDevice(client);
    let settled = false;

    const p = client.otaUpdateWifi(makeBin(500)).then(() => (settled = true));
    await tick(5);
    // 设备已回 OT&OVER（数据收全），但模组还没开始烧——此时绝不能报成功。
    expect(settled).toBe(false);

    say(client, {type: 'WIFI_STATE', state: '5'});
    await tick();
    expect(settled).toBe(false);

    say(client, {type: 'WIFI_STATE', state: '0'});
    await p;
    expect(settled).toBe(true);
  });

  it('没见过 5 的 0 是静息态，不能当成烧写完成', async () => {
    const client = new Mr20Client();
    mockDevice(client);
    let settled = false;

    const p = client.otaUpdateWifi(makeBin(500)).then(() => (settled = true));
    await tick(5);
    // 模组静息时本来就是 0。若只认 0，这里就会误报成功。
    say(client, {type: 'WIFI_STATE', state: '0'});
    say(client, {type: 'WIFI_STATE', state: '0'});
    await tick();
    expect(settled).toBe(false);

    say(client, {type: 'WIFI_STATE', state: '5'});
    say(client, {type: 'WIFI_STATE', state: '0'});
    await p;
    expect(settled).toBe(true);
  });

  it('OW&ERR：数据收全但刷写模组失败，错误要与 OT&ERR 区分开', async () => {
    const client = new Mr20Client();
    mockDevice(client);

    const p = client.otaUpdateWifi(makeBin(500));
    await tick(5);
    say(client, {type: 'WIFI_STATE', state: '5'});
    say(client, {type: 'WIFI_OTA_ERR'});

    await expect(p).rejects.toThrow(/刷写 WiFi 模组时失败/);
  });

  it('OT&ERR（数据阶段就没收全）走的仍是原来的文案，不提模组刷写', async () => {
    const client = new Mr20Client();
    (Mr20Native.writeNoResponse as jest.Mock).mockImplementation(
      async (_s: string, _c: string, b64: string) => {
        const ascii = bytesToAscii(base64ToBytes(b64));
        if (ascii.includes('&OTA&')) {
          setTimeout(() => say(client, {type: 'OTA_READY'}), 0);
        } else if (ascii === 'GJJY_BLE&OT&OVER') {
          setTimeout(() => say(client, {type: 'OTA_ERR'}), 0);
        }
      },
    );

    await expect(client.otaUpdateWifi(makeBin(500))).rejects.toThrow(
      /设备固件接收失败/,
    );
  });

  it('MCU OTA 不受影响：没有第 4 步，收到 OT&OVER 就结束', async () => {
    const client = new Mr20Client();
    const commands = mockDevice(client);

    // 不发任何 WIFIS，MCU 路径必须自己走完。
    await client.otaUpdateMcu(makeBin(1000));

    expect(commands).toEqual(['GJJY_BLE&OTA&001000', 'GJJY_BLE&OT&OVER']);
  });
});
