/*
 * Whatsapp Scrapper by abdumezar — content script (isolated world).
 * Bridges popup ↔ page adapter, builds rows, writes the file, triggers the download.
 */
(() => {
  'use strict';
  if (window.__waxContentLoaded) return;
  window.__waxContentLoaded = true;

  const NONCE = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  const PAGE_TIMEOUT_MS = 3000;
  /* The WhatsApp build this was last verified against. A mismatch is not an
     error — it is what the popup uses to warn that the internals are untested. */
  const VERIFIED_VERSION = '2.3000.1046916940';
  const SNAPSHOT_KEY = 'waxSnapshots';
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

  // ---------- job control ----------
  /* One job at a time. `cancelled` is checked between chats and inside the DOM
     scroll loop, which are the only places a long export actually spends time. */
  let job = { cancelled: false };

  function progress(payload) {
    try { const p = chrome.runtime.sendMessage(Object.assign({ type: 'WAX_PROGRESS' }, payload)); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }
  function checkCancelled() {
    if (job.cancelled) { const e = new Error('Cancelled'); e.code = 'CANCELLED'; throw e; }
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
  const DEFAULT_FILTERS = { adminsOnly: false, savedOnly: false, businessOnly: false, withPhoneOnly: false, countries: '' };
  const DEFAULT_OPTS = {
    scope: 'active', chatIds: [], communityMode: 'announce', includeMe: false, extras: {}, locale: 'en',
    forceDom: false, format: 'csv', filters: DEFAULT_FILTERS, changesOnly: false,
  };

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
      country_iso: ph.country_iso,
      // Unknown for a row with no number at all, rather than a misleading false.
      is_valid_number: ph.phone_number ? !!ph.valid : null,
      _isMe: !!r.isMe,
      _phoneSource: r.phoneSource || '',
      _joined: false,
    };
  }

  /** Identity of a member across exports: the number when there is one, else the wid. */
  const rowKey = (r) => (r.phone_number ? 'p:' + r.phone_number : 'w:' + (r.wid || ''));

  function applyFilters(rows, f) {
    const filters = Object.assign({}, DEFAULT_FILTERS, f || {});
    const codes = String(filters.countries || '').split(/[^\d]+/).filter(Boolean);
    const kept = rows.filter((r) =>
      (!filters.adminsOnly || r.is_admin === true) &&
      (!filters.savedOnly || r.is_my_contact === true) &&
      (!filters.businessOnly || r.is_business === true) &&
      (!filters.withPhoneOnly || !!r.phone_number) &&
      (!codes.length || codes.indexOf(r.country_code) !== -1));
    return { rows: kept, removed: rows.length - kept.length };
  }

  function stats(rows, chats, extra) {
    const n = (f) => rows.filter(f).length;
    return Object.assign({
      rows: rows.length,
      withPhone: n((r) => r.phone_number),
      myContacts: n((r) => r.is_my_contact === true),
      business: n((r) => r.is_business === true),
      admins: n((r) => r.is_admin === true),
      reported: chats.reduce((a, c) => a + (c.participantCount || 0), 0),
      chats: chats.length,
    }, extra || {});
  }

  // ---------- membership snapshots (diff against the last export) ----------
  async function loadSnapshots() {
    try { const o = await chrome.storage.local.get(SNAPSHOT_KEY); return o[SNAPSHOT_KEY] || {}; }
    catch (e) { return {}; }
  }

  /** Only member *keys* are stored, never names or numbers beyond the key
   *  itself — enough to count who came and went, and nothing more. */
  async function saveSnapshots(perChat) {
    try {
      const all = await loadSnapshots();
      for (const [id, keys] of perChat) all[id] = { at: new Date().toISOString(), keys };
      await chrome.storage.local.set({ [SNAPSHOT_KEY]: all });
    } catch (e) {}
  }

  function diffAgainst(snapshot, keys) {
    if (!snapshot || !Array.isArray(snapshot.keys)) return null;
    const before = new Set(snapshot.keys);
    const now = new Set(keys);
    let joined = 0;
    for (const k of now) if (!before.has(k)) joined++;
    let left = 0;
    for (const k of before) if (!now.has(k)) left++;
    return { joined, left, since: snapshot.at, newKeys: now };
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
      if (!c) { warnings.push({ code: 'chatNotFound', id }); continue; }
      if (c.kind === 'community') {
        const subs = all.filter((x) => x.parentGroup === id);
        if (opts.communityMode === 'all') {
          if (!subs.length) warnings.push({ code: 'noSubgroups', title: c.title });
          targets.push(...(subs.length ? subs : [c]));
        } else {
          const def = subs.find((s) => s.isDefaultSubgroup) || subs.find((s) => s.isGeneralSubgroup);
          if (def) targets.push(def);
          else { warnings.push({ code: 'noAnnouncement', title: c.title }); targets.push(c); }
        }
      } else targets.push(c);
    }
    return { targets, warnings };
  }

  async function buildDataset(rawOpts) {
    const opts = Object.assign({}, DEFAULT_OPTS, rawOpts || {});
    const status = opts.forceDom ? { available: false, selfTest: { ok: false, failed: 'forced' } } : await storeStatus();
    let rows = [];
    const chats = [];
    let warnings = [];
    let mode = 'store';
    const keysByChat = new Map();

    if (status.available) {
      const t = await resolveTargets(opts);
      warnings = t.warnings;
      let done = 0;
      for (const c of t.targets) {
        checkCancelled();
        progress({ phase: 'chat', done, total: t.targets.length, label: c.title });
        try {
          const res = await pageCall('participants', { chatId: c.id }, 10000);
          chats.push(res.chat);
          const chatRows = res.rows.map((r) => toOutputRow(r, res.chat, opts));
          keysByChat.set(res.chat.id, chatRows.map(rowKey));
          rows.push(...chatRows);
        } catch (e) {
          if (e.code === 'CANCELLED') throw e;
          warnings.push({ code: 'chatFailed', title: c.title, message: e.message });
        }
        done++;
        progress({ phase: 'chat', done, total: t.targets.length, label: c.title });
      }
    } else {
      mode = 'dom';
      if (opts.scope === 'chats') { const e = new Error('Picking several chats needs the WhatsApp store, which is unavailable right now. Export the open chat instead.'); e.code = 'DOM_ONLY'; throw e; }
      const res = await WAXDom.scrapeActiveChat((seen, ratio) => {
        progress({ phase: 'scroll', done: seen, total: null, ratio });
        return !job.cancelled;   // returning false stops the scroll loop
      });
      checkCancelled();
      chats.push(res.chat);
      warnings.push(...res.warnings);
      const chatRows = res.rows.map((r) => toOutputRow(r, res.chat, opts));
      keysByChat.set(res.chat.id, chatRows.map(rowKey));
      rows.push(...chatRows);
    }

    // Diff against the last export, before any filtering — "who is in this group
    // now" is a fact about the group, not about the current filter settings.
    const snapshots = await loadSnapshots();
    let diff = null;
    for (const [id, keys] of keysByChat) {
      const d = diffAgainst(snapshots[id], keys);
      if (!d) continue;
      if (!diff) diff = { joined: 0, left: 0, since: d.since, chats: 0 };
      diff.joined += d.joined;
      diff.left += d.left;
      diff.chats++;
      if (d.since < diff.since) diff.since = d.since;   // ISO strings sort correctly
    }
    if (diff) {
      for (const r of rows) {
        const snap = snapshots[r.group_id];
        if (snap && Array.isArray(snap.keys)) r._joined = snap.keys.indexOf(rowKey(r)) === -1;
      }
    }

    if (!opts.includeMe) rows = rows.filter((r) => !r._isMe);
    if (opts.changesOnly && diff) rows = rows.filter((r) => r._joined);
    const filtered = applyFilters(rows, opts.filters);
    rows = WAXCsv.sortRows(WAXCsv.dedupe(filtered.rows));

    const extras = Object.assign({}, opts.extras);
    if (chats.length > 1) extras.group_name = true;
    return {
      mode, status, chats, rows, warnings, extras, keysByChat, diff,
      stats: stats(rows, chats, { filtered: filtered.removed, joined: diff ? diff.joined : null, left: diff ? diff.left : null, since: diff ? diff.since : null }),
    };
  }

  // ---------- output ----------
  const MIME = {
    csv: 'text/csv;charset=utf-8',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    vcf: 'text/vcard;charset=utf-8',
  };

  /** @returns {{blob: Blob, ext: string, bytes: number, warnings: object[]}} */
  function render(ds, opts) {
    const cols = WAXCsv.columnsFor(ds.extras);
    const title = ds.chats[0] ? ds.chats[0].title : 'chat';
    if (opts.format === 'xlsx') {
      const buf = WAXXlsx.toXlsx(ds.rows, cols, ds.chats.length > 1 ? 'Members' : title);
      return { blob: new Blob([buf], { type: MIME.xlsx }), ext: 'xlsx', bytes: buf.length, warnings: [] };
    }
    if (opts.format === 'vcf') {
      const v = WAXVcard.toVcard(ds.rows, { group: !!ds.extras.group_name || ds.chats.length > 1 });
      const warnings = v.skipped ? [{ code: 'vcardNoPhone', n: v.skipped }] : [];
      return { blob: new Blob([v.text], { type: MIME.vcf }), ext: 'vcf', bytes: v.text.length, warnings, written: v.written };
    }
    const text = WAXCsv.toCsv(ds.rows, ds.extras);
    return { blob: new Blob([text], { type: MIME.csv }), ext: 'csv', bytes: text.length, warnings: [] };
  }

  function download(blob, filename) {
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
      return { store: s, active, chatCount, domReady: WAXDom.canRun(), verifiedVersion: VERIFIED_VERSION };
    },

    async listChats() { return pageCall('listChats'); },

    async preview(opts) {
      job = { cancelled: false };
      const ds = await buildDataset(opts);
      const cols = WAXCsv.columnsFor(ds.extras);
      return {
        mode: ds.mode, chats: ds.chats, warnings: ds.warnings, stats: ds.stats, columns: cols,
        sample: ds.rows.slice(0, 10).map((r) => cols.map((c) => r[c])),
      };
    },

    async export(opts) {
      job = { cancelled: false };
      const o = Object.assign({}, DEFAULT_OPTS, opts || {});
      const ds = await buildDataset(o);
      const out = render(ds, o);
      const filename = WAXCsv.filename(ds.chats[0] ? ds.chats[0].title : 'chat', ds.chats.length, null, out.ext);
      download(out.blob, filename);
      // The export is now the baseline the next diff is measured against.
      await saveSnapshots(ds.keysByChat);
      return {
        mode: ds.mode, filename, stats: ds.stats, bytes: out.bytes, written: out.written,
        warnings: ds.warnings.concat(out.warnings),
      };
    },

    /** Returns the text; the popup owns the clipboard write, because that needs
     *  a focused document and the popup is the thing the user just clicked. */
    async copy(opts) {
      job = { cancelled: false };
      const ds = await buildDataset(opts);
      return { text: WAXCsv.toTsv(ds.rows, ds.extras), stats: ds.stats, warnings: ds.warnings, mode: ds.mode };
    },

    async diagnostics() {
      const s = await storeStatus();
      let active = null, chatCount = null;
      try { active = await pageCall('activeChat'); } catch (e) {}
      try { chatCount = (await pageCall('listChats')).length; } catch (e) {}
      return {
        extension: chrome.runtime.getManifest().version,
        whatsapp: s.version || '(unknown)',
        verified: VERIFIED_VERSION,
        storeAvailable: s.available,
        discovery: s.how || '(none)',
        selfTest: s.selfTest || null,
        activeKind: active ? active.kind : null,
        activeSize: active ? active.participantCount : null,
        chatCount,
        domReady: WAXDom.canRun(),
        userAgent: navigator.userAgent,
      };
    },

    async clearSnapshots() {
      try { await chrome.storage.local.remove(SNAPSHOT_KEY); } catch (e) {}
      return { cleared: true };
    },

    cancel() { job.cancelled = true; return { cancelled: true }; },
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const fn = msg && commands[msg.cmd];
    if (!fn) { sendResponse({ ok: false, error: { code: 'BAD_CMD', message: 'Unknown command' } }); return false; }
    Promise.resolve()
      .then(() => fn(msg.args || {}))
      .then(
        (data) => sendResponse({ ok: true, data }),
        (e) => sendResponse({ ok: false, error: { code: e.code || 'INTERNAL', message: e.message || String(e) } })
      );
    return true;
  });
})();
