# 交接说明（HANDOFF）—— 给接手的新会话 AI

> 项目：幻方求解器（任意阶 · 分数/小数 · 逐步最简证明 · 值域限定 · 单文件应用）
> 目录：`D:\glm-db\.zcode\workspace\draft-85724259-c664-4d90-9290-644bc2e3e3dc\magic-square-solver\`
> 仓库：https://github.com/qyrh/magic-square-solver 　在线：https://qyrh.github.io/magic-square-solver/
> 单文件：`dist/幻方求解器.html`（由 `node build.js` 生成）
> 最后更新：2026-11-06（第 5 轮：去掉 1/2 阶、分数全立体、证明改“重合抵消”讲法、系数优先为 1）

## 0. 一分钟上手

```bash
cd magic-square-solver
node test-core.js     # 86 项断言（必须全过）
node test-docx.js     # 文档块 + DOCX 结构自检
node build.js         # 生成 dist/幻方求解器.html 单文件版（会自检无外链脚本）
# 浏览器：双击 dist/幻方求解器.html 或 index.html
```

改完代码**务必**：① `node test-core.js` 全过 ② `node build.js` 重新打包 ③ 更新 GitHub（见 §6）。

## 1. 文件职责

| 文件 | 职责 | 改这里的场景 |
| --- | --- | --- |
| `magic-core.js` | 纯算法：Frac 精确有理数、线性代数、推导引擎、CSP 穷举、值域限定、整数见证 | 求解/证明逻辑 |
| `render.js` | 求解结果 → 文档块（网页与 DOCX 共用中间表示） | 证明文字/版式结构 |
| `docx.js` | 文档块 → OOXML（自实现 store-zip + CRC32，无依赖） | 导出格式 |
| `app.js` | DOM：输入即出数、回填、撤回/重做、点击查阅、分页、导出 | 交互 |
| `index.html` | 页面骨架 + 全部 CSS（正方形格、立体分数、弹窗、折叠证明、打印） | 样式/控件 |
| `build.js` | 白名单内联四个脚本 → 单文件版 | 打包 |
| `test-core.js` / `test-docx.js` | 测试 | 加用例 |

数据流：输入 → `solveMagicAsync`（分阶段让出主线程）→ `result` →
`buildDocument(result)` → `pages[][]`（纯 JSON 块）→ HTML 渲染 / DOCX 导出。

## 2. 核心数据结构（改代码前必读）

`solveMagic(n, givenMap, opts)` / `solveMagicAsync` 返回：

```
result = {
  ok, n, N, model:{n,N,SC,m,letters,lines},
  givens:[{coord,label,valueStr,r,c}],
  steps:[ step... ],            // 含特殊步：special:'domain-S' | 'csp'
  knownEntries, finalCells,     // finalCells[i] = {valueStr, source}  source=步号或 null
  S:{valueStr,source}, complete, dimFree, undeterminedCells,
  examples, sampling,           // 无约束时的两个反例填法 / 随机试解
  verification,                 // 完整解时的线和对账表
  domain:{kind,note,S,total},   // 值域限定信息
  csp:{ok,exhaustive,count,samples,stableCells,refutedCells,extras},
  integer:{feasible,witness,S,reason},
  error
}
```

单步 `step`：

```
{ i, target, isS, label, valueStr, d, premises:[{coord,isS,label,coeff,valueStr,source,sourceIdx}],
  identity:{ gamma, T, terms, expansion, lambda:[{lineIdx,coeff,name,cells}], tech, regions:{red,blue} },
  theorem:{key,name} | null, refStep, involvedCells, snapshot:[{coord,valueStr,source}] }
