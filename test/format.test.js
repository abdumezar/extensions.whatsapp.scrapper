/* Clipboard TSV, .xlsx and .vCard output. */
const assert = require('assert');
const zlib = require('zlib');
const csv = require('../src/lib/csv.js');
const xlsx = require('../src/lib/xlsx.js');
const vcard = require('../src/lib/vcard.js');

const ROWS = [
  { country_code: '20', country_name: 'Egypt', phone_number: '201001234567', formatted_phone: '+20 100 123 4567', is_my_contact: true, saved_name: 'Ahmed "A"', public_name: 'أحمد', is_business: false, is_admin: true, group_name: 'Test Group', country_iso: 'EG', is_valid_number: true },
  { country_code: '966', country_name: 'Saudi Arabia', phone_number: '966501234567', formatted_phone: '+966 50 123 4567', is_my_contact: false, saved_name: '', public_name: 'Riyadh; Shop', is_business: true, is_admin: false, group_name: 'Test Group', country_iso: 'SA', is_valid_number: true },
  { country_code: '', country_name: '', phone_number: '', formatted_phone: '', is_my_contact: false, saved_name: '=SUM(1)', public_name: 'No\nNumber', is_business: null, is_admin: false, group_name: 'Test Group', country_iso: '', is_valid_number: null },
];

// ---- new extra columns ----------------------------------------------------
assert.ok(csv.EXTRA_COLUMNS.includes('country_iso') && csv.EXTRA_COLUMNS.includes('is_valid_number'));
// Existing extras keep their relative order, so saved option sets stay meaningful.
assert.deepStrictEqual(csv.columnsFor({ role: true, group_name: true }), [...csv.BASE_COLUMNS, 'group_name', 'role']);

// ---- TSV ------------------------------------------------------------------
const tsv = csv.toTsv(ROWS, { country_iso: true });
const tsvLines = tsv.split('\n');
assert.ok(!tsv.startsWith('﻿'), 'no BOM: this goes on the clipboard, not into a file');
assert.strictEqual(tsvLines[0].split('\t').length, csv.BASE_COLUMNS.length + 1);
assert.ok(tsvLines[1].includes('201001234567\t+20 100 123 4567'), 'phone stays intact');
assert.ok(tsvLines[1].includes('Ahmed "A"'), 'quotes are literal in TSV — no CSV escaping');
assert.ok(tsvLines[3].includes("'=SUM(1)"), 'formula guard still applies to a paste');
assert.ok(!tsvLines[3].includes('\r') && tsvLines.length === 4, 'an embedded newline cannot split a row');
assert.ok(tsvLines[3].includes('No Number'), 'embedded newline flattened to a space');

// ---- XLSX -----------------------------------------------------------------
const COLS = [...csv.BASE_COLUMNS, 'group_name'];
const book = xlsx.toXlsx(ROWS, COLS, 'Test / Group: 2026');
assert.ok(book instanceof Uint8Array && book.length > 500);
assert.deepStrictEqual([...book.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'PK zip signature');

/** Minimal reader for the stored entries this writer emits, so the test reads
 *  the archive the way Excel would rather than the strings we just built. */
function unzip(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Locate the end-of-central-directory record, then walk the directory.
  let eocd = buf.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  assert.ok(eocd >= 0, 'end of central directory found');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const out = {};
  for (let i = 0; i < count; i++) {
    assert.strictEqual(view.getUint32(at, true), 0x02014b50, 'central directory header');
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = Buffer.from(buf.slice(at + 46, at + 46 + nameLen)).toString('utf8');
    assert.strictEqual(method, 0, 'entries are stored, not deflated');
    const localNameLen = view.getUint16(local + 26, true);
    const start = local + 30 + localNameLen + view.getUint16(local + 28, true);
    const data = buf.slice(start, start + size);
    assert.strictEqual(zlib.crc32(data), crc, `crc matches for ${name}`);
    out[name] = Buffer.from(data).toString('utf8');
    at += 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return out;
}

const parts = unzip(book);
for (const required of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml']) {
  assert.ok(parts[required], `${required} present`);
}
const sheet = parts['xl/worksheets/sheet1.xml'];
// The whole point: the phone is a string cell, so Excel cannot render 2.01E+11.
assert.ok(sheet.includes('t="inlineStr"'), 'cells are inline strings');
assert.ok(!/<c [^>]*t="n"/.test(sheet), 'no numeric cells at all');
assert.ok(sheet.includes('<t xml:space="preserve">201001234567</t>'), 'phone kept as text');
assert.ok(sheet.includes('أحمد'), 'arabic survives');
assert.ok(sheet.includes('Ahmed &quot;A&quot;'), 'xml escaping');
assert.ok(sheet.includes('<pane ySplit="1"'), 'header row frozen');
assert.ok(parts['xl/workbook.xml'].includes('name="Test Group 2026"'), 'sheet name stripped of characters excel rejects');
assert.strictEqual(xlsx.sheetTitle('a'.repeat(80)).length, 31, 'sheet name truncated to excel limit');
assert.strictEqual(xlsx.colName(1), 'A');
assert.strictEqual(xlsx.colName(27), 'AA');

// ---- vCard ----------------------------------------------------------------
const vc = vcard.toVcard(ROWS, { group: true });
assert.strictEqual(vc.written, 2);
assert.strictEqual(vc.skipped, 1, 'the row with no number is not a contact');
assert.ok(vc.text.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n'), 'CRLF, vCard 3.0');
assert.ok(vc.text.endsWith('END:VCARD\r\n'));
assert.ok(vc.text.includes('TEL;TYPE=CELL:+201001234567'), 'E.164 with the plus');
assert.ok(vc.text.includes('FN:Ahmed "A"'), 'quotes need no escaping');
assert.ok(vc.text.includes('Riyadh\\; Shop'), 'semicolon escaped');
assert.ok(vc.text.includes('ORG:Riyadh\\; Shop'), 'business name becomes ORG');
assert.ok(vc.text.includes('CATEGORIES:Test Group'), 'group becomes a category');
assert.ok(vc.text.includes('NOTE:admin'), 'role noted');
assert.strictEqual(vcard.esc('a\\b,c;d\ne'), 'a\\\\b\\,c\\;d\\ne');
assert.strictEqual(vcard.nameOf({ formatted_phone: '+1 415 555 0100' }), '+1 415 555 0100', 'falls back to the number');
assert.strictEqual(vcard.toVcard([], {}).text, '', 'no cards, no trailing newline');

// ---- filename extension ---------------------------------------------------
assert.match(csv.filename('G', 1, new Date(2026, 8, 6, 14, 5)), /\.csv$/);
assert.match(csv.filename('G', 1, new Date(2026, 8, 6, 14, 5), 'xlsx'), /^wa-roster_G_2026-09-06_1405\.xlsx$/);
assert.match(csv.filename('G', 2, new Date(2026, 8, 6, 14, 5), 'vcf'), /^wa-roster_multi_2-chats_2026-09-06_1405\.vcf$/);

console.log('format.test.js ok');
