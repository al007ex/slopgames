// The mix: the engine (an AudioWorklet), tyres, wind, the crowd, sirens and
// one-shot hits, all synthesised; there are no sample files. The engine
// follows the simulation through AudioParams, so it tracks every rev.

const WORKLET = new URL('./engine-worklet.js', import.meta.url);

function noiseBuffer(ctx, seconds = 2, brown = false) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volume = 0.8;
    this.muted = false;
  }

  /** Must be called from a user gesture. */
  async start(engineOpts) {
    if (this.ctx) { await this.ctx.resume(); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.white = noiseBuffer(ctx, 3);
    this.brown = noiseBuffer(ctx, 3, true);

    // Tyres: two squeal voices (front and rear axle) plus a scrub.
    this.tires = [0, 1].map((i) => this.squealVoice(i));
    this.scrub = this.loop(this.brown, 'lowpass', 380, 0.7);
    this.road = this.loop(this.brown, 'lowpass', 160, 0.5);
    this.wind = this.loop(this.white, 'bandpass', 700, 0.4);
    this.crowd = this.crowdVoice();

    try {
      await ctx.audioWorklet.addModule(WORKLET);
      this.makeEngine(engineOpts);
    } catch (e) {
      console.warn('Engine audio unavailable:', e);
    }
    this.ready = true;
  }

  makeEngine(opts) {
    const ctx = this.ctx;
    if (this.engine) { this.engine.disconnect(); this.engine = null; }
    this.engine = new AudioWorkletNode(ctx, 'engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: opts });
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 1.2;
    // A little room: a short feedback delay, like the sound bouncing off buildings.
    const slap = ctx.createDelay(0.2); slap.delayTime.value = 0.045;
    const slapGain = ctx.createGain(); slapGain.gain.value = 0.18;
    const slapLp = ctx.createBiquadFilter(); slapLp.type = 'lowpass'; slapLp.frequency.value = 1800;
    this.engine.connect(this.engineGain).connect(this.master);
    this.engineGain.connect(slap).connect(slapLp).connect(slapGain).connect(this.master);
    this.slapGain = slapGain;
    this.params = {
      rpm: this.engine.parameters.get('rpm'),
      load: this.engine.parameters.get('load'),
      boost: this.engine.parameters.get('boost'),
      cut: this.engine.parameters.get('cut'),
    };
  }

  setCar(spec) {
    if (!this.ctx) return;
    const e = spec.engine;
    this.makeEngine({ kind: e.kind, limit: e.limit, turbo: !!e.turbo, supercharger: !!e.supercharger, bov: e.kind === 'rotary' ? 'flutter' : 'bov' });
  }

  loop(buffer, type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { src, f, g };
  }

  squealVoice(i) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.white; src.loop = true;
    src.loopStart = i * 0.7;
    const a = ctx.createBiquadFilter(); a.type = 'bandpass'; a.frequency.value = 900; a.Q.value = 9;
    const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = 1750; b.Q.value = 12;
    const g = ctx.createGain(); g.gain.value = 0;
    const gb = ctx.createGain(); gb.gain.value = 0.45;
    src.connect(a).connect(g);
    src.connect(b).connect(gb).connect(g);
    g.connect(this.master);
    src.start(ctx.currentTime, i * 0.7);
    return { a, b, g, wobble: Math.random() * 10 };
  }

  crowdVoice() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.white; src.loop = true;
    const g = ctx.createGain(); g.gain.value = 0;
    // Three vowel-ish formants: a roar, not a hiss.
    for (const [f, q, v] of [[520, 3, 1], [1100, 4, 0.6], [2500, 5, 0.25]]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const vg = ctx.createGain(); vg.gain.value = v;
      src.connect(bp).connect(vg).connect(g);
    }
    g.connect(this.master);
    src.start();
    return { g, level: 0, cheer: 0 };
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(this.volume);
    return this.muted;
  }

  /** Every frame: follow the car. */
  update(dt, car, { crowd = 0, inside = false } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime, T = 0.012;
    if (this.params) {
      this.params.rpm.setTargetAtTime(car.rpm, now, T);
      this.params.load.setTargetAtTime(car.cut ? 0 : Math.max(car.load, car.throttle * 0.6), now, T);
      this.params.boost.setTargetAtTime(car.boost, now, 0.05);
      this.params.cut.setValueAtTime(car.cut ? 1 : 0, now);
    }
    if (this.slapGain) this.slapGain.gain.setTargetAtTime(inside ? 0.28 : 0.1, now, 0.3);

    // Tyres: squeal peaks just past the limit of grip and turns to a roar in a
    // full slide; locked or spinning wheels add a scrub.
    const axles = [car.front, car.rear];
    for (let i = 0; i < 2; i++) {
      const t = this.tires[i], ax = axles[i];
      const over = Math.max(0, ax.slip - 0.85);
      const slide = Math.min(1, ax.slide / 9);
      const amt = Math.min(1, over * 0.9) * Math.min(1, car.speed / 3 + ax.slide / 6) * (i === 1 ? 1 : 0.7);
      t.wobble += dt * (3 + Math.random() * 4);
      const pitch = 760 + slide * 260 + Math.sin(t.wobble) * 40 + (ax.fz / 7000) * 120;
      t.a.frequency.setTargetAtTime(pitch, now, 0.03);
      t.b.frequency.setTargetAtTime(pitch * 1.97, now, 0.03);
      t.g.gain.setTargetAtTime(amt * 0.22 * (1 - slide * 0.35), now, 0.04);
    }
    const scrub = Math.min(1, (car.rear.slide + car.front.slide * 0.5) / 14);
    this.scrub.g.gain.setTargetAtTime(scrub * 0.35, now, 0.05);
    this.scrub.f.frequency.setTargetAtTime(200 + scrub * 500, now, 0.05);
    const sp = car.speed;
    this.road.g.gain.setTargetAtTime(Math.min(1, sp / 30) * 0.22, now, 0.1);
    this.road.f.frequency.setTargetAtTime(90 + sp * 5, now, 0.1);
    this.wind.g.gain.setTargetAtTime(Math.min(1, (sp / 60) ** 2) * 0.12, now, 0.15);
    this.wind.f.frequency.setTargetAtTime(500 + sp * 18, now, 0.15);

    // The crowd: a bed of noise that swells with hype, with cheers on top.
    const c = this.crowd;
    c.cheer *= Math.exp(-dt * 1.2);
    c.level += (crowd - c.level) * Math.min(1, dt * 1.5);
    c.g.gain.setTargetAtTime(c.level * 0.05 + c.cheer * 0.12, now, 0.1);
  }

  /** Engine events: bangs, blow-off. */
  vehicleEvent(ev) {
    if (!this.engine) return;
    if (ev.type === 'pop') this.engine.port.postMessage({ type: 'pop', size: ev.size });
    if (ev.type === 'bov') this.engine.port.postMessage({ type: 'bov', size: ev.size });
    if (ev.type === 'shift') this.click(0.06, 1200);
  }

  cheer(amount = 1) { if (this.crowd) this.crowd.cheer = Math.min(2, this.crowd.cheer + amount); }

  /** A short filtered noise burst plus a low thud: impacts, clicks, cones. */
  hit(power, tone = 'metal') {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.white;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = tone === 'cone' ? 900 : 420; f.Q.value = tone === 'cone' ? 2 : 0.8;
    const g = ctx.createGain();
    const p = Math.min(1, power);
    g.gain.setValueAtTime(0.9 * p, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + (tone === 'cone' ? 0.12 : 0.35));
    src.connect(f).connect(g).connect(this.master);
    src.start(now, Math.random() * 2, 0.5);
    if (tone !== 'cone') {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(110, now); o.frequency.exponentialRampToValueAtTime(40, now + 0.2);
      const og = ctx.createGain(); og.gain.setValueAtTime(1.2 * p, now); og.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      o.connect(og).connect(this.master);
      o.start(now); o.stop(now + 0.3);
    }
  }

  click(level, freq) {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.white;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 3;
    const g = ctx.createGain(); g.gain.setValueAtTime(level, now); g.gain.exponentialRampToValueAtTime(0.0005, now + 0.05);
    src.connect(f).connect(g).connect(this.master);
    src.start(now, Math.random(), 0.06);
  }

  /** A bright two-note chime when a combo banks; higher for bigger ones. */
  chime(big = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const base = 660 * Math.pow(2, Math.min(big, 4) / 12 * 2);
    [[base, 0], [base * 1.5, 0.07]].forEach(([f, at]) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, now + at); g.gain.linearRampToValueAtTime(0.09, now + at + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, now + at + 0.5);
      o.connect(g).connect(this.master); o.start(now + at); o.stop(now + at + 0.55);
    });
  }

  horn(on) {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (on && !this.hornNodes) {
      const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.12, now, 0.01);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
      const os = [415, 523].map((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); return o; });
      lp.connect(g).connect(this.master);
      this.hornNodes = { g, os };
    } else if (!on && this.hornNodes) {
      const { g, os } = this.hornNodes;
      g.gain.setTargetAtTime(0, now, 0.02);
      for (const o of os) o.stop(now + 0.1);
      this.hornNodes = null;
    }
  }

  /** Police arriving: a wailing siren that rises for a few seconds. */
  siren(seconds = 6) {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square';
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.55;
    const depth = ctx.createGain(); depth.gain.value = 380;
    lfo.connect(depth).connect(o.frequency);
    o.frequency.value = 980;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.07, now + 2.5); g.gain.setValueAtTime(0.07, now + seconds - 1); g.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    o.connect(lp).connect(g).connect(this.master);
    o.start(now); lfo.start(now); o.stop(now + seconds); lfo.stop(now + seconds);
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
}
