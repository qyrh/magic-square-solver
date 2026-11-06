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

  /* ---- 单步页面 ---- */
  function stepBlocks(result, step) {
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
    } else {
      const lam = step.identity.lambda;
      const T = step.identity.T;
      const tech = step.identity.tech || 4;
      pb.push(P(S(n + ' 阶幻方中，每条行、列及两条对角线的和都等于同一个幻和 S。本步用到下列线（系数用于加权求和）：')));
      pb.push(TBL(
        [S('系数'), S('这条线的和'), S('是哪条线')],
        lam.map(function (L) {
          let coeffStr;
          if (L.coeff < 0) { coeffStr = String(L.coeff); } else { coeffStr = '+' + L.coeff; }
          return [S(coeffStr), S('(' + L.cells.map(function (c) { return model.letters[c]; }).join(' + ') + ')'), S(L.name)];
        })
      ));

      // 技巧一（幻和直用）/ 技巧二（两线去交叉）/ 技巧三（多线容斥）：画块示意
      const reg = step.identity.regions;
      if (reg && (reg.red.length || reg.blue.length)) {
        const redSet = new Map(reg.red.map(function (e) { return [e.cell, e.count]; }));
        const blueSet = new Map(reg.blue.map(function (e) { return [e.cell, e.count]; }));
        const cells = [];
        for (let i = 0; i < model.N; i++) {
          if (redSet.has(i)) cells.push({ text: regionCellStr(model, { cell: i, count: redSet.get(i) }), kind: 'red' });
          else if (blueSet.has(i)) cells.push({ text: regionCellStr(model, { cell: i, count: blueSet.get(i) }), kind: 'blue' });
          else cells.push({ text: '·', kind: 'dot' });
        }
        pb.push(P(S(tech === 2
          ? '画块示意（两线去交叉）：两条线的和相等，先去掉它们的交叉格（两边各一个，正好抵消），剩下的红、蓝两部分的和也相等：'
          : '画块示意（多线去交叉）：把系数为正的线相加、系数为负的线相减，重叠的格子成对抵消，只剩下红色的格子与蓝色的格子（×n 表示出现 n 次）：')));
        pb.push(GRID(model.n, cells, [
          S('红色部分的和', { cls: 'err', b: 1 }), S(' = ', { b: 1 }),
          S('蓝色部分的和' + (T === 0 ? '' : ' + ' + T + '×S'), { cls: 'given', b: 1 }),
          S('　（灰点 = 已抵消/未涉及的格子）')
        ]));
        const redEq = regionStr(model, reg.red);
        const blueEq = regionStr(model, reg.blue);
        let eqText = redEq + ' = ';
        if (T === 0) eqText += blueEq;
        else eqText += (reg.blue.length ? blueEq + ' + ' : '') + T + '×S';
        pb.push(P(S('用字母写就是：'), B(eqEqSafe(eqText)), S('，整理即得'), B('　' + identityStr(step) + '　'), S('。')));
      }

      pb.push(P(S('把它们按系数加权相加：左边 = '), B(expansionStr(step)), S('；右边 = ' + coeffListStr(lam) + '×S = ' + T + '×S。')));
      pb.push(P(S('于是 '), B(expansionStr(step) + ' = ' + T + '×S'), S('，移项整理得'), B('　' + identityStr(step) + '　'), S('。证毕。∎')));
      // 通俗解释（按技巧分级给说法）
      const posL = lam.filter(function (L) { return L.coeff > 0; }).map(function (L) { return L.name; });
      const negL = lam.filter(function (L) { return L.coeff < 0; }).map(function (L) { return L.name; });
      let col;
      if (tech === 1) {
        col = '通俗地说：这条线上 ' + n + ' 个数的和就是幻和 S，所以线上缺哪个数，用 S 减去其余的数就得到了。';
      } else if (reg && (reg.red.length || reg.blue.length)) {
        const rs = regionStr(model, reg.red), bs = regionStr(model, reg.blue);
        col = '通俗地说：每条线的和都等于 S，所以“红线组加起来”与“蓝线组加起来”里的重叠格子两边各出现同样多次，互相抵消（容斥），剩下：' + rs + ' = ' + (T === 0 ? bs : bs + ' + ' + T + '×S') + '。这就是“去掉交叉部分，剩余部分之和相等”的技巧。';
      } else if (T === 0) {
        col = '通俗地说：这些线的和全是同一个数 S。把带正号的线（' + posL.join('、') + '）的“和”全部加起来，再减去带负号的线（' + (negL.join('、') || '无') + '）的“和”，右边的 S 恰好全部抵消；左边逐个字母清点，出现次数相同的字母相互抵消，只剩下 ' + expansionStr(step) + ' = 0，即 ' + identityStr(step) + '。';
      } else {
        col = '通俗地说：这些线的和全是同一个数 S。把它们按系数加权相加，右边就是 ' + T + '×S；左边逐个字母清点、合并同类项，得到 ' + expansionStr(step) + '。两边相等并移项，就得到 ' + identityStr(step) + '。';
      }
      col += '这个关系对任何 ' + n + ' 阶幻方都成立。';
      pb.push(P(S(col, { cls: 'dim' })));
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
        bl.push(P(S('下面两种填法都满足全部已知条件，但未确定的格子取值不同——这正说明这些格子无法由已知数推出：')));
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

    // 随机试解验证
    const sp = result.sampling;
    if (sp) {
      bl.push(H3('随机试解验证（换个角度看“能否确定”）'));
      if (sp.unique) {
        bl.push(P(S('在全部已知条件下随机试解：无论怎么取，只能得到同一组数——说明每个格子都被唯一确定（这也与上面逐格推出的结果一致）。')));
      } else {
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
