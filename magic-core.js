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
    add(b) { b = Frac.from(b); return new Frac(this.n * b.d + b.n * this.d, this.d * b.d); }
    sub(b) { b = Frac.from(b); return new Frac(this.n * b.d - b.n * this.d, this.d * b.d); }
    mul(b) { b = Frac.from(b); return new Frac(this.n * b.n, this.d * b.d); }
    div(b) { b = Frac.from(b); if (b.n === 0) throw new Error('除以 0'); return new Frac(this.n * b.d, this.d * b.n); }
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

  /** 若能写成有限小数则返回其字符串，否则 null */
  function exactDecimal(f) {
    let d = f.d, c2 = 0, c5 = 0;
    while (d % 2 === 0) { d /= 2; c2++; }
    while (d % 5 === 0) { d /= 5; c5++; }
    if (d !== 1) return null;
    let k = c2;
    if (c5 > k) k = c5;
    let s = String(f.n * Math.pow(10, k) / f.d);
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
      if (k === model.center && hasS && cells.length === 0 && alphaMap.get(SC) === ng)
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
  function sourceLabel(srcIdx) { return srcIdx == null ? '题设' : '第' + srcIdx + '步'; }

  function scoreLess(a, b) {
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; }
    return false;
  }

  function* deduceStepsGen(model, givens, determinedSet, valueOf) {
    const SC = model.SC;
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

      // 第一轮筛选：找出“最少已知数”的目标（并列收集，S 仅在严格更少时入选）
      let bestD = Infinity;
      let tied = [];
      for (const t of targets) {
        const prev = prevState.get(t) || null;
        const st = findMinimal(model, t, Array.from(known.keys()), prev, newCoord);
        if (st === null) throw new Error('内部错误：目标无法推导');
        prevState.set(t, st);
        if (st.d < bestD) {
          bestD = st.d; tied = [{ target: t, st: st }];
        } else if (st.d === bestD && t !== SC) {
          if (tied.length < 6) tied.push({ target: t, st: st });
        }
      }

      // 第二轮筛选：并列目标中挑证明最简洁的（优先已命名定理 → 用线更少 → 系数更小 → 行序在前）
      let chosen = null, chosenTarget = null;
      for (const tie of tied) {
        for (const C of tie.st.Cs.slice(0, 4)) {
          const id = solveIdentity(model, tie.target, C);
          if (id === null) continue;
          const thm = recognizeTheorem(model, tie.target, C, id.alphaMap, id.gamma);
          let lamSum = 0;
          const lamVals = Array.from(id.lambdaMap.values());
          for (let q = 0; q < lamVals.length; q++) {
            const v = lamVals[q];
            if (v < 0) { lamSum = lamSum - v; } else { lamSum = lamSum + v; }
          }
          const tech = techniqueClass(id.lambdaMap);   // 技巧分级：1幻和直用 2两线去交叉 3多线容斥 4一般
          const score = [
            tech,
            thm ? (THEOREM_RANK[thm.key] !== undefined ? THEOREM_RANK[thm.key] : 9) : 9,
            id.lambdaMap.size, lamSum,
            tie.target === SC ? 1 : 0, tie.target
          ];
          if (chosen === null || scoreLess(score, chosen.score)) {
            chosen = { C: C, id: id, thm: thm, score: score };
            chosen.id.tech = tech;
            chosenTarget = tie.target;
          }
        }
      }
      if (chosen === null) throw new Error('内部错误：恒等式求解失败');

      const id = chosen.id, k = chosenTarget;
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
      if (refStep === null) firstProof.set(key, steps.length + 1);

      const stepIdx = steps.length + 1;
      const premises = Ceff.slice().sort(function (a, b) {
        const sa = (a === SC ? 1 : 0), sb = (b === SC ? 1 : 0);
        return sa - sb || a - b;
      }).map(function (c) {
        return {
          coord: c, isS: c === SC,
          label: c === SC ? 'S' : model.letters[c],
          coeff: id.alphaMap.get(c),
          valueStr: fmtNumber(known.get(c)),
          source: sourceLabel(sourceMap.get(c)),
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
            regions: id.tech === 2 || id.tech === 3 ? regionsToArrays(buildRegions(model, id.lambdaMap)) : null
          },
        theorem: thm, refStep: refStep,
        involvedCells: Array.from(involved),
        snapshot: knownEntries.map(function (e) { return { coord: e.coord, valueStr: fmtNumber(known.get(e.coord)), source: e.source }; })
      });
    }
    return { steps: steps, known: known, knownEntries: knownEntries, sourceMap: sourceMap };
  }

  /** 同步消费推导生成器 */
  function deduceSteps(model, givens, determinedSet, valueOf) {
    const g = deduceStepsGen(model, givens, determinedSet, valueOf);
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

  /* ---------------- 对外主接口 ---------------- */
  function prepareSolve(n, givenMap) {
    const model = buildModel(n);
    const N = model.N, SC = model.SC;
    const rows = model.lineRows.map(function (r) { const s = r.slice(); s.push(F0); return s; });
    for (const e of givenMap) {
      const r = new Array(N + 1).fill(F0); r[e[0]] = F1; r.push(e[1]);
      rows.push(r);
    }
    const part = solveAug(rows, N + 1);
    if (part === null) {
      return { error: '已知数之间互相矛盾：不存在同时让所有行、列、对角线之和相等的填法。请检查输入的数字。' };
    }
    const drows = model.lineRows.map(function (r) { return r.slice(); });
    for (const c of givenMap.keys()) { const r = new Array(N + 1).fill(F0); r[c] = F1; drows.push(r); }
    const D = nullSpaceRows(drows, N + 1);
    const determined = [];
    for (let c = 0; c <= N; c++) if (D.every(function (d) { return d[c].isZero(); })) determined.push(c);
    const valueOf = new Map(determined.map(function (c) { return [c, part[c]]; }));
    return { model: model, part: part, D: D, determined: determined, valueOf: valueOf };
  }

  function assembleResult(n, givenMap, prep, ded) {
    const model = prep.model, N = model.N, SC = model.SC;
    const D = prep.D, determined = prep.determined, part = prep.part;
    const known = ded.known;

    const complete = determined.filter(function (c) { return c !== SC; }).length === N;
    const sampling = sampleCompletions(model, part, D, determined, givenMap);
    const undeterminedCells = [];
    for (let c = 0; c < N; c++) if (!known.has(c)) undeterminedCells.push(c);

    // 未定时的两个反例填法
    let examples = null;
    if (!complete && D.length > 0 && givenMap.size > 0) {
      let dir = D.find(function (d) { return undeterminedCells.some(function (c) { return !d[c].isZero(); }); });
      if (!dir) dir = D.reduce(function (a, b) { return a.map(function (x, i) { return x.add(b[i]); }); });
      examples = [part, part.map(function (x, i) { return x.add(dir[i]); })].map(function (p) {
        return { cells: p.slice(0, N).map(function (f) { return fmtNumber(f); }), S: fmtNumber(p[N]) };
      });
    }

    // 完整时的验证表
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

    const finalCells = new Array(N).fill(null);
    for (const e of ded.knownEntries) if (e.coord !== SC) finalCells[e.coord] = { valueStr: fmtNumber(known.get(e.coord)), source: e.source };

    const givenList = Array.from(givenMap).map(function (e) {
      return { coord: e[0], label: model.letters[e[0]], valueStr: fmtNumber(e[1]), r: Math.floor(e[0] / n) + 1, c: e[0] % n + 1 };
    }).sort(function (a, b) { return a.coord - b.coord; });

    return {
      ok: true,
      n: n, N: N,
      model: { n: n, N: N, SC: SC, m: model.m, letters: model.letters, lines: model.lines.map(function (L) { return { name: L.name, cells: L.cells }; }) },
      givens: givenList,
      steps: ded.steps,
      knownEntries: ded.knownEntries,
      finalCells: finalCells,
      S: Sval === null ? null : { valueStr: fmtNumber(Sval), source: (ded.sourceMap.get(SC) == null ? null : ded.sourceMap.get(SC)) },
      complete: complete,
      dimFree: D.length,
      undeterminedCells: undeterminedCells,
      determinedCount: determined.length,
      examples: examples,
      sampling: sampling,
      verification: verification,
      error: null
    };
  }

  /**
   * solveMagic(n, givenMap)  givenMap: Map<格子下标 0..n²-1, Frac>
   * 同步求解；返回 {ok:false, error} 或完整求解结果（含分步证明数据）。
   */
  function solveMagic(n, givenMap) {
    const prep = prepareSolve(n, givenMap);
    if (prep.error) return { ok: false, n: n, error: prep.error };
    const ded = deduceSteps(prep.model, givenMap, new Set(prep.determined), prep.valueOf);
    return assembleResult(n, givenMap, prep, ded);
  }

  /**
   * solveMagicAsync(n, givenMap, opts) —— 协作式异步求解（默认走此路径）。
   * 各阶段之间、以及推导循环中每连续工作 budgetMs（默认 12ms）就让出主线程一次，
   * 保证页面始终响应。onProgress({pending}) 可用于进度提示。
   */
  function sleep0() { return new Promise(function (rs) { setTimeout(rs, 0); }); }
  async function solveMagicAsync(n, givenMap, opts) {
    opts = opts || {};
    const budget = opts.budgetMs || 12;
    const onProgress = opts.onProgress || null;

    const model = buildModel(n);
    const N = model.N, SC = model.SC;
    await sleep0();

    const rows = model.lineRows.map(function (r) { const s = r.slice(); s.push(F0); return s; });
    for (const e of givenMap) {
      const r = new Array(N + 1).fill(F0); r[e[0]] = F1; r.push(e[1]);
      rows.push(r);
    }
    const part = solveAug(rows, N + 1);
    if (part === null) {
      return { ok: false, n: n, error: '已知数之间互相矛盾：不存在同时让所有行、列、对角线之和相等的填法。请检查输入的数字。' };
    }
    await sleep0();

    const drows = model.lineRows.map(function (r) { return r.slice(); });
    for (const c of givenMap.keys()) { const r = new Array(N + 1).fill(F0); r[c] = F1; drows.push(r); }
    const D = nullSpaceRows(drows, N + 1);
    const determined = [];
    for (let c = 0; c <= N; c++) if (D.every(function (d) { return d[c].isZero(); })) determined.push(c);
    const valueOf = new Map(determined.map(function (c) { return [c, part[c]]; }));
    await sleep0();

    const prep = { model: model, part: part, D: D, determined: determined, valueOf: valueOf };
    const gen = deduceStepsGen(model, givenMap, new Set(determined), valueOf);
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
    const result = assembleResult(n, givenMap, prep, ded);
    return result;
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
