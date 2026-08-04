/**
 * openWifi / closeWifi 的状态机单测，对着协议 0801：
 *   - 「WiFi上传文件流程」第 1 步：发 WIFIO，每秒轮询 WIFIS，到 '2' 算就绪
 *   - 「WiFi功能使用」：状态 4/5/6 期间无法用指令关闭 WiFi；配密码周期 4→6 后自动关
 *
 * 用假定时器把每秒轮询压掉，所以这些用例跑得很快；真机的时间常数在 protocol.ts 的
 * WIFI_TIMING 里。
 */
import {Mr20Native} from '../src/native/mr20/Mr20Native';
import {Mr20Client} from '../src/native/mr20/Mr20Client';
import {
  WIFI_TIMING,
  WifiState,
  base64ToBytes,
  bytesToAscii,
} from '../src/native/mr20/protocol';

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
  },
  mr20Emitter: {addListener: () => ({remove: () => {}})},
}));

const say = (client: Mr20Client, msg: any): void =>
  (client as any).onDeviceMessage(msg);

/**
 * 假设备：按 states 数组逐次回 WIFIS 状态（用完停在最后一个），WIFIO/WIFIC 照协议回应答。
 * 返回下发过的命令，供断言「发了几条 WIFIO」「到底发没发 WIFIC」。
 */
function mockDevice(client: Mr20Client, states: number[]): string[] {
  const commands: string[] = [];
  let i = 0;
  (Mr20Native.writeNoResponse as jest.Mock).mockImplementation(
    async (_svc: string, _ch: string, b64: string) => {
      const ascii = bytesToAscii(base64ToBytes(b64));
      commands.push(ascii);
      if (ascii === 'GJJY_BLE&WIFIS') {
        const s = states[Math.min(i, states.length - 1)];
        i += 1;
        setTimeout(() => say(client, {type: 'WIFI_STATE', state: String(s)}), 0);
      } else if (ascii === 'GJJY_BLE&WIFIO') {
        setTimeout(() => say(client, {type: 'WIFI_OPENED'}), 0);
      } else if (ascii === 'GJJY_BLE&WIFIC') {
        setTimeout(() => say(client, {type: 'WIFI_CLOSED'}), 0);
      }
    },
  );
  return commands;
}

/** 推进假定时器直到 promise 落定（轮询间隔 1s，用假时钟一格格走）。 */
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
  tracked.catch(() => undefined); // 防未处理拒绝告警
  for (let i = 0; i < 400 && !settled; i += 1) {
    await Promise.resolve();
    jest.advanceTimersByTime(250);
    await Promise.resolve();
  }
  return tracked;
}

