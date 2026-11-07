/* test-core.js —— 核心算法测试（node test-core.js） */
'use strict';
const Core = require('./magic-core.js');
const Frac = Core.Frac;

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + b + '，得到 ' + a + ')'); }
function section(name) { console.log('· ' + name); }

function F(n, d) { return new Frac(n, d === undefined ? 1 : d); }
function solve(n, obj, domain) {
  const m = new Map();
  for (const k in obj) m.set(Number(k), typeof obj[k] === 'string' ? Core.parseNumberString(obj[k]) : obj[k]);
  return Core.solveMagic(n, m, domain ? { domain: domain } : undefined);
}

/* ---------- 分数解析与显示 ---------- */
section('分数解析与显示');
eq(Core.parseNumberString('1/2').toString(), '1/2', 'parse 1/2');
eq(Core.parseNumberString('-0.75').toString(), '-3/4', 'parse -0.75');
eq(Core.parseNumberString('2.5/3').toString(), '5/6', 'parse 2.5/3');
ok(Core.parseNumberString('  ') === null, '空串返回 null');
eq(Core.fmtNumber(F(1, 2)), '0.5', 'fmt 1/2 → 0.5（1位<2位）');
eq(Core.fmtNumber(F(5, 2)), '5/2', 'fmt 5/2 → 分数（平手取分数）');
eq(Core.fmtNumber(F(1, 3)), '1/3', 'fmt 1/3 → 分数（无限小数）');
eq(Core.fmtNumber(F(1, 8)), '1/8', 'fmt 1/8 → 分数（2位<3位）');
eq(Core.fmtNumber(F(1, 5)), '0.2', 'fmt 1/5 → 0.2');
eq(Core.fmtNumber(F(-11, 50)), '-0.22', 'fmt -11/50 → -0.22');
eq(Core.fmtNumber(F(-23, 12)), '-23/12', 'fmt -23/12');
eq(Core.fmtNumber(F(10, 4)), '5/2', 'fmt 10/4 化简后 5/2');
ok(Core.parseNumberString('1/3').equals(Core.parseNumberString('0.3333')) === false, '有限小数≠1/3');
// 长小数回归：exactDecimal 曾用浮点乘法产出 '0.01.4…e+21' 坏串（f.n*10^k 超 2^53 失真）
eq(Core.fmtNumber(Core.parseNumberString('.00000014789577')), '0.00000014789577', '14 位长小数精确显示');
{
  const x = Core.parseNumberString('0.00000014789577');
  ok(Core.parseNumberString(Core.fmtNumber(x)).equals(x), '长小数 fmt→parse 往返无损');
  const y = Core.parseNumberString('1.00000000000001');
  eq(Core.fmtNumber(y), '1.00000000000001', '15 位有效数字小数显示');
  ok(Core.parseNumberString(Core.fmtNumber(y)).equals(y), '15 位小数往返无损');
}
// Frac 构造器对 NaN/Infinity/非整数必须立刻报错（曾在 gcd 里死循环挂起）
{
  let threw = 0;
  try { new Frac(NaN); } catch (e) { threw++; }
  try { new Frac(1, Infinity); } catch (e) { threw++; }
  try { new Frac(2.5); } catch (e) { threw++; }
  ok(threw === 3, 'Frac 拒绝 NaN/Infinity/非整数（不挂起）');
}
// Frac 中间积精确性回归：同分母大数减法曾静默算错（p*3 = 2^53+1 被舍入成 2^53 → 8/9 ≠ 1）
eq(new Frac(3002399751580331, 3).sub(new Frac(3002399751580328, 3)).toString(), '1', '同分母大数 sub 精确（审查反例）');
// exactDecimal 上限收紧回归：16 位有效数字的小数改为退回分数显示，保证 parse 可无损读回
{
  const x = Core.parseNumberString('250000000000001/25');
  eq(Core.fmtNumber(x), '250000000000001/25', '超 15 位有效数字退回分数显示');
  ok(Core.parseNumberString(Core.fmtNumber(x)).equals(x), '分数显示可无损读回');
}
// 中心定理双向识别回归（分支 (a) 曾因常数取倒数成死分支：S 已知时中心步不标注）
{
  const r1 = solve(3, { 9: '15' });   // SC 坐标 = 9：已知 S=15
  ok(r1.ok && r1.steps.length >= 1 && r1.steps[0].theorem && r1.steps[0].theorem.key === 'center-S',
    '已知 S → 中心步识别为中心定理');
  const r2 = solve(3, { 4: '5' });    // 已知中心 5
  const sStep2 = r2.steps.find(s => s.isS);
  ok(sStep2 && sStep2.theorem && sStep2.theorem.key === 'center-S', '已知中心 → S 步仍识别为中心定理');
}
// 近增值拒绝回归：两个不同数转 double 后相同（m=67114656 处碰撞）会让 CSP 剪枝不可靠
{
  const m = 67114656;
  const vals = [new Frac(m + 1, m), new Frac(m + 2, m + 1)]
    .concat(Array.from({ length: 7 }, (_, i) => new Frac(i + 3)));
  const r = solve(3, {}, { kind: 'set', values: vals });
  ok(!r.ok && /过近/.test(r.error), '限定数字过近（double 碰撞）被明确拒绝');
}
// 大分母限定数字：超出精确计算范围时 ok:false 而不是抛异常
{
  const vals = [new Frac(67500001, 67500000), new Frac(67500002, 67500001)]
    .concat(Array.from({ length: 7 }, (_, i) => new Frac(i + 3)));
  const r = solve(3, {}, { kind: 'set', values: vals });
  ok(!r.ok && /超出精确/.test(r.error), '大分母限定数字优雅报错（不抛异常）');
}

