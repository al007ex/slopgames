// Scoring: drift combos, the takeover's tricks, and the circuit's judging.

import { ok, section } from './harness.js';
import { drive, circleDrift } from './drive.js';
import { DriftScore, Takeover, TrackJudge } from '#shared/score.js';
import { buildWorld, PIT } from '#shared/world.js';
import { Vehicle } from '#shared/vehicle.js';
import { CARS } from '#shared/cars.js';
import { DEG } from '#shared/math.js';

const kmh = (c) => c.speed * 3.6;

section('Drift combos');
{
  const score = new DriftScore();
  const events = [];
  let entered = false;
  drive('ronin', 14, (t, k, c, st) => {
    if (!st.at) { k.throttle = 1; if (kmh(c) > 60) st.at = t; return; }
    const since = t - st.at;
    k.handbrake = since < 0.35 ? 1 : 0;
    k.steer = since < 5 ? 1 : 0;
    k.throttle = since < 5 ? 1 : 0;
    entered = true;
  }, { watch: (t, c) => score.update(1 / 240, c, {}, events) });
  const bank = events.find((e) => e.type === 'bank');
  ok(entered && bank && bank.points > 500, `a five-second slide banks ${bank?.points} points`);
  ok(bank && bank.mult > 2, `with a multiplier that grew to ×${bank?.mult.toFixed(1)}`);

  const crash = new DriftScore();
  const ev = [];
  const car = new Vehicle(CARS[0]);
  car.reset(0, 0, 0); car.vx = 15; car.vy = 8; car.heading = -0.3;
  for (let i = 0; i < 240; i++) crash.update(1 / 240, car, {}, ev);
  ok(crash.pending > 0, 'points build while sliding');
  crash.update(1 / 240, car, { impact: 8 }, ev);
  ok(ev.some((e) => e.type === 'crash') && crash.total === 0 && crash.pending === 0, 'and a crash throws them away');

  const near = new DriftScore(), far = new DriftScore();
  for (let i = 0; i < 240; i++) { near.update(1 / 240, car, { clearance: 0.4 }); far.update(1 / 240, car, { clearance: 5 }); }
  ok(near.pending > far.pending * 1.6, `sliding a hand's width off a wall is worth far more (${(near.pending / far.pending).toFixed(1)}×)`);

  // Flick left, flick right: a transition bumps the multiplier.
  const tr = new DriftScore();
  const tev = [];
  car.heading = -0.4; car.vx = 15; car.vy = 0;
  for (let i = 0; i < 240; i++) tr.update(1 / 240, car, {}, tev);
  car.heading = 0.4;
  for (let i = 0; i < 60; i++) tr.update(1 / 240, car, {}, tev);
  ok(tev.some((e) => e.type === 'transition'), 'switching sides mid-slide is a transition');
}

