# RingMemoryApp SDK 集成文档

## 概述

本文档描述 RingMemoryApp 如何集成 BraveChip ChipletRing 智能戒指 SDK，实现设备扫描、蓝牙连接和音频录制功能。

---

## 一、项目结构

```
RingMemoryApp/
├── ios/
│   ├── LocalPods/RTNRingModule/          # iOS 原生模块
│   │   ├── RTNRingModule.podspec
│   │   ├── RTNRingModule.swift
│   │   ├── RTNRingModule.mm
│   │   ├── RTNRingModule-Bridging-Header.h
│   │   ├── BCLRingSDK.xcframework        # BCLRingSDK (已 vendored)
│   │   └── LICENSE
│   └── RingMemoryApp/Info.plist          # 已添加蓝牙权限
│
├── android/
│   ├── app/libs/
│   │   └── ChipletRing1.0.44.aar        # Android SDK
│   └── app/src/main/java/com/ringmemoryapp/
│       ├── rtnringmodule/
│       │   ├── RingModule.kt             # Android 原生模块
│       │   └── RingPackage.kt           # React Native Package
│       └── MainApplication.kt            # 已注册 RingPackage
│
└── src/
    ├── specs/NativeRingModule.ts         # TypeScript 接口定义
    └── hooks/useRingModule.ts            # React Hook 封装
```

---

## 二、iOS 集成

### 2.1 文件清单

| 文件 | 说明 |
|------|------|
| `ios/LocalPods/RTNRingModule/RTNRingModule.podspec` | CocoaPods 配置文件 |
| `ios/LocalPods/RTNRingModule/RTNRingModule.swift` | Swift 实现，桥接 BCLRingSDK |
| `ios/LocalPods/RTNRingModule/RTNRingModule.mm` | Objective-C++ 桥接层 |
| `ios/LocalPods/RTNRingModule/BCLRingSDK.xcframework` | BCLRingSDK 框架 |
| `ios/Podfile` | 已添加 RTNRingModule 依赖 |
| `ios/RingMemoryApp/Info.plist` | 已添加蓝牙权限 |

### 2.2 Podfile 修改

```ruby
target 'RingMemoryApp' do
  config = use_native_modules!

  use_react_native!(
    :path => config[:reactNativePath],
    :app_path => "#{Pod::Config.instance.installation_root}/.."
  )

  # Local RTNRingModule for BCLRingSDK integration
  pod 'RTNRingModule', :path => './LocalPods/RTNRingModule'
end
```

### 2.3 Info.plist 权限

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>RingMemoryApp needs Bluetooth access to connect to your smart ring device.</string>
<key>NSBluetoothPeripheralUsageDescription</key>
<string>RingMemoryApp needs Bluetooth access to connect to your smart ring device.</string>
<key>UIBluetoothAlwaysUsageDescription</key>
<string>RingMemoryApp needs Bluetooth access to connect to your smart ring device.</string>
```

### 2.4 编译验证

```bash
cd /Users/ivy/Desktop/program/RingMemoryApp/ios

# 安装依赖
pod install

# 编译项目
xcodebuild -workspace RingMemoryApp.xcworkspace \
  -scheme RingMemoryApp \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  build
```

### 2.5 真机调试步骤

1. 用数据线连接 iPhone
2. 打开 Xcode：`open RingMemoryApp.xcworkspace`
3. 左上角选择你的设备（非 Simulator）
4. 选择 `Signing & Capabilities`，勾选 `Automatically manage signing`
5. 选择你的开发团队
6. 按 `Cmd + R` 运行

---

## 三、Android 集成

### 3.1 文件清单

| 文件 | 说明 |
|------|------|
| `android/app/libs/ChipletRing1.0.44.aar` | ChipletRing SDK |
| `android/app/src/main/java/com/ringmemoryapp/rtnringmodule/RingModule.kt` | Kotlin 实现 |
| `android/app/src/main/java/com/ringmemoryapp/rtnringmodule/RingPackage.kt` | RN Package |
| `android/app/build.gradle` | 已添加 SDK 依赖 |
| `android/app/src/main/AndroidManifest.xml` | 已添加蓝牙权限 |
| `android/app/src/main/java/com/ringmemoryapp/MainApplication.kt` | 已注册 RingPackage |

### 3.2 build.gradle 依赖

```groovy
dependencies {
    // ChipletRing SDK for smart ring integration
    implementation(files("libs/ChipletRing1.0.44.aar"))
}
```

### 3.3 AndroidManifest.xml 权限

```xml
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

