import { Vehicle, STEP } from '../shared/vehicle.js';
import { Pilot, blankInput } from '../shared/pilot.js';
import { carById } from '../shared/cars.js';
import { DEG, wrap } from '../shared/math.js';
const id = process.argv[2] || 'ronin', assist = process.argv[3] || 'easy';
for (const steer of [1, 0.5, 0, -0.5]) for (const thr of [1, 0.7, 0.4]) {
  const car = new Vehicle(carById(id)); const p = new Pilot(car, { assist }); const raw = blankInput();
  let t = 0, phase = 0, t0 = 0; const acc = { n: 0, beta: 0, v: 0, curv: 0 }; let lastPhi = 0;
  while (t < 14) {
    if (phase === 0) { raw.throttle = 1; if (car.speed > 60 / 3.6) { phase = 1; t0 = t; } }
    else if (phase === 1) { raw.steer = 1; raw.handbrake = t - t0 < 0.35 ? 1 : 0; if (t - t0 > 0.6) { phase = 2; raw.handbrake = 0; } }
    else {
      raw.steer = Math.abs(steer) === 0.5 ? ((t * 10) % 1 < 0.5 ? Math.sign(steer) : 0) : steer;
      raw.throttle = thr === 1 ? 1 : ((t * 10) % 1 < thr ? 1 : 0);
    }
    const c = p.update(STEP, raw); car.step(STEP, c); car.events.length = 0; t += STEP;
    const phi = Math.atan2(car.vy, car.vx);
    if (phase === 2 && t - t0 > 4) { acc.n++; acc.beta += car.slipAngle; acc.v += car.speed; acc.curv += wrap(phi - lastPhi) / STEP / Math.max(car.speed, 0.1); }
    lastPhi = phi;
  }
  const n = acc.n;
  console.log(`steer ${String(steer).padStart(4)} thr ${thr}: beta ${(acc.beta / n / DEG).toFixed(0).padStart(4)}°  v ${(acc.v / n * 3.6).toFixed(0).padStart(3)} km/h  radius ${(1 / (acc.curv / n)).toFixed(1).padStart(6)} m  end β ${(car.slipAngle/DEG).toFixed(0)} gear ${car.gear}`);
}
