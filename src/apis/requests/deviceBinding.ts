import {baseRequest} from '../core/request';

/**
 * App 端设备绑定（manager-api `DeviceBindingController` /app/device）。
 * 用于 MR20 记忆粒等硬件设备与登录账号的绑定关系，与 `device.ts` 里的 MemoryStudio 无关。
 */
export interface UserDeviceVO {
  uid: string;
  type: string;
  model?: string;
  /** 8 位访问凭证，与设备上当前生效的 SK 绑定密钥保持同步——后端就是这个值的唯一标准。 */
  accessKey: string;
  bindTime: string;
}

/** 设备已绑在当前账号名下（重复绑定），去查列表取凭证即可，不算失败。 */
export const DEVICE_ALREADY_BOUND = 100021;
/** 设备已被其他账号绑定，需原机主先解绑。 */
export const DEVICE_BOUND_BY_OTHER = 100022;

export function bindDevice(params: {
  uid: string;
  type?: string;
  model?: string;
  /** 用户在设备上实际设置好的密钥；带上后服务端落库的就是这个值，不再另外随机生成。 */
  accessKey?: string;
}): Promise<UserDeviceVO> {
  return baseRequest<UserDeviceVO>({method: 'POST', path: '/app/device', body: params});
}

export function listMyDevices(): Promise<UserDeviceVO[]> {
  return baseRequest<UserDeviceVO[]>({method: 'GET', path: '/app/device'});
}

/** 同步已绑定设备的新密钥（用户经「重置密钥后重新配网」改密后调用）。 */
export function updateDeviceKey(uid: string, accessKey: string): Promise<UserDeviceVO> {
  return baseRequest<UserDeviceVO>({
    method: 'PUT',
    path: `/app/device/${encodeURIComponent(uid)}/key`,
    body: {accessKey},
  });
}

export function unbindDevice(uid: string): Promise<{ok: boolean}> {
  return baseRequest<{ok: boolean}>({
    method: 'DELETE',
    path: `/app/device/${encodeURIComponent(uid)}`,
  });
}
