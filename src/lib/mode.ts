/**
 * 离线区间众数（闭区间）
 *
 * 给定有符号 32 位整数序列 values 与若干查询 [left, right]，按查询原顺序返回
 * 每个闭区间内出现频次最高的数值；频次并列时取较小数值。
 *
 * 可选"双峰复核"（options.bimodal）：在众数之外再返回出现次数第二高的**不同**
 * 读数及其频次，排序键固定为「频次降序、读数升序」，与莫队处理顺序无关；窗口内
 * 只有一种读数时 second 明确为 null。双峰结果与众数共用同一次指针移动维护出的
 * 频次表（不逐区间重建）：回答时在获胜值块上做一次升序扫描得到块内前两名，再用
 * O(√m) 扫一遍各块的最大频次找出其余值块中的最优候选并裁决，回答仍为 O(√m)。
 *
 * 算法：Mo's algorithm（按 Hilbert 曲线顺序处理查询）保证总指针移动 O(n√q)，
 * 值域做 √m 分块；块内按"频次层"计数（level counts）。加入/删除一个排名
 * 为 O(1) 摊还；回答查询时只需：
 *   1. 取全局最大频次 maxFreq（O(1) 摊还）；
 *   2. 从 rank 最小的块开始找到块最大频次等于 maxFreq 的块（O(√m)）；
 *   3. 在该块内按 rank 升序找到首个频次等于 maxFreq 的排名（O(√m)）；
 *   4. 双峰复核时再扫描获胜块取块内次席、扫描块头取其他块首席并裁决（O(√m)）。
 * 总时间复杂度 O((n + q)√n)，空间复杂度 O(n + q)。
 */

/** 单个查询的计算结果：众数数值与其频次。 */
export interface ModeResult {
  value: number;
  count: number;
}

/**
 * 双峰复核结果：first 与未启用复核时的众数逐项一致（同一次计算产生）；
 * second 为频次第二高的不同读数，窗口内只有一种读数时为 null。
 */
export interface BimodalResult {
  first: ModeResult;
  second: ModeResult | null;
}

/** 区间查询选项：bimodal 为 true 时返回前两名不同读数（双峰复核）。 */
export interface RangeModeOptions {
  bimodal?: boolean;
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
 * @param options.bimodal 启用双峰复核时返回 BimodalResult[]（含第二名）
 * @returns 按 queries 原顺序排列的结果
 */
export function rangeModes(
  values: Int32Array,
  queries: ReadonlyArray<{ left: number; right: number }>,
): ModeResult[];
export function rangeModes(
  values: Int32Array,
  queries: ReadonlyArray<{ left: number; right: number }>,
  options: { bimodal: true },
): BimodalResult[];
export function rangeModes(
  values: Int32Array,
  queries: ReadonlyArray<{ left: number; right: number }>,
  options: RangeModeOptions,
): ModeResult[] | BimodalResult[];
export function rangeModes(
  values: Int32Array,
  queries: ReadonlyArray<{ left: number; right: number }>,
  options: RangeModeOptions = {},
): ModeResult[] | BimodalResult[] {
  const bimodal = options.bimodal === true;
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

  const answers: (ModeResult | BimodalResult)[] = new Array(q);
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

    // 块内按 rank 升序扫描一次，同时取得排序键（频次降序、rank 升序）下的
    // 前两名：扫描方向保证频次并列时先出现的 rank 更小。第一名即为旧众数，
    // 次席是"本块内、第一名之外"的最优候选。只统计频次 > 0 的在场读数。
    const start = chosenBlock * blockSize;
    const end = Math.min(start + blockSize, m);
    let topRank = -1;
    let topFreq = -1;
    let secondRank = -1;
    let secondFreq = -1;
    if (bimodal) {
      for (let r = start; r < end; r++) {
        const f = freq[r];
        if (f <= 0) continue;
        if (topRank < 0) {
          topRank = r;
          topFreq = f;
        } else if (f > topFreq) {
          // 频次严格更高：旧首席降为次席，新值成为首席（升序扫描下
          // f === topFreq 时不可能更优，故这里严格大于即足够）
          secondRank = topRank;
          secondFreq = topFreq;
          topRank = r;
          topFreq = f;
        } else if (secondRank < 0 || f > secondFreq) {
          // 次席位空缺，或频次严格高于现次席；与现次席同频时当前 rank 更大，
          // 不替换，保证并列裁决只依赖读数本身而非查询处理顺序
          secondRank = r;
          secondFreq = f;
        }
      }
    } else {
      // 未启用复核：保持旧众数的精确选取路径（块内首个 maxFreq 排名）
      topRank = start;
      while (topRank < end && freq[topRank] !== maxFreq) topRank++;
      topFreq = maxFreq;
    }

    if (!bimodal) {
      answers[qi] = { value: sorted[topRank], count: maxFreq };
      continue;
    }

    // 其他值块的最优候选：blockMax 最高（并列取最左块）的块内最左命中 rank。
    // 各块按"频次降序、rank 升序"比较，它与获胜块次席决出全局第二名。
    let otherRank = -1;
    let otherFreq = -1;
    for (let b = 0; b < numBlocks; b++) {
      if (b === chosenBlock) continue;
      const bf = blockMax[b];
      if (bf <= 0 || bf < otherFreq) continue;
      const bs = b * blockSize;
      const be = Math.min(bs + blockSize, m);
      let br = bs;
      while (br < be && freq[br] !== bf) br++;
      if (br < be && (otherRank < 0 || bf > otherFreq || (bf === otherFreq && br < otherRank))) {
        otherRank = br;
        otherFreq = bf;
      }
    }

    // 全局次席：块内次席与其他块首席按同一排序键裁决
    if (otherRank >= 0 && (secondRank < 0 || otherFreq > secondFreq || (otherFreq === secondFreq && otherRank < secondRank))) {
      secondRank = otherRank;
      secondFreq = otherFreq;
    }

    const first: ModeResult = { value: sorted[topRank], count: topFreq };
    answers[qi] = {
      first,
      second: secondRank >= 0 ? { value: sorted[secondRank], count: secondFreq } : null,
    };
  }
  return answers as ModeResult[] | BimodalResult[];
}

/** 将升序数组就地去重，返回去重后长度。 */
function deduplicateInPlace(arr: number[]): number {
  let w = 0;
  for (let r = 1; r < arr.length; r++) {
    if (arr[r] !== arr[w]) arr[++w] = arr[r];
  }
  return w + 1;
}
