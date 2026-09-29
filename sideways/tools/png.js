// A tiny PNG writer (8-bit RGBA) and a canvas-free rasteriser for map previews.

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function writePng(file, width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

export class Raster {
  constructor(width, height, bg = [0, 0, 0]) {
    this.w = width; this.h = height;
    this.px = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) this.px.set([...bg, 255], i * 4);
  }
  dot(x, y, c) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; this.px.set([c[0], c[1], c[2], 255], (y * this.w + x) * 4); }
  rect(x0, y0, x1, y1, c) { for (let y = Math.max(0, Math.floor(Math.min(y0, y1))); y <= Math.min(this.h - 1, Math.max(y0, y1)); y++) for (let x = Math.max(0, Math.floor(Math.min(x0, x1))); x <= Math.min(this.w - 1, Math.max(x0, x1)); x++) this.dot(x, y, c); }
  line(x0, y0, x1, y1, c, t = 1) { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1; for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; if (t <= 1) this.dot(x, y, c); else this.rect(x - t / 2, y - t / 2, x + t / 2, y + t / 2, c); } }
  disc(x, y, r, c) { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) this.dot(x + dx, y + dy, c); }
  save(file) { writePng(file, this.w, this.h, this.px); }
}
