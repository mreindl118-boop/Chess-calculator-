// Regenerates the legacy (pre-API-26) Android launcher PNGs so old devices get
// the GambitLab brand tile instead of the stock Capacitor robot. API 26+ uses
// the adaptive vector icon (knight + monochrome themed layer); this only feeds
// mipmap-*/ic_launcher.png and ic_launcher_round.png. Zero dependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const resDir = join(root, 'android', 'app', 'src', 'main', 'res');

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const png = (size, rgba) => {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const BG_TOP = [0x1e, 0x24, 0x2b];
const BG_BOT = [0x12, 0x15, 0x1a];
const LIGHT = [0xe8, 0xe6, 0xe1, 255];
const ACCENT = [0xe9, 0xae, 0x4b, 255];

function draw(size, { round }) {
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, c) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
    buf[i + 3] = c[3] ?? 255;
  };
  const r = size / 2;
  const radius = size * 0.2; // rounded-square corner for the square icon
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside;
      if (round) {
        inside = Math.hypot(x - r + 0.5, y - r + 0.5) <= r - 0.5;
      } else {
        const rx = Math.max(0, Math.max(radius - x, x - (size - radius - 1)));
        const ry = Math.max(0, Math.max(radius - y, y - (size - radius - 1)));
        inside = !(rx > 0 && ry > 0 && rx * rx + ry * ry > radius * radius);
      }
      if (!inside) {
        set(x, y, [0, 0, 0, 0]);
        continue;
      }
      const t = y / size; // vertical gradient
      set(x, y, [
        Math.round(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t),
        Math.round(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t),
        Math.round(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t),
        255,
      ]);
    }
  }
  // 2x2 board motif + accent checker disc (matches the PWA mark)
  const cell = size * 0.17;
  const bx = size * 0.24;
  const by = size * 0.24;
  for (let cyi = 0; cyi < 2; cyi++) {
    for (let cxi = 0; cxi < 2; cxi++) {
      const color = (cxi + cyi) % 2 === 0 ? LIGHT : ACCENT;
      for (let y = 0; y < cell; y++)
        for (let x = 0; x < cell; x++) set(bx + cxi * cell + x, by + cyi * cell + y, color);
    }
  }
  const cx = size * 0.64;
  const cy = size * 0.64;
  const dr = size * 0.16;
  for (let y = Math.floor(cy - dr) - 1; y <= cy + dr + 1; y++) {
    for (let x = Math.floor(cx - dr) - 1; x <= cx + dr + 1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= dr) set(x, y, ACCENT);
      if (d <= dr * 0.52 && d >= dr * 0.36) set(x, y, [BG_BOT[0], BG_BOT[1], BG_BOT[2], 255]);
    }
  }
  return png(size, buf);
}

const DENSITIES = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
];
for (const [dpi, size] of DENSITIES) {
  const dir = join(resDir, `mipmap-${dpi}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ic_launcher.png'), draw(size, { round: false }));
  writeFileSync(join(dir, 'ic_launcher_round.png'), draw(size, { round: true }));
}
console.log('legacy Android launcher PNGs regenerated');
