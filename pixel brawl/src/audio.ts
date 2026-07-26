/** Tiny WebAudio synth — every sound is generated, no audio files. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

export function setAudioEnabled(on: boolean) {
  enabled = on;
  if (master) master.gain.value = on ? 0.32 : 0;
}

export function audioEnabled() {
  return enabled;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
  if (!ctx || !master || !enabled) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, filterHz: number) {
  if (!ctx || !master || !enabled) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const t = ctx.currentTime;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = filterHz;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t);
}

let lastShot = 0;
let lastHeal = 0;

export const sfx = {
  shoot() {
    const now = performance.now();
    if (now - lastShot < 45) return;
    lastShot = now;
    tone(420 + Math.random() * 60, 0.07, 'square', 0.12, 180);
  },
  superShot() {
    tone(180, 0.28, 'sawtooth', 0.18, 60);
    noise(0.2, 0.12, 1800);
  },
  hit() {
    tone(220 + Math.random() * 40, 0.05, 'square', 0.09, 120);
  },
  explode() {
    noise(0.35, 0.22, 900);
    tone(90, 0.3, 'sawtooth', 0.14, 34);
  },
  kill() {
    tone(300, 0.1, 'square', 0.14, 120);
    setTimeout(() => tone(180, 0.22, 'square', 0.12, 70), 70);
  },
  pickup() {
    tone(720, 0.07, 'square', 0.1);
    setTimeout(() => tone(980, 0.09, 'square', 0.09), 55);
  },
  gem() {
    tone(880, 0.06, 'triangle', 0.12);
    setTimeout(() => tone(1180, 0.1, 'triangle', 0.1), 50);
  },
  heal() {
    const now = performance.now();
    if (now - lastHeal < 220) return;
    lastHeal = now;
    tone(520, 0.12, 'sine', 0.1, 780);
  },
  crate() {
    noise(0.18, 0.16, 1400);
  },
  ui() {
    tone(600, 0.05, 'square', 0.08);
  },
  uiBig() {
    tone(440, 0.08, 'square', 0.1);
    setTimeout(() => tone(660, 0.12, 'square', 0.09), 60);
  },
  victory() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.24, 'square', 0.12), i * 110));
  },
  defeat() {
    [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'square', 0.1), i * 150));
  },
  countdown() {
    tone(660, 0.1, 'square', 0.11);
  },
  box() {
    [440, 554, 659, 880].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'square', 0.1), i * 80));
  },
};
