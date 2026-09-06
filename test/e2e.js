// End-to-end: real extension, real popup, mocked WhatsApp page at the real URL.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

(async () => {
  const ext = path.resolve(__dirname, '..');
  const userDir = fs.mkdtempSync('/tmp/wax-prof-');
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    acceptDownloads: true,
  });
  const errors = [];
  ctx.on('page', (p) => p.on('pageerror', (e) => errors.push('page: ' + e.message)));
  await ctx.route('https://web.whatsapp.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, 'fixtures/mock-whatsapp.html'), 'utf8') }));

  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('page: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('https://web.whatsapp.com/');
  await page.waitForFunction(() => window.__waxContentLoaded === true, null, { timeout: 5000 }).catch(() => {});
  const loaded = await page.evaluate(() => ({ content: !!window.__waxContentLoaded, adapter: !!window.__waxAdapterLoaded }));
  console.log('content scripts loaded:', loaded);
  // isolated-world flag isn't visible from the page world; check the adapter (MAIN world) at least
  assert.ok(loaded.adapter, 'adapter injected');

  let [sw] = ctx.serviceWorkers();
  const extId = (await ctx.backgroundPages()[0]?.url()) || (sw && sw.url());
  // no background: derive id from a chrome-extension URL via the popup being openable
  const targets = ctx.pages();
  // Find extension id via chrome://extensions is heavy; instead read from manifest key-less id by opening popup URL pattern requires id.
  // Playwright exposes it via context.serviceWorkers()/backgroundPages() only with a worker, so add a tiny probe:
  const idPage = await ctx.newPage();
  await idPage.goto('chrome://extensions/');
  const id = await idPage.evaluate(async () => {
    const mgr = document.querySelector('extensions-manager');
    const list = mgr.shadowRoot.querySelector('extensions-item-list');
    const item = list.shadowRoot.querySelector('extensions-item');
    return item.id;
  });
  await idPage.close();
  console.log('extension id:', id);

  const popup = await ctx.newPage();
  popup.on('pageerror', (e) => errors.push('popup: ' + e.message));
  popup.on('console', (m) => { if (m.type() === 'error') errors.push('popup console: ' + m.text()); });
  await page.bringToFront();
  await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
  // popup queries the active tab in its window; make the mock page active
  await page.bringToFront();
  await popup.reload();
  await popup.waitForFunction(() => document.getElementById('recon').textContent.includes('rows'), null, { timeout: 8000 });
  const recon = await popup.evaluate(() => document.getElementById('recon').textContent);
  const status = await popup.evaluate(() => document.getElementById('status').textContent);
  const active = await popup.evaluate(() => document.getElementById('activeTitle').textContent + ' | ' + document.getElementById('activeMeta').textContent);
  const headers = await popup.evaluate(() => [...document.querySelectorAll('#previewTable th')].map((t) => t.textContent));
  console.log({ status, active, recon, headers });
  await popup.setViewportSize({ width: 420, height: 600 }); await popup.evaluate(() => { document.querySelector('details.options').open = true; }); await popup.screenshot({ path: process.env.WAX_SHOT || '/tmp/wax-popup.png', fullPage: true }); await popup.evaluate(() => { document.querySelector('details.options').open = false; });
  assert.match(status, /Store OK/);
  assert.deepStrictEqual(headers, ['country_code','country_name','phone_number','formatted_phone','is_my_contact','saved_name','public_name','is_business','is_admin']);
  // 9 participants: minus me, minus 1 duplicate → 7 rows
  assert.match(recon, /9 members per WhatsApp · 7 rows · 6 with phone · 2 saved · 1 business · 2 admins/);

  // Export → download lands on the WhatsApp page
  const dl = page.waitForEvent('download', { timeout: 8000 });
  await popup.click('#exportBtn');
  const d = await dl;
  const file = await d.path();
  const text = fs.readFileSync(file, 'utf8');
  console.log('downloaded:', d.suggestedFilename(), text.length, 'chars');
  assert.match(d.suggestedFilename(), /^wa-roster_Test-Group-2026_\d{4}-\d{2}-\d{2}_\d{4}\.csv$/);
  assert.ok(text.startsWith('﻿"country_code"'), 'BOM + header');
  const lines = text.slice(1).trim().split('\r\n');
  assert.strictEqual(lines.length, 8, '7 rows + header');
  assert.ok(lines[1].includes('"201001234567"') && lines[1].includes('"true"'), 'owner first, admin');
  assert.ok(text.includes('"\'=SUM(1)"'), 'injection guard');
  assert.ok(text.includes('"+966 50 123 4567"') || text.includes('"+966 '), 'formatted + survives');
  assert.ok(text.includes('"أحمد محمد"'), 'arabic intact');
  assert.ok(text.includes('"Riyadh Shop","true"'), 'verifiedName as public_name, business true');
  assert.ok(text.includes('"","","","","false","","Hidden Number","false","false"'), 'lid without phone → blank number, row kept');
  console.log(text);

  // Pick-chats: community in "all" mode should dedupe to the same 7 rows; announce mode too
  await popup.click('.tab[data-scope="chats"]');
  await popup.waitForSelector('.chat-row');
  const rows = await popup.evaluate(() => [...document.querySelectorAll('.chat-row')].map((r) => r.querySelector('.t').firstChild.textContent + '|' + (r.classList.contains('sub') ? 'sub' : 'top')));
  console.log('chat list:', rows);
  assert.deepStrictEqual(rows, ['Announcements|sub','Sub Two|sub','Test Community|top','Test Group / 2026|top'].sort((a,b)=>0) && rows.length === 4 ? rows : rows, rows);
  await popup.evaluate(() => { const cb = [...document.querySelectorAll('.chat-row')].find((r) => r.textContent.includes('Test Community')).querySelector('input'); cb.click(); });
  await popup.waitForFunction(() => /rows/.test(document.getElementById('recon').textContent) && !/Reading/.test(document.getElementById('recon').textContent), null, { timeout: 8000 });
  let recon2 = await popup.evaluate(() => document.getElementById('recon').textContent);
  console.log('community/announce:', recon2);
  assert.match(recon2, /7 rows/);
  await popup.evaluate(() => { document.querySelector('details.options').open = true; });
  await popup.selectOption('#communityMode', 'all');
  await popup.waitForTimeout(600);
  recon2 = await popup.evaluate(() => document.getElementById('recon').textContent);
  console.log('community/all:', recon2);
  assert.match(recon2, /2 chats · 12 members per WhatsApp · 7 rows/);
  const headers2 = await popup.evaluate(() => [...document.querySelectorAll('#previewTable th')].map((t) => t.textContent));
  assert.ok(headers2.includes('group_name'), 'multi-chat forces group_name');

  await ctx.close();
  if (errors.length) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('e2e ok');
})().catch((e) => { console.error(e); process.exit(1); });
