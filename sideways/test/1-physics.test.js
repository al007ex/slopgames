// The car itself: that it goes, stops and turns like a car, and that every
// move the game is about can be done with nothing but a keyboard.

import { ok, near, section } from './harness.js';
import { drive, circleDrift } from './drive.js';
import { CARS } from '#shared/cars.js';
import { DEG, rng } from '#shared/math.js';
import { Vehicle, STEP } from '#shared/vehicle.js';
import { Pilot, blankInput } from '#shared/pilot.js';

const kmh = (car) => car.speed * 3.6;

section('Straight line');
for (const spec of CARS) {
  let t100 = null;
  const { car } = drive(spec.id, 30, (t, k, c) => { k.throttle = 1; if (t100 === null && kmh(c) >= 100) t100 = t; });
  ok(t100 > 3.2 && t100 < 7.5, `${spec.name}: 0–100 km/h in ${t100?.toFixed(2)} s`);
  ok(kmh(car) > 220, `${spec.name}: still pulling at ${kmh(car).toFixed(0)} km/h after 30 s`);
  ok(car.gear >= 5, `${spec.name}: the gearbox climbs to ${car.gear}th on its own`);

  let from = null, stopped = null;
  const b = drive(spec.id, 20, (t, k, c) => {
    if (from === null) { k.throttle = 1; if (kmh(c) >= 100) from = { x: c.x, y: c.y }; }
    else { k.throttle = 0; k.brake = 1; }
  }, { watch: (t, c) => { if (from && stopped === null && c.speed < 0.3) stopped = Math.hypot(c.x - from.x, c.y - from.y); } });
  ok(stopped > 28 && stopped < 55, `${spec.name}: stops from 100 in ${stopped?.toFixed(1)} m`);
  void b;
}

section('Grip');
{
  // Round a 60 m circle at a steady 60 km/h, tapping to hold the line: no slide.
  const R = 60;
  let maxBeta = 0, sumAy = 0, n = 0, off = 0, next = 0, pulse = 0;
  drive('ronin', 16, (t, k, c) => {
    k.throttle = kmh(c) < 60 ? 1 : 0;
    if (t >= next) {
      next = t + 0.1;
      const rad = Math.hypot(c.x, c.y - R);
      const tangent = Math.atan2(c.y - R, c.x) + Math.PI / 2;
      const err = Math.atan2(Math.sin(tangent + 0.05 * (rad - R) - Math.atan2(c.vy, c.vx)), Math.cos(tangent + 0.05 * (rad - R) - Math.atan2(c.vy, c.vx)));
      k.steer = Math.sign(err);
      pulse = t + 0.1 * Math.min(1, Math.abs(err) / 0.15);
    }
    if (t > pulse) k.steer = 0;
  }, { watch: (t, c) => { if (t > 8) { maxBeta = Math.max(maxBeta, Math.abs(c.slipAngle)); sumAy += Math.abs(c.ay); n++; off = Math.max(off, Math.abs(Math.hypot(c.x, c.y - R) - R)); } } });
  ok(maxBeta < 6 * DEG, `a steady corner stays in grip (slip angle at most ${(maxBeta / DEG).toFixed(1)}°)`);
  ok(off < 3, `and holds the line to within ${off.toFixed(1)} m`);
  near(sumAy / n / 9.81, (60 / 3.6) ** 2 / R / 9.81, 0.08, `pulling the ${((60 / 3.6) ** 2 / R / 9.81).toFixed(2)} g the corner needs`);
}

section('Holding a drift on a keyboard (easy)');
for (const spec of CARS) {
  for (const R0 of [30, 45, 70]) {
    const s = circleDrift(spec.id, { R0 });
    ok(s.share > 0.9 && !s.spun && s.rErr < 6,
      `${spec.name}, ${R0} m circle: sideways ${(s.share * 100).toFixed(0)}% of the time, never spun, ${s.rErr.toFixed(1)} m off the line`);
  }
  const k = circleDrift(spec.id, { R0: 45, entry: 'clutch' });
  ok(k.share > 0.85 && !k.spun, `${spec.name}: a clutch kick starts one too (${(k.share * 100).toFixed(0)}%)`);
  const g = circleDrift(spec.id, { R0: 45, seconds: 20 });
  ok(g.shifts <= 2, `${spec.name}: the gearbox holds its gear through the slide (${g.shifts} shifts)`);
}

