# AI Consent and App Review Design

## Goal

Make third-party AI data sharing explicit, optional, revocable, and technically impossible before consent, while allowing users who decline AI processing to enter SiMemory and use non-AI features.

## Consent Model

SiMemory uses two separate decisions:

1. The base privacy notice is required before entering the app. A user who does not accept remains on the privacy screen.
2. Third-party AI processing is optional. The user can agree or choose "Not now and continue".

The AI decision is versioned independently from the base privacy notice. The new version must not reuse the existing `privacy_consent_v1` decision, so existing installations see the updated disclosure.

AI consent has three states:

- `unknown`: no decision has been made for the current consent version.
- `granted`: protected AI and upload operations may run.
- `declined`: the app remains usable, but protected operations require a new just-in-time prompt.

## User Experience

### First Launch

The existing combined consent screen becomes a two-stage flow:

1. Base privacy notice with "Agree and continue" and "Do not agree". The latter keeps the user on the notice and does not enter the app.
2. Third-party AI processing notice listing the data categories, recipients, and purposes. It offers "Agree to AI processing" and "Not now and continue".

Choosing "Not now and continue" opens the normal login or guest experience without sending content to third-party AI services.

### Just-in-Time Prompt

When an unconsented user starts a protected operation, a full disclosure modal appears before any network request. It identifies:

- The data about to be sent, such as audio, transcribed text, notes, images, or documents.
- The third-party recipients from the central vendor disclosure list.
- The processing purpose.

The modal offers "Agree and continue" and "Cancel". Cancel closes the modal and aborts the pending operation without a network request. Agree persists consent and resumes that one pending operation.

Only one pending operation is retained. A second request while the modal is open is rejected rather than replacing or duplicating the first request.

### Settings

A "Privacy and AI" screen is reachable from the profile/settings area. It shows the current AI consent status, the complete disclosure, the privacy-policy link, and one command:

- When not granted: "Agree to AI processing".
- When granted: "Withdraw AI consent".

Withdrawal takes effect immediately for subsequent operations. It does not delete existing cloud data; the screen directs users to account deletion and the privacy policy for deletion rights.

## Architecture

### Consent Storage

A focused storage module owns versioned base-privacy and AI-consent keys. Stored AI consent records contain the decision, consent version, and timestamp. The module exposes pure parsing and policy helpers so behavior can be tested without React Native storage.

### Runtime Guard

A small runtime singleton mirrors whether AI consent is currently granted. It exposes:

- `setAiConsentGranted(granted: boolean): void`
- `assertAiConsentGranted(): void`
- `AiConsentRequiredError`

The provider updates the singleton whenever persisted consent changes. Protected data-layer functions call `assertAiConsentGranted()` before creating a request, reading a local user file for upload, requesting a presigned URL, or opening an SSE connection.

### React Provider

`AIConsentProvider` hydrates persisted consent, exposes the current state, and coordinates the just-in-time modal. Its public hook provides:

- Current decision and hydration state.
- `requestAiConsent(action): Promise<boolean>`.
- `grantAiConsent(): Promise<void>`.
- `withdrawAiConsent(): Promise<void>`.

Feature entry points call `requestAiConsent` before invoking protected services. The provider renders the modal centrally so all screens use the same wording and behavior.

### Protected Operations

The following operations require AI consent:

- Audio and image upload to cloud object storage.
- Direct and backend audio transcription.
- AI chat, including text, image, and voice messages.
- Batch audio processing.
- AI summary generation.
- Note/memory submission that triggers server-side AI processing.
- AI correction and refinement requests.

Bluetooth connection, local device transfer, local recording, local playback, authentication, account management, firmware updates, and ordinary read-only browsing remain available without AI consent.

## Failure Handling

- A declined just-in-time prompt cancels the requested operation without displaying a network error.
- A protected service reached without consent throws `AiConsentRequiredError` before network activity.
- Storage read failures default to no consent.
- Storage write failures do not grant runtime consent.
- Withdrawal clears runtime permission only after the storage operation succeeds.
- Existing feature-specific errors continue to handle genuine network and server failures.

## App Store Review Support

The review build must use the next unused build number. The archive version shown in Xcode Organizer must exactly match the App Store Connect version train before upload.

Review Notes will provide:

- The first-launch consent path.
- Steps for selecting "Not now and continue".
- A protected action that demonstrates the just-in-time prompt.
- The path to "Privacy and AI" settings.
- The privacy-policy URL.

The consent version change guarantees the updated prompt appears on both clean installs and upgrades from build 16.

## Testing

Automated tests cover:

- Parsing unknown, granted, declined, stale, and malformed stored decisions.
- The runtime guard allowing granted operations and rejecting all other states.
- Grant and withdrawal ordering around storage failures.
- Every protected service rejecting before its network dependency is called.
- Feature-level consent requests resuming after agreement and cancelling after rejection.

Manual verification covers:

- Clean install on iPhone and iPad.
- Upgrade from build 16 with old consent stored.
- Base privacy rejection.
- AI rejection followed by normal app entry.
- Just-in-time prompts for audio upload, voice transcription, image upload, chat, and summary.
- Withdrawal in settings followed by blocked protected operations.
- Xcode archive version/build metadata.
