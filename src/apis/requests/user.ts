import {baseRequest} from '../core/request';

export interface UserInfo {
  id: string;
  username?: string;
  nickname?: string;
  avatarUrl?: string;
  phone?: string;
  superAdmin?: boolean;
  status?: number;
  tokenBalance?: number;
  tokenUsedCount?: number;
}

export function sendSmsVerification(phone: string): Promise<null> {
  return baseRequest<null>({
    method: 'POST',
    path: '/user/smsVerification',
    body: {phone},
  });
}

export function loginWithPhoneNumber(phone: string, captcha: string): Promise<{token: string}> {
  return baseRequest<{token: string}>({
    method: 'POST',
    path: '/user/loginWithPhoneNumber',
    body: {phone, captcha},
  });
}

export function getUserInfo(): Promise<UserInfo> {
  return baseRequest<UserInfo>({
    method: 'GET',
    path: '/user/info',
  });
}

/**
 * 注销账号。身份取自登录态 token，无需额外参数；防误触靠 App 内两段确认。
 */
export function deleteAccount(): Promise<null> {
  return baseRequest<null>({
    method: 'POST',
    path: '/user/deleteAccount',
  });
}
