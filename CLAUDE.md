# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Whatsapp Scrapper by abdumezar" — a Manifest V3 Chrome extension that exports WhatsApp Web group /
community / broadcast participants to CSV. The display name changed after the initial build; internal
identifiers did **not** — the `WAX*` globals, the `waxOptions` storage key, the `WAX_REQ`/`WAX_RES`
message types and the `wa-roster_*.csv` filename prefix are all unchanged, and tests assert the last
one. No build step, no bundler, no package.json — plain ES5-flavoured scripts loaded directly by
`manifest.json`. Edit a file, reload the extension at `chrome://extensions`, reload the WhatsApp tab.
There is no service worker; the popup talks to the content script directly via `chrome.tabs.sendMessage`.

## Tests

```
node test/csv.test.js      # pure-node, requires nothing
node test/phone.test.js    # pure-node, requires nothing
node test/theme.test.js    # pure-node; preload/controller parity, popup.html script order
node test/e2e.js           # loads the extension in Chromium against test/fixtures/mock-whatsapp.html
```

There is no runner and no single-test flag — each file is a standalone `assert` script; to run one
case, comment out the others or run the file. `csv.js` and `phone.js` are dual-mode (UMD-ish IIFE that
exports to `module.exports` *and* to `globalThis`), which is what makes them requireable from node.

`test/e2e.js` needs `playwright` resolvable (install it globally or set `NODE_PATH`) plus a Chromium
channel. It hardcodes POSIX temp paths (`fs.mkdtempSync('/tmp/wax-prof-')`, screenshot at
`/tmp/wax-popup.png` unless `WAX_SHOT` is set), so on Windows it needs `C:\tmp` to exist or those
paths changed. It derives the extension id by scraping `chrome://extensions` shadow DOM.

## Architecture: three worlds, two data paths

Data flows **popup → content script → page adapter**, and the content script picks one of two
sources depending on whether WhatsApp's internals are still recognisable.

