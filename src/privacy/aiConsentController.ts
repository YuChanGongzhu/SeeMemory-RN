import type {
  ConsentDecision,
  StoredConsentDecision,
} from './consentPolicy';

export interface AIConsentPromptContext {
  data: string;
  purpose: string;
}

export interface AIConsentState {
  hydrated: boolean;
  decision: ConsentDecision;
  promptContext: AIConsentPromptContext | null;
}

interface AIConsentControllerDeps {
  load: () => Promise<ConsentDecision>;
  save: (decision: StoredConsentDecision) => Promise<void>;
  setRuntime: (granted: boolean) => void;
}

export interface AIConsentController {
  getState: () => AIConsentState;
  subscribe: (listener: (state: AIConsentState) => void) => () => void;
  hydrate: () => Promise<void>;
  grant: () => Promise<void>;
  decline: () => Promise<void>;
  requestConsent: (context: AIConsentPromptContext) => Promise<boolean>;
  confirmPending: () => Promise<void>;
  cancelPending: () => void;
}

export function createAIConsentController(
  deps: AIConsentControllerDeps,
): AIConsentController {
  let state: AIConsentState = {
    hydrated: false,
    decision: 'unknown',
    promptContext: null,
  };
  let pendingResolver: ((granted: boolean) => void) | null = null;
  const listeners = new Set<(next: AIConsentState) => void>();

  const publish = (patch: Partial<AIConsentState>) => {
    state = {...state, ...patch};
    listeners.forEach(listener => listener(state));
  };

  const persist = async (decision: StoredConsentDecision) => {
    await deps.save(decision);
    deps.setRuntime(decision === 'granted');
    publish({decision});
  };

  return {
    getState: () => state,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate: async () => {
      let decision: ConsentDecision = 'unknown';
      try {
        decision = await deps.load();
      } catch {
        decision = 'unknown';
      }
      deps.setRuntime(decision === 'granted');
      publish({hydrated: true, decision});
    },
    grant: () => persist('granted'),
    decline: () => persist('declined'),
    requestConsent: context => {
      if (state.decision === 'granted') {
        return Promise.resolve(true);
      }
      if (pendingResolver) {
        return Promise.resolve(false);
      }
      publish({promptContext: context});
      return new Promise<boolean>(resolve => {
        pendingResolver = resolve;
      });
    },
    confirmPending: async () => {
      if (!pendingResolver) {
        return;
      }
      await persist('granted');
      const resolve = pendingResolver;
      pendingResolver = null;
      publish({promptContext: null});
      resolve(true);
    },
    cancelPending: () => {
      if (!pendingResolver) {
        return;
      }
      const resolve = pendingResolver;
      pendingResolver = null;
      publish({promptContext: null});
      resolve(false);
    },
  };
}

export async function runWithAiConsent<T>(
  requestConsent: (context: AIConsentPromptContext) => Promise<boolean>,
  context: AIConsentPromptContext,
  action: () => Promise<T>,
): Promise<T | undefined> {
  if (!(await requestConsent(context))) {
    return undefined;
  }
  return action();
}
