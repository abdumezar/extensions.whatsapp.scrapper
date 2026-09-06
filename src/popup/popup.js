/* Whatsapp Scrapper by abdumezar — popup */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const t = (...a) => WAXI18n.t(...a);
  const el = {
    status: $('status'), blocker: $('blocker'), blockerText: $('blockerText'), blockerAction: $('blockerAction'), app: $('app'),
    activeTitle: $('activeTitle'), activeMeta: $('activeMeta'), activeCard: $('activeCard'),
    pickPane: $('pickPane'), chatFilter: $('chatFilter'), chatList: $('chatList'), pickSummary: $('pickSummary'),
    selectAll: $('selectAll'), selectNone: $('selectNone'),
    format: $('format'), communityMode: $('communityMode'), locale: $('locale'), includeMe: $('includeMe'),
    countries: $('countries'), changesOnly: $('changesOnly'), forceDom: $('forceDom'),
    diagBtn: $('diagBtn'), resetBaseline: $('resetBaseline'),
    recon: $('recon'), diff: $('diff'), note: $('note'), warnings: $('warnings'),
    thead: document.querySelector('#previewTable thead'), tbody: document.querySelector('#previewTable tbody'),
    exportBtn: $('exportBtn'), copyBtn: $('copyBtn'), cancelBtn: $('cancelBtn'), result: $('result'),
    themeBtn: $('themeBtn'), langBtn: $('langBtn'), dashBtn: $('dashBtn'),
    presetName: $('presetName'), presetSelect: $('presetSelect'), presetSave: $('presetSave'), presetDelete: $('presetDelete'),
  };
  const KIND_KEY = { group: 'kindGroup', subgroup: 'kindSubgroup', community: 'kindCommunity', broadcast: 'kindBroadcast' };
  const kindLabel = (kind) => (KIND_KEY[kind] ? t(KIND_KEY[kind]) : kind);

  let tabId = null;
  let scope = 'active';
  let chats = [];
  const selected = new Set();
  let previewTimer = null;
  let busy = false;
  let lastPreview = null;
  let activeChat = null;
  let untestedVersion = null;

  // ---------- messaging ----------
  async function send(cmd, args) {
    const res = await chrome.tabs.sendMessage(tabId, { cmd, args: args || {} });
    if (!res) throw Object.assign(new Error('No answer from the WhatsApp tab'), { code: 'NO_RESPONSE' });
    if (!res.ok) throw Object.assign(new Error(res.error.message), { code: res.error.code });
    return res.data;
  }

  /* The pill's text is state, not markup: WAXI18n.apply() would otherwise reset
     it to "Checking…" every time the language changes. Its key is remembered so
     a language switch can repaint it. */
  let statusState = { key: 'checking', cls: 'pill-muted', suffix: '' };

  function renderStatus() {
    el.status.textContent = t(statusState.key) + statusState.suffix;
    el.status.className = 'pill ' + statusState.cls;
  }
  function setStatus(key, cls, suffix) {
    statusState = { key, cls, suffix: suffix || '' };
    renderStatus();
  }

  /** Shown when WhatsApp is a build this extension has not been checked against. */
  function renderNote() {
    el.note.hidden = !untestedVersion;
    if (untestedVersion) el.note.textContent = t('untestedBuild', untestedVersion);
  }

  /** The open-chat card and the picker rows both name a chat kind. */
  function chatMeta(c) {
    const n = c.participantCount != null ? c.participantCount : c.reportedSize;
    return kindLabel(c.kind)
      + (n != null ? ' · ' + t('nMembers', n) : '')
      + (c.isLidAddressingMode ? ' · ' + t('privacyIds') : '');
  }

  // ---------- theme ----------
  function renderTheme(mode) {
    const label = t('theme') + ': ' + t(mode === 'system' ? 'themeSystem' : mode === 'light' ? 'themeLight' : 'themeDark');
    el.themeBtn.title = label;
    el.themeBtn.setAttribute('aria-label', label);
    // toggleAttribute, not .hidden: SVGElement does not implement the hidden
    // IDL property, so assigning to it sets a dead expando and the icon never
    // changes. The attribute is what `[hidden]` in popup.css matches.
    for (const m of WAXTheme.MODES) el.themeBtn.querySelector('.i-' + m).toggleAttribute('hidden', m !== mode);
  }

  /** Wired before anything async, so both controls work on the blocker screen. */
  function initChrome() {
    WAXI18n.init();
    let mode = WAXTheme.saved();
    renderTheme(mode);
    WAXTheme.watch();
    el.themeBtn.addEventListener('click', () => {
      mode = WAXTheme.next(mode);
      WAXTheme.set(mode);
      renderTheme(mode);
    });
    el.langBtn.addEventListener('click', () => {
      WAXI18n.set(WAXI18n.other());
      // apply() has just repainted every [data-i18n] node, which resets the
      // pieces whose text is state rather than markup — repaint those from
      // what they actually hold.
      renderTheme(mode);
      renderStatus();
      renderNote();
      renderActive(activeChat);
      renderChatList();
      if (lastPreview) renderPreview(lastPreview);
    });
  }

  // ---------- options ----------
  function options() {
    const extras = {};
    document.querySelectorAll('#extras input[data-extra]').forEach((c) => { if (c.checked) extras[c.dataset.extra] = true; });
    const filters = { countries: el.countries.value.trim() };
    document.querySelectorAll('#filters input[data-filter]').forEach((c) => { filters[c.dataset.filter] = c.checked; });
    return {
      scope,
      chatIds: Array.from(selected),
      format: el.format.value,
      communityMode: el.communityMode.value,
      locale: el.locale.value,
      includeMe: el.includeMe.checked,
      changesOnly: el.changesOnly.checked,
      extras,
      filters,
      forceDom: el.forceDom.checked,
    };
  }

  async function loadOptions() {
    try {
      const { waxOptions, waxSelection, waxPresets } = await chrome.storage.local.get(['waxOptions', 'waxSelection', 'waxPresets']);
      presets = waxPresets || {};
      renderPresets();
      if (Array.isArray(waxSelection)) waxSelection.forEach((id) => selected.add(id));
      if (!waxOptions) return;
      if (waxOptions.format) el.format.value = waxOptions.format;
      if (waxOptions.communityMode) el.communityMode.value = waxOptions.communityMode;
      if (waxOptions.locale) el.locale.value = waxOptions.locale;
      el.includeMe.checked = !!waxOptions.includeMe;
      el.changesOnly.checked = !!waxOptions.changesOnly;
      el.countries.value = (waxOptions.filters && waxOptions.filters.countries) || '';
      document.querySelectorAll('#filters input[data-filter]').forEach((c) => { c.checked = !!(waxOptions.filters && waxOptions.filters[c.dataset.filter]); });
      document.querySelectorAll('#extras input[data-extra]').forEach((c) => { c.checked = !!(waxOptions.extras && waxOptions.extras[c.dataset.extra]); });
    } catch (e) {}
  }

  function saveOptions() {
    const o = options();
    delete o.scope; delete o.chatIds; delete o.forceDom;
    try { chrome.storage.local.set({ waxOptions: o, waxSelection: Array.from(selected) }); } catch (e) {}
  }

  // ---------- presets ----------
  /* A preset is the same object saveOptions writes, under a name. Applying one
     is exactly the same code path as restoring the last-used options. */
  let presets = {};

  function renderPresets() {
    el.presetSelect.textContent = '';
    const names = Object.keys(presets).sort();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = names.length ? '—' : t('presetNone');
    el.presetSelect.appendChild(blank);
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      el.presetSelect.appendChild(opt);
    }
    el.presetDelete.disabled = !names.length;
  }

  function applyPreset(name) {
    const p = presets[name];
    if (!p) return;
    if (p.format) el.format.value = p.format;
    if (p.communityMode) el.communityMode.value = p.communityMode;
    if (p.locale) el.locale.value = p.locale;
    el.includeMe.checked = !!p.includeMe;
    el.changesOnly.checked = !!p.changesOnly;
    el.countries.value = (p.filters && p.filters.countries) || '';
    document.querySelectorAll('#filters input[data-filter]').forEach((c) => { c.checked = !!(p.filters && p.filters[c.dataset.filter]); });
    document.querySelectorAll('#extras input[data-extra]').forEach((c) => { c.checked = !!(p.extras && p.extras[c.dataset.extra]); });
    saveOptions();
    schedulePreview();
  }

  // ---------- rendering ----------
  function renderActive(active) {
    activeChat = active || activeChat;
    if (!activeChat) {
      el.activeTitle.textContent = t('noChatOpen');
      el.activeMeta.textContent = t('noChatOpenHint');
      return;
    }
    el.activeTitle.textContent = activeChat.title;
    el.activeTitle.title = activeChat.title;
    el.activeMeta.textContent = chatMeta(activeChat);
  }

  /** The rows currently shown by the picker, in display order. */
  function visibleChats() {
    const f = el.chatFilter.value.trim().toLowerCase();
    return chats.filter((c) => !f || c.title.toLowerCase().includes(f));
  }

  function renderChatList() {
    const visible = new Set(visibleChats().map((c) => c.id));
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
      if (!visible.has(c.id)) return;
      const r = document.createElement('label');
      r.className = 'chat-row' + (sub ? ' sub' : '');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = selected.has(c.id);
      cb.addEventListener('change', () => { if (cb.checked) selected.add(c.id); else selected.delete(c.id); updatePickSummary(); saveOptions(); schedulePreview(); });
      const tt = document.createElement('div'); tt.className = 't'; tt.textContent = c.title; tt.title = c.title;
      const k = document.createElement('div'); k.className = 'k'; k.textContent = kindLabel(c.kind);
      tt.appendChild(document.createElement('br')); tt.appendChild(k);
      const n = document.createElement('div'); n.className = 'n'; n.textContent = c.participantCount != null ? c.participantCount.toLocaleString() : '—';
      r.append(cb, tt, n);
      el.chatList.appendChild(r);
    };
    for (const c of top) {
      row(c, false);
      const subs = byParent.get(c.id);
      if (subs) subs.sort(sortT).forEach((s) => row(s, true));
    }
    // orphan sub-groups whose parent isn't in the list
    for (const [pid, subs] of byParent) if (!top.some((x) => x.id === pid)) subs.forEach((s) => row(s, false));
    updatePickSummary();
  }

  function updatePickSummary() {
    const n = selected.size;
    el.pickSummary.textContent = n ? t('nSelected', n) : t('nothingSelected');
  }

  function shortDate(iso) {
    try { return new Date(iso).toLocaleDateString(WAXI18n.current() === 'ar' ? 'ar-EG' : undefined, { day: 'numeric', month: 'short' }); }
    catch (e) { return String(iso || '').slice(0, 10); }
  }

  function renderPreview(p) {
    lastPreview = p;
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
    if (p.chats.length > 1) parts.push(t('nChats', p.chats.length));
    parts.push(t('perWhatsapp', s.reported));
    parts.push(t('nRows', s.rows));
    parts.push(t('nWithPhone', s.withPhone));
    parts.push(t('nSaved', s.myContacts));
    parts.push(t('nBusiness', s.business));
    parts.push(t('nAdmins', s.admins));
    if (s.filtered) parts.push(t('nFiltered', s.filtered));
    el.recon.textContent = (p.mode === 'dom' ? t('screenReadingPrefix') + ' · ' : '') + parts.join(' · ');
    // A row count well below what WhatsApp reports means something was missed —
    // but only when filters aren't the reason, and only for a single chat.
    const mismatch = p.chats.length === 1 && !s.filtered && s.rows + 1 < s.reported;
    el.recon.className = 'recon' + (p.mode === 'dom' ? ' bad' : mismatch ? ' mismatch' : '');

    el.diff.hidden = !(s.joined !== null && s.joined !== undefined);
    if (!el.diff.hidden) el.diff.textContent = t('diffLine', s.joined, s.left, shortDate(s.since));

    el.warnings.textContent = '';
    el.warnings.hidden = !p.warnings.length;
    for (const w of p.warnings) { const li = document.createElement('li'); li.textContent = WAXI18n.warning(w); el.warnings.appendChild(li); }

    const has = s.rows > 0;
    el.exportBtn.disabled = !has;
    el.copyBtn.disabled = !has;
    el.exportBtn.textContent = has ? t('exportN', s.rows) : t('nothingToExport');
  }

  function clearPreview(message) {
    lastPreview = null;
    el.recon.textContent = message;
    el.recon.className = 'recon';
    el.thead.textContent = ''; el.tbody.textContent = '';
    el.diff.hidden = true;
    el.warnings.hidden = true;
    el.exportBtn.disabled = true;
    el.copyBtn.disabled = true;
    el.exportBtn.textContent = t('exportCsv');
  }

  // ---------- progress ----------
  /* The result line is shared between progress chatter and the outcome of the
     last action. Only chatter is cleared when a job ends, so a background
     preview cannot wipe the "Saved …" line the user just earned. */
  let resultIsProgress = false;

  function setResult(text, cls, isProgress) {
    el.result.textContent = text;
    el.result.className = 'result' + (cls ? ' ' + cls : '');
    resultIsProgress = !!isProgress;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'WAX_PROGRESS' || !busy) return;
    if (msg.phase === 'chat' && msg.total > 1) setResult(t('readingChat', msg.done, msg.total, msg.label || ''), '', true);
    else if (msg.phase === 'scroll') setResult(t('readingScreen', msg.done || 0), '', true);
  });

  function setBusy(on, label) {
    busy = on;
    el.cancelBtn.hidden = !on;
    el.exportBtn.disabled = on || !lastPreview || !lastPreview.stats.rows;
    el.copyBtn.disabled = el.exportBtn.disabled;
    if (on && label !== undefined) setResult(label, '', true);
    if (!on && resultIsProgress) setResult('', '', false);
  }

  // ---------- flows ----------
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(preview, 200);
  }

  async function preview() {
    if (busy) return;
    if (scope === 'chats' && !selected.size) return clearPreview(t('pickSomeChats'));
    // No label: a preview runs in the background after an export, and must not
    // wipe the "Saved …" line. Progress messages will overwrite it if they come.
    setBusy(true);
    el.recon.textContent = t('reading');
    el.recon.className = 'recon';
    try {
      renderPreview(await send('preview', options()));
    } catch (e) {
      if (e.code === 'CANCELLED') clearPreview(t('cancelled'));
      else { clearPreview(e.message); el.recon.className = 'recon bad'; }
    } finally { setBusy(false); }
  }

  async function doExport() {
    if (busy) return;
    setBusy(true, t('building'));
    try {
      const r = await send('export', options());
      setResult(t('saved', r.filename, r.written != null ? r.written : r.stats.rows), 'ok');
      if (r.warnings && r.warnings.length) renderPreview(Object.assign({}, lastPreview, { warnings: r.warnings }));
      schedulePreview();   // the export moved the diff baseline
    } catch (e) {
      setResult(e.code === 'CANCELLED' ? t('cancelled') : e.message, e.code === 'CANCELLED' ? '' : 'bad');
    } finally { setBusy(false); }
  }

  async function doCopy() {
    if (busy) return;
    setBusy(true, t('copying'));
    try {
      const r = await send('copy', options());
      await navigator.clipboard.writeText(r.text);
      setResult(t('copied', r.stats.rows), 'ok');
    } catch (e) {
      setResult(e.code === 'CANCELLED' ? t('cancelled') : (e.name === 'NotAllowedError' ? t('copyFailed') : e.message), e.code === 'CANCELLED' ? '' : 'bad');
    } finally { setBusy(false); }
  }

  async function doDiagnostics() {
    try {
      const d = await send('diagnostics');
      const lines = [
        'Whatsapp Scrapper by abdumezar — diagnostics',
        'extension:     ' + d.extension,
        'whatsapp:      ' + d.whatsapp + (d.whatsapp === d.verified ? ' (verified)' : ' (verified against ' + d.verified + ')'),
        'store:         ' + (d.storeAvailable ? 'available via ' + d.discovery : 'UNAVAILABLE'),
        'self-test:     ' + JSON.stringify(d.selfTest),
        'active chat:   ' + (d.activeKind || '(none)') + (d.activeSize != null ? ', ' + d.activeSize + ' members' : ''),
        'chats loaded:  ' + (d.chatCount == null ? '(unknown)' : d.chatCount),
        'dom fallback:  ' + (d.domReady ? 'ready' : 'not ready'),
        'user agent:    ' + d.userAgent,
      ];
      await navigator.clipboard.writeText(lines.join('\n'));
      setResult(t('diagnosticsCopied'), 'ok');
    } catch (e) {
      setResult(e.message, 'bad');
    }
  }

  async function doResetBaseline() {
    try {
      await send('clearSnapshots');
      setResult(t('baselineCleared'), 'ok');
      schedulePreview();
    } catch (e) { setResult(e.message, 'bad'); }
  }

  // ---------- blocker ----------
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
      catch (e2) { el.blockerAction.disabled = false; el.blockerText.textContent = e2.message; return; }
    }
    window.close();   // the popup does not survive the navigation anyway
  }

  async function reloadTab() {
    el.blockerAction.disabled = true;
    try { await chrome.tabs.reload(tabId); window.close(); }
    catch (e) { el.blockerAction.disabled = false; el.blockerText.textContent = e.message; }
  }

  // ---------- init ----------
  async function init() {
    initChrome();
    await loadOptions();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab ? tab.id : null;
    if (!tab || !/^https:\/\/web\.whatsapp\.com\//.test(tab.url || '')) {
      setStatus('notWhatsapp', 'pill-muted');
      return block(t('blockNotWhatsapp'), { label: t('blockOpen'), run: openWhatsApp });
    }
    let st;
    try { st = await send('status'); }
    catch (e) {
      setStatus('notConnected', 'pill-bad');
      return block(t('blockNotInjected'), { label: t('blockReload'), run: reloadTab });
    }
    el.app.hidden = false;
    if (st.store.available) {
      setStatus('storeOk', 'pill-ok', ' · ' + (st.store.version || '').replace(/^2\.3000\./, 'b'));
      el.status.title = 'Reading WhatsApp\'s store directly (' + st.store.how + ')';
      if (st.store.version && st.verifiedVersion && st.store.version !== st.verifiedVersion) {
        untestedVersion = st.store.version;
        renderNote();
      }
    } else {
      const why = st.store.selfTest && st.store.selfTest.message ? st.store.selfTest.message : 'store unavailable';
      setStatus('screenReading', 'pill-warn');
      el.status.title = why;
      document.querySelector('.tab[data-scope="chats"]').disabled = true;
    }
    renderActive(st.active);
    if (st.store.available) {
      try {
        chats = await send('listChats');
        // Drop selections for chats that are no longer loaded.
        const live = new Set(chats.map((c) => c.id));
        for (const id of Array.from(selected)) if (!live.has(id)) selected.delete(id);
        renderChatList();
      } catch (e) {}
    }
    preview();
  }

  // ---------- events ----------
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    if (tab.disabled) return;
    document.querySelectorAll('.tab').forEach((x) => { x.classList.toggle('active', x === tab); x.setAttribute('aria-selected', x === tab ? 'true' : 'false'); });
    scope = tab.dataset.scope;
    el.pickPane.hidden = scope !== 'chats';
    el.activeCard.hidden = scope === 'chats';
    schedulePreview();
  }));
  el.chatFilter.addEventListener('input', renderChatList);
  el.selectAll.addEventListener('click', () => {
    visibleChats().forEach((c) => selected.add(c.id));
    renderChatList(); saveOptions(); schedulePreview();
  });
  el.selectNone.addEventListener('click', () => {
    selected.clear();
    renderChatList(); saveOptions(); schedulePreview();
  });
  [el.format, el.communityMode, el.locale, el.includeMe, el.changesOnly, el.forceDom,
    ...document.querySelectorAll('#extras input, #filters input')]
    .forEach((c) => c.addEventListener('change', () => { saveOptions(); schedulePreview(); }));
  el.countries.addEventListener('input', () => { saveOptions(); schedulePreview(); });
  el.exportBtn.addEventListener('click', doExport);
  el.copyBtn.addEventListener('click', doCopy);
  el.cancelBtn.addEventListener('click', () => { send('cancel').catch(() => {}); });
  el.dashBtn.addEventListener('click', () => { chrome.runtime.sendMessage({ target: 'worker', cmd: 'openDashboard' }); window.close(); });
  el.presetSelect.addEventListener('change', () => { if (el.presetSelect.value) applyPreset(el.presetSelect.value); });
  el.presetSave.addEventListener('click', async () => {
    const name = el.presetName.value.trim();
    if (!name) return el.presetName.focus();
    const o = options();
    delete o.scope; delete o.chatIds; delete o.forceDom;
    presets[name] = o;
    try { await chrome.storage.local.set({ waxPresets: presets }); } catch (e) {}
    el.presetName.value = '';
    renderPresets();
    el.presetSelect.value = name;
    setResult(t('presetSaved'), 'ok');
  });
  el.presetDelete.addEventListener('click', async () => {
    const name = el.presetSelect.value;
    if (!name) return;
    delete presets[name];
    try { await chrome.storage.local.set({ waxPresets: presets }); } catch (e) {}
    renderPresets();
  });
  el.diagBtn.addEventListener('click', doDiagnostics);
  el.resetBaseline.addEventListener('click', doResetBaseline);

  init();
})();