describe('openWifi / closeWifi · 协议 0801', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (Mr20Native.writeNoResponse as jest.Mock).mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('关闭态 → 发 WIFIO，轮询到 2（AP 起、无客户端）即就绪', async () => {
    const client = new Mr20Client();
    // 0(关) → 3(等待开启) → 3 → 2(就绪)
    const commands = mockDevice(client, [0, 3, 3, 2]);
    await runWithFakeClock(client.openWifi());
    expect(commands.filter(c => c === 'GJJY_BLE&WIFIO')).toHaveLength(1);
    expect(commands.filter(c => c === 'GJJY_BLE&WIFIS').length).toBeGreaterThan(1);
  });

  it('已是 1（已有客户端连入）时直接就绪，不再发 WIFIO', async () => {
    const client = new Mr20Client();
    const commands = mockDevice(client, [1]);
    await runWithFakeClock(client.openWifi());
    expect(commands).not.toContain('GJJY_BLE&WIFIO');
  });

  it('长时间停在 3 会补发 WIFIO，而不是干等到超时报「模组卡死」', async () => {
    const client = new Mr20Client();
    // 一直 3，直到补发的 WIFIO 把它推到 2。
    const states = [0, ...Array(20).fill(3), 2];
    const commands = mockDevice(client, states);
    await runWithFakeClock(client.openWifi());
    // 第一条是初始 WIFIO，第二条是「卡 3 超过 12s」的补发。
    expect(commands.filter(c => c === 'GJJY_BLE&WIFIO').length).toBeGreaterThanOrEqual(2);
  });

  it('WIFIS=5（模组正在 OTA）立即报错，不干等到超时', async () => {
    const client = new Mr20Client();
    mockDevice(client, [5]);
    await expect(runWithFakeClock(client.openWifi())).rejects.toThrow(/升级 WiFi 固件/);
  });

  it('配密码周期（4→6）超时后报「正在初始化 WiFi 密码」而非泛化的未就绪', async () => {
    const client = new Mr20Client();
    mockDevice(client, [4, 4, 6, 6]);
    await expect(
      runWithFakeClock(client.openWifi({maxWaitMs: 8000})),
    ).rejects.toThrow(/初始化 WiFi 密码/);
  });

  it('WIFIS 回空值当作未知(-1)而不是 0，不会误发 WIFIO', async () => {
    const client = new Mr20Client();
    const commands: string[] = [];
    (Mr20Native.writeNoResponse as jest.Mock).mockImplementation(
      async (_s: string, _c: string, b64: string) => {
        const ascii = bytesToAscii(base64ToBytes(b64));
        commands.push(ascii);
        if (ascii === 'GJJY_BLE&WIFIS') {
          setTimeout(() => say(client, {type: 'WIFI_STATE', state: ''}), 0);
        }
      },
    );
    await expect(
      runWithFakeClock(client.openWifi({maxWaitMs: 5000})),
    ).rejects.toThrow(/末态 -1/);
    expect(commands).not.toContain('GJJY_BLE&WIFIO');
  });

  it('状态 4/5/6 时跳过 WIFIC（协议：此时无法通过指令关闭 WiFi）', async () => {
    const client = new Mr20Client();
    const commands = mockDevice(client, [4]);
    await runWithFakeClock(client.closeWifi());
    expect(commands).not.toContain('GJJY_BLE&WIFIC');
  });

  it('AP 态（2）才真的发 WIFIC', async () => {
    const client = new Mr20Client();
    const commands = mockDevice(client, [2]);
    await runWithFakeClock(client.closeWifi());
    expect(commands).toContain('GJJY_BLE&WIFIC');
  });

  it('已关闭（0）时不再发 WIFIC，省得反复折腾模组', async () => {
    const client = new Mr20Client();
    const commands = mockDevice(client, [0]);
    await runWithFakeClock(client.closeWifi());
    expect(commands).not.toContain('GJJY_BLE&WIFIC');
  });
});

/**
 * 热点密码 = SK 绑定密钥（8 位）。设密码 = `SK&<8位>` + `WIFI&CH`（**无参**），
 * 再轮询 WIFIS 到 6（密码修改成功、待复位）。
 */
