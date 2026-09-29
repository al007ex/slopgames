// Between the player's hands and the car. Keyboards are on/off, so the pilot
// turns key presses into the smooth inputs a real driver would make, and —
// depending on the assist level — helps the way a good drift car set-up does:
//
//  · Steering is measured from where the car is travelling, not from its nose.
//    Hands off, the front wheels trail along the direction of travel the way
//    caster makes a real wheel self-steer, which is automatic countersteer.
//    Pressing a direction always means "go that way".
//  · A spin guard stops a slide swinging past the angle the car can recover,
//    unless you commit to the spin with the handbrake (that is a rollback).
//  · A drift governor trims the throttle when the rear is spinning far past
//    what the angle needs, so holding W on a keyboard holds a drift.
//  · Pulling the handbrake dips the clutch, and letting go kicks it back in.

import { clamp, approach, smoothstep, sign, DEG } from './math.js';
import { RPM } from './vehicle.js';

export const ASSISTS = {
  easy: { align: 1, guard: 64 * DEG, guardGain: 1, servo: 1, governor: true, hbClutch: true },
  pro: { align: 0.9, guard: 78 * DEG, guardGain: 0.6, servo: 0.35, governor: false, hbClutch: true },
  off: { align: 0, guard: Infinity, guardGain: 0, servo: 0, governor: false, hbClutch: false },
};

export const blankInput = () => ({
  steer: 0, throttle: 0, brake: 0, handbrake: 0, clutch: 0, twoStep: 0,
  shiftUp: false, shiftDown: false, analog: false,
});

/** True once the steering has been held hard over, with W down, for a quarter second. */
function steerHard(p, raw, dt) {
  p.hardFor = Math.abs(p.steerIn) > 0.8 && raw.throttle > 0.5 ? (p.hardFor || 0) + dt : 0;
  return p.hardFor > 0.25;
}

export class Pilot {
  constructor(car, { assist = 'easy', manual = false } = {}) {
    this.car = car;
    this.setAssist(assist);
    this.manual = manual;
    this.steerIn = 0;
    this.throttleIn = 0;
    this.brakeIn = 0;
    this.reverseHold = 0;
    this.shiftHold = 0;
    this.shiftCool = 0;
    this.committed = 0;      // seconds left of a committed spin
    this.spinDir = 0;
    this.handbrakeWas = 0;
    this.lastMag = 0;
    this.magRate = 0;
    this.inDrift = false;
    this.driftSpeed = 0;
    this.powerOver = false;
    this.hardFor = 0;
    this.out = { steer: 0, throttle: 0, brake: 0, handbrake: 0, clutch: 0, launch: false, lineLock: false, yaw: 0 };
  }

  setAssist(level) {
    this.level = ASSISTS[level] ? level : 'easy';
    this.aid = ASSISTS[this.level];
  }

