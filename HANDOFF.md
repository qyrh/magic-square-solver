# 交接说明（HANDOFF）—— 给接手的新会话 AI

> 项目：幻方求解器（任意阶 · 分数/小数 · 逐步最简证明 · 值域限定 · 单文件应用）
> 目录：`D:\glm-db\.zcode\workspace\draft-85724259-c664-4d90-9290-644bc2e3e3dc\magic-square-solver\`
> 仓库：https://github.com/qyrh/magic-square-solver 　在线：https://qyrh.github.io/magic-square-solver/
> 单文件：`dist/幻方求解器.html`（由 `node build.js` 生成）
> 最后更新：2026-11-07（第 9 轮：7 角度子代理审查 34 项全修复——Frac 精确运算、CSP 近增值防护、
> 8 阶满盘 38ms、center-S 死分支、竞态守卫、文字-数学一致、测试有效性；index.html ?v=25。
> 第 8 轮：classic/set 示例改用穷举合法填法、示例改方格图。第 7 轮：示例折叠+删首页说明页）

## 0. 一分钟上手

```bash
cd magic-square-solver
node test-core.js     # 223 项断言（必须全过；含矩阵冒烟、示例合法性与数学回归）
node test-docx.js     # 文档块 + DOCX 结构自检
node verify-all.js    # 全阶数(3–8)×全模式(4种)穷尽验证：177 例 + DOCX 6 个 Python 校验
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
       'test-core.js','test-docx.js','verify-all.js','verify_docx_check.py','gen-canned.js','.gitignore',
       'README.md','PROJECT-BRIEF.md','HANDOFF.md',
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

- `test-core.js`：**198 项**——分数解析/显示、三阶两数、洛书顺序（对顶→幻和→补线）、分数混合、
  矛盾、丢勒四阶、四角定和、一/二阶、空输入、五阶一致性、全填满、
  **值域限定**（classic 幻和直得/唯一解/非法角无解/重复数字报错、integer 无解与见证、set 数量校验）、
  **矩阵冒烟**（3–8 阶 × 4 值域：步号对齐/填格完整/第 1 步 domain-S/integer 见证与全整数示例/
  任意阶超范围拒绝）。
- `test-docx.js`：文档块结构（页数=步数+1、第一页即第 1 步、examples 折叠块、证明折叠块）、
  DOCX zip/OOXML 合法、立体分数分数线、正方形行高。
- `verify-all.js`：**全阶×全模式穷尽矩阵 177 例**（见 §8.7 第 4 条）+ 每阶数 DOCX 的
  Python zipfile/良构校验。
- 浏览器 E2E（罐头结果）：帮助弹窗、自动出数回填、撤回重做、快速/完整切换、证明折叠、
  红蓝画块、点击弹窗、**示例胶囊折叠/展开/写入/撤回/收起**、立体分数、DOCX、单文件无外链。

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

## 8.6 第 6 轮修复（整数模式）

1. **问题**：整数限定下，总结页“多解填法”和“随机试解”用的是**有理方向** `part + D·t`，
   会出现 1/3、-8/3 这类非整数；旧的存在性判定只在小整数范围搜参数，大数已知时会误报“未找到”。
2. **修复 A（示例必须整数）**：`assembleResult` 在整数模式下改用
   `integerInfo.witnessCells`（整数见证）+ `integerInfo.intDirs`（乘公共分母后的整数方向）生成本组填法；
   `sampling` 标记 `illustrative: true`，页面显示“整数填法示例”，不再声称“与线性判定一致”。
3. **修复 B（精确判定）**：`checkIntegerSolutions` 改为
   **按分母周期的精确枚举**：L = part 与 D 所有分母的 LCM，整数性只取决于 t mod L，
   枚举 t∈[0,L)^m（≤30 万组合）即可**判定**有无整数解；超限才退化为随机并标“未找到”。
   关键依据：零空间基在自由坐标上是单位向量，故 t 的分量就是自由格的值，必须是整数。
4. **回归测试**：`test-core.js` 新增 6 项（示例全整数、大数已知仍可判定、仅 1 已知数示例仍整数），
   共 92 项；另做了 252 例“补线法/整线求 S”构造恒等式的穷尽数值校验与 180 例填格完整性检查（缺口 0）。
5. 若再改整数模式：**不要**用 `part + D·t` 直接当示例（会出分数）；必须用 `intDirs`。

## 8.7 第 7 轮改动（示例折叠 + 删首页说明 + 全矩阵验证，2026-11-06）