describe('initWifiPassword · 热点密码即 SK 密钥', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (Mr20Native.writeNoResponse as jest.Mock).mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * 假设备。**按协议建模，不是照脚本念状态码**：
   * 改密周期（states 里那串 4/6）要有人触发才开始，触发前 WIFIS 一律回 0（关闭）。
   *
   * 这点很要紧：如果让 WIFIS 从第一次查询就回 4，就造出了「什么都没发，设备已经在改密」
   * 这种现实里不存在的局面，反过来会把「发 CH 前先看一眼 WIFIS」这类正确实现判成错的。
   *
   * - `skOk`: true=回 SK&OK / false=回 SK&ERR / 'silent'=压根不回（固件方说这条应答要 10s）
   * - `autoCycleAfterSk`: 模拟协议「WiFi功能使用」段——**重置后连接的设备，收到密钥就自己
   *   开始配密码**，不需要 App 再发 WIFI&CH
   */
  function mockKeyDevice(
    client: Mr20Client,
    skOk: boolean | 'silent',
    states: number[],
    opts: {autoCycleAfterSk?: boolean} = {},
  ) {
    const commands: string[] = [];
    let i = 0;
    let cycling = false;
    (Mr20Native.writeNoResponse as jest.Mock).mockImplementation(
      async (_s: string, _c: string, b64: string) => {
        const ascii = bytesToAscii(base64ToBytes(b64));
        commands.push(ascii);
        if (ascii.startsWith('GJJY_BLE&SK&')) {
          if (opts.autoCycleAfterSk) {
            cycling = true;
          }
          if (skOk !== 'silent') {
            setTimeout(() => say(client, {type: skOk ? 'SK_OK' : 'SK_ERR'}), 0);
          }
        } else if (ascii === 'GJJY_BLE&WIFI&CH') {
          cycling = true;
        } else if (ascii === 'GJJY_BLE&WIFIS') {
          const s = cycling ? states[Math.min(i, states.length - 1)] : WifiState.OFF;
          if (cycling) {
            i += 1;
          }
          setTimeout(() => say(client, {type: 'WIFI_STATE', state: String(s)}), 0);
        }
      },
    );
    return commands;
  }

  it('SK&<8位> → WIFI&CH（无参）→ 等到 WIFIS=6 即成功', async () => {
    const client = new Mr20Client();
    const commands = mockKeyDevice(client, true, [4, 4, 6]);
    const applied = await runWithFakeClock(client.initWifiPassword('abcd1234'));
    expect(applied).toBe('abcd1234');
    expect(commands[0]).toBe('GJJY_BLE&SK&abcd1234');
    expect(commands).toContain('GJJY_BLE&WIFI&CH');
    // 不能带参数——带了就是之前那个怎么试都不生效的写法。
    expect(commands.some(c => c.startsWith('GJJY_BLE&WIFI&CH&'))).toBe(false);
  });

  it('超过 8 位自动截断，返回真正写进设备的值', async () => {
    const client = new Mr20Client();
    const commands = mockKeyDevice(client, true, [4, 6]);
    const applied = await runWithFakeClock(
      client.initWifiPassword('SeeMemoryMR20K01'),
    );
    expect(applied).toBe('SeeMemor'); // 'SeeMemoryMR20K01' 的前 8 位
    expect(commands[0]).toBe('GJJY_BLE&SK&SeeMemor');
  });

  it('SK&ERR（设备被别的密钥绑定）→ 明确报错，且不再发 WIFI&CH', async () => {
    const client = new Mr20Client();
    const commands = mockKeyDevice(client, false, [2]);
    await expect(
      runWithFakeClock(client.initWifiPassword('abcd1234')),
    ).rejects.toThrow(/SK&ERR/);
    expect(commands).not.toContain('GJJY_BLE&WIFI&CH');
  });

  it('非 8 位/含中文的密码本地就拦下，一条指令都不发', async () => {
    const client = new Mr20Client();
    const commands = mockKeyDevice(client, true, [2]);
    await expect(client.initWifiPassword('abc')).rejects.toThrow(/8 位/);
    await expect(client.initWifiPassword('密码密码密码密码')).rejects.toThrow(/8 位/);
    expect(commands).toHaveLength(0);
  });

  it('进过改密态后回落到 AP 态也算成功（设备复位重启了 WiFi）', async () => {
    const client = new Mr20Client();
    mockKeyDevice(client, true, [4, 4, 2]);
    await expect(
      runWithFakeClock(client.initWifiPassword('abcd1234')),
    ).resolves.toBe('abcd1234');
  });

  it('始终没进改密态 → 报「已设置但未确认」，让上层照样把密码存下来', async () => {
    const client = new Mr20Client();
    mockKeyDevice(client, true, [2]);
    await expect(
      runWithFakeClock(client.initWifiPassword('abcd1234', {maxWaitMs: 5000})),
    ).rejects.toThrow(/密钥已设置成功/);
  });

  // ---- 主路径版：失败不抛错，且不为注定不会来的状态 4 白等满 30s ----

  it('provisionWifiPassword：SK&OK → WIFI&CH → 见 6 即确认', async () => {
    const client = new Mr20Client();
    const commands = mockKeyDevice(client, true, [4, 6]);
    const r = await runWithFakeClock(client.provisionWifiPassword('SeeMemor'));
    expect(r.sk).toBe('ok');
    expect(r.confirmed).toBe(true);
    expect(commands[0]).toBe('GJJY_BLE&SK&SeeMemor');
    expect(commands).toContain('GJJY_BLE&WIFI&CH');
  });

  it('provisionWifiPassword：SK&ERR 不抛错、不发 CH（同步过去也是别人的密钥）', async () => {
    const client = new Mr20Client();
    const commands = mockKeyDevice(client, false, [2]);
    const r = await runWithFakeClock(client.provisionWifiPassword('SeeMemor'));
    expect(r.sk).toBe('err');
    expect(r.confirmed).toBe(false);
    expect(commands).not.toContain('GJJY_BLE&WIFI&CH');
  });

  it('provisionWifiPassword：固件没实现 CH（永不进 4）也只是 confirmed=false，不抛错', async () => {
    const client = new Mr20Client();
    const r = await runWithFakeClock(
      (mockKeyDevice(client, true, [0]), client.provisionWifiPassword('SeeMemor')),
    );
    expect(r.sk).toBe('ok');
    expect(r.confirmed).toBe(false);
  });

  // ---- SK 应答慢（固件方：约 10s）。真机上曾 0.2s 就判「设备不应答」，全是误报 ----

  it('setBindKey：设备不回时要等满 SK_ACK_MS，不能秒退', async () => {
    const client = new Mr20Client();
    mockKeyDevice(client, 'silent', [0]);
    const t0 = Date.now();
    const r = await runWithFakeClock(client.setBindKey('SeeMemor'));
    // 假时钟下 Date.now() 随 advanceTimersByTime 前进，可以直接量。
    // 协议这条应答要 10s 左右，等不到 10s 就放弃等于必然误判。
    expect(Date.now() - t0).toBeGreaterThanOrEqual(WIFI_TIMING.SK_ACK_MS);
    expect(r).toBe('timeout');
  });

  it('provisionWifiPassword：SK 无应答照样发 WIFI&CH，WIFIS 到 6 就算配好', async () => {
    const client = new Mr20Client();
    const commands = mockKeyDevice(client, 'silent', [4, 6]);
    const r = await runWithFakeClock(client.provisionWifiPassword('SeeMemor'));
    expect(r.sk).toBe('timeout');
    // 判据是 WIFIS 那一轮，不是 SK 的应答——设备收到密钥后本来就会自动跑一轮改密。
    expect(commands).toContain('GJJY_BLE&WIFI&CH');
    expect(r.confirmed).toBe(true);
  });

  it('initWifiPassword：SK 无应答但 WIFIS 走完 4→6，不该抛错', async () => {
    const client = new Mr20Client();
    mockKeyDevice(client, 'silent', [4, 6]);
    await expect(
      runWithFakeClock(client.initWifiPassword('abcd1234')),
    ).resolves.toBe('abcd1234');
  });

  // ---- 刚重置过的设备：收到 SK 就自己配密码，这时候不该再插一条 CH ----
  //
  // 协议「WiFi功能使用」：「设备首次连接 APP 或者**重置后连接 APP**，设备接收到密钥后，
  // 会自动打开 WiFi 并设置 WiFi 密码，WiFi 状态为 '4'…」。而 4/5/6 期间连关 WiFi 的指令
  // 都不生效，往正在跑的周期里塞命令只有坏处。

  it('设备收到 SK 已自行开始改密（WIFIS=4）→ 不补发 WIFI&CH，等它跑完照样算成功', async () => {
    const client = new Mr20Client();
    const commands = mockKeyDevice(client, true, [4, 6], {autoCycleAfterSk: true});

    const r = await runWithFakeClock(client.provisionWifiPassword('SeeMemor'));

    expect(commands).not.toContain('GJJY_BLE&WIFI&CH');
    expect(r.confirmed).toBe(true);
  });

  it('设备没自己动（WIFIS=0）→ 该发的 WIFI&CH 一条都不能少', async () => {
    const client = new Mr20Client();
    const commands = mockKeyDevice(client, true, [4, 6]); // 不 autoCycle，要等 CH 才动

    const r = await runWithFakeClock(client.provisionWifiPassword('SeeMemor'));

    expect(commands).toContain('GJJY_BLE&WIFI&CH');
    expect(r.confirmed).toBe(true);
  });

  it('awaitPwdSyncCycle：bailIfNoChangeMs 让「永不进 4」的设备提前收手，少轮好几秒', async () => {
    const pollsUntilGiveUp = async (bailIfNoChangeMs?: number) => {
      const client = new Mr20Client();
      const commands = mockKeyDevice(client, true, [0]); // 一直 0，永远不进 4
      await runWithFakeClock(
        client.awaitPwdSyncCycle({maxWaitMs: 30000, bailIfNoChangeMs}),
      );
      return commands.filter(c => c === 'GJJY_BLE&WIFIS').length;
    };
    // 断言的是**相对**关系：假时钟每次推进的量不等于真机的 1s/轮，绝对轮数不是稳定的量。
    // 这 18s 差值是每次首连都要吃掉的，卡住别让它退回等满 30s。
    expect(await pollsUntilGiveUp(12000)).toBeLessThan(await pollsUntilGiveUp());
  });
});
