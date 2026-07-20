import {baseRequest} from '../core/request';

/** 设备固件最新版本元数据（后端 /app/firmware/latest 返回）。 */
export interface FirmwareInfo {
  /** 后端按 current 与 version_code 比较后算出是否有更新。 */
  hasUpdate: boolean;
  /** 最新版本号（如 V1.3）。 */
  version: string;
  /** 单调递增的版本码，用于可靠比较。 */
  versionCode: number;
  /** bin 下载地址（CDN 改写后的 COS 对象地址）。 */
  downloadUrl: string;
  /** bin 字节数（≤999999，供下载后校验）。 */
  size: number;
  /** bin 的 md5（下载后完整性校验）。 */
  md5: string;
  /** 更新说明。 */
  changelog: string;
  /** 是否强制升级。 */
  mandatory: boolean;
}

/**
 * 查询某型号某目标（mcu / wifi）的最新固件。target 本轮固定传 'mcu'。
 * current 为设备当前版本（如设备 FW 读到的 V1.2），后端据此算 hasUpdate。
 */
export function getLatestFirmware(params: {
  model: string;
  target: string;
  current: string;
}): Promise<FirmwareInfo> {
  return baseRequest<FirmwareInfo>({
    method: 'GET',
    path: '/app/firmware/latest',
    query: params,
  });
}
