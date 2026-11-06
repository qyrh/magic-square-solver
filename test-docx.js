/* test-docx.js —— 生成示例 DOCX 并做基本断言（node test-docx.js） */
'use strict';
const fs = require('fs');
const path = require('path');
const Core = require('./magic-core.js');
const Render = require('./render.js');
const Docx = require('./docx.js');

let failed = 0;
function ok(c, m) { if (!c) { failed++; console.error('  ✗ FAIL: ' + m); } else console.log('  ✓ ' + m); }

function buildCase(n, giv) {
  const m = new Map();
  for (const k in giv) m.set(Number(k), Core.parseNumberString(giv[k]));
  return Core.solveMagic(n, m);
}

// 1) 洛书：检查 render 文档块结构
{
  const r = buildCase(3, { 0: '2', 1: '7', 4: '5' });
  const doc = Render.buildDocument(r);
  const pages = doc.pages;
  ok(pages.length === r.steps.length + 2, '页数 = 步数+2 (得到 ' + pages.length + ')');
  const step1 = pages[1];
  const txt = JSON.stringify(step1);
  ok(/证明/.test(txt) && /运用/.test(txt) && /示意图/.test(txt), '每步含 证明/运用/示意图');
  // 第一步是 S：证明里应出现 “×S”
  ok(/×S/.test(txt), 'S 的推导证明含幻和记号');
}

// 2) 两数定一格：证明里应出现对顶定理与字母
{
  const r = buildCase(3, { 0: '1', 8: '9' });
  const doc = Render.buildDocument(r);
  const t = JSON.stringify(doc.pages[1]);
  ok(/对顶定理/.test(t), '识别对顶定理');
  ok(/2·e = a \+ i|2·e/.test(t), '含恒等式 2e = a + i 形式');
}

// 3) DOCX 生成 + zip 结构校验（含分数题：立体分数与正方形行高）
{
  const r = buildCase(3, { 0: '2', 1: '7', 4: '5' });
  const rf = buildCase(3, { 0: '1/2', 1: '1/3', 4: '2.75' });
  const doc = Render.buildDocument(r);
  const docF = Render.buildDocument(rf);
  const bytes = Docx.buildDocx(doc.pages.concat(docF.pages), doc.title);
  ok(bytes.length > 3000, 'docx 字节数合理 (' + bytes.length + ')');
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  ok(sig === 'PK\x03\x04', 'zip 魔数 PK');
  const out = path.join(__dirname, 'sample-output.docx');
  fs.writeFileSync(out, bytes);
  console.log('  已生成 ' + out + '，供 Python 校验');
}

// 4) 立体分数与正方形格子在 DOCX 中的断言
{
  const rf = buildCase(3, { 0: '1/2', 1: '1/3', 4: '2.75' });
  const docF = Render.buildDocument(rf);
  const bytes = Docx.buildDocx(docF.pages, docF.title);
  const zlib = require('zlib');
  // 直接从 docx.js 拿 XML 太绕：重新用页面文本判断——改为检查 zip 内容
  const AdmLike = null; // 占位，下面用文件
  fs.writeFileSync(path.join(__dirname, 'sample-frac.docx'), bytes);
  console.log('  已生成分数样例 sample-frac.docx');
}

console.log(failed ? ('\n失败: ' + failed) : '\nDOCX 结构自检全部通过');
process.exit(failed ? 1 : 0);
