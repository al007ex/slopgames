// A drive: the car, its driver aids, the world's walls and cones, and the
// judges. The simulation runs at a fixed 240 Hz; rendering interpolates
// between the last two steps so motion stays smooth at any frame rate.

import { Vehicle, STEP } from '#shared/vehicle.js';
import { Pilot } from '#shared/pilot.js';
import { carById } from '#shared/cars.js';
import { collideCar, Props, carBox } from '#shared/collide.js';
import { DriftScore, Takeover, TrackJudge } from '#shared/score.js';
import { trackPlace, inPit, AVENUES, STREETS } from '#shared/world.js';

const MAX_STEPS = 24; // never try to catch up more than 0.1 s in one frame

export class Drive {
  constructor(world, { car = 'ronin', assist = 'easy', manual = false, where = 'street' } = {}) {
    this.world = world;
    this.spec = carById(car);
    this.car = new Vehicle(this.spec, (Math.random() * 1e9) | 0);
    this.pilot = new Pilot(this.car, { assist, manual });
    this.props = new Props();
    for (const c of world.cones) this.props.add(c.x, c.y, 0.28, 4, 'cone');
    this.drift = new DriftScore();
    this.judge = new TrackJudge(world.track);
    this.takeover = null;
    this.takeoverDone = null;
    this.acc = 0;
    this.prev = { x: 0, y: 0, heading: 0 };
    this.pose = { x: 0, y: 0, heading: 0 };
    this.events = [];       // for the HUD, crowd and audio
    this.vehicleEvents = [];  // pops, shifts, cuts: for the audio and the flames
    this.judgeQueue = [];     // the same, for the takeover judge
    this.impact = null;
    this.propHits = [];
    this.clearance = Infinity;
    this.where = where;
    this.zone = '';
    this.time = 0;
    this.outOfPit = 0;
    this.spawn(where);
  }

  spawn(where) {
    const s = this.world.spawns[where] || this.world.spawns.street;
    this.car.reset(s.x, s.y, s.heading);
    this.pilot.steerIn = 0;
    this.prev = { x: s.x, y: s.y, heading: s.heading };
    this.pose = { ...this.prev };
    this.drift.reset();
    this.where = where;
    this.judge.index = -1;
    this.judge.lap = null;
    if (this.takeover) { this.takeover = null; this.takeoverDone = null; }
    this.outOfPit = 0;
  }

  /** Put the car back on its wheels on the nearest open road, facing along it. */
  resetCar() {
    const c = this.car;
    const t = this.world.track;
    const place = trackPlace(t, c.x, c.y);
    let x = c.x, y = c.y, h = c.heading;
    if (place.dist < 30) {
      const n = t.nodes[place.index];
      x = n.x; y = n.y; h = Math.atan2(n.ty, n.tx);
    } else {
      // The nearest street's centre line, facing the way the car was pointing.
      const snap = (v, list) => list.reduce((best, k) => (Math.abs(v - k) < Math.abs(v - best) ? k : best), list[0]);
      const ax = snap(c.x, AVENUES.map((v) => v.x)), sy = snap(c.y, STREETS.map((v) => v.y));
      if (c.y < 45 && c.y > -45) { x = 0; h = Math.sin(c.heading) >= 0 ? Math.PI / 2 : -Math.PI / 2; }
      else if (c.y <= -45) { x = Math.max(-280, Math.min(280, c.x)); y = -75; h = Math.cos(c.heading) >= 0 ? 0 : Math.PI; }
      else if (Math.abs(c.x - ax) < Math.abs(c.y - sy)) { x = ax; h = Math.sin(c.heading) >= 0 ? Math.PI / 2 : -Math.PI / 2; }
      else { y = sy; h = Math.cos(c.heading) >= 0 ? 0 : Math.PI; }
    }
    c.reset(x, y, h);
    this.prev = { x, y, heading: h };
    this.drift.reset();
  }

  /** Advance by a frame's worth of time; `keys` are the raw inputs. */
  update(dt, keys) {
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.prev.x = this.car.x; this.prev.y = this.car.y; this.prev.heading = this.car.heading;
      this.step(keys);
      this.acc -= STEP;
      steps++;
      keys.shiftUp = keys.shiftDown = false;
    }
    if (steps === MAX_STEPS) this.acc = 0;
    const a = this.acc / STEP;
    this.pose.x = this.prev.x + (this.car.x - this.prev.x) * a;
    this.pose.y = this.prev.y + (this.car.y - this.prev.y) * a;
    this.pose.heading = this.prev.heading + (this.car.heading - this.prev.heading) * a;
  }

  step(keys) {
    const car = this.car;
    const c = this.pilot.update(STEP, keys);
    car.step(STEP, c);
    this.controls = c;
    this.time += STEP;
    const hit = collideCar(car, this.world.shapes);
    if (hit && (!this.impact || hit.speed > this.impact.speed)) this.impact = hit;
    this.props.hitByCar(car, this.propHits);
    this.props.step(STEP, this.world.shapes);
    const before = this.vehicleEvents.length;
    car.takeEvents(this.vehicleEvents);
    for (let i = before; i < this.vehicleEvents.length; i++) this.judgeQueue.push(this.vehicleEvents[i]);

    // Judges run at a quarter of the step rate: plenty, and cheaper.
    if (Math.round(this.time / STEP) % 4 === 0) {
      const dt = STEP * 4;
      const box = carBox(car);
      this.clearance = this.world.shapes.clearance(box.x, box.y, 5) - 0.9;
      const impact = this.impactSince || 0;
      this.drift.update(dt, car, { clearance: this.clearance, impact, bonus: this.takeover ? 1 + this.takeover.hype : 1 }, this.events);
      this.impactSince = 0;
      this.judge.update(dt, car, this.drift, this.events);
      this.zone = inPit(car.x, car.y, this.world.pit.half) ? 'pit' : this.judge.place?.onTrack ? 'track' : car.y < -20 ? 'harbour' : 'street';
      this.runTakeover(dt, this.judgeQueue);
      this.judgeQueue.length = 0;
    }
    if (hit) this.impactSince = Math.max(this.impactSince || 0, hit.speed);
  }

  runTakeover(dt, vev) {
    const car = this.car;
    const inRing = inPit(car.x, car.y, this.world.pit.ring + 4);
    if (!this.takeover && inRing && car.speed > 1 && (!this.takeoverDone || this.time - this.takeoverDone > 8)) {
      this.takeover = new Takeover(this.world.pit, 150);
      this.events.push({ type: 'takeover', text: 'TAKEOVER', points: 0 });
    }
    if (!this.takeover) return;
    this.takeover.update(dt, car, vev, this.events);
    if (!inRing) {
      this.outOfPit += dt;
      if (this.outOfPit > 6 && !this.takeover.over) { this.takeover.over = true; this.events.push({ type: 'end', text: 'LEFT THE PIT', points: this.takeover.score }); }
    } else this.outOfPit = 0;
    if (this.takeover.over) { this.takeoverDone = this.time; this.lastTakeover = this.takeover; this.takeover = null; }
  }

  /** Drain everything that happened since the last frame. */
  drain() {
    const out = { events: this.events.splice(0), vehicle: this.vehicleEvents.splice(0), impact: this.impact, props: this.propHits.splice(0) };
    this.impact = null;
    return out;
  }
}
