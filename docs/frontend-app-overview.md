# Remmy 前端 App 形态概览

> 本文是面向产品、设计和研发的“当前 App 大概长什么样”活文档。它描述已接入主入口的界面，不把仓库里未挂载的旧页面或概念稿当成现状。

## 文档基线

| 项目 | 当前基线 |
| --- | --- |
| 产品显示名 | Remmy |
| 代码仓库 | [devhub-club/seemem/app](https://cnb.cool/devhub-club/seemem/app) |
| 默认分支 | `main` |
| 本次核对提交 | `4f46db1`（2026-07-31） |
| 当前工作区增量 | `codex/timeline-object-edit`：时间流对象长按编辑（尚未提交） |
| 技术形态 | React Native 0.84，iOS / Android 原生 App |
| 核对方式 | 静态检查入口、导航、页面组件和设计 token；尚未以真机截图逐页校对 |

当前生效入口是 `App.tsx -> src/navigation/Root.tsx`。`src/theme/` 下仍保留一套较早的多主题/底部 Tab 页面，但它不是当前主界面，维护本文时不要把两套 UI 混在一起。

## 整体印象

Remmy 当前是一套偏 iOS 的轻量记忆助手界面：大面积白色和浅灰背景，黑色为主操作色，圆角卡片、胶囊按钮、轻阴影较多。主页面不使用传统底部 Tab，而是“首页中枢 + 左侧抽屉 + 子页面返回”的结构。

用户打开 App 后，依次经过基础隐私同意和登录。登录页以居中的 Remmy 星形图标为视觉主体，主文案是“唤醒你的专属 AI”，支持手机号验证码登录，也可以“随便看看”进入游客体验。

## 首页大致布局

```text
┌──────────────────────────────────┐
│  ☰   [ ✦ 搜索记忆            ]  蓝牙 │
│                                  │
│  记忆碎片                  ↻  筛选 │
│  今天                            │
│  ┌ 今日状态 / 情绪摘要卡片 ─────┐ │
│  └────────────────────────────┘ │
│  09:30  ┌ 记忆卡片 ───────────┐ │
│         │ 标题、摘要、标签、媒体 │ │
│         └────────────────────┘ │
│  11:20  ┌ 下一条记忆卡片 ─────┐ │
│         └────────────────────┘ │
│                                  │
│       [ ✦ AI 对话 | ＋ 记一笔 ]   │
└──────────────────────────────────┘
```

- 顶部左侧汉堡按钮打开全局抽屉，中间是“搜索记忆”，右侧蓝牙图标显示记忆粒连接/同步状态。
- 内容主体按日期分组展示“记忆碎片”。今天会插入情绪摘要卡，过去日期可出现历史沉淀卡。
- 记忆卡包含标题、内容或 AI 摘要、标签、时间和可能的图片/音频信息；可进入详情，也支持编辑、追加和删除等操作。
- 底部不是导航栏，而是一枚悬浮的深色双入口胶囊：“AI 对话”和“记一笔”。
- 游客态会用演示数据形成完整首页，但多数记忆内容会模糊或限制写操作。

## 全界面清单

这里的“全部”指从当前 `App.tsx` 主入口可达的页面、子页面和承担完整任务的弹层。仓库里未被当前入口挂载的旧版界面单独列在最后，不混入现状。

### 1. 启动、隐私与登录

| 界面 / 状态 | 用户看到的样子 | 关键操作 | 代码 |
| --- | --- | --- | --- |
| 启动加载 | 浅灰全屏背景，中央黑色加载指示器 | 等待本地隐私状态和登录态恢复 | `App.tsx` |
| 基础隐私同意 | 盾牌图标、标题、基础数据与 AI 使用说明、隐私政策链接；底部黑色“同意”与文字“不同意” | 同意后进入登录；不同意则停留并显示原因 | `src/screens/ConsentScreen.tsx` |
| 登录首页 | 白底、居中 Remmy 星形图标、“唤醒你的专属 AI”、黑色手机号登录按钮；右上“随便看看” | 勾选隐私政策、手机号登录、游客进入 | `src/screens/LoginScreen.tsx` |
| 手机号输入 | 左上返回，标题“手机号登录”，浅灰输入框和黑色“获取验证码” | 输入 11 位手机号 | `src/screens/LoginScreen.tsx` |
| 验证码输入 | 显示掩码手机号，居中六位验证码输入框和确认按钮 | 确认登录 | `src/screens/LoginScreen.tsx` |
| 登录失败 | 链接图标、“验证码有误”、重新登录与“先随便看看” | 重试或进入游客态 | `src/screens/LoginScreen.tsx` |
| 写操作登录门控 | 游客触发写操作后，全屏滑入同一登录界面，右上变成“关闭” | 登录或关闭 | `App.tsx`、`src/hooks/useWriteGate.tsx` |
| AI 单次授权 | 盾牌图标、将发送的数据/用途、第三方供应商列表和显式勾选框 | 同意后继续当前 AI 操作，或拒绝返回 | `src/components/AIConsentDisclosure.tsx` |

### 2. 全局框架与首页弹层

| 界面 / 状态 | 用户看到的样子 | 关键操作 | 代码 |
| --- | --- | --- | --- |
| 首页 | 顶部菜单、搜索框、设备图标；中部按日期排列的记忆流；底部悬浮“AI 对话 / 记一笔” | 搜索、刷新、筛选、进入记忆、对话或新建 | `src/screens/HomeHub.tsx` |
| 首页空态 | 仍保留主框架，仅显示欢迎卡；接口失败时显示红色重试提示 | 刷新重试 | `src/screens/HomeHub.tsx` |
| 游客首页 | 使用完整演示记忆和情绪卡；非公告记忆模糊，写操作触发登录 | 浏览演示、登录 | `src/screens/HomeHub.tsx` |
| 左侧抽屉 | 白色侧栏覆盖约大部分屏宽；顶部头像与账号，中间额度/统计/热力，底部功能菜单 | 个人信息、记忆粒、沉淀、待办、隐私、退出 | `src/components/AppDrawer.tsx` |
| 视图与筛选 | 底部圆角抽屉，提供排序和载体类型选项 | 按创建/活跃排序，筛选语音、图像或文字 | `src/components/HomeFilterSheet.tsx` |
| 记忆粒状态 | 底部抽屉显示连接状态、电量、存储、录音、待同步数量；未连接时显示引导 | 重连、蓝牙同步、WiFi 快传、进入设备页 | `src/components/HomeDeviceButton.tsx` |
| 传输进度浮标 | 首页底部、悬浮操作胶囊上方的同步状态提示 | 查看蓝牙/WiFi 传输进度或失败信息 | `src/screens/hardware/TransferBadge.tsx` |
| 新建总结 | 底部抽屉；三枚“时间/人物/事件”维度按钮，按维度出现周期或多选列表 | 生成每日/每周/每月/自定义、人物或事件总结 | `src/components/CreateSummarySheet.tsx` |
| 全屏图片预览 | 近黑色灯箱，图片居中适配屏幕，右上角圆形关闭按钮 | 单指关闭、双指缩放，加载时显示白色进度环 | `src/hooks/useImagePreview.tsx` |
| 系统确认与错误提示 | 原生系统 Alert；用于删除记忆、退出/注销、隐私撤回、设备危险操作和接口错误 | 确认、取消或重试 | 各业务页面 |

### 3. 记忆、对话与修正

| 界面 / 状态 | 用户看到的样子 | 关键操作 | 代码 |
| --- | --- | --- | --- |
| AI 对话 | 顶部 Remmy 头像与“记忆对话”；AI 浅灰气泡、用户黑色气泡；底部胶囊输入栏 | 文字、语音、图片消息；播放音频；打开图片 | `src/screens/ChatPage.tsx` |
| 对话录音状态 | 输入栏上方显示“正在录音”红点、识别中或错误横幅 | 结束或取消录音 | `src/screens/ChatPage.tsx` |
| 新建记忆 | 顶部关闭/“记录思绪”/保存；标题和多行正文；底部 AI 润色及媒体图标 | 保存文字记忆 | `src/screens/EditorPage.tsx` |
| 整条记忆编辑 | 顶部“编辑记忆”；原摘要卡可展开完整时间流；下方填写自然语言修正指令 | 提交、查看 AI 理解、轮询后端重建、失败重试 | `src/screens/EditorPage.tsx` |
| 追加细节 | 与整条编辑相同，文案引导用户补充新事实 | 提交补充并触发后端重建 | `src/screens/EditorPage.tsx` |
| 时间流对象编辑 | 在记忆详情长按某条后端真实时间流后进入；上方只读显示目标时间、媒体和原文字，下方直接编辑文字 | 保存后提交结构化节点快照和碎片版本，后端校验并触发完整记忆链重建 | `src/screens/EditorPage.tsx`、`src/apis/requests/corrections.ts` |
| 修正处理中 | 浅灰进度卡显示“理解修改/重写摘要/重建关联/更新汇总” | 等待完成；超时后回列表等待 | `src/screens/EditorPage.tsx` |
| 记忆详情 | 白底；顶部返回、分享、更多；深色 AI 核心概要；正文下方为溯源时间流 | 分享、编辑整条记忆、追加、删除、切换高光/全量 | `src/screens/MemoryDetail.tsx` |
| 时间流 | 虚线时间轴、时间、文本/图片/视频/音频/文档对象；相近记录可折叠成期间分组 | 播放、预览；真实碎片支持长按对象编辑 | `src/screens/MemoryDetail.tsx`、`src/ui/TimelineNode.tsx` |
| 分享记忆 | 底部抽屉展示微信好友、朋友圈、生成长图、复制链接四个圆形入口 | 选择分享方式 | `src/screens/MemoryDetail.tsx` |
| 分享长图 | 深色遮罩中居中浅色海报卡，包含日期、摘要、标签、Remmy 品牌和二维码 | 保存到相册、关闭 | `src/screens/MemoryDetail.tsx` |

### 4. 报告、脉络与沉淀

| 界面 / 状态 | 用户看到的样子 | 关键操作 | 代码 |
| --- | --- | --- | --- |
| 今日报告 | 白底；情绪频谱条、统计格、活跃时段图、高频词、事件回溯 | 点击事件回溯进入对应记忆详情 | `src/screens/StatusDetail.tsx` |
| 每日沉淀 | 与今日报告同构但使用深色背景和浅色文字 | 查看历史当天的情绪与事件 | `src/screens/StatusDetail.tsx` |
| 记忆脉络·热力 | 顶部切换按钮、近若干周热力方格、多少图例；下方展示所选日期记忆 | 选择热力格并钻取记忆 | `src/screens/TimelinePage.tsx` |
| 记忆脉络·心情 | 月历格用情绪色标记每天，底部展示所选日期心情总结 | 翻月、选日期、进入每日沉淀 | `src/screens/TimelinePage.tsx` |
| 我的沉淀 | 浅灰背景，顶部搜索与横向类型筛选；主体为带彩色光晕的深色总结卡 | 搜索、分页、失败重试、进入详情 | `src/screens/ArchivePage.tsx` |
| 沉淀详情 | 深色全屏、顶部彩色光晕；实体标签、大标题、元数据、全息洞察、关键词和相关记忆卡 | 点击相关记忆进入记忆详情 | `src/screens/TopicSummaryDetail.tsx` |

### 5. 待办提醒

| 界面 / 状态 | 用户看到的样子 | 关键操作 | 代码 |
| --- | --- | --- | --- |
| 待办列表 | 顶部标题和黑色加号；横向筛选胶囊；白色提醒卡带类型、来源、时间和开关 | 新建、编辑、启停、筛选 | `src/screens/TodoPage.tsx` |
| 新建任务 | 底部抽屉；提醒内容、名称、一次性/周期性、日期时间或重复频率 | 创建一次性、每天、每周、每月或高级 Cron 提醒 | `src/screens/TaskDialog.tsx` |
| 编辑任务 | 与新建抽屉同构，任务类型锁定；可更新内容、时间和启用状态 | 保存修改 | `src/screens/TaskDialog.tsx` |

### 6. 记忆粒设备全流程

| 界面 / 状态 | 用户看到的样子 | 关键操作 | 代码 |
| --- | --- | --- | --- |
| 我的设备·未连接 | 居中记忆粒产品图、能力小卡和黑色“连接设备”按钮 | 扫描并连接 MR20 | `src/screens/HardwarePage.tsx` |
| 扫描 / 连接中 | 白色全屏状态层、蓝色扫描圆、设备列表或连接提示 | 选择附近设备、取消 | `src/screens/HardwarePage.tsx` |
| 连接成功 | 绿色成功圆和“连接成功” | 自动回设备主页 | `src/screens/HardwarePage.tsx` |
| 我的设备·已连接 | 深色设备状态卡显示设备名、电量、存储和录音；下方自动同步/转写开关及录音日期列表 | 同步、播放、转写、打开日期、进入设备设置 | `src/screens/HardwarePage.tsx` |
| 某日录音 | 子页标题为日期；录音列表支持选择，显示重新处理提示和操作按钮 | 播放、转写、删除或批量处理 | `src/screens/HardwarePage.tsx` |
| 录音转写 | 底部抽屉显示录音时间、转写文本或处理中/失败状态 | 播放录音、查看转写 | `src/screens/HardwarePage.tsx` |
| 设备文件 | 目录/文件列表、选择栏和传输状态；包含 WiFi 入网与清理确认 | 选择同步、删除设备文件、清理已传输录音 | `src/screens/hardware/DeviceFiles.tsx` |
| 设备设置 | iOS 设置式分组列表 | WiFi、时间、录音模式、系统更新、关于设备 | `src/screens/hardware/DeviceSettings.tsx` |
| WiFi 管理 | 热点名称、密码、状态和修改入口 | 修改热点信息、用于 WiFi 快传 | `src/screens/hardware/WifiManage.tsx` |
| 时间校准 | 当前手机/设备时间与校准说明 | 将设备时间同步到手机 | `src/screens/hardware/TimeSync.tsx` |
| 录音模式说明 | 说明设备录音行为的文本页 | 阅读说明并返回 | `src/screens/hardware/RecordMode.tsx` |
| 系统更新 | 当前/可用固件、版本说明和升级按钮；升级中显示进度 | 检查并确认 OTA 更新 | `src/screens/hardware/OtaUpdate.tsx` |
| 关于设备 | 设备名称、型号、序列号、固件版本等设置式信息 | 修改设备名、进入帮助 | `src/screens/hardware/AboutDevice.tsx` |
| 帮助与反馈 | 常见连接/同步问题和反馈入口 | 查看排障说明 | `src/screens/hardware/HelpFeedback.tsx` |
| 设备危险操作确认 | iOS 风格居中弹窗 | 确认断开、解绑或删除；取消返回 | `src/screens/hardware/parts.tsx` |

### 7. 账号、隐私与商业化隐藏页

| 界面 / 状态 | 用户看到的样子 | 关键操作 | 代码 |
| --- | --- | --- | --- |
| 个人信息 | 头像昵称、手机号、额度、隐私入口、退出登录、注销账号和版本号 | 编辑昵称、进入隐私、退出、两步注销确认 | `src/screens/ProfilePage.tsx` |
| 隐私与 AI | AI 使用状态卡、数据范围、供应商列表、完整政策链接和脚注 | 授权或撤回 AI 数据处理同意 | `src/screens/PrivacyAIPage.tsx` |
| 后端环境切换（开发入口） | 在个人信息页连续点击版本号 7 次后出现底部抽屉，列出生产/测试环境及主机 | 切换环境并强制重新登录 | `src/ui/EnvSwitchSheet.tsx` |
| 会员套餐 | 深色会员页，基础/PRO/MAX 套餐卡、月/年切换、权益和底部购买按钮 | 选择套餐、创建订单 | `src/screens/MembershipPage.tsx` |
| 加购算力包 | 白底；额度进度、最多三张算力商品卡和确认支付按钮 | 选择算力包、创建订单 | `src/screens/PowerStorePage.tsx` |

会员套餐和算力包虽然保留路由与页面，但当前 `SUBSCRIPTION_ENABLED = false`，正常产品入口不会展示。它们属于“实现存在、用户不可达”，不能在对外截图或现状说明中当作已上线功能。

### 8. 当前入口未使用的旧界面

`src/theme/` 下的 `MemoryScreen`、`DevicesScreen`、`SettingsScreen`，以及依赖旧主题体系的 `DiaryPage`、`ReplayPage`、`NasPage`、`MomentDetail`、`SummaryDetail`、`DevicesOverlay`、`RechargeSheet`、`CapturePanel` 等组件没有挂入当前 `RootView`。它们可能仍被旧组件相互引用，但不属于当前 Remmy 主界面。若以后恢复入口，应先确认 ThemeProvider、导航和真实数据链，再移入上面的全界面清单。

## 视觉规则

| 元素 | 当前规则 |
| --- | --- |
| 页面背景 | `#F9F9FB` 浅灰；卡片多为白色 |
| 主文字 / 主操作 | `#1A1A1A` / 黑色 |
| 次级文字 | `#8E8E93` |
| 分隔与输入底色 | `#E5E5EA` / `#F2F2F7` |
| 圆角 | 常用 12–24；胶囊按钮约 20–40 |
| 字体 | iOS System / Android sans-serif，标题偏粗 |
| 状态色 | 专注绿、焦虑红、兴奋黄、疲惫灰；设备信息额外使用系统蓝 |
| 特殊深色页 | 历史沉淀、会员/算力相关页面使用深灰或黑色卡面 |

## 当前边界

- 会员套餐和算力加购页面仍在路由中，但 `SUBSCRIPTION_ENABLED = false`，v1.0 主入口不展示。
- “记一笔”的图片、录音和附件入口已有视觉占位，当前新建记忆只支持保存文字。
- 时间流长按编辑只对带真实 `fragmentId`、完整 `update_time` 且来自后端 `timeline[]` 的节点开放；事件回溯、总结合成卡和未被 timeline 引用的旧媒体节点保持只读。
- 时间流数组项目前没有永久 ID。提交使用 `fragment_id + expected_update_time + index + 完整节点快照` 做乐观并发校验；节点或碎片已变化时返回冲突并要求刷新，不做模糊定位。
- 旧时间流数据缺少 `type` 或 `media_ids` 时按 `text` 和空媒体列表读取，仍可展示和编辑；旧版未挂入 `timeline[]` 的合成媒体继续展示但保持只读。
- 旧 App 仍走原有整条记忆修正、查询和重试接口；新增 Timeline 路由不替换旧路由。新 App 遇到未提供 `update_time` 的旧服务时自动关闭长按入口，避免提交无法校验的写操作。
- 首页、情绪、记忆脉络和设备页已经连接真实接口或硬件状态；游客态和部分空态仍会使用演示数据。
- 本文不描述 `seemem-fe-monorepo/apps/user-client` 的 Web 客户端，也不把 `src/theme/` 的旧版主题页面当成当前移动 App。
- 由于本次没有真机运行，尺寸、刘海安全区、键盘顶起和 Android/iOS 差异仍需用截图补充验证。

## 代码索引

| 想确认什么 | 以这些文件为准 |
| --- | --- |
| 启动、隐私和登录门控 | `App.tsx`、`src/screens/ConsentScreen.tsx`、`src/screens/LoginScreen.tsx` |
| 当前页面清单和导航结构 | `src/navigation/Root.tsx`、`src/navigation/nav.tsx` |
| 首页结构 | `src/screens/HomeHub.tsx`、`src/ui/Header.tsx`、`src/ui/FabCapsule.tsx` |
| 左侧抽屉 | `src/components/AppDrawer.tsx` |
| 全局颜色、圆角、字号和阴影 | `src/design/tokens.ts` |
| 设备首页入口 | `src/components/HomeDeviceButton.tsx`、`src/screens/HardwarePage.tsx` |
| 功能开关 | `src/config/features.ts` |

## 维护约定

出现以下变化时同步更新本文：

1. `App.tsx` 或 `Root.tsx` 更换主入口、导航结构或页面清单。
2. `HomeHub.tsx`、`AppDrawer.tsx`、`FabCapsule.tsx` 改变首页信息架构。
3. `tokens.ts` 改变主色、背景、字体、圆角或阴影体系。
4. 新页面获得真实入口，或现有功能开关对用户开放。
5. 完成真机视觉验收后，在“主要页面”中补充同一版本的 iOS/Android 截图，并把核对方式改为“代码 + 真机”。

每次维护至少更新“本次核对提交”；未运行真机时继续保留验证边界，不用让文档比 App 本身更自信。
