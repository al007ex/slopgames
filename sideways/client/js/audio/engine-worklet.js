// The engine's voice, made the way an engine makes it: every cylinder fires a
// pressure pulse into its exhaust at the right crank angle, the pulses ring in
// the pipes, a muffler takes the edge off, and whatever comes out is driven
// into a little saturation. Firing order and bank layout are what make a
// cross-plane V8 burble, a straight six hum and a rotary buzz.
//
// Parameters arrive as AudioParams (rpm, load, boost, cut) so they glide
// between frames without zipper noise; bangs, blow-off and shifts arrive as
// messages, timed to the frame that caused them.

const TAU = Math.PI * 2;

const KINDS = {
  i6: {
    // 1-5-3-6-2-4, two three-into-one headers.
    events: [0, 1, 0, 1, 0, 1], tau: 0.00105, noise: 0.14, pipes: [1.85, 2.3], feedback: -0.52,
    muffler: 850, bright: 1500, drive: 1.3, lope: 0.03, gain: 0.3, body: 140,
  },
  v8: {
    // Cross-plane 1-8-4-3-6-5-7-2: left/right banks fire L R R L R L L R.
    events: [0, 1, 1, 0, 1, 0, 0, 1], tau: 0.0017, noise: 0.18, pipes: [2.6, 2.95], feedback: -0.6,
    muffler: 560, bright: 1050, drive: 1.5, lope: 0.14, gain: 0.3, body: 95,
  },
  rotary: {
    // Two rotors, two firings per shaft turn: four events per 720°.
    events: [0, 0, 0, 0], tau: 0.00065, noise: 0.3, pipes: [1.45], feedback: -0.42,
    muffler: 1300, bright: 2100, drive: 1.7, lope: 0.1, gain: 0.3, body: 190,
  },
};

class OnePole {
  constructor() { this.z = 0; this.a = 0.5; }
  set(fc, sr) { this.a = 1 - Math.exp(-TAU * fc / sr); }
  run(x) { this.z += this.a * (x - this.z); return this.z; }
}

/** RBJ biquad (lowpass or bandpass), direct form I. */
class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  lowpass(fc, q, sr) {
    const w = TAU * Math.min(fc, sr * 0.45) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  bandpass(fc, q, sr) {
    const w = TAU * Math.min(fc, sr * 0.45) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** A pipe: a delay line fed back through a lowpass, ringing at its length. */
class Pipe {
  constructor(length, feedback, sr) {
    this.n = Math.max(8, Math.round(sr * 2 * length / 343));
    this.buf = new Float32Array(this.n);
    this.i = 0;
    this.g = feedback;
    this.lp = new OnePole();
    this.lp.set(2200, sr);
  }
  run(x) {
    const out = this.buf[this.i];
    const y = x + this.g * this.lp.run(out);
    this.buf[this.i] = y;
    this.i = (this.i + 1) % this.n;
    return y;
  }
}

class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 900, minValue: 0, maxValue: 12000, automationRate: 'a-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'boost', defaultValue: 0, minValue: 0, maxValue: 1.5, automationRate: 'k-rate' },
      { name: 'cut', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'volume', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    this.sr = sampleRate;
    this.setKind((options && options.processorOptions && options.processorOptions.kind) || 'i6', options && options.processorOptions);
    this.port.onmessage = (e) => this.message(e.data);
    this.theta = 0;
    this.pulses = [];
    for (let i = 0; i < 24; i++) this.pulses.push({ on: false, t: 0, a: 0, bank: 0, tau: 1 });
    this.seed = 1234567;
    this.bangs = [];
    this.bov = null;
    this.intake = new Biquad();
    this.whine = 0;
    this.whistle = 0;
    this.dc = { x: 0, y: 0 };
    this.cutEnv = 0;
    this.limiterPhase = 0;
  }

  setKind(kind, opts = {}) {
    const k = KINDS[kind] || KINDS.i6;
    this.kind = kind;
    this.k = k;
    this.cyl = k.events.length;
    this.banks = k.pipes.length;
    this.pipes = k.pipes.map((len, i) => new Pipe(len, k.feedback, this.sr));
    this.muffler = [new Biquad(), new Biquad()];
    this.body = new Biquad().bandpass(k.body, 1.4, this.sr);
    this.variation = k.events.map((_, i) => 1 + (((i * 7919) % 13) / 13 - 0.5) * 0.12);
    this.limit = opts.limit || 7000;
    this.turbo = !!opts.turbo;
    this.supercharger = !!opts.supercharger;
    this.bovStyle = opts.bov || 'bov';
  }

  rand() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }

  message(m) {
    if (m.type === 'pop') {
      // An afterfire bang: a hard crack plus a thump, down the pipes.
      this.bangs.push({ t: 0, size: Math.min(1.6, m.size || 1), f: 70 + this.rand() * 40, dur: 0.05 + this.rand() * 0.04 });
    } else if (m.type === 'bov') {
      this.bov = { t: 0, size: Math.min(1.2, m.size || 1), style: this.bovStyle };
    } else if (m.type === 'kind') {
      this.setKind(m.kind, m);
    }
  }

  trigger(bank, amp, tau) {
    for (const p of this.pulses) {
      if (p.on) continue;
      p.on = true; p.t = 0; p.a = amp; p.bank = bank; p.tau = tau;
      return;
    }
  }

