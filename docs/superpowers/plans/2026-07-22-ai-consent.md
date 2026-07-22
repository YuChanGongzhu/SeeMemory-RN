# AI Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional, revocable third-party AI consent with just-in-time prompts and hard data-layer enforcement before any protected request.

**Architecture:** A pure consent policy and runtime guard sit below React Native storage and UI. `AIConsentProvider` hydrates versioned consent, owns the global disclosure prompt, and exposes a promise-based gate to feature entry points; protected service functions independently assert runtime consent before network activity.

**Tech Stack:** React Native 0.84, React 19, TypeScript, AsyncStorage, Jest, existing custom navigation.

## Global Constraints

- Users who decline AI processing can enter SiMemory and use non-AI features.
- Base privacy acceptance remains mandatory before login or guest access.
- No audio, text, note, image, or document may be sent to a protected service before AI consent.
- Consent is versioned as version 2 so build 16 decisions do not bypass the new flow.
- Existing MR20 scoping and migration changes in the dirty worktree must remain intact.
- The current uncommitted build-number change to build 17 must not be reverted.

---

### Task 1: Consent Policy, Persistence, and Runtime Guard

**Files:**
- Create: `src/privacy/consentPolicy.ts`
- Create: `src/privacy/consentRuntime.ts`
- Create: `src/privacy/consentStorage.ts`
- Test: `__tests__/consentPolicy.test.ts`
- Test: `__tests__/consentRuntime.test.ts`

**Interfaces:**
- Produces: `ConsentDecision`, `parseConsentRecord`, `createConsentRecord`, `setAiConsentGranted`, `assertAiConsentGranted`, `AiConsentRequiredError`, `loadBasePrivacyConsent`, `saveBasePrivacyConsent`, `loadAiConsent`, `saveAiConsent`, and `clearAiConsent`.

- [ ] **Step 1: Write policy tests that require version-2 records and reject stale or malformed values**

```ts
expect(parseConsentRecord(null)).toBe('unknown');
expect(parseConsentRecord('invalid')).toBe('unknown');
expect(parseConsentRecord(JSON.stringify({version: 1, decision: 'granted'}))).toBe('unknown');
expect(parseConsentRecord(JSON.stringify(createConsentRecord('declined', 1)))).toBe('declined');
```

- [ ] **Step 2: Run the policy tests and verify they fail because the module does not exist**

Run: `npm test -- --runInBand __tests__/consentPolicy.test.ts`

- [ ] **Step 3: Implement the versioned pure policy**

Create records with exactly `{version: 2, decision, decidedAt}` and accept only `granted` or `declined`.

- [ ] **Step 4: Write and run failing runtime-guard tests**

```ts
setAiConsentGranted(false);
expect(() => assertAiConsentGranted()).toThrow(AiConsentRequiredError);
setAiConsentGranted(true);
expect(() => assertAiConsentGranted()).not.toThrow();
```

- [ ] **Step 5: Implement the runtime guard and AsyncStorage adapter**

Use separate keys `@ringmemory:base_privacy_consent_v2` and `@ringmemory:ai_consent_v2`. Storage read failures resolve as unknown/no consent; storage write failures propagate.

- [ ] **Step 6: Run both focused suites**

Run: `npm test -- --runInBand __tests__/consentPolicy.test.ts __tests__/consentRuntime.test.ts`

### Task 2: Two-Stage First-Launch Flow and Global AI Provider

**Files:**
- Create: `src/privacy/AIConsentContext.tsx`
- Create: `src/components/AIConsentDisclosure.tsx`
- Modify: `src/screens/ConsentScreen.tsx`
- Modify: `App.tsx`
- Test: `__tests__/aiConsentController.test.ts`

**Interfaces:**
- Consumes: policy, runtime, and storage interfaces from Task 1.
- Produces: `AIConsentProvider`, `useAIConsent`, `PrivacyConsentScreen`, `AIConsentScreen`, and a central just-in-time disclosure modal.

- [ ] **Step 1: Write failing controller tests**

Test that declining resolves the pending request as `false`, granting persists first and then resolves `true`, storage failure never enables runtime consent, and only one pending request is accepted.

- [ ] **Step 2: Run the focused suite and verify expected failures**

Run: `npm test -- --runInBand __tests__/aiConsentController.test.ts`

- [ ] **Step 3: Implement a testable consent controller**

The controller accepts storage functions as dependencies, tracks one pending resolver, and updates the runtime guard only after successful persistence.

- [ ] **Step 4: Implement reusable disclosure content**

Render the central vendor list from `AI_VENDORS`, exact data categories, processing purposes, training statement, privacy-policy link, and distinct primary/secondary actions.

- [ ] **Step 5: Split first launch into mandatory base privacy and optional AI disclosure**

`PrivacyConsentScreen` keeps users on-screen after rejection. `AIConsentScreen` offers "同意使用第三方 AI" and "暂不同意并继续".

- [ ] **Step 6: Mount `AIConsentProvider` before all app feature providers**

The provider hydrates consent before rendering protected feature providers, shows the optional disclosure for unknown version-2 decisions, and synchronizes the runtime guard.

- [ ] **Step 7: Run focused tests and TypeScript**

Run: `npm test -- --runInBand __tests__/aiConsentController.test.ts`

Run: `npx tsc --noEmit`

### Task 3: Feature-Level Just-in-Time Prompts

**Files:**
- Modify: `src/hooks/useVoiceInput.ts`
- Modify: `src/hooks/useHermesChat.ts`
- Modify: `src/hooks/useMr20.tsx`
- Modify: `src/hooks/useCreateSummary.tsx`
- Modify: `src/screens/EditorPage.tsx`

