# RingMemoryApp 集成修复记录

本文记录本次针对 `RingMemoryApp` 的 iOS 编译、React Native Hermes 打包、蓝牙扫描、录音停止、本地录音保存与日志展示所做的修改。

## 1. iOS 编译失败：`hermesc` 路径错误

### 现象

Xcode 编译报错：

```text
Command PhaseScriptExecution failed with a nonzero exit code
.../react-native-xcode.sh: line 179:
.../ios/Pods/../node_modules/hermes-compiler/hermesc/osx-bin/hermesc:
No such file or directory
```

### 根因

`Podfile` 里有一段自定义补丁会改写 `HERMES_CLI_PATH`：

- 原来写成：`${PODS_ROOT}/../node_modules/hermes-compiler/hermesc/osx-bin/hermesc`
- 这个路径会从 `RingMemoryApp/ios/Pods` 解析到 `RingMemoryApp/ios/node_modules`
- 但真实的 `node_modules` 在 `RingMemoryApp/node_modules`

也就是说，Hermes 编译器文件并没有缺失，而是 Xcode 脚本拿到了错误路径。

### 修改

把路径改成上跳两级：

- `${PODS_ROOT}/../../node_modules/hermes-compiler/hermesc/osx-bin/hermesc`

修改位置：

- [Podfile](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/ios/Podfile#L8)
- [Pods-RingMemoryApp.debug.xcconfig](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/ios/Pods/Target%20Support%20Files/Pods-RingMemoryApp/Pods-RingMemoryApp.debug.xcconfig#L7)
- [Pods-RingMemoryApp.release.xcconfig](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/ios/Pods/Target%20Support%20Files/Pods-RingMemoryApp/Pods-RingMemoryApp.release.xcconfig#L7)

### 结果

`main.jsbundle` 阶段不再因为找不到 `hermesc` 而失败，Hermes 打包脚本路径恢复正确。

## 2. 蓝牙扫描报错：`Tried to resolve a promise more than once`

### 现象

扫描时原生日志显示：

```text
RTNRingModule.startScan(): Tried to resolve a promise more than once.
```

同时其实已经扫到了设备，说明 SDK 本身可用，问题在 React Native 桥接层。

### 根因

`BCLRingManager.shared.startScan` 是持续回调模型，扫描过程中会多次返回设备列表。

但在桥接层实现中，`startScan()` 被定义成 `Promise<void>`，并且每次收到 `.success(devices)` 都会 `resolve(nil)`。Promise 只能完成一次，第二次成功回调就会报错。

### 修改

在 iOS 原生模块 [RTNRingModule.swift](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/ios/RingMemoryApp/RTNRingModule.swift#L60) 中：

- 给 `startScan()` 加了 `didSettlePromise`
- 保证 Promise 只在第一次成功或第一次失败时完成一次
- 后续设备发现只通过 `onDeviceFound` 事件继续上报
- 去掉了扫描回调里过早把 `isScanning` 置回 `false` 的行为

### 结果

扫描流程改回正确模型：

- `startScan()` 表示“启动扫描”
- `onDeviceFound` 表示“持续发现设备”
- `stopScan()` 表示“停止扫描”

## 3. 原生事件警告：`Sending onDeviceFound with no listeners registered`

### 现象

原生日志持续出现：

```text
Sending `onDeviceFound` with no listeners registered.
```

### 根因

`RTNRingModule` 继承了 `RCTEventEmitter`，但把：

- `addListener`
- `removeListeners`

重写成了空实现，导致 React Native 内部不会正确维护监听状态。

### 修改

在 [RTNRingModule.swift](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/ios/RingMemoryApp/RTNRingModule.swift#L42) 中：

- `addListener` 改为调用 `super.addListener`
- `removeListeners` 改为调用 `super.removeListeners`
- 新增 `startObserving` / `stopObserving`
- 使用 `hasListeners` 控制是否发送事件

### 结果

原生事件发射器恢复正常，JS 监听器可以被正确识别。

## 4. 录音无法停止：点击停止后仍持续收到音频包

### 现象

录音时日志持续出现：

- 蓝牙设备特征值数据回调
- ADPCM 音频数据
- 指令队列继续拉流

点击“停止录音”后，仍然继续录音。

### 根因

原实现是递归调用 `controlADPCMFormatAudio(isOpen: true)` 拉取下一帧音频。

虽然 `stopCapture()` 把 `isCapturingAudio` 设成了 `false`，但：

- 已经发出的异步回调还会继续返回
- 失败重试定时器也可能继续触发
- 旧的录音会话没有和新的状态完全隔离

### 修改

在 [RTNRingModule.swift](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/ios/RingMemoryApp/RTNRingModule.swift#L193) 中：

- 增加 `captureSessionID`
- 每次开始录音时生成新的会话 ID
- 每次停止录音时递增会话 ID，使旧回调立即失效
- 增加 `pendingCaptureRetry`
- 停止录音时取消待执行重试
- `requestNextAudioFrame(sessionID:)` 中要求：
  - `isCapturingAudio == true`
  - `sessionID == captureSessionID`
  才能继续拉下一帧

### 结果

`stopCapture()` 不再只是改一个布尔值，而是会真正终止旧的录音会话链路。

## 5. 录音保存路径调整

### 修改前

录音 WAV 文件保存在：

```text
Caches/ringmemoryapp/audio
```

这类缓存目录可能被系统清理，不适合作为用户可回听的录音存储位置。

### 修改后

在 [RTNRingModule.swift](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/ios/RingMemoryApp/RTNRingModule.swift#L331) 中改为保存到：

```text
Documents/ringmemoryapp/audio
```

### 结果

录音文件现在持久保存在 App 本地文档目录，更适合回听与后续管理。

## 6. 增加前端运行日志展示

### 目标

参考 `SeeMemory` 的日志可见性，但不照搬其页面交互模式。

### 修改

在 iOS 原生模块 [RTNRingModule.swift](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/ios/RingMemoryApp/RTNRingModule.swift#L30) 中新增事件：

- `onDebugLog`

并在这些关键流程里输出日志：

- 开始扫描
- 停止扫描
- 扫描失败
- 连接成功
- 连接失败
- 开始录音
- 停止录音
- 录音流错误
- 录音片段保存
- 开始播放录音
- 停止播放录音

在前端 [DevicesScreen.tsx](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/src/screens/DevicesScreen.tsx#L59) 中：

- 监听 `onDebugLog`
- 监听 `onError`
- 在页面底部展示“运行日志”面板

### 结果

前端可以直接看到桥接层关键日志，不必完全依赖 Xcode 控制台。

## 7. 增加本地录音列表与回听能力

### 修改

#### 原生侧

在 [RTNRingModule.swift](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/ios/RingMemoryApp/RTNRingModule.swift#L242) 中新增：

- `playAudioFile(filePath)`
- `stopAudioPlayback()`

使用 `AVAudioPlayer` 播放本地 WAV。

并在 [RTNRingModule.mm](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/ios/RingMemoryApp/RTNRingModule.mm#L24) 中导出对应方法。

#### JS 侧

在 [RingModule.ts](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/src/native/RingModule.ts#L47) 中新增：

- `RingModuleExtras`

用于访问 iOS 原生扩展方法。

在 [useAudioCapture.ts](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/src/hooks/useAudioCapture.ts#L1) 中：

- 把录音片段元数据持久化到 `AsyncStorage`
- 新增 `playSegment`
- 新增 `stopPlayback`
- 新增 `clearSegments`

在 [DevicesScreen.tsx](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/src/screens/DevicesScreen.tsx#L145) 中：

- 增加“本地录音”列表
- 显示每个录音的时间和文件路径
- 提供“播放”“停止”“清空列表”按钮

### 结果

现在录音片段不仅会生成文件，还能在前端直接看到并试听。

## 8. 修正历史录音误上传问题

### 问题

录音片段元数据改为持久化后，页面首次加载历史数据时，可能会把旧片段误认为“新录音”，从而再次触发上传。

### 修改

在 [DevicesScreen.tsx](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/src/screens/DevicesScreen.tsx#L13) 中增加：

- `hasHydratedSegments`

首次从本地恢复 `segments` 时跳过自动上传，只对真正的新片段执行 `uploadSegment(latest)`。

## 9. 修正一处无关但会挡住类型检查的 TS 错误

### 问题

[useMemoryRecall.ts](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/src/hooks/useMemoryRecall.ts#L50) 中：

```ts
await new Promise(resolve => setTimeout(resolve, 1000));
```

在当前 TS 配置下会触发签名不匹配。

### 修改

改为：

```ts
await new Promise<void>(resolve => setTimeout(() => resolve(), 1000));
```

### 结果

`npx tsc --noEmit` 已通过。

## 本次修改文件清单

- [ios/Podfile](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/ios/Podfile)
- [ios/Pods/Target Support Files/Pods-RingMemoryApp/Pods-RingMemoryApp.debug.xcconfig](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/ios/Pods/Target%20Support%20Files/Pods-RingMemoryApp/Pods-RingMemoryApp.debug.xcconfig)
- [ios/Pods/Target Support Files/Pods-RingMemoryApp/Pods-RingMemoryApp.release.xcconfig](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/ios/Pods/Target%20Support%20Files/Pods-RingMemoryApp/Pods-RingMemoryApp.release.xcconfig)
- [ios/RingMemoryApp/RTNRingModule.swift](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/ios/RingMemoryApp/RTNRingModule.swift)
- [ios/RingMemoryApp/RTNRingModule.mm](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/ios/RingMemoryApp/RTNRingModule.mm)
- [src/native/RingModule.ts](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/src/native/RingModule.ts)
- [src/hooks/useAudioCapture.ts](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/src/hooks/useAudioCapture.ts)
- [src/screens/DevicesScreen.tsx](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/src/screens/DevicesScreen.tsx)
- [src/types/index.ts](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/src/types/index.ts)
- [src/hooks/useMemoryRecall.ts](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/src/hooks/useMemoryRecall.ts)

## 当前状态

### 已确认

- Hermes `main.jsbundle` 编译路径问题已修正
- TypeScript 静态检查通过
- iOS 原生桥接层已修复扫描 Promise 多次完成问题
- 前端已具备日志展示和本地录音列表

### 仍需要你本机验证

因为这类问题依赖真机和 Xcode 重新编译，仍需在 iPhone 上确认：

1. 卸载旧 App
2. Xcode `Clean Build Folder`
3. 删除对应 `DerivedData`
4. 重新编译安装
5. 验证：
   - 扫描是否正常
   - `startScan()` 是否不再重复报错
   - 停止录音后是否确实停止
   - 录音文件是否能在列表中播放

