const assert = require('assert');
const csv = require('../src/lib/csv.js');

// header + BOM + CRLF
const out = csv.toCsv([{ country_code: '20', country_name: 'Egypt', phone_number: '201001234567', formatted_phone: '+20 100 123 4567', is_my_contact: true, saved_name: 'Ahmed "A"', public_name: 'أحمد', is_business: false, is_admin: null }]);
assert.ok(out.startsWith('﻿'), 'BOM');
const lines = out.slice(1).split('\r\n');
assert.strictEqual(lines[0], '"country_code","country_name","phone_number","formatted_phone","is_my_contact","saved_name","public_name","is_business","is_admin"');
assert.strictEqual(lines[1], '"20","Egypt","201001234567","+20 100 123 4567","true","Ahmed ""A""","أحمد","false",""');
assert.strictEqual(lines[2], '');

// injection guard
assert.strictEqual(csv.guard('=1+1'), "'=1+1");
assert.strictEqual(csv.guard('@cmd'), "'@cmd");
assert.strictEqual(csv.guard('-5'), "'-5");
assert.strictEqual(csv.guard('+20 100 123 4567'), '+20 100 123 4567', 'phone survives');
assert.strictEqual(csv.guard('+1 (415) 555-0100'), '+1 (415) 555-0100');
assert.strictEqual(csv.guard('+HYPERLINK("x")'), "'+HYPERLINK(\"x\")");

// extras ordering
assert.deepStrictEqual(csv.columnsFor({ role: true, group_name: true }), [...csv.BASE_COLUMNS, 'group_name', 'role']);

// dedupe merges admin
const d = csv.dedupe([
  { phone_number: '1', wid: 'a', is_admin: false, role: 'member', saved_name: '' },
  { phone_number: '1', wid: 'b', is_admin: true, role: 'admin', saved_name: 'X' },
  { phone_number: '', wid: 'c', is_admin: false },
  { phone_number: '', wid: 'c', is_admin: false },
]);
assert.strictEqual(d.length, 2);
assert.strictEqual(d[0].is_admin, true); assert.strictEqual(d[0].role, 'admin'); assert.strictEqual(d[0].saved_name, 'X');

// sort: admins first, then names, blanks last
const s = csv.sortRows([
  { is_admin: false, saved_name: '', public_name: 'zed', phone_number: '3' },
  { is_admin: false, saved_name: 'bob', public_name: '', phone_number: '2' },
  { is_admin: true, saved_name: '', public_name: '', phone_number: '9' },
  { is_admin: false, saved_name: 'Alice', public_name: '', phone_number: '1' },
]);
assert.deepStrictEqual(s.map((r) => r.phone_number), ['9', '1', '2', '3']);

// filename
assert.match(csv.filename('My Group / 2026!', 1, new Date(2026, 8, 6, 14, 5)), /^wa-roster_My-Group-2026_2026-09-06_1405\.csv$/);
assert.match(csv.filename('x', 3, new Date(2026, 8, 6, 14, 5)), /^wa-roster_multi_3-chats_2026-09-06_1405\.csv$/);
assert.match(csv.filename('مجموعة الحي', 1), /^wa-roster_مجموعة-الحي_/);
console.log('csv.test.js ok');
