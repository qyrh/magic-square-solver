/* verify-all.js —— 全阶数(3–8) × 全模式(none/integer/classic/set) 穷尽验证
 * 用法：在本目录执行 node verify-all.js
 * 检查项（对应本轮验收 3.2 节）：
 *   1  不抛异常；2 结构完整；3 步号对齐与前提引用；4 数值正确（完整解线和全 = S）；
 *   5 填格完整（缺口 0）；6 模式语义（integer/classic/set/矛盾/超范围）；
 *   7 单例求解 ≤ 2s；8 DOCX 生成 + Python zip/XML 校验；9 证明文字合规（禁负系数措辞）。
 * 退出码：全过 0，否则 1。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const Core = require('./magic-core.js');
const Frac = Core.Frac;
const Render = require('./render.js');
const Docx = require('./docx.js');

const MODES = ['none', 'integer', 'classic', 'set'];
const NS = [3, 4, 5, 6, 7, 8];
const FORBIDDEN = ['带正号', '带负号', '按系数加权', '系数用于加权'];
const TIME_LIMIT_MS = 2000;

/* DOCX 输出路径：全部为字面量（无动态拼接） */
const DOCX_FILES = {
  3: 'verify-docx/verify-n3.docx',
  4: 'verify-docx/verify-n4.docx',
  5: 'verify-docx/verify-n5.docx',
  6: 'verify-docx/verify-n6.docx',
  7: 'verify-docx/verify-n7.docx',
  8: 'verify-docx/verify-n8.docx'
};
const CHECKER = path.join(__dirname, 'verify_docx_check.py');

/* ---------------- 真实幻方（恰为 1..n²） ---------------- */
function siamese(n) { // 奇数阶：缅甸法
  const N = n * n, sq = new Array(N).fill(0);
  let r = 0, c = (n - 1) >> 1;
  for (let v = 1; v <= N; v++) {
    sq[r * n + c] = v;
    const r2 = (r - 1 + n) % n, c2 = (c + 1) % n;
    if (sq[r2 * n + c2] !== 0) r = (r + 1) % n;
    else { r = r2; c = c2; }
  }
  return sq;
}
function doublyEven(n) { // 4 的倍数：4×4 小块对角取补
  const N = n * n, sq = new Array(N);
  for (let i = 0; i < N; i++) {
    const r = Math.floor(i / n), c = i % n, dr = r % 4, dc = c % 4;
    const onDiag = (dr === dc) || (dr + dc === 3);
    sq[i] = onDiag ? (N + 1 - (i + 1)) : (i + 1);
  }
  return sq;
}
const SINGLY6 = [35, 1, 6, 26, 19, 24, 3, 32, 7, 21, 23, 25, 31, 9, 2, 22, 27, 20,
  8, 28, 33, 17, 10, 15, 30, 5, 34, 12, 14, 16, 4, 36, 29, 13, 18, 11];
function magicSquare(n) {
  if (n % 2 === 1) return siamese(n);
  if (n % 4 === 0) return doublyEven(n);
  if (n === 6) return SINGLY6.slice();
  throw new Error('缺少 ' + n + ' 阶基准幻方');
}
function checkMagic(sq, n) { // 基准幻方自检（行/列/两对角线和相等）
  const S = sq.slice(0, n).reduce((a, b) => a + b, 0);
  const lines = [];
  for (let r = 0; r < n; r++) lines.push(sq.slice(r * n, r * n + n));
  for (let c = 0; c < n; c++) { const L = []; for (let r = 0; r < n; r++) L.push(sq[r * n + c]); lines.push(L); }
  { const L = []; for (let i = 0; i < n; i++) L.push(sq[i * n + i]); lines.push(L); }
  { const L = []; for (let i = 0; i < n; i++) L.push(sq[i * n + (n - 1 - i)]); lines.push(L); }
  const sorted = sq.slice().sort((a, b) => a - b);
  const isPerm = sorted.every((v, i) => v === i + 1);
  return isPerm && lines.every(L => L.reduce((a, b) => a + b, 0) === S);
}

/* ---------------- 汇总 ---------------- */
const results = [];   // {n, mode, case, pass, fails:[], ms}
function record(n, mode, caseName, ms, pass, fails) {
  results.push({ n: n, mode: mode, case: caseName, pass: pass, fails: fails || [], ms: ms });
  if (!pass) console.log('  ✗ FAIL n=' + n + ' mode=' + mode + ' case=' + caseName + ' :: ' + (fails || []).join(' | '));
}

