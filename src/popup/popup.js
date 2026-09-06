/* Whatsapp Scrapper by abdumezar — popup */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = {
    status: $('status'), blocker: $('blocker'), blockerText: $('blockerText'), blockerAction: $('blockerAction'), app: $('app'),
    activeTitle: $('activeTitle'), activeMeta: $('activeMeta'), activeCard: $('activeCard'),
    pickPane: $('pickPane'), chatFilter: $('chatFilter'), chatList: $('chatList'), pickSummary: $('pickSummary'),
    communityMode: $('communityMode'), locale: $('locale'), includeMe: $('includeMe'), forceDom: $('forceDom'),
    recon: $('recon'), warnings: $('warnings'), thead: document.querySelector('#previewTable thead'), tbody: document.querySelector('#previewTable tbody'),
    exportBtn: $('exportBtn'), result: $('result'), themeBtn: $('themeBtn'),
  };
  const KIND_LABEL = { group: 'Group', subgroup: 'Community group', community: 'Community', broadcast: 'Broadcast list' };

  let tabId = null;
  let scope = 'active';
  let chats = [];
  const selected = new Set();
  let previewTimer = null;
  let busy = false;

  // ---------- messaging ----------
  async function send(cmd, args) {
    const res = await chrome.tabs.sendMessage(tabId, { cmd, args: args || {} });
    if (!res) throw Object.assign(new Error('No answer from the WhatsApp tab'), { code: 'NO_RESPONSE' });
    if (!res.ok) throw Object.assign(new Error(res.error.message), { code: res.error.code });
    return res.data;
  }

  function setStatus(text, cls) { el.status.textContent = text; el.status.className = 'pill ' + cls; }

  // ---------- theme ----------
  const THEME_LABEL = { system: 'Theme: follow system', light: 'Theme: light', dark: 'Theme: dark' };

  function renderTheme(mode) {
    el.themeBtn.title = THEME_LABEL[mode];
    el.themeBtn.setAttribute('aria-label', THEME_LABEL[mode]);
    // toggleAttribute, not .hidden: SVGElement does not implement the hidden
    // IDL property, so assigning to it sets a dead expando and the icon never
    // changes. The attribute is what `[hidden]` in popup.css matches.
    for (const m of WAXTheme.MODES) el.themeBtn.querySelector('.i-' + m).toggleAttribute('hidden', m !== mode);
  }

  /** Wired before anything async, so the toggle works on the blocker screen too.
   *  theme-preload.js has already painted the stored preference; this only picks
   *  up the icon and keeps following the OS while the mode is `system`. */
  function initTheme() {
    let mode = WAXTheme.saved();
    renderTheme(mode);
    WAXTheme.watch();
    el.themeBtn.addEventListener('click', () => {
      mode = WAXTheme.next(mode);
      WAXTheme.set(mode);
      renderTheme(mode);
    });
  }

  /** Replace the UI with a message, optionally with one button under it. */
  function block(text, action) {
    el.blocker.hidden = false;
    el.blockerText.textContent = text;
    el.app.hidden = true;
    el.blockerAction.hidden = !action;
    if (action) {
      el.blockerAction.textContent = action.label;
      el.blockerAction.onclick = action.run;
    }
  }

  const WA_URL = 'https://web.whatsapp.com/';

  /** Point the tab the user is looking at at WhatsApp Web. Navigating in place
   *  is what the popup promises; if Chrome refuses (a chrome:// page, say, which
   *  an extension may not navigate away from) fall back to a new tab. */
  async function openWhatsApp() {
    el.blockerAction.disabled = true;
    try {
      if (tabId != null) await chrome.tabs.update(tabId, { url: WA_URL });
      else await chrome.tabs.create({ url: WA_URL });
    } catch (e) {
      try { await chrome.tabs.create({ url: WA_URL }); }
      catch (e2) { el.blockerAction.disabled = false; el.blockerText.textContent = 'Could not open WhatsApp Web: ' + e2.message; return; }
    }
    window.close();   // the popup does not survive the navigation anyway
  }

  // ---------- options ----------
  function options() {
    const extras = {};
    document.querySelectorAll('#extras input[data-extra]').forEach((c) => { if (c.checked) extras[c.dataset.extra] = true; });
    return {
      scope,
      chatIds: Array.from(selected),
      communityMode: el.communityMode.value,
      locale: el.locale.value,
      includeMe: el.includeMe.checked,
      extras,
      forceDom: el.forceDom.checked,
    };
  }

  async function loadOptions() {
    try {
      const { waxOptions } = await chrome.storage.local.get('waxOptions');
      if (!waxOptions) return;
      if (waxOptions.communityMode) el.communityMode.value = waxOptions.communityMode;
      if (waxOptions.locale) el.locale.value = waxOptions.locale;
      el.includeMe.checked = !!waxOptions.includeMe;
      document.querySelectorAll('#extras input[data-extra]').forEach((c) => { c.checked = !!(waxOptions.extras && waxOptions.extras[c.dataset.extra]); });
    } catch (e) {}
  }
  function saveOptions() {
    const o = options(); delete o.scope; delete o.chatIds; delete o.forceDom;
    try { chrome.storage.local.set({ waxOptions: o }); } catch (e) {}
  }

  // ---------- rendering ----------
  function renderActive(active) {
    if (!active) { el.activeTitle.textContent = 'No chat open'; el.activeMeta.textContent = 'Open a group, community or broadcast list in WhatsApp.'; return; }
    el.activeTitle.textContent = active.title;
    el.activeTitle.title = active.title;
    const kind = KIND_LABEL[active.kind] || active.kind;
    const n = active.participantCount != null ? active.participantCount : active.reportedSize;
    el.activeMeta.textContent = kind + (n != null ? ' · ' + n.toLocaleString() + ' members' : '') + (active.isLidAddressingMode ? ' · privacy-mode ids' : '');
  }

  function renderChatList() {
    const f = el.chatFilter.value.trim().toLowerCase();
    el.chatList.textContent = '';
    const byParent = new Map();
    const top = [];
    for (const c of chats) {
      if (c.kind === 'subgroup' && c.parentGroup) { if (!byParent.has(c.parentGroup)) byParent.set(c.parentGroup, []); byParent.get(c.parentGroup).push(c); }
      else top.push(c);
    }
    const sortT = (a, b) => a.title.localeCompare(b.title);
    top.sort(sortT);
    const row = (c, sub) => {
      if (f && !c.title.toLowerCase().includes(f)) return;
      const r = document.createElement('label');
      r.className = 'chat-row' + (sub ? ' sub' : '');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = selected.has(c.id);
      cb.addEventListener('change', () => { if (cb.checked) selected.add(c.id); else selected.delete(c.id); updatePickSummary(); schedulePreview(); });
      const t = document.createElement('div'); t.className = 't'; t.textContent = c.title; t.title = c.title;
      const k = document.createElement('div'); k.className = 'k'; k.textContent = KIND_LABEL[c.kind] || c.kind;
      t.appendChild(document.createElement('br')); t.appendChild(k);
      const n = document.createElement('div'); n.className = 'n'; n.textContent = c.participantCount != null ? c.participantCount.toLocaleString() : '—';
      r.append(cb, t, n);
      el.chatList.appendChild(r);
    };
    for (const c of top) {
      row(c, false);
      const subs = byParent.get(c.id);
      if (subs) subs.sort(sortT).forEach((s) => row(s, true));
    }
    // orphan sub-groups whose parent isn't in the list
    for (const [pid, subs] of byParent) if (!top.some((t) => t.id === pid)) subs.forEach((s) => row(s, false));
    updatePickSummary();
  }

  function updatePickSummary() {
    const n = selected.size;
    el.pickSummary.textContent = n ? n + ' chat' + (n > 1 ? 's' : '') + ' selected' : 'Nothing selected';
  }

  function renderPreview(p) {
    el.thead.textContent = ''; el.tbody.textContent = '';
    const trh = document.createElement('tr');
    for (const c of p.columns) { const th = document.createElement('th'); th.textContent = c; trh.appendChild(th); }
    el.thead.appendChild(trh);
    for (const r of p.sample) {
      const tr = document.createElement('tr');
      r.forEach((v) => {
        const td = document.createElement('td');
        if (v === true) { td.textContent = 'true'; td.className = 'bool-true'; }
        else if (v === false) td.textContent = 'false';
        else if (v === null || v === undefined || v === '') { td.textContent = v === '' ? '' : 'unknown'; td.className = 'bool-null'; }
        else td.textContent = String(v);
        tr.appendChild(td);
      });
      el.tbody.appendChild(tr);
    }
    const s = p.stats;
    const parts = [];
    if (p.chats.length > 1) parts.push(p.chats.length + ' chats');
    parts.push(s.reported.toLocaleString() + ' members per WhatsApp');
    parts.push(s.rows.toLocaleString() + ' rows');
    parts.push(s.withPhone.toLocaleString() + ' with phone');
    parts.push(s.myContacts + ' saved');
    parts.push(s.business + ' business');
    parts.push(s.admins + ' admins');
    el.recon.textContent = parts.join(' · ');
    const expected = s.reported - (p.chats.length > 1 ? 0 : 0);
    const mismatch = p.chats.length === 1 && s.rows + 1 < expected; // +1 allows for the excluded self row
    el.recon.className = 'recon' + (p.mode === 'dom' ? ' bad' : mismatch ? ' mismatch' : '');
    if (p.mode === 'dom') el.recon.textContent = 'Screen-reading mode · ' + el.recon.textContent;
    el.warnings.textContent = '';
    el.warnings.hidden = !p.warnings.length;
    for (const w of p.warnings) { const li = document.createElement('li'); li.textContent = w; el.warnings.appendChild(li); }
    el.exportBtn.disabled = s.rows === 0;
    el.exportBtn.textContent = s.rows ? 'Export ' + s.rows.toLocaleString() + ' rows' : 'Nothing to export';
  }

  // ---------- flows ----------
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(preview, 200);
  }

  async function preview() {
    if (busy) return;
    if (scope === 'chats' && !selected.size) { el.recon.textContent = 'Pick one or more chats above.'; el.recon.className = 'recon'; el.exportBtn.disabled = true; el.exportBtn.textContent = 'Export CSV'; el.thead.textContent = ''; el.tbody.textContent = ''; el.warnings.hidden = true; return; }
    busy = true;
    el.recon.textContent = 'Reading participants…'; el.recon.className = 'recon';
    el.exportBtn.disabled = true;
    try {
      const p = await send('preview', options());
      renderPreview(p);
    } catch (e) {
      el.recon.textContent = e.message; el.recon.className = 'recon bad';
      el.thead.textContent = ''; el.tbody.textContent = '';
      el.exportBtn.disabled = true; el.exportBtn.textContent = 'Export CSV';
    } finally { busy = false; }
  }

  async function doExport() {
    if (busy) return;
    busy = true;
    el.exportBtn.disabled = true;
    el.result.textContent = 'Building CSV…'; el.result.className = 'result';
    try {
      const r = await send('export', options());
      el.result.textContent = 'Saved ' + r.filename + ' (' + r.stats.rows.toLocaleString() + ' rows)';
      el.result.className = 'result ok';
    } catch (e) {
      el.result.textContent = e.message; el.result.className = 'result bad';
    } finally { busy = false; el.exportBtn.disabled = false; }
  }

  async function init() {
    initTheme();
    await loadOptions();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab ? tab.id : null;
    if (!tab || !/^https:\/\/web\.whatsapp\.com\//.test(tab.url || '')) {
      setStatus('Not WhatsApp', 'pill-muted');
      return block('This tab is not WhatsApp Web.', { label: 'Open WhatsApp Web', run: openWhatsApp });
    }
    let st;
    try { st = await send('status'); }
    catch (e) {
      setStatus('Not connected', 'pill-bad');
      return block('The extension is not running in this tab yet. Reload the WhatsApp tab and try again.');
    }
    el.app.hidden = false;
    if (st.store.available) {
      setStatus('Store OK · ' + (st.store.version || '').replace(/^2\.3000\./, 'b') , 'pill-ok');
      el.status.title = 'Reading WhatsApp\'s store directly (' + st.store.how + ')';
    } else {
      const why = st.store.selfTest && st.store.selfTest.message ? st.store.selfTest.message : 'store unavailable';
      setStatus('Screen-reading mode', 'pill-warn');
      el.status.title = why;
      document.querySelector('.tab[data-scope="chats"]').disabled = true;
    }
    renderActive(st.active);
    if (st.store.available) {
      try { chats = await send('listChats'); renderChatList(); } catch (e) {}
    }
    preview();
  }

  // ---------- events ----------
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    if (t.disabled) return;
    document.querySelectorAll('.tab').forEach((x) => { x.classList.toggle('active', x === t); x.setAttribute('aria-selected', x === t ? 'true' : 'false'); });
    scope = t.dataset.scope;
    el.pickPane.hidden = scope !== 'chats';
    el.activeCard.hidden = scope === 'chats';
    schedulePreview();
  }));
  el.chatFilter.addEventListener('input', renderChatList);
  [el.communityMode, el.locale, el.includeMe, el.forceDom, ...document.querySelectorAll('#extras input')].forEach((c) => c.addEventListener('change', () => { saveOptions(); schedulePreview(); }));
  el.exportBtn.addEventListener('click', doExport);

  init();
})();
