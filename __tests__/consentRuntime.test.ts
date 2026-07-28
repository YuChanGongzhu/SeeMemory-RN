import {
  AiConsentRequiredError,
  assertAiConsentGranted,
  isAiConsentGranted,
  setAiConsentGranted,
} from '../src/privacy/consentRuntime';

describe('AI consent runtime guard', () => {
  afterEach(() => setAiConsentGranted(false));

  test('blocks protected operations by default', () => {
    expect(isAiConsentGranted()).toBe(false);
    expect(() => assertAiConsentGranted()).toThrow(AiConsentRequiredError);
  });

  test('allows protected operations only while consent is granted', () => {
    setAiConsentGranted(true);
    expect(isAiConsentGranted()).toBe(true);
    expect(() => assertAiConsentGranted()).not.toThrow();

    setAiConsentGranted(false);
    expect(() => assertAiConsentGranted()).toThrow('需要先同意第三方 AI 数据处理');
  });
});