1. **任务 A：示例区“两字折叠 + 点击查看 + 再点击写入”**
   - 新文档块 `{t:'examples', n, items:[{label:'示例 k', note, values:[str], grid}]}`（`render.js: examplesBlock()`）。
     总结页原来铺开的四类示例（`examples` 两种填法、整数填法示例、随机试解 3 组、穷举合法填法）
     全部收进这一个块；配套解释长段落已删（保留一行 dim 交叉验证说明）。
   - 网页 `app.js: renderBlock('examples')`：默认只有“示例”两字胶囊（title 有提示）；
     点击展开条目列表（`示例 k：1 10 4 / 8 5 2 / 6 0 9`，只列数值）；点击条目 =
     `pushHistory()` + `setGrid(values)` 写入填写区（黑色已知数、可 Ctrl+Z）；再点（此时显示“收起”）折叠；
     只 toggle 显隐，**不改 state.current、不重渲染**，分页位置不动。
   - 打印 CSS 强制 `.ex-list{display:block!important}`（打印完整展开）；DOCX `docx.js: renderBlocks('examples')`
     **完整展开**逐条 `gridXml`（文档要完整）。写入时若阶数已变（values.length ≠ 格子数）直接忽略。
   - 完整解（无任何示例）不出胶囊。
2. **任务 B：删首页说明页 + “?”帮助弹窗**
   - `render.js: buildDocument()` 删除 `introBlocks()`（函数已移除）：**第一页即“第 1 步”**，
     总结页仍在最后；错误页保留。页数 = 步数 + 1（原来是 +2）。
   - 原首页内容精简后移入 `app.js: openHelpModal()`（`.modal-mask no-print`，✕/点遮罩/Esc 关闭）：
     怎么用（5 条）、**当前 n 的完整字母表**（lettersFor(state.n)，n≤5 为 a–y，n≥6 为 rXcY，与
     magic-core `buildModel` 的 letters 完全一致）、思路一段、值域限定四选一。
   - "?"按钮两处：输入卡控制栏最右（“求 解”旁）+ 结果工具栏最右；`index.html ?v=23`。
   - 帮助内容不进 pages，打印/DOCX 天然无残留。
3. **修复（矩阵发现）**：classic/set 模式已知数不在限定集合时，n≥5 因跳过 CSP 而**漏校验**
   （n≤4 由 CSP 兜住）。已在 `magic-core.js: buildDomain()` 统一校验：所有已知数（按份数计）
   必须在 multiset 内，任意阶数生效；报错文案与 CSP 一致（“不在限定的数字范围内（或超出份数）”）。
4. **verify-all.js（新文件）**：3–8 阶 × none/integer/classic/set 全矩阵。每格 0/1/2/3/n 个已知
   （取自真实幻方：奇数阶缅甸法、4k 阶对角取补、6 阶 Strachey 硬编码；set 模式用 2v+1 仿射集合并
   用对应真值校验）+ 矛盾（满盘一格+1）+ 超范围 + integer 分数无解。断言：不抛异常、结构完整、
   步号对齐/前提引用、steps↔finalCells 数值一致、完整解线和全=S、填格缺口=0（含 CSP extras）、
   推出值与基准幻方逐格一致、integer 示例无“/”、domain-S=总和/n 且第 1 步 special、
   csp.exhaustive 稳定格全在 finalCells、count=1⇒complete、单例 ≤2s（实测最慢 1158ms，4 阶 CSP）、
   全 pages 文字无“带正号/带负号/按系数加权/系数用于加权”。DOCX 每阶数生成一次，
   `verify_docx_check.py` 用 zipfile + 自实现标签配平检查（无实体解析）校验。
   本轮结果：**177/177 全过，6/6 DOCX 通过**。
5. **test-core.js**：92 → **198 项**（新增矩阵冒烟：24 组合的步号/填格/域语义 + 任意阶超范围拒绝）。
   **test-docx.js**：改为页数=步数+1、pages[0] 即第 1 步、无“记号/思路”标题、examples 块断言。
6. **E2E（罐头结果隔离计算层，Chromium dev）**：`gen-canned.js` → `canned-e2e.js`（loshu/two/frac），
   页面里 `MagicCore.solveMagicAsync = async () => CANNED_E2E.current`。已验证：帮助弹窗开/关与内容、
   自动出数回填 6 绿格、求解 8 页、第一页=第 1 步、翻页、证明默认折叠、点击出数弹窗、
   示例胶囊默认折叠→展开 5 条→点条目写入 9 格全黑→Ctrl+Z 回退→收起、
   立体分数（填写框覆盖层 7、正文 .frac 138）、DOCX 链路 PK 签名、
   dist 单文件 0 外链脚本、无 console 错误；截图经视觉模型走查通过。
7. **判例补充**：Mimosa 钩子会拦 `ElementTree`（XML 实体扩展）与动态 `path.join` 进 fs 写——
   Python 校验改自实现标签配平（先拒 DOCTYPE/ENTITY + 大小上限）；Node 写文件用**字面量路径表**。

