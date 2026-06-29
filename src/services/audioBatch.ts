/**
 * 后端批量音频管线客户端 —— 包一层 manager-api 的 `/audio/batch` 接口。
 *
 * 用途：把已上传到 COS 的录音 URL 列表提交给后端，后端做服务端转写 + 场景总结 +
 * 生成问题，并按文件名解析录音时间（文件名格式 `YYYY-MM-DD HH-MM-SS.mp3`，与
 * 记忆粒落盘文件名一致）。本文件只做 HTTP，业务编排在 useMr20。
 *
 * 鉴权/信封：全部走 `baseRequest`（带登录态 Bearer，自动解 {code,msg,data}）。
 * userId 由后端从 token 推断（见 AudioBatchController.createBatch），无需前端传。
 */
import {baseRequest} from '../apis/core/request';

/** 提交项：url=COS objectUrl；fileName 决定后端解析的 recordedAt。 */
export interface AudioBatchInput {
  url: string;
  fileName: string;
  date?: string;
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

/** 批处理终态：completed / completed_with_error（再轮询无意义）。 */
export function isBatchTerminal(status: string | undefined): boolean {
  return status === 'completed' || status === 'completed_with_error';
}

/** 创建批量任务：POST /audio/batch。 */
export async function createAudioBatch(
  audios: AudioBatchInput[],
): Promise<BatchGroupResult> {
  return baseRequest<BatchGroupResult>({
    method: 'POST',
    path: '/audio/batch',
    body: {audios},
  });
}

/** 查询进度：GET /audio/batch/{groupId}。 */
export async function getBatchProgress(
  groupId: string,
): Promise<BatchProgressResult> {
  return baseRequest<BatchProgressResult>({
    method: 'GET',
    path: `/audio/batch/${encodeURIComponent(groupId)}`,
  });
}

/** 查询结果（转写 + 总结 + 问题）：GET /audio/batch/{groupId}/result。 */
export async function getBatchResult(
  groupId: string,
): Promise<BatchResultResponse> {
  return baseRequest<BatchResultResponse>({
    method: 'GET',
    path: `/audio/batch/${encodeURIComponent(groupId)}/result`,
  });
}

/** 重试该批次中失败的文件：POST /audio/batch/{groupId}/retry。 */
export async function retryBatch(groupId: string): Promise<BatchRetryResult> {
  return baseRequest<BatchRetryResult>({
    method: 'POST',
    path: `/audio/batch/${encodeURIComponent(groupId)}/retry`,
  });
}
