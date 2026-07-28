import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {ActivityIndicator, Modal, StyleSheet, View} from 'react-native';
import {colors} from '../design/tokens';
import {AIConsentDisclosure} from '../components/AIConsentDisclosure';
import {
  createAIConsentController,
  type AIConsentController,
  type AIConsentPromptContext,
  type AIConsentState,
} from './aiConsentController';
import {loadAiConsent, saveAiConsent} from './consentStorage';
import {setAiConsentGranted} from './consentRuntime';
import {t} from '../i18n/consentStrings';

interface AIConsentContextValue {
  state: AIConsentState;
  requestAiConsent: (context: AIConsentPromptContext) => Promise<boolean>;
  grantAiConsent: () => Promise<void>;
  withdrawAiConsent: () => Promise<void>;
}

const AIConsentContext = createContext<AIConsentContextValue | undefined>(undefined);

export function AIConsentProvider({children}: {children: ReactNode}) {
  const controllerRef = useRef<AIConsentController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createAIConsentController({
      load: loadAiConsent,
      save: saveAiConsent,
      setRuntime: setAiConsentGranted,
    });
  }
  const controller = controllerRef.current;
  const [state, setState] = useState(controller.getState());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    void controller.hydrate();
    return unsubscribe;
  }, [controller]);

  const run = async (action: () => Promise<void>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorSaveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const value = useMemo<AIConsentContextValue>(
    () => ({
      state,
      requestAiConsent: context => controller.requestConsent(context),
      grantAiConsent: () => controller.grant(),
      withdrawAiConsent: () => controller.decline(),
    }),
    [controller, state],
  );

  if (!state.hydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // 不再有"开屏一次性全局授权"分支：授权只在首次使用 AI 功能时通过下方 per-action
  // 弹窗获得（含本次发送的数据/用途 + 服务商清单 + 必勾确认），确保审核员在真正触发
  // AI 功能的那一刻必然看到授权请求。App Store 5.1.1(i)/5.1.2(i)。
  return (
    <AIConsentContext.Provider value={value}>
      {children}
      <Modal
        visible={state.promptContext !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={controller.cancelPending}>
        <AIConsentDisclosure
          context={state.promptContext}
          requireCheck
          agreeLabel={t('ai.agreePerAction')}
          declineLabel={t('cancel')}
          busy={busy}
          error={error}
          onAgree={() => void run(() => controller.confirmPending())}
          onDecline={controller.cancelPending}
        />
      </Modal>
    </AIConsentContext.Provider>
  );
}

export function useAIConsent(): AIConsentContextValue {
  const value = useContext(AIConsentContext);
  if (!value) {
    throw new Error('useAIConsent must be used within AIConsentProvider');
  }
  return value;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgApp,
  },
});
