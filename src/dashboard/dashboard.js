/*
 * Whatsapp Scrapper by abdumezar — dashboard.
 *
 * An extension page, not a tab the user is looking at, so it cannot read
 * WhatsApp or download a file itself: it asks the content script in a WhatsApp
 * tab for both. Every number on this page comes out of rows the exporter
 * already reads — nothing here makes WhatsApp do anything new.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const t = (...a) => WAXI18n.t(...a);
  const A = WAXAnalytics;

  const state = {
    chats: [],
    selected: new Set(),
    data: null,          // the last loaded dataset
    keysByChat: [],
    snapshots: [],
    labels: {},
    watch: { chats: [], intervalMinutes: 360, notifyJoins: true, notifyLeaves: true, people: '' },
    view: 'overview',
    match: null,
  };

  const KIND_KEY = { group: 'kindGroup', subgroup: 'kindSubgroup', community: 'kindCommunity', broadcast: 'kindBroadcast' };
  const kindLabel = (k) => (KIND_KEY[k] ? t(KIND_KEY[k]) : k);
  const num = (n) => Number(n || 0).toLocaleString(WAXI18n.current() === 'ar' ? 'ar-EG' : undefined);

  // ---------- messaging ----------
  async function whatsappTab() {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    return tabs.find((x) => x.status === 'complete' && !x.discarded) || tabs[0] || null;
  }

  /** Talks to the content script, which is the only thing that can read WhatsApp. */
  async function send(cmd, args) {
    const tab = await whatsappTab();
    if (!tab) throw Object.assign(new Error(t('needWhatsapp')), { code: 'NO_TAB' });
    const res = await chrome.tabs.sendMessage(tab.id, { cmd, args: args || {} });
    if (!res) throw Object.assign(new Error(t('noAnswer')), { code: 'NO_RESPONSE' });
    if (!res.ok) throw Object.assign(new Error(res.error.message), { code: res.error.code });
    return res.data;
  }

  const toWorker = (cmd, args) => chrome.runtime.sendMessage(Object.assign({ target: 'worker', cmd }, args || {}));

  let toastTimer = null;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
  }

  // ---------- file output ----------
  /** A generic CSV, for the tables that are not member rows. */
  function toCsv(columns, rows) {
    const cell = (v) => '"' + WAXCsv.guard(v === null || v === undefined ? '' : String(v)).replace(/"/g, '""') + '"';
    const lines = [columns.map(cell).join(',')];
    for (const r of rows) lines.push(columns.map((c) => cell(r[c])).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  async function save(text, name) {
    try {
      await send('saveFile', { text, filename: name });
      toast(t('savedFile', name));
    } catch (e) { toast(e.message); }
  }

  const stamp = () => new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');

  // ---------- chart helpers ----------
  const SVG = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs, parent) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    if (parent) parent.appendChild(el);
    return el;
  };

  /**
   * A bar with its *data end* rounded and its baseline end square, so the mark
   * reads as growing out of the axis rather than floating beside it.
   * @param {'right'|'up'|'down'} dir  where the data end is
   */
  function barPath(x, y, w, h, r, dir) {
    const rad = Math.max(0, Math.min(r, dir === 'right' ? w : h, (dir === 'right' ? h : w) / 2));
    const x1 = x + w, y1 = y + h;
    if (dir === 'right') {
      return `M${x},${y}H${x1 - rad}Q${x1},${y} ${x1},${y + rad}V${y1 - rad}Q${x1},${y1} ${x1 - rad},${y1}H${x}Z`;
    }
    if (dir === 'down') {
      return `M${x},${y}H${x1}V${y1 - rad}Q${x1},${y1} ${x1 - rad},${y1}H${x + rad}Q${x},${y1} ${x},${y1 - rad}Z`;
    }
    return `M${x},${y1}V${y + rad}Q${x},${y} ${x + rad},${y}H${x1 - rad}Q${x1},${y} ${x1},${y + rad}V${y1}Z`;
  }

  function emptyChart(host, message) {
    host.textContent = '';
    const p = document.createElement('div');
    p.className = 'empty';
    p.textContent = message;
    host.appendChild(p);
  }

  /** Horizontal bars: magnitude, one hue, value printed at the data end. */
  function hbars(host, items, opts) {
    host.textContent = '';
    if (!items.length) return emptyChart(host, t('noData'));
    const o = Object.assign({ labelWidth: 132, rowHeight: 30, barHeight: 14, width: 560 }, opts || {});
    const h = items.length * o.rowHeight + 8;
    const root = svg('svg', { viewBox: `0 0 ${o.width} ${h}`, role: 'img' }, host);
    const max = Math.max(...items.map((i) => i.value), 1);
    const x0 = o.labelWidth;
    const trackW = o.width - x0 - 56;

    items.forEach((item, i) => {
      const y = i * o.rowHeight + 4;
      const w = Math.max(2, (item.value / max) * trackW);
      const g = svg('g', {}, root);
      svg('title', {}, g).textContent = `${item.label}: ${num(item.value)}`;
      const label = svg('text', { x: x0 - 10, y: y + o.barHeight - 2, 'text-anchor': 'end', class: 'tick' }, g);
      label.textContent = item.label;
      svg('path', {
        d: barPath(x0, y, w, o.barHeight, 4, 'right'),
        fill: `rgb(var(--md-sys-color-primary) / ${item.dim ? 0.45 : 1})`,
        class: 'bar',
      }, g);
      const v = svg('text', { x: x0 + w + 8, y: y + o.barHeight - 2, class: 'val' }, g);
      v.textContent = num(item.value);
    });
    return root;
  }

  /** Vertical bars over time: one hue, a sparse date axis, no number per bar. */
  function vbars(host, points, opts) {
    host.textContent = '';
    if (!points.length) return emptyChart(host, t('noData'));
    const o = Object.assign({ width: 560, height: 200, gap: 3 }, opts || {});
    const root = svg('svg', { viewBox: `0 0 ${o.width} ${o.height}`, role: 'img' }, host);
    const padB = 28, padT = 16;
    const plot = o.height - padB - padT;
    const max = Math.max(...points.map((p) => p.n), 1);
    const bw = Math.max(3, (o.width - (points.length - 1) * o.gap) / points.length);
    const every = Math.ceil(points.length / 8);

    svg('line', { x1: 0, y1: o.height - padB, x2: o.width, y2: o.height - padB, class: 'axis' }, root);
    points.forEach((p, i) => {
      const x = i * (bw + o.gap);
      const h = Math.max(2, (p.n / max) * plot);
      const y = o.height - padB - h;
      const g = svg('g', {}, root);
      svg('title', {}, g).textContent = `${p.label}: ${num(p.n)}`;
      svg('path', { d: barPath(x, y, bw, h, 4, 'up'), fill: 'rgb(var(--md-sys-color-primary))', class: 'bar' }, g);
      if (i % every === 0 || i === points.length - 1) {
        const tx = svg('text', { x: x + bw / 2, y: o.height - padB + 16, 'text-anchor': 'middle', class: 'tick' }, root);
        tx.textContent = p.label;
      }
    });
    // The tallest bar is the only one that gets a number.
    const peak = points.reduce((m, p, i) => (p.n > points[m].n ? i : m), 0);
    const px = peak * (bw + o.gap) + bw / 2;
    const ph = Math.max(2, (points[peak].n / max) * plot);
    const label = svg('text', { x: px, y: o.height - padB - ph - 6, 'text-anchor': 'middle', class: 'val' }, root);
    label.textContent = num(points[peak].n);
    return root;
  }

  /** Joins up, leaves down from a shared zero line — polarity by direction and
   *  by two validated hues, with a legend so identity is never colour alone. */
  function divergingBars(host, points) {
    host.textContent = '';
    if (!points.length) return emptyChart(host, t('timelineEmpty'));
    const W = 560, H = 220, gap = 4, padB = 26, padT = 16;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, host);
    const zero = padT + (H - padT - padB) / 2;
    const half = (H - padT - padB) / 2;
    const max = Math.max(1, ...points.map((p) => Math.max(p.joined, p.left)));
    const bw = Math.max(4, (W - (points.length - 1) * gap) / points.length);
    const every = Math.ceil(points.length / 6);

    points.forEach((p, i) => {
      const x = i * (bw + gap);
      const g = svg('g', {}, root);
      const when = new Date(p.at).toLocaleDateString(WAXI18n.current() === 'ar' ? 'ar-EG' : undefined, { day: 'numeric', month: 'short' });
      svg('title', {}, g).textContent = `${when} · +${num(p.joined)} / −${num(p.left)} · ${num(p.size)}`;
      if (p.joined) {
        const h = Math.max(2, (p.joined / max) * half);
        // 2px of surface between the two fills, so they never touch.
        svg('path', { d: barPath(x, zero - h - 1, bw, h, 4, 'up'), fill: 'rgb(var(--wax-join))', class: 'bar' }, g);
      }
      if (p.left) {
        const h = Math.max(2, (p.left / max) * half);
        svg('path', { d: barPath(x, zero + 1, bw, h, 4, 'down'), fill: 'rgb(var(--wax-leave))', class: 'bar' }, g);
      }
      if (i % every === 0 || i === points.length - 1) {
        const tx = svg('text', { x: x + bw / 2, y: H - 6, 'text-anchor': 'middle', class: 'tick' }, root);
        tx.textContent = when;
      }
    });
    svg('line', { x1: 0, y1: zero, x2: W, y2: zero, class: 'axis' }, root);

    const legend = document.createElement('div');
    legend.className = 'legend';
    for (const [cls, key] of [['join', 'legendJoined'], ['leave', 'legendLeft']]) {
      const s = document.createElement('span');
      const sw = document.createElement('i');
      sw.className = 'swatch ' + cls;
      s.append(sw, document.createTextNode(t(key)));
      legend.appendChild(s);
    }
    host.appendChild(legend);
    return root;
  }

  function tiles(host, items) {
    host.textContent = '';
    for (const it of items) {
      const d = document.createElement('div');
      d.className = 'tile' + (it.tone ? ' ' + it.tone : '');
      const v = document.createElement('div');
      v.className = 'v';
      v.textContent = typeof it.value === 'number' ? num(it.value) : it.value;
      const l = document.createElement('div');
      l.className = 'l';
      l.textContent = it.label;
      d.append(v, l);
      host.appendChild(d);
    }
  }

  function table(el, columns, rows, cellClass) {
    const thead = el.querySelector('thead');
    const tbody = el.querySelector('tbody');
    thead.textContent = '';
    tbody.textContent = '';
    const tr = document.createElement('tr');
    for (const c of columns) {
      const th = document.createElement('th');
      th.textContent = c.label;
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    for (const r of rows) {
      const row = document.createElement('tr');
      for (const c of columns) {
        const td = document.createElement('td');
        const v = c.get(r);
        td.textContent = v === null || v === undefined ? '' : String(v);
        if (c.num) td.className = 'num';
        if (cellClass) cellClass(td, c, r);
        row.appendChild(td);
      }
      tbody.appendChild(row);
    }
  }

  // ---------- picker ----------
  function visibleChats() {
    const f = $('chatFilter').value.trim().toLowerCase();
    return state.chats.filter((c) => !f || c.title.toLowerCase().includes(f));
  }

  function chatRow(c, opts) {
    const r = document.createElement('label');
    r.className = 'chat-row' + (c.kind === 'subgroup' ? ' sub' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = opts.checked(c);
    cb.addEventListener('change', () => opts.toggle(c, cb.checked));
    const tt = document.createElement('div');
    tt.className = 't';
    tt.textContent = c.title;
    const k = document.createElement('div');
    k.className = 'k';
    k.textContent = kindLabel(c.kind);
    tt.appendChild(document.createElement('br'));
    tt.appendChild(k);
    const n = document.createElement('div');
    n.className = 'n';
    n.textContent = c.participantCount != null ? num(c.participantCount) : '—';
    r.append(cb, tt, n);
    return r;
  }

  function renderPicker() {
    const host = $('chatList');
    host.textContent = '';
    for (const c of visibleChats()) {
      host.appendChild(chatRow(c, {
        checked: (x) => state.selected.has(x.id),
        toggle: (x, on) => { if (on) state.selected.add(x.id); else state.selected.delete(x.id); renderPickSummary(); },
      }));
    }
    renderPickSummary();
  }

  function renderPickSummary() {
    $('pickSummary').textContent = state.selected.size ? t('nSelected', state.selected.size) : t('nothingSelected');
    $('loadBtn').disabled = !state.selected.size;
  }

  // ---------- views ----------
  function renderOverview() {
    const host = $('tiles');
    if (!state.data) return tiles(host, [{ value: '—', label: t('loadFirst') }]);
    const s = A.summarize(state.data.rows);
    const people = new Set();
    let multi = 0;
    const seen = new Map();
    for (const { keys } of state.keysByChat) {
      for (const k of new Set(keys)) {
        people.add(k);
        seen.set(k, (seen.get(k) || 0) + 1);
      }
    }
    for (const n of seen.values()) if (n > 1) multi++;

    tiles(host, [
      { value: people.size || s.total, label: t('statPeople') },
      { value: s.withPhone, label: t('statWithPhone') },
      { value: s.invalid, label: t('statInvalid'), tone: s.invalid ? 'warn' : '' },
      { value: s.saved, label: t('statSaved') },
      { value: s.business, label: t('statBusiness') },
      { value: s.admins, label: t('statAdmins') },
      { value: s.lidOnly, label: t('statLidOnly'), tone: s.lidOnly ? 'warn' : '' },
      { value: multi, label: t('statInMultiple') },
    ]);

    const cut = A.topN(s.countries, 8);
    const items = cut.head.map((c) => ({ label: (c.name || c.iso || '+' + c.code) + ' · +' + c.code, value: c.n }));
    if (cut.other) items.push({ label: t('otherCountries', cut.other.countries), value: cut.other.n, dim: true });
    hbars($('countryChart'), items);

    vbars($('joinChart'), s.months.map((m) => ({ label: m.month.slice(2), n: m.n })));
  }

  function renderOverlap() {
    const summary = $('overlapSummary');
    if (!state.keysByChat.length) { tiles(summary, [{ value: '—', label: t('loadFirst') }]); table($('overlapTable'), [], []); return; }
    const titleOf = (id) => (state.chats.find((c) => c.id === id) || {}).title || id;
    const o = A.overlap(state.keysByChat.map((k) => ({ id: k.id, title: titleOf(k.id), keys: k.keys })));

    tiles(summary, [
      { value: o.union, label: t('overlapUnion') },
      { value: o.everywhere === null ? '—' : o.everywhere, label: t('overlapEverywhere') },
      { value: o.sets.length, label: t('statChats') },
    ]);

    const max = Math.max(1, ...o.pairs.map((p) => p.shared));
    table($('overlapTable'), [
      { label: t('overlapChatA'), get: (p) => p.aTitle },
      { label: t('overlapChatB'), get: (p) => p.bTitle },
      { label: t('overlapShared'), get: (p) => num(p.shared), num: true, key: 'shared' },
      { label: t('overlapOnlyA'), get: (p) => num(p.onlyA), num: true },
      { label: t('overlapOnlyB'), get: (p) => num(p.onlyB), num: true },
      { label: t('overlapJaccard'), get: (p) => (p.jaccard * 100).toFixed(1) + '%', num: true },
    ], o.pairs, (td, col, p) => {
      // A one-hue wash behind the number, never instead of it.
      if (col.key === 'shared') {
        td.classList.add('heat');
        td.style.setProperty('--w', (p.shared / max).toFixed(3));
      }
    });
    state.overlap = o;
  }

  function renderQuality() {
    if (!state.data) { tiles($('qualityTiles'), [{ value: '—', label: t('loadFirst') }]); $('qualityBuckets').textContent = ''; return; }
    const q = A.quality(state.data.rows);
    tiles($('qualityTiles'), [
      { value: q.usable, label: t('qualityUsable'), tone: 'good' },
      { value: q.total - q.usable, label: t('qualityUnusable'), tone: q.total - q.usable ? 'warn' : '' },
    ]);

    const host = $('qualityBuckets');
    host.textContent = '';
    for (const b of q.buckets) {
      const card = document.createElement('div');
      card.className = 'tree-node';
      const head = document.createElement('div');
      head.className = 'tree-child';
      const name = document.createElement('span');
      name.textContent = t('q_' + b.code) + ' — ' + num(b.n);
      const btn = document.createElement('button');
      btn.className = 'text-btn';
      btn.type = 'button';
      btn.textContent = t('exportBucket');
      btn.disabled = !b.n;
      btn.addEventListener('click', () => {
        save(WAXCsv.toCsv(b.rows, { group_name: true, is_valid_number: true }), `wa-quality_${b.code}_${stamp()}.csv`);
      });
      head.append(name, btn);
      card.appendChild(head);
      host.appendChild(card);
    }
  }

  function renderCommunities() {
    const host = $('communityTree');
    host.textContent = '';
    const tree = A.communityTree(state.chats);
    const wrap = document.createElement('div');
    wrap.className = 'tree';
    for (const node of tree.roots) {
      const el = document.createElement('div');
      el.className = 'tree-node';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = node.chat.title;
      const meta = document.createElement('div');
      meta.className = 'muted';
      meta.textContent = kindLabel(node.chat.kind)
        + ' · ' + t('nMembers', node.chat.participantCount || 0)
        + (node.children.length ? ' · ' + t('commSubgroups', node.children.length) + ' · ' + t('commReach', node.reach) : '');
      el.append(title, meta);
      if (node.children.length) {
        const kids = document.createElement('div');
        kids.className = 'tree-children';
        for (const c of node.children) {
          const k = document.createElement('div');
          k.className = 'tree-child';
          const n = document.createElement('span');
          n.textContent = c.title + (c.isDefaultSubgroup ? ' · ' + t('announcementGroup') : '');
          const v = document.createElement('span');
          v.textContent = num(c.participantCount || 0);
          k.append(n, v);
          kids.appendChild(k);
        }
        el.appendChild(kids);
      }
      wrap.appendChild(el);
    }
    if (tree.orphans.length) {
      const el = document.createElement('div');
      el.className = 'tree-node';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = t('commOrphans');
      el.appendChild(title);
      const kids = document.createElement('div');
      kids.className = 'tree-children';
      for (const c of tree.orphans) {
        const k = document.createElement('div');
        k.className = 'tree-child';
        const n = document.createElement('span');
        n.textContent = c.title;
        const v = document.createElement('span');
        v.textContent = num(c.participantCount || 0);
        k.append(n, v);
        kids.appendChild(k);
      }
      el.appendChild(kids);
      wrap.appendChild(el);
    }
    host.appendChild(wrap.children.length ? wrap : Object.assign(document.createElement('div'), { className: 'empty', textContent: t('noData') }));
  }

  function renderTimeline() {
    const select = $('timelineChat');
    const chosen = select.value;
    select.textContent = '';
    for (const s of state.snapshots) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.title + ' · ' + num(s.size);
      select.appendChild(opt);
    }
    if (!state.snapshots.length) {
      emptyChart($('timelineChart'), t('timelineEmpty'));
      table($('timelineTable'), [], []);
      return;
    }
    if (chosen && state.snapshots.some((s) => s.id === chosen)) select.value = chosen;
    const snap = state.snapshots.find((s) => s.id === select.value) || state.snapshots[0];
    const tl = A.timeline(snap.history);
    divergingBars($('timelineChart'), tl.points);
    table($('timelineTable'), [
      { label: t('timelineWhen'), get: (p) => new Date(p.at).toLocaleString(WAXI18n.current() === 'ar' ? 'ar-EG' : undefined) },
      { label: t('timelineSize'), get: (p) => num(p.size), num: true },
      { label: t('legendJoined'), get: (p) => num(p.joined), num: true },
      { label: t('legendLeft'), get: (p) => num(p.left), num: true },
      { label: t('timelineSource'), get: (p) => t(p.auto ? 'timelineAuto' : 'timelineExport') },
    ], tl.points.slice().reverse());
  }

  function renderMatch() {
    const m = state.match;
    if (!m) { tiles($('matchTiles'), []); table($('matchTable'), [], []); return; }
    tiles($('matchTiles'), [
      { value: m.matched.length, label: t('matchMatched'), tone: 'good' },
      { value: m.missing.length, label: t('matchMissing'), tone: m.missing.length ? 'warn' : '' },
      { value: m.unreadable, label: t('matchUnreadable'), tone: m.unreadable ? 'bad' : '' },
    ]);
    const rows = m.matched.map((x) => ({ number: x.number, state: t('matchIn'), who: A.nameOf(x.row), group: x.row.group_name || '' }))
      .concat(m.missing.map((x) => ({ number: x.number, state: t('matchNotIn'), who: '', group: '' })));
    table($('matchTable'), [
      { label: t('colNumber'), get: (r) => r.number },
      { label: t('colState'), get: (r) => r.state },
      { label: t('colWho'), get: (r) => r.who },
      { label: t('colGroup'), get: (r) => r.group },
    ], rows);
  }

  function renderLabels() {
    const n = Object.keys(state.labels).length;
    $('labelsState').textContent = n ? t('labelsCount', n) : t('labelsNone');
    const rows = Object.entries(state.labels).slice(0, 500).map(([phone, v]) => ({ phone, label: v.label, notes: v.notes }));
    table($('labelsTable'), [
      { label: t('colNumber'), get: (r) => r.phone },
      { label: t('colLabel'), get: (r) => r.label },
      { label: t('colNotes'), get: (r) => r.notes },
    ], rows);
  }

  function renderWatch() {
    const host = $('watchChats');
    host.textContent = '';
    for (const c of state.chats) {
      host.appendChild(chatRow(c, {
        checked: (x) => state.watch.chats.includes(x.id),
        toggle: (x, on) => {
          const set = new Set(state.watch.chats);
          if (on) set.add(x.id); else set.delete(x.id);
          state.watch.chats = [...set];
        },
      }));
    }
    $('watchInterval').value = String(state.watch.intervalMinutes || 360);
    $('watchPeople').value = state.watch.people || '';
    $('watchJoins').checked = state.watch.notifyJoins !== false;
    $('watchLeaves').checked = state.watch.notifyLeaves !== false;
    $('watchState').textContent = state.watch.chats.length
      ? t('watchOn', state.watch.chats.length, Math.round((state.watch.intervalMinutes || 360) / 60))
      : t('watchNone');
  }

  const RENDER = {
    overview: renderOverview,
    overlap: renderOverlap,
    quality: renderQuality,
    communities: renderCommunities,
    timeline: renderTimeline,
    match: renderMatch,
    labels: renderLabels,
    watch: renderWatch,
  };

  function renderView() {
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== state.view; });
    document.querySelectorAll('.tab').forEach((b) => {
      const on = b.dataset.view === state.view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    (RENDER[state.view] || (() => {}))();
  }

  function renderAll() {
    renderPicker();
    renderView();
  }

  // ---------- actions ----------
  async function loadData() {
    if (!state.selected.size) return;
    $('loadBtn').disabled = true;
    $('loadState').textContent = t('loading');
    try {
      const data = await send('dataset', {
        scope: 'chats',
        chatIds: [...state.selected],
        includeMe: false,
        extras: { group_name: true, country_iso: true, is_valid_number: true },
      });
      state.data = data;
      state.keysByChat = data.keysByChat || [];
      $('loadState').textContent = t('loadedRows', data.rows.length, data.chats.length);
      renderView();
    } catch (e) {
      $('loadState').textContent = e.message;
    } finally { $('loadBtn').disabled = !state.selected.size; }
  }

  async function refreshSnapshots() {
    try { state.snapshots = await send('snapshots'); } catch (e) { state.snapshots = []; }
  }

  async function importLabels(file) {
    try {
      const text = await file.text();
      const parsed = WAXCsvParse.parseLabels(text, A.normalizeNumber);
      if (!parsed.rows) return toast(t('labelsNothing'));
      await send('setLabels', { labels: parsed.labels });
      state.labels = parsed.labels;
      renderLabels();
      toast(t('labelsImported', parsed.rows, parsed.skipped));
    } catch (e) { toast(e.message); }
  }

  // ---------- chrome ----------
  function renderTheme(mode) {
    const label = t('theme') + ': ' + t(mode === 'system' ? 'themeSystem' : mode === 'light' ? 'themeLight' : 'themeDark');
    $('themeBtn').title = label;
    $('themeBtn').setAttribute('aria-label', label);
    for (const m of WAXTheme.MODES) $('themeBtn').querySelector('.i-' + m).toggleAttribute('hidden', m !== mode);
  }

  function initChrome() {
    WAXI18n.init();
    let mode = WAXTheme.saved();
    renderTheme(mode);
    WAXTheme.watch();
    $('themeBtn').addEventListener('click', () => {
      mode = WAXTheme.next(mode);
      WAXTheme.set(mode);
      renderTheme(mode);
    });
    $('langBtn').addEventListener('click', () => {
      WAXI18n.set(WAXI18n.other());
      renderTheme(mode);
      setStatus(statusState.key, statusState.cls, statusState.suffix);
      renderAll();
    });
  }

  let statusState = { key: 'checking', cls: 'pill-muted', suffix: '' };
  function setStatus(key, cls, suffix) {
    statusState = { key, cls, suffix: suffix || '' };
    $('status').textContent = t(key) + statusState.suffix;
    $('status').className = 'pill ' + cls;
  }

  // ---------- init ----------
  async function init() {
    initChrome();
    try {
      const [{ waxWatch }, labels] = await Promise.all([
        chrome.storage.local.get('waxWatch'),
        send('labels').catch(() => ({ labels: {} })),
      ]);
      if (waxWatch) state.watch = Object.assign(state.watch, waxWatch);
      state.labels = (labels && labels.labels) || {};
    } catch (e) { /* storage is optional here */ }

    try {
      const st = await send('status');
      setStatus('storeOk', 'pill-ok', ' · ' + (st.store.version || '').replace(/^2\.3000\./, 'b'));
      $('app').hidden = false;
      state.chats = await send('listChats');
      await refreshSnapshots();
      renderAll();
    } catch (e) {
      setStatus(e.code === 'NO_TAB' ? 'notWhatsapp' : 'notConnected', 'pill-bad');
      $('blocker').hidden = false;
      $('blockerText').textContent = e.code === 'NO_TAB' ? t('needWhatsapp') : e.message;
      $('app').hidden = true;
    }
  }

  // ---------- events ----------
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    renderView();
  }));
  $('chatFilter').addEventListener('input', renderPicker);
  $('selectAll').addEventListener('click', () => { visibleChats().forEach((c) => state.selected.add(c.id)); renderPicker(); });
  $('selectNone').addEventListener('click', () => { state.selected.clear(); renderPicker(); });
  $('loadBtn').addEventListener('click', loadData);
  $('blockerAction').addEventListener('click', () => toWorker('openWhatsApp'));

  $('exportOverlap').addEventListener('click', () => {
    if (!state.overlap) return toast(t('loadFirst'));
    const rows = state.overlap.pairs.map((p) => ({
      chat_a: p.aTitle, chat_b: p.bTitle, shared: p.shared, only_a: p.onlyA, only_b: p.onlyB,
      jaccard: (p.jaccard * 100).toFixed(1),
    }));
    save(toCsv(['chat_a', 'chat_b', 'shared', 'only_a', 'only_b', 'jaccard'], rows), `wa-overlap_${stamp()}.csv`);
  });

  $('exportOnly').addEventListener('click', () => {
    if (!state.keysByChat.length || !state.data) return toast(t('loadFirst'));
    const [first, ...rest] = state.keysByChat;
    const keys = new Set(A.onlyIn(first.keys, rest.map((r) => r.keys)));
    const rows = state.data.rows.filter((r) => keys.has(A.keyOf(r)));
    save(WAXCsv.toCsv(rows, state.data.extras), `wa-only-in_${stamp()}.csv`);
  });

  $('timelineChat').addEventListener('change', renderTimeline);
  $('clearHistory').addEventListener('click', async () => {
    await send('clearSnapshots');
    await refreshSnapshots();
    renderTimeline();
    toast(t('baselineCleared'));
  });

  $('matchRun').addEventListener('click', () => {
    if (!state.data) return toast(t('loadFirst'));
    state.match = A.matchList($('matchInput').value, state.data.rows);
    renderMatch();
  });
  $('exportMissing').addEventListener('click', () => {
    if (!state.match) return toast(t('matchFirst'));
    save(toCsv(['number'], state.match.missing.map((x) => ({ number: x.number }))), `wa-not-in-group_${stamp()}.csv`);
  });

  $('labelsPick').addEventListener('click', () => $('labelsFile').click());
  $('labelsFile').addEventListener('change', (e) => { if (e.target.files[0]) importLabels(e.target.files[0]); e.target.value = ''; });
  $('labelsClear').addEventListener('click', async () => {
    await send('setLabels', { labels: {} });
    state.labels = {};
    renderLabels();
    toast(t('labelsCleared'));
  });

  $('watchSave').addEventListener('click', async () => {
    state.watch.intervalMinutes = Number($('watchInterval').value);
    state.watch.people = $('watchPeople').value.trim();
    state.watch.notifyJoins = $('watchJoins').checked;
    state.watch.notifyLeaves = $('watchLeaves').checked;
    await chrome.storage.local.set({ waxWatch: state.watch });
    await toWorker('rescheduleWatch');
    renderWatch();
    toast(t('watchSaved'));
  });
  $('watchNow').addEventListener('click', async () => {
    toast(t('watchRunning'));
    const res = await toWorker('runWatchNow');
    await refreshSnapshots();
    toast(res && res.ok ? t('watchRan') : (res && res.error ? res.error.message : t('watchRan')));
  });

  init();
})();
