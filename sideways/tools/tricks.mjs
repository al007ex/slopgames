import { Vehicle, STEP } from '../shared/vehicle.js';
import { Pilot, blankInput } from '../shared/pilot.js';
import { carById } from '../shared/cars.js';
import { DEG, wrap } from '../shared/math.js';

export function sim(id, assist, seconds, script, every = 0.25) {
  const car = new Vehicle(carById(id)); const p = new Pilot(car, { assist }); const raw = blankInput();
  const log = []; let t = 0, next = 0; const st = {};
  while (t < seconds) {
    script(t, raw, car, st);
    const c = p.update(STEP, raw); car.step(STEP, c); car.events.length = 0; t += STEP;
    if (t >= next) { next += every; log.push({ t: t.toFixed(2), kmh: (car.speed * 3.6).toFixed(0), fwd: car.forward.toFixed(1), beta: (car.slipAngle / DEG).toFixed(0), head: (car.heading / DEG).toFixed(0), yaw: car.yawRate.toFixed(2), rpm: car.rpm.toFixed(0), g: car.gear, spin: (car.wr * car.spec.wheelRadius).toFixed(1), x: car.x.toFixed(1), y: car.y.toFixed(1), st: raw.steer, hb: raw.handbrake, thr: c.throttle.toFixed(2), yawA: (c.yaw / car.spec.izz).toFixed(1) }); }
  }
  return { car, log };
}

const [,, what = 'donut', id = 'brute', assist = 'easy'] = process.argv;
if (what === 'donut') {
  const { car, log } = sim(id, assist, 10, (t, raw) => { raw.throttle = 1; raw.steer = t > 0.3 ? 1 : 0; });
  console.table(log.filter((_, i) => i % 2 === 0));
  console.log('turns', (car.heading / (2 * Math.PI)).toFixed(2));
}
if (what === 'rollback') {
  const { car, log } = sim(id, assist, 8, (t, raw, car, st) => {
    raw.throttle = 1;
    if (!st.go && car.speed * 3.6 > 55) st.go = t;
    if (st.go) { raw.steer = -1; raw.handbrake = t - st.go < 0.3 ? 1 : 0; }
  }, 0.1);
  console.table(log.filter((_, i) => i >= 20 && i % 2 === 0));
}
