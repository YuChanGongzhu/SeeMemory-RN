# 5.1.1(i) / 5.1.2(i) AI 授权改造实施文档

> 目标：让 App Store 审核员在**真正触发 AI 功能的那一刻**必然看到"发送什么 / 发给谁 / 用途"的授权弹窗，并且看得懂（英文）。
> 背景根因与被拒历史见记忆 `simemory-appstore-5-1-1-ai-consent`。

## 0. 为什么上一版（build 17/18）没过

- 授权是"**开屏一次点、全局永久 true**"：首启动 `AIConsentContext.tsx` 的 `decision === 'unknown'` 分支弹全屏授权页，一旦点「同意使用第三方 AI」，`aiConsentController.requestConsent` 之后永远直接 `return true`，**点用时不再弹**。
- 审核备注 `app-store-review-notes-privacy.md` 让审核员在开屏选"暂不同意"，但审核员大概率点了"同意"，于是测 AI 功能时屏上什么都不弹 → 取证结论"没问就发数据"。
- 全中文硬编码 + `CFBundleDevelopmentRegion = en`，美区审核设备（iPhone 17 Pro Max / iPad Air M3）上审核员读不懂授权页。
- App Review Information 无 demo 账号（登录要手机号+短信）。

## 1. 改造原则

1. **授权时机后移**：把"授予同意"这一动作从开屏挪到"第一次真正发数据"的 per-action 弹窗。开屏页只做**告知**，不再置 `granted`。
2. **每次未授权都弹**：只要 `decision !== 'granted'`，任何受控 AI 操作前必弹 per-action 弹窗，弹窗带本次的 `data`/`purpose` + 六家服务商 + 政策链接。
3. **显式勾选**：弹窗加必勾 checkbox 才能点 Agree，坐实 "clearly ask permission"。
4. **英文可读**：授权相关界面 + 隐私政策网页做中英双语（跟随系统语言）。App 其余界面本次不译。
5. **可撤回**：保留「隐私与 AI」页的 grant/withdraw。

---

## 2. 代码改动清单（逐文件）

### 2.1 `src/privacy/AIConsentContext.tsx` —— 删除开屏全局授权分支【核心】

**现状**：`state.decision === 'unknown'` 时整屏渲染 `AIConsentDisclosure`，`onAgree` → `controller.grant()`（置全局 granted）。

**改为**：删掉整个 `unknown` 分支。Provider 恒定渲染 `children` + per-action `Modal`（保留现有 `state.promptContext !== null` 的 Modal 块）。

```tsx
// 删除 lines 84-97 的 if (state.decision === 'unknown') {...} 整块。
// hydrated 后直接进入下方 return（children + per-action Modal）。
```

**影响**：首启动不再有 AI 全局授权页；用户/审核员第一次点 AI 功能时才弹。开屏的**基础隐私**页（`ConsentScreen.tsx`，由 `App.tsx` 的 `BasePrivacyGate` 控制）保持不变。

### 2.2 `src/privacy/aiConsentController.ts` —— 保持 per-action 逻辑，去掉"开屏 grant 会短路"的隐患

`requestConsent` 当前逻辑已正确：`granted` 时直接 true，否则弹窗。删除开屏分支后它自然成为**唯一**授权入口。无需改逻辑，但确认：

- `grant()` / `decline()` 仍保留 —— 仅供「隐私与 AI」页手动调用。
- 首启动后 `decision` 默认 `unknown`，第一次 `requestConsent` 必弹。✅

> 注意：`decline()` 会把 `decision` 置 `declined` 并持久化。`requestConsent` 里 `state.decision === 'granted'` 才短路；`declined` 不短路，仍会弹窗——符合预期（用户拒绝后下次用仍再问）。确认这行为不变。

### 2.3 `src/components/AIConsentDisclosure.tsx` —— 加必勾 checkbox

- 新增本地 state `const [checked, setChecked] = useState(false);`（per-action 弹窗每次挂载重置）。
- 在政策链接下方加一行可点的勾选控件（用 `lucide-react-native` 的 `CheckSquare`/`Square`）：
  文案 `t('consent.confirmCheckbox')` = "我已阅读并同意将上述数据发送给第三方 AI 服务商处理" / "I have read and agree to send the above data to third-party AI providers for processing."
