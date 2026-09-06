/*
 * Icon generator — GENERATED OUTPUT, do not edit icons/*.png by hand.
 *
 *   node scripts/gen-icons.js
 *
 * Draws the roster glyph (three bullets, three bars) on a rounded square in the
 * M3 light-scheme primary role, so the toolbar icon carries the same brand
 * colour as the popup. The value is copied from src/styles/tokens.css
 * (--md-sys-color-primary, light) rather than re-picked by eye; if the token
 * layer is regenerated from a new seed, update PRIMARY and re-run.
 *
 * Written against node's built-in zlib only — the extension has no dependencies
 * and this script does not add one. Coverage is 4x4 supersampled per pixel,
 * which is what keeps the 16px icon's curves from stair-stepping.
 */
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const PRIMARY = [17, 107, 86];      // --md-sys-color-primary (light)
const ON_PRIMARY = [255, 255, 255]; // --md-sys-color-on-primary (light)
const SS = 4;                       // supersampling factor per axis

// ---- geometry, in unit space (0..1 of the icon box) ----------------------
const SQUARE_RADIUS = 0.22;
const ROWS = [0.305, 0.5, 0.695];
const DOT_CX = 0.235;
const DOT_R = 0.062;
const BAR_X0 = 0.36;
const BAR_X1 = 0.795;
const BAR_H = 0.08;

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** @returns {0|1|2} 0 = outside, 1 = square, 2 = glyph */
function sample(x, y) {
  if (!inRoundRect(x, y, 0, 0, 1, 1, SQUARE_RADIUS)) return 0;
  for (const cy of ROWS) {
    if (inCircle(x, y, DOT_CX, cy, DOT_R)) return 2;
    if (inRoundRect(x, y, BAR_X0, cy - BAR_H / 2, BAR_X1, cy + BAR_H / 2, BAR_H / 2)) return 2;
  }
  return 1;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let square = 0, glyph = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const v = sample((pxi + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          if (v === 1) square++;
          else if (v === 2) glyph++;
        }
      }
      const total = SS * SS;
      const alpha = (square + glyph) / total;
      const o = (py * size + pxi) * 4;
      if (alpha === 0) continue;
      // Composite the glyph over the square, then premultiply nothing — PNG is
      // straight alpha, so the colour is the coverage-weighted mix of the two.
      const gf = glyph / (square + glyph);
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(PRIMARY[c] * (1 - gf) + ON_PRIMARY[c] * gf);
      px[o + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

// ---- minimal PNG writer --------------------------------------------------
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
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  // 10..12: deflate, adaptive filtering, no interlace — all zero.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'icons');
for (const size of [16, 32, 48, 128]) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, png(size, render(size)));
  console.log('wrote', path.relative(process.cwd(), file), fs.statSync(file).size, 'bytes');
}
