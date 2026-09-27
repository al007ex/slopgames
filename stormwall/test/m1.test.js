// M1 — the movement sandbox: walk, sprint, crouch, jump, fall damage, and
// the done-criterion: run up a hill and kill yourself jumping off it.
import { ok, eq, near, section, report } from './harness.js';
import { flatWorld, piece, standAt, run, YAW_EAST, CELL, WALL_H } from './util.js';
import {
  stepMovement, createMoveState, copyMoveState, fallDamage, capsuleHeight, canStand,
  BTN_SPRINT, BTN_CROUCH, BTN_JUMP, BTN_ADS, MODE_SKYDIVE, MODE_GLIDE, MODE_WALK, MODE_DEAD,
  WALK_SPEED, SPRINT_SPEED, CROUCH_SPEED, GLIDER_DEPLOY_AGL,
} from '../shared/movement.js';
import { WALL, FLOOR, RAMP } from '../shared/pieces.js';
import { Match } from '../server/match.js';
import { MESAS } from '../shared/worldgen.js';
import { STAND_HEIGHT, CROUCH_HEIGHT } from '../shared/constants.js';

const speedOver = (s, world, input, ticks = 30) => {
  run(s, world, 30, input);                       // get up to speed
  const x0 = s.x, z0 = s.z;
  run(s, world, ticks, input);
  return Math.hypot(s.x - x0, s.z - z0) / (ticks / 30);
};

section('Walking, sprinting, crouching');
{
  const w = flatWorld(5);
  near(speedOver(standAt(w, 1000, 1000), w, { mz: 1, yaw: YAW_EAST, buttons: 0 }), WALK_SPEED, 0.05, `walking is the default (${WALK_SPEED} m/s)`);
  near(speedOver(standAt(w, 1000, 1000), w, { mz: 1, yaw: YAW_EAST, buttons: BTN_SPRINT }), SPRINT_SPEED, 0.05, `holding sprint runs at ${SPRINT_SPEED} m/s, with no stamina`);
  const long = standAt(w, 1000, 1000);
  near(speedOver(long, w, { mz: 1, yaw: YAW_EAST, buttons: BTN_SPRINT }, 600), SPRINT_SPEED, 0.05, '…and can sprint for twenty seconds straight');
  near(speedOver(standAt(w, 1000, 1000), w, { mx: 1, yaw: YAW_EAST, buttons: BTN_SPRINT }), WALK_SPEED, 0.05, 'sprint only works going forwards');
  ok(speedOver(standAt(w, 1000, 1000), w, { mz: -1, yaw: YAW_EAST, buttons: 0 }) < WALK_SPEED, 'walking backwards is slower');
  near(speedOver(standAt(w, 1000, 1000), w, { mz: 1, yaw: YAW_EAST, buttons: BTN_ADS }), 3.2, 0.05, 'aiming down sights slows you down');
  const s = standAt(w, 1000, 1000);
  run(s, w, 1, { buttons: BTN_CROUCH }); run(s, w, 1, { buttons: 0 });
  eq(s.crouch, 1, 'tapping crouch crouches');
  eq(capsuleHeight(s), CROUCH_HEIGHT, 'crouching shrinks the capsule');
  near(speedOver(s, w, { mz: 1, yaw: YAW_EAST, buttons: 0 }), CROUCH_SPEED, 0.05, `crouch-walking at ${CROUCH_SPEED} m/s`);
  run(s, w, 1, { buttons: BTN_CROUCH }); run(s, w, 1, { buttons: 0 });
  eq(s.crouch, 0, 'tapping again stands back up');
  eq(capsuleHeight(s), STAND_HEIGHT, 'standing restores the capsule');
  const hold = standAt(w, 1000, 1000);
  run(hold, w, 60, { buttons: BTN_CROUCH });
  eq(hold.crouch, 1, 'holding crouch does not flicker');
}

section('A low ceiling');
{
  // Ground at 2.3 m and a floor at level 1 (3.74 m underside): 1.44 m of headroom.
  const w = flatWorld(2.3);
  piece(w, FLOOR, 200, 1, 200);
  const s = standAt(w, 200.5 * CELL, 200.5 * CELL);
  run(s, w, 1, { buttons: BTN_CROUCH }); run(s, w, 1, { buttons: 0 });
  ok(!canStand(s, w), 'there is no room to stand under a 1.44 m ceiling');
  run(s, w, 1, { buttons: BTN_CROUCH }); run(s, w, 1, { buttons: 0 });
  eq(s.crouch, 1, 'so pressing crouch again keeps you crouched');
  run(s, w, 1, { buttons: BTN_JUMP });
  eq(s.crouch, 1, '…and jumping does not stand you up into it');
}

