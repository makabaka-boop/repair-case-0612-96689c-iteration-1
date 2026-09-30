/**
 * 离线区间众数（闭区间）
 *
 * 给定有符号 32 位整数序列 values 与若干查询 [left, right]，按查询原顺序返回
 * 每个闭区间内出现频次最高的数值；频次并列时取较小数值。
 *
 * 算法：Mo's algorithm（按 Hilbert 曲线顺序处理查询）保证总指针移动 O(n√q)，
 * 值域做 √m 分块；块内按"频次层"计数（level counts）。加入/删除一个排名
 * 为 O(1) 摊还；回答查询时只需：
 *   1. 取全局最大频次 maxFreq（O(1) 摊还）；
 *   2. 从 rank 最小的块开始找到块最大频次等于 maxFreq 的块（O(√m)）；
 *   3. 在该块内按 rank 升序找到首个频次等于 maxFreq 的排名（O(√m)）。
 * 总时间复杂度 O((n + q)√n)，空间复杂度 O(n + q)。
 */

/** 单个查询的计算结果：众数数值与其频次。 */
export interface ModeResult {
  value: number;
  count: number;
}

/** Hilbert 曲线序号（power >= 1，序号范围 [0, 2^(2power))）。 */
function hilbertOrder(x: number, y: number, power: number): number {
  let order = 0;
  let rx = 0;
  let ry = 0;
  let dist = 0;
  for (let s = 1 << (power - 1); s > 0; s >>>= 1) {
    rx = (x & s) > 0 ? 1 : 0;
    ry = (y & s) > 0 ? 1 : 0;
    order += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = (1 << power) - 1 - x;
        y = (1 << power) - 1 - y;
      }
      dist = x;
      x = y;
      y = dist;
    }
  }
  return order;
}

/**
 * 计算全部查询的区间众数。
 *
 * @param values 长度 n（1..200000）的有符号 32 位整数序列
 * @param queries 长度 q（1..200000）的闭区间查询，0 <= left <= right < n
 * @returns 按 queries 原顺序排列的结果
 */
export function rangeModes(
  values: Int32Array,
  queries: ReadonlyArray<{ left: number; right: number }>,
): ModeResult[] {
  const n = values.length;
  const q = queries.length;
  if (n === 0 || q === 0) return [];

  // ---- 坐标压缩：有符号整数按数值升序映射到 rank（并列时 rank 小即数值小）----
  const sorted = Array.from(values).sort((a, b) => a - b);
  const m = deduplicateInPlace(sorted);
  const rankOf = new Map<number, number>();
  for (let r = 0; r < m; r++) rankOf.set(sorted[r], r);
  const ranks = new Int32Array(n);
  for (let i = 0; i < n; i++) ranks[i] = rankOf.get(values[i])!;

  // ---- 值域分块：块大小取 √m，块数约 √m（回答时两次线性扫描均为 O(√m)）----
  const blockSize = Math.max(1, Math.round(Math.sqrt(m)));
  const numBlocks = Math.ceil(m / blockSize);

  // 全局频次
  const freq = new Int32Array(m);
  // 全局频次层计数：globalLevel[f] = 频次恰为 f 的不同数值个数
  const globalLevel = new Int32Array(n + 1);
  globalLevel[0] = m;
  let maxFreq = 0;

  // 每个值块的最大频次
  const blockMax = new Int32Array(numBlocks);
  // 每个值块各频次层的排名数：懒增长（倍增），容量按各块内排名总出现次数封顶
  const blockLevels: Int32Array[] = new Array(numBlocks);
  for (let b = 0; b < numBlocks; b++) {
    blockLevels[b] = new Int32Array(1);
    blockLevels[b][0] = Math.min(blockSize, m - b * blockSize);
  }

  function add(rank: number): void {
    const b = (rank / blockSize) | 0;
    const f = freq[rank];
    globalLevel[f]--;
    globalLevel[f + 1]++;
    // 频次层数组容量不足时先倍增（必须在写入新计数之前完成，否则旧数组上的
    // f 层递减会被 grown.set 覆盖回去）
    if (f + 1 >= blockLevels[b].length) {
      const old = blockLevels[b];
      const grown = new Int32Array(old.length * 2);
      grown.set(old);
      blockLevels[b] = grown;
    }
    const lv = blockLevels[b];
    lv[f]--;
    lv[f + 1]++;
    freq[rank] = f + 1;
    if (f + 1 > blockMax[b]) blockMax[b] = f + 1;
    if (f + 1 > maxFreq) maxFreq = f + 1;
  }

  function remove(rank: number): void {
    const b = (rank / blockSize) | 0;
    const f = freq[rank];
    globalLevel[f]--;
    globalLevel[f - 1]++;
    const lv = blockLevels[b];
    lv[f]--;
    lv[f - 1]++;
    freq[rank] = f - 1;
    if (blockMax[b] === f && lv[f] === 0) blockMax[b] = f - 1;
    if (maxFreq === f && globalLevel[f] === 0) maxFreq = f - 1;
  }

  // ---- 查询按 Hilbert 顺序排列；answer 数组保持原顺序 ----
  const power = Math.max(1, Math.ceil(Math.log2(Math.max(n, 1))));
  // Hilbert 序号最大可达 4^power - 1：n 上限 200000 时 power=18、序号可达
  // 2^36-1，超出 32 位无符号整数范围。必须用 Float64Array 存放（此范围内的
  // 整数均可被 IEEE-754 双精度精确表示）；若截断到 32 位，排序键的空间局部性
  // 会被彻底打乱，莫队指针将在相距很远的区间间频繁跳转。
  const order = new Float64Array(q);
  for (let i = 0; i < q; i++) {
    order[i] = hilbertOrder(queries[i].left, queries[i].right, power);
  }
  const perm: number[] = new Array(q);
  for (let i = 0; i < q; i++) perm[i] = i;
  perm.sort((a, b) => order[a] - order[b]);

  const answers = new Array<ModeResult>(q);
  let curL = 0;
  let curR = -1;
  for (let k = 0; k < q; k++) {
    const qi = perm[k];
    const left = queries[qi].left;
    const right = queries[qi].right;
    while (curL > left) add(ranks[--curL]);
    while (curR < right) add(ranks[++curR]);
    while (curL < left) remove(ranks[curL++]);
    while (curR > right) remove(ranks[curR--]);

    // 找到含 maxFreq 层的最左值块
    let chosenBlock = 0;
    while (blockMax[chosenBlock] !== maxFreq) chosenBlock++;

    // 块内升序找首个频次为 maxFreq 的排名（块最大频次保证其一定存在）
    const start = chosenBlock * blockSize;
    const end = Math.min(start + blockSize, m);
    let chosenRank = start;
    while (chosenRank < end && freq[chosenRank] !== maxFreq) chosenRank++;

    answers[qi] = { value: sorted[chosenRank], count: maxFreq };
  }
  return answers;
}

/** 将升序数组就地去重，返回去重后长度。 */
function deduplicateInPlace(arr: number[]): number {
  let w = 0;
  for (let r = 1; r < arr.length; r++) {
    if (arr[r] !== arr[w]) arr[++w] = arr[r];
  }
  return w + 1;
}
