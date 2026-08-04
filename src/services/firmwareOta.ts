/**
 * 固件下载 + 完整性校验。传坏的固件会把设备刷卡死（须断电重启），
 * 故长度/md5 校验不过一律拒绝、不进入 BLE OTA。
 */
import {FirmwareInfo} from '../apis/requests/firmware';
import {md5} from '../utils/md5';
import {otaLog} from './otaLog';

/**
 * 下载固件 bin 并校验（长度 + md5 + ≤1MB 上限），返回原始字节。
 * onProgress 目前只在下载完成时回一次完整值（fetch 不流式暴露进度；bin ≤1MB 下载很快，
 * 真正的进度在 OTA 发送阶段体现）。
 */
export async function downloadFirmwareBin(
  info: FirmwareInfo,
  onProgress?: (received: number, total: number) => void,
): Promise<Uint8Array> {
  otaLog(`开始下载固件 ${info.version}：${info.downloadUrl}`);
  const startedAt = Date.now();
  const resp = await fetch(info.downloadUrl);
  if (!resp.ok) {
    otaLog(`下载失败：HTTP ${resp.status}`, 'error');
    throw new Error(`固件下载失败（HTTP ${resp.status}）`);
  }
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  otaLog(`下载完成：${bytes.length} 字节，耗时 ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
  onProgress?.(bytes.length, info.size || bytes.length);

  if (info.size && bytes.length !== info.size) {
    otaLog(`大小校验不通过：期望 ${info.size}，实际 ${bytes.length}`, 'error');
    throw new Error(`固件大小不符（期望 ${info.size}，实际 ${bytes.length}），已终止`);
  }
  if (bytes.length > 999999) {
    otaLog(`超出协议上限：${bytes.length} > 999999 字节`, 'error');
    throw new Error('固件超过 1MB（协议 OTA LEN 6 位上限），无法通过 BLE OTA 下发');
  }
  if (info.md5) {
    const md5StartedAt = Date.now();
    const actual = md5(bytes);
    if (actual.toLowerCase() !== info.md5.toLowerCase()) {
      otaLog(`md5 不匹配：期望 ${info.md5}，实际 ${actual}`, 'error');
      throw new Error('固件校验失败（md5 不匹配），已终止以免刷坏设备');
    }
    otaLog(`md5 校验通过 ${actual}（耗时 ${((Date.now() - md5StartedAt) / 1000).toFixed(2)}s）`);
  } else {
    otaLog('服务端未下发 md5，跳过校验', 'warn');
  }
  return bytes;
}