### 3.4 MainApplication.kt 注册

```kotlin
import com.ringmemoryapp.rtnringmodule.RingPackage

override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
        context = applicationContext,
        packageList = PackageList(this).packages.apply {
            add(RingPackage())
        },
    )
}
```

### 3.5 编译验证

```bash
cd /Users/ivy/Desktop/program/RingMemoryApp/android
./gradlew assembleDebug
```

---

## 四、API 接口

### 4.1 设备扫描

```typescript
// 开始扫描
await RTNRingModule.startScan();

// 停止扫描
await RTNRingModule.stopScan();

// 监听设备发现事件
eventEmitter.addListener('onDeviceFound', (data) => {
    // data.devices: RingDevice[]
});
```

### 4.2 设备连接

```typescript
// 连接设备
await RTNRingModule.connectDevice(deviceId);

// 断开连接
await RTNRingModule.disconnectDevice();

// 获取连接状态
const status = await RTNRingModule.getDeviceStatus();
// status: 'disconnected' | 'scanning' | 'connecting' | 'connected'
```

### 4.3 音频录制

```typescript
// 开始录制（60秒分片）
await RTNRingModule.startCapture();

// 停止录制
await RTNRingModule.stopCapture();

// 监听音频分片
eventEmitter.addListener('onAudioSegmentReady', (segment) => {
    // segment.filePath: string   - WAV 文件路径
    // segment.duration: number    - 录音时长
    // segment.timestamp: number  - 时间戳
    // segment.size: number       - 文件大小
});
```

### 4.4 事件列表

| 事件名 | 说明 | payload |
|--------|------|---------|
| `onDeviceFound` | 发现新设备 | `{ devices: RingDevice[] }` |
| `onDeviceConnected` | 设备已连接 | `RingDevice` |
| `onDeviceDisconnected` | 设备已断开 | `{}` |
| `onBatteryChanged` | 电量变化 | `number` |
| `onAudioSegmentReady` | 音频分片就绪 | `AudioSegment` |
| `onError` | 错误 | `string` |

---

## 五、RingDevice 类型定义

```typescript
interface RingDevice {
    id: string;          // 设备 ID (MAC 地址)
    name: string;        // 设备名称
    rssi: number;        // 信号强度
    isConnected: boolean; // 是否已连接
    batteryLevel: number; // 电量 (0-100)
    macAddress: string;  // MAC 地址
}
```

---

## 六、useRingModule Hook

React 层使用示例：

```typescript
import { useRingModule } from './hooks/useRingModule';

function DevicesScreen() {
    const {
        isScanning,
        isConnected,
        isCapturing,
        devices,
        currentDevice,
        error,
        startScan,
        stopScan,
        connectDevice,
        disconnectDevice,
        startCapture,
        stopCapture,
    } = useRingModule();

    // ...
}
```

---

## 七、技术细节

### 7.1 iOS 音频处理

- SDK 返回 ADPCM 格式音频数据
- 使用 `BCLRingManager.convertAdpcmToPcm()` 转换为 PCM
- 添加 WAV 文件头（采样率 8kHz，单声道，16bit）
- 每 60 秒生成一个分片

### 7.2 Android 音频处理

- 使用 `AdPcmTool.adpcmToPcmFromJNI()` 转换
- 原始 PCM 数据保存到缓存目录
- 停止时合并所有分片并转换为 WAV

### 7.3 设备扫描

- iOS: 使用 `BCLRingManager.startScan()` 扫描 BLE 设备
- Android: 使用 `BLEUtils.startLeScan()` 扫描 BLE 设备
- 扫描结果通过事件发送给 JS 层

---

## 八、已知限制

1. **固件升级**：Firmware update 方法为 TODO，暂未实现
2. **电池电量**：iOS 端固定返回 100%，需单独 API 获取
3. **录音分片**：Android 端 60 秒分片逻辑需在实际设备测试调整

---

## 九、联系方式

- **技术支持**: BraveChip Technology (勇芯科技)
- **邮箱**: xiaojian.cui@bravechip.com
- **文档**: https://yongxin.gitbook.io/yongxin-docs/documentation

---

## 十、版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | 2026-03-24 | 初始集成版本 |
