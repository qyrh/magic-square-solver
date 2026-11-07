/* =========================================================================
 * magic-core.js —— 任意阶幻方「可确定格子」求解核心
 *
 * 数学模型：
 *   n 阶幻方 = n×n 个数 x_1..x_N (N=n²)，外加幻和 S（未知）。
 *   约束：每行、每列、主/副对角线上的 n 个数之和都等于 S。
 *   全体 (x, S) 构成 R^{N+1} 的线性子空间 MS_aug。
 *   已知若干格的数值后，某格子（或 S）“可确定” ⟺
 *   坐标泛函 e_k 在 MS_aug 上的限制落在已知坐标泛函限制所张成的空间中。
 *   每一步给出恒等式  γ·x_k = Σ α_c·z_c （对一切幻方成立），
 *   并附上它由“线和都等于 S”加权组合而成的最简证明。
 *
 * 有理数实现说明：
 *   分子分母用 JS Number 存整数（|值| ≤ 2^53 内精确，本应用远达不到），
 *   每次运算后约分并做安全整数检查，超范围会抛出明确错误。
 *   （不用 BigInt：Chrome 156 开发版 V8 的 BigInt JIT 存在崩溃 bug。）
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.MagicCore = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var OVERFLOW_MSG = '数字太大，超出精确计算范围（请改用较小的已知数）';

  function safeInt(x) {
    if (!isFinite(x) || !Number.isInteger(x) || Math.abs(x) > 4503599627370496) throw new Error(OVERFLOW_MSG);
    return x;
  }
  /** 整数乘积：≤2^53 时精确（IEEE 正确舍入到整数）；超出则立即报错而不是静默舍入。
   *  曾有反例：Frac(p,3).sub(Frac(q,3)) 的中间积 p*3=2^53+1 被舍入成 2^53，静默算错。 */
  function mulExact(a, b) {
    const p = a * b;
    if (Math.abs(p) > 9007199254740992) throw new Error(OVERFLOW_MSG);
    return p;
  }
  function gcd(a, b) {
    if (a < 0) a = -a;
    if (b < 0) b = -b;
    while (b !== 0) { const t = a % b; a = b; b = t; }
    return a;
  }

  /* ---------------- 有理数 ---------------- */
  class Frac {
    constructor(n, d) {
      if (n === undefined) n = 0;
      if (d === undefined) d = 1;
      if (typeof n === 'bigint') n = Number(n);
      if (typeof d === 'bigint') d = Number(d);
      if (typeof n !== 'number' || typeof d !== 'number') throw new Error('Frac: 非法参数');
      // NaN/Infinity/非整数提前拒绝：否则 gcd 会死循环或结果失真
      if (!Number.isFinite(n) || !Number.isFinite(d) || !Number.isInteger(n) || !Number.isInteger(d))
        throw new Error('Frac: 非法参数（需有限整数）');
      if (d === 0) throw new Error('分母不能为 0');
      if (d < 0) { n = -n; d = -d; }
      const g = gcd(n, d);
      if (g > 1) { n = n / g; d = d / g; }
      this.n = safeInt(n); this.d = safeInt(d);
    }
    static from(x) {
      if (x instanceof Frac) return x;
      return new Frac(Number(x));
    }
    isZero() { return this.n === 0; }
    isNeg() { return this.n < 0; }
    add(b) {
      b = Frac.from(b);
      if (this.d === b.d) return new Frac(this.n + b.n, this.d);   // 同分母：精确快速路径
      return new Frac(mulExact(this.n, b.d) + mulExact(b.n, this.d), mulExact(this.d, b.d));
    }
    sub(b) {
      b = Frac.from(b);
      if (this.d === b.d) return new Frac(this.n - b.n, this.d);
      return new Frac(mulExact(this.n, b.d) - mulExact(b.n, this.d), mulExact(this.d, b.d));
    }
    mul(b) {
      b = Frac.from(b);
      const g1 = gcd(this.n, b.d), g2 = gcd(b.n, this.d);   // 乘前约分，尽量压小中间积
      return new Frac(mulExact(this.n / g1, b.n / g2), mulExact(this.d / g2, b.d / g1));
    }
    div(b) {
      b = Frac.from(b);
      if (b.n === 0) throw new Error('除以 0');
      const g1 = gcd(this.n, b.n), g2 = gcd(this.d, b.d);
      return new Frac(mulExact(this.n / g1, b.d / g2), mulExact(this.d / g2, b.n / g1));
    }
    neg() { return new Frac(-this.n, this.d); }
    equals(b) { b = Frac.from(b); return this.n === b.n && this.d === b.d; }
    toNumber() { return this.n / this.d; }
    toString() { return this.d === 1 ? String(this.n) : this.n + '/' + this.d; }
  }
  const F0 = new Frac(0), F1 = new Frac(1);

  /* ---------------- 数的解析与显示 ---------------- */
  function parseDec(s) {
    if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(s)) throw new Error('无法识别的数："' + s + '"（支持 3、-4、0.75、1/2、-3/4 等写法）');
    const neg = s[0] === '-';
    let t = s.replace(/^[+-]/, '');
    const parts = t.split('.');
    const ip = parts[0] || '0', fp = parts[1] || '';
    if (ip.length + fp.length > 15) throw new Error('"' + s + '" 有效数字过多（最多 15 位）');
    let num = Number(ip + fp);
    if (neg) num = -num;
    return new Frac(num, Math.pow(10, fp.length));
  }
  /** 解析用户输入：空 → null；支持 整数 / 小数 / 分数（分子分母还可用小数） */
  function parseNumberString(str) {
    if (str == null) return null;
    let s = String(str).trim().replace(/\s+/g, '').replace(/，/g, ',').replace(/、/g, '');
    if (s.endsWith(',')) s = s.slice(0, -1);
    if (s === '') return null;
    const parts = s.split('/');
    if (parts.length > 2) throw new Error('无法识别的数："' + str + '"');
    const a = parseDec(parts[0]);
    if (parts.length === 1) return a;
    const b = parseDec(parts[1]);
    if (b.isZero()) throw new Error('分数 "' + str + '" 的分母为 0');
    return a.div(b);
  }

  /** 若能写成有限小数则返回其字符串，否则 null。
   *  全程整数运算：10^k/f.d = 2^(k-c2)·5^(k-c5) 是整数（< 2^53），
   *  避免 f.n * 10^k 的浮点乘法在长小数下失真/变科学计数法（曾产出 '0.01.4…e+21' 坏串）。 */
  function exactDecimal(f) {
    let d = f.d, c2 = 0, c5 = 0;
    while (d % 2 === 0) { d /= 2; c2++; }
    while (d % 5 === 0) { d /= 5; c5++; }
    if (d !== 1) return null;
    let k = c2;
    if (c5 > k) k = c5;
    const mult = Math.pow(2, k - c2) * Math.pow(5, k - c5);   // = 10^k / f.d，整数
    const num = f.n * mult;
    // 上限 10^15−1：保证小数形式 ≤15 位有效数字，能被 parseDec 的 15 位限制无损读回
    // （曾因上限 2^52 可产出 16 位小数，回读抛“有效数字过多”）
    if (!isFinite(num) || Math.abs(num) > 999999999999999) return null;   // 超界：退回分数显示
    let s = String(num);
    const neg = s[0] === '-';
    if (neg) s = s.slice(1);
    while (s.length <= k) s = '0' + s;
    const intPart = s.slice(0, s.length - k) || '0';
    const fracPart = s.slice(s.length - k);
    return (neg ? '-' : '') + intPart + '.' + fracPart;
  }
  function sigOfIntStr(s) {
    const t = s.replace(/^0+/, '');
    return t.length;
  }
  function decimalSig(dec) { return sigOfIntStr(dec.replace('-', '').replace('.', '')); }
  function fractionSig(f) { return sigOfIntStr(String(f.n)) + sigOfIntStr(String(f.d)); }
  /** 展示规则：整数直接显示；否则比较最简分数与有限小数的有效数字个数，少者胜，平手取分数 */
  function fmtNumber(f) {
    f = Frac.from(f);
    if (f.d === 1) return String(f.n);
    const dec = exactDecimal(f);
    if (dec !== null && decimalSig(dec) < fractionSig(f)) return dec;
    return f.toString();
  }

  /* ---------------- 线性代数（行变换，全部精确有理数） ---------------- */
  /** rows: 长度 nCols+1 的数组（最后一列为增广右端）。就地变换，返回主元列列表 */
  function rrefRows(rows, nCols) {
    const pivots = [];
    let r = 0;
    const m = rows.length;
    for (let c = 0; c < nCols && r < m; c++) {
      let p = -1;
      for (let i = r; i < m; i++) { if (!rows[i][c].isZero()) { p = i; break; } }
      if (p === -1) continue;
      const tmp = rows[r]; rows[r] = rows[p]; rows[p] = tmp;
      const row = rows[r];
      const piv = row[c];
      if (!piv.equals(F1)) { for (let j = c; j <= nCols; j++) row[j] = row[j].div(piv); }
      for (let i = 0; i < m; i++) {
        if (i === r) continue;
        const f = rows[i][c];
        if (f.isZero()) continue;
        const ri = rows[i];
        for (let j = c; j <= nCols; j++) ri[j] = ri[j].sub(f.mul(row[j]));
      }
      pivots.push(c); r++;
    }
    return pivots;
  }
  /** 求解 Σ t_j·col_j = rhs（cols 为列向量组）；无解返回 null，否则给出一组特解（自由变量取 0） */
  function solveCols(cols, rhs) {
    const nCols = cols.length;
    const rows = rhs.map(function (val, i) {
      const r = cols.map(function (col) { return col[i]; });
      r.push(val);
      return r;
    });
    const pivots = rrefRows(rows, nCols);
    for (let i = pivots.length; i < rows.length; i++) {
      let allz = true;
      for (let j = 0; j < nCols; j++) { if (!rows[i][j].isZero()) { allz = false; break; } }
      if (allz && !rows[i][nCols].isZero()) return null;
    }
    const x = new Array(nCols).fill(F0);
    for (let i = 0; i < pivots.length; i++) x[pivots[i]] = rows[i][nCols];
    return x;
  }
  /** 增广行求解（行含右端）。无解返回 null，否则返回特解 */
  function solveAug(rowsIn, nCols) {
    const rows = rowsIn.map(function (r) { return r.slice(); });
    const pivots = rrefRows(rows, nCols);
    for (let i = pivots.length; i < rows.length; i++) {
      let allz = true;
      for (let j = 0; j < nCols; j++) { if (!rows[i][j].isZero()) { allz = false; break; } }
      if (allz && !rows[i][nCols].isZero()) return null;
    }
    const x = new Array(nCols).fill(F0);
    for (let i = 0; i < pivots.length; i++) x[pivots[i]] = rows[i][nCols];
    return x;
  }
  /** 零空间基。rows 为纯系数行（无右端） */
  function nullSpaceRows(rows, nCols) {
    const aug = rows.map(function (r) { const s = r.slice(); s.push(F0); return s; });
    const pivots = rrefRows(aug, nCols);
    const pivSet = new Set(pivots);
    const vecs = [];
    for (let f = 0; f < nCols; f++) {
      if (pivSet.has(f)) continue;
      const v = new Array(nCols).fill(F0);
      v[f] = F1;
      for (let i = 0; i < pivots.length; i++) v[pivots[i]] = aug[i][f].neg();
      vecs.push(v);
    }
    return vecs;
  }
  /** Σ a_i·cands_i = target 的系数（即 target ∈ span(cands) 的判定） */
  function spanCoeffs(cands, target) {
    if (cands.length === 0) return target.every(function (f) { return f.isZero(); }) ? [] : null;
    return solveCols(cands, target);
  }

  /* ---------------- 幻方模型 ---------------- */
  function buildModel(n) {
    if (!Number.isInteger(n) || n < 1 || n > 9) throw new Error('阶数 n 需为 1~9 的整数');
    const N = n * n, SC = N;
    const lines = [];
    for (let i = 0; i < n; i++) lines.push({ type: 'row', name: '第' + (i + 1) + '行', cells: Array.from({ length: n }, function (_, j) { return i * n + j; }) });
    for (let j = 0; j < n; j++) lines.push({ type: 'col', name: '第' + (j + 1) + '列', cells: Array.from({ length: n }, function (_, i) { return i * n + j; }) });
    lines.push({ type: 'diag', name: '主对角线', cells: Array.from({ length: n }, function (_, i) { return i * n + i; }) });
    lines.push({ type: 'adiag', name: '副对角线', cells: Array.from({ length: n }, function (_, i) { return i * n + (n - 1 - i); }) });

    const lineRows = lines.map(function (L) {
      const v = new Array(N + 1).fill(F0);
      for (let ci = 0; ci < L.cells.length; ci++) v[L.cells[ci]] = F1;
      v[SC] = new Frac(-1);
      return v;
    });
    const basis = nullSpaceRows(lineRows, N + 1);          // MS_aug 的一组基
    const u = [];                                          // u[c] = 坐标泛函 e_c 在基下的坐标
    for (let c = 0; c <= N; c++) u.push(basis.map(function (b) { return b[c]; }));

    const letters = [];
    for (let idx = 0; idx < N; idx++) {
      letters.push(n <= 5 ? String.fromCharCode(97 + idx) : ('r' + (Math.floor(idx / n) + 1) + 'c' + (idx % n + 1)));
    }
    const center = (n % 2 === 1) ? ((n - 1) / 2) * n + (n - 1) / 2 : -1;
    const rot180 = function (idx) { const r = Math.floor(idx / n), c = idx % n; return (n - 1 - r) * n + (n - 1 - c); };
    return { n: n, N: N, SC: SC, lines: lines, lineRows: lineRows, basis: basis, m: basis.length, u: u, letters: letters, center: center, rot180: rot180 };
  }

  /* ---------------- 恒等式求解：γ·x_k = Σ α_c·z_c ---------------- */
  /**
   * target k，已知坐标 C（可含 S）。求整数 γ、α、λ 使
   *   γ·e_k − Σ α_c·e_c = Σ λ_i·(线 i 的示性向量, S 分量 −1)
   * 于是一切幻方中恒有 γ·x_k = Σ α_c·z_c。
   */
  function solveIdentity(model, k, C) {
    const N = model.N, SC = model.SC, lines = model.lines;
    const cols = [];
    for (const c of C) { const v = new Array(N + 1).fill(F0); v[c] = F1; cols.push(v); }
    for (const L of lines) {
      const v = new Array(N + 1).fill(F0);
      for (const x of L.cells) v[x] = F1;
      v[SC] = new Frac(-1);
      cols.push(v);
    }
    const rhs = new Array(N + 1).fill(F0); rhs[k] = F1;
    const sol = solveCols(cols, rhs);
    if (sol === null) return null;

    // 通分去掉分母，再除以最大公因数
    let s = 1;
    for (let i = 0; i < sol.length; i++) {
      const d = sol[i].d;
      s = s / gcd(s, d) * d;
    }
    const ints = sol.map(function (f) { return f.n * (s / f.d); });
    let g = 0;
    for (let i = 0; i < ints.length; i++) { const x = ints[i]; if (x !== 0) g = gcd(g, x); }
    g = gcd(g, s);
    const gamma = s / g;
    const aint = ints.map(function (v) { return v / g; });

    const alphaMap = new Map();
    C.forEach(function (c, j) { if (aint[j] !== 0) alphaMap.set(c, aint[j]); });
    const lambdaMap = new Map();
    lines.forEach(function (L, j) { const v = aint[C.length + j]; if (v !== 0) lambdaMap.set(j, v); });

    // —— 内部校验 ——
    let T = 0;
    for (let j = C.length; j < aint.length; j++) T += aint[j];
    const comb = new Map();
    for (const entry of lambdaMap) {
      for (let ci = 0; ci < lines[entry[0]].cells.length; ci++) {
        const cell = lines[entry[0]].cells[ci];
        comb.set(cell, (comb.get(cell) || 0) + entry[1]);
      }
    }
    for (let cell = 0; cell < N; cell++) {
      let expected = (cell === k ? gamma : 0) - (alphaMap.get(cell) || 0);
      if ((comb.get(cell) || 0) !== expected) throw new Error('内部校验失败：格子系数不符（cell=' + cell + '）');
    }
    if (k === SC) { if (T !== -gamma) throw new Error('内部校验失败：S 系数不符'); }
    else if (alphaMap.has(SC)) { if (T !== alphaMap.get(SC)) throw new Error('内部校验失败：S 系数不符'); }
    else if (T !== 0) throw new Error('内部校验失败：S 未抵消');
    if (gamma <= 0) throw new Error('内部校验失败：γ');

    return { gamma: gamma, alphaMap: alphaMap, lambdaMap: lambdaMap, T: T };
  }

  /* ---------------- 常用定理识别（仅用于命名/讲解） ---------------- */
  const THEOREM_RANK = { 'S-line': 0, 'center-S': 1, 'opposite': 2, 'corner4': 3, 'knight3': 4, 'line-complete': 5 };
  function isCorner(model, c) {
    const n = model.n, r = Math.floor(c / n), col = c % n;
    return (r === 0 || r === n - 1) && (col === 0 || col === n - 1);
  }
  function recognizeTheorem(model, k, C, alphaMap, gamma) {
    const n = model.n, SC = model.SC, lines = model.lines;
    const cells = C.filter(function (c) { return c !== SC; });
    const hasS = C.indexOf(SC) >= 0;
    const sameAsLine = cells.length >= 1 && lines.some(function (L) {
      return L.cells.length === cells.length && L.cells.every(function (c) { return cells.indexOf(c) >= 0; });
    });
    const allEqGamma = cells.every(function (c) { return alphaMap.get(c) === gamma; });

    if (k === SC && !hasS && sameAsLine && allEqGamma)
      return { key: 'S-line', name: '幻和定理（整线求 S）' };
    if (k === SC && !hasS && n === 4 && cells.length === 4 && cells.every(function (c) { return isCorner(model, c); }) && allEqGamma)
      return { key: 'corner4', name: '四角和定理（四阶）' };
    if (n % 2 === 1) {
      const ng = gamma * n;
      // 中心 = S/n：目标=中心、前提={S} 时 α_S·n = γ（原条件误写成 α_S = γ·n，恒不成立，死分支）
      if (k === model.center && hasS && cells.length === 0 && alphaMap.get(SC) * n === gamma)
        return { key: 'center-S', name: '中心定理（奇数阶）' };
      if (k === SC && !hasS && cells.length === 1 && cells[0] === model.center && alphaMap.get(cells[0]) === ng)
        return { key: 'center-S', name: '中心定理（奇数阶）' };
    }
    if (k !== SC && hasS) {
      const L = lines.find(function (L) {
        return L.cells.indexOf(k) >= 0 && L.cells.length === cells.length + 1 &&
          L.cells.every(function (c) { return c === k || cells.indexOf(c) >= 0; });
      });
      if (L && alphaMap.get(SC) === gamma && cells.every(function (c) { return alphaMap.get(c) === -gamma; }))
        return { key: 'line-complete', name: '补线法（缺格补齐）' };
    }
    if (n === 3 && k !== SC) {
      const set = new Set(cells.concat([k]));
      if (set.size === 3 && set.has(model.center)) {
        const rest = Array.from(set).filter(function (c) { return c !== model.center; });
        if (rest.length === 2 && model.rot180(rest[0]) === rest[1])
          return { key: 'opposite', name: '对顶定理（三阶）' };
      }
      // 马步定理：角上的数×2 = 与它成马步的两数之和（2a = f + h 型）
      if (cells.length === 2) {
        const trio = [k, cells[0], cells[1]];
        const corner = trio.find(function (c) { return isCorner(model, c); });
        if (corner !== undefined) {
          const r0 = Math.floor(corner / 3), c0 = corner % 3;
          const k1 = 1 * 3 + (2 - c0);   // (中行, 角列的对列)
          const k2 = (2 - r0) * 3 + 1;   // (角行的对行, 中列)
          const s = new Set(trio);
          if (s.size === 3 && s.has(k1) && s.has(k2))
            return { key: 'knight3', name: '马步定理（三阶）' };
        }
      }
    }
    return null;
  }

  /* ---------------- 技巧分级与“去交叉”区域 ---------------- */
  /**
   * 技巧优先级（证明策略排序用）：
   *  1 = 幻和直用（单条线的和 = S，即可出数/出 S）
   *  2 = 两线去交叉：两条线的和相等，去掉交叉格后剩余部分之和相等
   *  3 = 多线容斥：若干条线的和（各计一次）与另若干条线/总和相等，重叠部分成对抵消
   *  4 = 一般加权组合
   */
  function techniqueClass(lambdaMap) {
    if (lambdaMap.size === 1) return 1;
    let allUnit = true;
    for (const v of lambdaMap.values()) {
      if (v !== 1 && v !== -1) { allUnit = false; break; }
    }
    if (!allUnit) return 4;
    if (lambdaMap.size === 2) return 2;
    return 3;
  }
  /**
   * “去交叉”区域：把 λ 为正的线记为红组、负的线记为蓝组（各按次数计入），
   * 两组公共的格子成对抵消，剩下的即红色部分与蓝色部分。
   * 恒等式可读成：红色部分（按次数）= 蓝色部分（按次数）+ T×S。
   */
  function buildRegions(model, lambdaMap) {
    const plus = new Map(), minus = new Map(); // cell -> 次数
    for (const e of lambdaMap) {
      const mult = e[1] > 0 ? e[1] : -e[1];
      const tgt = e[1] > 0 ? plus : minus;
      for (const cell of model.lines[e[0]].cells) tgt.set(cell, (tgt.get(cell) || 0) + mult);
    }
    for (const cell of Array.from(plus.keys())) {
      if (!minus.has(cell)) continue;
      const m = Math.min(plus.get(cell), minus.get(cell));
      const a = plus.get(cell) - m, b = minus.get(cell) - m;
      if (a > 0) plus.set(cell, a); else plus.delete(cell);
      if (b > 0) minus.set(cell, b); else minus.delete(cell);
    }
    return { red: plus, blue: minus };
  }

  /* ---------------- 最少已知数（极小前提）搜索 ---------------- */
  function combCount(n, k) { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); }
  function* combos(arr, k) {
    if (k === 0) { yield []; return; }
    for (let i = 0; i <= arr.length - k; i++) {
      for (const tail of combos(arr.slice(i + 1), k - 1)) yield [arr[i]].concat(tail);
    }
  }

  /**
   * 找出确定 target 所需的（近似）极小已知坐标集合。
   * prev/newCoord 用于轮间增量：更小的前提集必含新坐标。
   */
  function findMinimal(model, target, knownArr, prev, newCoord) {
    const uT = model.u[target];
    const inSpan = function (cs) {
      return spanCoeffs(cs.map(function (c) { return model.u[c]; }), uT) !== null;
    };
    if (prev && prev.d === 1) return prev;

    for (let size = 1; size <= 3; size++) {
      if (prev && size >= prev.d) break;
      if (!prev && size >= 2 && combCount(knownArr.length, size) > (size === 2 ? 3000 : 1000)) break;
      let found = null;
      if (!prev) {
        for (const C of combos(knownArr, size)) {
          if (inSpan(C)) { (found = found || []).push(C); if (found.length >= 8) break; }
        }
      } else {
        if (newCoord == null || knownArr.indexOf(newCoord) < 0) continue;
        const rest = knownArr.filter(function (c) { return c !== newCoord; });
        if (size === 1) {
          if (inSpan([newCoord])) found = [[newCoord]];
        } else if (combCount(rest.length, size - 1) <= (size === 2 ? 3000 : 1000)) {
          for (const tail of combos(rest, size - 1)) {
            const C = [newCoord].concat(tail);
            if (inSpan(C)) { (found = found || []).push(C); if (found.length >= 8) break; }
          }
        }
      }
      if (found && found.length) return { d: size, Cs: found };
    }

    // 回退前短路：若“补线法/整线求 S”（tech=1）直接可用，则该目标择优时恒胜，
    // 无须再做全量系数解 + 贪心收缩（近满盘大阶曾在此耗时 1–2s）
    {
      const kset = new Map();
      for (const c of knownArr) kset.set(c, F1);
      const direct = target !== model.SC ? lineCompletionIdentity(model, target, kset) : sLineIdentity(model, kset);
      if (direct) return { d: direct.alphaMap.size, Cs: [Array.from(direct.alphaMap.keys())] };
    }

    // 回退：解出全部已知坐标上的组合系数，再贪心收缩支撑集
    const alpha = spanCoeffs(knownArr.map(function (c) { return model.u[c]; }), uT);
    if (alpha === null) return null;
    let support = knownArr.filter(function (c, j) { return !alpha[j].isZero(); });
    for (const c of support.slice()) {
      if (support.indexOf(c) < 0) continue;
      const trial = support.filter(function (x) { return x !== c; });
      if (inSpan(trial)) support = trial;
    }
    if (prev && support.length >= prev.d) return prev;
    return { d: support.length, Cs: [support] };
  }

  /* ---------------- 逐步推导主循环 ---------------- */
  function scoreLess(a, b) {
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; }
    return false;
  }

  /* 直接构造“幻和直用”的两类恒等式（技巧 1，最简单） */
  // 补线法：x_k = S − 同线其余格（该线其余格都已知时可用）
  function lineCompletionIdentity(model, target, known) {
    const SC = model.SC;
    if (!known.has(SC)) return null;
    let best = null, bestLen = Infinity;
    for (let li = 0; li < model.lines.length; li++) {
      const L = model.lines[li];
      if (L.cells.indexOf(target) < 0) continue;
      let ok = true;
      for (let q = 0; q < L.cells.length; q++) {
        const c = L.cells[q];
        if (c !== target && !known.has(c)) { ok = false; break; }
      }
      if (!ok || L.cells.length >= bestLen) continue;
      const alphaMap = new Map();
      alphaMap.set(SC, 1);
      for (const c of L.cells) if (c !== target) alphaMap.set(c, -1);
      const lambdaMap = new Map(); lambdaMap.set(li, 1);
      best = { gamma: 1, alphaMap: alphaMap, lambdaMap: lambdaMap, T: 1 };
      bestLen = L.cells.length;
    }
    return best;
  }
  // 幻和定理：S = 整线之和（某条线全已知时可用）
  function sLineIdentity(model, known) {
    const SC = model.SC;
    let best = null, bestLen = Infinity;
    for (let li = 0; li < model.lines.length; li++) {
      const L = model.lines[li];
      let ok = true;
      for (let q = 0; q < L.cells.length; q++) { if (!known.has(L.cells[q])) { ok = false; break; } }
      if (!ok || L.cells.length >= bestLen) continue;
      const alphaMap = new Map();
      for (const c of L.cells) alphaMap.set(c, 1);
      const lambdaMap = new Map(); lambdaMap.set(li, -1);
      best = { gamma: 1, alphaMap: alphaMap, lambdaMap: lambdaMap, T: -1 };
      bestLen = L.cells.length;
    }
    return best;
  }

  function* deduceStepsGen(model, givens, determinedSet, valueOf, opts) {
    const SC = model.SC;
    const baseIndex = (opts && opts.baseIndex) || 1;
    const labels = (opts && opts.labels) || new Map();
    const known = new Map(givens);
    const knownEntries = Array.from(givens.keys()).map(function (c) { return { coord: c, source: null }; });
    const sourceMap = new Map(); knownEntries.forEach(function (e) { sourceMap.set(e.coord, null); });
    const pending = new Set(Array.from(determinedSet).filter(function (c) { return !known.has(c); }));
    const prevState = new Map();
    const firstProof = new Map();
    const steps = [];
    let newCoord = null;

    while (pending.size > 0) {
      yield { pending: pending.size };   // 协作式让出点（异步驱动器在此可交还主线程）
      const targets = [];
      for (let c = 0; c < model.N; c++) if (pending.has(c)) targets.push(c);
      if (pending.has(SC)) targets.push(SC);

      // 收集所有候选结论 + 证明，按“证明最简单”统一择优：
      // 技巧分级（幻和直用最先）→ 涉及行列数(系数计入) → 涉及格子数 → 前提数 → 已命名定理 → 少除法
      const cands = [];
      let minD = Infinity;
      const stCache = [];
      for (const t of targets) {
        const prev = prevState.get(t) || null;
        const st = findMinimal(model, t, Array.from(known.keys()), prev, newCoord);
        if (st === null) throw new Error('内部错误：目标无法推导');
        prevState.set(t, st);
        stCache.push({ t: t, st: st });
        if (st.d < minD) minD = st.d;
      }
      for (const item of stCache) {
        const t = item.t, st = item.st;
        // ① 幻和直用（可直接构造，无需解方程，技巧分级 1）
        if (t !== SC) {
          const lc = lineCompletionIdentity(model, t, known);
          if (lc) cands.push({ target: t, id: lc, thm: { key: 'line-complete', name: '补线法（幻和 − 其余格）' }, d: lc.alphaMap.size });
        } else {
          const sl = sLineIdentity(model, known);
          if (sl) cands.push({ target: SC, id: sl, thm: { key: 'S-line', name: '幻和定理（整线求 S）' }, d: sl.alphaMap.size });
        }
        // ② 其他恒等式（只为接近最优前提数的目标求解，控制计算量）
        if (st.d <= minD + 1) {
          for (const C of st.Cs.slice(0, 3)) {
            const id = solveIdentity(model, t, C);
            if (id === null) continue;
            const thm = recognizeTheorem(model, t, C, id.alphaMap, id.gamma);
            cands.push({ target: t, id: id, thm: thm, d: C.length });
          }
        }
      }

      let chosen = null;
      for (const cd of cands) {
        const id = cd.id;
        let lamSum = 0;
        let maxAbs = 0;
        const lamVals = Array.from(id.lambdaMap.values());
        for (let q = 0; q < lamVals.length; q++) {
          const v = lamVals[q];
          const a = v < 0 ? -v : v;
          lamSum += a;
          if (a > maxAbs) maxAbs = a;
        }
        const tech = techniqueClass(id.lambdaMap);   // 1幻和直用 2两线去交叉 3多线去交叉 4一般
        // 涉及到的格子数（目标格、前提格、以及各条线覆盖的格子）
        const inv = new Set();
        for (const e of id.lambdaMap) {
          const cells = model.lines[e[0]].cells;
          for (let q = 0; q < cells.length; q++) inv.add(cells[q]);
        }
        for (const c of id.alphaMap.keys()) { if (c !== SC) inv.add(c); }
        if (cd.target !== SC) inv.add(cd.target);
        const rank = cd.thm ? (THEOREM_RANK[cd.thm.key] !== undefined ? THEOREM_RANK[cd.thm.key] : 9) : 9;
        const score = [
          tech,                        // ① 技巧从简：幻和直用最优先
          maxAbs,                      // ② 系数尽量为 1（能用“重合抵消”讲清楚）
          lamSum,                      // ③ 涉及的行列数（带系数按次数计入）
          inv.size,                    // ④ 涉及的格子数（越少越好）
          cd.d,                        // ⑤ 前提数（越少越好）
          rank,                        // ⑥ 已命名定理优先（对顶/马步/中心…）
          id.gamma === 1 ? 0 : 1,      // ⑦ 少一次除法
          cd.target === SC ? 1 : 0,    // ⑧ 同分时先出格子
          cd.target
        ];
        cd.tech = tech; cd.score = score;
        if (chosen === null || scoreLess(score, chosen.score)) chosen = cd;
      }
      if (chosen === null) throw new Error('内部错误：恒等式求解失败');

      const id = chosen.id, k = chosen.target;
      chosen.id.tech = chosen.tech;
      const Ceff = Array.from(id.alphaMap.keys());
      // 计算数值并交叉校验
      let acc = new Frac(0);
      for (const e of id.alphaMap) acc = acc.add(known.get(e[0]).mul(new Frac(e[1])));
      const value = acc.div(new Frac(id.gamma));
      if (!value.equals(valueOf.get(k))) throw new Error('内部错误：数值交叉校验失败');

      const thm = chosen.thm;
      const key = thm ? thm.key :
        ('sig|' + id.gamma + '|' + Ceff.slice().sort(function (a, b) { return a - b; }).map(function (c) { return c + ':' + id.alphaMap.get(c); }).join(','));
      const refStep = firstProof.has(key) ? firstProof.get(key) : null;
      if (refStep === null) firstProof.set(key, steps.length + baseIndex);

      const stepIdx = steps.length + baseIndex;
      const premises = Ceff.slice().sort(function (a, b) {
        const sa = (a === SC ? 1 : 0), sb = (b === SC ? 1 : 0);
        return sa - sb || a - b;
      }).map(function (c) {
        return {
          coord: c, isS: c === SC,
          label: c === SC ? 'S' : model.letters[c],
          coeff: id.alphaMap.get(c),
          valueStr: fmtNumber(known.get(c)),
          source: sourceMap.get(c) == null ? (labels.get(c) || '题设') : ('第' + sourceMap.get(c) + '步'),
          sourceIdx: sourceMap.get(c)
        };
      });

      // 展示顺序：S 在前，格子按序
      const termsOrdered = premises.slice().sort(function (a, b) {
        const sa = (a.isS ? 0 : 1), sb = (b.isS ? 0 : 1);
        return sa - sb || a.coord - b.coord;
      });
      const expansion = [{ label: k === SC ? 'S' : model.letters[k], coeff: id.gamma, coord: k, isK: true }]
        .concat(premises.filter(function (p) { return !p.isS; }).map(function (p) {
          return { label: p.label, coeff: -p.coeff, coord: p.coord, isK: false };
        }));
      const lambdaList = Array.from(id.lambdaMap).map(function (e) {
        return { lineIdx: e[0], coeff: e[1], name: model.lines[e[0]].name, cells: model.lines[e[0]].cells };
      }).sort(function (a, b) {
        let ma = a.coeff, mb = b.coeff;
        if (ma < 0) ma = -ma;
        if (mb < 0) mb = -mb;
        if (ma < mb) return -1;
        if (ma > mb) return 1;
        return a.lineIdx - b.lineIdx;
      });

      const involved = new Set();
      for (const L of lambdaList) for (const c of L.cells) involved.add(c);
      for (const p of premises) if (!p.isS) involved.add(p.coord);
      if (k !== SC) involved.add(k);

      known.set(k, value);
      knownEntries.push({ coord: k, source: stepIdx });
      sourceMap.set(k, stepIdx);
      pending.delete(k);
      newCoord = k;

      steps.push({
        i: stepIdx,
        target: k, isS: k === SC,
        label: k === SC ? 'S' : model.letters[k],
        cell: k === SC ? null : { r: Math.floor(k / model.n) + 1, c: k % model.n + 1 },
        value: value, valueStr: fmtNumber(value),
        d: Ceff.length,
        premises: premises,
        identity: {
            gamma: id.gamma, T: id.T, terms: termsOrdered, expansion: expansion, lambda: lambdaList,
            tech: id.tech,
            regions: id.tech >= 2 ? regionsToArrays(buildRegions(model, id.lambdaMap)) : null
          },
        theorem: thm, refStep: refStep,
        involvedCells: Array.from(involved),
        snapshot: knownEntries.map(function (e) { return { coord: e.coord, valueStr: fmtNumber(known.get(e.coord)), source: e.source }; })
      });
    }
    return { steps: steps, known: known, knownEntries: knownEntries, sourceMap: sourceMap };
  }

  /** 同步消费推导生成器 */
  function deduceSteps(model, givens, determinedSet, valueOf, opts) {
    const g = deduceStepsGen(model, givens, determinedSet, valueOf, opts);
    let last;
    while (true) { const r = g.next(); if (r.done) { last = r.value; break; } }
    return last;
  }


  function regionsToArrays(reg) {
    const red = [], blue = [];
    for (const e of reg.red) red.push({ cell: e[0], count: e[1] });
    for (const e of reg.blue) blue.push({ cell: e[0], count: e[1] });
    red.sort(function (a, b) { return a.cell - b.cell; });
    blue.sort(function (a, b) { return a.cell - b.cell; });
    return { red: red, blue: blue };
  }

  /* ---------------- 随机试解验证 ----------------
   * 从解空间随机取 12 个满足全部已知条件的填法，看哪些格子每次都相等；
   * 与线性判定交叉校验（两者必须一致）。确定性 LCG，保证可复现。 */
  function sampleCompletions(model, part, D, determined, givenMap) {
    if (givenMap.size === 0) return null;
    const N = model.N;
    if (D.length === 0) {
      const stable = [];
      for (let i = 0; i < N; i++) stable.push(i);
      return { count: 1, samples: [], stableCells: stable, agreeWithLinear: true, unique: true };
    }
    let seed = 20260611;
    const rnd = function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
    const K = 12;
    const grids = [];
    const stableFlags = new Array(N).fill(true);
    for (let t = 0; t < K; t++) {
      const cells = part.slice(0, N);
      for (let j = 0; j < D.length; j++) {
        let c = (rnd() % 7) - 3;
        if (c === 0 && rnd() % 2 === 0) c = 1;
        if (c === 0) continue;
        for (let i = 0; i < N; i++) cells[i] = cells[i].add(D[j][i].mul(new Frac(c)));
      }
      grids.push(cells.map(fmtNumber));
      for (let i = 0; i < N; i++) if (grids[t][i] !== grids[0][i]) stableFlags[i] = false;
    }
    let agree = true;
    const detSet = new Set(determined);
    for (let i = 0; i < N; i++) {
      if (detSet.has(i) !== stableFlags[i]) { agree = false; }
    }
    const stableCells = [];
    for (let i = 0; i < N; i++) if (stableFlags[i]) stableCells.push(i);
    return { count: K, samples: [grids[0], grids[1], grids[2]], stableCells: stableCells, agreeWithLinear: agree, unique: false };
  }

  /* ---------------- 有限值域：穷举求解（CSP） ----------------
   * multiset 中的数字恰好各用一次（classic / 自定义集合）。
   * 用“最少剩余 + 线剩余和剪枝”的回溯穷尽所有合法填法：
   *   - 穷尽完成：某格在所有解里取同一值 ⟺ 该格可确定（这就是“为什么能确定”的证明）
   *   - 达到上限未穷尽：只声称线性可确定的格子，并如实说明未穷尽
   */
  function solveCSP(model, givensAll, multiset, Sval, limits) {
    limits = limits || {};
    const N = model.N, SC = model.SC;
    const maxSolutions = limits.maxSolutions || 120;
    const maxNodes = limits.maxNodes || 160000;
    const maxMs = limits.maxMs || 900;

    const cnt = new Map();   // 值（字符串）→ 剩余个数
    const val = new Map();   // 值（字符串）→ Frac
    for (const v of multiset) { const k = v.toString(); cnt.set(k, (cnt.get(k) || 0) + 1); val.set(k, v); }

    const fixed = new Map();
    for (const e of givensAll) {
      if (e[0] === SC) continue;
      const k = e[1].toString();
      const c = cnt.get(k) || 0;
      if (c <= 0) return { error: '已知数 ' + fmtNumber(e[1]) + ' 不在限定的数字范围内（或超出份数）。' };
      cnt.set(k, c - 1);
      fixed.set(e[0], e[1]);
    }

    const assign = new Array(N).fill(null);
    const cellLines = [];
    for (let i = 0; i < N; i++) cellLines.push([]);
    model.lines.forEach(function (L, li) { for (let q = 0; q < L.cells.length; q++) cellLines[L.cells[q]].push(li); });

    const lineSum = new Array(model.lines.length).fill(F0);
    const lineLeft = model.lines.map(function (L) { return L.cells.length; });
    for (const e of fixed) {
      assign[e[0]] = e[1];
      for (const li of cellLines[e[0]]) { lineSum[li] = lineSum[li].add(e[1]); lineLeft[li] -= 1; }
    }

    const trail = [];
    function put(cell, v) {
      const k = v.toString();
      cnt.set(k, cnt.get(k) - 1);
      assign[cell] = v;
      trail.push(cell);
      for (const li of cellLines[cell]) { lineSum[li] = lineSum[li].add(v); lineLeft[li] -= 1; }
    }
    function take() {   // 撤销最近一次赋值（与 trail 同步弹出）
      const cell = trail.pop();
      const v = assign[cell];
      const k = v.toString();
      cnt.set(k, cnt.get(k) + 1);
      assign[cell] = null;
      for (const li of cellLines[cell]) { lineSum[li] = lineSum[li].sub(v); lineLeft[li] += 1; }
    }

    // 预排序 distinct 值（升序；近增值已在 buildDomain 拒绝，double 序 = 精确序）。
    // bounds 直接从两端按份数取值，O(D) 无排序——原实现每次全量展开+排序是节点扩展的主导开销。
    const dPairs = [];
    for (const e of cnt) dPairs.push({ k: e[0], v: val.get(e[0]) });
    dPairs.sort(function (a, b) { return a.v.toNumber() - b.v.toNumber(); });
    function bounds(k) {
      if (k <= 0) return [F0, F0];
      let rem = k, mn = F0;
      for (let i = 0; i < dPairs.length && rem > 0; i++) {
        const c = Math.min(rem, cnt.get(dPairs[i].k) || 0);
        if (c > 0) { mn = mn.add(dPairs[i].v.mul(new Frac(c))); rem -= c; }
      }
      if (rem > 0) return null;
      rem = k; let mx = F0;
      for (let i = dPairs.length - 1; i >= 0 && rem > 0; i--) {
        const c = Math.min(rem, cnt.get(dPairs[i].k) || 0);
        if (c > 0) { mx = mx.add(dPairs[i].v.mul(new Frac(c))); rem -= c; }
      }
      if (rem > 0) return null;
      return [mn, mx];
    }

    const queue = [];
    function propagate() {
      while (queue.length) {
        const li = queue.pop();
        if (lineLeft[li] === 0) {
          if (!lineSum[li].equals(Sval)) return false;
          continue;
        }
        const need = Sval.sub(lineSum[li]);
        const b = bounds(lineLeft[li]);
        if (!b) return false;
        if (need.toNumber() < b[0].toNumber() || need.toNumber() > b[1].toNumber()) return false;
        if (lineLeft[li] === 1) {
          let cell = -1;
          const cells = model.lines[li].cells;
          for (let q = 0; q < cells.length; q++) if (assign[cells[q]] === null) { cell = cells[q]; break; }
          if (cell < 0) return false;
          const k = need.toString();
          if (!(cnt.get(k) > 0)) return false;
          put(cell, need);
          for (const l2 of cellLines[cell]) queue.push(l2);
        }
      }
      return true;
    }

    const solutions = [];
    let nodes = 0, stop = false, exhaustive = true;
    const t0 = Date.now();

    function search() {
      if (stop) return;
      nodes++;
      if (nodes > maxNodes) { exhaustive = false; stop = true; return; }
      if ((nodes & 255) === 0 && Date.now() - t0 > maxMs) { exhaustive = false; stop = true; return; }
      if (trail.length === N - fixed.size) {
        solutions.push(assign.map(fmtNumber));
        if (solutions.length >= maxSolutions) { exhaustive = false; stop = true; }
        return;
      }
      // 选线：剩余待填最少且 > 1 的线；再选该线上关联线最多的格子
      let bestLine = -1;
      for (let li = 0; li < model.lines.length; li++) {
        if (lineLeft[li] <= 1) continue;
        if (bestLine < 0 || lineLeft[li] < lineLeft[bestLine]) bestLine = li;
      }
      let cell = -1;
      if (bestLine >= 0) {
        const cells = model.lines[bestLine].cells;
        for (let q = 0; q < cells.length; q++) {
          const c = cells[q];
          if (assign[c] !== null) continue;
          if (cell < 0 || cellLines[c].length > cellLines[cell].length) cell = c;
        }
      }
      if (cell < 0) { exhaustive = false; stop = true; return; }

      const cands = [];
      for (let i = 0; i < dPairs.length; i++) {
        if ((cnt.get(dPairs[i].k) || 0) > 0) cands.push(dPairs[i].v);
      }

      for (const v of cands) {
        const mark = trail.length;
        put(cell, v);
        for (const li of cellLines[cell]) queue.push(li);
        if (propagate()) search();
        while (trail.length > mark) take();
        if (stop) return;
      }
    }

    for (let li = 0; li < model.lines.length; li++) queue.push(li);
    if (!propagate()) return { error: '在限定数字与已知数下无解（线和对不上或数字不够用）。' };
    search();

    if (exhaustive && solutions.length === 0) {
      return { error: '在限定的数字范围与已知数下无解（穷举完所有填法都不满足条件）。' };
    }
    const refuted = new Set();
    const stable = new Set();
    if (solutions.length > 0) {
      for (let i = 0; i < N; i++) {
        let same = true;
        for (let t = 1; t < solutions.length; t++) if (solutions[t][i] !== solutions[0][i]) { same = false; break; }
        if (same) stable.add(i); else refuted.add(i);
      }
    }
    const stableCells = [];
    for (let i = 0; i < N; i++) if (stable.has(i)) stableCells.push(i);
    return {
      ok: true, error: null,
      exhaustive: exhaustive, count: solutions.length,
      samples: solutions.slice(0, 3),
      stableCells: stableCells,
      refutedCells: Array.from(refuted),
      allSolutionsFirst: solutions.length ? solutions[0] : null,
      nodes: nodes
    };
  }

  /* ---------------- 仅整数：整数性检查与整数解见证 ----------------
   * 精确判定思路：解 x = part + D·t。整数的成立只取决于 t 模 L（L = part 与 D 所有分母的最小公倍数），
   * 因此枚举 t ∈ [0,L)^m 即可判定是否存在整数解；找到的解同时作为“整数填法见证”，
   * 由整数方向 L·D[j] 平移得到的仍然是整数解（用于多解示例）。
   */
  function checkIntegerSolutions(prep) {
    const model = prep.model, part = prep.part, D = prep.D, determined = prep.determined;
    const N = model.N;
    const isInt = function (f) { return f.d === 1; };
    const bad = [];
    for (const c of determined) if (!isInt(part[c])) bad.push(c);
    if (bad.length) {
      const names = bad.map(function (c) { return c === model.SC ? 'S' : model.letters[c]; });
      return {
        feasible: false,
        reason: '在“只允许整数”的限定下无解：' + names.join('、') + ' 只能取到分数（' +
          bad.map(function (c) { return fmtNumber(part[c]); }).join('、') + '）。'
      };
    }
    const m = D.length;
    // 公共分母 L
    let L = 1;
    const lcm = function (a, b) { return a / gcd(a, b) * b; };
    for (let i = 0; i <= N; i++) L = lcm(L, part[i].d);
    for (let j = 0; j < m; j++) for (let i = 0; i <= N; i++) L = lcm(L, D[j][i].d);

    // 整数方向（乘 L 后各分量都是整数）
    const intDirs = [];
    for (let j = 0; j < m; j++) {
      const v = new Array(N + 1);
      for (let i = 0; i <= N; i++) v[i] = D[j][i].mul(new Frac(L));
      intDirs.push(v);
    }

    let found = null;
    let exact = true;   // 是否精确穷尽（false = 只做了随机尝试，结论只能“未找到”，不能“无解”）
    if (m === 0) {
      if (part.every(isInt)) found = part.slice(0, N + 1);
    } else if (Math.pow(L, m) <= 300000) {
      // 精确：枚举 t ∈ [0,L)^m（带时间护栏：超时退化为“未找到”，不误称无解）
      const t = new Array(m).fill(0);
      const tF = new Array(m).fill(F1);   // t[j] 的 Frac 缓存，避免最内层重复分配
      let done = false;
      const t0 = Date.now();
      while (!done) {
        if (Date.now() - t0 > 1000) { exact = false; break; }
        const x = part.slice(0, N + 1);
        for (let j = 0; j < m; j++) {
          if (!t[j]) continue;
          const dj = D[j], tf = tF[j];
          for (let i = 0; i <= N; i++) x[i] = x[i].add(dj[i].mul(tf));
        }
        if (x.every(isInt)) { found = x; break; }
        let j = 0;
        while (j < m) { t[j]++; if (t[j] < L) break; t[j] = 0; j++; }
        if (j === m) done = true;
        for (j = 0; j < m; j++) tF[j] = new Frac(t[j]);
      }
    } else {
      // 规模过大：随机取样（只允许得出“未找到”，不得声称无解）
      exact = false;
      let seed = 7717;
      const rnd = function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
      for (let q = 0; q < 5000 && !found; q++) {
        const x = part.slice(0, N + 1);
        for (let j = 0; j < m; j++) {
          const k = (rnd() % (2 * L + 1)) - L;
          if (!k) continue;
          for (let i = 0; i <= N; i++) x[i] = x[i].add(D[j][i].mul(new Frac(k)));
        }
        if (x.every(isInt)) found = x;
      }
    }
    if (!found) {
      if (!exact) {
        return {
          feasible: null,
          reason: '在“只允许整数”的限定下未能找到整数填法：规模过大（L = ' + L + '，自由参数 ' + m +
            ' 个），未能在时限内完成穷尽检查（只做了部分枚举/有限次随机尝试）——这不构成“无解”的证明，仅供参考。',
          witness: null
        };
      }
      return {
        feasible: false,
        reason: '在“只允许整数”的限定下无解：已经按周期性穷尽检查（L = ' + L + '，自由参数 ' + m + ' 个），' +
          '不存在每个格子都是整数的填法。'
      };
    }
    return {
      feasible: true,
      witness: found.slice(0, N).map(fmtNumber),
      witnessCells: found.slice(0, N + 1),
      intDirs: intDirs,
      S: fmtNumber(found[N]),
      reason: null
    };
  }

  /* ---------------- 值域限定 ----------------
   * kind: 'none' | 'integer' | 'classic'（1…n² 各用一次）| 'set'（自定义 n² 个数各用一次）
   */
  function buildDomain(n, spec, givenMap) {
    const N = n * n, SC = N;   // 只需 N/SC，不重复构建完整模型（basis/u 白跑一遍）
    const kind = (spec && spec.kind) || 'none';
    const out = { kind: kind, S: null, multiset: null, distinct: false, labels: new Map(), note: null, total: null };
    if (kind === 'classic') {
      const vals = [];
      for (let v = 1; v <= N; v++) vals.push(new Frac(v));
      out.multiset = vals; out.distinct = true;
      let total = new Frac(0);
      for (const v of vals) total = total.add(v);
      out.total = total;
      out.S = total.div(new Frac(n));
      out.labels.set(SC, '题设（1…' + N + ' 各用一次的幻和）');
      out.note = '1…' + N + ' 各用一次';
    } else if (kind === 'set') {
      const vals = (spec.values || []).map(function (x) { return Frac.from(x); });
      if (vals.length !== N) {
        return { error: '“限定填入数字”需要恰好 n² = ' + N + ' 个数（每个用一次），当前提供了 ' + vals.length + ' 个。' };
      }
      out.multiset = vals; out.distinct = true;
      let total = new Frac(0);
      for (const v of vals) total = total.add(v);
      out.total = total;
      out.S = total.div(new Frac(n));
      out.labels.set(SC, '题设（限定数字之和 ÷ ' + n + '）');
      out.note = '限定数字各用一次';
    } else if (kind === 'integer') {
      out.note = '只允许整数';
    }
    // 有限值域（classic/set）：所有已知数必须在限定数字内且不超份数（对任意阶数生效，
    // n≥5 不跑穷举时也要在此拦下，不能等 CSP 才发现）
    if (out.multiset) {
      const cnt = new Map();
      for (const v of out.multiset) { const k = v.toString(); cnt.set(k, (cnt.get(k) || 0) + 1); }
      for (const e of givenMap) {
        if (e[0] === SC) continue;
        const k = e[1].toString();
        const c = cnt.get(k) || 0;
        if (c <= 0) return { error: '已知数 ' + fmtNumber(e[1]) + ' 不在限定的数字范围内（或超出份数）。' };
        cnt.set(k, c - 1);
      }
      // 近增值检测：两个**不同**的数转 double 后相同（分母 >2^26 量级的近分数）会让
      // 穷举剪枝的排序与上下界不可靠（可能误剪掉真实解）——宁可明确拒绝
      const vs = out.multiset.slice().sort(function (a, b) { return a.toNumber() - b.toNumber(); });
      for (let i = 1; i < vs.length; i++) {
        if (vs[i].toNumber() === vs[i - 1].toNumber() && !vs[i].equals(vs[i - 1]))
          return { error: '限定数字中存在过近的两个不同值（' + fmtNumber(vs[i - 1]) + ' 与 ' + fmtNumber(vs[i]) +
            '），超出安全穷举精度，请调整数字。' };
      }
    }
    return out;
  }

  /* ---------------- 对外主接口 ---------------- */
  function prepareSolve(n, givenMap, domainInfo) {
    const model = buildModel(n);
    const N = model.N, SC = model.SC;
    const givensAll = new Map(givenMap);
    if (domainInfo && domainInfo.S) {
      // 调用方显式给了 S 且与值域推出的不一致 → 矛盾（而不是静默覆盖）
      if (givensAll.has(SC) && !givensAll.get(SC).equals(domainInfo.S))
        return { error: '已知数中的幻和 S = ' + fmtNumber(givensAll.get(SC)) + ' 与值域限定推出的 S = ' +
          fmtNumber(domainInfo.S) + ' 不一致（互相矛盾）。' };
      givensAll.set(SC, domainInfo.S);
    }

    const rows = model.lineRows.map(function (r) { const s = r.slice(); s.push(F0); return s; });
    for (const e of givensAll) {
      const r = new Array(N + 1).fill(F0); r[e[0]] = F1; r.push(e[1]);
      rows.push(r);
    }
    const part = solveAug(rows, N + 1);
    if (part === null) {
      return { error: '已知数之间互相矛盾：不存在同时让所有行、列、对角线之和相等的填法。请检查输入的数字。' };
    }
    const drows = model.lineRows.map(function (r) { return r.slice(); });
    for (const c of givensAll.keys()) { const r = new Array(N + 1).fill(F0); r[c] = F1; drows.push(r); }
    const D = nullSpaceRows(drows, N + 1);
    const determined = [];
    for (let c = 0; c <= N; c++) if (D.every(function (d) { return d[c].isZero(); })) determined.push(c);
    const valueOf = new Map(determined.map(function (c) { return [c, part[c]]; }));
    return { model: model, part: part, D: D, determined: determined, valueOf: valueOf, givensAll: givensAll };
  }

  function assembleResult(n, givenMap, prep, ded, opts) {
    const model = prep.model, N = model.N, SC = model.SC;
    const D = prep.D, determined = prep.determined, part = prep.part;
    const domainInfo = (opts && opts.domainInfo) || null;
    const csp = (opts && opts.csp) || null;
    const integerInfo = (opts && opts.integerInfo) || null;

    const known = ded.known;

    // 由值域限定直接得到的幻和（第 1 步，无前提）
    const steps = [];
    const knownEntries = ded.knownEntries.slice();
    if (domainInfo && domainInfo.S) {
      steps.push({
        i: 1, special: 'domain-S', isS: true, label: 'S', cell: null, target: SC,
        value: domainInfo.S, valueStr: fmtNumber(domainInfo.S),
        d: 0, premises: [], identity: null, theorem: null, refStep: null,
        domainKind: domainInfo.kind, domainNote: domainInfo.note,
        totalStr: domainInfo.total ? fmtNumber(domainInfo.total) : null,
        involvedCells: Array.from({ length: N }, function (_, i) { return i; }),
        snapshot: knownEntries.map(function (e) { return { coord: e.coord, valueStr: fmtNumber(known.get(e.coord)), source: e.source }; })
      });
    }
    for (const st of ded.steps) steps.push(st);

    // 有限值域穷举带来的额外可定格（线性无法证明、但穷尽搜索可证明）
    let extraDetermined = [];
    if (csp && csp.ok && csp.exhaustive && csp.allSolutionsFirst) {
      const extras = [];
      for (const c of csp.stableCells) { if (!known.has(c)) extras.push(c); }
      if (extras.length > 0) {
        const stepIdx = steps.length + 1;
        for (const c of extras) {
          known.set(c, parseNumberString(csp.allSolutionsFirst[c]));
          knownEntries.push({ coord: c, source: stepIdx });
        }
        steps.push({
          i: stepIdx, special: 'csp', isS: false, label: '穷举', cell: null, target: null,
          valueStr: null, d: 0, premises: [], identity: null, theorem: null, refStep: null,
          involvedCells: extras.slice(),
          cspInfo: {
            exhaustive: true, count: csp.count,
            extras: extras.map(function (c) { return { coord: c, label: model.letters[c], valueStr: csp.allSolutionsFirst[c] }; }),
            samples: csp.samples
          },
          snapshot: knownEntries.map(function (e) { return { coord: e.coord, valueStr: fmtNumber(known.get(e.coord)), source: e.source }; })
        });
        extraDetermined = extras;
      }
    }

    const finalCells = new Array(N).fill(null);
    for (const e of knownEntries) if (e.coord !== SC) finalCells[e.coord] = { valueStr: fmtNumber(known.get(e.coord)), source: e.source };

    const complete = finalCells.every(function (c) { return c !== null; });
    const undeterminedCells = [];
    for (let c = 0; c < N; c++) if (!known.has(c)) undeterminedCells.push(c);

    // 多组填法与随机试解——必须与值域一致：
    //  - classic/set（每个数恰好用一次）：示例只能来自穷举得到的合法填法；
    //    n≥5 不穷举时宁可不给示例，也不能用有理方向构造（那会违反值域、出现分数）；
    //  - integer：整数见证 + 整数方向平移（全整数）；
    //  - none：有理特解 + 零空间方向（任意有理数都合法）。
    const domKind = domainInfo ? domainInfo.kind : 'none';
    const isDistinct = !!(domainInfo && domainInfo.distinct);
    const isIntegerMode = domKind === 'integer';
    let sampling = null;
    let examples = null;
    if (isDistinct) {
      if (csp && csp.ok && csp.samples && csp.samples.length > 1 && !complete) {
        examples = csp.samples.slice(0, 2).map(function (cells) {
          return { cells: cells.slice(), S: domainInfo.S ? fmtNumber(domainInfo.S) : null };
        });
      }
    } else if (isIntegerMode && integerInfo && integerInfo.feasible === true) {
      const w = integerInfo.witnessCells;
      const dirs = integerInfo.intDirs || [];
      const pickDir = dirs.find(function (dv) {
        return undeterminedCells.some(function (c) { return !dv[c].isZero(); });
      });
      if (pickDir) {
        const sampleObjs = [-2, -1, 0, 1, 2].map(function (k) {
          const cells = w.slice(0, N).map(function (f, i) { return fmtNumber(f.add(pickDir[i].mul(new Frac(k)))); });
          return cells;
        });
        const varying = new Set();
        for (let i = 0; i < N; i++) {
          for (let q = 1; q < sampleObjs.length; q++) {
            if (sampleObjs[q][i] !== sampleObjs[0][i]) { varying.add(i); break; }
          }
        }
        sampling = {
          count: sampleObjs.length, samples: sampleObjs.slice(0, 3),
          stableCells: [], varyingCells: Array.from(varying),
          agreeWithLinear: null, unique: false, illustrative: true, integer: true
        };
        if (!complete && givenMap.size > 0) {
          // 每组示例标注**它自己**的幻和（沿整数方向平移时 S 会变，不能统一写 w 的 S）
          const sOf = function (k) { return fmtNumber(w[N].add(pickDir[N].mul(new Frac(k)))); };
          examples = [
            { cells: sampleObjs[1].slice(), S: sOf(-1) },   // k = -1
            { cells: sampleObjs[2].slice(), S: sOf(0) }     // k = 0
          ];
        }
      }
    }
    if (!sampling && !isDistinct && domKind !== 'integer') sampling = sampleCompletions(model, part, D, determined, givenMap);
    if (!examples && !isDistinct && domKind !== 'integer' && !complete && D.length > 0 && givenMap.size > 0) {
      let dir = D.find(function (d) { return undeterminedCells.some(function (c) { return !d[c].isZero(); }); });
      if (!dir) dir = D.reduce(function (a, b) { return a.map(function (x, i) { return x.add(b[i]); }); });
      examples = [part, part.map(function (x, i) { return x.add(dir[i]); })].map(function (p) {
        return { cells: p.slice(0, N).map(function (f) { return fmtNumber(f); }), S: fmtNumber(p[N]) };
      });
    }

    let verification = null;
    const Sval = known.has(SC) ? known.get(SC) : null;
    if (complete && Sval !== null) {
      verification = {
        S: fmtNumber(Sval),
        rows: model.lines.map(function (L) {
          let sum = new Frac(0);
          const strs = [];
          for (const c of L.cells) { sum = sum.add(known.get(c)); strs.push(fmtNumber(known.get(c))); }
          return { name: L.name, terms: strs.join(' + '), sum: fmtNumber(sum), ok: sum.equals(Sval) };
        })
      };
    }

    const givenList = Array.from(givenMap).map(function (e) {
      return { coord: e[0], label: model.letters[e[0]], valueStr: fmtNumber(e[1]), r: Math.floor(e[0] / n) + 1, c: e[0] % n + 1 };
    }).sort(function (a, b) { return a.coord - b.coord; });

    return {
      ok: true,
      n: n, N: N,
      model: {
        n: n, N: N, SC: SC, m: model.m, letters: model.letters,
        lines: model.lines.map(function (L) { return { name: L.name, cells: L.cells }; })
      },
      givens: givenList,
      steps: steps,
      knownEntries: knownEntries,
      finalCells: finalCells,
      S: Sval === null ? null : { valueStr: fmtNumber(Sval), source: (ded.sourceMap.get(SC) == null ? null : ded.sourceMap.get(SC)) },
      complete: complete,
      dimFree: D.length,
      undeterminedCells: undeterminedCells,
      determinedCount: determined.length,
      examples: examples,
      sampling: sampling,
      verification: verification,
      domain: domainInfo ? {
        kind: domainInfo.kind, note: domainInfo.note,
        S: domainInfo.S ? fmtNumber(domainInfo.S) : null,
        total: domainInfo.total ? fmtNumber(domainInfo.total) : null
      } : null,
      csp: csp ? {
        ok: csp.ok, error: csp.error, exhaustive: csp.exhaustive, count: csp.count,
        samples: csp.samples, stableCells: csp.stableCells, refutedCells: csp.refutedCells,
        extras: extraDetermined
      } : null,
      integer: integerInfo,
      error: null
    };
  }

  /**
   * solveMagic(n, givenMap, opts)
   *   opts.domain = { kind:'none'|'integer'|'classic'|'set', values:[Frac] }
   * 同步求解；返回 {ok:false, error} 或完整求解结果（含分步证明数据）。
   */
  function solveMagic(n, givenMap, opts) {
    opts = opts || {};
    const domainInfo = buildDomain(n, opts.domain, givenMap);
    if (domainInfo.error) return { ok: false, n: n, error: domainInfo.error };

    const prep = prepareSolve(n, givenMap, domainInfo);
    if (prep.error) return { ok: false, n: n, error: prep.error };

    let csp = null;
    if (domainInfo.distinct) {
      // n≥5 的穷举规模过大（5 阶全解数量极多），只做线性推导；3、4 阶可穷尽
      if (n <= 4) {
        const lim = opts.cspLimits || (n <= 3
          ? { maxSolutions: 200, maxNodes: 160000, maxMs: 900 }
          : { maxSolutions: 1000, maxNodes: 400000, maxMs: 1500 });
        try {
          csp = solveCSP(prep.model, prep.givensAll, domainInfo.multiset, domainInfo.S, lim);
        } catch (e) {
          return { ok: false, n: n, error: '限定数字过大，超出精确穷举范围：' + e.message };
        }
        if (csp.error) return { ok: false, n: n, error: csp.error };
      }
    }
    let integerInfo = null;
    if (domainInfo.kind === 'integer') {
      try {
        integerInfo = checkIntegerSolutions(prep);
      } catch (e) {
        return { ok: false, n: n, error: '数字过大，超出整数性精确检查范围：' + e.message };
      }
      if (integerInfo.feasible === false) return { ok: false, n: n, error: integerInfo.reason };
    }

    const ded = deduceSteps(prep.model, prep.givensAll, new Set(prep.determined), prep.valueOf, {
      baseIndex: domainInfo.S ? 2 : 1,
      labels: domainInfo.labels
    });
    return assembleResult(n, givenMap, prep, ded, { domainInfo: domainInfo, csp: csp, integerInfo: integerInfo });
  }

  /**
   * solveMagicAsync(n, givenMap, opts) —— 协作式异步求解（页面默认走此路径）。
   * 各阶段之间、以及推导循环中每连续工作 budgetMs（默认 12ms）就让出主线程一次。
   */
  function sleep0() { return new Promise(function (rs) { setTimeout(rs, 0); }); }
  async function solveMagicAsync(n, givenMap, opts) {
    opts = opts || {};
    const budget = opts.budgetMs || 12;
    const onProgress = opts.onProgress || null;

    const domainInfo = buildDomain(n, opts.domain, givenMap);
    if (domainInfo.error) return { ok: false, n: n, error: domainInfo.error };
    await sleep0();

    const prep = prepareSolve(n, givenMap, domainInfo);
    if (prep.error) return { ok: false, n: n, error: prep.error };
    await sleep0();

    let csp = null;
    if (domainInfo.distinct && n <= 4) {
      if (onProgress) { try { onProgress({ phase: 'csp' }); } catch (e) { } }
      await sleep0();
      const lim = opts.cspLimits || (n <= 3
        ? { maxSolutions: 200, maxNodes: 160000, maxMs: 900 }
        : { maxSolutions: 1000, maxNodes: 400000, maxMs: 1500 });
      try {
        csp = solveCSP(prep.model, prep.givensAll, domainInfo.multiset, domainInfo.S, lim);
      } catch (e) {
        return { ok: false, n: n, error: '限定数字过大，超出精确穷举范围：' + e.message };
      }
      if (csp.error) return { ok: false, n: n, error: csp.error };
      await sleep0();
    }
    let integerInfo = null;
    if (domainInfo.kind === 'integer') {
      try {
        integerInfo = checkIntegerSolutions(prep);
      } catch (e) {
        return { ok: false, n: n, error: '数字过大，超出整数性精确检查范围：' + e.message };
      }
      if (integerInfo.feasible === false) return { ok: false, n: n, error: integerInfo.reason };
      await sleep0();
    }

    const gen = deduceStepsGen(prep.model, prep.givensAll, new Set(prep.determined), prep.valueOf, {
      baseIndex: domainInfo.S ? 2 : 1,
      labels: domainInfo.labels
    });
    let ded = null;
    let t0 = Date.now();
    while (true) {
      const r = gen.next();
      if (r.done) { ded = r.value; break; }
      if (Date.now() - t0 >= budget) {
        if (onProgress) { try { onProgress(r.value); } catch (e) { } }
        await sleep0();
        t0 = Date.now();
      }
    }
    return assembleResult(n, givenMap, prep, ded, { domainInfo: domainInfo, csp: csp, integerInfo: integerInfo });
  }

  /** 供随机出题：给定坐标集合（不看数值），返回可确定的坐标集合 */
  function determinedSetForCoords(model, coords) {
    const drows = model.lineRows.map(function (r) { return r.slice(); });
    for (const c of coords) { const r = new Array(model.N + 1).fill(F0); r[c] = F1; drows.push(r); }
    const D = nullSpaceRows(drows, model.N + 1);
    const out = [];
    for (let c = 0; c <= model.N; c++) if (D.every(function (d) { return d[c].isZero(); })) out.push(c);
    return out;
  }

  return {
    Frac: Frac,
    parseNumberString: parseNumberString,
    fmtNumber: fmtNumber,
    exactDecimal: exactDecimal,
    buildModel: buildModel,
    solveMagic: solveMagic,
    solveMagicAsync: solveMagicAsync,
    determinedSetForCoords: determinedSetForCoords,
    solveIdentity: solveIdentity
  };
});
