# BCLSDK 戒指触摸与录音能力说明

## 结论

BCLSDK 里可以确认有两套不同的能力：

1. `HID 触摸/手势能力`
2. `设备录音控制能力`

这两套能力是分开的，不是同一个接口。

目前从 SDK 定义和 `SeeMemory` 示例来看：

- 有“触摸触发实时音频上传”能力
- 有“开始录音 / 停止录音”能力
- 但没有发现“触摸一下开始录音，再触摸一下停止录音”这种单独公开的 SDK 接口

更准确地说，当前能确认的是：

- `touchMode = 4` 表示 `audioUploadMode`
- `ringStartRecording(isOpen: ...)` 表示显式开始/停止录音

因此，“触摸开始录音/停止录音”不能直接等同于 SDK 已公开支持的能力。更像是：

- 触摸模式负责触发 HID/实时音频上传
- 录音模式负责设备本身的录音开始/停止

## SDK 中确认到的接口

接口定义位于：

- [arm64-apple-ios.swiftinterface](/Users/ivy/Desktop/program/ChipletRing-APPSDK/RingMemoryApp/ios/BCLRingSDK.xcframework/ios-arm64/BCLRingSDK.framework/Modules/BCLRingSDK.swiftmodule/arm64-apple-ios.swiftinterface)

### 1. HID 相关接口

- `setHIDMode(touchMode:gestureMode:systemType:deviceModelName:screenHeightPixel:screenWidthPixel:completion:)`
- `getHIDFunctionCode(completion:)`
- `getCurrentHIDMode(completion:)`
- `setGestureFunction(swipeUpGesture:swipeDownGesture:snapGesture:pinchGesture:completion:)`
- `hidTouchAudioDataBlock`

### 2. 音频 / 录音相关接口

- `controlPCMFormatAudio(isOpen:completion:)`
- `controlADPCMFormatAudio(isOpen:completion:)`
- `ringStartRecording(isOpen:totalDuration:sliceDuration:completion:)`

## BCLTouchHIDMode 枚举

SDK 中触摸模式定义如下：

```swift
@objc public enum BCLTouchHIDMode : UInt8 {
  case videoMode = 0
  case photoMode = 1
  case musicMode = 2
  case pptMode = 3
  case audioUploadMode = 4
  case disabled = 0xFF
}
```

对应含义：

- `0`: 短视频模式
- `1`: 拍照模式
- `2`: 音乐控制
- `3`: PPT 控制
- `4`: 实时音频上传
- `255`: 关闭

这里没有出现“startRecordingMode”或“stopRecordingMode”之类的枚举值。

## BCLGestureHIDMode 枚举

SDK 中手势模式定义如下：

```swift
@objc public enum BCLGestureHIDMode : UInt8 {
  case videoMode = 0
  case photoMode = 1
  case musicMode = 2
  case pptMode = 3
  case snapPhotoMode = 4
  case disabled = 0xFF
}
```

对应含义：

- 短视频
- 拍照
- 音乐控制
- PPT 控制
- 打响指拍照
- 关闭

同样没有“手势开始录音/停止录音”的公开枚举。

## 如何判断这款戒指是否支持触摸音频能力

应调用：

- `getHIDFunctionCode()`

SDK 返回里可以看到这些能力位：

- `isHIDSupported`
- `isTouchPhotoSupported`
- `isTouchShortVideoSupported`
- `isTouchMusicControlSupported`
- `isTouchPPTControlSupported`
- `isTouchAudioUploadSupported`
- `isPinchPhotoSupported`
- `isGestureShortVideoSupported`
- `isGestureMusicControlSupported`
- `isGesturePPTControlSupported`
- `isSnapPhotoSupported`

其中和你当前需求最相关的是：

- `isTouchAudioUploadSupported`

如果它是 `true`，只能说明这款硬件支持“触摸触发实时音频上传”这一类 HID 音频能力。

它不直接等于：

- 触摸开始本地录音
- 触摸停止本地录音

## SeeMemory 中的实现方式

参考文件：

- [AudioTransmission_Module.swift](/Users/ivy/Desktop/program/ChipletRing-APPSDK/SeeMemory/BCLRingSDKDemo/FunctionExamplesModule/FunctionExamples_module/AudioTransmission_Module.swift)
- [Main_VC.swift](/Users/ivy/Desktop/program/ChipletRing-APPSDK/SeeMemory/BCLRingSDKDemo/Main_VC.swift)
- [HIDFunction_Module.swift](/Users/ivy/Desktop/program/ChipletRing-APPSDK/SeeMemory/BCLRingSDKDemo/FunctionExamplesModule/FunctionExamples_module/HIDFunction_Module.swift)

### 1. SeeMemory 的“开始/停止录音”

SeeMemory 里录音是直接调用：

```swift
BCLRingManager.shared.ringStartRecording(isOpen: true, totalDuration: 1200, sliceDuration: 600)
```

停止时调用：

```swift
BCLRingManager.shared.ringStartRecording(isOpen: false, totalDuration: 0, sliceDuration: 0)
```

这说明 SeeMemory 把录音控制建立在 `ringStartRecording(...)` 上，而不是 HID 触摸模式上。

### 2. SeeMemory 的“触摸实时音频上传”

SeeMemory 里触摸音频上传示例是：

```swift
BCLRingManager.shared.hidTouchAudioDataBlock = { dataLenght, seq, audioData, isEnd in
    // 接收 HID 触摸上传的实时音频数据
}

BCLRingManager.shared.setHIDMode(touchMode: 4,
                                 gestureMode: 255,
                                 systemType: 1,
                                 deviceModelName: ...,
                                 screenHeightPixel: ...,
                                 screenWidthPixel: ...) { res in
    ...
}
```

这里的核心是：

- `touchMode: 4`
- `hidTouchAudioDataBlock`

这对应的是“触摸上传实时音频数据”，不是公开意义上的“触摸开始录音 / 停止录音命令”。

## 当前可以下的技术判断

基于 SDK 定义和 `SeeMemory` 示例，可以下这个判断：

1. BCLSDK 支持戒指触摸/HID功能。
2. 戒指是否支持哪些触摸功能，要以 `getHIDFunctionCode()` 返回结果为准。
3. 触摸能力里明确包含 `audioUploadMode`，即实时音频上传。
4. SDK 里另有独立的 `ringStartRecording(...)` 负责开始/停止录音。
5. 目前没看到公开接口把“触摸动作”直接配置成“开始录音 / 停止录音”。

## 对接建议

如果你的目标是“尽快可用”，建议按下面顺序判断：

1. 先调用 `getHIDFunctionCode()`，确认设备是否支持 `isTouchAudioUploadSupported`
2. 如果只是要稳定开始/停止录音，优先继续使用 `ringStartRecording(...)`
3. 如果后续要做“触摸触发说话/上传音频”，再单独研究 `setHIDMode(touchMode: 4)` 和 `hidTouchAudioDataBlock`

## 一句话结论

这款产品从 SDK 看，明确支持：

- 触摸实时音频上传
- 显式开始录音 / 停止录音

但暂时没有证据表明 SDK 公开支持：

- 触摸一下开始录音
- 再触摸一下停止录音

如果要进一步坐实，下一步应该在真机上打印 `getHIDFunctionCode()` 的返回内容，看 `isTouchAudioUploadSupported` 和当前 `touchHIDMode` 的实际值。
