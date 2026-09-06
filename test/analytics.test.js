/* The analysis the dashboard draws, and the CSV reader the labels import uses. */
const assert = require('assert');
const a = require('../src/lib/analytics.js');
const cp = require('../src/lib/csvparse.js');

const row = (o) => Object.assign({
  country_code: '', country_name: '', country_iso: '', phone_number: '', formatted_phone: '',
  is_my_contact: null, saved_name: '', public_name: '', is_business: null, is_admin: null,
  is_valid_number: null, group_id: 'g1', group_name: 'G1', wid: '', joined_at: '',
}, o);

const ROWS = [
  row({ phone_number: '201001234567', country_code: '20', country_iso: 'EG', country_name: 'Egypt', is_valid_number: true, is_my_contact: true, is_admin: true, saved_name: 'Owner', joined_at: '2026-01-05T00:00:00.000Z' }),
  row({ phone_number: '201112223334', country_code: '20', country_iso: 'EG', country_name: 'Egypt', is_valid_number: true, is_business: true, public_name: 'Shop', joined_at: '2026-01-20T00:00:00.000Z' }),
  row({ phone_number: '966501234567', country_code: '966', country_iso: 'SA', country_name: 'Saudi Arabia', is_valid_number: true, public_name: 'Sara', joined_at: '2026-02-02T00:00:00.000Z' }),
  row({ phone_number: '9995', country_code: '999', is_valid_number: false, public_name: 'Bad number' }),
  row({ wid: '12345@lid', public_name: 'Hidden' }),
  row({ wid: '67890@lid' }),
  // The same person, seen again in a second chat.
  row({ phone_number: '201001234567', country_code: '20', country_iso: 'EG', country_name: 'Egypt', is_valid_number: true, group_id: 'g2', group_name: 'G2', saved_name: 'Owner' }),
];

// ---- summarize ------------------------------------------------------------
const s = a.summarize(ROWS);
assert.strictEqual(s.total, 7);
assert.strictEqual(s.withPhone, 5);
assert.strictEqual(s.noPhone, 2);
assert.strictEqual(s.valid, 4);
assert.strictEqual(s.invalid, 1);
assert.strictEqual(s.saved, 1);
assert.strictEqual(s.business, 1);
assert.strictEqual(s.admins, 1);
assert.strictEqual(s.lidOnly, 2, 'a wid with no number is a privacy-mode member');
assert.strictEqual(s.unnamed, 1);
assert.strictEqual(s.chats, 2);
assert.strictEqual(s.people, 6, 'the duplicate is one person');
assert.strictEqual(s.inMultipleChats, 1);
assert.deepStrictEqual(s.countries.map((c) => [c.code, c.n]), [['20', 3], ['966', 1], ['999', 1]], 'sorted by size');
assert.strictEqual(s.countries[0].name, 'Egypt');
assert.deepStrictEqual(s.months, [{ month: '2026-01', n: 2 }, { month: '2026-02', n: 1 }]);

const empty = a.summarize([]);
assert.strictEqual(empty.total, 0);
assert.deepStrictEqual(empty.countries, []);
assert.deepStrictEqual(empty.months, []);

// A long tail folds into one slice rather than inventing more colours.
const many = Array.from({ length: 12 }, (_, i) => ({ code: String(i), n: 12 - i }));
const cut = a.topN(many, 8);
assert.strictEqual(cut.head.length, 8);
assert.strictEqual(cut.other.countries, 4);
assert.strictEqual(cut.other.n, 4 + 3 + 2 + 1);
assert.strictEqual(a.topN(many.slice(0, 3), 8).other, null);

// ---- overlap --------------------------------------------------------------
const o = a.overlap([
  { id: 'a', title: 'A', keys: ['p:1', 'p:2', 'p:3'] },
  { id: 'b', title: 'B', keys: ['p:2', 'p:3', 'p:4'] },
  { id: 'c', title: 'C', keys: ['p:3', 'p:9'] },
]);
assert.strictEqual(o.pairs.length, 3, 'every pair once');
const ab = o.pairs.find((p) => p.a === 'a' && p.b === 'b');
assert.strictEqual(ab.shared, 2);
assert.strictEqual(ab.onlyA, 1);
assert.strictEqual(ab.onlyB, 1);
assert.strictEqual(+ab.jaccard.toFixed(2), 0.5);
assert.strictEqual(o.everywhere, 1, 'only p:3 is in all three');
assert.strictEqual(o.union, 5);
assert.deepStrictEqual(a.onlyIn(['p:1', 'p:2', 'p:3'], [['p:2'], ['p:3']]), ['p:1']);
assert.strictEqual(a.overlap([{ id: 'a', title: 'A', keys: ['p:1'] }]).everywhere, null, 'one set has no intersection to report');

// ---- quality --------------------------------------------------------------
const q = a.quality(ROWS);
assert.strictEqual(q.total, 7);
assert.strictEqual(q.usable, 4, 'has a number and it is not known-bad');
const bucket = (code) => q.buckets.find((b) => b.code === code);
assert.strictEqual(bucket('noNumber').n, 2);
assert.strictEqual(bucket('invalidNumber').n, 1);
assert.strictEqual(bucket('unnamed').n, 1);
assert.strictEqual(bucket('duplicated').n, 1);
assert.ok(bucket('noNumber').rows.every((r) => !r.phone_number), 'buckets carry their rows');

