/*
 * Whatsapp Scrapper by abdumezar — content script (isolated world).
 * Bridges popup ↔ page adapter, builds rows, writes the CSV, triggers the download.
 */
(() => {
  'use strict';
  if (window.__waxContentLoaded) return;
  window.__waxContentLoaded = true;

  const NONCE = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  const PAGE_TIMEOUT_MS = 3000;
  const pending = new Map();

  // ---------- page bridge ----------
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const m = ev.data;
    if (!m || m.type !== 'WAX_RES' || m.nonce !== NONCE) return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.data);
    else { const e = new Error(m.error && m.error.message || 'Page error'); e.code = m.error && m.error.code || 'INTERNAL'; p.reject(e); }
  });

  function pageCall(cmd, args, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = String(Math.random()).slice(2) + Date.now();
      const timer = setTimeout(() => {
        pending.delete(id);
        const e = new Error('WhatsApp store did not answer (' + cmd + ')'); e.code = 'TIMEOUT'; reject(e);
      }, timeoutMs || PAGE_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      window.postMessage({ type: 'WAX_REQ', nonce: NONCE, id, cmd, args: args || {} }, window.location.origin);
    });
  }

  // ---------- mode detection ----------
  async function storeStatus() {
    try {
      const r = await pageCall('ping', {}, 1500);
      return { available: !!(r && r.selfTest && r.selfTest.ok), selfTest: r.selfTest, version: r.version, how: r.selfTest && r.selfTest.how };
    } catch (e) {
      return { available: false, selfTest: { ok: false, failed: e.code || 'bridge', message: e.message }, version: '' };
    }
  }

  // ---------- row shaping ----------
  const DEFAULT_OPTS = { scope: 'active', chatIds: [], communityMode: 'announce', includeMe: false, extras: {}, locale: 'en', forceDom: false };

  function roleOf(r) { return r.isSuperAdmin ? 'superadmin' : r.isAdmin ? 'admin' : 'member'; }

  function joinedAt(ts) {
    if (typeof ts !== 'number' || !ts) return '';
    const ms = ts > 1e12 ? ts : ts * 1000;
    try { return new Date(ms).toISOString(); } catch (e) { return ''; }
  }

  function toOutputRow(r, chat, opts) {
    const ph = WAXPhone.parsePhone(r.phone, opts.locale);
    const publicName = r.pushname || r.verifiedName || '';
    return {
      country_code: ph.country_code,
      country_name: ph.country_name,
      phone_number: ph.phone_number,
      formatted_phone: ph.formatted_phone,
      is_my_contact: r.isMyContact === null ? null : !!r.isMyContact,
      saved_name: r.savedName || '',
      public_name: publicName,
      is_business: r.isBusiness === null ? null : !!r.isBusiness,
      is_admin: r.isAdmin === null ? null : !!(r.isAdmin || r.isSuperAdmin),
      group_name: chat ? chat.title : '',
      group_id: chat ? chat.id : '',
      role: r.isAdmin === null ? '' : roleOf(r),
      username: r.username || '',
      wid: r.wid || '',
      joined_at: joinedAt(r.joinTime),
      _isMe: !!r.isMe,
      _phoneSource: r.phoneSource || '',
    };
  }

  function stats(rows, chats) {
    const n = (f) => rows.filter(f).length;
    return {
      rows: rows.length,
      withPhone: n((r) => r.phone_number),
      myContacts: n((r) => r.is_my_contact === true),
      business: n((r) => r.is_business === true),
      admins: n((r) => r.is_admin === true),
      reported: chats.reduce((a, c) => a + (c.participantCount || 0), 0),
      chats: chats.length,
    };
  }

  // ---------- dataset ----------
  async function resolveTargets(opts) {
    const all = await pageCall('listChats');
    let ids = [];
    if (opts.scope === 'chats') ids = opts.chatIds || [];
    else {
      const a = await pageCall('activeChat');
      if (!a) { const e = new Error('No chat is open. Open a group, community or broadcast list first.'); e.code = 'NO_ACTIVE'; throw e; }
      if (!['group', 'subgroup', 'community', 'broadcast'].includes(a.kind)) { const e = new Error('The open chat is a ' + a.kind + ' chat, not a group.'); e.code = 'NOT_GROUP'; throw e; }
      ids = [a.id];
    }
    const targets = [];
    const warnings = [];
    for (const id of ids) {
      const c = all.find((x) => x.id === id);
      if (!c) { warnings.push('Chat ' + id + ' not found — skipped'); continue; }
      if (c.kind === 'community') {
        const subs = all.filter((x) => x.parentGroup === id);
        if (opts.communityMode === 'all') {
          if (!subs.length) warnings.push(c.title + ': no sub-groups loaded — exporting community admins only');
          targets.push(...(subs.length ? subs : [c]));
        } else {
          const def = subs.find((s) => s.isDefaultSubgroup) || subs.find((s) => s.isGeneralSubgroup);
          if (def) targets.push(def);
          else { warnings.push(c.title + ': announcement group not loaded — exporting community admins only'); targets.push(c); }
        }
      } else targets.push(c);
    }
    return { targets, warnings };
  }

  async function buildDataset(rawOpts) {
    const opts = Object.assign({}, DEFAULT_OPTS, rawOpts || {});
    const status = opts.forceDom ? { available: false, selfTest: { ok: false, failed: 'forced' } } : await storeStatus();
    let rows = [];
    let chats = [];
    let warnings = [];
    let mode = 'store';

    if (status.available) {
      const t = await resolveTargets(opts);
      warnings = t.warnings;
      for (const c of t.targets) {
        try {
          const res = await pageCall('participants', { chatId: c.id }, 10000);
          chats.push(res.chat);
          for (const r of res.rows) rows.push(toOutputRow(r, res.chat, opts));
        } catch (e) {
          warnings.push(c.title + ': ' + e.message);
        }
      }
    } else {
      mode = 'dom';
      if (opts.scope === 'chats') { const e = new Error('Picking several chats needs the WhatsApp store, which is unavailable right now. Export the open chat instead.'); e.code = 'DOM_ONLY'; throw e; }
      const res = await WAXDom.scrapeActiveChat();
      chats.push(res.chat);
      warnings.push(...res.warnings);
      for (const r of res.rows) rows.push(toOutputRow(r, res.chat, opts));
    }

    if (!opts.includeMe) rows = rows.filter((r) => !r._isMe);
    rows = WAXCsv.sortRows(WAXCsv.dedupe(rows));
    const extras = Object.assign({}, opts.extras);
    if (chats.length > 1) extras.group_name = true;
    return { mode, status, chats, rows, warnings, extras, stats: stats(rows, chats) };
  }

  function download(text, filename) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 10000);
  }

  // ---------- popup messages ----------
  const commands = {
    async status() {
      const s = await storeStatus();
      let active = null, chatCount = null;
      if (s.available) {
        try { active = await pageCall('activeChat'); } catch (e) {}
        try { chatCount = (await pageCall('listChats')).length; } catch (e) {}
      }
      return { store: s, active, chatCount, domReady: WAXDom.canRun() };
    },
    async listChats() { return pageCall('listChats'); },
    async preview(opts) {
      const ds = await buildDataset(opts);
      const cols = WAXCsv.columnsFor(ds.extras);
      return { mode: ds.mode, chats: ds.chats, warnings: ds.warnings, stats: ds.stats, columns: cols, sample: ds.rows.slice(0, 10).map((r) => cols.map((c) => r[c])) };
    },
    async export(opts) {
      const ds = await buildDataset(opts);
      const text = WAXCsv.toCsv(ds.rows, ds.extras);
      const filename = WAXCsv.filename(ds.chats[0] ? ds.chats[0].title : 'chat', ds.chats.length);
      download(text, filename);
      return { mode: ds.mode, filename, stats: ds.stats, warnings: ds.warnings, bytes: text.length };
    },
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const fn = msg && commands[msg.cmd];
    if (!fn) { sendResponse({ ok: false, error: { code: 'BAD_CMD', message: 'Unknown command' } }); return false; }
    fn(msg.args || {}).then(
      (data) => sendResponse({ ok: true, data }),
      (e) => sendResponse({ ok: false, error: { code: e.code || 'INTERNAL', message: e.message || String(e) } })
    );
    return true;
  });
})();
