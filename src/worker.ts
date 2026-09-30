import {
  rangeModes,
  type BimodalResult,
  type ModeResult,
} from './lib/mode';

/**
 * Worker 请求：values 为可转移的 Int32Array，queries 为纯对象数组。
 *
 * snapshotId 标识本轮查询快照：Worker 把它原样回传，主线程据此丢弃上一批
 * （或上一轮开关状态）计算的迟到回应，避免新一轮短暂展示上一批的第二名。
 * bimodal 为 true 时同一次莫队计算额外产出第二名（双峰复核）。
 */
export interface WorkerRequest {
  snapshotId: number;
  values: Int32Array;
  queries: { left: number; right: number }[];
  bimodal: boolean;
}

export interface WorkerResponse {
  snapshotId: number;
  answers: ModeResult[] | BimodalResult[];
  elapsedMs: number;
  bimodal: boolean;
}

// 模块同时被浏览器 Worker 与打包器引用，这里显式声明 Worker 全局上下文，
// 避免同时引入 DOM 与 WebWorker 类型库造成的全局冲突。
interface WorkerGlobalScope {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
}
const ctx = globalThis as unknown as WorkerGlobalScope;

ctx.onmessage = (ev) => {
  const { snapshotId, values, queries, bimodal } = ev.data;
  const started =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  // 双峰与否都由同一次指针移动维护出的频次表回答，第一名与旧众数逐项一致。
  const answers = bimodal
    ? rangeModes(values, queries, { bimodal: true })
    : rangeModes(values, queries);
  const elapsedMs =
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
    started;
  ctx.postMessage({ snapshotId, answers, elapsedMs, bimodal });
};
