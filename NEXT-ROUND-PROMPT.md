# 下一轮交接提示词（复制这段话给新的 AI 会话）

你现在接手一个已完成大半的项目，请先读懂现状，再完成两件事，并对**全部阶数 × 全部模式**做穷尽验证与修复。

---

## 一、项目信息（务必先看这些文件）

- **本地目录**：`D:\glm-db\.zcode\workspace\draft-85724259-c664-4d90-9290-644bc2e3e3dc\magic-square-solver\`
- **GitHub 仓库**：https://github.com/qyrh/magic-square-solver （账号 qyrh，`gh` 已登录）
- **在线地址**：https://qyrh.github.io/magic-square-solver/ （GitHub Pages，分支 main 根目录）
- **单文件成品**：`dist/幻方求解器.html`（由 `node build.js` 生成，约 134KB，双击即用、可离线分发）
- **必读文档**：
  - `HANDOFF.md` —— 架构、数据结构、必须保持的不变量、发布流程、踩坑判例、用户偏好
  - `PROJECT-BRIEF.md` —— 需求映射表与算法说明（外审用）
  - `README.md` —— 使用说明
- **测试命令**（改完必须全绿）：
  ```
  cd "D:\glm-db\.zcode\workspace\draft-85724259-c664-4d90-9290-644bc2e3e3dc\magic-square-solver"
  node test-core.js     # 当前 92 项断言
  node test-docx.js     # 文档块 + DOCX 结构
  node build.js         # 重新生成单文件版
  ```
- **当前状态**：第 6 轮修复完成（2026-11-06），`index.html` 里脚本版本号 `?v=22`；
  Pages 最近构建 commit `153317cf`；Node 测试 92/92 通过。
- **技术栈**：纯前端（无框架、无依赖、无构建工具），JS 文件按 UMD 同时支持浏览器 `<script>` 与 Node `require`。
  文件职责：
  - `magic-core.js`：Frac 精确有理数、线性代数、推导引擎（恒等式+择优）、CSP 穷举、值域限定、整数判定
  - `render.js`：求解结果 → 文档块（网页与 DOCX 共用的中间表示）
  - `docx.js`：文档块 → OOXML（自实现 store-zip + CRC32）
  - `app.js`：DOM 交互（输入即出数、回填、撤回/重做、点击查阅、分页、导出）
  - `index.html`：骨架 + 全部 CSS
  - `build.js`：白名单内联四个脚本 → 单文件
  - `test-core.js` / `test-docx.js`：测试
- **关键不变量（勿破坏，HANDOFF.md 有详述）**：
  1. 步号对齐：`result.steps[k-1].i === k`（含 special 步），`finalCells[i].source` 即步号，UI 用 `steps[source-1]`；
  2. 恒等式三重校验（逐格系数、S 系数、与整体特解数值一致），不通过即抛错；
  3. 择优顺序：技巧分级 → |λ|最大值(系数尽量为1) → Σ|λ| → 涉及格子数 → 前提数 → 定理名 → 无除法；
  4. 整数模式示例必须用 `integerInfo.witnessCells` + `intDirs`（**不能**用 `part + D·t`，会出分数）；
  5. CSP 撤销必须 `trail.pop()` 同步（曾因此崩溃）；
  6. `rootCore()` 不能用 UMD 包装层的 `root` 变量；结果区显示必须 `display='block'`；
  7. 证明文字**禁止出现负系数表述**（“系数/加权/带正号/带负号”），只用“红组/蓝组、条数、kS、重合抵消”。

---

## 二、本轮要做的两件事（用户明确要求，先做这两件）

### 任务 A：示例区改为“两字折叠 + 点击查看 + 再点击写入”

**现状问题**：总结页的示例区块（“两种填法”与“整数填法示例”）直接铺开占大量纵向空间，且解释文字太多。

**目标交互**：
1. 默认只显示 **“示例”两个字**（一个按钮/胶囊，不要占地方，不要长标题、不要说明段落）；
2. 点击“示例” → 展开一个**示例列表**（每组一行：序号 + 简短摘要，例如 `示例 1：2 7 6 / 9 5 1 / 4 3 8`，只列数值，不写解释）；
3. 在列表里**再点击某一组** → 把该组数值**写入填写区**（作为已知数，黑色、非绿色自动推导；可撤回 Ctrl+Z）；
4. 再次点击“示例”或“收起”即折叠；展开时不改变分页位置。
5. 不要额外解释文字；最多在按钮上加 `title` 提示。

**实现位置建议**：`render.js` 里把 examples/sampling 两类示例改成新的文档块类型（如 `{t:'examples', items:[...]}`），
`app.js: renderBlock` 增加对应渲染与事件；DOKX 导出时仍展开为完整表格（文档要完整，不受折叠影响）。
注意 `docx.js: renderBlocks` 需支持新块类型，否则导出会丢示例。

### 任务 B：删掉“第一页前置说明”（证明前不要说明页）

**现状问题**：`render.js: introBlocks()` 生成首页（标题、题面说明、已知格、字母表、思路），用户认为这不是证明必需过程，不要单独一页。

**目标**：
1. **不要首屏说明页**：`buildDocument()` 的第一页直接是“第 1 步”；
2. 原首页内容（怎么用、字母记号表、思路、值域说明）移入**工具栏右上角的问号 `?` 按钮**：点击弹出帮助弹窗（可关闭），内容可精简；
3. 打印/导出时**不要把帮助内容**当作正文页（帮助只在交互界面）；
4. 保留字母记号的可查性：帮助弹窗里给出完整字母表；每一步内部的“字母幻方图”继续保留（只标本步涉及的格子）；
5. 若“总结页”仍需要，可保留在最后（用户没要求删总结页，只要求删前置说明页）。

---

## 三、必须做的穷尽验证（本轮重点）

要求：**全部阶数 3–8 × 全部 4 种值域模式 × 各功能环节**，逐一验证；发现错误就修，修完重跑，直到全绿。

### 3.1 模式定义
| 代码 | 界面名称 | 含义 |
| --- | --- | --- |
| `none` | 不限定（任意有理数） | 仅行列对角线和相等 |
| `integer` | 只允许整数 | 每个格子必须是整数 |
| `classic` | 1…n²（各用一次） | 数字 1…n² 各用一次，S 直接可得 |
| `set` | 自定义数字集合 | 用户给 n² 个数，各用一次 |

调用方式：`MagicCore.solveMagic(n, Map<idx,Frac>, {domain:{kind:'none'|'integer'|'classic'|'set', values:[Frac]}})`
（`classic` 不需要 values；`set` 必须恰好 n² 个）。

### 3.2 机器学习不适用，请写一个 `verify-all.js` 自动跑矩阵
对 n ∈ {3,4,5,6,7,8}、mode ∈ 4 种，各生成若干已知组合（0/1/2/3/n 个已知；取自一个真实幻方，
同时构造若干“矛盾输入”与“超范围输入”），逐项断言：

1. **不抛异常**（捕获并打印 n/mode/输入，便于定位）；
2. **返回结构完整**：`ok`、`model`、`steps`、`finalCells`、`knownEntries`、`S`、`domain`、`csp`（classic/set 且 n≤4 时非空）、`integer`（integer 模式非空）；
3. **步号对齐**：`steps[k-1].i === k`；`premises[].sourceIdx` 指向的步号小于当前步或为 null；
4. **数值正确**：每个 `steps[k].valueStr` 与 `finalCells[target].valueStr` 一致；完整解时全部线和 = S（`verification.rows.every(ok)`）；
5. **填格完整**：`finalCells.filter(Boolean).length === determinedCount - (S?1:0)`（曾以此为口径，缺口必须为 0）；
6. **模式语义**：
   - `integer`：`integer.feasible === true` 时，`examples`、`sampling.samples` 中**不得出现 `/`**；`feasible === false` 时必须是明确的无解原因（含“分数”或“周期性”）；
   - `classic`/`set`：`domain.S` 等于总数字和/n；第 1 步必须是 `special:'domain-S'`；3/4 阶 `csp.exhaustive` 时，`csp.stableCells` 里所有格子都必须出现在 `finalCells` 中；`csp.count===1` 时必须 `complete===true`；
   - 矛盾/超范围输入：必须 `ok===false` 且 `error` 非空，**不得**抛异常；
7. **性能上限**：单例求解 ≤ 2s（n=8 含推导也要满足；超过就记录并优化）；
8. **DOCX**：对每个 n 生成一次文档并 `Docx.buildDocx`，用 Python `zipfile` 校验 zip 完整、`word/document.xml` 可解析、无外链脚本；
9. **证明文字合规**：所有 `pages` 的文本中不得出现 `系数用于加权`、`带正号`、`带负号`、`按系数加权`（回归断言）；
10. **新交互**：示例折叠块存在、默认折叠、展开有条目、点击条目能把值写入填写区（浏览器 E2E）。

### 3.3 浏览器端验证方式（必读）
测试环境是 **Chromium 156 开发版**，渲染器极不稳定：纯忙循环、几万次对象分配、真实求解都可能让页面
“Target crashed”，**与本项目代码无关**。因此：
- 计算正确性一律以 **Node 断言**为准；
- 浏览器只验证 UI：先用 Node 生成 `canned-results.json`（多组结果），页面里临时替换
  `MagicCore.solveMagicAsync = async () => canned.xxx`，再测回填/撤回/示例折叠/点击弹窗/分页/导出；
- 若页面崩溃，重开标签页重试，不要归因于代码。

---

## 四、验收标准（做完必须逐条自查并在回复中列出结果）

1. `node test-core.js` 全绿（含新增的矩阵测试），`node test-docx.js` 全绿；
2. `verify-all.js` 输出矩阵表：6 阶数 × 4 模式，全部 PASS（或列出失败项并已修复）；
3. 首页说明页已移除，第一页即“第 1 步”；`?` 帮助弹窗可打开/关闭，内含字母表与使用说明；
4. 示例区默认只有“示例”两字，点击展开列表，点击条目写入填写区，可撤回；
5. 打印/导出 DOCX：无帮助弹窗残留、示例在文档中完整展开、正方形格子、立体分数正常；
6. `node build.js` 生成新的 `dist/幻方求解器.html`，且无外链脚本；
7. 更新 `index.html` 的 `?v=N` 版本号（防缓存），并重新上传 GitHub、确认 Pages 构建 `built`；
8. 更新 `HANDOFF.md`（新增本轮改动与验证清单）。

---

## 五、发布流程（本机直连 github.com 的 git 通道会超时，必须用 API）

```bash
cd "D:\glm-db\.zcode\workspace\draft-85724259-c664-4d90-9290-644bc2e3e3dc\magic-square-solver"
node build.js
python -X utf8 - <<'PYEOF'
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
    print(('OK  ' if r2.returncode==0 else 'FAIL')+' '+f)
