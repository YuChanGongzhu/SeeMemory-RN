import {
  AI_CONSENT_VERSION,
  createConsentRecord,
  parseConsentRecord,
} from '../src/privacy/consentPolicy';

describe('consent policy', () => {
  test('treats missing, malformed, and stale consent as unknown', () => {
    expect(parseConsentRecord(null)).toBe('unknown');
    expect(parseConsentRecord('invalid')).toBe('unknown');
    expect(
      parseConsentRecord(
        JSON.stringify({
          version: AI_CONSENT_VERSION - 1,
          decision: 'granted',
          decidedAt: '2026-07-22T00:00:00.000Z',
        }),
      ),
    ).toBe('unknown');
  });

  test('round-trips granted and declined version-2 decisions', () => {
    const granted = createConsentRecord('granted', 1);
    const declined = createConsentRecord('declined', 2);

    expect(granted).toEqual({
      version: AI_CONSENT_VERSION,
      decision: 'granted',
      decidedAt: '1970-01-01T00:00:00.001Z',
    });
    expect(parseConsentRecord(JSON.stringify(granted))).toBe('granted');
    expect(parseConsentRecord(JSON.stringify(declined))).toBe('declined');
  });

  test('rejects records with invalid fields', () => {
    expect(
      parseConsentRecord(
        JSON.stringify({
          version: AI_CONSENT_VERSION,
          decision: 'allowed',
          decidedAt: '2026-07-22T00:00:00.000Z',
        }),
      ),
    ).toBe('unknown');
    expect(
      parseConsentRecord(
        JSON.stringify({
          version: AI_CONSENT_VERSION,
          decision: 'granted',
          decidedAt: '',
        }),
      ),
    ).toBe('unknown');
  });
});
