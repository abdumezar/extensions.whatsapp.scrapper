/* Whatsapp Scrapper by abdumezar — DOM fallback (isolated world).
 * Opens the group-info drawer, clicks "View all", scrolls the virtualised member
 * list and reads what WhatsApp renders. Produces a degraded row set: numbers
 * only for non-contacts, no is_business, is_my_contact inferred. */
const WAXDom = (() => {
  'use strict';
  const S = WAX_SELECTORS;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function canRun() { return !!q(S.main); }

  async function waitFor(fn, timeoutMs, everyMs) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) return null;
      await sleep(everyMs || 100);
    }
  }

  function scrollerOf(root) {
    return qa('*', root).find((e) => {
      const cs = getComputedStyle(e);
      return /auto|scroll/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 10;
    }) || null;
  }

  function parseRow(row) {
    const t = q(S.cellTitle, row);
    if (!t) return null;                                   // section header ("A", "أ") — not a member
    const title = t.textContent.trim();
    if (!title) return null;
    const detail = q(S.cellDetail, row);
    const isAdmin = !!(q(S.adminMarker, row) || (detail && S.adminPattern.test(detail.textContent)));
    const r = { wid: '', server: '', phone: '', phoneSource: '', isMyContact: null, savedName: '', pushname: '', verifiedName: '', username: '', isBusiness: null, isAdmin, isSuperAdmin: false, joinTime: null, isMe: false };
    if (S.numberPattern.test(title)) {
      r.phone = title.replace(/\D/g, ''); r.phoneSource = 'dom'; r.isMyContact = false;
    } else if (title.startsWith('~')) {
      r.pushname = title.replace(/^~\s*/, ''); r.isMyContact = false;
    } else if (title.startsWith('@')) {
      r.username = title.slice(1); r.isMyContact = false; // WhatsApp username, no number shown
    } else if (/^you$|^أنت$/i.test(title)) {
      r.isMe = true; r.savedName = title;
    } else {
      r.savedName = title; r.isMyContact = true;
    }
    r.wid = 'dom:' + title;
    return r;
  }

  async function harvest(modal, scroller, onProgress) {
    const seen = new Map();
    const rowsInView = () => {
      const vb = scroller.getBoundingClientRect();
      return qa(S.listItem, modal).filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > vb.top && b.top < vb.bottom; });
    };
    const waitRendered = async () => {
      for (let i = 0; i < 20; i++) {
        const rs = rowsInView();
        if (rs.length >= 2 && rs.some((r) => q(S.cellTitle, r))) return rs;
        await sleep(40);
      }
      return rowsInView();
    };
    const take = (rs) => {
      for (const row of rs) {
        const p = parseRow(row);
        if (!p) continue;
        const key = p.wid + '|' + (q(S.cellSecondary, row) || {}).textContent;
        if (!seen.has(key)) seen.set(key, p);
      }
    };
    scroller.scrollTop = 0;
    await sleep(150);
    let stalls = 0, steps = 0;
    while (steps < 5000 && stalls < 3) {
      take(await waitRendered());
      // A progress callback returning false is how the popup cancels a long
      // scroll: this loop is where a big group spends all of its time.
      if (onProgress && onProgress(seen.size, scroller.scrollTop / Math.max(1, scroller.scrollHeight)) === false) break;
      const before = scroller.scrollTop;
      if (before + scroller.clientHeight >= scroller.scrollHeight - 2) break;
      scroller.scrollTop = before + scroller.clientHeight - 80;
      await sleep(20);
      stalls = scroller.scrollTop === before ? stalls + 1 : 0;
      steps++;
    }
    take(await waitRendered());
    scroller.scrollTop = 0;
    return Array.from(seen.values());
  }

  /** Scrape the currently open group through the UI. Restores the UI afterwards. */
  async function scrapeActiveChat(onProgress) {
    const warnings = [{ code: 'domMode' }];
    if (!canRun()) throw Object.assign(new Error('No chat is open'), { code: 'NO_ACTIVE' });
    const titleEl = q('#main header [data-testid="conversation-info-header-chat-title"]') || q('#main header span[title]');
    const title = titleEl ? titleEl.textContent.trim() : 'chat';

    let drawer = q(S.drawer);
    const openedDrawer = !drawer;
    if (!drawer) {
      const btn = q(S.headerButton);
      if (!btn) throw Object.assign(new Error('Could not find the chat header button (WhatsApp layout changed?)'), { code: 'DOM_HEADER' });
      btn.click();
      drawer = await waitFor(() => q(S.drawer), 4000);
      if (!drawer) throw Object.assign(new Error('Group info panel did not open'), { code: 'DOM_DRAWER' });
    }
    const section = await waitFor(() => q(S.participantsSection, drawer), 4000);
    if (!section) throw Object.assign(new Error('This chat has no member list (not a group?)'), { code: 'NOT_GROUP' });
    const m = (drawer.textContent || '').match(S.memberCountPattern);
    const reported = m ? parseInt(m[1].replace(/[,.]/g, ''), 10) : null;

    let modal = null, rows;
    const viewAll = qa('[role="button"]', section).find((e) => S.viewAllPattern.test(e.textContent));
    if (viewAll) {
      viewAll.click();
      modal = await waitFor(() => q(S.contactsModal), 4000);
      if (!modal) throw Object.assign(new Error('Member list did not open'), { code: 'DOM_MODAL' });
      const scroller = await waitFor(() => scrollerOf(modal), 3000);
      if (!scroller) throw Object.assign(new Error('Member list is not scrollable (WhatsApp layout changed?)'), { code: 'DOM_SCROLLER' });
      rows = await harvest(modal, scroller, onProgress);
    } else {
      rows = qa(S.listItem, section).map(parseRow).filter(Boolean);   // small group: all rows already shown
    }

    // Restore the UI.
    try {
      if (modal) {
        const c = q(S.modalCloseButton); if (c) c.click();
        await sleep(150);
        if (q(S.contactsModal)) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      }
      await sleep(150);
      if (openedDrawer) { const c = q(S.drawerCloseButton); if (c) c.click(); }
    } catch (e) {}

    if (reported && rows.length < reported) warnings.push({ code: 'domPartial', got: rows.length, reported });
    return {
      chat: { id: 'dom:' + title, title, kind: 'group', reportedSize: reported, participantCount: rows.length, isParentGroup: false, parentGroup: '', isLidAddressingMode: null, active: true },
      rows, warnings,
    };
  }

  return { canRun, scrapeActiveChat };
})();
