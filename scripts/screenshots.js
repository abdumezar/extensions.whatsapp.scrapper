/*
 * Regenerates docs/screenshots/*.png for the README.
 *
 * Same trick as test/e2e.js: load the unpacked extension into a throwaway
 * Chromium profile and serve scripts/demo-whatsapp.html at the real WhatsApp
 * URL, so the popup and the dashboard run against a store that looks like a
 * real community instead of the eight-row test fixture.
 *
 *   npm i -g playwright && npx playwright install chromium
 *   NODE_PATH="$(npm root -g)" node scripts/screenshots.js
 *
 * Deterministic: the demo store seeds its own PRNG, so re-running produces the
 * same picture unless the UI itself changed.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const DPR = 2; // retina-ish, so the shots stay sharp when GitHub scales them down

const shots = [];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wax-shot-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: true,
    channel: 'chromium',
    deviceScaleFactor: DPR,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });

  const demo = fs.readFileSync(path.join(__dirname, 'demo-whatsapp.html'), 'utf8');
  await ctx.route('https://web.whatsapp.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: demo }));

  const wa = await ctx.newPage();
  await wa.goto('https://web.whatsapp.com/');
  await wa.waitForFunction(() => window.__waxAdapterLoaded === true, null, { timeout: 10000 });

  // The extension id is not exposed to Playwright without a background page, so
  // scrape it out of chrome://extensions the way test/e2e.js does.
  const idPage = await ctx.newPage();
  await idPage.goto('chrome://extensions/');
  const id = await idPage.evaluate(() => document
    .querySelector('extensions-manager').shadowRoot
    .querySelector('extensions-item-list').shadowRoot
    .querySelector('extensions-item').id);
  await idPage.close();

  // The popup's <body> is itself the scroller (`max-height: 600px` in
  // popup.css), so neither `fullPage` nor a bounding-box sweep gives the height
  // of the whole panel. Lift the cap for the capture only, then size the
  // viewport to what the content actually needs — the README wants the panel
  // whole, not the 600px slice Chrome shows.
  const save = async (page, name, width) => {
    await page.addStyleTag({ content: 'body{max-height:none!important;overflow:visible!important}' });
    // scrollHeight never reports less than the viewport, so collapse the
    // viewport first and let the content push it back out.
    await page.setViewportSize({ width, height: 200 });
    await page.waitForTimeout(150);
    const h = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    await page.setViewportSize({ width, height: Math.max(h, 220) });
    await page.waitForTimeout(200);
    const file = path.join(OUT, name + '.png');
    await page.screenshot({ path: file });
    shots.push(name + '.png');
    console.log('  ✓ ' + path.relative(ROOT, file));
  };

  /* ---------------------------------------------------------------- popup -- */

  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 420, height: 760 });

  // The popup reads the active tab of its own window, so the mock page has to
  // be the front tab every time the popup (re)loads.
  const openPopup = async (prefs) => {
    await popup.setViewportSize({ width: 420, height: 900 });
    await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await popup.evaluate((p) => {
      localStorage.setItem('wax:theme', p.theme);
      localStorage.setItem('wax:lang', p.lang);
    }, prefs);
    await wa.bringToFront();
    await popup.reload();
    // Arabic renders its counts in Arabic-Indic digits, so wait on the table
    // rather than on the shape of the reconciliation line.
    await popup.waitForSelector('#previewTable tbody tr', { timeout: 15000 });
    await popup.waitForTimeout(400); // let the preview table settle
  };

  console.log('popup');
  await openPopup({ theme: 'light', lang: 'en' });
  await save(popup, 'popup-light', 420);

  await openPopup({ theme: 'dark', lang: 'en' });
  await save(popup, 'popup-dark', 420);

  await openPopup({ theme: 'light', lang: 'ar' });
  await save(popup, 'popup-arabic', 420);

  // Options drawer, where the filters, extra columns and presets live.
  await openPopup({ theme: 'light', lang: 'en' });
  await popup.evaluate(() => { document.querySelector('details.options').open = true; });
  await popup.waitForTimeout(300);
  await save(popup, 'popup-options', 420);

  // Multi-chat picker.
  await openPopup({ theme: 'dark', lang: 'en' });
  await popup.click('.tab[data-scope="chats"]');
  await popup.waitForSelector('.chat-row', { timeout: 10000 });
  await popup.evaluate(() => {
    document.querySelectorAll('.chat-row input[type=checkbox]').forEach((c, i) => {
      if (i < 3 && !c.checked) c.click();
    });
  });
  await popup.waitForTimeout(800);
  await save(popup, 'popup-pick-chats', 420);

  /* ------------------------------------------------------------ dashboard -- */

  console.log('dashboard');
  const dash = await ctx.newPage();
  await dash.setViewportSize({ width: 1280, height: 900 });
  await dash.goto(`chrome-extension://${id}/src/dashboard/index.html`);
  await dash.evaluate(() => {
    localStorage.setItem('wax:theme', 'light');
    localStorage.setItem('wax:lang', 'en');
  });
  await wa.bringToFront();
  await dash.reload();
  await dash.waitForSelector('.chat-row', { timeout: 15000 });
  await dash.click('#selectAll');
  await dash.click('#loadBtn');
  await dash.waitForFunction(
    () => document.querySelectorAll('#tiles .tile, #tiles > *').length > 0,
    null, { timeout: 30000 });
  await dash.waitForTimeout(1200); // charts animate in

  const view = async (name, file, prep) => {
    await dash.setViewportSize({ width: 1280, height: 900 });
    await dash.click(`.tab[data-view="${name}"]`);
    if (prep) await prep();
    await dash.waitForTimeout(900);
    await save(dash, file, 1280);
  };

  await view('overview', 'dashboard-overview');
  await view('overlap', 'dashboard-overlap');
  await view('quality', 'dashboard-quality');
  await view('communities', 'dashboard-communities');

  // One dark shot so the README shows both schemes on the wide page too.
  await dash.evaluate(() => localStorage.setItem('wax:theme', 'dark'));
  await wa.bringToFront();
  await dash.reload();
  await dash.waitForSelector('.chat-row', { timeout: 15000 });
  await dash.click('#selectAll');
  await dash.click('#loadBtn');
  await dash.waitForFunction(() => document.querySelectorAll('#tiles > *').length > 0, null, { timeout: 30000 });
  await dash.waitForTimeout(1500);
  await save(dash, 'dashboard-dark', 1280);

  await ctx.close();
  fs.rmSync(userDir, { recursive: true, force: true });
  console.log(`\n${shots.length} screenshots in docs/screenshots/`);
})().catch((e) => { console.error(e); process.exit(1); });
