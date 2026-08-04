import React from 'react';
import {Linking} from 'react-native';
import {IosAlert} from '../screens/hardware/parts';

/**
 * 建议更新的可关闭提示，复用现成的 IosAlert（背景点按/关闭均可退出）。
 */
export function SoftUpdatePrompt({
  visible,
  latestVersionName,
  releaseNotes,
  updateUrl,
  onDismiss,
}: {
  visible: boolean;
  latestVersionName: string | null;
  releaseNotes: string | null;
  updateUrl: string | null;
  onDismiss: () => void;
}) {
  return (
    <IosAlert
      visible={visible}
      onClose={onDismiss}
      title={latestVersionName ? `新版本 ${latestVersionName} 可用` : '有新版本可用'}
      message={releaseNotes || '建议更新到最新版本，体验更好的功能与稳定性'}
      buttons={[
        {text: '以后再说', onPress: onDismiss},
        {
          text: '立即更新',
          bold: true,
          onPress: () => {
            onDismiss();
            if (updateUrl) {
              Linking.openURL(updateUrl);
            }
          },
        },
      ]}
    />
  );
}