**Interfaces:**
- Consumes: `useAIConsent().requestAiConsent(context)`.
- Produces: protected feature entry points that cancel cleanly or resume after agreement.

- [ ] **Step 1: Add failing tests for the reusable gate helper**

Test agreement resuming an action once and rejection returning without invoking the action.

- [ ] **Step 2: Run tests and verify the missing helper failure**

Run: `npm test -- --runInBand __tests__/aiConsentController.test.ts`

- [ ] **Step 3: Implement the helper and integrate each protected feature**

Use concise action contexts for audio transcription, audio upload, image upload, AI chat, memory save/correction, and summary generation. Rejection must be treated as cancellation, not a network error.

- [ ] **Step 4: Run focused tests and TypeScript**

Run: `npm test -- --runInBand __tests__/aiConsentController.test.ts`

Run: `npx tsc --noEmit`

### Task 4: Data-Layer Enforcement

**Files:**
- Modify: `src/services/api.ts`
- Modify: `src/services/hermesChat.ts`
- Modify: `src/services/audioBatch.ts`
- Modify: `src/apis/requests/audioTranscribe.ts`
- Modify: `src/apis/requests/memory.ts`
- Modify: `src/apis/requests/summaries.ts`
- Modify: `src/apis/requests/corrections.ts`
- Test: `__tests__/aiConsentServices.test.ts`

**Interfaces:**
- Consumes: `assertAiConsentGranted`.
- Produces: protected service functions that throw `AiConsentRequiredError` synchronously or before their first awaited network operation.

- [ ] **Step 1: Write failing service-boundary tests**

Set runtime consent to false, invoke representative upload, transcription, chat, memory, and summary functions, and assert the mocked network dependency has zero calls.

- [ ] **Step 2: Run the tests and verify requests currently escape the guard**

Run: `npm test -- --runInBand __tests__/aiConsentServices.test.ts`

- [ ] **Step 3: Add guards at the lowest protected public boundaries**

Guard before local file reads, presigned URL requests, `fetch`, EventSource construction, or `baseRequest`.

- [ ] **Step 4: Run service tests and TypeScript**

Run: `npm test -- --runInBand __tests__/aiConsentServices.test.ts`

Run: `npx tsc --noEmit`

### Task 5: Privacy and AI Settings

**Files:**
- Create: `src/screens/PrivacyAIPage.tsx`
- Modify: `src/navigation/nav.tsx`
- Modify: `src/navigation/Root.tsx`
- Modify: `src/screens/ProfilePage.tsx`
- Modify: `src/components/AppDrawer.tsx`

**Interfaces:**
- Consumes: `useAIConsent`.
- Produces: a `privacyAi` navigation destination available to signed-in and guest users.

- [ ] **Step 1: Add the typed route and screen shell**

The screen displays current status, full disclosure, privacy-policy link, and either grant or withdraw action.

- [ ] **Step 2: Add entry points**

Add "隐私与 AI" to Profile and the global drawer so guest users can reach it.

- [ ] **Step 3: Implement grant and withdrawal feedback**

Grant uses the same persisted path as the provider. Withdrawal confirms the action, persists removal/decline, and immediately disables protected operations.

- [ ] **Step 4: Run TypeScript and lint for touched files**

Run: `npx tsc --noEmit`

Run: `npx eslint App.tsx src/privacy src/components/AIConsentDisclosure.tsx src/screens/ConsentScreen.tsx src/screens/PrivacyAIPage.tsx src/hooks/useVoiceInput.ts src/hooks/useHermesChat.ts src/hooks/useMr20.tsx src/hooks/useCreateSummary.tsx src/services/api.ts src/services/hermesChat.ts src/services/audioBatch.ts src/apis/requests/audioTranscribe.ts src/apis/requests/memory.ts src/apis/requests/summaries.ts src/apis/requests/corrections.ts`

### Task 6: Review-Build Verification

**Files:**
- Modify only if required: `ios/RingMemoryApp.xcodeproj/project.pbxproj`
- Create: `docs/app-store-review-notes-privacy.md`

**Interfaces:**
- Consumes: completed behavior from Tasks 1-5.
- Produces: verified build metadata and paste-ready App Review Notes.

- [ ] **Step 1: Confirm build metadata without overwriting existing work**

Run: `xcodebuild -project ios/RingMemoryApp.xcodeproj -scheme RingMemoryApp -configuration Release -showBuildSettings | rg 'MARKETING_VERSION|CURRENT_PROJECT_VERSION|PRODUCT_BUNDLE_IDENTIFIER'`

Keep build 17 only if it is unused in App Store Connect; otherwise use the next unused number. Do not guess the App Store version train.

- [ ] **Step 2: Run all unit tests**

Run: `npm test -- --runInBand`

- [ ] **Step 3: Run TypeScript and lint**

Run: `npx tsc --noEmit`

Run: `npm run lint`

- [ ] **Step 4: Build the iOS simulator target**

Run: `xcodebuild -project ios/RingMemoryApp.xcodeproj -scheme RingMemoryApp -sdk iphonesimulator -configuration Debug build CODE_SIGNING_ALLOWED=NO`

- [ ] **Step 5: Write review notes with exact paths and verification steps**

Document first launch, "暂不同意并继续", one just-in-time prompt, settings withdrawal, and `https://ms.seemem.com/privacy`.

- [ ] **Step 6: Review the final diff**

Run: `git diff --check`

Run: `git status --short`