/* ---------- 三阶：两个对角数 → 只能确定中心与幻和 ---------- */
section('三阶：已知 a=1, i=9（仅两数）');
{
  const r = solve(3, { 0: '1', 8: '9' });
  ok(r.ok, '求解成功');
  eq(r.steps.length, 2, '步数 = 2');
  ok(r.steps[0].target === 4 && r.steps[0].valueStr === '5', '第1步推出中心 e = 5');
  eq(r.steps[0].d, 2, '中心用到 2 个已知数');
  ok(r.steps[0].theorem && r.steps[0].theorem.key === 'opposite', '识别为对顶定理');
  ok(r.steps[1].isS && r.steps[1].valueStr === '15', '第2步推出 S = 15');
  eq(r.steps[1].identity.lambda.length, 1, 'S 用一条整线求出（幻和直用，1 条线）');
  eq(r.complete, false, '未全部确定');
  eq(r.dimFree, 1, '剩余自由度 1');
  eq(r.undeterminedCells.length, 6, '6 个格子未定');
  ok(r.examples && r.examples.length === 2, '给出两个反例填法');
  // 两个反例都必须满足约束
  for (const ex of r.examples) {
    const cells = ex.cells.map(s => Core.parseNumberString(s));
    let sum = cells[0].add(cells[1]).add(cells[2]);
    ok(sum.toString() === '15', '反例行和 = 15');
    ok(cells[0].toString() === '1' && cells[8].toString() === '9', '反例保留已知数');
  }
}

/* ---------- 三阶：洛书 a=2,b=7,e=5 → 完整 ---------- */
section('三阶：洛书（a=2, b=7, e=5）');
{
  const r = solve(3, { 0: '2', 1: '7', 4: '5' });
  ok(r.ok, '求解成功');
  const seq = r.steps.map(s => (s.isS ? 'S' : s.label) + '=' + s.valueStr).join(',');
  eq(seq, 'h=3,S=15,c=6,g=4,d=9,f=1,i=8', '推导顺序（对顶 → 幻和 → 补线法链）');
  eq(r.steps.map(s => s.identity ? s.identity.tech : 0).join(','), '3,1,1,1,1,1,1', '技巧从简：先对顶，再幻和直用');
  eq(r.complete, true, '完整解出');
  ok(r.verification && r.verification.rows.every(x => x.ok), '验证表全部通过');
  const expect = ['2', '7', '6', '9', '5', '1', '4', '3', '8'];
  eq(r.finalCells.map(c => c.valueStr).join(','), expect.join(','), '最终幻方 = 洛书');
}