  update(dt, raw) {
    const car = this.car, s = car.spec, aid = this.aid, out = this.out;
    const speed = car.speed, u = car.forward, beta = car.slipAngle;

    // ---- smooth the hands
    const target = clamp(raw.steer, -1, 1);
    if (raw.analog) this.steerIn = approach(this.steerIn, target, 10 * dt);
    else {
      const returning = target === 0 || sign(target) !== sign(this.steerIn);
      this.steerIn = approach(this.steerIn, target, (returning ? 8 : 4.5) * dt);
    }
    this.throttleIn = raw.analog ? raw.throttle : approach(this.throttleIn, raw.throttle, (raw.throttle > this.throttleIn ? 7 : 12) * dt);
    this.brakeIn = raw.analog ? raw.brake : approach(this.brakeIn, raw.brake, (raw.brake > this.brakeIn ? 8 : 14) * dt);
    let throttle = this.throttleIn, brake = this.brakeIn;

    // ---- gears
    this.shiftCool = Math.max(0, this.shiftCool - dt);
    const burnout = speed < 4 && raw.throttle > 0.5 && raw.brake > 0.5 && car.gear >= 0;
    if (car.gear < 0) {
      // Reversing: S drives, W brakes, and W from a stop goes forward again.
      [throttle, brake] = [brake, throttle];
      if (raw.throttle > 0.1 && u > -1.5) car.shift(1);
    } else {
      if (raw.brake > 0.5 && raw.throttle < 0.1 && speed < 1.2) this.reverseHold += dt;
      else this.reverseHold = 0;
      if (this.reverseHold > 0.22) { car.shift(-1); this.reverseHold = 0; }
    }
    if (this.manual) {
      if (raw.shiftUp) car.shift(Math.max(1, car.nextGear + 1));
      if (raw.shiftDown) car.shift(car.nextGear > 1 ? car.nextGear - 1 : car.nextGear);
    } else if (car.gear > 0 && this.shiftCool === 0 && car.shiftTimer === 0) this.autoShift(dt, raw);

    // ---- clutch, launch control and line-lock burnouts
    let clutch = raw.clutch ? 1 : 0;
    const launch = !!raw.twoStep && speed < 2.5;
    if (launch) clutch = 1;
    if (raw.handbrake && aid.hbClutch) clutch = 1;
    if (burnout) { brake = 1; throttle = raw.throttle; }

    // ---- steering, measured from the direction of travel
    const a = s.cgFront;
    const betaF = Math.atan2(car.lateral + car.yawRate * a, Math.abs(u) + 1e-6);
    const drifting = smoothstep(8 * DEG, 20 * DEG, Math.abs(beta)) * smoothstep(4, 8, speed);
    const trail = aid.align * smoothstep(1.5, 5, speed) * (1 - smoothstep(75 * DEG, 105 * DEG, Math.abs(beta))) * (car.gear >= 0 ? 1 : 0);
    const range = Math.max(clamp(0.16 + 2.4 / Math.max(speed, 1), 0.2, s.steerLock), drifting * 0.34);
    // Rolling backwards in a forward gear (mid-rollback) the trailing front
    // wheels steer the other way round, so the mapping flips: holding a
    // direction keeps the car rotating that way the whole way through.
    const back = car.gear >= 0 ? smoothstep(-0.3, -2, u) : 0;
    let steer = trail * clamp(betaF, -s.steerLock, s.steerLock) + this.steerIn * range * (1 - 2 * back);

    // ---- spin guard, unless the spin is on purpose
    const intoSpin = this.steerIn * sign(beta) < -0.4; // steering the nose further round
    // Holding the handbrake until the car is well past sideways commits to the
    // rotation: the aids stand back while you keep steering the way the car is
    // turning, so it can whip right round and roll backwards (a rollback). A
    // quick tap to start an ordinary drift never commits. Let go of the
    // steering, or steer against the rotation, and the aids come back.
    if (raw.handbrake && speed > 3 && Math.abs(beta) > 45 * DEG && this.committed <= 0) {
      this.committed = 0.5;
      this.spinDir = sign(car.yawRate) || sign(this.steerIn) || 1;
    }
    if (this.committed > 0) {
      const withSpin = this.steerIn * this.spinDir > 0.3 || sign(raw.steer) === this.spinDir;
      if (raw.handbrake || withSpin) this.committed = Math.max(this.committed, 0.35);
      this.committed -= dt;
      if (speed < 1.5) this.committed = 0;
    }
    this.handbrakeWas = raw.handbrake;
    let yaw = 0;
    if (aid.guardGain > 0 && this.committed <= 0 && !raw.handbrake && speed > 7 && u > 0) {
      const over = Math.abs(beta) - aid.guard;
      const spinRate = -car.yawRate * sign(beta);
      const heat = smoothstep(-12 * DEG, 0, over);
      if (heat > 0) {
        yaw = sign(beta) * s.izz * aid.guardGain * heat * (7 * Math.max(over, 0) + 2.4 * Math.max(spinRate, 0));
      }
    }

    // ---- drift servo: hold a slide at the angle the hands ask for
    const mag = Math.abs(beta);
    const magRate = (mag - this.lastMag) / dt;
    this.magRate += (magRate - this.magRate) * Math.min(1, 20 * dt);
    this.lastMag = mag;
    const on = throttle > 0.45;
    if (u > 0 && speed > 6 && on && mag > 12 * DEG && !this.inDrift) { this.inDrift = true; this.driftSpeed = speed; }
    if (mag < 5 * DEG || speed < 4 || u <= 0) this.inDrift = false;
    if (aid.servo > 0 && this.committed <= 0 && !raw.handbrake && this.inDrift) {
      const outOf = this.steerIn * sign(beta) > 0.4; // steering out of the slide
      // Angle is how a drifter manages speed with the throttle pinned: more angle
      // scrubs speed and tightens the line, less lets the car run wide and fast.
      // The hands pick the pace (into the slide: slower and tighter, out: faster
      // and wider) and the angle follows.
      this.driftSpeed += ((intoSpin ? -4 : outOf ? 4 : 0.6) + (speed - this.driftSpeed) * 0.35) * dt;
      let target = clamp(34 * DEG + 4 * DEG * (speed - this.driftSpeed) + (intoSpin ? 8 * DEG : outOf ? -14 * DEG : 0), 8 * DEG, 56 * DEG);
      if (!on) target = Math.min(mag, 30 * DEG); // off the throttle a slide only ever shrinks
      let err = target - mag; // + wants more angle
      if (!on && err > 0) err = 0;
      const k = aid.servo * s.izz;
      // + yaw turns the nose left, which grows a left slide (β < 0) and shrinks a right one.
      const t = k * clamp(4.5 * err - 1.8 * this.magRate, -6, 3.2);
      yaw += -sign(beta) * t;
    }

    // ---- traction control, easy only: straight-line and ordinary corners stay
    // tidy, but a deliberate power-over (full lock and W held) still breaks loose.
    if (steerHard(this, raw, dt) && aid.governor) this.powerOver = true;
    if (Math.abs(this.steerIn) < 0.5) this.powerOver = false;
    if (aid.governor && !this.inDrift && !this.powerOver && this.committed <= 0 && !burnout && !launch
      && car.gear > 0 && speed > 4 && mag < 10 * DEG && !raw.handbrake && !raw.clutch) {
      const spin = car.wr * s.wheelRadius - u;
      const cap = 1.2 + 0.1 * speed;
      throttle *= 1 - 0.85 * smoothstep(cap, cap * 2.2, spin);
    }

    // ---- drift governor: keep the rears from spinning far past what the slide needs
    if (aid.governor && drifting > 0 && u > 0 && throttle > 0 && this.committed <= 0) {
      const spin = car.wr * s.wheelRadius - u;
      const spinCap = 5 + 0.6 * speed;
      throttle *= 1 - 0.7 * smoothstep(spinCap, spinCap * 1.7, spin) * drifting;
    }

    out.steer = steer;
    yaw = clamp(yaw, -s.izz * 7, s.izz * 7);
    out.throttle = throttle;
    out.brake = brake;
    out.handbrake = raw.handbrake ? 1 : 0;
    out.clutch = clutch;
    out.launch = launch;
    out.lineLock = burnout;
    out.yaw = yaw;
    return out;
  }