- Agree 按钮 `disabled={busy || !checked}`，样式复用现有 `disabled`。
- 首启动**告知页**（若保留，见 2.5）不需要 checkbox；用 prop 区分，例如 `requireCheck?: boolean`，per-action 传 `true`。

### 2.4 `src/screens/PrivacyAIPage.tsx` —— 文案接 i18n，逻辑不变

- 所有中文串替换为 `t(...)`。
- 保留 grant / withdraw 双态按钮，作为"随时可撤回"的证据。入口确认在「我的」里可见（`ProfilePage.tsx` / `AppDrawer.tsx`）。

### 2.5 `src/screens/ConsentScreen.tsx`（开屏基础隐私）—— 改为纯告知 + i18n

- 保留"基础服务需要的数据"段。
- "AI 数据处理单独授权"段改为明确告知："AI 相关功能会在你**首次使用时**单独弹窗征求同意，此处无需操作。" / 英文对应。
- 文案接 i18n。

---

## 3. i18n 落地（轻量，无需引第三方库）

本次只译**授权相关 4 处 + 隐私政策网页**，不引 `i18next`，用最小自研方案：

### 3.1 语言检测

无 `react-native-localize` 依赖。用 RN 原生：

```ts
// src/i18n/locale.ts
import {NativeModules, Platform} from 'react-native';

export function deviceLang(): 'en' | 'zh' {
  const raw =
    Platform.OS === 'ios'
      ? NativeModules.SettingsManager?.settings?.AppleLocale ||
        NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
      : NativeModules.I18nManager?.localeIdentifier;
  return String(raw ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
```

### 3.2 文案表

```ts
// src/i18n/consentStrings.ts
const LANG = deviceLang();
const dict = {
  zh: { 'consent.title': '第三方 AI 数据处理授权', /* ...全部授权相关串 */ },
  en: { 'consent.title': 'Third-Party AI Data Processing Consent', /* ... */ },
} as const;
export const t = (k: keyof typeof dict['zh']) => dict[LANG][k] ?? dict.zh[k];
```

需要抽出的串清单（来源文件 → key）：
- `AIConsentDisclosure.tsx`：标题、lead、"本次操作将发送/用于"、"可能发送的数据"段、"接收方与用途"、免训练声明、"阅读完整隐私政策"、Agree/Cancel label、新增 checkbox 文案。
- `ConsentScreen.tsx`：标题、lead、两段 section、按钮、"不同意"提示。
- `PrivacyAIPage.tsx`：header、状态、各段落、撤回 Alert、footnote、按钮。
- `AIConsentContext.tsx`：`agreeLabel`/`declineLabel` 两处（开屏分支删除后只剩 per-action 那组）。

> `config/legal.ts` 的 `AI_VENDORS` 里 `data`/`purpose` 也要双语：把结构改成 `{vendor, data: {zh,en}, purpose: {zh,en}}`，或在渲染处用 `t()` 映射。服务商名（腾讯云/DeepSeek…）保留原名即可。

### 3.3 隐私政策网页英文版（仓库：`see-mem-studio-web`）

- 现状：`https://ms.seemem.com/privacy` 仅中文（Vite SPA）。
  - 页面：`see-mem-studio-web/src/pages/legal/privacy.tsx`
  - 路由：`see-mem-studio-web/src/routes/router.tsx`（`path: "/privacy"`）
  - meta：`see-mem-studio-web/src/pages/legal/legal-meta.ts`
- 加英文版：新增 `/privacy/en` 路由渲染英文版 `PrivacyPage`，或在 `privacy.tsx` 内按 `navigator.language.startsWith('zh')` 切中英文案；第四节服务商表格逐条译。
- **务必与 App 内 `AI_VENDORS` 清单逐条一致**（服务商、接收数据、用途）——审核会并排比对。改任一处，另一处同步（见 `config/legal.ts` 顶部注释约定）。

---

## 4. 版本与存储

