import {baseRequest} from '../core/request';

export interface AppVersionCheckResult {
  updateAvailable: boolean;
  forceUpdate: boolean;
  latestVersionCode: number | null;
  latestVersionName: string | null;
  updateUrl: string | null;
  releaseNotes: string | null;
}

export function checkAppVersion(platform: 'ios' | 'android', versionCode: number) {
  return baseRequest<AppVersionCheckResult>({
    method: 'GET',
    path: '/app/version/check',
    query: {platform, versionCode},
  });
}
