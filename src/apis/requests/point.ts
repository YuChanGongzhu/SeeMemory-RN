import {baseRequest} from '../core/request';

export interface UserPointAccount {
  id: string | number;
  userId: string | number;
  balancePoints: number;
  frozenPoints: number;
  totalRechargedPoints: number;
  totalConsumedPoints: number;
  version: number;
  createDate: string;
  updateDate: string;
}

export interface PointRechargeProduct {
  id: string | number;
  productCode: string;
  productName: string;
  priceAmount: number;   // unit: fen (分)
  pointsAmount: number;
  bonusPoints: number;
  totalPoints: number;   // pointsAmount + bonusPoints
  currency: string;
  status: string;
  sort: number;
}

export interface CreatePointRechargeOrderResult {
  orderNo: string;
  orderAmount: number;
  grantPoints: number;
  payMode?: 'PAGE_FORM' | 'QR_CODE' | 'PAY_URL' | string;
  payPayload?: string;
  qrCode?: string;
  expireTime: string;
}

export function getPointAccount(): Promise<UserPointAccount> {
  return baseRequest<UserPointAccount>({method: 'GET', path: '/point/account'});
}

export function getOnShelfPointProducts(): Promise<PointRechargeProduct[]> {
  return baseRequest<PointRechargeProduct[]>({
    method: 'GET',
    path: '/point/recharge/products/on-shelf',
  });
}

export function createPointRechargeOrder(
  productId: string | number,
): Promise<CreatePointRechargeOrderResult> {
  return baseRequest<CreatePointRechargeOrderResult>({
    method: 'POST',
    path: '/point/recharge/orders',
    body: {productId, payType: 'ALIPAY'},
  });
}
