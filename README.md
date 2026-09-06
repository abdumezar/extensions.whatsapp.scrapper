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
- **Pick chats** — tick any number of groups, or use *Select all* to take everything the filter box is showing;
  communities are listed with their sub-groups indented. The selection is remembered between sessions.
  Multi-chat exports are deduplicated by phone number and get a `group_name` column automatically.
- **Communities** — *Announcement group* exports the full membership (that is where WhatsApp keeps it);
  *Every sub-group* unions all sub-groups and dedupes.
- **Options → Extra columns** — `group_name`, `group_id`, `role` (member/admin/superadmin), `username`, `wid`,
  `joined_at`, `country_iso`, `is_valid_number`.
- **Options → Only include** — admins, saved contacts, business accounts, rows that have a number, or a list of
  country codes (`20, 966`). The reconciliation line says how many rows the filters dropped.
- **Formats** — `CSV`, `Excel (.xlsx)` or `Contacts (.vcf)`. The workbook writes every cell as text, so a phone
  number cannot come back as `2.01E+11`; the vCard imports straight into a phone address book and skips rows
  with no number.
- **Copy** — puts the same table on the clipboard as TSV. Pasting into Sheets or Excel keeps every column as
  text, with no import dialog.
- **Joined / left** — each export records which members it saw, so the next preview shows
  `+12 joined · −3 left since 6 Sep`. *Only people who joined since the last export* exports just the newcomers.
  Only member keys are stored, never names. *Options → Reset the joined/left baseline* clears them.
- **Language** — the globe button switches the popup and the dashboard between English and Arabic (right-to-left).
- **Presets** — save a set of options under a name and re-apply it in one click.
- **Shortcuts** — Ctrl+Shift+E exports the open chat without opening the popup; Ctrl+Shift+D opens the
  dashboard. Both are also on the right-click menu of a WhatsApp tab, and both can be rebound at
  `chrome://extensions/shortcuts`.

## The dashboard

The grid button in the popup (or Ctrl+Shift+D) opens a full-tab dashboard. It reads through the same
WhatsApp tab the popup does — nothing here makes WhatsApp do anything the export does not already do.

- **Overview** — headline counts plus where the members are and when they joined.
- **Overlap** — pick several chats and see how many people they share, who is in every one of them, and
  export the people who are *only* in the first.
- **Quality** — what is wrong with the list: no number, a number that fails validation, no name at all,
  the same person twice. Each bucket exports on its own.
- **Communities** — the community tree with sub-group sizes, plus sub-groups whose community is not loaded.
- **Timeline** — joins and leaves per export or automatic check, with the running membership.
- **Match a list** — paste numbers and see which are already members. Nothing is sent anywhere.
- **Labels** — import a CSV of `phone,label,notes`; every later export carries the matching `label` and
  `notes` columns. The table lives in this browser only.
- **Alerts** — watch chats and get a desktop notification when someone joins or leaves, optionally naming
  specific numbers. Checks run in the background while a WhatsApp tab is open; with no tab open, nothing
  happens until there is one.

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
| `country_iso` | ISO 3166-1 alpha-2 region (extra column) |
| `is_valid_number` | the number passes libphonenumber's validity check (extra column) |

Booleans are `true`/`false`; an unknown value is an empty cell, never `false`.

## Opening the export in Excel

Pick **Excel (.xlsx)** and the problem disappears: every cell in the workbook is written as text, so a
bare 12-digit `phone_number` stays what it is. **Copy** does the same for a paste into Sheets or Excel.

With CSV, Excel turns `201001234567` into `2.01E+11` on a double-click. Either use **Data → From
Text/CSV** and set the column to *Text*, or rely on `formatted_phone`, which keeps its `+` and survives.
Google Sheets and Numbers open the file correctly as is. The file is UTF-8 with a BOM, so Arabic names
display correctly.

## How it works

- `src/page/store-adapter.js` runs in the page's main world and reads WhatsApp's in-memory collections
  (`WAWebChatCollection`, `WAWebContactCollection`, …) by name, falling back to a shape scan of
  `require('__debug').modulesMap`, then to the webpack chunk. It only reads what WhatsApp already
  loaded; it never calls network-backed functions, so it cannot trigger anti-abuse checks.
- `src/content/content.js` (isolated world) bridges the popup and the page, parses phone numbers with
  a vendored `libphonenumber-js` (max metadata), applies the filters, diffs against the last export and
  hands the rows to one of the writers in `src/lib/` — `csv.js`, `xlsx.js` (a minimal zip + SpreadsheetML
  writer, no dependencies) or `vcard.js` — before triggering the download.
- `src/background/service-worker.js` exists only for what a closed popup cannot do: the keyboard
  shortcuts, the context menu, and the alarm behind the alerts. It never touches WhatsApp itself —
  every read goes through the content script, so a watch check is the same read an export is.
- `src/dashboard/` is a normal extension page that asks the same content script for full rows, and
  `src/lib/analytics.js` turns them into the overlap, quality and timeline answers. Every number on
  that page is computed locally from rows the exporter already had.
- `src/content/dom-fallback.js` is used only if the store self-test fails after a WhatsApp update: it opens
  the group-info panel, clicks *View all* and scrolls the member list. Degraded output (numbers only for
  non-contacts, no `is_business`); the popup says so in red.

Verified against WhatsApp Web `2.3000.1046916940` (6 Sep 2026). WhatsApp renames internals every few
months; when that happens the popup names the failed probe (e.g. `isAddressBookContact missing`) and
`src/content/dom-selectors.js` holds every selector the fallback uses. A build other than the verified one
is called out in the popup, and **Options → Copy diagnostics** puts the store state, the discovery route and
the failed probe on the clipboard as a bug report.

## Design

The popup follows the Material Design 3 system shared with the Nashir extension: the token layer in
`src/styles/tokens.css` (seed `#2FA084`, colour roles derived in HCT space) and the self-hosted
Roboto + IBM Plex Sans Arabic faces in `src/assets/fonts/`. No stylesheet hardcodes a colour — every
value resolves to an `--md-sys-color-*` role, so dark mode is one class on `<html>`. Shape, elevation,
state-layer opacities and motion easings come from the same tokens. Nothing is fetched from a remote
origin.

The popup is fully bilingual: `src/popup/i18n.js` holds both dictionaries, and the language — like the
theme — is a `localStorage` preference applied before the first paint, because an RTL flip after paint is
worse than a colour flash. Warnings raised in the content script travel as codes and become sentences only
in the popup, so both languages describe them.

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
node test/format.test.js
node test/i18n.test.js
node test/analytics.test.js
node test/e2e.js        # loads the extension in Chromium against a mocked WhatsApp page
```

## Privacy and terms

A participant list is personal data. Use this for groups you administer or belong to, for your own
records. WhatsApp's terms prohibit automated collection of user data; you are responsible for how you
use the export. The extension keeps no history, sends no telemetry and has no network access beyond
what the WhatsApp tab already has.
