/*
 * Whatsapp Scrapper by abdumezar — service worker.
 *
 * The extension spent its first life with no background at all, and most of it
 * still works that way: the popup talks to the content script directly. This
 * worker exists for the three things a popup cannot do because it is not open:
 *
 *   1. keyboard shortcuts and the page context menu,
 *   2. opening the dashboard,
 *   3. the watch alarm, which diffs a chat's membership on a schedule.
 *
 * It never touches WhatsApp itself. Every read goes through the content script
 * in a WhatsApp tab, which is the only place the read-only store adapter runs —
 * so a watch check is exactly the same read an export does, and when no
 * WhatsApp tab is open the check simply does not happen.
 *
 * MV3 workers are killed between events, so nothing is cached in module scope
 * beyond constants; state lives in chrome.storage.
 */
'use strict';

const WATCH_KEY = 'waxWatch';
const SNAPSHOT_KEY = 'waxSnapshots';
const ALARM = 'wax-watch';
const DASHBOARD = 'src/dashboard/index.html';
const WA_URL = 'https://web.whatsapp.com/';
const DEFAULT_INTERVAL_MINUTES = 360;   // six hours

// ---------- helpers --------------------------------------------------------

async function whatsappTab() {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  // Prefer a tab that is actually loaded; a discarded one has no content script.
  return tabs.find((t) => t.status === 'complete' && !t.discarded) || tabs[0] || null;
}

/** Sends a command to the content script, or throws something legible. */
async function ask(cmd, args) {
  const tab = await whatsappTab();
  if (!tab) { const e = new Error('No WhatsApp tab is open'); e.code = 'NO_TAB'; throw e; }
  const res = await chrome.tabs.sendMessage(tab.id, { cmd, args: args || {} });
  if (!res) { const e = new Error('The WhatsApp tab did not answer'); e.code = 'NO_RESPONSE'; throw e; }
  if (!res.ok) { const e = new Error(res.error.message); e.code = res.error.code; throw e; }
  return res.data;
}

async function openDashboard() {
  const url = chrome.runtime.getURL(DASHBOARD);
  const [existing] = await chrome.tabs.query({ url });
  if (existing) await chrome.tabs.update(existing.id, { active: true });
  else await chrome.tabs.create({ url });
}

function notify(id, title, message) {
  try {
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      silent: false,
    });
  } catch (e) { /* notifications can be disabled at the OS level */ }
}

const loadWatch = async () => (await chrome.storage.local.get(WATCH_KEY))[WATCH_KEY] || { chats: [], intervalMinutes: DEFAULT_INTERVAL_MINUTES, notifyJoins: true, notifyLeaves: true, people: '' };

// ---------- menus, shortcuts ----------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'wax-export', title: 'Export this chat', contexts: ['page'], documentUrlPatterns: ['https://web.whatsapp.com/*'] });
    chrome.contextMenus.create({ id: 'wax-dashboard', title: 'Open the dashboard', contexts: ['page', 'action'] });
  });
  await rescheduleWatch();
});

chrome.runtime.onStartup.addListener(rescheduleWatch);

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'wax-dashboard') return openDashboard();
  if (info.menuItemId === 'wax-export') return exportOpenChat();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-dashboard') return openDashboard();
  if (command === 'export-open-chat') return exportOpenChat();
});

/** Exports whatever chat is open, with the options last used in the popup. */
async function exportOpenChat() {
  try {
    const { waxOptions } = await chrome.storage.local.get('waxOptions');
    const opts = Object.assign({}, waxOptions || {}, { scope: 'active', chatIds: [] });
    const r = await ask('export', opts);
    notify('wax-export', 'Export saved', `${r.filename} · ${r.stats.rows} rows`);
  } catch (e) {
    notify('wax-export-failed', 'Export failed', e.code === 'NO_TAB' ? 'Open WhatsApp Web first.' : e.message);
  }
}

// ---------- the watch ------------------------------------------------------

