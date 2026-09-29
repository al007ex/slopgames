// Scoring. One drift scorer runs everywhere; the takeover and the circuit add
// their own judges on top. Everything raises events ({ type, text, points })
// that the HUD, the crowd and the audio react to.

import { DEG, clamp, sign } from './math.js';
import { carBox } from './collide.js';
import { trackPlace } from './world.js';

const DRIFT_MIN = 12 * DEG;
const GRACE = 0.9;      // seconds out of a slide before the combo is banked
const CRASH = 4.5;      // m/s into something ends a combo

export class DriftScore {
  constructor() {
    this.total = 0;
    this.best = 0;
    this.reset();
  }

  reset() {
    this.active = false;
    this.pending = 0;
    this.mult = 1;
    this.time = 0;
    this.idle = 0;
    this.side = 0;
    this.angleSum = 0;
    this.angleTime = 0;
    this.close = 0;
    this.tags = new Set();
  }

  /** How good this instant of sliding is, per second. */
  static rate(car) {
    const beta = Math.abs(car.slipAngle);
    const angle = clamp((beta - DRIFT_MIN) / (35 * DEG), 0, 1) * (beta > 70 * DEG ? clamp(1 - (beta - 70 * DEG) / (40 * DEG), 0.2, 1) : 1);
    const speed = clamp(car.speed / 10, 0, 4);
    return 120 * angle * speed;
  }

  update(dt, car, { clearance = Infinity, impact = 0, bonus = 1 } = {}, events = []) {
    const beta = car.slipAngle;
    const sliding = Math.abs(beta) > DRIFT_MIN && car.speed > 6 && car.forward > -1;

    if (impact > CRASH && this.active) {
      events.push({ type: 'crash', text: 'CRASHED', points: -Math.round(this.pending * this.mult) });
      this.reset();
      return events;
    }

    if (sliding) {
      if (!this.active) { this.active = true; this.side = sign(beta); events.push({ type: 'start' }); }
      this.idle = 0;
      this.time += dt;
      this.angleSum += Math.abs(beta) * dt;
      this.angleTime += dt;
      const s = sign(beta);
      if (s !== this.side && Math.abs(beta) > 18 * DEG) {
        this.side = s;
        this.mult = Math.min(this.mult + 0.5, 8);
        events.push({ type: 'transition', text: 'TRANSITION', points: 0 });
      }
      // Kissing a wall mid-slide is worth a lot more.
      let r = DriftScore.rate(car) * bonus;
      if (clearance < 1.8) {
        r *= 1 + (1.8 - clearance) * 0.8;
        this.close += dt;
        if (this.close > 0.35 && !this.tags.has('close')) { this.tags.add('close'); events.push({ type: 'close', text: 'PROXIMITY', points: 0 }); }
      }
      this.pending += r * dt;
      this.mult = Math.min(this.mult + dt / 3, 8);
    } else if (this.active) {
      this.idle += dt;
      if (this.idle > GRACE) this.bank(events);
    }
    return events;
  }

  get angle() { return this.angleTime ? this.angleSum / this.angleTime : 0; }

  bank(events) {
    const points = Math.round(this.pending * this.mult);
    if (points > 0) {
      this.total += points;
      this.best = Math.max(this.best, points);
      events.push({ type: 'bank', text: label(points), points, mult: this.mult, time: this.time });
    }
    this.reset();
  }
}

const label = (p) => (p > 50000 ? 'INSANE' : p > 20000 ? 'MASSIVE' : p > 8000 ? 'HUGE' : p > 3000 ? 'GREAT' : p > 1000 ? 'NICE' : 'DRIFT');

// ----------------------------------------------------------------- takeover

/**
 * The takeover judge: donuts, figure eights, rollbacks, burnouts and the
 * limiter all feed the crowd's hype, and hype multiplies everything.
 */
export class Takeover {
  constructor(pit, seconds = 150) {
    this.pit = pit;
    this.length = seconds;
    this.time = 0;
    this.score = 0;
    this.hype = 0;
    this.counts = { donut: 0, figure8: 0, rollback: 0, burnout: 0, flames: 0, close: 0 };
    this.spin = 0;          // heading turned in the current donut run
    this.spinDir = 0;
    this.lastDonutDir = 0;
    this.lastDonutAt = -9;
    this.burn = 0;
    this.roll = null;       // a rollback in progress
    this.forwardAt = 0;
    this.lastHeading = null;
    this.limiter = [];
    this.limiterAt = -9;
    this.over = false;
    this.ringClose = 0;
  }

