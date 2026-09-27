// Sound, synthesised on the fly — no audio files. Every sound is positioned in
// 3D so you can hear where a fight, a pickaxe or a chest is. The context starts
// on the first click, as browsers require.

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = Number(localStorage.getItem('sw.volume') ?? 0.7);
    this.noise = null;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setVolume(v) { this.volume = v; localStorage.setItem('sw.volume', String(v)); if (this.master) this.master.gain.value = v; }

  /** Moves the listener with the camera. */
  listen(cam) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const f = { x: -Math.sin(cam.rotation.y), z: -Math.cos(cam.rotation.y) };
    if (l.positionX) {
      l.positionX.value = cam.position.x; l.positionY.value = cam.position.y; l.positionZ.value = cam.position.z;
      l.forwardX.value = f.x; l.forwardY.value = 0; l.forwardZ.value = f.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(cam.position.x, cam.position.y, cam.position.z);
      l.setOrientation(f.x, 0, f.z, 0, 1, 0);
    }
  }

  /** A node chain ending in a 3D panner at (x, y, z), or straight out when pos is null. */
  out(pos, gain = 1, range = 40) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    if (pos) {
      const p = this.ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = range / 8;
      p.maxDistance = range * 6;
      p.rolloffFactor = 1.2;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  noiseBurst(pos, { gain = 0.5, freq = 1200, q = 1, dur = 0.12, type = 'bandpass', range = 40, attack = 0.002 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(env).connect(this.out(pos, gain, range));
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  tone(pos, { freq = 220, to = null, gain = 0.3, dur = 0.2, type = 'sine', range = 40 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(env).connect(this.out(pos, gain, range));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  hit(pos, mat, weak) {
    if (mat === 0) { this.noiseBurst(pos, { freq: 500, q: 2, gain: 0.7, dur: 0.12 }); this.tone(pos, { freq: 140, to: 90, gain: 0.35, dur: 0.12 }); }
    else if (mat === 1) { this.noiseBurst(pos, { freq: 2200, q: 1.5, gain: 0.6, dur: 0.09 }); this.tone(pos, { freq: 320, to: 200, gain: 0.2, dur: 0.07, type: 'triangle' }); }
    else if (mat === 2) { this.tone(pos, { freq: 880, to: 700, gain: 0.25, dur: 0.35, type: 'triangle' }); this.tone(pos, { freq: 1330, to: 1200, gain: 0.12, dur: 0.3 }); this.noiseBurst(pos, { freq: 4000, q: 3, gain: 0.3, dur: 0.05 }); }
    else this.noiseBurst(pos, { freq: 300, q: 0.7, gain: 0.5, dur: 0.1 });
    if (weak) this.tone(null, { freq: 1500, to: 2200, gain: 0.18, dur: 0.12, type: 'sine' });
  }

  crumble(pos, mat) {
    this.noiseBurst(pos, { freq: mat === 2 ? 900 : 350, q: 0.6, gain: 0.8, dur: 0.5, type: 'lowpass', range: 70 });
    this.tone(pos, { freq: 90, to: 45, gain: 0.4, dur: 0.4, range: 70 });
  }

  swing(pos) { this.noiseBurst(pos, { freq: 900, q: 0.8, gain: 0.25, dur: 0.18, attack: 0.05, range: 25 }); }

  /** A gunshot, by weapon class. Loud ones carry a long way. */
  gun(pos, cls, own = false) {
    const g = own ? 0.55 : 0.9;
    switch (cls) {
      case 'pistol': this.noiseBurst(pos, { freq: 1800, q: 0.9, gain: g * 0.8, dur: 0.12, range: 120 }); this.tone(pos, { freq: 180, to: 80, gain: g * 0.4, dur: 0.1, range: 120 }); break;
      case 'revolver': this.noiseBurst(pos, { freq: 900, q: 0.7, gain: g, dur: 0.25, range: 180 }); this.tone(pos, { freq: 110, to: 45, gain: g * 0.6, dur: 0.2, range: 180 }); break;
      case 'smg': this.noiseBurst(pos, { freq: 2400, q: 1.1, gain: g * 0.6, dur: 0.07, range: 100 }); break;
      case 'ar': case 'burst': case 'scoped': this.noiseBurst(pos, { freq: 1300, q: 0.8, gain: g * 0.9, dur: 0.14, range: 160 }); this.tone(pos, { freq: 140, to: 60, gain: g * 0.45, dur: 0.12, range: 160 }); break;
      case 'pump': case 'tactical': this.noiseBurst(pos, { freq: 600, q: 0.5, gain: g * 1.1, dur: 0.32, type: 'lowpass', range: 160 }); this.tone(pos, { freq: 90, to: 40, gain: g * 0.7, dur: 0.25, range: 160 }); break;
      case 'sniper': this.noiseBurst(pos, { freq: 700, q: 0.6, gain: g * 1.2, dur: 0.5, range: 400 }); this.tone(pos, { freq: 120, to: 35, gain: g * 0.8, dur: 0.45, range: 400 }); break;
      case 'rocket': case 'grenade': this.noiseBurst(pos, { freq: 400, q: 0.6, gain: g * 0.8, dur: 0.35, type: 'lowpass', range: 150 }); break;
      default: this.noiseBurst(pos, { freq: 1200, gain: g * 0.6, dur: 0.12 });
    }
  }

  boom(pos) {
    this.noiseBurst(pos, { freq: 260, q: 0.5, gain: 1.4, dur: 1.1, type: 'lowpass', range: 250 });
    this.tone(pos, { freq: 70, to: 28, gain: 1.0, dur: 0.9, range: 250 });
  }

  /**
   * A chest's hum: two detuned tones and a slow shimmer, looping, positioned
   * at the chest and not muffled by walls. Returns a handle with stop().
   */
  hum(pos) {
    if (!this.ctx) return null;
    const t = this.ctx.currentTime;
    const out = this.out({ x: pos.x, y: pos.y + 0.5, z: pos.z }, 0.0, 16);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.35, t + 0.6);
    const oscs = [196, 293.7, 392.9].map((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.value = i === 2 ? 0.15 : 0.4;
      o.connect(g).connect(out);
      o.start(t);
      return o;
    });
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 3.2;
    const depth = this.ctx.createGain();
    depth.gain.value = 0.12;
    lfo.connect(depth).connect(out.gain);
    lfo.start(t);
    return {
      stop: () => {
        const now = this.ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(out.gain.value, now);
        out.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
        for (const o of [...oscs, lfo]) o.stop(now + 0.35);
      },
    };
  }

  chestOpen(pos) {
    this.noiseBurst(pos, { freq: 500, q: 3, gain: 0.4, dur: 0.3, range: 40 });
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(pos, { freq: f, gain: 0.18, dur: 0.35, type: 'triangle', range: 40 }), i * 70));
  }

  pickup() { this.tone(null, { freq: 700, to: 1100, gain: 0.12, dur: 0.1, type: 'triangle' }); }

  hitmark(head, shield) { this.tone(null, { freq: head ? 1500 : shield ? 900 : 1100, to: head ? 1900 : undefined, gain: 0.12, dur: 0.07, type: head ? 'triangle' : 'sine' }); }
  click() { this.tone(null, { freq: 2200, gain: 0.08, dur: 0.03, type: 'square' }); }
  reload(pos) { this.noiseBurst(pos, { freq: 3000, q: 4, gain: 0.25, dur: 0.05, range: 20 }); setTimeout(() => this.noiseBurst(pos, { freq: 2200, q: 4, gain: 0.25, dur: 0.06, range: 20 }), 350); }
}