  process(inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const sr = this.sr, k = this.k;
    const rpmP = params.rpm, load = params.load[0], boost = params.boost[0], cut = params.cut[0], vol = params.volume[0];
    const cycle = 4 * Math.PI; // four-stroke: 720°
    const step = cycle / this.cyl;
    const rpm0 = rpmP[0];
    // Muffler opens up with load; everything a touch brighter at high revs.
    const fc = k.muffler + k.bright * load + rpm0 * 0.06;
    this.muffler[0].lowpass(fc, 0.7, sr);
    this.muffler[1].lowpass(fc * 1.6, 0.6, sr);
    this.intake.bandpass(500 + rpm0 * 0.16, 1.1, sr);
    const tauBase = k.tau * (1.25 - 0.45 * Math.min(1, rpm0 / this.limit)) * sr;
    const idleness = Math.max(0, 1 - rpm0 / 2600);
    this.cutEnv += ((cut > 0.5 ? 1 : 0) - this.cutEnv) * 0.35;

    for (let i = 0; i < out.length; i++) {
      const rpm = rpmP.length > 1 ? rpmP[i] : rpm0;
      const dTheta = TAU * rpm / 60 / sr;
      const before = this.theta;
      this.theta += dTheta;
      // Fire every cylinder whose angle we just passed.
      const e0 = Math.floor(before / step), e1 = Math.floor(this.theta / step);
      for (let e = e0 + 1; e <= e1; e++) {
        const idx = ((e % this.cyl) + this.cyl) % this.cyl;
        const bank = k.events[idx];
        let amp = (0.32 + 0.68 * Math.pow(load, 0.75)) * this.variation[idx] * (1 + (this.rand() - 0.5) * 0.08);
        // Lumpy cams at idle; cut ignition leaves only a faint breath.
        amp *= 1 + (this.rand() - 0.5) * k.lope * 2 * idleness;
        if (this.cutEnv > 0.5) amp *= 0.05;
        const jitter = 1 + (this.rand() - 0.5) * (0.1 + k.lope * idleness);
        this.trigger(bank % this.banks, amp, tauBase * jitter);
      }
      if (this.theta >= cycle * 64) this.theta -= cycle * 64;

      // Sum the live pulses into each bank.
      let b0 = 0, b1 = 0;
      for (const p of this.pulses) {
        if (!p.on) continue;
        const x = p.t / p.tau;
        const env = x * Math.exp(1 - x);
        const n = (this.rand() * 2 - 1) * k.noise;
        const v = p.a * env * (1 + n);
        if (p.bank === 0) b0 += v; else b1 += v;
        p.t++;
        if (x > 9) p.on = false;
      }

      // Afterfire bangs go straight into the pipes too.
      let bang = 0, thump = 0;
      for (let j = this.bangs.length - 1; j >= 0; j--) {
        const bg = this.bangs[j];
        const t = bg.t / sr;
        const crack = Math.exp(-t / 0.012) * (this.rand() * 2 - 1);
        const body = Math.sin(TAU * bg.f * (1 - t * 4) * t) * Math.exp(-t / bg.dur);
        bang += (crack * 1.4 + body * 0.9) * bg.size;
        thump += body * bg.size;
        bg.t++;
        if (t > 0.25) this.bangs.splice(j, 1);
      }

      let y = this.pipes[0].run(b0 + bang * 0.6);
      if (this.banks > 1) y = (y + this.pipes[1].run(b1 + bang * 0.6)) * 0.6;
      else y += 0;
      y = this.muffler[1].run(this.muffler[0].run(y));
      y += this.body.run(y) * 0.8;
      y += thump * 0.5;

      // Intake: breathy, pulsing with the firing, only with the throttle open.
      const intake = this.intake.run(this.rand() * 2 - 1) * 0.1 * load * Math.min(1, rpm / this.limit + 0.2) * (0.6 + 0.4 * Math.sin(this.theta * this.cyl / 2));
      y += intake;

      // Forced induction.
      if (this.turbo) {
        this.whistle += (TAU * (2200 + 5200 * boost) / sr);
        y += Math.sin(this.whistle) * 0.012 * boost * boost * (0.35 + 0.65 * load);
      }
      if (this.supercharger) {
        this.whine += TAU * (rpm / 60 * 30) / sr;
        const r = Math.min(1, rpm / this.limit);
        y += (Math.sin(this.whine) + 0.3 * Math.sin(this.whine * 2.01)) * 0.014 * r * r * (0.4 + 0.6 * load);
      }
      if (this.bov) {
        const t = this.bov.t / sr;
        let env;
        if (this.bov.style === 'flutter') env = Math.exp(-t / 0.28) * (0.55 + 0.45 * Math.sign(Math.sin(TAU * 21 * t)));
        else env = Math.min(1, t / 0.008) * Math.exp(-t / 0.2);
        y += this.intake.run(this.rand() * 2 - 1) * 0.5 * env * this.bov.size;
        this.bov.t++;
        if (t > 0.9) this.bov = null;
      }

      // Block DC, saturate a little, and out.
      const dcy = y - this.dc.x + 0.995 * this.dc.y;
      this.dc.x = y; this.dc.y = dcy;
      const d = k.drive;
      out[i] = Math.tanh(dcy * d * k.gain) / d * vol;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}

registerProcessor('engine', EngineProcessor);