section('Letting go ends a drift');
{
  let settled = null;
  drive('ronin', 10, (t, k, c, st) => {
    if (!st.at) { k.throttle = 1; if (kmh(c) > 60) st.at = t; return; }
    const since = t - st.at;
    k.steer = since < 2 ? 1 : 0;
    k.handbrake = since < 0.35 ? 1 : 0;
    k.throttle = since < 3 ? 1 : 0;
  }, { watch: (t, c, ctl, st) => { if (st.at && t - st.at > 3 && settled === null && Math.abs(c.slipAngle) < 5 * DEG) settled = t - st.at - 3; } });
  ok(settled !== null && settled < 2.2, `off the throttle and the wheel, the car straightens itself in ${settled?.toFixed(2)} s`);
}

section('Donuts');
for (const spec of CARS) {
  let far = 0;
  const { car } = drive(spec.id, 10, (t, k) => { k.throttle = 1; k.steer = t > 0.3 ? 1 : 0; },
    { watch: (t, c) => { if (t > 3) far = Math.max(far, Math.hypot(c.x, c.y)); } });
  const turns = car.heading / (2 * Math.PI);
  ok(turns > 2.2, `${spec.name}: hold a direction and W from a stop, ${turns.toFixed(1)} turns in 10 s`);
  ok(far < 9, `${spec.name}: …spinning on the spot (never more than ${far.toFixed(1)} m out)`);
}

section('Rollbacks');
for (const spec of CARS) {
  let back = 0, maxBeta = 0, cameRound = null, rotated = 0;
  const events = [];
  drive(spec.id, 9, (t, k, c, st) => {
    k.throttle = 1;
    if (!st.go && kmh(c) > 55) { st.go = t; st.h0 = c.heading; }
    if (!st.go) return;
    // Hold the handbrake until it is past sideways, then keep the direction held
    // until the car has come all the way round, then let go.
    k.handbrake = t - st.go < 0.3 || (k.handbrake && Math.abs(c.slipAngle) < 70 * DEG) ? 1 : 0;
    // Hold the direction until the car has come all the way round, then let go.
    k.steer = st.h0 - c.heading < 5.5 ? -1 : 0;
  }, {
    events,
    watch: (t, c, ctl, st) => {
      if (!st.go) return;
      if (c.forward < back) back = c.forward;
      maxBeta = Math.max(maxBeta, Math.abs(c.slipAngle));
      rotated = st.h0 - c.heading;
      if (back < -3 && cameRound === null && c.forward > 2 && Math.abs(c.slipAngle) < 60 * DEG) cameRound = t - st.go;
    },
  });
  ok(maxBeta > 150 * DEG && back < -3, `${spec.name}: holding the handbrake + steer whips it round to roll backwards (${(-back).toFixed(1)} m/s back, ${(maxBeta / DEG).toFixed(0)}°)`);
  ok(cameRound !== null && cameRound < 5, `${spec.name}: …and keeps coming round to drive on forwards (${cameRound?.toFixed(1)} s)`);
  ok(rotated > 5.2, `${spec.name}: a full ${(rotated / DEG).toFixed(0)}° of rotation`);
}