## 8.8 第 8 轮改动（classic/set 示例违反值域修复 + 示例改方格图 + 子代理逐行审查，2026-11-06）

1. **用户投诉的 bug**：classic/set 模式总结页示例原用有理方向（part + D·t）构造，出现分数、
   违反“每个数恰好用一次”。**修复**：`assembleResult` 对 distinct 模式示例只取 `csp.samples`
   （穷举合法填法，样本 ≥2 且未完整解时才给）；sampling 与有理示例对 distinct 彻底关闭
   （n≥5 不穷举 → 宁可不给示例）；integer 模式保持整数见证路径。
2. **示例展示改为方格图**：`app.js: renderBlock('examples')` 展开后每组是一张
   正方形网格卡片（`table.ms` + 立体分数 + given/diff/unknown 着色 + “示例 k”标题），
   点击卡片写入填写区；不再是线性文本行。打印时隐藏胶囊、强制展开卡片。
3. **4 个审查子代理逐文件审查（共 15 项发现，全部修复）**，要点：
   - **[Critical] set 模式第 1 步假等式**：“1 + 2 + … + 9 = 90”——`domainSBlocks` 按
     `step.domainKind` 分支，set 写“全部限定数字相加”。
   - **[Critical] 点击穷举定格 TypeError**：csp 步 `cell:null`，`openStepModal` 现在
     特判 special 步（标题“穷举确定的格子（g、k）”，依据行为穷举验证）。
   - **[Critical] `exactDecimal` 浮点失真**：`f.n * 10^k` 超 2^53 产出 `'0.01.4…e+21'` 坏串 →
     parse 抛异常。改为纯整数运算（10^k/f.d = 2^(k-c2)·5^(k-c5)），超精确范围退回分数显示。
   - **[中] integer 示例 S 标注错**：示例沿整数方向平移时 S 会变，逐例计算
     `S = w[N] + k·pickDir[N]`（回归：a=100,b=200 断言行和 = 标注 S）。
   - **[中] integer 随机分支谎称“穷尽无解”**：`checkIntegerSolutions` 增加 `exact` 标志；
     随机未找到 → `feasible:null` + 诚实文案（“不构成无解证明”），solveMagic 不再 ok:false，
     且 integer 模式不再回落到有理 sampleCompletions；render 对 feasible===null 用灰色非红色。
   - **[中] 切阶数不刷新值域 UI**：selN change 补 `syncDomainUI()`（否则 customSet 滞留旧阶数）。
   - **[中] 反例双填法标色失实**：①/② 改“成对真实差异”标色（`varyingAmong`），
     恰好相同的未定格标灰（kind unknown），caption 如实描述红/灰含义。
   - **[低] 其余**：Frac 拒绝 NaN/Infinity/非整数（曾 gcd 死循环）；填数顺序一览表
     domain-S/csp 步专用行（原来显示 “null”/“线性恒等式”）；删 setQuickBar 的
     `view==='full'` 死分支；卡片 title 带上诚实说明；打印隐藏示例胶囊。
4. **verify-all 6b 新增“全模式示例合法性”断言**：examples/sampling.samples/csp.samples 的
   每张网格必须 (a) 是真幻方（2n+2 线和相等）(b) 保留全部已知数 (c) classic/set 时是
   multiset 的精确排列；integer 有已知且未完整解时必须给 2 组整数示例。
   test-core 新增长小数/Frac NaN/integer S 标注回归，共 **214 项**。
5. E2E（罐头）：classic 3 阶示例 = 3 张 1..9 方格卡片（视觉模型核验各 1..9 一次、无分数、
   三张互不相同）；4 阶 classic 示例 = 1..16 排列；点击穷举定格弹窗正常。
6. 已知机器相关项（保留）：verify-all 单例 2s 上限 vs 4 阶 CSP 墙钟截断（maxMs=1500），
   本机最慢 918ms 余量 ~2 倍；慢机可能假 FAIL，可放宽 TIME_LIMIT_MS。

## 8.9 第 9 轮改动（7 角度子代理逐行审查：34 项发现全修复，2026-11-07）

7 个审查角度：数学×3（线性代数 / 恒等式与定理 / CSP 与整数）、性能、代码边界、测试有效性、文字-数学一致。

**数学修复（magic-core.js）**
1. **Frac 中间积静默舍入**（中危）：`add/sub` 同分母快速路径（精确）+ 异分母 `mulExact`（>2^53 立即报 OVERFLOW）；
   `mul/div` 乘前约分。审查反例 `Frac(3002399751580331,3).sub(Frac(3002399751580338,3))` 曾得 8/9，现得 1（有回归测试）。
