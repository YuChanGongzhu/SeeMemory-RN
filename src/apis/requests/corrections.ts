import {baseRequest, BizError} from '../core/request';
import {assertAiConsentGranted} from '../../privacy/consentRuntime';

/**
 * 记忆修正命令（corrections v2）—— 走 manager-api /app/memory/corrections（auth_token）。
 *
 * 语义：提交的是**自然语言指令**而非改后的文本。后端同步把指令蒸馏成原子操作并过门，
 * 受理后异步执行全链路派生重建（摘要 / 关联 / 汇总），所以提交完要轮询 GET 看进度。
 * 编辑、追加、删除三个入口共用这一个接口，区别只在指令措辞蒸馏出的 intent：
 *   fact_correction（wrong_text 有值=改错，为空=补充） / presentation_override / forget
 *
 * user_id 一律不传：/app 面身份取登录态，传了也被后端覆盖。
 */

export type CorrectionAnchorType =
  | 'fragment'
  | 'memory_summary'
  | 'graph_entity'
  | 'graph_relationship';

export type CorrectionStatus = 'accepted' | 'running' | 'completed' | 'failed';

/** 蒸馏出的单个原子操作。 */
export interface CorrectionOperation {
  intent: string; // fact_correction | presentation_override | forget
  wrong_text: string;
  corrected_text: string;
  confidence: number;
}

/** 提交 / 查询状态 / 重试三个接口共用的返回视图。 */
export interface MemoryCorrection {
  correction_id: string;
  anchor_type: string;
  anchor_id: string;
  instruction: string;
  request_id: string;
  operations: CorrectionOperation[];
  status: CorrectionStatus;
  /** persist | short | invalidate | reorganize | aggregates | done */
  stage: string;
  last_error: string;
  created_at: string;
  updated_at: string;
  message?: string;
}

export interface SubmitCorrectionParams {
  anchorType: CorrectionAnchorType;
  anchorId: string;
  /** 自然语言指令，1-500 字符，可含多个意图 */
  instruction: string;
  /**
   * 每用户唯一的幂等键，1-128 字符。**每次提交都要新生成**，见 newCorrectionRequestId。
   *
   * 后端规则：同 request_id 且 anchor_type+anchor_id+instruction 三者全同才当重放返回原命令，
   * 任一不同直接 409「request_id 已被其他请求使用」。所以改了指令重提必须换新 key，
   * 复用只会撞 409。真正的「重试」走 retryMemoryCorrection（按 correction_id，不带 body）。
   */
  requestId: string;
}

export const INSTRUCTION_MAX_LEN = 500;

/** 幂等键：每次提交调一次。防的是同一次提交的连点重发，不是跨提交复用。 */
export function newCorrectionRequestId(anchorId: string): string {
  const salt = Math.random().toString(36).slice(2, 8);
  return `corr_${anchorId}_${Date.now()}_${salt}`.slice(0, 128);
}

/**
 * 后端错误 → 用户能看懂的话。
 *
 * 这些串来自 memory 服务 edit/corrections.py，透给用户会漏「摘要」「锚点」「段」这类内部词，
 * 且不告诉人下一步该做什么。只映射语义明确的几条；**蒸馏过门失败的 400 不在此列**——
 * 它的 msg 里带着逐条拒绝原因（op_errors），原样给用户远比套话有用。
 */
const ERROR_MESSAGE_MAP: {match: string; text: string}[] = [
  // memory 服务 MEMORY_CORRECTION_V2_ENABLED=false（默认就是 false）时的 403
  {match: '记忆修正命令功能未开放', text: '记忆修正功能暂未开放'},
  {match: '尚未生成摘要', text: '这条记忆还在整理中，过几分钟再来修改吧'},
  {match: '目标记忆不存在', text: '这条记忆已不存在，请刷新列表'},
  {match: '已并入其他记忆', text: '这条记忆已并入其他记忆，请刷新后在合并后的记忆上操作'},
  {match: '刚被合并整理', text: '这条记忆刚被整理过，请刷新后重试'},
  {match: 'request_id 已被其他请求使用', text: '提交冲突了，请重新提交一次'},
  {match: '记忆整理进行中', text: '系统正在整理记忆，请稍后再试'},
];

function mapErrorMessage(raw: string): string | null {
  const hit = ERROR_MESSAGE_MAP.find(e => raw.includes(e.match));
  return hit ? hit.text : null;
}

function extractErrorMessage(error: unknown, fallback: string): string {
  const raw =
    error instanceof BizError
      ? error.message
      : error instanceof Error && error.message.trim()
        ? error.message
        : '';
  if (!raw) return fallback;
  return mapErrorMessage(raw) ?? raw;
}

async function withErrorMessage<T>(promise: Promise<T>, fallback: string): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    throw new Error(extractErrorMessage(error, fallback));
  }
}

// POST /app/memory/corrections — 提交修正命令（user_id 由后端注入不传）。
// 同步段要跑一次 LLM 蒸馏，超时给足 60s（对齐 summaries.createMemorySummary）。
// 注意：受理成功返回的是 status='accepted'，不是 HTTP 202——Python 的 202 在 Java 层被降级成 200。
export function submitMemoryCorrection(params: SubmitCorrectionParams): Promise<MemoryCorrection> {
  assertAiConsentGranted();
  return withErrorMessage(
    baseRequest<MemoryCorrection>({
      method: 'POST',
      path: '/app/memory/corrections',
      body: {
        anchor_type: params.anchorType,
        anchor_id: params.anchorId,
        instruction: params.instruction,
        request_id: params.requestId,
      },
      timeout: 60000,
    }),
    '提交修正失败',
  );
}

// GET /app/memory/corrections/{correctionId} — 轮询「修正中」进度。
export function getMemoryCorrection(correctionId: string): Promise<MemoryCorrection> {
  return withErrorMessage(
    baseRequest<MemoryCorrection>({
      method: 'GET',
      path: `/app/memory/corrections/${encodeURIComponent(correctionId)}`,
    }),
    '获取修正状态失败',
  );
}

// POST /app/memory/corrections/{correctionId}/retry — 重试终态 failed 的命令（无请求体）。
export function retryMemoryCorrection(correctionId: string): Promise<MemoryCorrection> {
  assertAiConsentGranted();
  return withErrorMessage(
    baseRequest<MemoryCorrection>({
      method: 'POST',
      path: `/app/memory/corrections/${encodeURIComponent(correctionId)}/retry`,
      timeout: 60000,
    }),
    '重试失败',
  );
}

/** 轮询进度文案：stage → 用户能看懂的一句话。 */
export function correctionStageLabel(stage: string): string {
  switch (stage) {
    case 'persist':
      return '已记录你的修正';
    case 'short':
      return '正在重写摘要…';
    case 'invalidate':
    case 'reorganize':
      return '正在重建关联…';
    case 'aggregates':
      return '正在更新汇总…';
    case 'done':
      return '修正完成';
    default:
      return '正在处理…';
  }
}
