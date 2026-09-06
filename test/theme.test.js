/*
 * theme-preload.js necessarily duplicates the storage key and the resolution
 * rule from theme.js — it has to run before any other script. This test runs the
 * real preload source in a stubbed context and asserts it lands on the same
 * scheme theme.js would, for every valid preference against both OS settings.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const WAXTheme = require('../src/popup/theme.js');
const i18n = require('../src/popup/i18n.js');

const popupDir = path.join(__dirname, '..', 'src', 'popup');
const preload = fs.readFileSync(path.join(popupDir, 'theme-preload.js'), 'utf8');
const html = fs.readFileSync(path.join(popupDir, 'popup.html'), 'utf8');

// The key is the contract between the two files.
assert.ok(preload.includes(`'${WAXTheme.KEY}'`), 'preload reads the same storage key');

/** Runs the preload against a stubbed page and reports whether it went dark. */
function preloadSaysDark(stored, osDark) {
  let dark = null;
  const ctx = {
    localStorage: { getItem: () => stored },
    matchMedia: (q) => ({ matches: q === '(prefers-color-scheme: dark)' ? osDark : false }),
    document: { documentElement: { classList: { toggle: (name, on) => { assert.strictEqual(name, 'dark'); dark = on; } } } },
  };
  vm.runInContext(preload, vm.createContext(ctx));
  return dark;
}

// null covers a first run with nothing stored yet.
for (const stored of [null, ...WAXTheme.MODES]) {
  for (const osDark of [true, false]) {
    // theme.js reads the OS through the global matchMedia; node has none.
    global.matchMedia = (q) => ({ matches: q === '(prefers-color-scheme: dark)' ? osDark : false });
    const expected = WAXTheme.resolve(stored === null ? 'system' : stored) === 'dark';
    assert.strictEqual(
      preloadSaysDark(stored, osDark),
      expected,
      `preload disagrees with theme.js for stored=${stored} osDark=${osDark}`
    );
  }
}
delete global.matchMedia;

// ---- language, painted by the same preload -------------------------------
/** @returns {{lang: string, dir: string}} what the preload put on <html>. */
function preloadLang(stored) {
  const root = { classList: { toggle() {} } };
  const ctx = {
    localStorage: { getItem: (k) => (k === 'wax:lang' ? stored : null) },
    matchMedia: () => ({ matches: false }),
    document: { documentElement: root },
  };
  vm.runInContext(preload, vm.createContext(ctx));
  return { lang: root.lang, dir: root.dir };
}

assert.ok(preload.includes(`'${i18n.KEY}'`), 'preload reads the same language key');
assert.deepStrictEqual(preloadLang('ar'), { lang: 'ar', dir: 'rtl' }, 'arabic is right to left');
assert.deepStrictEqual(preloadLang('en'), { lang: 'en', dir: 'ltr' });
assert.deepStrictEqual(preloadLang(null), { lang: 'en', dir: 'ltr' }, 'english by default');
assert.deepStrictEqual(preloadLang('klingon'), { lang: 'en', dir: 'ltr' }, 'an unknown language falls back');

// A storage exception must not stop the page rendering.
const throwing = { localStorage: { getItem() { throw new Error('blocked'); } }, matchMedia: () => ({ matches: false }), document: { documentElement: { classList: { toggle() {} } } } };
assert.doesNotThrow(() => vm.runInContext(preload, vm.createContext(throwing)), 'preload swallows storage errors');

// Order matters: the preload must run before the stylesheets, and theme.js
// before popup.js, or the popup flashes the wrong scheme / has no controller.
assert.ok(html.indexOf('theme-preload.js') < html.indexOf('<link rel="stylesheet"'), 'preload precedes the stylesheets');
assert.ok(html.indexOf('src="i18n.js"') < html.indexOf('src="popup.js"'), 'i18n.js precedes popup.js');
assert.ok(html.indexOf('src="theme.js"') < html.indexOf('src="popup.js"'), 'theme.js precedes popup.js');
assert.ok(/id="themeBtn"/.test(html), 'the toggle exists');
for (const m of WAXTheme.MODES) assert.ok(html.includes(`class="i-${m}"`), `icon for ${m} exists`);

console.log('theme.test.js ok');