/* ---------------- 单例断言集 ---------------- */
function verifyPositive(n, mode, trueSq, givenMap, domain, caseName) {
  const fails = [];
  const t0 = Date.now();
  let r = null, thrown = null;
  try { r = Core.solveMagic(n, givenMap, domain ? { domain: domain } : undefined); }
  catch (e) { thrown = e; }
  const ms = Date.now() - t0;

  if (thrown) { fails.push('抛异常: ' + thrown.message); record(n, mode, caseName, ms, false, fails); return { r: null, ms: ms, fails: fails }; }
  if (!r) { fails.push('返回空'); record(n, mode, caseName, ms, false, fails); return { r: null, ms: ms, fails: fails }; }
  if (!r.ok) { fails.push('应可解但 ok=false: ' + r.error); record(n, mode, caseName, ms, false, fails); return { r: r, ms: ms, fails: fails }; }
  if (ms > TIME_LIMIT_MS) fails.push('耗时 ' + ms + 'ms > ' + TIME_LIMIT_MS + 'ms');

  const N = n * n;
  // 2 结构完整
  for (const key of ['model', 'steps', 'finalCells', 'knownEntries', 'S', 'domain'])
    if (r[key] === undefined) fails.push('缺少字段 ' + key);
  if ((mode === 'classic' || mode === 'set') && n <= 4 && !(r.csp)) fails.push('n≤4 的限定模式缺 csp');
  if (mode === 'integer' && !r.integer) fails.push('integer 模式缺 integer');

  // 3 步号对齐 + 前提引用
  r.steps.forEach((st, k) => {
    if (st.i !== k + 1) fails.push('步号错位 steps[' + k + '].i=' + st.i);
    st.premises.forEach(p => {
      if (!(p.sourceIdx == null || (Number.isInteger(p.sourceIdx) && p.sourceIdx >= 1 && p.sourceIdx < st.i)))
        fails.push('第' + st.i + '步前提 ' + p.label + ' sourceIdx=' + p.sourceIdx + ' 非法');
    });
    if (!st.special && st.valueStr == null) fails.push('第' + st.i + '步缺 valueStr');
  });
  // 4 数值一致
  r.steps.forEach(st => {
    if (st.special) return;
    if (st.isS) { if (!r.S || r.S.valueStr !== st.valueStr) fails.push('第' + st.i + '步 S 值与总结不一致'); }
    else {
      const fc = r.finalCells[st.target];
      if (!fc || fc.valueStr !== st.valueStr) fails.push('第' + st.i + '步(' + st.label + ')值 ' + st.valueStr + ' 与 finalCells 不一致');
      if (fc && fc.source !== st.i) fails.push('第' + st.i + '步 finalCells.source=' + fc.source);
    }
  });
  if (r.complete) {
    if (!r.verification) fails.push('完整解缺 verification');
    else if (!r.verification.rows.every(x => x.ok)) fails.push('完整解存在线和 ≠ S');
  }
  // finalCells.source 必须指向存在的步
  r.finalCells.forEach((fc, i) => {
    if (!fc) return;
    if (fc.source != null && !(r.steps[fc.source - 1] && r.steps[fc.source - 1].i === fc.source))
      fails.push('finalCells[' + i + '].source=' + fc.source + ' 无对应步');
  });

  // 5 填格完整
  const filled = r.finalCells.filter(Boolean).length;
  const extras = (r.csp && r.csp.ok && r.csp.exhaustive) ? (r.csp.extras || []).length : 0;
  const expected = r.determinedCount - (r.S ? 1 : 0) + extras;
  if (filled !== expected) fails.push('填格缺口：filled=' + filled + ' 期望=' + expected + '（determinedCount=' + r.determinedCount + ' extras=' + extras + '）');
  if (r.undeterminedCells.length !== N - filled) fails.push('undeterminedCells 数目不符');
  // 与真实幻方一致（强校验：真实幻方是含全部已知的一个解，可定格必与之一致）
  r.knownEntries.forEach(e => {
    if (e.coord === r.model.SC) return;
    const want = String(trueSq[e.coord]);
    const got = r.finalCells[e.coord] && r.finalCells[e.coord].valueStr;
    if (got !== want) fails.push('格 ' + e.coord + ' 推出 ' + got + ' ≠ 基准幻方值 ' + want);
  });
  const trueS = trueSq.slice(0, n).reduce((a, b) => a + b, 0);
  if (r.S && r.S.valueStr !== String(trueS)) fails.push('S=' + r.S.valueStr + ' 与基准幻方 S=' + trueS + ' 不一致');

  // 6 模式语义
  if (mode === 'integer') {
    if (r.integer.feasible !== true) fails.push('integer.feasible 应为 true');
    const strs = [];
    (r.examples || []).forEach(e => strs.push.apply(strs, e.cells));
    if (r.sampling && r.sampling.samples) r.sampling.samples.forEach(s => strs.push.apply(strs, s));
    if (strs.some(v => String(v).includes('/'))) fails.push('integer 示例出现分数');
  }
  if (mode === 'classic' || mode === 'set') {
    // domain.S = 总和/n
    const vals = mode === 'classic'
      ? Array.from({ length: N }, (_, i) => new Frac(i + 1))
      : domain.values;
    let total = new Frac(0);
    for (const v of vals) total = total.add(v);
    if (r.domain.S !== Core.fmtNumber(total.div(new Frac(n)))) fails.push('domain.S ≠ 总和/n');
    if (!(r.steps.length >= 1 && r.steps[0].special === 'domain-S' && r.steps[0].i === 1))
      fails.push('第 1 步不是 special:domain-S');
    if (r.csp && r.csp.ok && r.csp.exhaustive) {
      for (const c of r.csp.stableCells) if (!r.finalCells[c]) fails.push('csp 稳定格 ' + c + ' 未在 finalCells');
      if (r.csp.count === 1 && r.complete !== true) fails.push('csp 唯一解但 complete=false');
    }
  }

  record(n, mode, caseName, ms, fails.length === 0, fails);
  return { r: r, ms: ms, fails: fails };
}

