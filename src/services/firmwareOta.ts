/**
 * 固件下载 + 完整性校验。传坏的固件会把设备刷卡死（须断电重启），
 * 故长度/md5 校验不过一律拒绝、不进入 BLE OTA。
 */
import {FirmwareInfo} from '../apis/requests/firmware';
import {md5} from '../utils/md5';

/**
 * 下载固件 bin 并校验（长度 + md5 + ≤1MB 上限），返回原始字节。
 * onProgress 目前只在下载完成时回一次完整值（fetch 不流式暴露进度；bin ≤1MB 下载很快，
 * 真正的进度在 OTA 发送阶段体现）。
 */
export async function downloadFirmwareBin(
  info: FirmwareInfo,
  onProgress?: (received: number, total: number) => void,
): Promise<Uint8Array> {
  const resp = await fetch(info.downloadUrl);
  if (!resp.ok) {
    throw new Error(`固件下载失败（HTTP ${resp.status}）`);
  }
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  onProgress?.(bytes.length, info.size || bytes.length);

  if (info.size && bytes.length !== info.size) {
    throw new Error(`固件大小不符（期望 ${info.size}，实际 ${bytes.length}），已终止`);
  }
  if (bytes.length > 999999) {
    throw new Error('固件超过 1MB（协议 OTA LEN 6 位上限），无法通过 BLE OTA 下发');
  }
  if (info.md5) {
    const actual = md5(bytes);
    if (actual.toLowerCase() !== info.md5.toLowerCase()) {
      throw new Error('固件校验失败（md5 不匹配），已终止以免刷坏设备');
    }
  }
  return bytes;
}
