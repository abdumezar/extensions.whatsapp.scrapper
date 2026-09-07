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
node test/format.test.js   # pure-node; TSV, xlsx (walked as a real zip) and vCard
node test/i18n.test.js     # pure-node; en/ar parity, warning codes, keys used by the markup
node test/analytics.test.js # pure-node; the dashboard maths and the CSV reader
node test/e2e.js           # loads the extension in Chromium against test/fixtures/mock-whatsapp.html
```

There is no runner and no single-test flag — each file is a standalone `assert` script; to run one
case, comment out the others or run the file. `csv.js` and `phone.js` are dual-mode (UMD-ish IIFE that
exports to `module.exports` *and* to `globalThis`), which is what makes them requireable from node.

`test/e2e.js` needs `playwright` resolvable (install it globally or set `NODE_PATH`) plus a Chromium
channel. Its profile and default screenshot go under `os.tmpdir()` — never a bare `/tmp`, which on
Windows resolves against whichever drive the repo sits on. It derives the extension id by scraping
`chrome://extensions` shadow DOM.

Two scripts share that harness and are not tests:

```
node scripts/screenshots.js    # regenerates docs/screenshots/ for the README
node scripts/build-release.js  # packs dist/whatsapp-scrapper-<version>.zip
```

`scripts/screenshots.js` drives the popup and the dashboard against `scripts/demo-whatsapp.html`, a
demo store with the same shape as the test fixture but seeded and realistic, so the shots are
deterministic and presentable. `scripts/build-release.js` is dependency-free (node `zlib`), packs only
`manifest.json`, `README.md`, `LICENSE.md`, `icons/` and `src/`, and fails if the manifest references a
file it did not pack. `dist/` is gitignored — release archives are attached to the GitHub release, never
committed.

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

`buildDataset` runs in a fixed order and the order is load-bearing: map rows → diff against the stored
snapshot (before filtering, because "who is in this group" is a fact about the group, not about the current
filter settings) → drop self → apply `changesOnly` → apply filters → dedupe → sort. Writers live in
`src/lib/` (`csv.js`, `xlsx.js`, `vcard.js`) and are chosen by `opts.format`; all three are
dependency-free, and `xlsx.js` hand-rolls a stored (uncompressed) ZIP because a browser has no synchronous
deflate.

Both content-script paths produce the *same* raw row shape (`wid`, `phone`, `isMyContact`,
`pushname`, `isAdmin`, …), so `toOutputRow()` is shared. Keep that shape in sync across the adapter
and the fallback.

The MAIN↔ISOLATED bridge is nonce-gated: the content script generates a nonce, the adapter binds to
the *first* nonce it sees and ignores all others, so a hostile page script can't impersonate the
popup. Replies are posted to `window.location.origin`, never `*`.

## Four execution contexts, one read path

Beyond the three worlds above there is now a service worker and a dashboard page, and **neither may read
WhatsApp directly**:

- **`src/background/service-worker.js`** — keyboard commands, the context menu, and the `chrome.alarms`
  watch behind the alerts. MV3 kills it between events, so nothing is cached in module scope; state lives
  in `chrome.storage`. It reads only by sending `dataset` to the content script in a WhatsApp tab, so the
  read-only invariant holds transitively, and a check simply does not run when no WhatsApp tab is open.
- **`src/dashboard/`** — a normal extension page. It cannot download a file either (it is not a tab the
  user is looking at), so it builds the text and hands it to the content script's `saveFile` command.
  `src/lib/analytics.js` holds every calculation as pure functions over output rows, which is what makes
  the whole dashboard testable in node.

Chart colour on the dashboard is not a matter of taste. The joins/leaves pair is the only categorical
palette in the project and was validated with the dataviz skill's script in both modes (`--pairs all`);
everything else encodes magnitude and is therefore one hue at varying alpha. The values and the reasoning
are in a comment at the top of `dashboard.css` — re-run the validator if they change.

## State that outlives the popup

- `chrome.storage.local`: `waxOptions` (all options bar the scope), `waxSelection` (picked chat ids),
  `waxSnapshots` (`{[chatId]: {at, keys}}` — the membership baseline the joined/left line is measured
  against, written on export only, never on preview, or a preview would destroy the baseline it is
  reporting). A snapshot stores only member *keys* (`p:<phone>` or `w:<wid>`), never names.
- `chrome.storage.local` also holds `waxLabels` (the user's own imported CSV, joined onto rows by number —
  nothing in it comes from WhatsApp), `waxPresets` (named option sets) and `waxWatch` (which chats the
  alarm checks). Snapshots grew a `history` array, capped at 60 points per chat, which is what the
  timeline draws.
- `localStorage` on the popup origin: `wax:theme` and `wax:lang`. Both must be synchronous because
  `theme-preload.js` reads them before the first paint; that is the whole reason they are not in
  `chrome.storage`.

## Long jobs

The popup and content script share one job at a time. The content script posts `WAX_PROGRESS` runtime
messages between chats and while the DOM fallback scrolls; `cancel` sets a flag that is checked between
chats and returned as `false` from the fallback's `onProgress`, which is the only place a big group
actually spends time. In the popup, `setResult(text, cls, isProgress)` distinguishes progress chatter from
an outcome, so a background preview cannot wipe the "Saved …" line.

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
- **Warnings are codes, not sentences.** The content script emits `{code, …params}`; `i18n.js` turns them
  into text in the chosen language. `test/i18n.test.js` fails if a code has no sentence in both languages,
  or if a sentence exists for a code nothing emits.
- **The popup is bilingual and RTL-capable.** Static text carries `data-i18n`; anything whose text is
  *state* (the status pill, the open-chat meta line, the reconciliation line) must be repainted by hand in
  the language-switch handler, because `WAXI18n.apply()` resets every `data-i18n` node to its markup key.
  Layout needs no RTL rules: every inset in `popup.css` is already a logical property.
- Vendored `src/lib/libphonenumber-max.js` is a minified third-party bundle — do not edit or reformat.
- **Licence.** The repo is public under the PolyForm Noncommercial License 1.0.0 (`LICENSE.md`). It is
  source-available, not OSI open source, so GitHub labels it "Other" — that is expected, not a
  misconfiguration. Vendored files keep their own, more permissive licences; the list at the bottom of
  `LICENSE.md` must stay true if anything is added to `src/lib/`, `src/styles/` or `src/assets/`.
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