function verifyNegative(n, mode, givenMap, domain, caseName, errRe) {
  const fails = [];
  const t0 = Date.now();
  let r = null, thrown = null;
  try { r = Core.solveMagic(n, givenMap, domain ? { domain: domain } : undefined); }
  catch (e) { thrown = e; }
  const ms = Date.now() - t0;
  if (thrown) fails.push('抛异常: ' + thrown.message);
  else {
    if (r.ok !== false) fails.push('应判无解但 ok=' + r.ok);
    if (!r.error) fails.push('error 为空');
    else if (!errRe.test(r.error)) fails.push('error 不含预期关键词: ' + r.error);
  }
  record(n, mode, caseName, ms, fails.length === 0, fails);
  return { r: r, ms: ms, fails: fails };
}

/* ---------------- 证明文字合规（所有 pages 文本） ---------------- */
function collectText(blocks, out) {
  for (const b of blocks) {
    if (b.text != null) out.push(b.text);
    if (b.segs) for (const s of b.segs) if (s && s.text != null) out.push(s.text);
    if (b.cells) for (const c of b.cells) if (c && c.text != null) out.push(c.text);
    if (b.head) for (const h of b.head) if (h && h.text != null) out.push(h.text);
    if (b.rows) for (const row of b.rows) for (const c of row) if (c && c.text != null) out.push(c.text);
    if (b.caption) for (const s of b.caption) if (s && s.text != null) out.push(s.text);
    if (b.items) for (const it of b.items) { out.push(it.label || ''); if (it.grid) collectText([it.grid], out); }
    if (b.blocks) collectText(b.blocks, out);
  }
}
function verifyDocText(n, mode, r, caseName) {
  const fails = [];
  try {
    const doc = Render.buildDocument(r);
    const texts = [];
    collectText(doc.pages, texts);
    const all = texts.join('\n');
    for (const bad of FORBIDDEN) if (all.includes(bad)) fails.push('证明文字出现禁用措辞「' + bad + '」');
  } catch (e) { fails.push('buildDocument 抛异常: ' + e.message); }
  record(n, mode, caseName + '/文字合规', 0, fails.length === 0, fails);
}

/* ---------------- 主流程 ---------------- */
function pickCells(n, k, seed) {
  const idx = Array.from({ length: n * n }, (_, i) => i);
  let s = (seed >>> 0) || 20260611;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
  return idx.slice(0, k);
}

console.log('== 基准幻方自检 ==');
for (const n of NS) {
  const sq = magicSquare(n);
  if (!checkMagic(sq, n)) { console.error('基准幻方非法 n=' + n); process.exit(1); }
}
console.log('  3–8 阶基准幻方全部合法（行/列/对角线和相等，恰为 1..n²）\n');

const docxReps = [];   // 每个阶数取一个代表结果做 DOCX

