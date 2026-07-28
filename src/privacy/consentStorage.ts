import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createConsentRecord,
  parseConsentRecord,
  type ConsentDecision,
  type StoredConsentDecision,
} from './consentPolicy';

const BASE_PRIVACY_KEY = '@ringmemory:base_privacy_consent_v2';
const AI_CONSENT_KEY = '@ringmemory:ai_consent_v2';

export async function loadBasePrivacyConsent(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(BASE_PRIVACY_KEY)) === 'accepted';
  } catch {
    return false;
  }
}

export function saveBasePrivacyConsent(): Promise<void> {
  return AsyncStorage.setItem(BASE_PRIVACY_KEY, 'accepted');
}

export async function loadAiConsent(): Promise<ConsentDecision> {
  try {
    return parseConsentRecord(await AsyncStorage.getItem(AI_CONSENT_KEY));
  } catch {
    return 'unknown';
  }
}

export function saveAiConsent(decision: StoredConsentDecision): Promise<void> {
  return AsyncStorage.setItem(
    AI_CONSENT_KEY,
    JSON.stringify(createConsentRecord(decision)),
  );
}

export function clearAiConsent(): Promise<void> {
  return AsyncStorage.removeItem(AI_CONSENT_KEY);
}
