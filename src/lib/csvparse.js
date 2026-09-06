/*
 * Whatsapp Scrapper by abdumezar — CSV reader (dashboard + node tests).
 *
 * The extension has always written CSV; the labels feature is the first thing
 * that reads it back, and the file comes from a spreadsheet the user exported,
 * so it must survive what spreadsheets actually emit: a UTF-8 BOM, CRLF, quoted
 * fields containing commas, newlines and doubled quotes, and a trailing blank
 * line. RFC 4180 with those allowances, and nothing more clever.
 */
(function (root) {
  'use strict';

  /**
   * @param {string} text
   * @param {{delimiter?: string}} [opts]  defaults to the delimiter that wins on line 1
   * @returns {string[][]}
   */
  function parse(text, opts) {
    let s = String(text == null ? '' : text);
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);          // BOM
    const delimiter = (opts && opts.delimiter) || sniff(s);

    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    let started = false;                                      // this field began with a quote

    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quoted) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }        // an escaped quote
          else quoted = false;
        } else field += c;
        continue;
      }
      if (c === '"' && field === '' && !started) { quoted = true; started = true; continue; }
      if (c === delimiter) { row.push(field); field = ''; started = false; continue; }
      if (c === '\r') continue;                               // CRLF, or a lone CR
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; started = false; continue; }
      field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    // A file ending in a newline leaves one empty row behind.
    return rows.filter((r) => r.length > 1 || (r[0] || '').trim() !== '');
  }

  /** Comma unless the first line clearly has more semicolons or tabs. */
  function sniff(s) {
    const line = s.split(/\r?\n/, 1)[0] || '';
    const count = (ch) => line.split(ch).length - 1;
    const best = [[',', count(',')], [';', count(';')], ['\t', count('\t')]].sort((a, b) => b[1] - a[1])[0];
    return best[1] > 0 ? best[0] : ',';
  }

  const norm = (h) => String(h || '').trim().toLowerCase().replace(/[\s_-]+/g, '');

  /** Header aliases, so a file exported from anywhere reasonable still lands. */
  const FIELDS = {
    phone: ['phone', 'phonenumber', 'number', 'mobile', 'msisdn', 'formattedphone', 'tel', 'رقم', 'الهاتف', 'الرقم'],
    label: ['label', 'tag', 'group', 'segment', 'category', 'type', 'تصنيف', 'وسم'],
    notes: ['notes', 'note', 'comment', 'comments', 'remark', 'ملاحظات', 'ملاحظة'],
  };

  function headerMap(header) {
    const map = {};
    header.forEach((h, i) => {
      const n = norm(h);
      for (const [field, aliases] of Object.entries(FIELDS)) {
        if (map[field] === undefined && aliases.includes(n)) map[field] = i;
      }
    });
    return map;
  }

  /**
   * Reads a labels file into `{[phoneDigits]: {label, notes}}`.
   *
   * With a recognisable header the columns are found by name; without one the
   * file is read positionally as phone,label,notes — which is what a hand-typed
   * two-column paste looks like.
   *
   * @returns {{labels: object, rows: number, skipped: number, columns: object, headed: boolean}}
   */
  function parseLabels(text, normalizeNumber) {
    const digits = normalizeNumber || ((v) => String(v || '').replace(/\D/g, ''));
    const table = parse(text);
    if (!table.length) return { labels: {}, rows: 0, skipped: 0, columns: {}, headed: false };

    let map = headerMap(table[0]);
    const headed = map.phone !== undefined;
    let start = 0;
    if (headed) start = 1;
    else map = { phone: 0, label: 1, notes: 2 };

    const labels = {};
    let rows = 0, skipped = 0;
    for (let i = start; i < table.length; i++) {
      const line = table[i];
      const phone = digits(line[map.phone]);
      if (!phone) { skipped++; continue; }
      const label = map.label !== undefined ? String(line[map.label] || '').trim() : '';
      const notes = map.notes !== undefined ? String(line[map.notes] || '').trim() : '';
      if (!label && !notes) { skipped++; continue; }
      labels[phone] = { label, notes };
      rows++;
    }
    return { labels, rows, skipped, columns: map, headed };
  }

  const api = { parse, parseLabels, sniff, headerMap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WAXCsvParse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
