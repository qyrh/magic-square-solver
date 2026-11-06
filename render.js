/* =========================================================================
 * render.js —— 把求解结果编译成“文档块”序列（网页与 DOCX 共用）
 *
 * 块类型：
 *   {t:'title'|'h2'|'h3', text}
 *   {t:'p', segs:[{text, b?, i?, cls?}]}        cls: given/derived/new/ok/err/dim
 *   {t:'grid', n, cells:[{text, kind, row?}], caption?}   kind: given/derived/new/letter/dot/diff
 *   {t:'table', head:[segs], rows:[[segs]], caption?}
 *   {t:'pagebreak'}
 * buildDocument(result) → {pages:[块数组...], title}
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.MagicRender = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function S(text, o) { const s = { text: String(text) }; if (o) Object.assign(s, o); return s; }
  function B(text) { return S(text, { b: 1 }); }
  function P() { return { t: 'p', segs: Array.prototype.slice.call(arguments) }; }
  function H2(t) { return { t: 'h2', text: t }; }
  function H3(t) { return { t: 'h3', text: t }; }
  function BRK() { return { t: 'pagebreak' }; }
  function GRID(n, cells, caption) { return { t: 'grid', n: n, cells: cells, caption: caption }; }
  function TBL(head, rows, caption) { return { t: 'table', head: head, rows: rows, caption: caption }; }

  /* ---- 表达式工具（系数为普通整数） ---- */
  function signedJoin(items) { // items: [{label, coeff}]
    let out = '';
    items.forEach(function (it, i) {
      let c = Number(it.coeff);
      let neg = false;
      if (c < 0) { c = -c; neg = true; }
      let magStr = '';
      if (c !== 1) { magStr = c + '·'; }
      const term = magStr + it.label;
      if (i === 0) { out += (neg ? '−' : '') + term; }
      else { out += (neg ? ' − ' : ' + ') + term; }
    });
    return out === '' ? '0' : out;
  }

  function regionCellStr(model, e) {
    if (e.count > 1) return e.count + '·' + model.letters[e.cell];
    return model.letters[e.cell];
  }
  function eqEqSafe(t) { return t; }
  function regionStr(model, arr) {
    if (!arr || arr.length === 0) return '0';
    return arr.map(function (e) { return regionCellStr(model, e); }).join(' + ');
  }

  /* 三阶马步定理的最优讲法：
   * 红组 = 过角格的三条线（一行、一列、一条过该角的对角线）→ 和 = 3S
   * 蓝组 = 全部三条行线（覆盖整个九宫格）→ 和 = 3S
   * 抵消两组都有的格子后：红剩 角格×2，蓝剩 与角格成马步的两格 → 2a = f + h
   */
  function knightGroups(model, step) {
    const n = model.n;
    if (n !== 3) return null;
    const cellsAll = [step.target].concat(step.premises.filter(function (p) { return !p.isS; }).map(function (p) { return p.coord; }));
    const isCorner = function (c) {
      const r = Math.floor(c / n), col = c % n;
      return (r === 0 || r === n - 1) && (col === 0 || col === n - 1);
    };
    const corner = cellsAll.filter(isCorner)[0];
    if (corner === undefined) return null;
    const r0 = Math.floor(corner / n), c0 = corner % n;
    const rowLine = r0;                       // 行线索引
    const colLine = n + c0;                   // 列线索引
    const diagLine = (r0 === c0) ? 2 * n : 2 * n + 1;   // 过该角的对角线
    const redLines = [rowLine, colLine, diagLine];
    const blueLines = [0, 1, 2];              // 三阶：全部行线

    const redMap = new Map(), blueMap = new Map();
    for (const li of redLines) for (const c of model.lines[li].cells) redMap.set(c, (redMap.get(c) || 0) + 1);
    for (const li of blueLines) for (const c of model.lines[li].cells) blueMap.set(c, (blueMap.get(c) || 0) + 1);
    const all = new Set(Array.from(redMap.keys()).concat(Array.from(blueMap.keys())));
    const cancelled = [], redOnly = [], blueOnly = [];
    for (const c of all) {
      const r = redMap.get(c) || 0, b = blueMap.get(c) || 0;
      const m = Math.min(r, b);
      if (m > 0) cancelled.push({ cell: c, count: m });
      if (r - m > 0) redOnly.push({ cell: c, count: r - m });
      if (b - m > 0) blueOnly.push({ cell: c, count: b - m });
    }
    redOnly.sort(function (a, b) { return a.cell - b.cell; });
    blueOnly.sort(function (a, b) { return a.cell - b.cell; });
    const cells = [];
    const redSet = new Map(redOnly.map(function (e) { return [e.cell, e.count]; }));
    const blueSet = new Map(blueOnly.map(function (e) { return [e.cell, e.count]; }));
    for (let i = 0; i < model.N; i++) {
      if (redSet.has(i)) cells.push({ text: regionCellStr(model, { cell: i, count: redSet.get(i) }), kind: 'red' });
      else if (blueSet.has(i)) cells.push({ text: regionCellStr(model, { cell: i, count: blueSet.get(i) }), kind: 'blue' });
      else cells.push({ text: '·', kind: 'dot' });
    }
    const redStr = redOnly.length ? redOnly.map(function (e) { return (e.count > 1 ? e.count + '·' : '') + model.letters[e.cell]; }).join(' + ') : '0';
    const blueStr = blueOnly.length ? blueOnly.map(function (e) { return (e.count > 1 ? e.count + '·' : '') + model.letters[e.cell]; }).join(' + ') : '0';
    return {
      redLines: redLines, blueLines: blueLines, kRed: redLines.length, kBlue: blueLines.length,
      cells: cells, redStr: redStr, blueStr: blueStr,
      cancelledNames: cancelled.map(function (e) { return model.letters[e.cell]; }).join('、')
    };
  }
  function coeffListStr(lambda) { // "(+1 − 1 …)"
    const parts = lambda.map(function (L) {
      if (L.coeff < 0) { return String(L.coeff); }
      return '+' + L.coeff;
    });
    return '(' + parts.join(' ') + ')';
  }
  function gammaLabel(gamma, label) {
    let gStr = '';
    if (gamma !== 1) { gStr = gamma + '·'; }
    return gStr + label;
  }
  function identityStr(step) {
    const terms = step.identity.terms.map(function (p) { return { label: p.label, coeff: p.coeff }; });
    return gammaLabel(step.identity.gamma, step.label) + ' = ' + signedJoin(terms);
  }
  function expansionStr(step) {
    return signedJoin(step.identity.expansion.map(function (e) { return { label: e.label, coeff: e.coeff }; }));
  }

  /* ---- 定理的通俗注解 ---- */
  const THEOREM_NOTE = {
    'S-line': '幻和定理：S 就等于任何一条完整线上 n 个数之和。',
    'line-complete': '补线法：一条线上只缺一格时，缺格 = S − 其余格之和。',
    'opposite': '对顶定理：三阶幻方中，过中心的同一条线上，与中心对称的两格之和恰为中心的 2 倍。',
    'knight3': '马步定理（三阶）：角上那个数的 2 倍 = 与它成马步的两格之和。证明思路：过该角的三条线之和 = 3S，全部数之和 = 3S，重叠部分成对抵消即得——这正是“多线去交叉”技巧。',
    'center-S': '中心定理：奇数阶幻方的中心 = S/n（即 n×中心 = S）。',
    'corner4': '四角和定理：四阶幻方四个角上的数之和恰为幻和 S。'
  };
  const REF_SENTENCE = {
    'S-line': '幻和等于任何一条完整线的和，这已在第{j}步证明；对本题的这条线即得',
    'line-complete': '补线法已在第{j}步证明；对本题的这条线即得',
    'opposite': '对顶定理已在第{j}步证明；把其中关于中心对称的两格换成本题的相应格子，即得',
    'knight3': '马步定理已在第{j}步证明；把其中的角格与两个马步格换成本题的相应格子，即得',
    'center-S': '中心定理已在第{j}步证明；这里直接得到',
    'corner4': '四角和定理已在第{j}步证明；这里直接得到'
  };

  /* ---- 网格图 ---- */
  function letterGrid(model, involved) {
    const set = new Set(involved);
    const cells = [];
    for (let i = 0; i < model.N; i++) {
      cells.push({ text: set.has(i) ? model.letters[i] : '·', kind: set.has(i) ? 'letter' : 'dot' });
    }
    return GRID(model.n, cells);
  }
  function stateGrid(model, snapshot, newCoord, caption) {
    const map = new Map(snapshot.map(function (e) { return [e.coord, e]; }));
    const cells = [];
    for (let i = 0; i < model.N; i++) {
      if (!map.has(i)) cells.push({ text: model.letters[i], kind: 'unknown' });
      else {
        const e = map.get(i);
        cells.push({
          text: e.valueStr,
          kind: e.source == null ? 'given' : (i === newCoord ? 'new' : 'derived'),
          source: e.source, coord: i   // source：题设为 null，否则为推导步号（供“点击查阅”）
        });
      }
    }
    return GRID(model.n, cells, caption);
  }

  function sSrc(sourceIdx) { return sourceIdx == null ? '题设' : '第' + sourceIdx + '步'; }

  /* ---- 值域限定：直接得到幻和（第 1 步） ---- */
  function domainSBlocks(result, step) {
    const model = result.model, n = result.n, N = result.N;
    const bl = [];
    bl.push(H2('第 1 步　直接得到 幻和 S = ' + step.valueStr + '（由「' + step.domainNote + '」）'));
    bl.push(P(B('结论：'), S('由题设「' + step.domainNote + '」可知全部 ' + N + ' 个数之和为 '), B(step.totalStr),
      S('；而 ' + n + ' 条行线恰好把所有格子各算一次，它们的和是 ' + n + '·S。于是 ' + n + '·S = ' + step.totalStr + '，即 '), B('S = ' + step.valueStr), S(' —— 不需要任何已知格子。')));
    bl.push(P(S('（这就是为什么限定「1…n²」时证明会短很多：幻和一开始就知道，后面每一步都能直接用幻和。）', { cls: 'dim' })));

    // 证明：画块（整格红 = 行线覆盖范围）
    const proofBlocks = [];
    proofBlocks.push(P(S('把 ' + n + ' 条行线全部加起来（下图红色就是它们的覆盖范围，正好是整个方阵）：')));
    const cells = [];
    for (let i = 0; i < N; i++) cells.push({ text: model.letters[i], kind: 'red' });
    proofBlocks.push(GRID(n, cells, [S('红色：' + n + ' 条行线覆盖全部 ' + N + ' 格（每格恰好一次）', { cls: 'err', b: 1 })]));
    proofBlocks.push(P(S('左边 = 全部数字之和 = 1 + 2 + … + ' + N + ' = '), B(step.totalStr),
      S('（' + step.domainNote + '）；右边 = ' + n + ' 条线各等于 S，共 ' + n + '·S。所以 ' + n + '·S = ' + step.totalStr + '，两边除以 ' + n + ' 得 '), B('S = ' + step.valueStr), S('。∎')));
    bl.push({ t: 'proof', title: n + ' 阶幻方', blocks: proofBlocks });

    bl.push(H3('运用（后续步骤可直接使用）'));
    bl.push(P(B('运用：'), S('S = ' + step.valueStr + ' 已知。后面凡是一条线上已知 ' + (n - 1) + ' 个数，就能用「S − 其余数」直接出数；证明中也会优先使用幻和。')));
    bl.push(H3('填入后的示意图'));
    bl.push(stateGrid(model, step.snapshot, -1, [S('幻和 S = ' + step.valueStr + '（已知），灰色字母 = 尚未确定的格子。')]));
    return bl;
  }

  /* ---- 值域限定：穷举验证（末步） ---- */
  function cspBlocks(result, step) {
    const model = result.model, n = result.n;
    const info = step.cspInfo;
    const bl = [];
    bl.push(H2('第 ' + step.i + ' 步　穷举验证：在限定数字范围内所有合法填法都相同'));
    const names = info.extras.map(function (e) { return e.label + ' = ' + e.valueStr; }).join('，');
    bl.push(P(B('结论：'), S('在「' + (result.domain ? result.domain.note : '限定数字') + '」的全部合法填法中，'), B(names),
      S(' —— 这几个格子在**所有**填法里都取同一个值，所以它们也是确定的（自动填入）。')));
    const proofBlocks = [];
    proofBlocks.push(P(S('做法：把限定范围内的数字各用一次，逐个格子试填，并始终要求每条行、列、对角线的和都等于 S = ' +
      (result.domain && result.domain.S ? result.domain.S : '?') + '。对所有分支穷尽搜索后，共得到 '), B(info.count + ' 种'), S('合法填法（没有遗漏）。')));
    proofBlocks.push(P(S('既然每种合法填法里这些格子都等于同一个数，那么把它们填成别的数就**无解**——它们就是确定解。这就是“为什么某个格子能确定”的完整证明。')));
    if (info.samples && info.samples.length > 0) {
      proofBlocks.push(P(S('下面是穷举得到的若干种填法（可以看到这些格子在各填法中都相同）：')));
      for (let q = 0; q < info.samples.length; q++) {
        const cells = info.samples[q].map(function (t, idx) {
          const isGiv = result.givens.some(function (g) { return g.coord === idx; });
          const isExtra = info.extras.some(function (e) { return e.coord === idx; });
          return { text: t, kind: isGiv ? 'given' : (isExtra ? 'new' : 'derived') };
        });
        proofBlocks.push(GRID(n, cells, [S('合法填法 ' + (q + 1) + ' / ' + info.count)]));
      }
    }
    bl.push({ t: 'proof', title: n + ' 阶幻方', blocks: proofBlocks });
    bl.push(H3('填入后的示意图'));
    bl.push(stateGrid(model, step.snapshot, -1, [S('绿色/黄色 = 已确定（含穷举确定），灰色字母 = 在限定下仍可变化。')]));
    return bl;
  }

  /* ---- 单步页面 ---- */
  function stepBlocks(result, step) {
    if (step.special === 'domain-S') return domainSBlocks(result, step);
    if (step.special === 'csp') return cspBlocks(result, step);
    const model = result.model, n = result.n;
    const bl = [];
    bl.push(H2('第 ' + step.i + ' 步　确定 ' + (step.isS ? '幻和 S' : '格子 ' + step.label + '（第' + step.cell.r + '行第' + step.cell.c + '列）') + ' = ' + step.valueStr));

    // 结论
    const premDesc = step.premises.map(function (p) { return p.label + ' = ' + p.valueStr + '（' + p.source + '）'; }).join('，');
    bl.push(P(B('结论：'), S('只用 ' + step.d + ' 个已知的数 —— ' + premDesc + ' —— 就能唯一确定 ' + (step.isS ? '幻和 S' : '格子 ' + step.label) + ' 的值：'), B(step.label + ' = ' + step.valueStr + '。')));
    if (step.theorem) bl.push(P(S('（' + step.theorem.name + '：' + THEOREM_NOTE[step.theorem.key] + '）', { cls: 'dim' })));

    // 证明（默认折叠，可展开；打印/导出时自动展开）
    const pb = [];
    pb.push(P(S('先证一条与具体数字无关的结论。下图给出证明中要用到的格子字母（“·”表示本步用不到，只标注涉及到的格子）：')));
    pb.push(letterGrid(model, step.involvedCells));
    if (step.refStep) {
      const ref = result.steps[step.refStep - 1];
      const sent = (REF_SENTENCE[step.theorem ? step.theorem.key : 'sig'] || '第{j}步已证同样的关系；这里对应地得到').replace('{j}', String(step.refStep));
      pb.push(P(S('本步用到的结论已经在' + (ref.theorem ? '第 ' + step.refStep + ' 步（' + ref.theorem.name + '）' : '第 ' + step.refStep + ' 步') + '证明过：那里证明了 '), B(ref ? identityStr(ref) : ''), S('。' + sent + '：'), B(identityStr(step) + '。')));
    } else if (step.theorem && step.theorem.key === 'line-complete') {
      // 补线法：整线之和 = S，去掉已知的其余格
      const lam = step.identity.lambda[0];
      const others = lam.cells.filter(function (c) { return c !== step.target; });
      const cells = [];
      for (let i = 0; i < model.N; i++) {
        if (i === step.target) cells.push({ text: model.letters[i], kind: 'blue' });
        else if (others.indexOf(i) >= 0) cells.push({ text: model.letters[i], kind: 'new' });
        else cells.push({ text: '·', kind: 'dot' });
      }
      pb.push(P(S('这条线（' + lam.name + '）上 ' + n + ' 个数之和就是幻和 S。图中蓝色 = 要求的格子，黄色 = 线上的其余 ' + (n - 1) + ' 格（都已知道）：')));
      pb.push(GRID(model.n, cells, [S('整条线之和 = S；从中去掉黄色各格，剩下的蓝色格就是答案')]));
      pb.push(P(S('写成式子：'), B('S = ' + model.letters[step.target] + ' + ' + others.map(function (c) { return model.letters[c]; }).join(' + ')),
        S('，移项得 '), B(identityStr(step)), S('。∎')));
    } else if (step.theorem && step.theorem.key === 'S-line') {
      const lam = step.identity.lambda[0];
      pb.push(P(S('幻和的定义就是“每条线上的 ' + n + ' 个数之和”。这条线（' + lam.name + '）上的数都已知道，所以直接相加就得到 S：'), B(identityStr(step)), S('。∎')));
    } else if (step.theorem && step.theorem.key === 'knight3' && knightGroups(model, step)) {
      // 马步定理：用“过角三线”与“全部行线”两组求和后看重合
      const kg = knightGroups(model, step);
      const redNames = kg.redLines.map(function (li) { return model.lines[li].name; }).join('、');
      const blueNames = kg.blueLines.map(function (li) { return model.lines[li].name; }).join('、');
      pb.push(P(S('用两组线来比：'), B('红组 = 过角格的 ' + kg.redLines.length + ' 条线（' + redNames + '）'),
        S('；'), B('蓝组 = 全部 ' + kg.blueLines.length + ' 条行线（' + blueNames + '，正好覆盖整个方阵）'), S('。')));
      pb.push(P(S('红组有 ' + kg.kRed + ' 条线，和 = ' + kg.kRed + '·S = ' + kg.kRed + 'S；蓝组也是 ' + kg.kBlue + ' 条线，和 = ' + kg.kBlue + 'S。两组相等。')));
      pb.push(GRID(model.n, kg.cells, [S('红组多出的格子 = ', { cls: 'err', b: 1 }), S('蓝组多出的格子', { cls: 'given', b: 1 }), S('（灰点 = 两组重合、已抵消）')]));
      pb.push(P(S('看重合部分：两组都包含的格子（' + kg.cancelledNames + '）在两边各出现同样的次数，互相抵消；红色行线在两边都有，也先抵消。抵消后剩下：'),
        B(kg.redStr, { cls: 'err' }), S('（红组）与 '), B(kg.blueStr, { cls: 'given' }), S('（蓝组）。')));
      pb.push(P(S('所以 '), B(kg.redStr + ' = ' + kg.blueStr), S('，即 '), B(identityStr(step)), S('。∎')));
    } else {
      const lam = step.identity.lambda;
      const T = step.identity.T;
      // 红组 = 系数为正的线；蓝组 = 系数为负的线（都按次数计），全部用“相加”表述，不出现负系数
      const red = [], blue = [];
      for (const L of lam) {
        const cnt = L.coeff < 0 ? -L.coeff : L.coeff;
        for (let q = 0; q < cnt; q++) (L.coeff > 0 ? red : blue).push(L.lineIdx);
      }
      const kRed = red.length, kBlue = blue.length;
      const redMap = new Map(), blueMap = new Map();
      for (const li of red) for (const c of model.lines[li].cells) redMap.set(c, (redMap.get(c) || 0) + 1);
      for (const li of blue) for (const c of model.lines[li].cells) blueMap.set(c, (blueMap.get(c) || 0) + 1);
      const allCells = new Set(Array.from(redMap.keys()).concat(Array.from(blueMap.keys())));
      const cancelled = [], redOnly = [], blueOnly = [];
      for (const c of allCells) {
        const r = redMap.get(c) || 0, b = blueMap.get(c) || 0;
        const m = Math.min(r, b);
        if (m > 0) cancelled.push({ cell: c, count: m });
        if (r - m > 0) redOnly.push({ cell: c, count: r - m });
        if (b - m > 0) blueOnly.push({ cell: c, count: b - m });
      }
      redOnly.sort(function (a, b) { return a.cell - b.cell; });
      blueOnly.sort(function (a, b) { return a.cell - b.cell; });
      cancelled.sort(function (a, b) { return a.cell - b.cell; });

      pb.push(P(S('把本步用到的线分成两组（每条线算一次；同一条线用两次就写两次）：')));
      const rowsTbl = [];
      if (red.length) rowsTbl.push([S('红组'), S(red.map(function (li) { return model.lines[li].name; }).join('、')), S(String(kRed)), S(kRed + '·S')]);
      if (blue.length) rowsTbl.push([S('蓝组'), S(blue.map(function (li) { return model.lines[li].name; }).join('、')), S(String(kBlue)), S(kBlue + '·S')]);
      pb.push(TBL([S('组'), S('这条组里的线'), S('条数'), S('这组的和')], rowsTbl));
      pb.push(P(S('每条线的和都是 S。所以红组之和 = ' + kRed + 'S，蓝组之和 = ' + kBlue + 'S。'),
        S(kRed === kBlue ? '两组条数相同，所以 红组之和 = 蓝组之和。'
          : (kRed > kBlue ? '红组比蓝组多 ' + (kRed - kBlue) + ' 条线，所以 红组之和比蓝组之和多 ' + (kRed - kBlue) + 'S。'
            : '蓝组比红组多 ' + (kBlue - kRed) + ' 条线，所以 蓝组之和比红组之和多 ' + (kBlue - kRed) + 'S。'))));

      // 画块
      const cells = [];
      const redSet = new Map(redOnly.map(function (e) { return [e.cell, e.count]; }));
      const blueSet = new Map(blueOnly.map(function (e) { return [e.cell, e.count]; }));
      for (let i = 0; i < model.N; i++) {
        if (redSet.has(i)) cells.push({ text: regionCellStr(model, { cell: i, count: redSet.get(i) }), kind: 'red' });
        else if (blueSet.has(i)) cells.push({ text: regionCellStr(model, { cell: i, count: blueSet.get(i) }), kind: 'blue' });
        else cells.push({ text: '·', kind: 'dot' });
      }
      pb.push(P(S('看重合部分：两组都出现的格子（' + (cancelled.length ? cancelled.map(function (e) { return model.letters[e.cell]; }).join('、') : '无') + '）在两边出现次数相同，互相抵消、去掉。剩下：')));
      pb.push(GRID(model.n, cells, [S('红组多出的格子', { cls: 'err', b: 1 }), S(' 与 '), S('蓝组多出的格子', { cls: 'given', b: 1 }), S('（“2·a”表示 a 出现 2 次；灰点 = 已抵消或未用到）')]));
      const redStr = redOnly.length ? redOnly.map(function (e) { return (e.count > 1 ? e.count + '·' : '') + model.letters[e.cell]; }).join(' + ') : '0';
      const blueStr = blueOnly.length ? blueOnly.map(function (e) { return (e.count > 1 ? e.count + '·' : '') + model.letters[e.cell]; }).join(' + ') : '0';
      let rel;
      if (kRed === kBlue) rel = redStr + ' = ' + blueStr;
      else if (kRed > kBlue) rel = redStr + ' = ' + blueStr + ' + ' + (kRed - kBlue) + 'S';
      else rel = blueStr + ' = ' + redStr + ' + ' + (kBlue - kRed) + 'S';
      pb.push(P(S('于是 '), B(rel), S('。')));

      // 结合 S 是已知/待求以及 γ，收束到最终恒等式
      let tail = '';
      if (step.isS) {
        tail = '本步要求的就是 S：把上式整理（S 只出现在一侧）即可解出 ' + identityStr(step) + '。';
      } else if (step.premises.some(function (p) { return p.isS; })) {
        tail = '把已知的 S = ' + (step.premises.find(function (p) { return p.isS; }) || {}).valueStr + ' 代入，移项即得 ' + identityStr(step) + '。';
      } else {
        tail = '移项即得 ' + identityStr(step) + '。';
      }
      if (step.identity.gamma !== 1) tail += '（两边再同时除以 ' + step.identity.gamma + '。）';
      pb.push(P(S(tail + '这个关系对任何 ' + n + ' 阶幻方都成立。∎')));
    }
    bl.push({ t: 'proof', title: n + ' 阶幻方', blocks: pb });

    // 运用
    bl.push(H3('运用（代入本题数字）'));
    const Core = rootCore();
    let accF = new Core.Frac(0);
    step.premises.forEach(function (p) {
      const val = Core.parseNumberString(p.valueStr);
      accF = accF.add(val.mul(new Core.Frac(p.coeff)));
    });
    const accStr = Core.fmtNumber(accF);
    const g = step.identity.gamma;
    let app = '代入 ' + gammaLabel(g, step.label) + ' = ' + signedJoin(step.identity.terms.map(function (p) {
      const v = step.premises.find(function (q) { return q.coord === p.coord; });
      return { label: v.valueStr, coeff: p.coeff };
    })) + '，得 ' + gammaLabel(g, step.label) + ' = ' + accStr;
    if (g !== 1) app += '，所以 ' + step.label + ' = ' + accStr + ' ÷ ' + g + ' = ' + B(step.valueStr).text;
    else app += '，即 ' + step.label + ' = ' + step.valueStr;
    bl.push(P(B('运用：'), S(app + '。')));
    if (step.isS) bl.push(P(S('幻和 S 至此已知，后面各步可直接使用。', { cls: 'dim' })));

    // 示意图
    bl.push(H3('填入后的示意图'));
    const cap = [];
    cap.push(S('灰色字母 = 尚未确定；蓝色 = 题设数字；绿色 = 已推出；点绿色/黄色格子可查看该数是根据哪几个数推出的。'));
    const Sval = step.snapshot.find(function (e) { return e.coord === model.SC; });
    if (Sval) cap.push(S('当前幻和 S = ' + Sval.valueStr + '。'));
    else cap.push(S('幻和 S 尚未确定。'));
    bl.push(stateGrid(model, step.snapshot, step.target, cap));
    return bl;
  }

  /* 内部：取 MagicCore（浏览器全局或 require） */
  let _core = null;
  function rootCore() {
    if (_core) return _core;
    if (typeof MagicCore !== 'undefined') _core = MagicCore;            // 浏览器 <script> 加载
    else if (typeof require === 'function') _core = require('./magic-core.js'); // Node
    else throw new Error('MagicCore 未加载');
    return _core;
  }

  /* ---- 首页（题目） ---- */
  function introBlocks(result) {
    const model = result.model, n = result.n;
    const bl = [];
    bl.push({ t: 'title', text: n + ' 阶幻方求解 —— 逐步推出所有能确定的格子' });
    bl.push(P(S('一个 ' + n + ' 阶幻方要求：每一行、每一列、主对角线、副对角线上的 ' + n + ' 个数之和都相等。把这个相等的和记作 '), B('幻和 S'), S('（事先未知）。数字可以是整数、分数或小数。')));
    if (result.givens.length > 0) {
      bl.push(P(B('已知格子：'), S(result.givens.map(function (g) { return g.label + ' = ' + g.valueStr + '（第' + g.r + '行第' + g.c + '列）'; }).join('；') + '。')));
    } else {
      bl.push(P(B('目前没有填入任何已知数。'), S('此时任何格子都无法确定。', { cls: 'err' })));
    }
    bl.push(stateGrid(model, result.givens.map(function (g) { return { coord: g.coord, valueStr: g.valueStr, source: null }; }), -1));
    bl.push(H3('记号'));
    bl.push(P(S('按行的顺序给每个格子一个字母（下图），后文用字母指代格子；S 表示幻和。')));
    bl.push(letterGrid(model, Array.from({ length: model.N }, function (_, i) { return i; })));
    bl.push(H3('思路'));
    bl.push(P(S('任何 ' + n + ' 阶幻方的全部填法共有 '), B(model.m + ' 个自由参数'), S('。若某格在“满足全部已知条件的所有填法”中取值都相同，它就是可确定的。下面从'), B('需要已知数最少'), S('的结论开始：每一步先证明一条对任意幻方都成立的恒等式（用字母，与具体数字无关），再代入本题数字，从而“出数”一个格子；如此逐步推出所有能确定的格子。即使已知数不足以解出整个幻方，凡能确定的格子都会被推出。'),
      S('输入时程序处于快速模式：只把能确定的数自动回填到填写框（不展示证明）；点'), B('“求 解”'), S('后才给出完整的逐步证明（证明默认折叠，点击可展开；每步只标注该步涉及的格子字母）。'),
      S('证明按技巧从简到难选择：能用幻和直出的优先，其次是“两线去交叉”“多线去交叉（容斥）”等组合技巧，并尽量配画块示意（红色部分 = 蓝色部分）。')));
    return bl;
  }

  /* ---- 总结页 ---- */
  function summaryBlocks(result) {
    const model = result.model, n = result.n;
    const bl = [];
    bl.push(H2('总结：填数顺序与结果'));
    const snapAll = result.knownEntries.filter(function (e) { return e.coord !== model.SC; })
      .map(function (e) { return { coord: e.coord, valueStr: result.finalCells[e.coord].valueStr, source: e.source }; });
    if (result.complete) {
      bl.push(P(B('全部 ' + model.N + ' 个格子与幻和都能唯一确定。'), result.S ? S('幻和 S = ' + result.S.valueStr + '。') : S('')));
      bl.push(stateGrid(model, snapAll, -1, [S('最终结果（蓝色 = 题设，绿色 = 逐步推出）。幻和 S = ' + (result.S ? result.S.valueStr : '?') + '。')]));
    } else {
      const undLetters = result.undeterminedCells.map(function (c) { return model.letters[c]; });
      bl.push(P(B('在给定条件下，只能确定部分格子。'), S('无法唯一确定的格子：' + (undLetters.join('、') || '无') + '；解空间还剩 ' + result.dimFree + ' 个自由参数。')));
      bl.push(stateGrid(model, snapAll, -1, [S('蓝色 = 题设，绿色 = 已推出，灰色字母 = 无法唯一确定。')]));
      if (result.examples) {
        bl.push(P(S('下面两种填法都满足全部已知条件' + (result.domain && result.domain.kind === 'integer' ? '（且每个数都是整数）' : '') + '，但未确定的格子取值不同——这正说明这些格子无法由已知数推出：')));
        for (let i = 0; i < result.examples.length; i++) {
          const ex = result.examples[i];
          const cells = ex.cells.map(function (t, idx) {
            const isUnd = result.undeterminedCells.indexOf(idx) >= 0;
            const isGiv = result.givens.some(function (g) { return g.coord === idx; });
            return { text: t, kind: isUnd ? 'diff' : (isGiv ? 'given' : 'derived') };
          });
          bl.push(GRID(n, cells, [S('填法' + '一二'.charAt(i) + '（幻和 S = ' + ex.S + '）')]));
        }
      }
    }

    // 值域限定说明
    if (result.domain && result.domain.kind !== 'none') {
      bl.push(H3('值域限定：「' + result.domain.note + '」'));
      if (result.domain.S) {
        bl.push(P(S('由限定「' + result.domain.note + '」，全部数字之和 = ' + result.domain.total + '，' + n + ' 条行线恰好覆盖全部格子一次，所以 ' + n + '·S = ' + result.domain.total + '，即 '), B('S = ' + result.domain.S), S('（第 1 步已证）。此后每一步都能直接使用幻和。')));
      } else if (result.domain.kind === 'integer') {
        bl.push(P(S('限定“只允许整数”：解出的每个数都必须是整数。程序会检查所有可确定的数是否都是整数，并尝试构造一组整数填法作为存在性见证。')));
      }
    }
    if (result.integer) {
      if (result.integer.feasible === true) {
        bl.push(P(S('整数解存在性：已找到一组全部为整数的填法 ✓（例如 S = ' + result.integer.S + '）。')));
      } else if (result.integer.reason) {
        bl.push(P(S(result.integer.reason, { cls: 'err' })));
      }
    }

    // 穷举验证（有限值域）
    if (result.csp && result.csp.ok) {
      bl.push(H3('穷举验证（在限定数字范围内枚举所有合法填法）'));
      if (result.csp.exhaustive) {
        bl.push(P(S('共穷尽得到 '), B(result.csp.count + ' 种'), S('合法填法（无遗漏）。')));
        if (result.csp.count === 1) {
          bl.push(P(S('只有一种填法 ⇒ 所有格子都被唯一确定，这就是唯一的解。')));
        } else {
          const extra = result.csp.extras || [];
          const stableSet = new Set(result.csp.stableCells || []);
          const stableNames = [];
          for (const c of stableSet) {
            const e = result.knownEntries.find(function (x) { return x.coord === c; });
            if (e && c !== result.model.SC) stableNames.push(result.model.letters[c]);
          }
          bl.push(P(S('在这 ' + result.csp.count + ' 种填法里，'), B(stableNames.length ? stableNames.join('、') : '（没有）'),
            S(' 每次都取相同的值——所以它们是确定解（填别的数就无解）；其余格子在不同填法里会变，说明现有已知数定不住它们。')));
          if (extra.length > 0) {
            bl.push(P(S('其中 ' + extra.map(function (c) { return result.model.letters[c]; }).join('、') + ' 是线性推导推不出、但穷举能确定的（已作为最后一步自动填入）。')));
          }
          if (result.csp.samples && result.csp.samples.length > 1) {
            for (let q = 0; q < Math.min(2, result.csp.samples.length); q++) {
              const cells = result.csp.samples[q].map(function (t, idx) {
                const isGiv = result.givens.some(function (g) { return g.coord === idx; });
                return { text: t, kind: isGiv ? 'given' : (stableSet.has(idx) ? 'derived' : 'diff') };
              });
              bl.push(GRID(n, cells, [S('合法填法示例 ' + (q + 1) + ' / ' + result.csp.count)]));
            }
          }
        }
      } else {
        bl.push(P(S('搜索达到计算上限（已找到 ' + result.csp.count + ' 种合法填法，但未穷尽），因此只采用线性可严格证明的结论；未穷尽的搜索不能作为“确定”的依据。', { cls: 'dim' })));
      }
    }

    // 随机试解验证
    const sp = result.sampling;
    if (sp) {
      if (sp.illustrative) {
        // 整数限定：给出若干组全整数填法作为示例（不作“确定”的完备性证明）
        bl.push(H3('整数填法示例（对应「只允许整数」）'));
        const varying = new Set(sp.varyingCells || []);
        bl.push(P(S('下面给出 ' + sp.count + ' 组'), B('全部为整数'), S('的填法（都满足已知条件）。红色格子在示例中取值不同，说明现有已知数确实定不住它们；')));
        bl.push(P(S('绿色只是在本例这几组里相同，' + '不作为“确定”的证明——某个数是否确定，以上面逐步推导的结论为准。', { cls: 'dim' })));
        for (let q = 0; q < sp.samples.length; q++) {
          const cells = sp.samples[q].map(function (t, idx) {
            const isGiv = result.givens.some(function (g) { return g.coord === idx; });
            return { text: t, kind: isGiv ? 'given' : (varying.has(idx) ? 'diff' : 'derived') };
          });
          bl.push(GRID(n, cells, [S('整数填法示例 ' + (q + 1) + ' / ' + sp.count)]));
        }
      } else if (sp.unique) {
        bl.push(H3('随机试解验证（换个角度看“能否确定”）'));
        bl.push(P(S('在全部已知条件下随机试解：无论怎么取，只能得到同一组数——说明每个格子都被唯一确定（这也与上面逐格推出的结果一致）。')));
      } else {
        bl.push(H3('随机试解验证（换个角度看“能否确定”）'));
        const stable = new Set(sp.stableCells);
        bl.push(P(S('在满足全部已知条件的解空间里随机取了 '), B(sp.count + ' 组'), S(' 解（下面展示其中 3 组；红色 = 各次取值不同的格子，绿色 = 每次都相同的格子）：')));
        bl.push(P(S('每次都取相同值的格子，恰好就是上面推出的那些格子（与线性判定' + (sp.agreeWithLinear ? '完全一致 ✓' : '不一致 ✗（不应发生）') + '）。这正说明：往这些格子里填别的数字就无解——它们是确定解，所以程序自动填上了；红色格子还能变，说明现有已知数定不住它们。')));
        for (let q = 0; q < sp.samples.length; q++) {
          const cells = sp.samples[q].map(function (t, idx) {
            const isGiv = result.givens.some(function (g) { return g.coord === idx; });
            return { text: t, kind: isGiv ? 'given' : (stable.has(idx) ? 'derived' : 'diff') };
          });
          bl.push(GRID(n, cells, [S('随机解 ' + (q + 1) + ' / ' + sp.count)]));
        }
      }
    }

    bl.push(H3('填数顺序一览'));
    const rows = [];
    for (const g of result.givens) rows.push([S('题设'), S(g.label), S(g.valueStr), S('题目给定'), S('—')]);
    for (const st of result.steps) {
      rows.push([
        S('第' + st.i + '步'),
        S(st.isS ? 'S' : st.label),
        S(st.valueStr),
        S(st.theorem ? st.theorem.name : '线性恒等式'),
        S(st.premises.map(function (p) { return p.label + '(' + p.source.replace('第', '第').replace('步', '步') + ')'; }).join('、'))
      ]);
    }
    bl.push(TBL([S('顺序'), S('目标'), S('数值'), S('依据'), S('用到的已知数')], rows));

    if (result.verification) {
      bl.push(H3('验证（全部线之和相等）'));
      bl.push(TBL(
        [S('线'), S('逐项相加'), S('和'), S('与 S 比较')],
        result.verification.rows.map(function (r) { return [S(r.name), S(r.terms), S(r.sum), S(r.ok ? '✓ 相等' : '✗ 不等', { cls: r.ok ? 'ok' : 'err' })]; })
      ));
    }
    return bl;
  }

  /* ---- 主入口 ---- */
  function buildDocument(result) {
    const pages = [];
    if (!result.ok) {
      pages.push([{ t: 'title', text: '无法求解' }, P(S(result.error, { cls: 'err' }))]);
      return { pages: pages, title: '幻方求解' };
    }
    const intro = introBlocks(result);
    intro.push(BRK());
    pages.push(intro);
    for (const st of result.steps) {
      const bl = stepBlocks(result, st);
      bl.push(BRK());
      pages.push(bl);
    }
    pages.push(summaryBlocks(result));
    return { pages: pages, title: result.n + ' 阶幻方求解' };
  }

  return { buildDocument: buildDocument, stepBlocks: stepBlocks, identityStr: identityStr, signedJoin: signedJoin };
});
