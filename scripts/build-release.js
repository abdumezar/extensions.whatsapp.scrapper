/*
 * Packs the loadable extension into dist/<name>-<version>.zip.
 *
 *   node scripts/build-release.js
 *
 * Only what Chrome needs to run the extension goes in, plus the README and the
 * licence: no tests, no scripts, no screenshots, no repo metadata. The result
 * is what "Load unpacked" wants after unzipping, and what the Chrome Web Store
 * would want uploaded.
 *
 * Deflate comes from node's own zlib, so this stays dependency-free like the
 * rest of the repo. (src/lib/xlsx.js hand-rolls a *stored* zip only because a
 * browser has no synchronous deflate; here we do.)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Everything the extension needs at runtime, plus the two documents a
// redistributed copy must carry.
const INCLUDE = ['manifest.json', 'README.md', 'LICENSE.md', 'icons', 'src'];

/* ------------------------------------------------------------------ crc32 -- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* -------------------------------------------------------------------- zip -- */

// Fixed DOS timestamp, so the same tree always packs to a byte-identical zip.
const DOS_TIME = 0;      // 00:00:00
const DOS_DATE = 0x2181; // 2000-01-01

function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    // A tiny file can deflate larger than it started; fall back to stored.
    const stored = deflated.length >= e.data.length;
    const body = stored ? e.data : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(e.data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);          // version needed
    lh.writeUInt16LE(0x0800, 6);      // UTF-8 names
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);          // version made by
    ch.writeUInt16LE(20, 6);          // version needed
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);          // extra
    ch.writeUInt16LE(0, 32);          // comment
    ch.writeUInt16LE(0, 34);          // disk
    ch.writeUInt16LE(0, 36);          // internal attrs
    // External attrs: regular file, 0644. `<<` yields a signed int32 here, so
    // coerce back to unsigned before writing.
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);

    offset += lh.length + name.length + body.length;
  }

  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/* ------------------------------------------------------------------- walk -- */

function walk(rel, out) {
  const abs = path.join(ROOT, rel);
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    for (const child of fs.readdirSync(abs).sort()) walk(path.posix.join(rel, child), out);
  } else {
    out.push({ name: rel, data: fs.readFileSync(abs) });
  }
  return out;
}

/* ------------------------------------------------------------------- main -- */

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const slug = 'whatsapp-scrapper';
const version = manifest.version;

const entries = [];
for (const item of INCLUDE) {
  if (!fs.existsSync(path.join(ROOT, item))) throw new Error('missing: ' + item);
  walk(item, entries);
}

// Guard against shipping something the manifest never loads: every content
// script and page listed in the manifest must be in the archive.
const packed = new Set(entries.map((e) => e.name));
const referenced = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page]
  .concat(manifest.content_scripts.flatMap((c) => c.js))
  .concat(Object.values(manifest.icons));
for (const ref of referenced) {
  if (!packed.has(ref)) throw new Error('manifest references a file that is not packed: ' + ref);
}

fs.mkdirSync(DIST, { recursive: true });
const outFile = path.join(DIST, `${slug}-${version}.zip`);
const buf = zip(entries);
fs.writeFileSync(outFile, buf);

console.log(`${path.relative(ROOT, outFile)}  ${entries.length} files, ${(buf.length / 1024).toFixed(0)} KB`);