  award(events, type, text, points, hype = points / 4000) {
    const p = Math.round(points * (1 + this.hype * 2));
    this.score += p;
    this.hype = Math.min(1, this.hype + hype);
    events.push({ type, text, points: p });
  }

  update(dt, car, vehicleEvents, events = []) {
    if (this.over) return events;
    this.time += dt;
    this.hype = Math.max(0, this.hype - dt * 0.02);
    const beta = Math.abs(car.slipAngle);
    const spinning = car.wr * car.spec.wheelRadius - Math.max(car.forward, 0) > 6;

    // Donuts: heading turned while slow and loose.
    if (this.lastHeading === null) this.lastHeading = car.heading;
    const turn = car.heading - this.lastHeading;
    this.lastHeading = car.heading;
    const loose = car.speed < 14 && (beta > 40 * DEG || car.speed < 3) && spinning;
    if (loose && Math.abs(car.yawRate) > 0.9) {
      const dir = sign(car.yawRate);
      if (dir !== this.spinDir) { this.spinDir = dir; this.spin = 0; }
      this.spin += Math.abs(turn);
      if (this.spin >= Math.PI * 2) {
        this.spin -= Math.PI * 2;
        this.counts.donut++;
        const figure8 = this.lastDonutDir && dir !== this.lastDonutDir && this.time - this.lastDonutAt < 9;
        if (figure8) { this.counts.figure8++; this.award(events, 'figure8', 'FIGURE EIGHT', 1600); }
        const near = Math.hypot(car.x - this.pit.x, car.y - this.pit.y) < 10;
        this.award(events, 'donut', near ? 'CENTRE DONUT' : 'DONUT', near ? 900 : 600);
        this.lastDonutDir = dir;
        this.lastDonutAt = this.time;
      }
    } else if (!loose) this.spin = Math.max(0, this.spin - dt * 2);

    // Rollbacks: from driving forwards, whipped round to roll backwards and
    // brought back round again.
    if (beta < 50 * DEG && car.forward > 3) this.forwardAt = this.time;
    if (!this.roll && beta > 150 * DEG && car.forward < -2.5 && this.time - this.forwardAt < 2.5) this.roll = { at: this.time };
    if (this.roll) {
      if (beta < 60 * DEG && car.forward > 1) {
        this.counts.rollback++;
        this.award(events, 'rollback', 'ROLLBACK', 2500);
        this.roll = null;
      } else if (this.time - this.roll.at > 5) this.roll = null;
    }

    // Burnouts: rears lit with the car nearly still.
    if (car.speed < 3 && spinning && car.wr * car.spec.wheelRadius > 12) {
      this.burn += dt;
      if (this.burn > 1.5) { this.burn -= 1.5; this.counts.burnout++; this.award(events, 'burnout', 'BURNOUT', 350); }
    } else this.burn = Math.max(0, this.burn - dt);

    // The limiter and the flames it throws.
    for (const ev of vehicleEvents) {
      if (ev.type === 'pop' && ev.size > 0.8) { this.counts.flames++; this.award(events, 'flames', '', 25, 0.004); }
      if (ev.type === 'cut') this.limiter.push(this.time);
    }
    while (this.limiter.length && this.time - this.limiter[0] > 1.5) this.limiter.shift();
    if (this.limiter.length >= 6 && this.time - this.limiterAt > 4) { this.limiter.length = 0; this.limiterAt = this.time; this.award(events, 'limiter', 'BOUNCING OFF IT', 400); }

    // Sliding close to the crowd.
    const fromCentre = Math.hypot(car.x - this.pit.x, car.y - this.pit.y);
    const edge = this.pit.ring - fromCentre;
    if (edge < 3.5 && edge > -1 && beta > 25 * DEG && car.speed > 4) {
      this.ringClose += dt;
      if (this.ringClose > 0.6) { this.ringClose = 0; this.counts.close++; this.award(events, 'crowd', 'IN THEIR FACES', 500); }
    }

    if (this.time >= this.length) { this.over = true; events.push({ type: 'end', text: 'COPS!', points: this.score }); }
    return events;
  }
}

// ------------------------------------------------------------------ circuit

/**
 * The circuit judge, after real drift judging: a lap is scored on line
 * (touching every clipping point and outer zone), angle, and the points of
 * the slides themselves.
 */
export class TrackJudge {
  constructor(track) {
    this.track = track;
    this.index = -1;
    this.lap = null;
    this.laps = [];
    this.best = null;
    this.zone = null;
  }

