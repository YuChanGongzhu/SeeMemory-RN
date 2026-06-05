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