section('Jumping');
{
  const w = flatWorld(0);
  const s = standAt(w, 1000, 1000);
  const y0 = s.y;
  let top = 0;
  run(s, w, 60, (i, st) => { top = Math.max(top, st.y - y0); return { buttons: i < 2 ? BTN_JUMP : 0 }; });
  near(top, 1.37, 0.08, `a jump clears about 1.37 m (${top.toFixed(2)})`);
  eq(s.ground, 1, 'and lands again');
  const d = standAt(w, 1000, 1000);
  let peak = 0;
  run(d, w, 60, (i, st) => { peak = Math.max(peak, st.y - y0); return { buttons: i === 0 || i === 12 ? BTN_JUMP : 0 }; });
  ok(peak < 1.45, 'pressing jump again mid-air does nothing (no double jump)');
  const h = standAt(w, 1000, 1000);
  let landings = 0;
  let was = 1;
  run(h, w, 150, (i, st) => { if (st.ground && !was) landings++; was = st.ground; return { buttons: BTN_JUMP }; });
  eq(landings, 1, 'holding jump jumps once, not forever');
}

section('Solid things');
{
  const w = flatWorld(0);
  piece(w, WALL, 201, 0, 200, { rot: 0 });   // a wall on the plane x = 201·CELL
  const s = standAt(w, 200.5 * CELL, 200.5 * CELL);
  run(s, w, 90, { mz: 1, yaw: YAW_EAST, buttons: BTN_SPRINT });
  near(s.x, 201 * CELL - 0.1 - 0.42, 0.02, 'a wall stops you, one capsule-radius from its face');

  const r = flatWorld(0);
  piece(r, RAMP, 300, 0, 300, { rot: 0 });   // climbs towards +x
  piece(r, FLOOR, 301, 1, 300);              // a landing at the top
  const c = standAt(r, 299.2 * CELL, 300.5 * CELL);
  run(c, r, 90, { mz: 1, yaw: YAW_EAST, buttons: 0 });
  near(c.y, WALL_H + 0.1, 0.05, 'you can walk up a ramp to the floor above');
  ok(c.x > 301 * CELL, '…and on along it');

  const l = flatWorld(-0.35);
  piece(l, FLOOR, 400, 0, 400);              // a 0.45 m ledge
  const st = standAt(l, 399.6 * CELL, 400.5 * CELL);
  run(st, l, 40, { mz: 1, yaw: YAW_EAST, buttons: 0 });
  near(st.y, 0.1, 0.03, 'you step up onto a 0.45 m ledge without jumping');
  const hi = flatWorld(-0.75);
  piece(hi, FLOOR, 400, 0, 400);             // a 0.85 m ledge
  const bl = standAt(hi, 399.6 * CELL, 400.5 * CELL);
  run(bl, hi, 40, { mz: 1, yaw: YAW_EAST, buttons: 0 });
  ok(bl.y < 0 && bl.x < 400 * CELL, 'but an 0.85 m ledge needs a jump');
  run(bl, hi, 40, (i) => ({ mz: 1, yaw: YAW_EAST, buttons: i === 0 ? BTN_JUMP : 0 }));
  near(bl.y, 0.1, 0.03, '…and a jump gets you up');

  const steep = flatWorld(0, (x) => Math.max(0, (x - 900) * 1.7));  // ~60°
  const sl = standAt(steep, 930, 1000);
  const y0 = sl.y;
  run(sl, steep, 60, { buttons: 0 });
  ok(sl.y < y0 - 2, 'a 60° slope is too steep to stand on: you slide down it');
}

