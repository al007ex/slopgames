// Render the engine worklet offline: level checks and a spectrogram PNG.
//   node tools/engine-render.mjs <kind> <out-prefix>
import { writeFileSync } from 'node:fs';
import { Raster } from './png.js';

globalThis.sampleRate = 48000;
let Proc;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null, postMessage() {} }; } };
globalThis.registerProcessor = (name, cls) => { Proc = cls; };
await import('../client/js/audio/engine-worklet.js');

const kind = process.argv[2] || 'v8';
const prefix = process.argv[3] || '/tmp/engine';
const limit = { i6: 7800, v8: 6900, rotary: 9000 }[kind];
const p = new Proc({ processorOptions: { kind, limit, turbo: kind !== 'v8', supercharger: kind === 'v8', bov: kind === 'rotary' ? 'flutter' : 'bov' } });
const sr = 48000, B = 128;
const total = sr * 12;
const out = new Float32Array(total);
let rpm = 900, cut = 0;
const segs = [];
for (let n = 0; n < total; n += B) {
  const t = n / sr;
  let load = 0, target = 900;
  if (t < 2) { target = kind === 'rotary' ? 1000 : 850; load = 0; }             // idle
  else if (t < 5) { load = 1; target = limit + 200; }                          // rev up, bounce limiter
  else if (t < 6) { load = 0; target = 1800; }                                 // lift: overrun
  else if (t < 9) { load = 1; target = limit * 0.72 + Math.sin(t * 3) * 400; } // steady drift revs
  else { load = 1; target = limit + 200; }
  // A crude free-revving engine with a hard limiter.
  const acc = load > 0.5 && !cut ? 9000 : -4500;
  rpm = Math.min(Math.max(rpm + acc * B / sr, 800), 12000);
  if (load > 0.5 && rpm > target && t >= 6 && t < 9) rpm = target;
  if (rpm > limit) cut = 1; else if (cut && rpm < limit - 300) cut = 0;
  if (cut && Math.random() < 0.05) p.message({ type: 'pop', size: 1 });
  if (t > 5 && t < 5.9 && Math.random() < 0.03) p.message({ type: 'pop', size: 0.4 });
  if (Math.abs(t - 5) < B / sr / 2 && kind !== 'v8') p.message({ type: 'bov', size: 1 });
  const buf = new Float32Array(B);
  p.process([], [[buf]], { rpm: new Float32Array([rpm]), load: new Float32Array([load]), boost: new Float32Array([load * 0.9]), cut: new Float32Array([cut]), volume: new Float32Array([1]) });
  out.set(buf, n);
}
// Levels per second.
for (let s = 0; s < 12; s++) {
  let peak = 0, sum = 0;
  for (let i = s * sr; i < (s + 1) * sr; i++) { peak = Math.max(peak, Math.abs(out[i])); sum += out[i] * out[i]; }
  segs.push(`${s}s pk ${peak.toFixed(2)} rms ${Math.sqrt(sum / sr).toFixed(3)}`);
}
console.log(kind, segs.join(' | '));
// WAV
const wav = Buffer.alloc(44 + total * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + total * 2, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(total * 2, 40);
for (let i = 0; i < total; i++) wav.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(out[i] * 32767))), 44 + i * 2);
writeFileSync(`${prefix}-${kind}.wav`, wav);
// Spectrogram: 2048-point DFT via radix-2 FFT, log frequency 30 Hz–8 kHz.
const N = 2048, W = 600, H = 256;
const r = new Raster(W, H, [0, 0, 0]);
const re = new Float64Array(N), im = new Float64Array(N);
function fft() {
  for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= N; len <<= 1) { const ang = -2 * Math.PI / len; for (let i = 0; i < N; i += len) for (let j = 0; j < len / 2; j++) { const wr = Math.cos(ang * j), wi = Math.sin(ang * j); const ur = re[i + j], ui = im[i + j]; const vr = re[i + j + len / 2] * wr - im[i + j + len / 2] * wi, vi = re[i + j + len / 2] * wi + im[i + j + len / 2] * wr; re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi; } }
}
for (let x = 0; x < W; x++) {
  const start = Math.floor(x / W * (total - N));
  for (let i = 0; i < N; i++) { re[i] = out[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
  fft();
  for (let y = 0; y < H; y++) {
    const f = 30 * Math.pow(8000 / 30, (H - 1 - y) / (H - 1));
    const bin = Math.round(f / sr * N);
    const mag = Math.hypot(re[bin], im[bin]);
    const db = 20 * Math.log10(mag + 1e-9);
    const v = Math.max(0, Math.min(1, (db + 30) / 60));
    r.dot(x, y, [v * 255, v * v * 200, v * v * v * 120]);
  }
}
r.save(`${prefix}-${kind}.png`);
