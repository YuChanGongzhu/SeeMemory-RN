import {baseRequest} from '../core/request';

export type MembershipTier = 'none' | 'pro' | 'max';

export interface ServiceEntitlement {
  serviceCode: string;
  serviceName?: string;
  status?: string; // active / expired / ...
  validFrom?: string;
  validTo?: string;
  remainingSeconds?: number;
  sourceOrderNo?: string;
}

export interface CommerceProduct {
  id: string | number;
  productCode: string;
  productType?: string;
  productName: string;
  priceAmount: number; // fen
  currency?: string;
  extConfigJson?: string;
}

export interface CreateCommerceOrderResult {
  orderNo: string;
  orderAmount: number;
  payMode?: string;
  payPayload?: string;
  expireTime?: string;
}

export function getServiceEntitlements(): Promise<ServiceEntitlement[]> {
  return baseRequest<ServiceEntitlement[]>({method: 'GET', path: '/service/entitlements'});
}

export function getOnShelfCommerceProducts(productType?: string): Promise<CommerceProduct[]> {
  return baseRequest<CommerceProduct[]>({
    method: 'GET',
    path: '/commerce/products/on-shelf',
    query: productType ? {productType} : undefined,
  });
}

export function createCommerceOrder(productId: string | number): Promise<CreateCommerceOrderResult> {
  return baseRequest<CreateCommerceOrderResult>({
    method: 'POST',
    path: '/commerce/orders',
    body: {productId, payType: 'ALIPAY'},
  });
}

/**
 * Best-effort tier from active entitlements. Membership serviceCodes are
 * data-driven (not hardcoded server-side), so we match MAX/PRO in the
 * code/name. Tighten this once the canonical serviceCodes are known.
 */
export function deriveTier(entitlements: ServiceEntitlement[]): {tier: MembershipTier; expireAt?: string} {
  const active = entitlements.filter(e => !e.status || /active|valid|on/i.test(e.status));
  const hay = (e: ServiceEntitlement) => `${e.serviceCode} ${e.serviceName || ''}`.toLowerCase();
  const max = active.find(e => /max/.test(hay(e)));
  if (max) return {tier: 'max', expireAt: max.validTo};
  const pro = active.find(e => /pro|plus|vip|premium/.test(hay(e)));
  if (pro) return {tier: 'pro', expireAt: pro.validTo};
  return {tier: 'none'};
}
