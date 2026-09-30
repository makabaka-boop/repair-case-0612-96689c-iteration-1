import { rangeModes, type ModeResult } from './lib/mode';

/** Worker 请求：values 为可转移的 Int32Array，queries 为纯对象数组。 */
export interface WorkerRequest {
  values: Int32Array;
  queries: { left: number; right: number }[];
}

export interface WorkerResponse {
  answers: ModeResult[];
  elapsedMs: number;
}

// 模块同时被浏览器 Worker 与打包器引用，这里显式声明 Worker 全局上下文，
// 避免同时引入 DOM 与 WebWorker 类型库造成的全局冲突。
interface WorkerGlobalScope {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
}
const ctx = globalThis as unknown as WorkerGlobalScope;

ctx.onmessage = (ev) => {
  const { values, queries } = ev.data;
  const started =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const answers = rangeModes(values, queries);
  const elapsedMs =
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
    started;
  ctx.postMessage({ answers, elapsedMs });
};