- `consentPolicy.ts` 的 `AI_CONSENT_VERSION` 从 `2` → `3`：让老用户（曾在开屏点过"同意"）的旧记录失效，回到 `unknown`，从而在新流程下点用时重新弹窗。否则升级用户不会看到新弹窗。
- `consentStorage.ts` 的 key 用了 `_v2` 后缀，可保持不变（版本靠记录内 `version` 字段判定），但确认 `parseConsentRecord` 对 `version !== 3` 返回 `unknown`。✅（现有逻辑即如此）
- 构建号 `CURRENT_PROJECT_VERSION` 递增到 19。

---

## 5. 提审材料（代码之外，同等关键）

### 5.1 更新 `docs/app-store-review-notes-privacy.md`

关键：**Review Steps 不要再让审核员选"暂不同意"**，改成"直接去用一个 AI 功能，观察弹窗"。示例：

```
Review Steps
1. Launch the app and accept the base privacy notice.
2. Sign in with the demo account below.
3. Tap the record button on the Home screen (or open "Generate Summary" / "AI Chat").
4. BEFORE any data is sent, a full-screen consent sheet appears. It states what will be
   sent (e.g. "audio recording"), its purpose, lists every third-party recipient by name
   (Amphion, Tencent Cloud, DeepSeek, Alibaba Cloud Bailian/Qwen, Moonshot/Kimi,
   Amazon Web Services Bedrock), and links to the privacy policy. The Agree button is
   disabled until the confirmation checkbox is ticked.
5. Tap Cancel — the operation aborts and no data is sent.
6. Repeat and tap Agree — only then is data transmitted.
7. Consent can be reviewed/withdrawn anytime in Me > Privacy and AI.

Demo account: <固定 demo 手机号> / verification code: <固定验证码>（已长期存在，直接沿用）
```

### 5.2 App Store Connect › App Review Information

- 填现成的固定 demo 账号（手机号 + 后端放行的固定验证码，已长期存在，绕开短信）。
- Notes 附上第 5.1 的路径 + 一句"consent prompt appears at point of use, in English on English-locale devices"。

### 5.3 回信（App Store Connect 内回复被拒消息）

用英文确认"确实使用第三方 AI + 已实现点用时授权 + 政策第四节已列全 + equal-protection 已在合同约束"，并指路。可复用 5.1 的措辞。

---

## 6. 自测清单（打包前）

- [ ] 全新安装：首启动**不**出现 AI 全局授权页；仅基础隐私页。
- [ ] 首次点录音/总结/AI 对话 → 弹 per-action 授权，含 data/purpose + 六家服务商 + 政策链接 + 必勾 checkbox。
- [ ] 不勾选时 Agree 禁用；Cancel → 操作中止、无网络请求发出（用 Charles/抓包或 `assertAiConsentGranted` 抛错验证）。
- [ ] Agree 后同一功能再用不再弹。
- [ ] 系统语言切英文：授权页、弹窗、PrivacyAIPage、隐私政策网页全英文。
- [ ] 从 build 18 覆盖升级：因 `AI_CONSENT_VERSION=3`，仍会在首次点用时弹窗。
- [ ] 「我的 → 隐私与 AI」可撤回，撤回后再点 AI 功能会重新弹。

---

## 7. 改动文件汇总

| 文件 | 改动 |
|---|---|
| `src/privacy/AIConsentContext.tsx` | 删除 `unknown` 开屏 grant 分支【核心】 |
| `src/privacy/consentPolicy.ts` | `AI_CONSENT_VERSION` 2→3 |
| `src/components/AIConsentDisclosure.tsx` | 加必勾 checkbox + i18n |
| `src/screens/ConsentScreen.tsx` | 改纯告知 + i18n |
| `src/screens/PrivacyAIPage.tsx` | i18n |
| `src/config/legal.ts` | `AI_VENDORS` 双语化 |
| `src/i18n/locale.ts`（新增） | 设备语言检测 |
| `src/i18n/consentStrings.ts`（新增） | 授权相关文案表 |
| `docs/app-store-review-notes-privacy.md` | 重写 Review Steps + demo 账号 |
| `ios/…/project.pbxproj` | `CURRENT_PROJECT_VERSION` → 19 |
| 政策网页仓（`see-mem-studio-web` 等） | 加 `/privacy/en` 英文版 |

> 未改：`aiConsentController.ts`（逻辑已正确）、`consentRuntime.ts`、`consentStorage.ts`、各 `assertAiConsentGranted()` 网络层兜底。