// ---- match a pasted list --------------------------------------------------
const m = a.matchList('+20 100 123 4567\n00966501234567, 15551234567\n\nnonsense\n201001234567', ROWS);
assert.strictEqual(m.matched.length, 2, 'the egyptian and the saudi number are members');
assert.strictEqual(m.missing.length, 1);
assert.strictEqual(m.checked, 3, 'the repeat of the first number is not checked twice');
assert.strictEqual(m.unreadable, 1, '"nonsense" has no digits');
assert.strictEqual(m.matched[0].row.saved_name, 'Owner', 'a match carries its row');
assert.strictEqual(a.normalizeNumber('00 20 100'), '20100', 'an international 00 prefix is not part of the number');
assert.strictEqual(a.normalizeNumber('(+1) 415-555-0100'), '14155550100');

// ---- timeline -------------------------------------------------------------
const tl = a.timeline([
  { at: '2026-08-01T00:00:00.000Z', size: 900, joined: 0, left: 0 },
  { at: '2026-08-15T00:00:00.000Z', size: 930, joined: 35, left: 5 },
  { at: '2026-09-01T00:00:00.000Z', size: 945, joined: 20, left: 5 },
]);
assert.strictEqual(tl.points.length, 3);
assert.deepStrictEqual(tl.totals, { joined: 55, left: 10 });
assert.strictEqual(tl.net, 45);
assert.strictEqual(tl.peak, 35, 'the tallest bar in either direction');
assert.strictEqual(tl.last.size, 945);
assert.deepStrictEqual(a.timeline(null).points, [], 'no history is not an error');

// ---- community tree -------------------------------------------------------
const tree = a.communityTree([
  { id: 'c1', title: 'Community', kind: 'community', participantCount: 12 },
  { id: 's1', title: 'Announcements', kind: 'subgroup', parentGroup: 'c1', participantCount: 945 },
  { id: 's2', title: 'Chat', kind: 'subgroup', parentGroup: 'c1', participantCount: 88 },
  { id: 'g1', title: 'Standalone', kind: 'group', participantCount: 30 },
  { id: 's3', title: 'Orphan', kind: 'subgroup', parentGroup: 'missing', participantCount: 5 },
]);
assert.deepStrictEqual(tree.roots.map((r) => r.chat.id), ['g1', 'c1'], 'biggest first, and a community counts its own members');
const community = tree.roots.find((r) => r.chat.id === 'c1');
assert.deepStrictEqual(community.children.map((c) => c.id), ['s1', 's2']);
assert.strictEqual(community.reach, 1033, 'sub-group members, before dedupe');
assert.deepStrictEqual(tree.orphans.map((c) => c.id), ['s3'], 'a sub-group whose parent is not loaded still shows');

// ---- CSV reading ----------------------------------------------------------
assert.deepStrictEqual(cp.parse('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
assert.deepStrictEqual(cp.parse('﻿"a","b"\r\n"x, y","he said ""hi"""\r\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
assert.deepStrictEqual(cp.parse('a;b\n1;2'), [['a', 'b'], ['1', '2']], 'semicolon files (european excel) are read too');
assert.deepStrictEqual(cp.parse('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
assert.deepStrictEqual(cp.parse('"multi\nline",x'), [['multi\nline', 'x']], 'a newline inside quotes stays in the field');
assert.deepStrictEqual(cp.parse(''), []);

const labels = cp.parseLabels('phone,label,notes\n"+20 100 123 4567",Customer,"paid, in full"\n966501234567,Supplier,\n,Nothing,\n201112223334,,\n', a.normalizeNumber);
assert.strictEqual(labels.rows, 2);
assert.strictEqual(labels.skipped, 2, 'a row with no number, and a row with nothing to say');
assert.ok(labels.headed);
assert.deepStrictEqual(labels.labels['201001234567'], { label: 'Customer', notes: 'paid, in full' });
assert.deepStrictEqual(labels.labels['966501234567'], { label: 'Supplier', notes: '' });

// Headerless files are read positionally, which is what a two-column paste is.
const bare = cp.parseLabels('201001234567,VIP\n966501234567,Lead', a.normalizeNumber);
assert.strictEqual(bare.headed, false);
assert.strictEqual(bare.rows, 2);
assert.strictEqual(bare.labels['201001234567'].label, 'VIP');

// Alias headers, including Arabic ones.
const aliased = cp.parseLabels('Mobile;Tag\n+201001234567;عميل', a.normalizeNumber);
assert.strictEqual(aliased.labels['201001234567'].label, 'عميل');
const arabicHeader = cp.parseLabels('الرقم,تصنيف\n201001234567,مورد', a.normalizeNumber);
assert.strictEqual(arabicHeader.labels['201001234567'].label, 'مورد');

console.log('analytics.test.js ok');
