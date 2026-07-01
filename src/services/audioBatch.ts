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
}

export interface BatchGroupResult {
  groupId: string;
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

/** 批处理终态：completed / completed_with_error（再轮询无意义）。 */
export function isBatchTerminal(status: string | undefined): boolean {
  return status === 'completed' || status === 'completed_with_error';
}

/** 创建批量任务：POST /app/audio/batch。 */
export async function createAudioBatch(
  audios: AudioBatchInput[],
): Promise<BatchGroupResult> {
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
  return baseRequest<PresignedUrlItem[]>({
    method: 'POST',
    path: '/app/audio/getPresignedUrl/batch',
    body: request,
  });
}
