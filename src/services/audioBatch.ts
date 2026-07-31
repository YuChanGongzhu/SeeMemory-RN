/**
 * 后端批量音频管线客户端 —— 包一层 manager-api 的 `/app/audio/batch` 接口。
 *
 * 用途：把已上传到 COS 的录音 URL 列表提交给后端，后端做服务端转写 + 场景总结 +
 * 生成问题。录音时间由前端显式回传 `date`（`yyyy-MM-dd HH:mm:ss`），后端不再按文件名
 * 解析。本文件只做 HTTP，业务编排在 useMr20。
 *
 * 鉴权/信封：全部走 `baseRequest`（带登录态 Bearer，自动解 {code,msg,data}）。
 * userId 由后端从 token 推断（见 AudioBatchController.createBatch），无需前端传。
 */
import {baseRequest} from '../apis/core/request';
import {assertAiConsentGranted} from '../privacy/consentRuntime';

/**
 * 提交项：
 * - url：COS objectUrl
 * - date：录制时刻（必填，event time），格式 `yyyy-MM-dd HH:mm:ss`；后端按此解析录音时间
 * - fileName：仅作展示与结果回填匹配（后端不再据此解析时间）
 */
export interface AudioBatchInput {
  url: string;
  date: string;
  fileName: string;
  /** 音频时长（毫秒，设备端已知）。后端优先采用，缺省时回退 ASR 时长。 */
  durationMs?: number;
  /** 已有转写（可选）：重新聚合已转写录音时带上，后端直接复用、跳过下载+ASR，不耗转写额度。 */
  transcription?: string;
}

export interface BatchGroupResult {
  /** 客户端稳定追踪 ID。新版 manager-api 多组时返回聚合父 ID。 */
  groupId: string;
  /** 内部处理组；旧 manager-api 多组时需要逐组轮询，新版可直接轮询 groupId。 */
  groupIds?: string[];
  totalGroups?: number;
  status: string;
  totalFiles: number;
  message?: string;
}

export interface BatchProgressResult {
  groupId: string;
  status: string; // pending | processing | completed | completed_with_error ...
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  progress: number; // 0-100
}

/** 单文件结果（字段对照 data/result 样本）。 */
export interface AudioFileResult {
  fileIndex: number;
  audioUrl: string;
  status: string; // completed | failed
  transcription?: string;
  hasUserVoice?: boolean;
  fileName: string;
  sizeBytes?: string;
  sizeKb?: string;
  durationMs?: number;
  recordedAt?: string;
  recordedTime?: string;
  errorMessage?: string | null;
  processingTimeMs?: string;
}

export interface BatchResultResponse {
  groupId: string;
  status: string;
  totalFiles: number;
  completedFiles: number;
  summary?: string;
  questions?: string[];
  results: AudioFileResult[];
}

export interface BatchRetryResult {
  groupId: string;
  retried: number;
}

/** 任务列表分页结果（items 复用进度结构）。 */
export interface BatchListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: BatchProgressResult[];
}

/** 单条预签名结果：presignedUrl 用于 PUT 上传，objectUrl 落库。 */
export interface PresignedUrlItem {
  presignedUrl: string;
  objectUrl: string;
}

/**
 * 批量预签名请求（二选一）：
 * - 简单模式：统一扩展名 + 数量
 * - 高级模式：逐个指定扩展名/文件名（优先于简单模式）
 */
export type BatchPresignRequest =
  | {fileExtension: string; count: number}
  | {files: Array<{fileExtension: string; fileName?: string}>};