/* ---------- 三阶：分数小数混合 ---------- */
section('三阶：分数小数混合（a=1/2, b=1/3, e=2.75）');
{
  const r = solve(3, { 0: '1/2', 1: '1/3', 4: '2.75' });
  ok(r.ok, '求解成功');
  const get = l => { const s = r.steps.find(x => x.label === l); return s ? s.valueStr : null; };
  eq(get('S'), '33/4', 'S = 33/4（平手显示分数）');
  eq(get('h'), '31/6', 'h = 31/6');
  eq(get('i'), '5', 'i = 5');
  eq(get('c'), '89/12', 'c = 89/12');
  eq(get('g'), '-23/12', 'g = -23/12');
  eq(get('d'), '29/3', 'd = 29/3');
  eq(get('f'), '-25/6', 'f = -25/6');
  eq(r.complete, true, '完整解出');
  ok(r.verification && r.verification.rows.every(x => x.ok), '验证全部通过');
}

/* ---------- 三阶：矛盾输入 ---------- */
section('三阶：矛盾输入 a=1, i=9, e=3');
{
  const r = solve(3, { 0: '1', 8: '9', 4: '3' });
  ok(!r.ok && /矛盾/.test(r.error), '报告矛盾');
}

/* ---------- 四阶：丢勒幻方（8 个已知数） ---------- */
section('四阶：丢勒幻方');
{
  const giv = { 0: '16', 1: '3', 2: '2', 3: '13', 4: '5', 5: '10', 6: '11', 10: '7', 12: '4' };
  const r = solve(4, giv);
  ok(r.ok, '求解成功');
  eq(r.complete, true, '完整解出');
  const dur = ['16', '3', '2', '13', '5', '10', '11', '8', '9', '6', '7', '12', '4', '15', '14', '1'];
  eq(r.finalCells.map(c => c.valueStr).join(','), dur.join(','), '最终 = 丢勒幻方');
  eq(r.S.valueStr, '34', 'S = 34');
  ok(r.verification.rows.every(x => x.ok), '验证全部通过');
  // 每一步的前提值都应来自题设或此前步骤（快照一致性已由内部校验保证）
  ok(r.steps.every(s => s.premises.length >= 1), '每步至少 1 个前提');
}

/* ---------- 四阶：仅四角 → 四角和定理定 S ---------- */
section('四阶：仅四个角（16,13,4,1）');
{
  const r = solve(4, { 0: '16', 3: '13', 12: '4', 15: '1' });
  ok(r.ok, '求解成功');
  const sStep = r.steps.find(s => s.isS);
  ok(sStep && sStep.valueStr === '34', 'S = 34');
  ok(sStep && sStep.theorem && sStep.theorem.key === 'corner4', '识别为四角和定理');
  eq(sStep ? sStep.d : 0, 4, 'S 用了 4 个角');
  ok(r.steps.every(s => s.isS), '除 S 外无其他可确定目标');
}

/* ---------- 低阶：n=2 与 n=1 ---------- */
section('二阶与一阶');
{
  const r2 = solve(2, { 0: '5' });
  ok(r2.ok && r2.complete, '二阶完整解出');
  eq(r2.finalCells.map(c => c.valueStr).join(','), '5,5,5,5', '二阶全为 5');
  eq(r2.S.valueStr, '10', '二阶 S=10');
  const r1 = solve(1, { 0: '7' });
  ok(r1.ok && r1.complete && r1.S.valueStr === '7', '一阶 S=7');
}

/* ---------- 空输入 ---------- */
section('三阶：无已知数');
{
  const r = solve(3, {});
  ok(r.ok && r.steps.length === 0 && !r.complete, '无步可推');
  eq(r.dimFree, 3, '自由度 = 3（= n²-2n）');
}

/* ---------- 五阶：部分已知，检查“可确定值必与原幻方一致” ---------- */
section('五阶：缅甸法（Siamese）幻方部分已知');
{
  const sq = [17, 24, 1, 8, 15, 23, 5, 7, 14, 16, 4, 6, 13, 20, 22, 10, 12, 19, 21, 3, 11, 18, 25, 2, 9];
  const giv = { 0: '17', 1: '24', 2: '1', 3: '8', 4: '15', 12: '13', 18: '21' };
  const r = solve(5, giv);
  ok(r.ok, '求解成功');
  // 所有已确定的格子必须等于原幻方对应值
  let consistent = true;
  for (const e of r.knownEntries) {
    if (e.coord === r.model.SC) continue;
    if (r.finalCells[e.coord].valueStr !== String(sq[e.coord])) consistent = false;
  }
  ok(consistent, '所有已确定值与原幻方一致');
  ok(!r.complete, '五阶 7 个已知不可能完整解（dimFree = n²−2n−7 = 8）');
}