1. **`src/page/store-adapter.js` — MAIN world.** The only code that touches WhatsApp's own objects.
   Exposes four commands (`ping`, `activeChat`, `listChats`, `participants`) over `window.postMessage`.
   Discovery is three-tiered and cached in `store`: `require('WAWebChatCollection')` by name →
   shape-scan of `require('__debug').modulesMap` (filtered by name regex so thousands of modules
   aren't instantiated) → webpack chunk hijack. `selfTest()` is the gate; it names the exact probe
   that failed (`isAdmin`, `isAddressBookContact`, …) and that string is what the popup shows.
   **Invariant: read-only.** Never call network-backed store functions (`warmUp*`, `QueryExist`,
   `checkPnToLidMapping`) — everything must be a read of what WhatsApp already loaded, so the
   extension cannot trip anti-abuse checks.

2. **`src/content/content.js` — ISOLATED world.** Bridge + all row shaping. `buildDataset()` is the
   centre of gravity: resolves targets (expanding a community into its announcement sub-group or all
   sub-groups), calls the adapter per chat, maps store rows → output rows, filters self, dedupes,
   sorts. `preview` and `export` are the same pipeline; export just serialises and downloads.

3. **`src/content/dom-fallback.js` + `dom-selectors.js` — ISOLATED world, fallback only.** Used when
   `selfTest()` fails (or the user ticks *Force screen-reading*). Drives the real UI: opens the info
   drawer, clicks *View all*, scrolls the virtualised list, restores the UI afterwards. Output is
   deliberately degraded (numbers only for non-contacts, `is_business` unknown) and always carries a
   warning the popup renders in red. **All selectors live in `dom-selectors.js`** — when WhatsApp
   changes its markup, that file is the only one to touch.

Both content-script paths produce the *same* raw row shape (`wid`, `phone`, `isMyContact`,
`pushname`, `isAdmin`, …), so `toOutputRow()` is shared. Keep that shape in sync across the adapter
and the fallback.

The MAIN↔ISOLATED bridge is nonce-gated: the content script generates a nonce, the adapter binds to
the *first* nonce it sees and ignores all others, so a hostile page script can't impersonate the
popup. Replies are posted to `window.location.origin`, never `*`.

## Conventions that matter

- **Tri-state booleans.** `null` means "unknown" and must serialise to an empty cell, never `false`.
  This is threaded end-to-end: adapter emits `null`, `toOutputRow` preserves it, `cell()` writes `""`,
  the popup renders it as a grey `unknown`.
- **Phone resolution order** (`phoneOf` in the adapter) is deliberate: `p.id.user` when the server is
  `c.us` → the embedded contact's `phoneNumber` → `WAWebApiContact.getPhoneNumber`. Never fall back
  to LID digits — they look like a phone number and are not one. A row with no phone is still kept.
- **CSV safety** (`csv.js`): UTF-8 BOM + CRLF, every cell quoted. `guard()` prefixes formula-leading
  cells with `'` but whitelists `+<digits/spaces/dashes/parens>` so `formatted_phone` survives.
- **Column set** is `BASE_COLUMNS` always plus opted-in `EXTRA_COLUMNS`, in that fixed order.
  Multi-chat exports force `group_name` on. Adding a column means touching `csv.js` (the list),
  `content.js` (`toOutputRow`), and `popup.html` (the extras checkbox).
- Vendored `src/lib/libphonenumber-max.js` is a minified third-party bundle — do not edit or reformat.
- `src/lib/*.js` must stay dependency-free of `chrome.*` so the node tests can require them.

## Popup design system

Material Design 3, on the same token layer as the Nashir extension
(`G:\Private\Tools\extensions\extensions.facebook.auto.post`, seed `#2FA084`):

- `src/styles/tokens.css` — vendored copy of that project's generated token layer. **Do not hand-edit**;
  re-copy it if the source is regenerated. Values are space-separated sRGB channels, so alpha composes
  as `rgb(var(--md-sys-color-on-surface) / 0.38)`.
- `src/assets/fonts/` — self-hosted Roboto (Latin) + IBM Plex Sans Arabic, each face carrying a
  `unicode-range` so a mixed "Ahmed أحمد" cell resolves per character with no JS. No remote origins;
  MV3 CSP would allow the fetch but the extension deliberately has no network dependency.
- `src/popup/theme.js` + `src/popup/theme-preload.js` — the theme preference (`system` | `light` |
  `dark`) lives in `localStorage` under `wax:theme`, **not** `chrome.storage`, because the preload must
  read it synchronously to paint before the first frame. The preload is an external classic script
  because MV3's `script-src 'self'` blocks inline ones — an inline copy silently would not run. It
  necessarily duplicates the key and the resolve rule from `theme.js`; `test/theme.test.js` runs the
  preload source in a stubbed context and asserts the two agree, so change them together.
  `system` is re-resolved on OS changes; an explicit choice is not.
- `src/popup/popup.css` — **no colour literal may appear here** except the two pre-paint `html`
  backgrounds. Everything else is an `--md-sys-color-*` role; that is what makes dark mode a class
  flip with zero duplicated rules. Shape (`--md-sys-shape-*`), elevation, state-layer opacities and
  motion easings/durations likewise come from tokens. Interactive surfaces get the M3 state layer (a
  `currentColor` wash at the spec opacity) rather than a bespoke hover colour.

`node scripts/gen-icons.js` regenerates `icons/*.png` from the primary role — edit the script, not the
PNGs. It uses only node's `zlib`, keeping the repo dependency-free.

Gotcha worth remembering: `SVGElement` does not implement the `hidden` IDL property, so `svg.hidden =
true` sets a dead expando and nothing moves — the theme icons are toggled with
`toggleAttribute('hidden', …)`, which `[hidden]` in `popup.css` actually matches.

The popup's DOM contract is load-bearing for `test/e2e.js`: it asserts on `#status`, `#recon`,
`#previewTable th`, `#exportBtn`, `.tab[data-scope]`, `details.options`, and `.chat-row .t` whose
*first child* must stay the title text node. Restyle freely; do not restructure those.

## WhatsApp version drift

Verified against WhatsApp Web `2.3000.1046916940` (6 Sep 2026); internals get renamed every few
months. When the store breaks, the fix is normally in `store-adapter.js` discovery/`selfTest`; when
the fallback breaks, it is in `dom-selectors.js`. Update the version comment at the top of the file
you change and the "Verified against" line in `README.md`.
