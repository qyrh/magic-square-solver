/* build.js —— 打包为单文件应用：把全部 JS 内联进 HTML
 * 用法：node build.js
 * 产物：dist/幻方求解器.html（双击即可离线使用，可发给任何人）
 * 安全说明：只内联白名单中的本目录脚本文件，不读取白名单之外的任何路径。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
// 白名单：本项目自身的四个脚本（basename 精确匹配，禁止任何路径分隔符）
const WHITELIST = ['magic-core.js', 'render.js', 'docx.js', 'app.js'];

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 内联所有 <script src="xxx.js?v=N"></script>
html = html.replace(/<script src="([^"]+?)(\?v=\d+)?"><\/script>/g, function (m, src) {
  const base = path.basename(src);
  if (src.includes('/') || src.includes('\\') || WHITELIST.indexOf(base) < 0) {
    throw new Error('拒绝内联非白名单脚本: ' + src);
  }
  const code = fs.readFileSync(path.join(ROOT, base), 'utf8');
  return '<script>\n' + code + '\n</script>';
});

// 标记构建信息
html = html.replace('</title>', '</title>\n<!-- 幻方求解器 单文件版 · 由 build.js 生成 · 可离线双击使用 -->');

const distDir = path.join(ROOT, 'dist');
fs.mkdirSync(distDir, { recursive: true });
const out = path.join(distDir, '幻方求解器.html');
fs.writeFileSync(out, html);

// 附带说明
try {
  fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(distDir, 'README.md'));
} catch (e) { /* 无 README 时忽略 */ }

console.log('已生成单文件应用: ' + out + ' (' + Math.round(html.length / 1024) + ' KB)');
if (/<script src=/.test(html)) { console.error('错误：仍有未内联的脚本！'); process.exit(1); }
