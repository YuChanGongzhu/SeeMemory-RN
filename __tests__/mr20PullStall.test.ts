/**
 * BLE 单文件拉取的「卡住」处理单测。对应线上现象：进度浮标停在「传输中 0/6」、
 * 单文件进度条已满格却半天不动——设备收完字节不回 FILE_DATA_DONE，而旧实现要等满
 * 120s 才报错。这里锁住两条新行为：
 *   1. 字节已收全但无 DONE → 宽限期后按成功结算（数据本身是完整的）
 *   2. 收到字节 > 声明 LEN → 判为实时录音流污染，立即报错（**不能**按成功结算，落盘会是坏 MP3）
 *   3. 传输中途断流 → 15s 判停滞并报错（供 syncFiles 重试），不再等 120s
 */
import {Mr20Native} from '../src/native/mr20/Mr20Native';
import {Mr20Client, Mr20StreamPollutedError} from '../src/native/mr20/Mr20Client';

jest.mock('../src/native/mr20/Mr20Native', () => ({
  isMr20NativeAvailable: true,
  isMr20WifiAvailable: true,
  Mr20Native: {writeNoResponse: jest.fn()},
  mr20Emitter: {addListener: jest.fn(() => ({remove: () => {}}))},
}));

/** 装一个「只应答但不回 DONE」的假设备，并暴露推字节的手柄。 */
function makeClient() {
  const client = new Mr20Client();
  (Mr20Native.writeNoResponse as jest.Mock).mockResolvedValue(undefined);
  const inner = client as any;
  return {
    client,
    /** 模拟设备回 F&LEN（文件总长）。 */
    sendLen: (length: number) => inner.onDeviceMessage({type: 'FILE_DATA_LEN', length}),
    /** 模拟设备推一批文件字节。 */
    pushBytes: (n: number) => inner.pushFileBytes(new Uint8Array(n).fill(7)),
  };
}

describe('Mr20Client.pullFile 停滞处理', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('字节收全但设备不回 DONE：宽限 5s 后按完成结算，返回完整数据', async () => {
    const {client, sendLen, pushBytes} = makeClient();
    const promise = client.pullFile('2026-07-17', '10-47-41.mp3');
    await Promise.resolve(); // 让 pullFile 内部把 fileXfer 装好

    sendLen(1024);
    pushBytes(1024); // 字节齐了，设备却始终不发 FILE_DATA_DONE

    // 宽限期未到时不应结算。
    jest.advanceTimersByTime(4000);
    let settled = false;
    promise.then(() => (settled = true)).catch(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    jest.advanceTimersByTime(1500); // 越过 5s 宽限
    const bytes = await promise;
    expect(bytes.length).toBe(1024);
  });

  it('实时录音流混入文件通道（收到字节 > 声明 LEN）：立即报错，不按成功结算', async () => {
    const {client, sendLen, pushBytes} = makeClient();
    const promise = client.pullFile('2026-07-17', '14-53-43.mp3');
    const caught = promise.catch((e: Error) => e);
    await Promise.resolve();

    sendLen(1024);
    pushBytes(1024); // 文件本体
    pushBytes(256); // 设备正在录音 → 实时音频流也走 001120a1，被当成文件数据

    // 不需要等任何定时器：多收即刻判定，否则实时流会不停刷新进度、让看门狗永不触发。
    const err = await caught;
    expect(err).toBeInstanceOf(Mr20StreamPollutedError);
    expect((err as Mr20StreamPollutedError).received).toBe(1280);
    expect((err as Mr20StreamPollutedError).expected).toBe(1024);
  });

  it('传输中途断流：15s 判「文件同步停滞」，不再等满 120s', async () => {
    const {client, sendLen, pushBytes} = makeClient();
    const promise = client.pullFile('2026-07-17', '11-36-42.mp3');
    const caught = promise.catch((e: Error) => e.message);
    await Promise.resolve();

    sendLen(4096);
    pushBytes(1024); // 只推了一部分就再无下文

    jest.advanceTimersByTime(14000);
    let settled = false;
    promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    jest.advanceTimersByTime(2000); // 越过 15s 停滞窗口
    await expect(caught).resolves.toBe('文件同步停滞');
  });

  it('设备一个字节都不推：仍按整体超时 120s 收尾，不被 15s 窗口误杀', async () => {
    const {client} = makeClient();
    const promise = client.pullFile('2026-07-17', '14-49-11.mp3');
    const caught = promise.catch((e: Error) => e.message);
    await Promise.resolve();

    jest.advanceTimersByTime(20000); // 首帧窗口用 timeoutMs，20s 时还不该结算
    let settled = false;
    promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    jest.advanceTimersByTime(101000);
    await expect(caught).resolves.toBe('文件同步超时');
  });
});
