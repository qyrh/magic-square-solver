/* gen-canned.js —— 生成浏览器 E2E 用的罐头求解结果（隔离计算层，页面里替换 solveMagicAsync） */
'use strict';
const fs = require('fs');
const Core = require('./magic-core.js');

function solveC(n, obj, domain) {
  const m = new Map();
  for (const k in obj) m.set(Number(k), Core.parseNumberString(obj[k]));
  return Core.solveMagic(n, m, domain ? { domain: domain } : undefined);
}

const out = {
  loshu: solveC(3, { 0: '2', 1: '7', 4: '5' }),
  two: solveC(3, { 0: '1', 8: '9' }),
  frac: solveC(3, { 0: '1/2', 1: '1/3', 4: '2.75' }),
  classic: solveC(3, { 4: '5' }, { kind: 'classic' }),
  // 4 阶 classic、5 已知（格 14,1,5,2,9 = 15,2,11,3,7）：穷举 2 种填法，格子 6/10 由穷举确定
  csp4: solveC(4, { 14: '15', 1: '2', 5: '11', 2: '3', 9: '7' }, { kind: 'classic' })
};
if (!out.loshu.ok || !out.two.ok || !out.frac.ok || !out.classic.ok || !out.csp4.ok) { console.error('罐头求解失败'); process.exit(1); }
if (!(out.csp4.csp && out.csp4.csp.extras && out.csp4.csp.extras.length)) { console.error('csp4 无穷举定格'); process.exit(1); }
fs.writeFileSync('canned-e2e.js', 'window.CANNED_E2E = ' + JSON.stringify(out) + ';\n');
console.log('canned-e2e.js 生成，' + Math.round(fs.statSync('canned-e2e.js').size / 1024) + ' KB；' +
  'two 示例 ' + (out.two.examples ? out.two.examples.length : 0) + ' + 采样 ' + (out.two.sampling && out.two.sampling.samples ? out.two.sampling.samples.length : 0) +
  '；classic 示例 ' + (out.classic.examples ? out.classic.examples.length : 0) +
  '；csp4 extras=' + JSON.stringify(out.csp4.csp.extras) + ' count=' + out.csp4.csp.count);
