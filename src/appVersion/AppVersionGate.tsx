import React, {useEffect, useState, type ReactNode} from 'react';
import {Platform} from 'react-native';

import {checkAppVersion, type AppVersionCheckResult} from '../apis/requests/appVersion';
import {APP_VERSION_CODE} from '../config/appVersion';
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

    checkAppVersion(platform, APP_VERSION_CODE)
      .then(async res => {
        if (cancelled) {
          return;
        }
        setResult(res);
        if (!res.forceUpdate && res.updateAvailable && res.latestVersionCode != null) {
          const dismissed = await getDismissedUpdateVersion();
          if (!cancelled && dismissed !== res.latestVersionCode) {
            setSoftPromptVisible(true);
          }
        }
      })
      .catch(() => {
        // 版本检查失败不影响正常启动
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
