/*
 * Whatsapp Scrapper by abdumezar — minimal .xlsx writer (isolated world + node tests).
 *
 * Why not just ship CSV: Excel parses a bare 12-digit phone number as a float
 * and renders 2.01E+11, and there is no in-file way to stop it. A real workbook
 * can say "this cell is text", which is the whole point of this file.
 *
 * Every cell is written as an inline string (t="inlineStr"), so there is no
 * shared-string table to maintain and no number coercion anywhere. Entries are
 * STOREd rather than deflated: the browser has no synchronous deflate, the
 * files are small, and Excel does not care.
 *
 * Dependency-free by design — the extension has no build step and no node_modules.
 */
(function (root) {
  'use strict';

  const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : { encode: (s) => Buffer.from(s, 'utf8') };
  const bytes = (s) => Uint8Array.from(enc.encode(s));

  const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  /* XML 1.0 forbids most control characters outright — a stray one from a
     profile name would make the workbook unopenable, so they are dropped. */
  function xml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
  }

  const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  /** A1-style column name: 1 -> A, 27 -> AA. */
  function colName(n) {
    let s = '';
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = (n - r - 1) / 26;
    }
    return s;
  }

  function sheetXml(cols, rows) {
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
    // Freeze the header row, and give every column room for a long name.
    out.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
    out.push('<cols>');
    cols.forEach((c, i) => out.push(`<col min="${i + 1}" max="${i + 1}" width="${Math.min(40, Math.max(12, c.length + 4))}" customWidth="1"/>`));
    out.push('</cols><sheetData>');
    const row = (values, index) => {
      out.push(`<row r="${index}">`);
      values.forEach((v, i) => {
        if (v === null || v === undefined || v === '') return;   // an empty cell is simply absent
        out.push(`<c r="${colName(i + 1)}${index}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`);
      });
      out.push('</row>');
    };
    row(cols, 1);
    rows.forEach((r, i) => row(cols.map((c) => {
      const v = r[c];
      return typeof v === 'boolean' ? (v ? 'true' : 'false') : v;
    }), i + 2));
    out.push('</sheetData><autoFilter ref="A1:' + colName(cols.length) + (rows.length + 1) + '"/></worksheet>');
    return out.join('');
  }

  const FILES = (cols, rows, sheetName) => [
    ['[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>'],
    ['_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'],
    ['xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>'],
    ['xl/worksheets/sheet1.xml', sheetXml(cols, rows)],
  ];

  /** Excel rejects these in a sheet name, and silently truncates past 31 chars. */
  function sheetTitle(s) {
    const clean = String(s || 'Members').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
    return clean || 'Members';
  }

  // ---- ZIP (stored, no compression) --------------------------------------
  function zip(files, when) {
    const d = when || new Date();
    // MS-DOS packed date/time: seconds have 2s resolution, years start at 1980.
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const [name, text] of files) {
      const nameBytes = bytes(name);
      const data = bytes(text);
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length + data.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);      // version needed
      lv.setUint16(6, 0x0800, true);  // UTF-8 names
      lv.setUint16(8, 0, true);       // method: stored
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      local.set(nameBytes, 30);
      local.set(data, 30 + nameBytes.length);
      locals.push(local);

      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);      // version made by
      cv.setUint16(6, 20, true);      // version needed
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      centrals.push(central);

      offset += local.length;
    }

    const cdSize = centrals.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    const total = offset + cdSize + end.length;
    const out = new Uint8Array(total);
    let at = 0;
    for (const b of locals) { out.set(b, at); at += b.length; }
    for (const b of centrals) { out.set(b, at); at += b.length; }
    out.set(end, at);
    return out;
  }

  /**
   * @param {Array<object>} rows   objects keyed by column name
   * @param {string[]} cols        column order
   * @param {string} sheetName
   * @returns {Uint8Array} a complete .xlsx file
   */
  function toXlsx(rows, cols, sheetName, when) {
    return zip(FILES(cols, rows, sheetTitle(sheetName)), when);
  }

  const api = { toXlsx, crc32, colName, sheetTitle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WAXXlsx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
