import {
  createAIConsentController,
  runWithAiConsent,
} from '../src/privacy/aiConsentController';
import type {ConsentDecision, StoredConsentDecision} from '../src/privacy/consentPolicy';

function setup(initial: ConsentDecision = 'unknown') {
  let stored = initial;
  let runtime = false;
  let failSave = false;
  const controller = createAIConsentController({
    load: async () => stored,
    save: async (decision: StoredConsentDecision) => {
      if (failSave) {
        throw new Error('disk full');
      }
      stored = decision;
    },
    setRuntime: value => {
      runtime = value;
    },
  });
  return {
    controller,
    get stored() {
      return stored;
    },
    get runtime() {
      return runtime;
    },
    failNextSave() {
      failSave = true;
    },
  };
}

describe('AI consent controller', () => {
  test('hydrates persisted consent into the runtime guard', async () => {
    const env = setup('granted');
    await env.controller.hydrate();

    expect(env.controller.getState()).toMatchObject({
      hydrated: true,
      decision: 'granted',
    });
    expect(env.runtime).toBe(true);
  });

  test('does not grant runtime permission when persistence fails', async () => {
    const env = setup('declined');
    await env.controller.hydrate();
    env.failNextSave();

    await expect(env.controller.grant()).rejects.toThrow('disk full');
    expect(env.controller.getState().decision).toBe('declined');
    expect(env.runtime).toBe(false);
  });

  test('cancels a pending request without running its operation', async () => {
    const env = setup('declined');
    await env.controller.hydrate();
    const action = jest.fn(async () => 'sent');
    const result = runWithAiConsent(
      context => env.controller.requestConsent(context),
      {data: '录音音频', purpose: '语音转文字'},
      action,
    );

    expect(env.controller.getState().promptContext).toEqual({
      data: '录音音频',
      purpose: '语音转文字',
    });
    env.controller.cancelPending();

    await expect(result).resolves.toBeUndefined();
    expect(action).not.toHaveBeenCalled();
  });

  test('persists consent before resuming one pending operation', async () => {
    const env = setup('declined');
    await env.controller.hydrate();
    const action = jest.fn(async () => 'sent');
    const result = runWithAiConsent(
      context => env.controller.requestConsent(context),
      {data: '记忆内容', purpose: 'AI 总结'},
      action,
    );

    await env.controller.confirmPending();

    await expect(result).resolves.toBe('sent');
    expect(env.stored).toBe('granted');
    expect(env.runtime).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  test('rejects a second request while the first prompt is open', async () => {
    const env = setup('declined');
    await env.controller.hydrate();
    const first = env.controller.requestConsent({data: '录音', purpose: '转写'});

    await expect(
      env.controller.requestConsent({data: '图片', purpose: '内容理解'}),
    ).resolves.toBe(false);
    env.controller.cancelPending();
    await expect(first).resolves.toBe(false);
  });
});