  update(dt, car, drift, events = []) {
    const t = this.track, n = t.nodes.length;
    const place = trackPlace(t, car.x, car.y, this.index);
    const prev = this.index;
    this.index = place.index;
    this.place = place;
    if (prev < 0) return events;

    const moved = ((place.index - prev + n + n / 2) % n) - n / 2; // nodes, signed
    // Crossing the line forwards starts (and finishes) a lap.
    const f = t.finish.index;
    const crossed = moved > 0 && ((prev < f && place.index >= f) || (prev > place.index && (place.index >= f || prev < f)));
    if (crossed && place.onTrack) {
      if (this.lap && this.lap.progress > n * 0.9) this.finishLap(events);
      this.lap = { start: car.time, progress: 0, clips: new Map(), angleSum: 0, angleTime: 0, drift: drift.total + drift.pending, time: 0 };
      events.push({ type: 'lap', text: this.laps.length ? `LAP ${this.laps.length + 1}` : 'GO', points: 0 });
    }
    if (!this.lap) return events;
    this.lap.progress += Math.max(-5, Math.min(5, moved));
    this.lap.time += dt;
    const beta = Math.abs(car.slipAngle);
    if (beta > 12 * DEG && car.speed > 6) { this.lap.angleSum += beta * dt; this.lap.angleTime += dt; }

    // Clipping points and zones.
    const box = carBox(car);
    for (const c of t.clips) {
      const key = c.id;
      if (c.kind === 'inner') {
        const ahead = ((c.index - place.index + n) % n);
        if (ahead > 12 && ahead < n - 12) continue; // only near it
        // Nearest corner or bumper to the apex marker.
        let d = Infinity;
        for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0]]) {
          const x = box.x + box.c * box.hw * sx - box.s * box.hh * sy;
          const y = box.y + box.s * box.hw * sx + box.c * box.hh * sy;
          d = Math.min(d, Math.hypot(x - c.cx, y - c.cy));
        }
        const got = beta > 15 * DEG ? clamp(1 - (d - 0.6) / 3.2, 0, 1) : 0;
        const had = this.lap.clips.get(key) || 0;
        if (got > had) this.lap.clips.set(key, got);
        if (got > 0.55 && had <= 0.55) events.push({ type: 'clip', text: got > 0.85 ? 'PERFECT CLIP' : 'CLIP', points: 0, clip: c.id });
      } else {
        const inZone = inRange(place.index, c.from, c.to, n);
        if (!inZone) continue;
        // Rear bumper towards the outer wall.
        const rx = box.x - box.c * box.hw, ry = box.y - box.s * box.hw;
        const rp = trackPlace(t, rx, ry, place.index);
        const gap = (t.half + t.wallGap) - rp.offset * c.side;
        const good = beta > 15 * DEG && gap < 3.2;
        const z = this.lap.clips.get(key) || { in: 0, good: 0 };
        z.in += dt; if (good) z.good += dt;
        this.lap.clips.set(key, z);
        if (good && z.good > 0.4 && !z.called) { z.called = true; events.push({ type: 'zone', text: 'OUTER ZONE', points: 0, clip: c.id }); }
      }
    }
    return events;
  }

  finishLap(events) {
    const t = this.track, lap = this.lap;
    let line = 0;
    for (const c of t.clips) {
      const v = lap.clips.get(c.id);
      if (c.kind === 'inner') line += v || 0;
      else line += v && v.in > 0 ? clamp(v.good / Math.max(v.in * 0.6, 0.3), 0, 1) : 0;
    }
    const lineScore = Math.round(40 * line / t.clips.length);
    const avg = lap.angleTime ? lap.angleSum / lap.angleTime / DEG : 0;
    const angleScore = Math.round(30 * clamp((avg - 8) / 30, 0, 1));
    const share = lap.time ? lap.angleTime / lap.time : 0;
    const styleScore = Math.round(30 * clamp(share / 0.7, 0, 1));
    const result = { line: lineScore, angle: angleScore, style: styleScore, total: lineScore + angleScore + styleScore, time: lap.time, avgAngle: avg };
    this.laps.push(result);
    if (!this.best || result.total > this.best.total) this.best = result;
    events.push({ type: 'lapdone', text: `${result.total} / 100`, points: result.total, result });
  }
}

function inRange(i, from, to, n) {
  return from <= to ? i >= from && i <= to : i >= from || i <= to;
}

