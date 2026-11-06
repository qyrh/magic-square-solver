/* app.js —— 界面逻辑：输入即出数（回填填写框）、撤回/重做、点击查阅推导、
 *           快速模式（仅出数）/完整模式（点“求解”看逐步证明，证明默认折叠）、分页、导出 */
(function () {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };

  const state = {
    n: 3, pages: [], current: 0, mode: 'step', result: null, token: 0, autoT: null,
    grid: { values: [], derived: [] },   // 填写框镜像：values=框内文本，derived=是否自动回填（非用户手输）
    history: [], redoStack: [], lastHist: null,
    view: 'none'                          // none | quick | full
  };

  /* ---------------- 填写框状态 / 撤回·重做 ---------------- */
  function gridSnapshot() {
    return { values: state.grid.values.slice(), derived: state.grid.derived.slice() };
  }
  function pushHistory(cellIdx) {
    const now = Date.now();
    if (cellIdx != null && state.lastHist && state.lastHist.cell === cellIdx && now - state.lastHist.t < 1200) {
      state.lastHist.t = now; return;   // 同一格连续输入合并为一条历史
    }
    state.history.push(gridSnapshot());
    if (state.history.length > 120) state.history.shift();
    state.redoStack.length = 0;
    state.lastHist = cellIdx != null ? { cell: cellIdx, t: now } : null;
    updateUndoButtons();
  }
  function applySnapshot(snap) {
    state.grid.values = snap.values.slice();
    state.grid.derived = snap.derived.slice();
    writeInputsFromState();
    updateUndoButtons();
    scheduleAuto(0);
  }
  function undoGrid() {
    if (!state.history.length) return;
    state.redoStack.push(gridSnapshot());
    applySnapshot(state.history.pop());
    state.lastHist = null;
  }
  function redoGrid() {
    if (!state.redoStack.length) return;
    state.history.push(gridSnapshot());
    applySnapshot(state.redoStack.pop());
    state.lastHist = null;
  }
  function updateUndoButtons() {
    $('btnUndo').disabled = state.history.length === 0;
    $('btnRedo').disabled = state.redoStack.length === 0;
  }
  function writeInputsFromState() {
    const inputs = $('gridBox').querySelectorAll('input');
    inputs.forEach(function (inp) {
      const i = Number(inp.dataset.idx);
      inp.value = state.grid.values[i] || '';
      inp.classList.remove('bad');
      inp.classList.toggle('derived-val', !!state.grid.derived[i]);
    });
  }
  /* 把“能确定的数”回填到填写框；不再可定的自动清除 */
  function autofillDerived(result) {
    const inputs = $('gridBox').querySelectorAll('input');
    for (let i = 0; i < result.finalCells.length; i++) {
      const fc = result.finalCells[i];
      const inp = inputs[i];
      if (fc && (state.grid.derived[i] || state.grid.values[i] === '')) {
        if (state.grid.values[i] !== fc.valueStr) {
          state.grid.values[i] = fc.valueStr;
          inp.value = fc.valueStr;
          inp.classList.add('just-filled');
          setTimeout(function () { inp.classList.remove('just-filled'); }, 700);
        }
        state.grid.derived[i] = true;
        inp.classList.add('derived-val');
      } else if (!fc && state.grid.derived[i]) {
        state.grid.values[i] = '';
        state.grid.derived[i] = false;
        inp.value = '';
        inp.classList.remove('derived-val');
      }
    }
  }
  function clearAllDerived() {
    const inputs = $('gridBox').querySelectorAll('input');
    for (let i = 0; i < state.grid.derived.length; i++) {
      if (state.grid.derived[i]) {
        state.grid.values[i] = '';
        state.grid.derived[i] = false;
        inputs[i].value = '';
        inputs[i].classList.remove('derived-val');
      }
    }
  }

  /* ---------------- 输入表格（正方形格子） ---------------- */
  function lettersFor(n) {
    const arr = [];
    for (let i = 0; i < n * n; i++) arr.push(n <= 5 ? String.fromCharCode(97 + i) : ('r' + (Math.floor(i / n) + 1) + 'c' + (i % n + 1)));
    return arr;
  }

  function buildInputs(n) {
    state.n = n;
    state.grid.values = new Array(n * n).fill('');
    state.grid.derived = new Array(n * n).fill(false);
    state.history = []; state.redoStack = []; state.lastHist = null;
    updateUndoButtons();
    const box = $('gridBox');
    box.innerHTML = '';
    const tb = document.createElement('table');
    tb.className = 'inp' + (n >= 6 ? ' small' : '');
    const letters = lettersFor(n);
    for (let r = 0; r < n; r++) {
      const tr = document.createElement('tr');
      for (let c = 0; c < n; c++) {
        const td = document.createElement('td');
        const lab = document.createElement('i');
        lab.textContent = letters[r * n + c];
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.dataset.idx = String(r * n + c);
        inp.setAttribute('placeholder', '·');
        inp.title = '可填整数/分数/小数；绿色斜体 = 自动推出（双击看证明），直接输入即变为已知数';
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); solve(); }
          if (e.key === 'ArrowRight' && this.selectionStart === this.value.length) { moveFocus(r, c + 1); }
          if (e.key === 'ArrowLeft' && this.selectionStart === 0) { moveFocus(r, c - 1); }
          if (e.key === 'ArrowUp') { moveFocus(r - 1, c); }
          if (e.key === 'ArrowDown') { moveFocus(r + 1, c); }
        });
        // 输入即自动出数（防抖）；手输即视为“已知数”（覆盖自动回填）
        inp.addEventListener('input', function () {
          const idx = Number(this.dataset.idx);
          pushHistory(idx);
          this.classList.remove('bad');
          state.grid.values[idx] = this.value.trim();
          if (state.grid.derived[idx]) {
            state.grid.derived[idx] = false;
            this.classList.remove('derived-val');
          }
          scheduleAuto();
        });
        // 双击自动回填的数 → 查看该数的推导证明
        inp.addEventListener('dblclick', function () {
          const idx = Number(this.dataset.idx);
          if (!state.grid.derived[idx] || !state.result) return;
          const fc = state.result.finalCells[idx];
          if (fc && fc.source != null) openStepModal(fc.source);
        });
        td.appendChild(lab); td.appendChild(inp);
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    }
    box.appendChild(tb);
    function moveFocus(r, c) {
      if (r < 0 || c < 0 || r >= n || c >= n) return;
      const el2 = box.querySelector('input[data-idx="' + (r * n + c) + '"]');
      if (el2) el2.focus();
    }
  }

  function setGrid(values) { // 用户动作（预设/批量/清空后调用）
    const inputs = $('gridBox').querySelectorAll('input');
    inputs.forEach(function (inp) {
      const i = Number(inp.dataset.idx);
      const v = values[i];
      state.grid.values[i] = v == null ? '' : String(v);
      state.grid.derived[i] = false;
      inp.value = state.grid.values[i];
      inp.classList.remove('bad');
      inp.classList.remove('derived-val');
    });
    scheduleAuto(0);
  }

  /* ---------------- 自动出数 ---------------- */
  function scheduleAuto(delay) {
    if (!$('autoSolve').checked) return;
    clearTimeout(state.autoT);
    state.autoT = setTimeout(function () { solve({ auto: true }); }, delay === 0 ? 0 : 650);
  }

  /* ---------------- 预置示例 ---------------- */
  const PRESETS = {
    two: { n: 3, cells: ['1', '', '', '', '', '', '', '', '9'] },
    loshu: { n: 3, cells: ['2', '7', '', '', '5', '', '', '', ''] },
    frac: { n: 3, cells: ['1/2', '1/3', '', '', '2.75', '', '', '', ''] },
    durer: { n: 4, cells: ['16', '3', '2', '13', '5', '10', '11', '', '', '', '7', '', '4', '', '', ''] },
    corner: { n: 4, cells: ['16', '', '', '13', '', '', '', '', '', '', '', '', '4', '', '', '1'] }
  };

  async function randomPuzzle(n) {
    const model = MagicCore.buildModel(n);
    const F = MagicCore.Frac;
    let cells = new Array(model.N).fill(new F(0)), S = new F(0);
    const rnd = function (lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); };
    for (const b of model.basis) {
      const k = rnd(-3, 3);
      for (let i = 0; i < model.N; i++) cells[i] = cells[i].add(b[i].mul(new F(k)));
      S = S.add(b[model.SC].mul(new F(k)));
    }
    const shift = rnd(1, 6);
    for (let i = 0; i < model.N; i++) cells[i] = cells[i].add(new F(shift));
    S = S.add(new F(shift * n));
    let idxs = Array.from({ length: model.N }, function (_, i) { return i; });
    for (let i = idxs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = idxs[i]; idxs[i] = idxs[j]; idxs[j] = t; }
    let keep = idxs.slice();
    let cnt = 0;
    for (const i of idxs) {
      const trial = keep.filter(function (x) { return x !== i; });
      const det = MagicCore.determinedSetForCoords(model, trial);
      if (det.length === model.N + 1) keep = trial;
      if (++cnt % 3 === 0) await new Promise(function (r) { setTimeout(r, 0); });
    }
    const out = new Array(model.N).fill(null);
    for (const i of keep) out[i] = MagicCore.fmtNumber(cells[i]);
    return out;
  }

  document.querySelectorAll('[data-preset]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const key = btn.dataset.preset;
      if (key === 'random') {
        const n = Number($('selN').value);
        buildInputs(n);
        btn.disabled = true; btn.textContent = '生成中…';
        const vals = await randomPuzzle(n);
        pushHistory();
        setGrid(vals);
        btn.disabled = false; btn.textContent = '随机出题';
      } else {
        const p = PRESETS[key];
        $('selN').value = String(p.n);
        buildInputs(p.n);
        pushHistory();
        setGrid(p.cells);
      }
      $('inputErr').textContent = '';
    });
  });

  $('selN').addEventListener('change', function () {
    buildInputs(Number(this.value));
    setQuickBar(null);
    scheduleAuto(0);
  });
  $('btnUndo').addEventListener('click', undoGrid);
  $('btnRedo').addEventListener('click', redoGrid);
  $('btnClear').addEventListener('click', function () {
    pushHistory();
    setGrid(new Array(state.n * state.n).fill(''));
    $('inputErr').textContent = '';
    setQuickBar(null);
  });
  $('btnBatchToggle').addEventListener('click', function () {
    const b = $('batchBox'); b.style.display = b.style.display === 'none' ? '' : 'none';
  });
  $('btnBatchApply').addEventListener('click', function () {
    const lines = $('batchText').value.trim().split(/\n+/).filter(Boolean);
    if (!lines.length) return;
    const n = lines.length;
    if (n > 8) { $('inputErr').textContent = '批量输入最多支持 8 阶。'; return; }
    $('selN').value = String(n);
    buildInputs(n);
    const vals = new Array(n * n).fill('');
    lines.forEach(function (line, r) {
      line.split(/[\s,，;；]+/).filter(function (x) { return x !== ''; }).forEach(function (tok, c) {
        if (c >= n || r >= n) return;
        vals[r * n + c] = (tok === '-' || tok === '.') ? '' : tok;
      });
    });
    pushHistory();
    setGrid(vals);
  });

  /* ---------------- 求解 ---------------- */
  async function solve(opts) {
    opts = opts || {};
    clearTimeout(state.autoT);
    state.token += 1;
    const tok = state.token;

    const n = state.n;
    const given = new Map();
    const errs = [];
    $('gridBox').querySelectorAll('input').forEach(function (inp) {
      inp.classList.remove('bad');
      const idx = Number(inp.dataset.idx);
      const raw = inp.value.trim();
      if (raw === '') return;
      if (state.grid.derived[idx]) return;   // 自动回填的数不作为已知数（保持“推导”的教学过程）
      try {
        given.set(idx, MagicCore.parseNumberString(raw));
      } catch (e) {
        inp.classList.add('bad');
        errs.push('第' + (Math.floor(idx / n) + 1) + '行第' + (idx % n + 1) + '列：' + e.message);
      }
    });
    if (errs.length) { $('inputErr').textContent = errs.join('\n'); return; }
    $('inputErr').textContent = '';

    const btn = $('btnSolve');
    btn.disabled = true; btn.textContent = '求解中…';
    try {
      const result = await MagicCore.solveMagicAsync(n, given, {
        onProgress: function (p) { btn.textContent = '求解中…（剩 ' + p.pending + ' 个待定）'; }
      });
      if (tok !== state.token) { btn.disabled = false; btn.textContent = '求 解'; return; }
      btn.disabled = false; btn.textContent = '求 解';
      if (!result.ok) {
        clearAllDerived();
        setQuickBar(null);
        $('inputErr').textContent = result.error;
        return;
      }
      state.result = result;
      autofillDerived(result);

      if (opts.auto) {
        // 快速模式：只出数（回填填写框）+ 状态条；不给证明过程
        setQuickBar(result);
        return;
      }
      // 完整模式：点“求解”后给出逐步证明（证明默认折叠）
      setQuickBar(null);
      const doc = MagicRender.buildDocument(result);
      state.pages = doc.pages;
      state.current = 0;
      state.mode = 'step';
      $('selMode').value = 'step';
      await renderPages();
      if (tok !== state.token) return;
      $('result').style.display = 'block';
      $('quickBar').style.display = 'none';
      $('toolbar').style.display = '';
      $('pages').style.display = '';
      $('result').scrollIntoView({ behavior: 'instant', block: 'start' });
    } catch (e) {
      if (tok !== state.token) { btn.disabled = false; btn.textContent = '求 解'; return; }
      btn.disabled = false; btn.textContent = '求 解';
      $('inputErr').textContent = '求解出错：' + e.message;
    }
  }
  $('btnSolve').addEventListener('click', function () { solve(); });

  /* 快速模式状态条 */
  function setQuickBar(result) {
    const bar = $('quickBar');
    const toolbar = $('toolbar');
    if (!result) {
      bar.style.display = 'none';
      if (state.view === 'full') return;
      toolbar.style.display = 'none';
      $('pages').style.display = 'none';
      state.view = 'none';
      return;
    }
    state.view = 'quick';
    toolbar.style.display = 'none';
    $('pages').style.display = 'none';
    const det = result.finalCells.filter(Boolean).length;
    let html = '';
    if (result.complete) {
      html += '<b>已全部解出！</b>' + result.model.N + ' 个格子都已确定并自动填入（蓝色=你输入的，绿色=自动推出）。';
    } else {
      html += '当前能确定 <b>' + det + ' / ' + result.model.N + '</b> 个格子，已自动填入填写框；其余 ' +
        result.undeterminedCells.length + ' 格在现有已知下无法唯一确定（剩 ' + result.dimFree + ' 个自由参数）。';
    }
    html += result.S ? '　幻和 S = <b>' + result.S.valueStr + '</b>。' : '　幻和 S 尚未确定。';
    html += '<br><span class="dim">点 <b>“求 解”</b> 查看逐步最简证明（含字母推导与画块示意，证明默认折叠）；双击绿色数字可查看它的推导依据。</span>';
    bar.innerHTML = html;
    bar.style.display = '';
    $('result').style.display = 'block';
  }

  /* ---------------- 页面渲染 ---------------- */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function renderSegs(container, segs) {
    for (const s of segs) {
      const span = el('span', s.cls || '', s.text);
      if (s.b) span.style.fontWeight = '700';
      container.appendChild(span);
    }
  }

  /* 立体分数 HTML（仅由数字构成，安全） */
  function fracHtml(text) {
    const m = /^(-?)(\d+)\/(\d+)$/.exec(text);
    if (!m) return null;
    const sign = m[1] ? '<span class="fsign">−</span>' : '';
    return sign + '<span class="frac"><span class="num">' + m[2] + '</span><span class="den">' + m[3] + '</span></span>';
  }
  function cellMetric(t) {
    const m = /^(-?)(\d+)\/(\d+)$/.exec(t);
    if (m) return Math.max(m[2].length, m[3].length) + (m[1] ? 1 : 0) + 1;
    return t.length;
  }
  function applySquareSize(tb, cells) {
    let maxM = 1;
    for (const c of cells) { if (c && c.text) maxM = Math.max(maxM, cellMetric(c.text)); }
    const px = Math.max(46, Math.min(116, Math.round(12.5 * maxM + 22)));
    tb.style.setProperty('--ms-cell', px + 'px');
    if (maxM >= 5) tb.classList.add('compact');
  }

  function renderBlock(pageDiv, b) {
    if (b.t === 'title') { pageDiv.appendChild(el('div', 'doc-title', b.text)); return; }
    if (b.t === 'h2') { pageDiv.appendChild(el('div', 'blk-h2', b.text)); return; }
    if (b.t === 'h3') { pageDiv.appendChild(el('div', 'blk-h3', b.text)); return; }
    if (b.t === 'p') { const p = el('p', 'blk-p'); renderSegs(p, b.segs); pageDiv.appendChild(p); return; }
    if (b.t === 'proof') {
      // 证明区：默认折叠、可展开（打印/导出时自动展开）
      const det = document.createElement('details');
      det.className = 'proof-details';
      const sum = document.createElement('summary');
      sum.textContent = '▶ 证明（对任意 ' + (b.title || '幻方') + '成立）——点击展开 / 再次点击折叠';
      det.appendChild(sum);
      const body = el('div', 'proof-body');
      for (const sub of b.blocks) renderBlock(body, sub);
      det.appendChild(body);
      pageDiv.appendChild(det);
      return;
    }
    if (b.t === 'grid' || b.t === 'table') {
      const tb = document.createElement('table');
      tb.className = b.t === 'grid' ? 'ms' : 'data';
      if (b.t === 'grid') {
        applySquareSize(tb, b.cells);
        for (let r = 0; r < b.n; r++) {
          const tr = document.createElement('tr');
          for (let c = 0; c < b.n; c++) {
            const cell = b.cells[r * b.n + c] || { text: '', kind: 'dot' };
            const td = document.createElement('td');
            td.className = 'k-' + (cell.kind || 'dot');
            const fh = (cell.kind === 'given' || cell.kind === 'derived' || cell.kind === 'new') ? fracHtml(cell.text) : null;
            if (fh) td.innerHTML = fh; else td.textContent = cell.text;
            if ((cell.kind === 'derived' || cell.kind === 'new') && cell.source != null) {
              td.classList.add('clickable');
              td.dataset.step = String(cell.source);
              td.title = '点击查看：这个数是根据哪几个数推出的';
            }
            tr.appendChild(td);
          }
          tb.appendChild(tr);
        }
      } else {
        const trh = document.createElement('tr');
        for (const h of b.head) { const th = document.createElement('th'); renderSegs(th, Array.isArray(h) ? h : [h]); trh.appendChild(th); }
        tb.appendChild(trh);
        for (const row of b.rows) {
          const tr = document.createElement('tr');
          for (const cell of row) {
            const td = document.createElement('td');
            renderSegs(td, Array.isArray(cell) ? cell : [cell]);
            tr.appendChild(td);
          }
          tb.appendChild(tr);
        }
      }
      pageDiv.appendChild(tb);
      if (b.caption) {
        const cap = el('div', 'grid-cap');
        renderSegs(cap, b.caption);
        pageDiv.appendChild(cap);
      }
      return;
    }
  }
  async function renderPages() {
    const box = $('pages');
    box.innerHTML = '';
    for (let i = 0; i < state.pages.length; i++) {
      const div = el('div', 'page');
      for (const b of state.pages[i]) renderBlock(div, b);
      box.appendChild(div);
      if (i % 2 === 1) await new Promise(function (r) { setTimeout(r, 0); });
    }
    applyMode();
  }
  function applyMode() {
    const pages = $('pages').children;
    for (let i = 0; i < pages.length; i++) {
      pages[i].classList.toggle('pg-hidden', state.mode === 'step' && i !== state.current);
    }
    const stepping = state.mode === 'step' && pages.length > 0;
    $('btnPrev').disabled = !stepping || state.current === 0;
    $('btnNext').disabled = !stepping || state.current === pages.length - 1;
    $('pgInfo').textContent = stepping ? (state.current + 1) + ' / ' + pages.length : '共 ' + pages.length + ' 页';
  }
  $('btnPrev').addEventListener('click', function () {
    if (state.current > 0) { state.current--; applyMode(); }
  });
  $('btnNext').addEventListener('click', function () {
    if (state.current < state.pages.length - 1) { state.current++; applyMode(); }
  });
  $('selMode').addEventListener('change', function () { state.mode = this.value; applyMode(); });

  /* 展开全部证明 / 折叠全部证明 */
  $('btnProofs').addEventListener('click', function () {
    const all = document.querySelectorAll('#pages details.proof-details');
    let anyClosed = false;
    all.forEach(function (d) { if (!d.open) anyClosed = true; });
    all.forEach(function (d) { d.open = anyClosed; });
    $('btnProofs').textContent = anyClosed ? '📕 折叠全部证明' : '📖 展开全部证明';
  });
  window.addEventListener('beforeprint', function () {
    document.querySelectorAll('#pages details.proof-details').forEach(function (d) { d.open = true; });
  });

  /* ---------------- 点击查阅：这个数根据哪几个数推出 ---------------- */
  $('pages').addEventListener('click', function (ev) {
    const td = ev.target.closest('td[data-step]');
    if (td) openStepModal(Number(td.dataset.step));
  });

  function openStepModal(stepIdx) {
    const st = state.result && state.result.steps[stepIdx - 1];
    if (!st) return;
    const mask = document.createElement('div');
    mask.className = 'modal-mask no-print';
    const box = document.createElement('div');
    box.className = 'modal';
    const close = document.createElement('button');
    close.className = 'ghost modal-close';
    close.textContent = '✕';
    close.addEventListener('click', function () { mask.remove(); });
    mask.addEventListener('click', function (e) { if (e.target === mask) mask.remove(); });
    box.appendChild(close);

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = '这个数是根据哪几个数推出的？——' + (st.isS ? '幻和 S' : '格子 ' + st.label + '（第' + st.cell.r + '行第' + st.cell.c + '列）') + ' = ' + st.valueStr + '（第 ' + st.i + ' 步）';
    box.appendChild(title);

    const p = el('p', 'blk-p');
    renderSegs(p, [
      { text: '根据 ' },
      ...st.premises.map(function (q, i) {
        return { text: (i ? '、' : '') + q.label + ' = ' + q.valueStr + '（' + q.source + '）', cls: q.sourceIdx == null ? 'given' : 'derived', b: 1 };
      }),
      { text: '  ⇒  ' },
      { text: (st.isS ? 'S' : st.label) + ' = ' + st.valueStr, cls: 'new', b: 1 },
      { text: st.theorem ? '　依据：' + st.theorem.name : '　依据：线性恒等式（证明见下）', cls: 'dim' }
    ]);
    box.appendChild(p);

    const blocks = MagicRender.stepBlocks(state.result, st);
    const body = document.createElement('div');
    for (let i = 1; i < blocks.length; i++) renderBlock(body, blocks[i]);
    // 弹窗内证明直接展开（用户就是来看证明的）
    body.querySelectorAll('details.proof-details').forEach(function (d) { d.open = true; });
    box.appendChild(body);
    mask.appendChild(box);
    document.body.appendChild(mask);
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      const m = document.querySelector('.modal-mask');
      if (m) m.remove();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undoGrid(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redoGrid(); return; }
    if ($('result').style.display === 'none' || state.mode !== 'step') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') $('btnNext').click();
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') $('btnPrev').click();
  });

  /* ---------------- 导出 ---------------- */
  $('btnPrint').addEventListener('click', function () { window.print(); });
  $('btnDocx').addEventListener('click', function () {
    try {
      const bytes = MagicDocx.buildDocx(state.pages, document.title);
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '幻方求解-证明过程.docx';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch (e) {
      alert('导出失败：' + e.message);
    }
  });

  /* ---------------- 初始化 ---------------- */
  buildInputs(3);
  updateUndoButtons();
})();