section('Takeover tricks');
{
  const judge = (script, seconds, id = 'brute') => {
    const t = new Takeover({ ...PIT, x: 0, y: 0 }, 1e9);
    const events = [], vev = [];
    drive(id, seconds, script, { events: vev, watch: (tt, c) => { t.update(1 / 240, c, vev.splice(0), events); } });
    return { t, events };
  };
  const donuts = judge((t, k) => { k.throttle = 1; k.steer = t > 0.3 ? 1 : 0; }, 10);
  ok(donuts.t.counts.donut >= 2, `holding a donut counts them (${donuts.t.counts.donut})`);
  ok(donuts.events.some((e) => e.text === 'CENTRE DONUT'), 'right in the middle they count extra');

  const fig8 = judge((t, k) => { k.throttle = 1; k.steer = t < 0.3 ? 0 : t < 6 ? 1 : -1; }, 13);
  ok(fig8.t.counts.figure8 >= 1, `swapping direction mid-donut makes a figure eight (${fig8.t.counts.figure8})`);

  const roll = judge((t, k, c, st) => {
    k.throttle = 1;
    if (!st.go && kmh(c) > 55) { st.go = t; st.h0 = c.heading; }
    if (!st.go) return;
    k.handbrake = t - st.go < 0.3 || (k.handbrake && Math.abs(c.slipAngle) < 70 * DEG) ? 1 : 0;
    k.steer = st.h0 - c.heading < 5.5 ? -1 : 0;
  }, 9);
  ok(roll.t.counts.rollback === 1, `a rollback is recognised (${roll.t.counts.rollback})`);

  const burn = judge((t, k) => { k.throttle = 1; k.brake = 1; }, 6);
  ok(burn.t.counts.burnout >= 2, `a line-lock burnout scores (${burn.t.counts.burnout})`);

  const lim = judge((t, k) => { k.throttle = 1; k.clutch = 1; }, 4);
  ok(lim.events.some((e) => e.type === 'limiter'), 'bouncing off the limiter gets the crowd going');
  ok(lim.t.counts.flames > 3, `and every big flame counts (${lim.t.counts.flames})`);
  ok(lim.t.hype > 0.05 && lim.t.hype < 0.4, `hype builds, but flames alone won't max it (${(lim.t.hype * 100).toFixed(0)}%)`);

  const end = new Takeover(PIT, 2);
  const ev = [];
  const c = new Vehicle(CARS[0]);
  c.reset(PIT.x, PIT.y, 0);
  for (let i = 0; i < 600; i++) end.update(1 / 240, c, [], ev);
  ok(end.over && ev.some((e) => e.type === 'end'), 'when the time runs out, the cops arrive');
}

section('Circuit judging');
{
  const world = buildWorld();
  const track = world.track;
  const n = track.nodes.length;
  // A kinematic lap: slide round at 55 km/h, 30° of angle, hugging each clip.
  const lap = (hug) => {
    const judge = new TrackJudge(track);
    const drift = new DriftScore();
    const car = new Vehicle(CARS[0]);
    const events = [];
    const v = 55 / 3.6, dt = track.nodes[1].s / v;
    const startAt = (track.finish.index - 40 + n) % n;
    for (let k = 0; k < n * 2 + 80; k++) {
      const i = (startAt + k) % n, node = track.nodes[i];
      let off = 0;
      for (const c of track.clips) {
        if (c.kind === 'inner' && Math.abs(((i - c.index + n + n / 2) % n) - n / 2) < 6) off = c.side * (track.half - 1.6);
        if (c.kind === 'outer' && (c.from <= c.to ? i >= c.from && i <= c.to : i >= c.from || i <= c.to)) off = c.side * (track.half - 0.4);
      }
      if (!hug) off = 0;
      const dir = Math.atan2(node.ty, node.tx);
      const side = node.curv >= 0 ? 1 : -1;
      car.x = node.x + node.nx * off; car.y = node.y + node.ny * off;
      car.vx = Math.cos(dir) * v; car.vy = Math.sin(dir) * v;
      car.heading = dir + side * 30 * DEG;
      car.time += dt;
      drift.update(dt, car, {}, events);
      judge.update(dt, car, drift, events);
    }
    return { judge, events };
  };
  const good = lap(true);
  ok(good.judge.laps.length >= 1, `a lap is timed and judged (${good.judge.laps.length} laps)`);
  const r = good.judge.laps[0];
  ok(r && r.line >= 30, `hugging every clip scores the line (${r?.line}/40)`);
  ok(r && r.angle >= 18, `30° of angle scores (${r?.angle}/30)`);
  ok(r && r.style >= 25, `sideways all lap scores style (${r?.style}/30)`);
  ok(good.events.some((e) => e.type === 'clip') && good.events.some((e) => e.type === 'zone'), 'clips and zones are called out as you hit them');
  const lazy = lap(false);
  ok(lazy.judge.laps[0].line < r.line / 2, `the middle of the road scores far less line (${lazy.judge.laps[0].line}/40)`);
}