async function rescheduleWatch() {
  const watch = await loadWatch();
  await chrome.alarms.clear(ALARM);
  if (!watch.chats || !watch.chats.length) return;
  const minutes = Math.max(15, Number(watch.intervalMinutes) || DEFAULT_INTERVAL_MINUTES);
  chrome.alarms.create(ALARM, { periodInMinutes: minutes, delayInMinutes: Math.min(minutes, 5) });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  try { await runWatch(); } catch (e) { /* a failed check is not worth a notification */ }
});

/**
 * One pass over the watched chats. This deliberately re-uses `dataset`, which
 * updates nothing: the baseline only moves when the user exports, or when this
 * function decides to record the check, so two consecutive alarms cannot make a
 * change disappear before anyone saw it.
 */
async function runWatch() {
  const watch = await loadWatch();
  if (!watch.chats || !watch.chats.length) return;

  const wanted = new Set(
    String(watch.people || '')
      .split(/[\n\r,;\t]+/)
      .map((s) => s.replace(/\D/g, '').replace(/^0+/, ''))
      .filter(Boolean)
  );

  const snapshots = (await chrome.storage.local.get(SNAPSHOT_KEY))[SNAPSHOT_KEY] || {};
  const data = await ask('dataset', { scope: 'chats', chatIds: watch.chats, includeMe: false });

  for (const { id, keys } of data.keysByChat) {
    const before = snapshots[id];
    const chat = data.chats.find((c) => c.id === id);
    const title = (chat && chat.title) || (before && before.title) || id;
    if (!before || !Array.isArray(before.keys)) continue;   // nothing to compare against yet

    const now = new Set(keys);
    const was = new Set(before.keys);
    const joined = [...now].filter((k) => !was.has(k));
    const left = [...was].filter((k) => !now.has(k));
    if (!joined.length && !left.length) continue;

    const bits = [];
    if (watch.notifyJoins !== false && joined.length) bits.push(`+${joined.length} joined`);
    if (watch.notifyLeaves !== false && left.length) bits.push(`−${left.length} left`);

    // A named person coming or going is worth its own line, above the counts.
    const hits = [];
    for (const k of joined.concat(left)) {
      const number = k.startsWith('p:') ? k.slice(2) : '';
      if (number && wanted.has(number)) hits.push((joined.includes(k) ? '+ ' : '− ') + number);
    }
    if (hits.length) bits.unshift(hits.join(', '));
    if (!bits.length) continue;

    notify('wax-watch-' + id, title, bits.join(' · '));
  }

  // Record the check so the next one reports change since *now*, not since the
  // last manual export — otherwise every alarm re-reports the same joins.
  const at = new Date().toISOString();
  for (const { id, keys } of data.keysByChat) {
    const prev = snapshots[id] || {};
    const was = new Set(Array.isArray(prev.keys) ? prev.keys : []);
    const now = new Set(keys);
    const history = (Array.isArray(prev.history) ? prev.history : []).slice(-59);
    const chat = data.chats.find((c) => c.id === id);
    history.push({
      at,
      size: keys.length,
      joined: prev.keys ? [...now].filter((k) => !was.has(k)).length : 0,
      left: prev.keys ? [...was].filter((k) => !now.has(k)).length : 0,
      auto: true,
    });
    snapshots[id] = { at, keys, history, title: (chat && chat.title) || prev.title || id };
  }
  await chrome.storage.local.set({ [SNAPSHOT_KEY]: snapshots });
}

// ---------- messages from the dashboard ------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'worker') return false;
  const run = async () => {
    switch (msg.cmd) {
      case 'openDashboard': return openDashboard();
      case 'rescheduleWatch': return rescheduleWatch();
      case 'runWatchNow': return runWatch();
      case 'openWhatsApp': {
        const tab = await whatsappTab();
        if (tab) await chrome.tabs.update(tab.id, { active: true });
        else await chrome.tabs.create({ url: WA_URL });
        return { opened: true };
      }
      default: { const e = new Error('Unknown command ' + msg.cmd); e.code = 'BAD_CMD'; throw e; }
    }
  };
  run().then(
    (data) => sendResponse({ ok: true, data: data || {} }),
    (e) => sendResponse({ ok: false, error: { code: e.code || 'INTERNAL', message: e.message || String(e) } })
  );
  return true;
});
