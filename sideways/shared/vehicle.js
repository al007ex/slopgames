// The car: a two-axle rigid body on combined-slip tyres, with a real drivetrain
// (engine, clutch, gearbox and a welded rear diff). It runs at a fixed step and
// is pure — no DOM, no time source — so the client and the tests run the very
// same thing.
//
// Frames: the world is a plane, x east and y north; heading is measured
// anticlockwise from +x. In the car's frame u is forward and w is to the left;
// a positive steer angle points the front wheels left.

import { G, clamp, approach, table, rng, sign, smoothstep } from './math.js';

export const STEP = 1 / 240;
export const RPM = 60 / (2 * Math.PI);
const ETA = 0.9; // drivetrain efficiency

/** Normalised friction: rises to 1 at the peak slip (x = 1), then eases down to `slide`. */
export function frictionCurve(x, slide, fall) {
  if (x < 1) return x * (2 - x);
  return slide + (1 - slide) * Math.exp(-(x - 1) * fall);
}

/**
 * One axle's tyres. vx/vy is the contact patch's velocity in the wheel's frame,
 * spin the tread's surface speed (ω·R). Writes the force (wheel frame) to `out`.
 */
export function tireForce(out, t, grip, fz0, fz, vx, vy, spin) {
  const d = Math.max(Math.abs(vx), Math.abs(spin), t.vMin);
  const nx = (spin - vx) / d / t.peakLong;
  const ny = -vy / d / t.peakLat;
  const x = Math.hypot(nx, ny);
  const mu = t.mu * grip * (1 - t.loadSens * (fz / fz0 - 1));
  const k = x > 1e-9 ? mu * fz * frictionCurve(x, t.slide, t.fall) / x : 0;
  out.fx = k * nx;
  out.fy = k * ny;
  out.slip = x;
  out.slide = Math.hypot(vx - spin, vy);
  out.fz = fz;
  return out;
}

const axle = () => ({ fx: 0, fy: 0, slip: 0, slide: 0, fz: 0 });

export class Vehicle {
  constructor(spec, seed = 7) {
    this.spec = spec;
    this.random = rng(seed);
    this.fz0 = spec.mass * G / 2;
    this.events = [];
    this.front = axle();
    this.rear = axle();
    this._a = axle();
    this._b = axle();
    this.reset(0, 0, 0);
  }

  reset(x, y, heading) {
    const e = this.spec.engine;
    Object.assign(this, {
      x, y, heading,
      vx: 0, vy: 0, yawRate: 0,
      steer: 0,
      wf: 0, wr: 0,
      we: e.idle / RPM,
      gear: 1, nextGear: 1, shiftTimer: 0, engage: 1,
      clutchLocked: false,
      cut: false, launch: false,
      boost: 0,
      ax: 0, ay: 0,
      throttle: 0, lastThrottle: 0, overrun: 0,
      torque: 0, load: 0,
      rpm: e.idle,
      time: 0,
    });
    this.events.length = 0;
  }

  /** Signed overall ratio from wheel to engine; 0 in neutral. */
  ratio(gear = this.gear) {
    const s = this.spec;
    if (gear > 0) return s.gears[gear - 1] * s.finalDrive;
    if (gear < 0) return -s.reverse * s.finalDrive;
    return 0;
  }

  get forward() { return this.vx * Math.cos(this.heading) + this.vy * Math.sin(this.heading); }
  get lateral() { return -this.vx * Math.sin(this.heading) + this.vy * Math.cos(this.heading); }
  get speed() { return Math.hypot(this.vx, this.vy); }
  /** Angle between where the car points and where it is going (+ = nose right of travel). */
  get slipAngle() { return this.speed < 0.5 ? 0 : Math.atan2(this.lateral, this.forward); }

  shift(gear) {
    const s = this.spec;
    gear = clamp(gear, -1, s.gears.length);
    if (gear === this.nextGear) return;
    if (gear > this.gear && this.gear > 0 && this.throttle > 0.6) this.events.push({ type: 'pop', size: 0.8 });
    this.nextGear = gear;
    this.shiftTimer = s.shiftTime;
    this.engage = 0;
    this.clutchLocked = false;
    this.events.push({ type: 'shift', gear });
  }