/* ---------- 全部填满 ---------- */
section('三阶：全部填满');
{
  const r = solve(3, { 0: '2', 1: '7', 2: '6', 3: '9', 4: '5', 5: '1', 6: '4', 7: '3', 8: '8' });
  ok(r.ok && r.complete && r.steps.length === 1 && r.steps[0].isS, '只剩 S 一步');
  eq(r.S.valueStr, '15', 'S=15');
  ok(r.verification.rows.every(x => x.ok), '验证通过');
}

/* ---------- 值域限定 ---------- */
section('值域限定：1…n²（classic）');
{
  const r = solve(3, { 0: '2' }, { kind: 'classic' });
  ok(r.ok, '求解成功');
  eq(r.domain.kind, 'classic', '记录限定类型');
  ok(r.steps[0].special === 'domain-S', '第 1 步是“直接得幻和”');
  eq(r.steps[0].valueStr, '15', 'S = 15');
  eq(r.steps[0].d, 0, '该步不需要任何已知数');
  eq(r.csp.exhaustive, true, '穷举完成');
  eq(r.csp.count, 2, 'a=2 时共 2 种合法填法（Lo Shu 的两种）');
  eq(r.complete, false, '仅 2 种填法时不能唯一确定');
  // 示例必须来自穷举的合法填法：是 1…9 的排列、无分数、且保留已知数
  ok(r.examples && r.examples.length === 2, 'classic 给出 2 组穷举示例');
  ok((r.examples || []).every(e => e.cells.every(v => !v.includes('/'))), 'classic 示例无分数');
  const numSort = (a, b) => Number(a) - Number(b);
  ok((r.examples || []).every(e =>
    e.cells.map(v => Core.parseNumberString(v).toString()).sort(numSort).join(',') ===
    Array.from({ length: 9 }, (_, i) => String(i + 1)).sort(numSort).join(',')),
    'classic 示例都是 1…9 的排列（每个数恰好用一次）');
  ok((r.examples || []).every(e => e.cells[0] === '2'), 'classic 示例保留已知数 a=2');
}
{
  const r = solve(3, { 0: '2', 1: '7' }, { kind: 'classic' });
  ok(r.ok && r.complete, 'a=2,b=7 + 1…9 限定 ⇒ 唯一解，完整解出');
  eq(r.csp.count, 1, '穷举只有 1 种填法');
  ok(r.finalCells.map(c => c.valueStr).join(',') === '2,7,6,9,5,1,4,3,8', '结果 = 洛书');
}
{
  // 1…9 时角格不可能是 1（正常幻方角为偶数）→ 限定下无解
  const r = solve(3, { 0: '1' }, { kind: 'classic' });
  ok(!r.ok && /无解/.test(r.error), '限定 1…9 且角格=1 → 报告无解');
}
{
  const r = solve(3, { 0: '2', 1: '2' }, { kind: 'classic' });
  ok(!r.ok && /范围|份数/.test(r.error), '重复使用同一数字 → 报告超出份数');
}

section('值域限定：只允许整数');
{
  const r = solve(3, { 0: '1', 8: '2' }, { kind: 'integer' });
  ok(!r.ok && /整数/.test(r.error), 'a=1,i=2 → 中心 3/2，整数限定下无解');
}
{
  const r = solve(3, { 0: '1', 8: '9' }, { kind: 'integer' });
  ok(r.ok, '整数限定下可解');
  eq(r.integer.feasible, true, '找到整数填法见证');
  eq(r.finalCells[4].valueStr, '5', '中心 e=5 自动填入');
  ok(r.examples && r.examples.length === 2, 'integer 未完整解给出 2 组整数示例');
  ok((r.examples || []).every(e => e.cells.every(v => !v.includes('/'))), '多解示例全部是整数');
  ok(r.sampling && r.sampling.illustrative && r.sampling.samples.every(s => s.every(v => !v.includes('/'))), '整数试解示例全部是整数');
}
{
  // 较大的已知数：按分母周期精确枚举，仍应找到整数解
  const r = solve(3, { 0: '100', 1: '200' }, { kind: 'integer' });
  ok(r.ok && r.integer.feasible === true, '大数已知也能判定存在整数解');
  ok(r.examples && r.examples.length === 2, '大数示例存在（2 组，防静默不生成回归）');
  ok((r.examples || []).every(e => e.cells.every(v => !v.includes('/'))), '大数示例仍全为整数');
  // 每组示例的行和必须等于其标注的 S（沿整数方向平移时 S 会变，不能统一写见证的 S）
  (r.examples || []).forEach(ex => {
    const cells = ex.cells.map(s => Core.parseNumberString(s));
    const row = cells[0].add(cells[1]).add(cells[2]);
    ok(row.equals(Core.parseNumberString(ex.S)), 'integer 示例标注 S=' + ex.S + ' 与其行和一致');
  });
}
{
  const r = solve(3, { 0: '1' }, { kind: 'integer' });
  ok(r.ok && r.sampling && r.sampling.samples && r.sampling.samples.length > 0 &&
    r.sampling.samples.every(s => s.every(v => !v.includes('/'))), '仅 1 个已知数时试解也全为整数（样本非空）');
}

