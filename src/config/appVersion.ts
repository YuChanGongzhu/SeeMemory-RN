import {Platform} from 'react-native';

// 手动维护的过渡方案：react-native-device-info 已加进 package.json 但还没跑 pod install /
// 原生重编译，暂时不能在 JS 里直接读原生 CURRENT_PROJECT_VERSION / versionCode。
// 每次发版记得同步这里的数字，跟 ios/RingMemoryApp.xcodeproj CURRENT_PROJECT_VERSION、
// android/app/build.gradle versionCode 保持一致；接入 DeviceInfo 后这个常量可以删掉，
// 改用 DeviceInfo.getBuildNumber() 直接读原生值。
export const APP_VERSION_CODE: number = Platform.select({ios: 4, android: 1, default: 0}) ?? 0;