```

`tech`（技巧分级，越小越简单）：1 幻和直用（单线）；2 两线去交叉；3 多线去交叉；4 一般加权。

## 3. 关键算法与不变量（重点，别破坏）

1. **可定性判定**：格子 k 可由已知集 K 确定 ⟺ 坐标泛函 e_k|MS ∈ span{e_c|MS}（`spanCoeffs`）。
2. **恒等式**：`γ·x_k = Σ α_c·z_c`，由“各线和=S”的 λ 加权组合构成；`solveIdentity` 内**必做三重校验**
   （逐格系数、S 系数、与整体特解数值一致）。任何改动都必须保持校验通过（不通过即抛错）。
3. **择优规则（2026-11-06 定稿）**：所有候选（每个待定目标 × 若干前提集 + 可直接构造的“幻和直用”）
   统一按 `score = [tech, Σ|λ|, 涉及格子数, 前提数, 定理名次, γ≠1, isS, target]` 取最小。
   - `lineCompletionIdentity`：补线法（S − 同线其余），tech=1，直接构造，**优先**；
   - `sLineIdentity`：整线求 S，tech=1；
   - 其余靠 `solveIdentity`，只为 `d ≤ minD+1` 的目标求解（控制计算量）。
   - 这条规则使用户要求的“先用幻和”与“避免带系数多行复杂证明”同时成立。
4. **值域限定**（`buildDomain`）：
   - `classic`：数字 1…n² 各一次；`total = n²(n²+1)/2`，`S = total/n` → 作为题设加入 `givensAll`
     并生成第 1 步 `special:'domain-S'`（推导步从 baseIndex=2 开始编号）；
   - `set`：自定义恰好 n² 个数，各一次，同理；
   - `integer`：`checkIntegerSolutions` 检查所有可确定值是否整数（否则无解），并用自由参数搜索
     找整数见证；
   - n≥5 不做 CSP（规模过大），只做线性推导。
5. **CSP 穷举**（`solveCSP`）：回溯 + 线剩余和剪枝 + 单格强制传播；`trail` 撤销必须 `pop` 同步
   （曾因未 pop 导致崩溃，见 §7 判例）。`exhaustive=true` 才能在“所有解中都相同”的意义上宣称确定。
6. **步号对齐**：`result.steps[k-1].i === k`（含特殊步）；`finalCells[i].source` 即步号，
   UI 的 `steps[source-1]` 依赖此不变量。

## 4. 界面要点（app.js / index.html）

- `#selDomain`（none/integer/classic/set）+ `#customSet` + `#btnSetApply`；`syncDomainUI()` 显隐。
- 自动出数：`scheduleAuto()` 防抖 650ms；`state.token` 防并发覆盖。
- 回填：`autofillDerived(result)` 写 `state.grid.values/derived`，绿斜体 `.derived-val`；
  **回填值不作为已知数**参与下一次求解（`solve()` 里 `if (state.grid.derived[idx]) return;`）。
- 撤回/重做：`pushHistory(cellIdx)`（同格 1.2s 内合并）、`undoGrid/redoGrid`、Ctrl+Z/Y。
- 快速/完整：`opts.auto` 时只更新 `#quickBar`；点“求解”才渲染证明页并显示 `#toolbar`。
- 证明折叠：`renderBlock` 的 `b.t==='proof'` → `<details>`，默认关闭；`#btnProofs` 一键展开/折叠；
  `beforeprint` 自动全展开；打印 CSS 强制展开。
- 点击查阅：`td[data-step]` → `openStepModal(stepIdx)`；弹窗内证明自动展开。

## 5. 已知限制 / 下一步可优化（按优先级）

1. **CSP 额外定格罕见**：3/4 阶多数场景 extras=0（线性已足够）。若要更强：加“行/列/对角线的
   候选集交集传播”（AC-3）或精确覆盖（DLX）。
2. **n≥5 无穷举**：可改为“只对未定格子做局部穷举/随机采样”，或引入 DLX + 时间片。
3. **整数限定只保证**：可确定值非整数 ⇒ 无解（严格）；找到见证 ⇒ 有解（严格）；
   两者都不成立时返回“未找到”（诚实但非严格）。可改用 HNF/Smith 标准形做严格整数可行性判定。
4. **择优是启发式**：`findMinimal` 对 ≥4 个前提用贪心收缩；`solveIdentity` 每个前提集只取一组解。
   若要“最短证明”严格最优，可对小规模枚举所有极小电路（matroid circuits）。
5. **DOCX 公式**为纯文本 + 段落边框近似分数线（未用 OMML）。
6. **无撤销之外的持久化**（无 localStorage 保存题目）。

## 6. 发布流程（GitHub + Pages）

本机直连 `github.com` 的 git 通道会超时（无代理），但 `api.github.com` 可用，因此**用 Contents API 上传**：

```bash
cd magic-square-solver
node build.js
# 逐文件上传（自动取 sha 覆盖）
python -X utf8 - <<'EOF'
import base64, subprocess, json, urllib.parse
REPO='qyrh/magic-square-solver'
files=['index.html','magic-core.js','render.js','docx.js','app.js','build.js',
       'test-core.js','test-docx.js','README.md','PROJECT-BRIEF.md','HANDOFF.md',
       'dist/幻方求解器.html','dist/README.md']
for f in files:
    with open(f,'rb') as fp: content=base64.b64encode(fp.read()).decode()
    enc=urllib.parse.quote(f)
    r=subprocess.run(['gh','api','repos/%s/contents/%s?ref=main'%(REPO,enc)],capture_output=True,text=True)
    sha=json.loads(r.stdout).get('sha') if r.returncode==0 else None
    p={'message':'update '+f,'content':content,'branch':'main'}
    if sha: p['sha']=sha
    r2=subprocess.run(['gh','api','repos/%s/contents/%s'%(REPO,enc),'-X','PUT','--input','-'],
                      input=json.dumps(p),capture_output=True,text=True)
    print(('OK  ' if r2.returncode==0 else 'FAIL')+' '+f+('' if r2.returncode==0 else ' :: '+r2.stderr[:150]))
EOF
# 等 30-60s 后验证 Pages 构建
gh api repos/qyrh/magic-square-solver/pages/builds/latest -q '.status'
```

