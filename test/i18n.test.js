/*
 * Holds the two languages to each other, and both to the markup and the
 * content script. A missing Arabic key would silently render an English
 * sentence; a warning code with no entry would render as its own code.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const i18n = require('../src/popup/i18n.js');

const src = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
const html = src('popup', 'popup.html');

// ---- the two dictionaries match, key for key and shape for shape ----------
const en = i18n.dicts.en;
const ar = i18n.dicts.ar;
assert.deepStrictEqual(Object.keys(en).sort(), Object.keys(ar).sort(), 'en and ar cover the same keys');
for (const k of Object.keys(en)) {
  assert.strictEqual(typeof ar[k], typeof en[k], `${k}: a counted string in one language must be counted in the other`);
}

// Counted strings must actually consume their arguments, or a number goes missing.
for (const [lang, dict] of Object.entries(i18n.dicts)) {
  for (const [k, v] of Object.entries(dict)) {
    if (typeof v !== 'function') continue;
    const out = v(7, 3, 'x');
    assert.strictEqual(typeof out, 'string', `${lang}.${k} returns a string`);
    assert.ok(out.length, `${lang}.${k} is not empty`);
  }
}

// ---- warnings ------------------------------------------------------------
assert.deepStrictEqual(
  Object.keys(i18n.warningTables.en).sort(),
  Object.keys(i18n.warningTables.ar).sort(),
  'both languages describe the same warnings'
);

// Every code the content script can emit must have a sentence in both tables.
// Warning codes are camelCase; thrown error codes are SHOUTED and DOM literals
// like KeyboardEvent's code:'Escape' are capitalised, so neither is picked up.
const emitted = new Set();
for (const file of [['content', 'content.js'], ['content', 'dom-fallback.js']]) {
  for (const m of src(...file).matchAll(/\bcode:\s*'([a-z][a-zA-Z]*)'/g)) emitted.add(m[1]);
}
assert.ok(emitted.size >= 6, 'found the warning codes in the content script');
for (const code of emitted) {
  for (const lang of i18n.LANGS) {
    assert.ok(i18n.warningTables[lang][code], `${lang} has a sentence for the "${code}" warning`);
  }
}
// …and no table entry is dead weight.
for (const code of Object.keys(i18n.warningTables.en)) {
  assert.ok(emitted.has(code), `"${code}" is still emitted somewhere`);
}

// An unknown code degrades to something readable rather than throwing.
assert.strictEqual(i18n.warning({ code: 'nope' }), 'nope');
assert.strictEqual(i18n.warning('a plain sentence'), 'a plain sentence');
assert.ok(i18n.warning({ code: 'domPartial', got: 900, reported: 945 }).includes('900'));

// ---- markup --------------------------------------------------------------
const keysInHtml = [...html.matchAll(/data-i18n(?:-title|-ph)?="([a-zA-Z]+)"/g)].map((m) => m[1]);
assert.ok(keysInHtml.length > 30, 'the markup is actually marked up');
for (const k of new Set(keysInHtml)) {
  assert.notStrictEqual(en[k], undefined, `popup.html asks for the "${k}" string`);
}

// Keys used from popup.js as t('key') must exist too.
for (const m of src('popup', 'popup.js').matchAll(/\bt\('([a-zA-Z]+)'/g)) {
  assert.notStrictEqual(en[m[1]], undefined, `popup.js asks for the "${m[1]}" string`);
}

// ---- the reconciliation line the e2e test asserts on ---------------------
i18n.dicts.en && assert.strictEqual(en.perWhatsapp(9), '9 members per WhatsApp');
assert.strictEqual(en.nRows(7), '7 rows');
assert.strictEqual(en.nWithPhone(6), '6 with phone');
assert.strictEqual(en.nChats(2), '2 chats');

console.log('i18n.test.js ok');
