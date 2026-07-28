# App Review Notes - Privacy and Third-Party AI

Hello App Review Team,

Thank you for your feedback regarding Guidelines 5.1.1(i) and 5.1.2(i).

SiMemory uses third-party AI services to process user-provided audio, transcribed
text, notes, memory content, images, and documents. To address the previous
rejection, version 1.0 (build 19) presents the third-party AI consent request **at
the point of use** — the moment a feature is about to send data — so it is always
visible while an AI feature is being tested.

## What changed in build 19

1. There is no longer a one-time global "agree" screen at launch. Consent is now
   requested the first time the user triggers any AI feature.
2. Before audio upload, transcription, image upload, AI chat, memory processing,
   correction, or AI summary, a full-screen consent sheet appears **before any data
   leaves the device**. It clearly states:
   - What data this specific action will send (e.g. "Audio recordings").
   - The purpose of the action.
   - Every third-party recipient by name and each recipient's purpose:
     Amphion, Tencent Cloud, DeepSeek, Alibaba Cloud Bailian (Qwen),
     Moonshot (Kimi), Amazon Web Services (Bedrock).
   - A link to the full privacy policy.
3. The "Agree and continue" button is disabled until the user ticks a confirmation
   checkbox ("I have read and agree to send the above data to third-party AI
   providers for processing").
4. If the user taps Cancel, the operation is aborted and no personal data is sent.
   All protected network functions also independently verify consent before reading
   a local file, requesting an upload URL, opening an AI chat connection, or sending
   content.
5. The consent UI and the privacy policy are localized: on English-locale devices
   (such as the review devices) every consent screen and the privacy policy are shown
   in English.
6. Users can review or withdraw consent at any time from **Me > Privacy and AI**.

## Review Steps

1. Launch the app and accept the base privacy notice. (This notice covers only basic
   account/device data; it explicitly states that AI features will ask for consent
   separately at first use.)
2. Sign in with the demo account below.
3. Tap the record button on the Home screen (or open "Generate Summary" / "AI Chat").
4. **Before any data is sent**, a full-screen consent sheet appears. Confirm it lists
   the data, purpose, and all six third-party recipients, and that "Agree and
   continue" is disabled until the checkbox is ticked.
5. Tap Cancel — verify the operation does not proceed and no data is sent.
6. Repeat and tap Agree (after ticking the checkbox) — only then is data transmitted.
7. Open the side menu / Me and select "Privacy and AI" to review the disclosure or
   withdraw the previously granted consent. Withdrawing makes the consent sheet appear
   again on the next AI action.

The "Privacy and AI" page is available to both signed-in and guest users.

Demo account: <固定 demo 手机号> / verification code: <固定验证码>

Privacy Policy: https://ms.seemem.com/privacy
(Section 4 identifies what data is collected, how, all uses, every third-party AI
recipient, and confirms by contract that these providers offer protection no less than
our own policy and may not use the data to train their own models.)

The consent record uses a new version (v3), so the point-of-use consent sheet is shown
on both clean installs and upgrades from earlier builds — including for users who
previously tapped "agree" on the old launch screen.

Thank you for reviewing the updated build.
