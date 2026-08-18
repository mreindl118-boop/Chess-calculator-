// Generates the PWA icons as PNGs with zero dependencies (raw zlib + PNG
// chunks). The design is a simple board-knight mark; swap in real art any
// time by replacing the files in public/icons/.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [0x16, 0x19, 0x1d, 255];
const ACCENT = [0xd9, 0x8f, 0x4a, 255];
const LIGHT = [0xe8, 0xe6, 0xe1, 255];

function draw(size, { maskable }) {
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
    buf[i + 3] = c[3];
  };
  const pad = maskable ? 0 : Math.round(size * 0.04);
  const radius = maskable ? 0 : size * 0.18;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // rounded-square mask for non-maskable icons
      let inside = x >= pad && x < size - pad && y >= pad && y < size - pad;
      if (inside && radius > 0) {
        const rx = Math.max(0, Math.max(pad + radius - x, x - (size - pad - radius - 1)));
        const ry = Math.max(0, Math.max(pad + radius - y, y - (size - pad - radius - 1)));
        if (rx > 0 && ry > 0 && rx * rx + ry * ry > radius * radius) inside = false;
      }
      if (inside) set(x, y, BG);
      else set(x, y, [0, 0, 0, 0]);
    }
  }
  // 2x2 board motif, offset toward the top-left
  const cell = size * 0.17;
  const bx = size * 0.22;
  const by = size * 0.22;
  for (let cyi = 0; cyi < 2; cyi++) {
    for (let cxi = 0; cxi < 2; cxi++) {
      const color = (cxi + cyi) % 2 === 0 ? LIGHT : ACCENT;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          set(Math.round(bx + cxi * cell + x), Math.round(by + cyi * cell + y), color);
        }
      }
    }
  }
  // accent disc bottom-right (a checker)
  const cx = size * 0.66;
  const cy = size * 0.66;
  const r = size * 0.155;
  for (let y = Math.floor(cy - r) - 1; y <= cy + r + 1; y++) {
    for (let x = Math.floor(cx - r) - 1; x <= cx + r + 1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r) set(x, y, ACCENT);
      else if (d <= r + 1.5) set(x, y, [ACCENT[0], ACCENT[1], ACCENT[2], 120]);
      if (d <= r * 0.55 && d >= r * 0.4) set(x, y, BG);
    }
  }
  return png(size, size, buf);
}

writeFileSync(join(outDir, 'icon-192.png'), draw(192, { maskable: false }));
writeFileSync(join(outDir, 'icon-512.png'), draw(512, { maskable: false }));
writeFileSync(join(outDir, 'icon-maskable-512.png'), draw(512, { maskable: true }));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="18" fill="#16191d"/>
<rect x="22" y="22" width="17" height="17" fill="#e8e6e1"/>
<rect x="39" y="22" width="17" height="17" fill="#d98f4a"/>
<rect x="22" y="39" width="17" height="17" fill="#d98f4a"/>
<rect x="39" y="39" width="17" height="17" fill="#e8e6e1"/>
<circle cx="66" cy="66" r="15.5" fill="#d98f4a"/>
<circle cx="66" cy="66" r="7.5" fill="none" stroke="#16191d" stroke-width="2.4"/>
</svg>`;
writeFileSync(join(outDir, 'icon.svg'), svg);

console.log('icons written to public/icons/');
