import { useMemo, useRef, useState } from 'react';
import { parseInput, type InputError } from './lib/parseInput';
import type { BimodalResult, ModeResult } from './lib/mode';
import type { WorkerResponse } from './worker';
import { VirtualTable } from './VirtualTable';

interface RunSummary {
  n: number;
  q: number;
  elapsedMs: number;
}

/**
 * 一次计算的完整查询快照：Worker 协议、结果类型、虚拟列表与导出共用同一份。
 * 快照整体替换，界面不可能把上一批的第二名与新一批的第一名拼在一起展示。
 */
interface ResultSnapshotBase {
  summary: RunSummary;
  queries: { left: number; right: number }[];
}
interface ModeSnapshot extends ResultSnapshotBase {
  bimodal: false;
  answers: ModeResult[];
}
interface BimodalSnapshot extends ResultSnapshotBase {
  bimodal: true;
  answers: BimodalResult[];
}
type ResultSnapshot = ModeSnapshot | BimodalSnapshot;

const EXAMPLE = `{
  "values": [-1, 2, -1, 2, 0, 0, -1],
  "queries": [
    { "left": 0, "right": 6 },
    { "left": 1, "right": 3 },
    { "left": 4, "right": 5 }
  ]
}`;

export default function App() {
  const [text, setText] = useState('');
  const [error, setError] = useState<InputError | null>(null);
  const [snapshot, setSnapshot] = useState<ResultSnapshot | null>(null);
  const [running, setRunning] = useState(false);
  // 双峰复核开关只在点击"解析并巡检"时随请求发出；已展示的结果属于其计算时的快照。
  const [bimodalEnabled, setBimodalEnabled] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const workerRef = useRef<Worker | null>(null);
  // 每发起一轮计算 +1；Worker 原样回传，迟到的上一批回应直接丢弃。
  const snapshotSeq = useRef(0);

  const lastRow = useMemo(() => {
    if (!snapshot || snapshot.answers.length === 0) return null;
    const i = snapshot.answers.length - 1;
    const answer = snapshot.answers[i];
    const first = snapshot.bimodal
      ? (answer as BimodalResult).first
      : (answer as ModeResult);
    const second = snapshot.bimodal ? (answer as BimodalResult).second : null;
    return {
      index: i + 1,
      query: snapshot.queries[i],
      first,
      second,
      bimodal: snapshot.bimodal,
    };
  }, [snapshot]);

  function locateError(err: InputError) {
    setError(err);
    const ta = textareaRef.current;
    if (ta && err.offset >= 0) {
      ta.focus();
      try {
        ta.setSelectionRange(err.offset, err.offset + 1);
      } catch {
        /* 部分浏览器对越界偏移抛错，忽略 */
      }
    }
  }

  async function handleRun() {
    // 每次重新计算先清空旧结果（含上一批的第二名），失败时也绝不会残留或
    // 输出部分答案；新一轮结果到达前界面不持有任何上一批数据。
    setSnapshot(null);
    setError(null);

    const parsed = parseInput(text);
    if ('message' in parsed) {
      locateError(parsed);
      return;
    }

    setRunning(true);

    // values 的 ArrayBuffer 会随 postMessage 转移给 Worker，主线程侧的
    // Int32Array 随即被 neuter（length 变为 0）；规模必须在转移之前记下，
    // 否则状态栏会把读数数量错误显示为 0。
    const valueCount = parsed.values.length;
    const queryCount = parsed.queries.length;
    const parsedQueries = parsed.queries;
    const bimodal = bimodalEnabled;
    const snapshotId = ++snapshotSeq.current;

    const worker =
      workerRef.current ??
      new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      // 换批隔离：仅接受本轮快照的回应。复用同一 Worker 时，上一轮若仍有
      // 迟到回应，其 snapshotId 已过期，绝不短暂展示上一批的第二名。
      if (ev.data.snapshotId !== snapshotId) return;
      // 按查询原顺序返回（Worker 内部已还原顺序），answers/queries/开关
      // 在同一次 setState 中原子落地为一个查询快照。
      const summary: RunSummary = {
        n: valueCount,
        q: queryCount,
        elapsedMs: ev.data.elapsedMs,
      };
      setSnapshot(
        bimodal
          ? { bimodal: true, answers: ev.data.answers as BimodalResult[], queries: parsedQueries, summary }
          : { bimodal: false, answers: ev.data.answers as ModeResult[], queries: parsedQueries, summary },
      );
      setRunning(false);
    };
    worker.onerror = (e) => {
      setRunning(false);
      locateError({ message: `计算失败：${e.message}`, offset: -1, path: '$' });
    };
    worker.onmessageerror = () => {
      setRunning(false);
      locateError({ message: '计算失败：Worker 消息反序列化错误', offset: -1, path: '$' });
    };
    worker.postMessage(
      { snapshotId, values: parsed.values, queries: parsed.queries, bimodal },
      [parsed.values.buffer],
    );
  }

  function handlePasteExample() {
    setText(EXAMPLE);
    setError(null);
  }

  function scrollToLast() {
    const el = document.querySelector('.table-scroll');
    if (el) el.scrollTop = el.scrollHeight;
  }

  /** 导出当前快照（Worker 回应的同一份结果）为 JSON；不重新计算、不混入其他批次。 */
  function handleExport() {
    if (!snapshot) return;
    const payload = {
      bimodal: snapshot.bimodal,
      queries: snapshot.queries,
      answers: snapshot.answers,
    };
    const blob = new Blob([JSON.stringify(payload)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `axle-review-${snapshot.bimodal ? 'bimodal' : 'mode'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>夜间列车轴温 · 区间众数巡检</h1>
        <p className="subtitle">
          粘贴普通 JSON：values 为 1～200000 个有符号 32 位整数，queries 为 1～200000 个
          {' '}<code>left</code>/<code>right</code> 闭区间。返回按原顺序排列的众数（并列取较小值）与频次。
        </p>
      </header>

      <section className="panel">
        <div className="panel-toolbar">
          <button type="button" className="btn primary" onClick={handleRun} disabled={running} data-testid="run-button">
            {running ? '巡检计算中…' : '解析并巡检'}
          </button>
          <button type="button" className="btn" onClick={handlePasteExample} disabled={running} data-testid="example-button">
            填入示例
          </button>
          <label className={`toggle${running ? ' disabled' : ''}`} data-testid="bimodal-toggle">
            <input
              type="checkbox"
              checked={bimodalEnabled}
              disabled={running}
              onChange={(e) => setBimodalEnabled(e.target.checked)}
            />
            <span>双峰复核：按频次降序、读数升序返回前两名不同读数（仅一种读数时次席为空）</span>
          </label>
          {error && (
            <span className="error-summary" data-testid="error-summary">
              ✗ {error.path}（偏移 {error.offset}）
            </span>
          )}
        </div>
        <textarea
          ref={textareaRef}
          className="json-input"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{"values": [1, 2, 2, -3], "queries": [{"left": 0, "right": 3}]}'
          data-testid="json-input"
        />
        {error && (
          <div className="error-box" role="alert" data-testid="error-box">
            <div className="error-line">
              <strong>首个错误：</strong>
              {error.message}
            </div>
            <div className="error-meta">
              定位路径：<code>{error.path}</code>　字符偏移：<code>{error.offset}</code>
            </div>
          </div>
        )}
      </section>

      {snapshot && (
        <section className="panel status-panel" data-testid="status-panel">
          <span>
            读数 <strong>{snapshot.summary.n}</strong> 条 · 查询 <strong>{snapshot.summary.q}</strong> 个 ·
            算法耗时 <strong>{snapshot.summary.elapsedMs.toFixed(1)}</strong> ms
            {snapshot.bimodal && <span className="badge">双峰复核</span>}
          </span>
          {lastRow && (
            <span className="status-actions">
              <span className="last-row" data-testid="last-row">
                末行（第 {lastRow.index} 个）：[{lastRow.query.left}, {lastRow.query.right}] →
                众数 <strong>{lastRow.first.value}</strong>，
                频次 <strong>{lastRow.first.count}</strong>
                {lastRow.bimodal &&
                  (lastRow.second === null ? (
                    <span className="second-empty" data-testid="last-second" data-empty="true">
                      ；次席为空（窗口仅一种读数）
                    </span>
                  ) : (
                    <span data-testid="last-second" data-empty="false">
                      ；次席 <strong>{lastRow.second.value}</strong>，
                      频次 <strong>{lastRow.second.count}</strong>
                    </span>
                  ))}
                <button type="button" className="btn small" onClick={scrollToLast}>
                  滚动到末行
                </button>
              </span>
              {snapshot.bimodal && (
                <button
                  type="button"
                  className="btn small export-btn"
                  onClick={handleExport}
                  data-testid="export-button"
                >
                  导出复核结果（JSON）
                </button>
              )}
            </span>
          )}
        </section>
      )}

      {snapshot && (
        <section className="panel table-panel" data-testid="result-panel">
          <VirtualTable
            answers={snapshot.answers}
            queries={snapshot.queries}
            bimodal={snapshot.bimodal}
          />
        </section>
      )}
    </div>
  );
}