2. **center-S 分支 (a) 死分支**（漏判）：条件误写 `α_S = γ·n`（恒假），改为 `α_S·n = γ`；
   现在“已知 S → 中心”与“已知中心 → S”双向都标注中心定理（回归测试）。
3. **CSP 近增值浮点洞**（可构造假无解）：不同值 double 碰撞（如 67114657/67114656 vs 67114658/67114657）
   会让 availSorted 排序/上下界剪枝不可靠 → `buildDomain` 预检拒绝“过近值”（回归测试用真实碰撞对）。
4. **fmt/parse 位数回环断裂**：exactDecimal 上限 2^52→10^15−1，保证小数显示 ≤15 位可被 parseDec 读回
   （曾可产出 16 位小数 → CSP extras 注入抛异常；回归测试）。
5. prepareSolve：调用方显式给的 S 与值域 S 不一致时报矛盾（原来静默覆盖）。
6. 大分母限定数字 / 整数检查溢出：solveMagic/Async 包 try→`ok:false`（不再抛异常）。

**性能修复**
7. **findMinimal 回退短路**：tech-1（补线法/整线求 S）可直接构造时跳过“全量系数解+贪心收缩”——
   **8 阶满盘从估算 1.7–2.4s → 实测 38ms**。
8. **solveCSP 预排序**：distinct 值一次排序，bounds 从两端按份数取（O(D)），去掉每次全量展开+排序；
   verify-all 最慢单例 ~950ms → **639ms**。
9. checkIntegerSolutions：`new Frac(t)` 提出内层循环 + 1s 时间护栏（超时转“未找到”诚实文案）。
10. buildDomain 不再重复 buildModel（只算 N/SC）；randomPuzzle 每格让出一次（原每 3 次）。
    CSP 仍为同步块（≤maxMs≈1.5s 上限）——已知限制，未分片（风险大）；实测 639ms。

**交互/显示修复（app.js / render.js / index.html / docx.js）**
11. 竞态：`buildInputs` 时 `state.token++`（旧求解结果不得写进新网格）+ `autofillDerived` 长度守卫。
12. Ctrl+Z/Y 在批量文本/限定数字输入框内留给原生撤回（不撤幻方格子）；←/→ 翻页忽略 SELECT。
13. 批量填入：3–8 行下界校验 + 行数不齐提示 + syncDomainUI；预设/随机出题补 syncDomainUI。
14. 随机出题：生成期间切阶数则丢弃结果（try/finally 恢复按钮）。
15. btnProofs 标签与实际折叠状态同步（renderPages 复位 / beforeprint 更新）。
16. 验证表 ✓/✗ 与画块图注的颜色/加粗：CSS 色字类从 .blk-p 作用域解放为全局；docx captionPara 保留 cls/b。
17. scheduleAuto 已排队定时器复查 autoSolve 勾选。
18. 文字-数学一致：马步定理“各出现同样的次数”对角格 3≠1 为假 → 改“按两边中较少的次数成对抵消（角格红 3 蓝 1，抵消后剩 2·a）”；
    csp 步标题“所有合法填法都相同”字面假 → “这些格子在所有合法填法中都取相同的值”；
    示例图例“即穷举证明的确定解”按 exhaustive 门控；删光 `**` 字面星号（4 处）。

**测试有效性修复（防虚假信心）**
19. test-docx：S 步断言改为定位真实 S 页（原断言任何页恒真）；`2·e = a + i` 精确匹配（原子串吞掉）；
    新增 pBdr/trHeight=gridCol 字节级断言（原“断言”章节零断言）。
20. verify-all：负例正则按模式收紧（none/integer 只认“矛盾”）；FORBIDDEN 追加“系数/加权”两词
    （已核实现有文案不含）；collectText 收 it.note；6b 新增示例标注 S=行和断言。
21. test-core：五阶死断言改显式 !complete；两处空转断言（||[] 恒真）改为要求非空；4 项新回归
    （Frac 精确/16 位退分数/center-S 双向/近增值拒绝/大分母优雅报错）。共 **223 项**。
22. verify_docx_check.py：删死代码、拒绝 CDATA、属性引号成对检查。

## 9. 用户偏好（沟通/设计）

- 中文交流；要求“先结论 → 再证明 → 再运用 → 最后示意图”的教学结构。
- 偏好**纯前端单文件**、双击即用、可离线、可导出 DOCX/PDF。
- 强调“最简单技巧”：幻和直用优先；反对带系数的多行复杂证明。
- 会要求**外审文档**（PROJECT-BRIEF.md）与**公网链接**，并让 QQ 机器人推送（技能 `qq`）。
