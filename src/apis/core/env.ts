/**
 * 后端环境注册表（正式 prod / 测试 test）。
 *
 * 纯内存 + 无 AsyncStorage 依赖，供 request 等在**调用时**取当前主机，避免模块加载
 * 期把 URL 定死。持久化在 services/storage.ts；启动时由 AuthContext hydrate 读出并
 * setApiEnvInMemory。切换环境见 ui/EnvSwitchSheet.tsx（切换会强制重新登录，因 token 环境相关）。
 */
export type ApiEnv = 'prod' | 'test';

// upload 与 api 同主机（真正的上传/预签名走 baseRequest → ms.seemem.com/api/common/getPresignedUrl）。
const CONFIG: Record<ApiEnv, {api: string}> = {
  prod: {api: 'https://ms.seemem.com/api'},
  test: {api: 'https://test.ms.seemem.com/api'},
};

// 默认正式；启动 hydrate 后由持久化值覆盖。
let currentEnv: ApiEnv = 'prod';

export function getApiEnv(): ApiEnv {
  return currentEnv;
}

export function setApiEnvInMemory(env: ApiEnv): void {
  currentEnv = env;
}

/** manager-api 云端主机（登录/记忆/总结/mood/chat/音频）。 */
export function getBaseApiUrl(): string {
  return CONFIG[currentEnv].api;
}

/** 当前环境的展示信息（切换面板用）。 */
export const ENV_META: Record<ApiEnv, {label: string; host: string}> = {
  prod: {label: '正式环境', host: 'ms.seemem.com'},
  test: {label: '测试环境', host: 'test.ms.seemem.com'},
};