section('值域限定：自定义集合');
{
  const vals = [];
  for (let i = 1; i <= 9; i++) vals.push(Core.parseNumberString(String(i)));
  const r = solve(3, { 0: '2' }, { kind: 'set', values: vals });
  ok(r.ok && r.domain.kind === 'set', '自定义 1…9 集合求解成功');
  eq(r.domain.S, '15', '由集合总和直接得 S = 15');
  const bad = solve(3, { 0: '2' }, { kind: 'set', values: vals.slice(0, 5) });
  ok(!bad.ok && /恰好/.test(bad.error), '数量不等于 n² 时报错');
}

/* ---------- 矩阵冒烟：3–8 阶 × 4 种值域（穷尽验证见 verify-all.js） ---------- */
section('矩阵冒烟：3–8 阶 × 4 种值域');
{
  for (let n = 3; n <= 8; n++) {
    for (const kind of ['none', 'integer', 'classic', 'set']) {
      const dom = kind === 'set'
        ? { kind: 'set', values: Array.from({ length: n * n }, (_, i) => F(i + 1)) }
        : { kind: kind };
      const r = solve(n, (kind === 'none' || kind === 'integer') ? { 0: '1' } : {}, dom);
      ok(r.ok, 'n=' + n + ' ' + kind + ' 求解成功');
      if (!r.ok) continue;
      ok(r.steps.every((s, k) => s.i === k + 1), 'n=' + n + ' ' + kind + ' 步号对齐');
      const extras = (r.csp && r.csp.ok && r.csp.exhaustive) ? (r.csp.extras || []).length : 0;
      ok(r.finalCells.filter(Boolean).length === r.determinedCount - (r.S ? 1 : 0) + extras,
        'n=' + n + ' ' + kind + ' 填格完整（缺口 0）');
      if (kind === 'classic' || kind === 'set') {
        ok(r.steps.length >= 1 && r.steps[0].special === 'domain-S', 'n=' + n + ' ' + kind + ' 第1步直得幻和');
        if (n <= 4) ok(!!r.csp, 'n=' + n + ' ' + kind + ' 有穷举结果');
      }
      if (kind === 'integer') {
        ok(r.integer && r.integer.feasible === true, 'n=' + n + ' integer 有整数见证');
        const smp = (r.sampling && r.sampling.samples) || [];
        ok(smp.every(s => s.every(v => !v.includes('/'))), 'n=' + n + ' integer 示例全整数');
      }
      if ((kind === 'classic' || kind === 'set') && r.examples && r.examples.length) {
        // 示例必须是限定数字（冒烟用 1..n²）的排列，绝不能出现有理方向的分数填法
        const numSort2 = (a, b) => Number(a) - Number(b);
        const want = Array.from({ length: n * n }, (_, i) => String(i + 1)).sort(numSort2).join(',');
        ok(r.examples.every(e =>
          e.cells.map(v => Core.parseNumberString(v).toString()).sort(numSort2).join(',') === want),
          'n=' + n + ' ' + kind + ' 示例是限定数字的排列');
      }
    }
    // 超范围已知数（classic）：任意阶都必须拒绝（n≥5 曾漏校验）
    const bad = solve(n, { 0: String(n * n + 1) }, { kind: 'classic' });
    ok(!bad.ok && /范围|份数/.test(bad.error), 'n=' + n + ' classic 超范围已知数被拒绝');
  }
}

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
