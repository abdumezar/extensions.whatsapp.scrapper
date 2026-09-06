/*
 * Whatsapp Scrapper by abdumezar — store adapter (runs in the page's MAIN world).
 *
 * Reads WhatsApp Web's in-memory collections and answers requests from the
 * isolated-world content script over window.postMessage. It never mutates
 * state and never calls network-backed store functions (no warmUp*, no
 * QueryExist, no checkPnToLidMapping): everything here is a read of what
 * WhatsApp has already loaded.
 *
 * Verified against WhatsApp Web 2.3000.1046916940 (6 Sep 2026).
 */
(() => {
  'use strict';
  if (window.__waxAdapterLoaded) return;
  window.__waxAdapterLoaded = true;

  const REQ = 'WAX_REQ';
  const RES = 'WAX_RES';
  let boundNonce = null;   // first nonce seen wins; later ones are ignored
  let store = null;        // { ChatCollection, ContactCollection, ApiContact, Me, how }

  // ---------- discovery ----------

  const widStr = (w) => {
    if (!w) return '';
    if (typeof w === 'string') return w;
    if (w._serialized) return w._serialized;
    if (w.user && w.server) return w.user + '@' + w.server;
    return String(w);
  };

  function tryRequire(name) {
    try { return window.require(name); } catch (e) { return undefined; }
  }

  function looksLikeChatCollection(x) {
    if (!x || typeof x.getModelsArray !== 'function') return false;
    const arr = x.getModelsArray();
    if (!Array.isArray(arr)) return false;
    const m = arr[0];
    return !m || (m.id && typeof m.id.server === 'string' && 'groupMetadata' in m);
  }
  function looksLikeContactCollection(x) {
    if (!x || typeof x.getModelsArray !== 'function' || typeof x.get !== 'function') return false;
    const m = x.getModelsArray()[0];
    return !m || (m.id && 'pushname' in m);
  }

  function discoverByName() {
    if (typeof window.require !== 'function') return null;
    const chatMod = tryRequire('WAWebChatCollection');
    const contactMod = tryRequire('WAWebContactCollection');
    const ChatCollection = chatMod && chatMod.ChatCollection;
    const ContactCollection = contactMod && contactMod.ContactCollection;
    if (!looksLikeChatCollection(ChatCollection) || !looksLikeContactCollection(ContactCollection)) return null;
    return {
      how: 'require-by-name',
      ChatCollection,
      ContactCollection,
      ApiContact: tryRequire('WAWebApiContact') || null,
      Me: tryRequire('WAWebUserPrefsMeUser') || null,
    };
  }

  // Plan B: scan the debug modules map by export *shape*, only over names that
  // plausibly hold what we need, so we don't instantiate thousands of modules.
  function discoverByShape() {
    const dbg = tryRequire('__debug');
    const map = dbg && dbg.modulesMap;
    if (!map) return null;
    const names = Object.keys(map).filter((k) => /Chat|Contact|MeUser/i.test(k) && !/\.react$|^rd:|^__require/.test(k));
    let ChatCollection = null, ContactCollection = null, ApiContact = null, Me = null;
    for (const n of names) {
      const mod = tryRequire(n);
      if (!mod || typeof mod !== 'object') continue;
      for (const k of Object.keys(mod)) {
        const v = mod[k];
        if (!ChatCollection && looksLikeChatCollection(v) && v.getModelsArray().length) ChatCollection = v;
        else if (!ContactCollection && looksLikeContactCollection(v) && v.getModelsArray().length) ContactCollection = v;
      }
      if (!ApiContact && typeof mod.getPhoneNumber === 'function' && 'lidPnCache' in mod) ApiContact = mod;
      if (!Me && typeof mod.getMaybeMePnUser === 'function') Me = mod;
      if (ChatCollection && ContactCollection && ApiContact && Me) break;
    }
    if (!ChatCollection || !ContactCollection) return null;
    return { how: 'shape-scan', ChatCollection, ContactCollection, ApiContact, Me };
  }

  // Plan C: classic webpack chunk hijack, then the same shape scan over r.m.
  function discoverByWebpack() {
    const chunk = self.webpackChunkwhatsapp_web_client;
    if (!chunk || typeof chunk.push !== 'function') return null;
    let req = null;
    try { chunk.push([[Symbol('wax')], {}, (r) => { req = r; }]); } catch (e) { return null; }
    if (!req || !req.m) return null;
    let ChatCollection = null, ContactCollection = null, ApiContact = null, Me = null;
    for (const id of Object.keys(req.m)) {
      let mod; try { mod = req(id); } catch (e) { continue; }
      if (!mod || typeof mod !== 'object') continue;
      for (const k of Object.keys(mod)) {
        const v = mod[k];
        if (!ChatCollection && looksLikeChatCollection(v) && v.getModelsArray().length) ChatCollection = v;
        else if (!ContactCollection && looksLikeContactCollection(v) && v.getModelsArray().length) ContactCollection = v;
      }
      if (!ApiContact && typeof mod.getPhoneNumber === 'function' && 'lidPnCache' in mod) ApiContact = mod;
      if (!Me && typeof mod.getMaybeMePnUser === 'function') Me = mod;
      if (ChatCollection && ContactCollection && ApiContact && Me) break;
    }
    if (!ChatCollection || !ContactCollection) return null;
    return { how: 'webpack-scan', ChatCollection, ContactCollection, ApiContact, Me };
  }

  function discover() {
    if (store) return store;
    store = discoverByName() || discoverByShape() || discoverByWebpack() || null;
    return store;
  }

  function selfTest() {
    const s = discover();
    if (!s) return { ok: false, failed: 'discover', message: 'WhatsApp store not found (is WhatsApp still loading?)' };
    const chats = s.ChatCollection.getModelsArray();
    if (!chats.length) return { ok: false, failed: 'chats', message: 'Chat list is empty — wait for WhatsApp to finish loading' };
    const group = chats.find((c) => c.id && c.id.server === 'g.us' && c.groupMetadata);
    if (!group) return { ok: true, warning: 'no-groups', how: s.how, version: version() };
    const parts = group.groupMetadata.participants && group.groupMetadata.participants.getModelsArray();
    if (!parts) return { ok: false, failed: 'participants', message: 'groupMetadata.participants missing — WhatsApp changed its group model' };
    const p = parts[0];
    if (p && !('isAdmin' in p)) return { ok: false, failed: 'isAdmin', message: 'participant.isAdmin missing — WhatsApp changed its participant model' };
    const c = p && (p.contact || s.ContactCollection.get(p.id));
    if (c && !('isAddressBookContact' in c)) return { ok: false, failed: 'isAddressBookContact', message: 'contact.isAddressBookContact missing — WhatsApp changed its contact model' };
    return { ok: true, how: s.how, version: version() };
  }

  function version() {
    try { return (window.Debug && window.Debug.VERSION) || ''; } catch (e) { return ''; }
  }

  // ---------- readers ----------

  function meUsers() {
    const s = discover();
    const out = { pn: '', lid: '' };
    if (!s || !s.Me) return out;
    try { const w = s.Me.getMaybeMePnUser(); out.pn = w ? String(w.user || w) : ''; } catch (e) {}
    try { const w = s.Me.getMaybeMeLidUser(); out.lid = w ? String(w.user || w) : ''; } catch (e) {}
    return out;
  }

  function chatKind(chat) {
    const server = chat.id && chat.id.server;
    if (server === 'g.us') {
      const g = chat.groupMetadata;
      if (g && g.isParentGroup) return 'community';
      if (g && g.parentGroup) return 'subgroup';
      return 'group';
    }
    if (server === 'broadcast') return widStr(chat.id) === 'status@broadcast' ? 'status' : 'broadcast';
    if (server === 'newsletter') return 'channel';
    return 'direct';
  }

  function participantCollection(chat) {
    const g = chat.groupMetadata;
    if (g && g.participants && typeof g.participants.getModelsArray === 'function') return g.participants.getModelsArray();
    // Broadcast lists: structure unverified; try the same shape on the chat itself.
    if (chat.participants && typeof chat.participants.getModelsArray === 'function') return chat.participants.getModelsArray();
    if (Array.isArray(chat.participants)) return chat.participants;
    return null;
  }

  function describeChat(chat) {
    const g = chat.groupMetadata || null;
    const parts = participantCollection(chat);
    return {
      id: widStr(chat.id),
      title: chat.formattedTitle || chat.name || widStr(chat.id),
      kind: chatKind(chat),
      reportedSize: g && typeof g.size === 'number' ? g.size : null,
      participantCount: parts ? parts.length : null,
      isParentGroup: !!(g && g.isParentGroup),
      parentGroup: g && g.parentGroup ? widStr(g.parentGroup) : '',
      isLidAddressingMode: !!(g && g.isLidAddressingMode),
      isDefaultSubgroup: !!(g && g.defaultSubgroup),
      isGeneralSubgroup: !!(g && g.generalSubgroup),
      active: !!chat.active,
    };
  }

  function findChat(id) {
    const s = discover();
    if (!s) return null;
    return s.ChatCollection.getModelsArray().find((c) => widStr(c.id) === id) || null;
  }

  function phoneOf(p, contact) {
    // Order matters: the id itself → the embedded contact's phoneNumber
    // (945/945 in testing) → WAWebApiContact.getPhoneNumber (778/945).
    // Never fall back to the LID digits; they look like a number and aren't one.
    if (p.id && p.id.server === 'c.us' && /^\d{5,17}$/.test(p.id.user)) return { phone: p.id.user, source: 'id' };
    const cp = contact && contact.phoneNumber;
    if (cp && cp.server === 'c.us' && /^\d{5,17}$/.test(cp.user)) return { phone: cp.user, source: 'contact' };
    const s = discover();
    if (s && s.ApiContact && typeof s.ApiContact.getPhoneNumber === 'function') {
      try {
        const w = s.ApiContact.getPhoneNumber(p.id);
        if (w && w.server === 'c.us' && /^\d{5,17}$/.test(w.user)) return { phone: w.user, source: 'api' };
      } catch (e) {}
    }
    return { phone: '', source: '' };
  }

  function participants(chatId) {
    const s = discover();
    if (!s) throw err('NO_STORE', 'WhatsApp store not available');
    const chat = chatId ? findChat(chatId) : s.ChatCollection.getModelsArray().find((c) => c.active);
    if (!chat) throw err(chatId ? 'NOT_FOUND' : 'NO_ACTIVE', chatId ? 'Chat not found' : 'No chat is open');
    const kind = chatKind(chat);
    if (!['group', 'community', 'subgroup', 'broadcast'].includes(kind)) throw err('NOT_GROUP', 'The open chat is not a group, community or broadcast list');
    const list = participantCollection(chat);
    if (!list) throw err('NOT_LOADED', 'Participants for this chat are not loaded yet — open it once in WhatsApp and try again');
    const me = meUsers();
    const rows = [];
    for (const p of list) {
      let contact = null;
      try { contact = p.contact || s.ContactCollection.get(p.id) || null; } catch (e) {}
      const { phone, source } = phoneOf(p, contact);
      const user = p.id ? String(p.id.user || '') : '';
      const isMe = !!(user && (user === me.pn || user === me.lid)) || !!(phone && phone === me.pn);
      rows.push({
        wid: widStr(p.id),
        server: p.id ? p.id.server : '',
        phone,
        phoneSource: source,
        isMyContact: contact ? !!contact.isAddressBookContact : null,
        savedName: contact && contact.name ? String(contact.name) : '',
        pushname: contact && contact.pushname ? String(contact.pushname) : '',
        verifiedName: contact && contact.verifiedName ? String(contact.verifiedName) : '',
        username: contact && contact.username ? String(contact.username) : '',
        isBusiness: contact ? !!(contact.isBusiness || contact.isEnterprise || contact.isSmb) : null,
        isAdmin: !!p.isAdmin,
        isSuperAdmin: !!p.isSuperAdmin,
        joinTime: typeof p.joinTime === 'number' ? p.joinTime : null,
        isMe,
      });
    }
    return { chat: describeChat(chat), rows };
  }

  function listChats() {
    const s = discover();
    if (!s) throw err('NO_STORE', 'WhatsApp store not available');
    return s.ChatCollection.getModelsArray()
      .filter((c) => ['group', 'community', 'subgroup', 'broadcast'].includes(chatKind(c)))
      .map(describeChat);
  }

  function activeChat() {
    const s = discover();
    if (!s) throw err('NO_STORE', 'WhatsApp store not available');
    const chat = s.ChatCollection.getModelsArray().find((c) => c.active);
    return chat ? describeChat(chat) : null;
  }

  function err(code, message) { const e = new Error(message); e.code = code; return e; }

  // ---------- transport ----------

  const handlers = {
    ping: () => ({ loaded: true, selfTest: selfTest(), version: version() }),
    activeChat: () => activeChat(),
    listChats: () => listChats(),
    participants: (args) => participants(args && args.chatId),
  };

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const m = ev.data;
    if (!m || m.type !== REQ || typeof m.nonce !== 'string' || typeof m.id !== 'string') return;
    if (boundNonce === null) boundNonce = m.nonce;
    if (m.nonce !== boundNonce) return;
    const reply = (payload) => window.postMessage(Object.assign({ type: RES, nonce: m.nonce, id: m.id }, payload), window.location.origin);
    const h = handlers[m.cmd];
    if (!h) return reply({ ok: false, error: { code: 'BAD_CMD', message: 'Unknown command ' + m.cmd } });
    try {
      reply({ ok: true, data: h(m.args || {}) });
    } catch (e) {
      reply({ ok: false, error: { code: e.code || 'INTERNAL', message: e.message || String(e) } });
    }
  });
})();