section('Fall damage');
{
  eq(fallDamage(2 * WALL_H), 0, 'two wall-heights: no damage');
  eq(fallDamage(3 * WALL_H), 0, 'three wall-heights: still none');
  ok(fallDamage(3.5 * WALL_H) > 0 && fallDamage(3.5 * WALL_H) < 20, 'just over three: a little');
  eq(fallDamage(5 * WALL_H), 50, 'five: half your health');
  eq(fallDamage(7 * WALL_H), 100, 'seven: lethal from full health');
  eq(fallDamage(12 * WALL_H), 100, 'more than seven is no worse than dead');
  const w = flatWorld(0);
  const s = standAt(w, 1000, 1000);
  s.y = 20; s.ground = 0; s.peakY = 20;
  const dmg = run(s, w, 120, { buttons: 0 });
  eq(dmg, fallDamage(20), `dropping 20 m does ${fallDamage(20)} damage on landing`);
  const j = standAt(w, 1000, 1000);
  eq(run(j, w, 60, (i) => ({ buttons: i === 0 ? BTN_JUMP : 0 })), 0, 'jumping on the spot never hurts');
}

section('Skydiving and the glider');
{
  const w = flatWorld(10);
  const s = createMoveState(1000, 700, 1000);
  s.mode = MODE_SKYDIVE;
  let deployedAt = null, maxDive = 0;
  run(s, w, 60 * 30, (i, st) => {
    if (st.mode === MODE_GLIDE && deployedAt === null) deployedAt = st.y - 10;
    maxDive = Math.max(maxDive, -st.vy);
    return { mz: 1, pitch: -1.2, yaw: 0, buttons: 0 };
  });
  ok(maxDive > 35, `diving falls fast (${maxDive.toFixed(0)} m/s)`);
  near(deployedAt, GLIDER_DEPLOY_AGL, 2, `the glider opens by itself ${GLIDER_DEPLOY_AGL} m above the ground`);
  eq(s.mode, MODE_WALK, 'and you land on your feet');
  const f = createMoveState(1000, 700, 1000);
  f.mode = MODE_SKYDIVE;
  let fell = 0;
  const dmg = run(f, w, 90 * 30, (i, st) => { fell = Math.max(fell, -st.vy); return { mz: 1, pitch: 0.2, yaw: 0, buttons: 0 }; });
  ok(fell < 15, 'without diving you drift down slowly and can travel far');
  eq(dmg, 0, 'landing from the sky never hurts');
}

section('Prediction replays exactly');
{
  const w1 = flatWorld(0, (x, z) => 3 * Math.sin(x / 40) + 2 * Math.cos(z / 30));
  const w2 = flatWorld(0, (x, z) => 3 * Math.sin(x / 40) + 2 * Math.cos(z / 30));
  const a = standAt(w1, 800, 800), b = copyMoveState(a);
  const script = (i) => ({ mz: 1, mx: Math.sin(i / 20), yaw: i / 50, buttons: (i % 45 === 0 ? BTN_JUMP : 0) | (i % 200 < 100 ? BTN_SPRINT : 0) });
  for (let i = 0; i < 600; i++) { stepMovement(a, script(i), w1); stepMovement(b, script(i), w2); }
  ok(a.x === b.x && a.y === b.y && a.z === b.z, 'the same inputs on two copies of a world end in the same place, bit for bit');
}

section('Done when: run up a hill and kill yourself jumping off it');
{
  const match = new Match({ mode: 'sandbox' });
  const mesa = MESAS[0];
  const p = match.addPlayer({ name: 'jumper', bot: true });
  // Start at the foot of the mesa's gentle west side and run due east.
  match.placeOnGround(p, mesa.x - mesa.r - 110, mesa.z);
  const startY = p.move.y;
  let top = -Infinity, ticks = 0;
  p.botInput = { mz: 1, mx: 0, yaw: YAW_EAST, pitch: 0, buttons: BTN_SPRINT };
  while (p.alive && ticks < 90 * 30) {
    match.step();
    ticks++;
    if (p.alive) top = Math.max(top, p.move.y);
  }
  ok(top - startY > 30, `ran up the hill: climbed ${(top - startY).toFixed(1)} m on foot`);
  ok(!p.alive, `…ran off the cliff side and died (${(ticks / 30).toFixed(1)} s in)`);
  eq(p.move.mode, MODE_DEAD, 'the body is dead, not just hurt');
  match.step();
  const later = match.tick + 3 * 30;
  while (match.tick < later + 2) match.step();
  ok(p.alive && p.hp === 100, 'in the sandbox you are back three seconds later at full health');
}

report();