  /**
   * Advance one fixed step. `c` is what reaches the car after the driver aids:
   * { steer (rad), throttle, brake, handbrake, clutch (0‒1, 1 = pedal down), launch, yaw (N·m) }
   */
  step(dt, c) {
    const s = this.spec, e = s.engine, t = s.tire, R = s.wheelRadius;
    this.time += dt;

    // Steering rack.
    this.steer = approach(this.steer, clamp(c.steer, -s.steerLock, s.steerLock), s.steerRate * dt);

    // Car-frame velocities.
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    const u = this.vx * ch + this.vy * sh;
    const w = -this.vx * sh + this.vy * ch;
    const r = this.yawRate;
    const L = s.wheelbase, a = s.cgFront, b = L - a;

    // Loads, with the longitudinal transfer from last step's (filtered) acceleration.
    const shiftLoad = s.mass * this.ax * s.cgHeight / L;
    const fzF = Math.max(s.mass * G * b / L - shiftLoad, 0.15 * s.mass * G);
    const fzR = Math.max(s.mass * G * a / L + shiftLoad, 0.15 * s.mass * G);
    const lat = 1 - s.latLoss * Math.min(1, (this.ay / G) ** 2);
    const gripF = s.grip[0] * lat, gripR = s.grip[1] * lat;

    // Contact patch velocities, front in the steered wheel frame.
    const cd = Math.cos(this.steer), sd = Math.sin(this.steer);
    const wF = w + r * a;
    const vxF = u * cd + wF * sd, vyF = -u * sd + wF * cd;
    const vxR = u, vyR = w - r * b;

    // ---- engine
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    if (this.shiftTimer === 0 && this.gear !== this.nextGear) this.gear = this.nextGear;
    const shifting = this.shiftTimer > 0;
    if (shifting && this.nextGear > 0 && this.wr > 0) {
      // Mid-shift the revs fall (or, blipped, rise) to meet the next gear.
      const meet = this.ratio(this.nextGear) * this.wr;
      this.we += clamp(meet - this.we, -900 * dt, 900 * dt);
    }
    if (!shifting) this.engage = Math.min(1, this.engage + dt / 0.2);
    const rpm = this.we * RPM;
    this.launch = !!c.launch;
    const limit = this.launch ? e.launch : e.limit;
    if (rpm > limit) {
      if (!this.cut) this.events.push({ type: 'cut', launch: this.launch });
      if (!this.cut && this.random() < (this.launch ? 0.95 : e.pops)) this.events.push({ type: 'pop', size: this.launch ? 1.2 : 0.9 + this.random() * 0.3 });
      this.cut = true;
    } else if (this.cut && rpm < limit - e.hyst) this.cut = false;

    let throttle = shifting ? 0 : clamp(c.throttle, 0, 1);
    this.throttle = throttle;
    // Idle governor.
    if (rpm < e.idle * 1.08) throttle = Math.max(throttle, clamp((e.idle * 1.08 - rpm) / 260, 0, 0.3));

    // Boost.
    if (e.turbo) {
      const tb = e.turbo;
      const target = this.launch ? 1 : c.throttle > 0.3 ? smoothstep(tb.spoolFrom, tb.spoolTo, rpm) * c.throttle : 0;
      const rate = target > this.boost ? 1 / tb.up : 1 / tb.down;
      if (this.boost > 0.45 && c.throttle < 0.2 && this.lastThrottle >= 0.2) this.events.push({ type: 'bov', size: this.boost });
      this.boost = approach(this.boost, target, rate * dt);
    } else if (e.supercharger) {
      this.boost = clamp(rpm / e.limit, 0, 1) * (0.3 + 0.7 * c.throttle);
    }
    const boostMul = e.turbo ? e.turbo.na + (1 - e.turbo.na) * this.boost : 1;
    const peak = table(e.torque, rpm) * boostMul;
    const combustion = this.cut ? 0 : throttle * peak;
    const drag = e.friction[0] + e.friction[1] * rpm;
    const Te = combustion - drag;
    this.torque = combustion;
    this.load = peak > 0 ? combustion / peak : 0;

    // Overrun crackle: lift off from high revs and the exhaust pops for a moment.
    if (c.throttle < 0.1 && this.lastThrottle >= 0.5 && rpm > 3600) this.overrun = 0.5 + this.random() * 0.9;
    if (this.overrun > 0) {
      this.overrun -= dt;
      if (c.throttle > 0.2 || rpm < 2600) this.overrun = 0;
      else if (this.random() < dt * 11) this.events.push({ type: 'pop', size: 0.35 + this.random() * 0.4 });
    }
    this.lastThrottle = c.throttle;

    // ---- clutch, gearbox and wheels
    const Gr = shifting ? 0 : this.ratio();
    const Ie = e.inertia, Ir = s.wheelInertia[1], If = s.wheelInertia[0];
    const pedal = clamp(c.clutch || 0, 0, 1);
    // Above idle on the gearbox side the clutch bites fully; below it (pulling
    // away, or the car rolling against its gear) it slips like a launch clutch,
    // biting harder as the revs rise, so the engine never stalls.
    const inRpm = this.wr * Gr * RPM;
    // With the throttle down it lets the engine climb towards its stall speed
    // first, like a torque converter, so there is torque to break the rears loose.
    const stall = e.idle * 1.05 + clamp(c.throttle, 0, 1) * (e.stall - e.idle * 1.05);
    const bite = inRpm > e.idle * 1.3 ? 1 : clamp((rpm - stall) / 700, 0, 1);
    // After a shift the clutch is let out over a fifth of a second, not dumped.
    const cap = Gr === 0 ? 0 : (1 - pedal) * s.clutchTorque * bite * (0.2 + 0.8 * this.engage);

    const h = 0.05; // m/s probe for the tyre slope
    const F = this._a, Fp = this._b;
    tireForce(F, t, gripR, this.fz0, fzR, vxR, vyR, this.wr * R);
    const F0r = F.fx;
    const kR = Math.max(0, (tireForce(Fp, t, gripR, this.fz0, fzR, vxR, vyR, this.wr * R + h).fx - F0r) / h) * R;

    let wr = this.wr, we = this.we;
    if (cap <= 0) {
      this.clutchLocked = false;
      we += Te / Ie * dt;
      wr += (-F0r * R) / (Ir + dt * kR * R) * dt;
    } else {
      let slipping = !this.clutchLocked;
      let Tc = 0;
      if (this.clutchLocked) {
        const acc = (Te * Gr * ETA - F0r * R) / (Ir + Ie * Gr * Gr + dt * kR * R);
        Tc = Te - Ie * Gr * acc;
        if (Math.abs(Tc) <= cap) {
          wr += acc * dt;
          we = Gr * wr;
        } else {
          slipping = true;
          this.clutchLocked = false;
        }
      }
      if (slipping) {
        const slip = we - Gr * wr;
        Tc = cap * (slip !== 0 ? sign(slip) : sign(Tc));
        we += (Te - Tc) / Ie * dt;
        wr += (Tc * Gr * ETA - F0r * R) / (Ir + dt * kR * R) * dt;
        const after = we - Gr * wr;
        if (slip === 0 || sign(after) !== sign(slip)) {
          wr = (Ir * wr + Ie * Gr * we) / (Ir + Ie * Gr * Gr);
          we = Gr * wr;
          this.clutchLocked = true;
        }
      }
    }

    // Brakes, with Coulomb clamping so they can hold a wheel dead still.
    const brake = clamp(c.brake, 0, 1);
    const lineLock = !!c.lineLock;
    const tbR = (lineLock ? 0 : brake * s.brakeTorque * (1 - s.brakeBias)) + clamp(c.handbrake, 0, 1) * s.handbrakeTorque;
    const tbF = brake * s.brakeTorque * (lineLock ? 1 : s.brakeBias);
    if (tbR > 0) {
      const ir = this.clutchLocked ? Ir + Ie * Gr * Gr : Ir;
      const dw = tbR * dt / ir;
      wr = Math.abs(wr) <= dw ? 0 : wr - sign(wr) * dw;
      if (this.clutchLocked) we = Gr * wr;
    }
    tireForce(F, t, gripF, this.fz0, fzF, vxF, vyF, this.wf * R);
    const F0f = F.fx;
    const kF = Math.max(0, (tireForce(Fp, t, gripF, this.fz0, fzF, vxF, vyF, this.wf * R + h).fx - F0f) / h) * R;
    let wf = this.wf + (-F0f * R) / (If + dt * kF * R) * dt;
    if (tbF > 0) {
      const dw = tbF * dt / If;
      wf = Math.abs(wf) <= dw ? 0 : wf - sign(wf) * dw;
    }

    this.wr = wr;
    this.wf = wf;
    this.we = Math.max(we, 0);
    this.rpm = this.we * RPM;

    // ---- tyre forces with the settled wheel speeds, onto the body
    const fr = tireForce(this.rear, t, gripR, this.fz0, fzR, vxR, vyR, wr * R);
    const ff = tireForce(this.front, t, gripF, this.fz0, fzF, vxF, vyF, wf * R);
    const fxF = ff.fx * cd - ff.fy * sd;
    const fyF = ff.fx * sd + ff.fy * cd;
    let fx = fxF + fr.fx;
    const fy = fyF + fr.fy;
    const yaw = a * fyF - b * fr.fy + (c.yaw || 0);

    // Air and rolling resistance.
    const speed = Math.hypot(this.vx, this.vy);
    const resist = 0.5 * 1.2 * s.cdA * speed * speed + 0.013 * s.mass * G * Math.tanh(speed / 0.6);
    const rx = speed > 1e-6 ? -this.vx / speed * resist : 0;
    const ry = speed > 1e-6 ? -this.vy / speed * resist : 0;

    const m = s.mass;
    this.vx += ((fx * ch - fy * sh) + rx) / m * dt;
    this.vy += ((fx * sh + fy * ch) + ry) / m * dt;
    this.yawRate += yaw / s.izz * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.heading += this.yawRate * dt;

    // Filtered accelerations feed the load transfer and the body roll.
    fx += (rx * ch + ry * sh);
    this.ax += (fx / m - this.ax) * Math.min(1, 12 * dt);
    this.ay += (fy / m - this.ay) * Math.min(1, 12 * dt);
  }

  /** Drain the events raised since the last call (pops, shifts, limiter cuts, blow-off). */
  takeEvents(into) {
    for (const ev of this.events) into.push(ev);
    this.events.length = 0;
    return into;
  }
}
