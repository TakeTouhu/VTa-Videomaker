/**
 * Generates the application icon set Tauri needs for each platform.
 *
 * Written by hand rather than pulled from an image library so the icon is
 * reproducible from source and the repository carries no binary-only assets
 * that nobody can regenerate.
 *
 *   node scripts/generate-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");

/** Brand colours, matching tailwind.config.js. */
const BACKGROUND = [18, 20, 23, 255]; // #121417
const ACCENT = [76, 194, 165, 255]; // #4CC2A5

/* ------------------------------------------------------------------ */
/* PNG encoding                                                        */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // Remaining bytes are compression, filter and interlace, all zero.

  // Each scanline is prefixed with its filter type (0 = none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* The icon itself                                                     */
/* ------------------------------------------------------------------ */

/** True when (x, y) is inside a rounded rectangle. */
function insideRounded(x, y, x0, y0, x1, y1, radius) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;

  const corners = [
    [x0 + radius, y0 + radius],
    [x1 - radius, y0 + radius],
    [x0 + radius, y1 - radius],
    [x1 - radius, y1 - radius],
  ];
  const nearHorizontalEdge = x < x0 + radius || x > x1 - radius;
  const nearVerticalEdge = y < y0 + radius || y > y1 - radius;
  if (!nearHorizontalEdge || !nearVerticalEdge) return true;

  return corners.some(
    ([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius,
  );
}

/**
 * Draws the mark: a dark rounded tile carrying an accent play triangle with a
 * cut line through it - play plus cut, which is what the app does.
 */
function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const unit = size / 512;

  const inset = 32 * unit;
  const radius = 96 * unit;
  const triangleLeft = 190 * unit;
  const triangleWidth = 150 * unit;
  const triangleHalfHeight = 110 * unit;
  const cutLeft = 150 * unit;
  const cutRight = 362 * unit;
  const cutHalfHeight = Math.max(1, 6 * unit);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let colour = [0, 0, 0, 0];

      if (insideRounded(x, y, inset, inset, size - inset, size - inset, radius)) {
        colour = BACKGROUND;

        const t = (x - triangleLeft) / triangleWidth;
        if (t >= 0 && t <= 1) {
          const half = (1 - t) * triangleHalfHeight;
          if (Math.abs(y - size / 2) <= half) colour = ACCENT;
        }

        // The cut line knocks through the triangle and out into the tile.
        if (x >= cutLeft && x <= cutRight && Math.abs(y - size / 2) <= cutHalfHeight) {
          colour = colour === ACCENT ? BACKGROUND : ACCENT;
        }
      }

      const offset = (y * size + x) * 4;
      pixels[offset] = colour[0];
      pixels[offset + 1] = colour[1];
      pixels[offset + 2] = colour[2];
      pixels[offset + 3] = colour[3];
    }
  }
  return pixels;
}

/* ------------------------------------------------------------------ */
/* ICO packing                                                         */
/* ------------------------------------------------------------------ */

/** Packs PNG images into a Windows .ico. Vista and later accept PNG entries. */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    // 256 is stored as 0, which is why the format tops out there.
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // palette size
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32BE(0, 8);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

/* ------------------------------------------------------------------ */

mkdirSync(ICONS_DIR, { recursive: true });

/** Sizes Tauri looks for, plus the ones Windows uses inside the .ico. */
const PNG_SIZES = [32, 128, 256, 512];
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

const rendered = new Map();
const render = (size) => {
  if (!rendered.has(size)) rendered.set(size, encodePng(size, renderIcon(size)));
  return rendered.get(size);
};

for (const size of PNG_SIZES) {
  const name = size === 256 ? "128x128@2x.png" : `${size}x${size}.png`;
  writeFileSync(join(ICONS_DIR, name), render(size));
}
// The generic name Tauri uses as the source icon.
writeFileSync(join(ICONS_DIR, "icon.png"), render(512));

writeFileSync(
  join(ICONS_DIR, "icon.ico"),
  encodeIco(ICO_SIZES.map((size) => ({ size, data: render(size) }))),
);

console.log(`Wrote icons to ${ICONS_DIR}`);
