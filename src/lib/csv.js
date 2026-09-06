/* Whatsapp Scrapper by abdumezar — CSV building (isolated world + node tests). */
(function (root) {
  'use strict';

  const BASE_COLUMNS = ['country_code', 'country_name', 'phone_number', 'formatted_phone', 'is_my_contact', 'saved_name', 'public_name', 'is_business', 'is_admin'];
  const EXTRA_COLUMNS = ['group_name', 'group_id', 'role', 'username', 'wid', 'joined_at', 'country_iso', 'is_valid_number'];

  // A cell that a spreadsheet would evaluate as a formula gets a leading
  // apostrophe. Exception: "+<digits/spaces/dashes/parens>" is a phone number,
  // not a formula, and must survive intact in formatted_phone.
  function guard(s) {
    if (/^\+[\d\s\-().]+$/.test(s)) return s;
    if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
    return s;
  }

  function cell(v) {
    if (v === null || v === undefined) return '""';
    let s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
    s = guard(s);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function columnsFor(extras) {
    const cols = BASE_COLUMNS.slice();
    for (const c of EXTRA_COLUMNS) if (extras && extras[c]) cols.push(c);
    return cols;
  }

  /** rows: array of objects keyed by column names. Returns a string with BOM + CRLF. */
  function toCsv(rows, extras) {
    const cols = columnsFor(extras);
    const lines = [cols.map(cell).join(',')];
    for (const r of rows) lines.push(cols.map((c) => cell(r[c])).join(','));
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  /**
   * Tab-separated, for the clipboard. Pasting this into Sheets or Excel lands
   * the columns as text — no file, and none of the CSV import dialog's
   * number-mangling. Tabs and newlines inside a value would break the row
   * apart, so they collapse to a space; the formula guard still applies,
   * because a pasted "=..." is evaluated just the same.
   */
  function toTsv(rows, extras) {
    const cols = columnsFor(extras);
    const flat = (v) => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
      return guard(s).replace(/[\t\r\n]+/g, ' ');
    };
    const lines = [cols.join('\t')];
    for (const r of rows) lines.push(cols.map((c) => flat(r[c])).join('\t'));
    return lines.join('\n');
  }

  /** Dedupe by phone when present, else by wid. Keeps the first occurrence but
   *  merges is_admin (true wins) so an admin in one sub-group stays an admin. */
  function dedupe(rows) {
    const seen = new Map();
    const out = [];
    for (const r of rows) {
      const key = r.phone_number ? 'p:' + r.phone_number : 'w:' + (r.wid || Math.random());
      const prev = seen.get(key);
      if (prev) {
        if (r.is_admin === true) prev.is_admin = true;
        if (prev.role !== 'superadmin' && (r.role === 'superadmin' || (r.role === 'admin' && prev.role !== 'admin'))) prev.role = r.role;
        if (!prev.saved_name && r.saved_name) prev.saved_name = r.saved_name;
        if (!prev.public_name && r.public_name) prev.public_name = r.public_name;
        continue;
      }
      seen.set(key, r);
      out.push(r);
    }
    return out;
  }

  const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { sensitivity: 'base' }) : null;
  const cmp = (a, b) => (collator ? collator.compare(a, b) : (a < b ? -1 : a > b ? 1 : 0));

  /** Admins first; then saved name, public name, number. Stable. */
  function sortRows(rows) {
    return rows.slice().sort((a, b) => {
      const aa = a.is_admin === true ? 0 : 1, ba = b.is_admin === true ? 0 : 1;
      if (aa !== ba) return aa - ba;
      const an = a.saved_name || '\uFFFF', bn = b.saved_name || '\uFFFF';
      if (an !== bn) return cmp(an, bn);
      const ap = a.public_name || '\uFFFF', bp = b.public_name || '\uFFFF';
      if (ap !== bp) return cmp(ap, bp);
      return cmp(a.phone_number || '', b.phone_number || '');
    });
  }

  function slug(s) {
    return String(s || '').normalize('NFKD').replace(/[^\w؀-ۿ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'chat';
  }

  function filename(title, count, when, ext) {
    const d = when || new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
    const base = count > 1 ? `wa-roster_multi_${count}-chats` : `wa-roster_${slug(title)}`;
    return `${base}_${stamp}.${ext || 'csv'}`;
  }

  const api = { BASE_COLUMNS, EXTRA_COLUMNS, columnsFor, toCsv, toTsv, dedupe, sortRows, filename, guard, slug };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WAXCsv = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