**注意**：改了 `index.html` 里的 `?v=N` 版本号（防缓存），`build.js` 会把它一起内联，无需另改。

## 7. 踩坑判例（务必保留）

1. **不要在 Bash 里直接写源码**（Mimosa 安全钩子会拦）；用 Write/Edit 工具。
2. **Chrome 156 dev 的测试环境极不稳定**：纯忙循环/中等分配就会“Target crashed”，
   与代码无关；浏览器验证请用**罐头结果**（Node 先算好 `canned-results.json`，
   页面里替换 `MagicCore.solveMagicAsync`）隔离计算层，只测 UI。
3. **CSP 撤销必须 `trail.pop()`**：曾写成 `take(trail[last])` 不移除元素 → 死循环/崩溃。
4. **`rootCore()` 不能用 UMD 包装层的 `root`**（作用域不可见）→ 用 `typeof MagicCore !== 'undefined'`。
5. **结果区 `style.display = ''` 会回退到 CSS 的 `display:none`** → 必须设 `'block'`。
6. 曾因 BigInt JIT 崩溃整体改用 Number 整数对；现无 BigInt，勿引入。
7. 空串解析返回 `null`，`solve()` 里以 `raw === ''` 提前跳过。

## 8. 测试覆盖现状

- `test-core.js`：86 项——分数解析/显示、三阶两数、洛书顺序（对顶→幻和→补线）、分数混合、
  矛盾、丢勒四阶、四角定和、一/二阶、空输入、五阶一致性、全填满、
  **值域限定**（classic 幻和直得/唯一解/非法角无解/重复数字报错、integer 无解与见证、set 数量校验）。
- `test-docx.js`：文档块结构（含证明折叠块）、DOCX zip/OOXML 合法、立体分数分数线、正方形行高。
- 浏览器：域下拉/自定义集合显隐、自动出数回填、撤回重做、快速/完整切换、证明折叠、
  红蓝画块、点击弹窗、随机试解段落、DOCX 真实下载。

## 8.5 第 5 轮改动（务必保持）

1. **界面只提供 3–8 阶**（`index.html#selN` 已删除 1、2；核心仍支持 1/2 仅供测试）。
2. **分数必须立体显示**，三处都要：
   - 填写框：`app.js: inputsUpdateFrac()` 用 `.frac-ov` 覆盖层（输入框本身排不了上下分式；
     聚焦时显示原文本便于编辑，失焦恢复分式）；
   - 证明/总结区：`renderTextWithFrac()` 把正文里的 `33/4` 之类也转成上下分式；
   - 网格与 DOCX：`fracHtml()` / `docx.js: gridXml` 的分子段落下边框当分数线。
3. **证明不用负系数**：`render.js: stepBlocks` 的证明分支只写“红组/蓝组、条数、kS、重合抵消”，
   禁止再出现“系数/加权/带正号/带负号”等措辞（有回归测试断言）。
4. **马步定理专用证明**：`render.js: knightGroups()` —— 红组 = 过角一行+一列+过角对角线，
   蓝组 = 全部 n 条行线；抵消后红 `2·a`、蓝 `f,h`。
5. **系数优先为 1**：`magic-core.js` 择优 score 第 2 位是 `maxAbs`（|λ| 最大值），
   其次才是 Σ|λ|、涉及格子数、前提数。随机扫描 75 例中仅 1 例仍需 |λ|=2（4 阶 4 已知的某格），
   此时画块写“2·a”，仍用重合语言解释。
6. 补线法（幻和−其余）与整线求 S 有独立的最简讲法分支，不走红蓝组。

## 9. 用户偏好（沟通/设计）

- 中文交流；要求“先结论 → 再证明 → 再运用 → 最后示意图”的教学结构。
- 偏好**纯前端单文件**、双击即用、可离线、可导出 DOCX/PDF。
- 强调“最简单技巧”：幻和直用优先；反对带系数的多行复杂证明。
- 会要求**外审文档**（PROJECT-BRIEF.md）与**公网链接**，并让 QQ 机器人推送（技能 `qq`）。
