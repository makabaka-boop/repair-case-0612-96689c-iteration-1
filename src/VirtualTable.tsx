import { useEffect, useRef, useState } from 'react';
import type { ModeResult } from './lib/mode';

interface VirtualTableProps {
  answers: ModeResult[];
  queries: { left: number; right: number }[];
}

const ROW_HEIGHT = 30;
const OVERSCAN = 12;

/** 可滚动结果表：仅渲染可视区行，20 万行也能流畅浏览，且保持原顺序。 */
export function VirtualTable({ answers, queries }: VirtualTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setViewportHeight(entries[0].contentRect.height);
    });
    observer.observe(el);
    setViewportHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [answers]);

  const total = answers.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    total,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );

  // 虚拟列表必须把未渲染行的高度撑开：上下各放一个 aria-hidden 占位行，
  // 使滚动内容总高度等于全部行的高度。否则 scrollHeight 只覆盖已渲染的
  // 数十行，"滚动到末行"（scrollTop = scrollHeight）永远到不了第 20 万行。
  const topPad = startIndex * ROW_HEIGHT;
  const bottomPad = (total - endIndex) * ROW_HEIGHT;

  const rows: JSX.Element[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const a = answers[i];
    const q = queries[i];
    rows.push(
      <tr
        key={i}
        className={i % 2 === 0 ? 'row-even' : 'row-odd'}
        style={{ height: ROW_HEIGHT }}
      >
        <td className="col-index" data-label="序号">
          {i + 1}
        </td>
        <td className="col-range" data-label="边界">
          [{q.left}, {q.right}]
        </td>
        <td className="col-mode" data-label="众数">
          {a.value}
        </td>
        <td className="col-count" data-label="频次">
          {a.count}
        </td>
      </tr>,
    );
  }

  return (
    <div className="table-scroll" ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <table className="result-table">
        <thead className="result-head">
          <tr style={{ height: ROW_HEIGHT }}>
            <th className="col-index">序号</th>
            <th className="col-range">边界 [left, right]</th>
            <th className="col-mode">众数</th>
            <th className="col-count">频次</th>
          </tr>
        </thead>
        <tbody>
          {topPad > 0 && (
            <tr aria-hidden="true" style={{ height: topPad }}>
              <td colSpan={4} style={{ padding: 0, border: 'none' }} />
            </tr>
          )}
          {rows}
          {bottomPad > 0 && (
            <tr aria-hidden="true" style={{ height: bottomPad }}>
              <td colSpan={4} style={{ padding: 0, border: 'none' }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