for (const n of NS) {
  const baseSq = magicSquare(n);
  const N = n * n;
  for (const mode of MODES) {
    // set 模式：集合 = 基准值 ×2+1（非 1..n² 的整数，与 classic 区分开）
    const setVals = baseSq.map(v => new Frac(2 * v + 1));
    const trueSq = mode === 'set' ? baseSq.map(v => 2 * v + 1) : baseSq;
    const domain = mode === 'none' ? { kind: 'none' } :
      mode === 'integer' ? { kind: 'integer' } :
        mode === 'classic' ? { kind: 'classic' } : { kind: 'set', values: setVals };

    // 正例：0/1/2/3/n 个已知（取自真实幻方）
    const counts = [];
    for (const k of [0, 1, 2, 3, n]) if (k <= N && counts.indexOf(k) < 0) counts.push(k);
    let rep = null;
    for (const k of counts) {
      const cells = pickCells(n, k, 1000 + n * 17 + k);
      const m = new Map();
      cells.forEach(c => m.set(c, new Frac(trueSq[c])));
      const out = verifyPositive(n, mode, trueSq, m, domain, 'known=' + k);
      if (k === n) rep = out.r;
    }
    // 文字合规（用 n 个已知的代表例）
    if (rep && rep.ok) verifyDocText(n, mode, rep, 'known=' + n);

    // 负例 1：矛盾输入（整盘填满但一格 +1 → 行和必然对不上）
    {
      const m = new Map();
      for (let i = 0; i < N; i++) m.set(i, new Frac(trueSq[i] + (i === 0 ? 1 : 0)));
      verifyNegative(n, mode, m, domain, '矛盾(满盘一格+1)', /矛盾|无解|范围|整数/);
    }
    // 负例 2：超范围（classic/set：已知数不在限定集合内）
    if (mode === 'classic' || mode === 'set') {
      const m = new Map();
      m.set(0, mode === 'classic' ? new Frac(N + 1) : new Frac(2 * N + 2));
      verifyNegative(n, mode, m, domain, '超范围', /范围|份数/);
    }
    // 负例 3（integer 专属）：三阶 a=1,i=2 → 中心 3/2 分数无解
    if (mode === 'integer' && n === 3) {
      const m = new Map();
      m.set(0, new Frac(1)); m.set(8, new Frac(2));
      verifyNegative(3, mode, m, domain, 'integer分数无解', /分数|周期性/);
    }
    // DOCX 代表例（每个阶数一次）：classic、n 个已知
    if (mode === 'classic' && rep && rep.ok) docxReps.push({ n: n, r: rep });
  }
}

/* ---- DOCX：每个阶数生成并校验 ---- */
console.log('\n== DOCX 生成与校验 ==');
fs.mkdirSync('verify-docx', { recursive: true });
const docxFiles = [];
for (const item of docxReps) {
  try {
    const doc = Render.buildDocument(item.r);
    const bytes = Docx.buildDocx(doc.pages, doc.title);
    const f = DOCX_FILES[item.n];
    if (!f) throw new Error('非法阶数 ' + item.n);
    fs.writeFileSync(f, bytes);
    docxFiles.push(f);
    console.log('  n=' + item.n + ' 生成 ' + bytes.length + ' 字节');
  } catch (e) {
    console.log('  ✗ n=' + item.n + ' DOCX 生成失败: ' + e.message);
    record(item.n, 'docx', 'buildDocx', 0, false, [e.message]);
  }
}
if (docxFiles.length === NS.length) {
  try {
    const out = cp.execFileSync('python', ['-X', 'utf8', CHECKER].concat(docxFiles), { encoding: 'utf8', timeout: 60000 });
    console.log(out.trim());
  } catch (e) {
    console.log('  ✗ Python 校验失败:\n' + (e.stdout || '') + (e.stderr || e.message));
    record(0, 'docx', 'python', 0, false, ['python 校验失败']);
  }
} else {
  record(0, 'docx', 'files', 0, false, ['DOCX 文件数不足: ' + docxFiles.length]);
}

/* ---- 矩阵汇总表 ---- */
console.log('\n== 矩阵结果（正例 known=0/1/2/3/n + 负例 + 文字合规，全部通过才 PASS）==');
console.log(' n \\ mode  ' + MODES.map(m => (m + ' ').padEnd(12)).join(''));
for (const n of NS) {
  const cells = MODES.map(m => {
    const rs = results.filter(x => x.n === n && x.mode === m);
    const allPass = rs.length > 0 && rs.every(x => x.pass);
    const worst = Math.max.apply(null, rs.map(x => x.ms).concat([0]));
    return ((allPass ? 'PASS' : 'FAIL') + ' ' + worst + 'ms').padEnd(12);
  });
  console.log(('  ' + n).padEnd(10) + cells.join(''));
}

const failedList = results.filter(x => !x.pass);
const maxMs = Math.max.apply(null, results.map(x => x.ms).concat([0]));
console.log('\n用例总数: ' + results.length + '，失败: ' + failedList.length + '，最慢单例: ' + maxMs + 'ms');
if (failedList.length) {
  console.log('失败明细:');
  for (const f of failedList) console.log('  n=' + f.n + ' mode=' + f.mode + ' case=' + f.case + ' :: ' + f.fails.join(' | '));
  process.exit(1);
}
console.log('全部通过 ✓');
process.exit(0);
