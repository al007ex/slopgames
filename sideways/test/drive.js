// A scripted driver for the tests. It only ever does what a person on a
// keyboard can: hold or tap keys, deciding at most ten times a second.

import { Vehicle, STEP } from '#shared/vehicle.js';
import { Pilot, blankInput } from '#shared/pilot.js';
import { carById } from '#shared/cars.js';
import { DEG, wrap, clamp } from '#shared/math.js';

/**
 * Drive for `seconds`, calling `script(t, keys, car, state)` every step.
 * `watch(t, car, controls)` sees every step too. Returns the car and pilot.
 */
export function drive(id, seconds, script, { assist = 'easy', manual = false, watch = null, seed = 7, events = null } = {}) {
  const car = new Vehicle(carById(id), seed);
  const pilot = new Pilot(car, { assist, manual });
  const keys = blankInput();
  const state = {};
  let t = 0;
  while (t < seconds) {
    script(t, keys, car, state);
    const c = pilot.update(STEP, keys);
    car.step(STEP, c);
    if (events) car.takeEvents(events); else car.events.length = 0;
    keys.shiftUp = keys.shiftDown = false;
    t += STEP;
    if (watch) watch(t, car, c, state);
  }
  return { car, pilot, state };
}

/**
 * Run up to speed, flick into a drift (handbrake or clutch kick), then hold
 * it round a circle of radius R0 by tapping left and right with W held.
 */
export function circleDrift(id, { assist = 'easy', R0 = 40, seconds = 16, entry = 'handbrake', speed0 = 60 } = {}) {
  const stats = { n: 0, drift: 0, spun: false, rErr: 0, maxBeta: 0, shifts: 0 };
  let cx = 0, cy = 0, next = 0, phase = 'run', pulseEnd = 0, entryAt = 0, lastGear = 0;
  drive(id, seconds, (t, k, car) => {
    const dx = car.x - cx, dy = car.y - cy;
    const rad = Math.hypot(dx, dy);
    if (t >= next) {
      next = t + 0.1;
      if (phase === 'run') {
        k.throttle = 1;
        if (car.speed * 3.6 > speed0) {
          phase = 'entry'; entryAt = t;
          const h = Math.atan2(car.vy, car.vx);
          cx = car.x - Math.sin(h) * R0; cy = car.y + Math.cos(h) * R0;
        }
      } else if (phase === 'entry') {
        k.steer = 1;
        k.handbrake = entry === 'handbrake' && t - entryAt < 0.35 ? 1 : 0;
        k.clutch = entry === 'clutch' && t - entryAt < 0.25 ? 1 : 0;
        if (t - entryAt > 0.5) { phase = 'hold'; k.handbrake = 0; k.clutch = 0; }
      } else {
        const tangent = Math.atan2(dy, dx) + Math.PI / 2;
        const want = tangent + clamp(0.05 * (rad - R0), -0.5, 0.5);
        const err = wrap(want - Math.atan2(car.vy, car.vx));
        k.steer = Math.abs(err) < 0.04 ? 0 : Math.sign(err);
        pulseEnd = t + 0.1 * clamp(Math.abs(err) / 0.3, 0, 1);
        k.throttle = 1;
      }
    }
    if (phase === 'hold' && t > pulseEnd) k.steer = 0;
  }, {
    assist,
    watch: (t, car) => {
      if (phase !== 'hold' || t - entryAt < 2.5) { lastGear = car.gear; return; }
      const b = Math.abs(car.slipAngle) / DEG;
      stats.n++;
      if (b > 12 && b < 80) stats.drift++;
      if (b > 100) stats.spun = true;
      stats.rErr += Math.abs(Math.hypot(car.x - cx, car.y - cy) - R0);
      stats.maxBeta = Math.max(stats.maxBeta, b);
      if (car.gear !== lastGear) stats.shifts++;
      lastGear = car.gear;
    },
  });
  stats.share = stats.drift / Math.max(1, stats.n);
  stats.rErr /= Math.max(1, stats.n);
  return stats;
}
