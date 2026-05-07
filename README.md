# RingMemoryApp iOS 编译说明

`RingMemoryApp` 是一个基于 React Native 的智能戒指配套 App。当前 iOS 侧已经集成 `BCLRingSDK.xcframework`，可在真机上进行戒指扫描、连接、录音、本地保存、播放以及调试上传。

本文档面向拿到项目后需要使用 Xcode 在 iPhone 上编译运行的同学。

## 功能概览

- 设备页：扫描智能戒指、连接/断开设备、查看运行日志。
- 录音页能力：支持 ADPCM / PCM 录音、本地 WAV 保存、录音列表、播放、RNNoise 降噪入口、手动上传调试。
- 记忆页：记忆召回交互雏形，当前部分数据仍为 mock。
- 设置页：主题、配置与账号相关的界面雏形。

## 环境要求

- macOS，并已安装 Xcode。
- iPhone 真机一台。蓝牙和录音能力建议使用真机测试，模拟器无法完整验证戒指连接。
- Node.js `>= 22.11.0`。
- npm。
- CocoaPods。
- Apple Developer 账号或可用于真机调试的 Team。

当前项目在本机验证过的环境：

```sh
Xcode 26.2
Node.js v22.22.0
npm 10.9.4
CocoaPods 1.16.2
```

不要求完全一致，但建议使用较新的 Xcode 和 Node 22。

## 项目结构

```text
RingMemoryApp/
├── App.tsx
├── package.json
├── package-lock.json
├── src/
│   ├── native/              # React Native 原生模块 JS 封装
│   ├── screens/             # 旧版页面
│   ├── theme/               # 当前 App 使用的主题版页面
│   └── services/            # API 与本地存储
└── ios/
    ├── RingMemoryApp.xcworkspace
    ├── RingMemoryApp.xcodeproj
    ├── Podfile
    ├── BCLRingSDK.xcframework
    └── RingMemoryApp/
        ├── AppDelegate.swift
        ├── RTNRingModule.swift
        ├── RTNRingModule.mm
        └── Info.plist
```

注意：用 Xcode 打开时请打开 `ios/RingMemoryApp.xcworkspace`，不要直接打开 `.xcodeproj`。项目使用 CocoaPods，直接打开 `.xcodeproj` 容易缺少 Pods 依赖。

## 第一次拉取后的准备

在项目根目录执行：

```sh
cd RingMemoryApp
npm install
```

安装 iOS 依赖：

```sh
cd ios
pod install
cd ..
```

可以先确认本机是否已安装 CocoaPods：

```sh
pod --version
```

如果命令不存在，请先按自己电脑的常规方式安装 CocoaPods。这个项目编译主流程只需要 `npm install` 和 `pod install`。

## Node 路径配置

Xcode 构建 React Native 时需要找到 Node。项目里的 `ios/.xcode.env` 默认使用：

```sh
export NODE_BINARY=$(command -v node)
```

如果 Xcode 报找不到 `node`，在 `ios/.xcode.env.local` 写入你本机 Node 的绝对路径，例如：

```sh
export NODE_BINARY=/opt/homebrew/bin/node
```

可以用下面命令查看本机 Node 路径：

```sh
which node
```

## 使用 Xcode 真机运行

1. 打开 Xcode。
2. 选择 `Open Existing Project...`。
3. 打开：

```text
RingMemoryApp/ios/RingMemoryApp.xcworkspace
```

4. 顶部 Scheme 选择 `RingMemoryApp`。
5. 运行目标选择已连接的 iPhone。
6. 进入 Xcode 左侧项目配置，选择 Target `RingMemoryApp`。
7. 在 `Signing & Capabilities` 中选择自己的 Team。
8. 如果 Bundle Identifier 和你的 Team 冲突，改成唯一值，例如：

```text
com.yourcompany.ringmemoryapp
```

9. 点击 Xcode 左上角 Run 按钮编译运行。

