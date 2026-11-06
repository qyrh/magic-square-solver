/* =========================================================================
 * docx.js —— 把 render.js 生成的文档块导出为 .docx（OOXML）
 * 纯 JavaScript 实现：store（不压缩）zip + CRC32，无任何外部依赖。
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.MagicDocx = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- CRC32 ---------------- */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------------- store-only zip ---------------- */
  function zipStore(files) { // files: [{name, data:Uint8Array}]
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const nameU = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);       // version needed
      lh.setUint16(6, 0, true);        // flags
      lh.setUint16(8, 0, true);        // method: store
      lh.setUint16(10, 0, true);       // time
      lh.setUint16(12, 0x0021, true);  // date 1980-01-01
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameU.length, true);
      lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), nameU, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, 0, true);
      ch.setUint16(14, 0x0021, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, nameU.length, true);
      ch.setUint16(30, 0, true);
      ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true);
      ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nameU);

      offset += 30 + nameU.length + data.length;
    }
    let cdSize = 0;
    for (const c of central) cdSize += c.length;
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, offset, true);
    const total = parts.concat(central, [new Uint8Array(eocd.buffer)]);
    let len = 0; for (const p of total) len += p.length;
    const out = new Uint8Array(len);
    let pos = 0;
    for (const p of total) { out.set(p, pos); pos += p.length; }
    return out;
  }

  /* ---------------- OOXML ---------------- */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const COLOR = { given: '0B5CAD', derived: '146C2E', new: 'B36B00', ok: '146C2E', err: 'B00020', dim: '5F6368', diff: 'B00020' };

  function runXml(seg, extraPr) {
    let pr = extraPr || '';
    if (seg.b) pr += '<w:b/>';
    if (seg.i) pr += '<w:i/>';
    if (seg.cls && COLOR[seg.cls]) pr += '<w:color w:val="' + COLOR[seg.cls] + '"/>';
    return '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') +
      '<w:t xml:space="preserve">' + esc(seg.text) + '</w:t></w:r>';
  }
  function para(runs, o) {
    o = o || {};
    let ppr = '';
    if (o.h) ppr += '<w:outlineLvl w:val="' + o.h + '"/>';
    if (o.spacing) ppr += '<w:spacing w:before="' + o.spacing + '" w:after="60"/>';
    else ppr += '<w:spacing w:after="60"/>';
    return '<w:p><w:pPr>' + ppr + '</w:pPr>' + runs + '</w:p>';
  }
  const SZ = function (half) { return '<w:sz w:val="' + half + '"/><w:szCs w:val="' + half + '"/>'; };

  const TBL_BORDERS = '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) {
      return '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="999999"/>';
    }).join('') + '</w:tblBorders>';
  const GRID_FILL = { given: 'DCE9F8', derived: 'DFF0E3', new: 'FFF3C4', diff: 'FBE2E2', red: 'FBDADA', blue: 'DCE8FA' };
  const GRID_COLOR = { letter: '808080', dot: 'C0C0C0', unknown: '808080' };

  /* 分数文本 → {sign, num, den}；非分数返回 null */
  function parseFrac(t) {
    const m = /^(-?)(\d+)\/(\d+)$/.exec(t);
    return m ? { sign: m[1], num: m[2], den: m[3] } : null;
  }
  /* 格子宽度量：分数按分子/分母较长者计 */
  function cellMetric(t) {
    const f = parseFrac(t);
    if (f) return Math.max(f.num.length, f.den.length) + (f.sign ? 1 : 0) + 1;
    return t.length;
  }

  function gridXml(block) {
    const n = block.n;
    // 正方形 + 尺寸随数字自适应：列宽按最宽内容计算，行高取同值
    let maxM = 1;
    for (const c of block.cells) { if (c && c.text) maxM = Math.max(maxM, cellMetric(c.text)); }
    const colw = Math.max(560, Math.min(2100, Math.round(250 * maxM + 260)));
    let xml = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:jc w:val="center"/>' + TBL_BORDERS +
      '<w:tblCellMar><w:top w:w="30" w:type="dxa"/><w:bottom w:w="30" w:type="dxa"/><w:start w:w="40" w:type="dxa"/><w:end w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>';
    for (let i = 0; i < n; i++) xml += '<w:gridCol w:w="' + colw + '"/>';
    xml += '</w:tblGrid>';
    for (let r = 0; r < n; r++) {
      xml += '<w:tr><w:trPr><w:trHeight w:val="' + colw + '" w:hRule="atLeast"/></w:trPr>';
      for (let c = 0; c < n; c++) {
        const cell = block.cells[r * n + c] || { text: '', kind: 'dot' };
        let shd = GRID_FILL[cell.kind] ? '<w:shd w:val="clear" w:fill="' + GRID_FILL[cell.kind] + '"/>' : '';
        const rpr = (GRID_COLOR[cell.kind] ? '<w:color w:val="' + GRID_COLOR[cell.kind] + '"/>' : '') +
          (cell.kind === 'letter' || cell.kind === 'unknown' || cell.kind === 'red' || cell.kind === 'blue' ? '<w:i/>' : '') + (cell.kind === 'red' || cell.kind === 'blue' ? '<w:b/>' : '') + SZ(maxM >= 5 ? 16 : 20);
        let inner;
        const f = (cell.kind === 'given' || cell.kind === 'derived' || cell.kind === 'new') ? parseFrac(cell.text) : null;
        if (f) {
          // 立体分数：分子（下边框即分数线）在上，分母在下
          const signRun = f.sign
            ? '<w:r><w:rPr>' + rpr + '</w:rPr><w:t xml:space="preserve">' + esc(f.sign === '-' ? '−' : '') + '</w:t></w:r>'
            : '';
          inner =
            '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="10"/>' +
            '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="auto"/></w:pBdr></w:pPr>' + signRun +
            '<w:r><w:rPr>' + rpr + '</w:rPr><w:t xml:space="preserve">' + esc(f.num) + '</w:t></w:r></w:p>' +
            '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="10" w:after="0"/></w:pPr>' +
            '<w:r><w:rPr>' + rpr + '</w:rPr><w:t xml:space="preserve">' + esc(f.den) + '</w:t></w:r></w:p>';
        } else {
          inner =
            '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr>' +
            '<w:r><w:rPr>' + rpr + '</w:rPr><w:t xml:space="preserve">' + esc(cell.text) + '</w:t></w:r></w:p>';
        }
        xml += '<w:tc><w:tcPr>' + shd + '<w:vAlign w:val="center"/></w:tcPr>' + inner + '</w:tc>';
      }
      xml += '</w:tr>';
    }
    xml += '</w:tbl>';
    if (block.caption) xml += captionPara(block.caption);
    return xml;
  }
  function captionPara(segs) {
    return para(segs.map(function (s) { return runXml({ text: s.text, cls: 'dim' }, SZ(17)); }).join(''), { spacing: 120 });
  }
  function tableXml(block) {
    const ncol = Math.max(1, block.head.length);
    let xml = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' + TBL_BORDERS + '</w:tblPr><w:tblGrid>';
    for (let i = 0; i < ncol; i++) xml += '<w:gridCol w:w="' + Math.floor(9200 / ncol) + '"/>';
    xml += '</w:tblGrid>';
    const mkRow = function (segs, isHead) {
      let tr = '<w:tr>';
      if (isHead) tr += '<w:trPr><w:tblHeader/></w:trPr>';
      for (let i = 0; i < ncol; i++) {
        const seg = (segs && segs[i]) || { text: '' };
        tr += '<w:tc><w:tcPr>' + (isHead ? '<w:shd w:val="clear" w:fill="EEEEEE"/>' : '') + '</w:tcPr>' +
          '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>' + runXml(seg, SZ(isHead ? 19 : 19)) + '</w:p></w:tc>';
      }
      return tr + '</w:tr>';
    };
    xml += mkRow(block.head, true);
    for (const row of block.rows) xml += mkRow(row, false);
    xml += '</w:tbl>';
    if (block.caption) xml += captionPara(block.caption);
    else xml += '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr></w:p>';
    return xml;
  }

  function renderBlocks(blocks) {
    let body = '';
    for (const b of blocks) {
        if (b.t === 'title') body += para('<w:r><w:rPr><w:b/>' + SZ(34) + '</w:rPr><w:t xml:space="preserve">' + esc(b.text) + '</w:t></w:r>', { spacing: 160 });
        else if (b.t === 'h2') body += para('<w:r><w:rPr><w:b/>' + SZ(28) + '</w:rPr><w:t xml:space="preserve">' + esc(b.text) + '</w:t></w:r>', { h: 1, spacing: 160 });
        else if (b.t === 'h3') body += para('<w:r><w:rPr><w:b/>' + SZ(23) + '</w:rPr><w:t xml:space="preserve">' + esc(b.text) + '</w:t></w:r>', { h: 2, spacing: 140 });
        else if (b.t === 'p') body += para(b.segs.map(function (s) { return runXml(s, SZ(21)); }).join(''));
        else if (b.t === 'grid') body += gridXml(b);
        else if (b.t === 'table') body += tableXml(b);
        else if (b.t === 'proof') {
          body += para('<w:r><w:rPr><w:b/>' + SZ(23) + '</w:rPr><w:t xml:space="preserve">证明（对任意 ' + esc(b.title || '幻方') + '成立）</w:t></w:r>', { h: 2, spacing: 140 });
          body += renderBlocks(b.blocks);
        }
        else if (b.t === 'pagebreak') { /* 已按页分隔 */ }
    }
    return body;
  }

  function blocksToBodyXml(pages) {
    let body = '';
    pages.forEach(function (blocks, pi) {
      if (pi > 0) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      body += renderBlocks(blocks);
    });
    return body;
  }

  function buildDocx(pages, title) {
    const enc = new TextEncoder();
    const body = blocksToBodyXml(pages);
    const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>';
    const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="宋体" w:hAnsi="Calibri"/>' + SZ(21) + '</w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
    const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
    const docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    const files = [
      { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
      { name: '_rels/.rels', data: enc.encode(rels) },
      { name: 'word/document.xml', data: enc.encode(documentXml) },
      { name: 'word/styles.xml', data: enc.encode(stylesXml) },
      { name: 'word/_rels/document.xml.rels', data: enc.encode(docRels) }
    ];
    return zipStore(files);
  }

  return { buildDocx: buildDocx, zipStore: zipStore, crc32: crc32 };
});
