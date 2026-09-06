/*
 * Whatsapp Scrapper by abdumezar — analysis over rows already read (dashboard + node tests).
 *
 * Everything here is a pure function over output rows (the shape toOutputRow
 * produces). No WhatsApp calls, no storage, no DOM — which is what makes the
 * whole dashboard testable in node and keeps the read-only invariant intact:
 * these answers come out of data the export already had.
 */
(function (root) {
  'use strict';

  /** Identity of a member across chats: the number when there is one, else the wid. */
  const keyOf = (r) => (r.phone_number ? 'p:' + r.phone_number : 'w:' + (r.wid || ''));

  const nameOf = (r) => r.saved_name || r.public_name || r.formatted_phone || r.phone_number || '';

  /** Counts and distributions for one row set. */
  function summarize(rows) {
    const countries = new Map();
    const months = new Map();
    const chats = new Set();
    const seen = new Map();          // key -> how many chats it appears in
    let withPhone = 0, valid = 0, invalid = 0, saved = 0, business = 0, admins = 0, lidOnly = 0, named = 0;

    for (const r of rows) {
      if (r.phone_number) {
        withPhone++;
        if (r.is_valid_number === true) valid++;
        else if (r.is_valid_number === false) invalid++;
      } else if ((r.wid || '').includes('@lid')) lidOnly++;
      if (r.is_my_contact === true) saved++;
      if (r.is_business === true) business++;
      if (r.is_admin === true) admins++;
      if (r.saved_name || r.public_name) named++;

      const cc = r.country_code || '';
      if (cc) {
        const c = countries.get(cc) || { code: cc, iso: r.country_iso || '', name: r.country_name || '', n: 0 };
        c.n++;
        if (!c.name && r.country_name) c.name = r.country_name;
        if (!c.iso && r.country_iso) c.iso = r.country_iso;
        countries.set(cc, c);
      }

      // joined_at is an ISO string; the month is the first 7 characters.
      if (r.joined_at) {
        const m = String(r.joined_at).slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(m)) months.set(m, (months.get(m) || 0) + 1);
      }

      if (r.group_id) chats.add(r.group_id);
      const k = keyOf(r);
      const prev = seen.get(k);
      if (prev) prev.add(r.group_id || '');
      else seen.set(k, new Set([r.group_id || '']));
    }

    let inMultipleChats = 0;
    for (const groups of seen.values()) if (groups.size > 1) inMultipleChats++;

    return {
      total: rows.length,
      withPhone,
      noPhone: rows.length - withPhone,
      valid,
      invalid,
      saved,
      business,
      admins,
      lidOnly,
      unnamed: rows.length - named,
      chats: chats.size,
      people: seen.size,
      inMultipleChats,
      countries: [...countries.values()].sort((a, b) => b.n - a.n || a.code.localeCompare(b.code)),
      months: [...months.entries()].map(([month, n]) => ({ month, n })).sort((a, b) => a.month.localeCompare(b.month)),
    };
  }

  /**
   * Collapses a long tail into one "Other" slice, because a categorical scale
   * only has so many usable steps and a 60-country bar chart is unreadable.
   * @returns {{head: Array, other: {n: number, countries: number}|null}}
   */
  function topN(items, n) {
    if (items.length <= n) return { head: items, other: null };
    const head = items.slice(0, n);
    const tail = items.slice(n);
    return { head, other: { n: tail.reduce((a, c) => a + c.n, 0), countries: tail.length } };
  }

  /** @param {Array<{id,title,keys:Iterable<string>}>} groups */
  function overlap(groups) {
    const sets = groups.map((g) => ({ id: g.id, title: g.title, set: new Set(g.keys) }));
    const pairs = [];
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const a = sets[i], b = sets[j];
        let shared = 0;
        // Walk the smaller set — an overlap of a 20k-member community with a
        // 30-member group should cost 30 lookups, not 20,000.
        const [small, big] = a.set.size <= b.set.size ? [a.set, b.set] : [b.set, a.set];
        for (const k of small) if (big.has(k)) shared++;
        const union = a.set.size + b.set.size - shared;
        pairs.push({
          a: a.id, b: b.id, aTitle: a.title, bTitle: b.title,
          shared, onlyA: a.set.size - shared, onlyB: b.set.size - shared,
          jaccard: union ? shared / union : 0,
        });
      }
    }
    let everywhere = null;
    if (sets.length > 1) {
      const smallest = sets.reduce((m, s) => (s.set.size < m.set.size ? s : m), sets[0]);
      everywhere = 0;
      for (const k of smallest.set) if (sets.every((s) => s.set.has(k))) everywhere++;
    }
    const union = new Set();
    for (const s of sets) for (const k of s.set) union.add(k);
    return { sets: sets.map((s) => ({ id: s.id, title: s.title, size: s.set.size })), pairs, everywhere, union: union.size };
  }

  /** Members of `a` that are not in any of `others`. */
  function onlyIn(a, others) {
    const exclude = new Set();
    for (const o of others) for (const k of o) exclude.add(k);
    return [...new Set(a)].filter((k) => !exclude.has(k));
  }

  /**
   * What is wrong with this list, as buckets you can act on. Each bucket keeps
   * its rows so the dashboard can show and export them.
   */
  function quality(rows) {
    const byKey = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(r);
    }
    const duplicates = [];
    for (const [, group] of byKey) {
      if (group.length > 1) duplicates.push(group[0]);
    }
    const buckets = [
      { code: 'noNumber', rows: rows.filter((r) => !r.phone_number) },
      { code: 'invalidNumber', rows: rows.filter((r) => r.phone_number && r.is_valid_number === false) },
      { code: 'unnamed', rows: rows.filter((r) => !r.saved_name && !r.public_name) },
      { code: 'duplicated', rows: duplicates },
    ];
    return {
      total: rows.length,
      usable: rows.filter((r) => r.phone_number && r.is_valid_number !== false).length,
      buckets: buckets.map((b) => ({ code: b.code, n: b.rows.length, rows: b.rows })),
    };
  }

  /** Digits only, so "+20 100 123 45 67" and "0020-1001234567" are one number. */
  function normalizeNumber(s) {
    const d = String(s == null ? '' : s).replace(/\D/g, '');
    if (!d) return '';
    return d.replace(/^0+/, '');   // a leading 00 international prefix, or a stray 0
  }

  /**
   * Which of these numbers are already in the group?
   * @param {string} text  pasted numbers, one per line or comma separated
   */
  function matchList(text, rows) {
    const byNumber = new Map();
    for (const r of rows) if (r.phone_number) byNumber.set(r.phone_number, r);

    const seen = new Set();
    const matched = [];
    const missing = [];
    let blank = 0;
    // Split on line breaks, commas, semicolons and tabs — never on spaces: a
    // pasted number is far more likely to contain spaces ("+20 100 123 4567")
    // than a line is to hold two numbers separated by one.
    for (const raw of String(text || '').split(/[\n\r,;\t]+/)) {
      if (!raw.trim()) continue;
      const n = normalizeNumber(raw);
      if (!n) { blank++; continue; }
      if (seen.has(n)) continue;
      seen.add(n);
      const hit = byNumber.get(n);
      if (hit) matched.push({ input: raw.trim(), number: n, row: hit });
      else missing.push({ input: raw.trim(), number: n });
    }
    return { matched, missing, unreadable: blank, checked: seen.size };
  }

  /**
   * Turns a chat's snapshot history into a series the timeline can draw.
   * Entries are {at, size, joined, left}; the first has no change to report.
   */
  function timeline(history) {
    const points = (history || []).map((h) => ({
      at: h.at,
      size: h.size || 0,
      joined: h.joined || 0,
      left: h.left || 0,
    }));
    const totals = points.reduce((a, p) => ({ joined: a.joined + p.joined, left: a.left + p.left }), { joined: 0, left: 0 });
    return {
      points,
      totals,
      net: totals.joined - totals.left,
      first: points[0] || null,
      last: points[points.length - 1] || null,
      peak: points.reduce((m, p) => Math.max(m, p.joined, p.left), 0),
    };
  }

  /** Communities and their sub-groups, as a tree the dashboard can render. */
  function communityTree(chats) {
    const byId = new Map(chats.map((c) => [c.id, c]));
    const children = new Map();
    const roots = [];
    for (const c of chats) {
      if (c.kind === 'subgroup' && c.parentGroup && byId.has(c.parentGroup)) {
        if (!children.has(c.parentGroup)) children.set(c.parentGroup, []);
        children.get(c.parentGroup).push(c);
      } else if (c.kind !== 'subgroup') roots.push(c);
    }
    // A sub-group whose parent was never loaded would otherwise vanish.
    const orphans = chats.filter((c) => c.kind === 'subgroup' && (!c.parentGroup || !byId.has(c.parentGroup)));
    const sort = (a, b) => (b.participantCount || 0) - (a.participantCount || 0) || a.title.localeCompare(b.title);
    return {
      roots: roots.sort(sort).map((c) => ({
        chat: c,
        children: (children.get(c.id) || []).sort(sort),
        reach: (children.get(c.id) || []).reduce((a, s) => a + (s.participantCount || 0), 0),
      })),
      orphans: orphans.sort(sort),
    };
  }

  const api = { keyOf, nameOf, summarize, topN, overlap, onlyIn, quality, matchList, normalizeNumber, timeline, communityTree };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WAXAnalytics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
