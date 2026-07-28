// v3：授权时机从"开屏一次性授权"改为"首次使用 AI 功能时 per-action 弹窗"。
// 递增版本让曾在开屏点过"同意"的老用户记录失效，回到 unknown，从而在新流程下重新弹窗。
export const AI_CONSENT_VERSION = 3;

export type ConsentDecision = 'unknown' | 'granted' | 'declined';
export type StoredConsentDecision = Exclude<ConsentDecision, 'unknown'>;

export interface ConsentRecord {
  version: number;
  decision: StoredConsentDecision;
  decidedAt: string;
}

export function createConsentRecord(
  decision: StoredConsentDecision,
  decidedAt = Date.now(),
): ConsentRecord {
  return {
    version: AI_CONSENT_VERSION,
    decision,
    decidedAt: new Date(decidedAt).toISOString(),
  };
}

export function parseConsentRecord(raw: string | null): ConsentDecision {
  if (!raw) {
    return 'unknown';
  }
  try {
    const value = JSON.parse(raw) as Partial<ConsentRecord>;
    if (
      value.version !== AI_CONSENT_VERSION ||
      (value.decision !== 'granted' && value.decision !== 'declined') ||
      typeof value.decidedAt !== 'string' ||
      !value.decidedAt
    ) {
      return 'unknown';
    }
    return value.decision;
  } catch {
    return 'unknown';
  }
}
