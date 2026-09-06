/*
 * Pre-paint theme.
 *
 * The token layer (src/styles/tokens.css) keys its dark scheme off a `dark`
 * class on <html>, so something has to set that class before the first paint or
 * the popup flashes the wrong scheme every time it opens.
 *
 * Deliberately NOT inlined: MV3 extension pages run under `script-src 'self'`,
 * which blocks every inline script — an inline copy would simply not execute. A
 * classic external script in <head> still runs before the body paints, so the
 * no-flash guarantee holds.
 *
 * This is the one place the storage key and the resolution rule from
 * theme.js are duplicated; they must be, because theme.js loads with the body.
 * test/theme.test.js asserts the two agree. Keep it dependency-free and
 * defensive — it runs before anything else, and a storage exception here would
 * block rendering entirely.
 */
(function () {
  try {
    var mode = localStorage.getItem('wax:theme') || 'system';
    var dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
