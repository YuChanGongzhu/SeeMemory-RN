import React, {useEffect, useState, type ReactNode} from 'react';
import {Platform} from 'react-native';

import {checkAppVersion, type AppVersionCheckResult} from '../apis/requests/appVersion';
import {getAppVersionCode} from '../config/appVersion';
import {getDismissedUpdateVersion, saveDismissedUpdateVersion} from '../services/storage';
import {ForceUpdateScreen} from './ForceUpdateScreen';
import {SoftUpdatePrompt} from './SoftUpdatePrompt';

/**
 * App 启动版本检查:非阻塞发起,网络失败静默忽略,绝不影响正常启动。
 * 强更时整棵子树替换为全屏拦截;建议更新仅弹一次可关闭提示(按 latestVersionCode 记忆)。
 */
export function AppVersionGate({children}: {children: ReactNode}) {
  const [result, setResult] = useState<AppVersionCheckResult | null>(null);
  const [softPromptVisible, setSoftPromptVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    const versionCode = getAppVersionCode();
    console.log(`[AppVersionGate] 本机版本 platform=${platform} versionCode=${versionCode}`);
    if (versionCode == null) {
      // 读不到真实版本码：不能当 0 用（会被误判成最旧版本触发强更），直接跳过本次检查
      console.log('[AppVersionGate] versionCode 为 null，跳过本次检查');
      return;
    }

    checkAppVersion(platform, versionCode)
      .then(async res => {
        console.log('[AppVersionGate] 线上策略返回', JSON.stringify(res));
        if (cancelled) {
          return;
        }
        setResult(res);
        if (!res.forceUpdate && res.updateAvailable && res.latestVersionCode != null) {
          const dismissed = await getDismissedUpdateVersion();
          console.log(`[AppVersionGate] 已忽略过的版本号=${dismissed}`);
          if (!cancelled && dismissed !== res.latestVersionCode) {
            setSoftPromptVisible(true);
          }
        }
      })
      .catch(err => {
        // 版本检查失败不影响正常启动，但打个日志方便排查
        console.log('[AppVersionGate] 版本检查请求失败', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (result?.forceUpdate) {
    return (
      <ForceUpdateScreen
        latestVersionName={result.latestVersionName}
        releaseNotes={result.releaseNotes}
        updateUrl={result.updateUrl}
      />
    );
  }

  return (
    <>
      {children}
      {result ? (
        <SoftUpdatePrompt
          visible={softPromptVisible}
          latestVersionName={result.latestVersionName}
          releaseNotes={result.releaseNotes}
          updateUrl={result.updateUrl}
          onDismiss={() => {
            setSoftPromptVisible(false);
            if (result.latestVersionCode != null) {
              saveDismissedUpdateVersion(result.latestVersionCode);
            }
          }}
        />
      ) : null}
    </>
  );
}
