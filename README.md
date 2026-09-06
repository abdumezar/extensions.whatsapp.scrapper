# Whatsapp Scrapper by abdumezar

Chrome extension (Manifest V3) that exports the participants of the WhatsApp Web group,
community or broadcast list you have open as a CSV. Everything runs inside your browser;
nothing is uploaded anywhere.

## Install (unpacked)

1. Open `chrome://extensions`, turn on **Developer mode** (top right).
2. **Load unpacked** → choose this folder.
3. Open <https://web.whatsapp.com>, open a group, click the extension icon.

If the popup says *Not connected*, reload the WhatsApp tab once (the content script is injected on page load).

## Use

- **This chat** — exports whatever chat is open. The popup shows a preview and a reconciliation line
  (`945 members per WhatsApp · 944 rows · 944 with phone · …`). Your own row is excluded unless you tick *Include my own row*.
- **Pick chats** — tick any number of groups; communities are listed with their sub-groups indented.
  Multi-chat exports are deduplicated by phone number and get a `group_name` column automatically.
- **Communities** — *Announcement group* exports the full membership (that is where WhatsApp keeps it);
  *Every sub-group* unions all sub-groups and dedupes.
- **Options → Extra columns** — `group_name`, `group_id`, `role` (member/admin/superadmin), `username`, `wid`, `joined_at`.

## Columns

| column | meaning |
|---|---|
| `country_code` | calling code, digits only |
| `country_name` | region name (English or Arabic, see Options) |
| `phone_number` | E.164 digits without `+` |
| `formatted_phone` | international format with `+` and spaces |
| `is_my_contact` | saved in your phone's address book |
| `saved_name` | the name you saved |
| `public_name` | their WhatsApp profile name (falls back to a business's verified name) |
| `is_business` | WhatsApp Business account |
| `is_admin` | admin or group creator |

Booleans are `true`/`false`; an unknown value is an empty cell, never `false`.

## Opening the CSV in Excel

Excel turns a bare 12-digit `phone_number` into `2.01E+11` when you double-click a CSV. Either use
**Data → From Text/CSV** and set the column to *Text*, or rely on `formatted_phone`, which keeps its `+`
and survives. Google Sheets and Numbers open the file correctly as is. The file is UTF-8 with a BOM, so
Arabic names display correctly.

## How it works

- `src/page/store-adapter.js` runs in the page's main world and reads WhatsApp's in-memory collections
  (`WAWebChatCollection`, `WAWebContactCollection`, …) by name, falling back to a shape scan of
  `require('__debug').modulesMap`, then to the webpack chunk. It only reads what WhatsApp already
  loaded; it never calls network-backed functions, so it cannot trigger anti-abuse checks.
- `src/content/content.js` (isolated world) bridges the popup and the page, parses phone numbers with
  a vendored `libphonenumber-js` (max metadata), builds the CSV and triggers the download.
- `src/content/dom-fallback.js` is used only if the store self-test fails after a WhatsApp update: it opens
  the group-info panel, clicks *View all* and scrolls the member list. Degraded output (numbers only for
  non-contacts, no `is_business`); the popup says so in red.

Verified against WhatsApp Web `2.3000.1046916940` (6 Sep 2026). WhatsApp renames internals every few
months; when that happens the popup names the failed probe (e.g. `isAddressBookContact missing`) and
`src/content/dom-selectors.js` holds every selector the fallback uses.

## Design

The popup follows the Material Design 3 system shared with the Nashir extension: the token layer in
`src/styles/tokens.css` (seed `#2FA084`, colour roles derived in HCT space) and the self-hosted
Roboto + IBM Plex Sans Arabic faces in `src/assets/fonts/`. No stylesheet hardcodes a colour — every
value resolves to an `--md-sys-color-*` role, so dark mode is one class on `<html>`. Shape, elevation,
state-layer opacities and motion easings come from the same tokens. Nothing is fetched from a remote
origin.

The icon button in the top bar cycles **follow system → light → dark → follow system**. The choice is
kept in `localStorage` under `wax:theme` and painted before the first frame by
`src/popup/theme-preload.js`, so reopening the popup never flashes the wrong scheme. While the mode is
*follow system*, flipping the OS theme repaints the popup live; an explicit light or dark choice
survives the OS changing underneath it.

The toolbar icons are generated in the primary role by `node scripts/gen-icons.js` — edit that script,
not `icons/*.png`.

## Tests

```
node test/csv.test.js
node test/phone.test.js
node test/theme.test.js
node test/e2e.js        # loads the extension in Chromium against a mocked WhatsApp page
```

## Privacy and terms

A participant list is personal data. Use this for groups you administer or belong to, for your own
records. WhatsApp's terms prohibit automated collection of user data; you are responsible for how you
use the export. The extension keeps no history, sends no telemetry and has no network access beyond
what the WhatsApp tab already has.