首次安装到真机时，如果 iPhone 提示开发者未受信任，需要在手机上进入：

```text
设置 -> 通用 -> VPN与设备管理
```

信任对应开发者证书。

## Metro 开发服务

Debug 模式下建议先启动 Metro：

```sh
cd RingMemoryApp
npm start
```

然后再在 Xcode 里点击 Run。若没有提前启动，Xcode 通常也会尝试自动拉起 Metro，但手动启动更容易看到 JS 侧日志。

## 权限说明

App 运行时会用到以下 iOS 权限：

- 蓝牙：用于扫描和连接智能戒指。
- 录音/音频：用于录制戒指音频与播放本地音频。
- 照片库：用于聊天/上传场景中选择图片。
- 本地网络：`Info.plist` 已允许本地网络访问，便于开发调试。

相关配置位于：

```text
ios/RingMemoryApp/Info.plist
```

## BCLRingSDK 说明

项目内已经包含：

```text
ios/BCLRingSDK.xcframework
```

并已在 Xcode target 中加入 Frameworks 和 Embed Frameworks。`Podfile` 里还声明了 BCLRingSDK 需要的传递依赖：

- Foil
- NordicDFU
- RxSwift / RxRelay / RxCocoa
- SwiftDate
- SwiftyBeaver
- ZIPFoundation

正常情况下不需要额外手动拖入 SDK。若重新执行 `pod install` 后出现依赖缺失，优先确认是否打开的是 `.xcworkspace`。

## 常见问题

### 1. Xcode 报 `No such module ...`

一般是 Pods 没装好或打开了错误工程。

处理方式：

```sh
cd RingMemoryApp/ios
pod install
```

然后重新打开 `RingMemoryApp.xcworkspace`。

### 2. Xcode 报找不到 `node`

检查：

```sh
which node
```

然后把结果写入 `ios/.xcode.env.local`：

```sh
export NODE_BINARY=/你的/node/绝对路径
```

### 3. Xcode 报找不到 `hermesc`

项目的 `Podfile` 已经对 Hermes CLI 路径做了修正。若仍然报错，重新安装 Pods：

```sh
cd RingMemoryApp/ios
pod install
```

确认生成的 xcconfig 中有类似配置：

```text
HERMES_CLI_PATH = ${PODS_ROOT}/../../node_modules/hermes-compiler/hermesc/osx-bin/hermesc
```

### 4. 真机签名失败

在 Xcode 的 `Signing & Capabilities` 中：

- 选择自己的 Team。
- 修改 Bundle Identifier 为唯一值。
- 确认 iPhone 已连接并已信任当前 Mac。

### 5. 扫不到戒指

请检查：

- 使用真机运行，不要用模拟器验证蓝牙。
- 手机蓝牙已打开。
- App 已授权蓝牙权限。
- 戒指处于可发现/可连接状态。
- Xcode 控制台和 App 设备页底部“运行日志”中是否有错误信息。

### 6. 录音按钮无效或录不到音频

请先确认已经连接戒指。录音接口依赖已连接设备，未连接时原生模块会返回 `Device not connected`。

## 命令行验证

可以用下面命令确认 workspace 能被 Xcode 识别：

```sh
xcodebuild -list -workspace ios/RingMemoryApp.xcworkspace
```

正常输出里应能看到 Scheme：

```text
RingMemoryApp
```

也可以运行 JS 测试：

```sh
npm test
```

## 相关文档

- `项目现有功能总结.md`：当前功能状态说明。
- `INTEGRATION_FIX_SUMMARY.md`：近期 iOS 集成与录音链路修复记录。
- `BCLSDK_TOUCH_RECORDING_CAPABILITIES.md`：BCLSDK 触摸与录音能力分析。
- `SDK集成文档.md`：早期 SDK 集成说明，部分路径可能与当前实现不同，以当前 `ios/Podfile` 和 `ios/RingMemoryApp/RTNRingModule.swift` 为准。
