import { Vehicle, STEP } from '../shared/vehicle.js';
import { Pilot, blankInput } from '../shared/pilot.js';
import { carById } from '../shared/cars.js';
import { DEG, wrap, clamp } from '../shared/math.js';

// A keyboard driver circling a point: every 0.1 s it decides left / right / nothing.
export function circleDrift(id, { assist = 'easy', R0 = 28, seconds = 16, verbose = false, entry = 'handbrake', speed0 = 60, human = false } = {}) {
  const car = new Vehicle(carById(id));
  const pilot = new Pilot(car, { assist });
  const raw = blankInput();
  let cx = 0, cy = R0;
  let t = 0, next = 0, phase = 'run', pulseEnd = 0;
  const stats = { drift: 0, spun: false, rErr: 0, n: 0, maxBeta: 0, minKmh: 999, maxKmh: 0 };
  const log = [];
  for (let i = 0; t < seconds; i++) {
    const dx = car.x - cx, dy = car.y - cy;
    const rad = Math.hypot(dx, dy);
    const tangent = Math.atan2(dy, dx) + Math.PI / 2;
    if (t >= next) {
      next = t + 0.1;
      if (phase === 'run') {
        raw.throttle = 1; raw.steer = 0;
        // Straight along x until the car is below the circle's bottom, at speed.
        if (car.speed * 3.6 > speed0) { phase = 'entry'; stats.entryAt = t; const h = Math.atan2(car.vy, car.vx); cx = car.x - Math.sin(h) * R0; cy = car.y + Math.cos(h) * R0; }
      } else if (phase === 'entry') {
        raw.steer = 1;
        if (entry === 'handbrake') raw.handbrake = t - stats.entryAt < 0.35 ? 1 : 0;
        if (entry === 'clutch') raw.clutch = t - stats.entryAt < 0.25 ? 1 : 0;
        if (t - stats.entryAt > 0.5) { phase = 'hold'; raw.handbrake = 0; raw.clutch = 0; }
      } else {
        // Tap the keys: a press as long as the error is large, like a person would.
        const want = tangent + clamp(0.05 * (rad - R0), -0.5, 0.5);
        const vel = Math.atan2(car.vy, car.vx);
        const err = wrap(want - vel);
        const duty = clamp(Math.abs(err) / 0.3, 0, 1);
        raw.steer = Math.abs(err) < 0.04 ? 0 : Math.sign(err);
        pulseEnd = t + 0.1 * duty;
        const b = Math.abs(car.slipAngle) / DEG;
        // Ease off when the corner is too tight for this speed, like anyone would.
        raw.throttle = 1;
        if (human) { if (b > 58) raw.throttle = 0; }
      }
    }
    if (phase === 'hold' && t > pulseEnd) raw.steer = 0;
    const c = pilot.update(STEP, raw);
    car.step(STEP, c);
    car.events.length = 0;
    t += STEP;
    if (phase === 'hold' && t - stats.entryAt > 2) {
      const b = Math.abs(car.slipAngle) / DEG;
      stats.n++;
      if (b > 15 && b < 80) stats.drift++;
      if (b > 100) stats.spun = true;
      stats.rErr += Math.abs(rad - R0);
      stats.maxBeta = Math.max(stats.maxBeta, b);
      stats.minKmh = Math.min(stats.minKmh, car.speed * 3.6);
      stats.maxKmh = Math.max(stats.maxKmh, car.speed * 3.6);
    }
    if (verbose && i % 48 === 0) log.push({ t: t.toFixed(1), ph: phase, kmh: (car.speed * 3.6).toFixed(0), rpm: car.rpm.toFixed(0), g: car.gear, beta: (car.slipAngle / DEG).toFixed(0), rad: rad.toFixed(1), st: raw.steer, delta: (car.steer / DEG).toFixed(0), thr: c.throttle.toFixed(2), yawA: (c.yaw/car.spec.izz).toFixed(2), spin: (car.wr * car.spec.wheelRadius - car.forward).toFixed(1) });
  }
  stats.driftShare = stats.drift / Math.max(1, stats.n);
  stats.rErr /= Math.max(1, stats.n);
  if (verbose) console.table(log);
  return stats;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const id = process.argv[2] || 'ronin';
  const assist = process.argv[3] || 'easy';
  const s = circleDrift(id, { assist, verbose: process.argv.includes('-v'), R0: Number(process.argv[4] || 28), entry: process.argv[5] || 'handbrake', human: process.argv.includes('-h') });
  console.log(id, assist, JSON.stringify({ driftShare: s.driftShare.toFixed(2), spun: s.spun, rErr: s.rErr.toFixed(1), maxBeta: s.maxBeta.toFixed(0), kmh: `${s.minKmh.toFixed(0)}-${s.maxKmh.toFixed(0)}` }));
}