PYEOF
sleep 45
gh api repos/qyrh/magic-square-solver/pages/builds/latest -q '.status + " / " + .commit[0:8]'
```

---

## 六、其他硬性约束与用户偏好

- 界面只提供 **3–8 阶**（1、2 阶已从下拉移除；核心仍支持 1/2 仅用于测试）。
- 分数必须**立体（上下）显示**：填写框用 `.frac-ov` 覆盖层；正文/表格用 `renderTextWithFrac`；DOCX 用段落边框作分数线。
- 证明用“红组/蓝组 + 重合抵消”讲法，**不得出现负系数**；马步定理用“过角三线 vs 全部行线”的最优讲法。
- 点击推出的数可查看依据（`.modal-mask` 弹窗）；证明默认折叠，`#btnProofs` 一键展开。
- 撤回/重做：Ctrl+Z / Ctrl+Y。
- 提交/发布后请把公网链接发给用户（他会自己转存）。

## 七、开始时请先做的事（复制给你的 AI）

1. 读 `HANDOFF.md`、`README.md`、`PROJECT-BRIEF.md`；
2. 跑 `node test-core.js`、`node test-docx.js` 确认基线；
3. 列出你打算怎么改 A、B 两个任务（先给方案再动手）；
4. 写 `verify-all.js` 跑全矩阵，把失败项先修完，再改 A/B；
5. 全部完成后再按第五节发布，并把公网链接与验收结果回报给用户。
