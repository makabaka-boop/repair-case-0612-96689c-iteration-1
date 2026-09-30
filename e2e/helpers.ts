/**
 * e2e 共享构造器：20 万读数 + 20 万查询的对抗批次（大区间与单点交替，
 * 末区间为全数组）。同时提供首、末查询的双峰预言答案，供浏览器端核对，
 * 避免在测试里对 20 万长表做全量暴力统计。
 */
export interface BatchInfo {
  json: string;
  values: number[];
  queries: { left: number; right: number }[];
  /** 首行查询的双峰复核预言答案。 */
  firstExpected: { first: { value: number; count: number }; second: { value: number; count: number } | null };
  /** 末行（全数组）的双峰复核预言答案。 */
  lastExpected: { first: { value: number; count: number }; second: { value: number; count: number } | null };
}

/** 对单个闭区间做 Map 计数，按频次降序、读数升序返回前两名。 */
export function oracleTop2(
  values: ArrayLike<number>,
  left: number,
  right: number,
): { first: { value: number; count: number }; second: { value: number; count: number } | null } {
  const counts = new Map<number, number>();
  for (let i = left; i <= right; i++) {
    counts.set(values[i], (counts.get(values[i]) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return {
    first: { value: ranked[0][0], count: ranked[0][1] },
    second: ranked.length >= 2 ? { value: ranked[1][0], count: ranked[1][1] } : null,
  };
}

export function buildAdversarialBatch(): BatchInfo {
  const n = 200_000;
  const q = 200_000;

  let seed = 20260916 >>> 0;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const values = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    values[i] = (i % 1000 === 0) ? 424242 : Math.floor(rand() * 30000) - 15000;
  }

  const queries = new Array<{ left: number; right: number }>(q);
  for (let i = 0; i < q - 1; i++) {
    if ((i & 1) === 0) {
      const l = Math.floor(rand() * 1000);
      queries[i] = { left: l, right: n - 1 - Math.floor(rand() * 1000) };
    } else {
      const p = Math.floor(rand() * n);
      queries[i] = { left: p, right: p };
    }
  }
  // 全数组区间：哨兵值 424242 出现 200 次，是可核对的唯一末行答案
  queries[q - 1] = { left: 0, right: n - 1 };

  // 末行预言：424242 以 200 次居首；其余读数的最大频次由一次扫描得到。
  const lastExpected = oracleTop2(values, 0, n - 1);
  // 首行预言：首查询为大区间，直接按区间计数一次（一次 Map 扫描，开销可接受）。
  const firstExpected = oracleTop2(values, queries[0].left, queries[0].right);

  return {
    json: JSON.stringify({ values, queries }),
    values,
    queries,
    firstExpected,
    lastExpected,
  };
}