/** 批处理终态（再轮询无意义）。 */
export function isBatchTerminal(status: string | undefined): boolean {
  return status === 'completed' || status === 'completed_with_error' || status === 'failed';
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

/**
 * 决定 App 实际轮询哪些 ID：
 * - 新 manager-api：groupId 是不在 groupIds 中的聚合父 ID，只轮询父 ID，避免每 2.5 秒扇出请求；
 * - 旧拆组 manager-api：groupId 就是第一子组，必须遍历 groupIds，避免只看到第一组；
 * - 更旧的单组响应没有 groupIds，继续只轮询 groupId。
 */
export function resolveBatchPollingGroupIds(
  group: Pick<BatchGroupResult, 'groupId' | 'groupIds'>,
): string[] {
  const canonicalGroupId = group.groupId?.trim();
  const childGroupIds = uniqueStrings(group.groupIds || []);
  if (canonicalGroupId && childGroupIds.length > 1 && childGroupIds.includes(canonicalGroupId)) {
    return childGroupIds;
  }
  return canonicalGroupId ? [canonicalGroupId] : childGroupIds;
}

/** 把多个旧版子组进度合并成一个 UI 批次。 */
export function mergeBatchProgress(
  groupId: string,
  groups: BatchProgressResult[],
): BatchProgressResult {
  const totalFiles = groups.reduce((sum, item) => sum + item.totalFiles, 0);
  const completedFiles = groups.reduce((sum, item) => sum + item.completedFiles, 0);
  const failedFiles = groups.reduce((sum, item) => sum + item.failedFiles, 0);
  const allTerminal = groups.length > 0 && groups.every(item => isBatchTerminal(item.status));
  const hasError = groups.some(
    item =>
      item.status === 'completed_with_error' ||
      item.status === 'failed' ||
      item.failedFiles > 0,
  );
  const allPending = groups.length === 0 || groups.every(item => item.status === 'pending');
  let status = 'processing';
  if (allTerminal) {
    status = hasError ? 'completed_with_error' : 'completed';
  } else if (allPending) {
    status = 'pending';
  }

  return {
    groupId,
    status,
    totalFiles,
    completedFiles,
    failedFiles,
    progress: totalFiles > 0
      ? Math.min(100, Math.floor(((completedFiles + failedFiles) * 100) / totalFiles))
      : 0,
  };
}

/** 合并旧版多子组结果；新版聚合父组传入单元素数组时行为不变。 */
export function mergeBatchResults(
  groupId: string,
  groups: BatchResultResponse[],
): BatchResultResponse {
  const progress = mergeBatchProgress(
    groupId,
    groups.map(group => ({
      groupId: group.groupId,
      status: group.status,
      totalFiles: group.totalFiles,
      completedFiles: group.completedFiles,
      failedFiles: (group.results || []).filter(item => item.status === 'failed').length,
      progress: 0,
    })),
  );
  const summaries = groups
    .map(group => group.summary?.trim())
    .filter(Boolean) as string[];
  const questions = uniqueStrings(groups.flatMap(group => group.questions || []));
  const results = groups.flatMap(group => group.results || []);

  return {
    groupId,
    status: progress.status,
    totalFiles: progress.totalFiles,
    completedFiles: progress.completedFiles,
    summary: summaries.length ? summaries.join('\n\n') : undefined,
    questions,
    results: results.map((item, index) => ({...item, fileIndex: index + 1})),
  };
}

/** 创建批量任务：POST /app/audio/batch。 */
export async function createAudioBatch(
  audios: AudioBatchInput[],
): Promise<BatchGroupResult> {
  assertAiConsentGranted();
  return baseRequest<BatchGroupResult>({
    method: 'POST',
    path: '/app/audio/batch',
    body: {audios},
  });
}

/** 查询进度：GET /app/audio/batch/{groupId}。 */
export async function getBatchProgress(
  groupId: string,
): Promise<BatchProgressResult> {
  return baseRequest<BatchProgressResult>({
    method: 'GET',
    path: `/app/audio/batch/${encodeURIComponent(groupId)}`,
  });
}

/** 查询结果（转写 + 总结 + 问题）：GET /app/audio/batch/{groupId}/result。 */
export async function getBatchResult(
  groupId: string,
): Promise<BatchResultResponse> {
  return baseRequest<BatchResultResponse>({
    method: 'GET',
    path: `/app/audio/batch/${encodeURIComponent(groupId)}/result`,
  });
}

/** 重试该批次中失败的文件：POST /app/audio/batch/{groupId}/retry。 */
export async function retryBatch(groupId: string): Promise<BatchRetryResult> {
  assertAiConsentGranted();
  return baseRequest<BatchRetryResult>({
    method: 'POST',
    path: `/app/audio/batch/${encodeURIComponent(groupId)}/retry`,
  });
}

/** 查询当前登录用户的批量任务列表：GET /app/audio/batch/list。 */
export async function listAudioBatches(
  page = 1,
  pageSize = 10,
): Promise<BatchListResponse> {
  return baseRequest<BatchListResponse>({
    method: 'GET',
    path: '/app/audio/batch/list',
    query: {page, pageSize},
  });
}

/** 批量生成 COS 上传预签名：POST /app/audio/getPresignedUrl/batch。 */
export async function getBatchPresignedUrls(
  request: BatchPresignRequest,
): Promise<PresignedUrlItem[]> {
  assertAiConsentGranted();
  return baseRequest<PresignedUrlItem[]>({
    method: 'POST',
    path: '/app/audio/getPresignedUrl/batch',
    body: request,
  });
}
