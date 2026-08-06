import {getBuildNumber} from 'react-native-device-info';

// 原生构建号：iOS 对应 CURRENT_PROJECT_VERSION，Android 对应 versionCode，随发版自动变化。
// 读取失败（原生模块未链接等极端情况）返回 null，调用方应跳过本次版本检查，不能当 0 用——
// 0 会被强更阈值判定为"最旧版本"，误伤所有用户。
export function getAppVersionCode(): number | null {
  try {
    const parsed = parseInt(getBuildNumber(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