section('Takeover moves');
for (const spec of CARS) {
  let wheel = 0, moved = 0;
  drive(spec.id, 4, (t, k) => { k.throttle = 1; k.brake = 1; },
    { watch: (t, c) => { if (t > 2) { wheel = Math.max(wheel, c.wr * spec.wheelRadius); moved = Math.hypot(c.x, c.y); } } });
  ok(wheel > 10 && moved < 1.5, `${spec.name}: W + S from a stop is a burnout (rears at ${(wheel * 3.6).toFixed(0)} km/h, car moved ${moved.toFixed(2)} m)`);

  const events = [];
  let peak = 0;
  drive(spec.id, 4, (t, k) => { k.throttle = 1; k.clutch = 1; }, { events, watch: (t, c) => { if (t > 1) peak = Math.max(peak, c.rpm); } });
  const cuts = events.filter((e) => e.type === 'cut').length;
  const pops = events.filter((e) => e.type === 'pop').length;
  ok(cuts / 3 > 3 && cuts / 3 < 40, `${spec.name}: clutch in and W bounces the limiter ${(cuts / 3).toFixed(0)} times a second`);
  ok(pops > 3, `${spec.name}: …with ${pops} bangs and flames`);
  ok(peak < spec.engine.limit + 300, `${spec.name}: …never overrevving (${peak.toFixed(0)} rpm)`);

  const ev2 = [];
  let hi = 0, lo = Infinity;
  drive(spec.id, 4, (t, k) => { k.throttle = 1; k.twoStep = 1; }, { events: ev2, watch: (t, c) => { if (t > 1.5) { hi = Math.max(hi, c.rpm); lo = Math.min(lo, c.rpm); } } });
  ok(hi < spec.engine.launch + 350 && lo > spec.engine.launch - 1200, `${spec.name}: the two-step holds ${lo.toFixed(0)}–${hi.toFixed(0)} rpm`);
  ok(ev2.filter((e) => e.type === 'pop').length > 5, `${spec.name}: …banging away`);
}

section('Reverse');
{
  let reversed = false, back = 0;
  const { car } = drive('ronin', 6, (t, k, c) => {
    if (t < 3) { k.brake = 1; k.throttle = 0; } else { k.brake = 0; k.throttle = 1; }
  }, { watch: (t, c) => { if (c.gear < 0) reversed = true; back = Math.min(back, c.forward); } });
  ok(reversed && back < -1.5, `hold S at a stop and it reverses (${(-back * 3.6).toFixed(0)} km/h)`);
  ok(car.gear === 1 && car.forward > 1, 'and W takes it forwards again');
}

section('Robustness');
{
  const random = rng(99);
  let worst = 0, finite = true;
  for (const spec of CARS) {
    drive(spec.id, 400, (t, k) => {
      if (random() < 0.02) k.steer = Math.floor(random() * 3) - 1;
      if (random() < 0.02) k.throttle = random() < 0.7 ? 1 : 0;
      if (random() < 0.01) k.brake = random() < 0.3 ? 1 : 0;
      if (random() < 0.01) k.handbrake = random() < 0.2 ? 1 : 0;
      if (random() < 0.005) k.clutch = random() < 0.2 ? 1 : 0;
      if (random() < 0.003) k.twoStep = random() < 0.2 ? 1 : 0;
    }, { watch: (t, c) => {
      if (!Number.isFinite(c.x + c.y + c.heading + c.vx + c.vy + c.yawRate + c.wr + c.wf + c.we)) finite = false;
      worst = Math.max(worst, c.speed);
    } });
  }
  ok(finite, 'twenty minutes of random mashing never breaks the maths');
  ok(worst < 105, `and never goes faster than a car can (${(worst * 3.6).toFixed(0)} km/h)`);

  const run = () => drive('brute', 20, (t, k) => { k.throttle = 1; k.steer = Math.sin(t * 1.3) > 0 ? 1 : -1; k.handbrake = t % 5 < 0.3 ? 1 : 0; }).car;
  const a = run(), b = run();
  ok(a.x === b.x && a.y === b.y && a.heading === b.heading, 'the same keys give exactly the same run');

  let used = false;
  drive('ronin', 20, (t, k) => { k.throttle = 1; k.steer = t > 3 ? 1 : 0; k.handbrake = t > 3 && t < 3.3 ? 1 : 0; }, { assist: 'off', watch: (t, c, ctl) => { if (ctl.yaw !== 0) used = true; } });
  ok(!used, 'with assists off, nothing but the tyres turns the car');

  // Frame-rate independence: the client always steps at the fixed rate.
  const car = new Vehicle(CARS[0]);
  const p = new Pilot(car);
  const keys = blankInput(); keys.throttle = 1;
  for (let i = 0; i < 240; i++) car.step(STEP, p.update(STEP, keys));
  near(car.time, 1, 1e-9, 'the simulation clock is exact');
}
