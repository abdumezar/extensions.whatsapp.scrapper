/*
 * Whatsapp Scrapper by abdumezar — theme controller (popup).
 *
 * The stored value is a *preference* (`system` | `light` | `dark`), not a scheme.
 * `system` is resolved against prefers-color-scheme at read time and re-resolved
 * when the OS flips, so following the system keeps working while the popup is
 * open; an explicit light/dark choice survives the OS changing underneath it.
 *
 * Storage is plain localStorage on the extension origin rather than
 * chrome.storage: it is synchronous, which is what lets theme-preload.js paint
 * the right scheme before first paint instead of flashing the wrong one. The
 * key and the resolution rule are duplicated there by necessity —
 * test/theme.test.js asserts the two copies agree.
 */
const WAXTheme = (() => {
  'use strict';

  const KEY = 'wax:theme';
  const DARK_QUERY = '(prefers-color-scheme: dark)';
  const MODES = ['system', 'light', 'dark'];
  /* One control covers all three modes by cycling through them. */
  const NEXT = { system: 'light', light: 'dark', dark: 'system' };

  /** The stored preference, or `system` if there is none (or storage is blocked). */
  function saved() {
    try {
      const v = localStorage.getItem(KEY);
      return MODES.indexOf(v) !== -1 ? v : 'system';
    } catch (e) { return 'system'; }
  }

  const prefersDark = () => typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;

  /** Collapses a preference into the scheme actually rendered. */
  const resolve = (mode) => (mode === 'system' ? (prefersDark() ? 'dark' : 'light') : mode);

  /** Paints a preference onto <html>. Does not persist it. */
  function apply(mode) {
    const scheme = resolve(mode);
    document.documentElement.classList.toggle('dark', scheme === 'dark');
    return scheme;
  }

  /** Persists a preference and paints it. */
  function set(mode) {
    try { localStorage.setItem(KEY, mode); } catch (e) {}
    return apply(mode);
  }

  /** Repaints on OS changes, but only while the user is following the system. */
  function watch() {
    if (typeof matchMedia !== 'function') return () => {};
    const mql = matchMedia(DARK_QUERY);
    const onChange = () => { if (saved() === 'system') apply('system'); };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }

  return { KEY, MODES, saved, resolve, apply, set, watch, next: (mode) => NEXT[mode] };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = WAXTheme;
