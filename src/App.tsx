import { useMemo, useRef, useState } from 'react';
import { parseInput, type InputError } from './lib/parseInput';
import type { ModeResult } from './lib/mode';
import { VirtualTable } from './VirtualTable';

interface RunSummary {
  n: number;
  q: number;
  elapsedMs: number;
}

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
  const [answers, setAnswers] = useState<ModeResult[] | null>(null);
  const [queries, setQueries] = useState<{ left: number; right: number }[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const workerRef = useRef<Worker | null>(null);

  const lastRow = useMemo(() => {
    if (!answers || answers.length === 0) return null;
    const i = answers.length - 1;
    return { index: i + 1, query: queries[i], answer: answers[i] };
  }, [answers, queries]);

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
    // 每次重新计算先清空旧结果，失败时也绝不会残留或输出部分答案。
    setAnswers(null);
    setQueries([]);
    setSummary(null);
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

    const worker =
      workerRef.current ??
      new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent<{ answers: ModeResult[]; elapsedMs: number }>) => {
      // 按查询原顺序返回（Worker 内部已还原顺序）。
      setAnswers(ev.data.answers);
      setQueries(parsedQueries);
      setSummary({
        n: valueCount,
        q: queryCount,
        elapsedMs: ev.data.elapsedMs,
      });
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
    worker.postMessage({ values: parsed.values, queries: parsed.queries }, [parsed.values.buffer]);
  }

  function handlePasteExample() {
    setText(EXAMPLE);
    setError(null);
  }

  function scrollToLast() {
    const el = document.querySelector('.table-scroll');
    if (el) el.scrollTop = el.scrollHeight;
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

      {summary && (
        <section className="panel status-panel" data-testid="status-panel">
          <span>
            读数 <strong>{summary.n}</strong> 条 · 查询 <strong>{summary.q}</strong> 个 ·
            算法耗时 <strong>{summary.elapsedMs.toFixed(1)}</strong> ms
          </span>
          {lastRow && (
            <span className="last-row" data-testid="last-row">
              末行（第 {lastRow.index} 个）：[{lastRow.query.left}, {lastRow.query.right}] →
              众数 <strong>{lastRow.answer.value}</strong>，频次 <strong>{lastRow.answer.count}</strong>
              <button type="button" className="btn small" onClick={scrollToLast}>
                滚动到末行
              </button>
            </span>
          )}
        </section>
      )}

      {answers && (
        <section className="panel table-panel" data-testid="result-panel">
          <VirtualTable answers={answers} queries={queries} />
        </section>
      )}
    </div>
  );
}
