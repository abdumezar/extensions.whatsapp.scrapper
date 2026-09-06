/*
 * Whatsapp Scrapper by abdumezar — vCard 3.0 writer (isolated world + node tests).
 *
 * A .vcf imports straight into a phone's address book, iOS Contacts, Google
 * Contacts or Outlook — which is what most people actually want when they ask
 * for "the numbers" of a group.
 *
 * 3.0 rather than 4.0 on purpose: it is what iOS, Android and Outlook all
 * import without complaint. Rows with no phone number are skipped, because a
 * contact with no way to reach it is not a contact — the count comes back so
 * the UI can say so.
 */
(function (root) {
  'use strict';

  /* RFC 6350 §3.4: backslash, comma and semicolon are structural; a newline is
     written as the two characters \n. Order matters — escape backslashes first. */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  /** Best available display name, falling back to the number itself. */
  function nameOf(r) {
    return r.saved_name || r.public_name || r.formatted_phone || r.phone_number || '';
  }

  /**
   * @param {Array<object>} rows   output rows (see content.js toOutputRow)
   * @param {{group?: boolean}} opts  group: write the group name into ORG
   * @returns {{text: string, written: number, skipped: number}}
   */
  function toVcard(rows, opts) {
    const withGroup = !!(opts && opts.group);
    const lines = [];
    let written = 0;
    let skipped = 0;

    for (const r of rows) {
      if (!r.phone_number) { skipped++; continue; }
      const name = nameOf(r);
      lines.push('BEGIN:VCARD');
      lines.push('VERSION:3.0');
      // N is structured (family;given;…); everything here is a single display
      // name, so it goes in the "given" slot with the rest empty.
      lines.push('N:;' + esc(name) + ';;;');
      lines.push('FN:' + esc(name));
      lines.push('TEL;TYPE=CELL:+' + r.phone_number);
      if (r.is_business === true && r.public_name) lines.push('ORG:' + esc(r.public_name));
      else if (withGroup && r.group_name) lines.push('ORG:' + esc(r.group_name));
      if (withGroup && r.group_name) lines.push('CATEGORIES:' + esc(r.group_name));
      const note = [];
      if (r.is_admin === true) note.push('admin');
      if (r.is_business === true) note.push('business');
      if (note.length) lines.push('NOTE:' + esc(note.join(', ')));
      lines.push('END:VCARD');
      written++;
    }

    // vCard is a CRLF format, and a trailing CRLF closes the last card.
    return { text: lines.length ? lines.join('\r\n') + '\r\n' : '', written, skipped };
  }

  const api = { toVcard, esc, nameOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WAXVcard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