  autoShift(dt, raw) {
    const car = this.car, s = car.spec, e = s.engine, R = s.wheelRadius;
    // Ground speed, not forward speed: sideways, the rears still turn at about the car's speed.
    const ground = (car.forward > 0 ? car.speed : 0) / R;
    const groundRpm = (g) => ground * car.ratio(g) * RPM;
    const g = car.gear, top = s.gears.length;
    const sliding = Math.abs(car.slipAngle) > 14 * DEG;
    let wantUp, wantDown;
    if (sliding) {
      // Mid-slide the gear is held: only a long stay on the limiter, or revs
      // falling right off the powerband, moves it.
      this.limiterTime = car.rpm > e.limit * 0.96 ? (this.limiterTime || 0) + dt : 0;
      wantUp = g < top && this.limiterTime > 0.5 && groundRpm(g + 1) > e.limit * 0.42;
      wantDown = g > 1 && groundRpm(g) < e.limit * 0.3 && groundRpm(g - 1) < e.limit * 0.8;
    } else {
      this.limiterTime = 0;
      wantUp = g < top && (groundRpm(g) > e.limit * 0.94
        || (car.rpm > e.limit * 0.96 && groundRpm(g + 1) > e.limit * 0.45 && raw.throttle > 0.5));
      wantDown = g > 1 && groundRpm(g - 1) < e.limit * 0.86
        && (groundRpm(g) < e.limit * 0.4 || (raw.throttle > 0.9 && groundRpm(g) < e.limit * 0.55));
    }
    this.shiftHold = wantUp || wantDown ? this.shiftHold + dt : 0;
    if (this.shiftHold > (wantUp ? 0.12 : 0.3)) {
      car.shift(wantUp ? g + 1 : g - 1);
      this.shiftHold = 0;
      this.shiftCool = 0.8;
    }
  }
}
