// Movement-kit tests: runs the real LocalPlayer against the real level
// colliders. These exist to answer one question — can two players actually get
// through the geometry with the tuning in shared/constants.js?

import { LocalPlayer } from '../client/js/player.js';
import { buildWorld } from '../shared/collision.js';
import { LEVELS } from '../shared/levels.js';
import { MOVE, HEIGHT_STAND } from '../shared/constants.js';

let passed = 0;
let failed = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${extra ? `  — ${extra}` : ''}`); }
};
const section = (n) => console.log(`\n${n}`);

/** Minimal stand-in for the Input class. */
class Keys {
  constructor(o = {}) { Object.assign(this, { x: 0, z: 0, sp: false, cr: false, sl: false, slHit: false, jump: false }, o); }
  get moveX() { return this.x; }
  get moveZ() { return this.z; }
  get sprint() { return this.sp; }
  get crouch() { return this.cr; }
  get slideHeld() { return this.sl; }
  get slidePressed() { return this.slHit; }
  get jumpPressed() { return this.jump; }
}

const DT = 1 / 60;

/** Step the player for `seconds`, calling `onStep(player, keys, t)` each frame. */
function run(player, world, keys, seconds, onStep) {
  const events = [];
  for (let t = 0; t < seconds; t += DT) {
    onStep?.(player, keys, t);
    const e = player.update(DT, keys, world, {});
    events.push(...e);
    keys.slHit = false;
    keys.jump = false;
  }
  return events;
}

console.log('DUOSTRIKE — movement kit');

// A flat test arena so the basics are measured without level geometry noise.
const flat = buildWorld({ ground: { size: [400, 400], color: 0 }, boxes: [], slopes: [], gates: [], kill: -50 });

// -----------------------------------------------------------------------
section('Basics');
{
  const p = new LocalPlayer();
  p.reset([0, 6, 0]);
  run(p, flat, new Keys(), 2);
  ok(p.grounded && Math.abs(p.pos[1]) < 0.01, 'gravity settles the player onto the ground');

  const walk = new LocalPlayer();
  walk.reset([0, 0, 0]);
  run(walk, flat, new Keys({ z: 1 }), 2.5);
  ok(Math.abs(walk.speed2D - MOVE.walkSpeed) < 0.6, `walk tops out near ${MOVE.walkSpeed}`, `got ${walk.speed2D.toFixed(2)}`);

  const sprint = new LocalPlayer();
  sprint.reset([0, 0, 0]);
  run(sprint, flat, new Keys({ z: 1, sp: true }), 2.5);
  ok(Math.abs(sprint.speed2D - MOVE.sprintSpeed) < 0.6, `sprint tops out near ${MOVE.sprintSpeed}`, `got ${sprint.speed2D.toFixed(2)}`);
  ok(sprint.speed2D > walk.speed2D * 1.4, 'sprint is a noticeable step up from walking');

  const crouch = new LocalPlayer();
  crouch.reset([0, 0, 0]);
  run(crouch, flat, new Keys({ z: 1, cr: true }), 2.5);
  ok(crouch.speed2D < MOVE.walkSpeed * 0.65, 'crouch is slower than walking');
  ok(crouch.height < HEIGHT_STAND * 0.7, 'crouch shrinks the collider');
}

// -----------------------------------------------------------------------
section('Jump');
{
  const p = new LocalPlayer();
  p.reset([0, 0, 0]);
  let peak = 0;
  const keys = new Keys();
  run(p, flat, keys, 1.6, (pl, k, t) => { k.jump = t < DT; peak = Math.max(peak, pl.pos[1]); });
  const expected = (MOVE.jumpVel ** 2) / (2 * MOVE.gravity);
  ok(Math.abs(peak - expected) < 0.15, `jump peaks around ${expected.toFixed(2)}m`, `got ${peak.toFixed(2)}`);
  ok(p.grounded, 'the player lands again');
}

/** Horizontal distance covered by a jump at full sprint over flat ground. */
function sprintJumpDistance(slide = false) {
  const p = new LocalPlayer();
  p.reset([0, 0, 0]);
  const keys = new Keys({ z: 1, sp: true });
  run(p, flat, keys, 2.0);            // build up speed
  const startZ = p.pos[2];
  let launched = false;
  let airborne = false;
  let landZ = null;
  for (let t = 0; t < 3; t += DT) {
    if (!launched) {
      if (slide) { keys.slHit = true; keys.sl = true; }
      keys.jump = !slide;
      launched = true;
    } else if (slide && t < 0.25) {
      keys.sl = true;
    } else if (slide && !airborne && t >= 0.25) {
      keys.jump = true;          // slide-jump: hop out of the slide
    }
    p.update(DT, keys, flat, {});
    keys.slHit = false;
    keys.jump = false;
    if (!p.grounded) airborne = true;
    if (airborne && p.grounded) { landZ = p.pos[2]; break; }
  }
  return landZ === null ? 0 : Math.abs(landZ - startZ);
}

{
  const runJump = sprintJumpDistance(false);
  const slideJump = sprintJumpDistance(true);
  ok(runJump > 7.2, 'a sprint jump clears the gauntlet’s 7-unit gap', `got ${runJump.toFixed(2)}`);
  ok(slideJump > runJump, 'a slide jump goes further than a run jump', `run ${runJump.toFixed(2)} vs slide ${slideJump.toFixed(2)}`);
  console.log(`    sprint jump ${runJump.toFixed(2)}m · slide jump ${slideJump.toFixed(2)}m`);
}

// -----------------------------------------------------------------------
section('Slide');
{
  const p = new LocalPlayer();
  p.reset([0, 0, 0]);
  const keys = new Keys({ z: 1, sp: true });
  run(p, flat, keys, 2.0);
  const before = p.speed2D;
  keys.slHit = true;
  keys.sl = true;
  p.update(DT, keys, flat, {});
  ok(p.sliding, 'slide starts from a sprint');
  ok(p.speed2D > before, 'slide gives a speed boost', `${before.toFixed(2)} -> ${p.speed2D.toFixed(2)}`);

  let lowest = p.height;
  let slideFrames = 0;
  for (let t = 0; t < 1.4; t += DT) {
    p.update(DT, keys, flat, {});
    if (p.sliding) { slideFrames++; lowest = Math.min(lowest, p.height); }
  }
  ok(lowest < 1.0, 'slide lowers the hitbox under 1.0', `got ${lowest.toFixed(2)}`);
  const slideSeconds = slideFrames * DT;
  ok(slideSeconds > 0.6, 'a slide lasts long enough to cross an obstacle', `lasted ${slideSeconds.toFixed(2)}s`);
  console.log(`    slide lasts ${slideSeconds.toFixed(2)}s, hitbox down to ${lowest.toFixed(2)}m`);

  const p2 = new LocalPlayer();
  p2.reset([0, 0, 0]);
  const k2 = new Keys({ z: 1, sp: true });
  run(p2, flat, k2, 2.0);
  k2.slHit = true; k2.sl = true;
  p2.update(DT, k2, flat, {});
  k2.slHit = false;
  k2.sl = false;
  run(p2, flat, k2, 0.4);
  ok(!p2.sliding, 'releasing Ctrl ends the slide');
}

// -----------------------------------------------------------------------
section('Slide-under gaps in real levels');
/** Run north-to-south at the training bar (z=0) and report how far past it we got. */
function furthestPastBar(mode) {
  const world = buildWorld(LEVELS.training);
  const p = new LocalPlayer();
  p.reset([0, 0, 10]);
  p.yaw = 0;                                   // faces -z
  const keys = new Keys({ z: 1, sp: mode !== 'walk' });
  // Sprint accel is near-instant, so commit after 0.4s — any longer and the bot
  // is already touching the bar, where a slide legitimately cannot start.
  run(p, world, keys, 0.4);
  if (mode === 'slide') { keys.slHit = true; keys.sl = true; }
  if (mode === 'crouch') { keys.cr = true; keys.sp = false; }
  let deepest = p.pos[2];
  run(p, world, keys, 4.5, (pl) => { deepest = Math.min(deepest, pl.pos[2]); });
  return deepest;
}

{
  // The bar spans z -0.6..0.6 with 1.05 of clearance beneath it.
  const stand = furthestPastBar('walk');
  const slid = furthestPastBar('slide');
  const crouched = furthestPastBar('crouch');
  ok(stand > 0.6, 'a standing player is stopped by the bar', `reached z=${stand.toFixed(2)}`);
  ok(slid < -2, 'a sliding player gets under the bar', `reached z=${slid.toFixed(2)}`);
  ok(crouched < -2, 'a crouching player also gets under it', `reached z=${crouched.toFixed(2)}`);
  console.log(`    standing stops at z=${stand.toFixed(2)}; slide reaches ${slid.toFixed(2)}; crouch reaches ${crouched.toFixed(2)}`);
}

// -----------------------------------------------------------------------
section('Wall jump — the gauntlet shaft');
{
  // shaft interior x -10..-4, floor top 5.0, core lip top 10.0
  const world = buildWorld(LEVELS.gauntlet);
  const p = new LocalPlayer();
  p.reset([-7, 5.0, -80]);
  const keys = new Keys();
  let best = p.pos[1];
  let dir = 1;

  for (let t = 0; t < 6; t += DT) {
    // bot: drive into the nearer wall, jump off it, alternate sides
    keys.x = dir;
    keys.z = 0;
    if (p.grounded) { keys.jump = true; dir = 1; }
    else if (p.wallNormal && p.vel[1] < 1.5) {
      keys.jump = true;
      dir = p.wallNormal[0] > 0 ? 1 : -1;   // push back toward the wall we left
    }
    p.update(DT, keys, world, {});
    keys.jump = false;
    best = Math.max(best, p.pos[1]);
  }
  ok(best >= 10.0, 'wall jumps reach the 5m-high core lip', `reached ${best.toFixed(2)}m`);
  console.log(`    climbed from 5.00m to ${best.toFixed(2)}m`);
}

// -----------------------------------------------------------------------
section('Task points are reachable on foot');
/** Walk a straight line from A to B and report how close we got. */
function walkTo(levelId, from, to, seconds = 6) {
  const world = buildWorld(LEVELS[levelId]);
  const p = new LocalPlayer();
  p.reset([...from]);
  const keys = new Keys({ z: 1, sp: true });
  let best = Infinity;
  for (let t = 0; t < seconds; t += DT) {
    // steer toward the target every frame
    p.yaw = Math.atan2(-(to[0] - p.pos[0]), -(to[2] - p.pos[2]));
    p.update(DT, keys, world, {});
    keys.jump = false;
    best = Math.min(best, Math.hypot(p.pos[0] - to[0], p.pos[2] - to[2]));
  }
  return best;
}

{
  // The corridor's switch alcoves sit outside the corridor wall, reached through
  // hand-built doorways. If a doorway is wrong the level is unwinnable.
  const west = walkTo('corridor', [0, 0, -44], [-16.5, 0, -44]);
  const east = walkTo('corridor', [0, 0, -44], [16.5, 0, -44]);
  ok(west < 2.4, 'west switch alcove is reachable', `stopped ${west.toFixed(2)}m away`);
  ok(east < 2.4, 'east switch alcove is reachable', `stopped ${east.toFixed(2)}m away`);

  // The arena relay sits on the east catwalk, up a ramp.
  const relay = walkTo('arena', [27, 0, 14], [27, 5, -22], 8);
  ok(relay < 3.0, 'arena relay is reachable up the east ramp', `stopped ${relay.toFixed(2)}m away`);

  // The final level's console alcove and catwalk, both up ramps.
  const console1 = walkTo('final', [-27, 0, -6], [-27, 4.8, -27], 8);
  const catwalk = walkTo('final', [27, 0, 4], [27, 4.8, -26], 8);
  ok(console1 < 3.0, 'final console alcove is reachable up its ramp', `stopped ${console1.toFixed(2)}m away`);
  ok(catwalk < 3.0, 'final catwalk is reachable up its ramp', `stopped ${catwalk.toFixed(2)}m away`);

  // The horde floodlight, out in the open.
  const flood = walkTo('horde', [-12, 0, -12], [-25, 0, -21.6], 8);
  ok(flood < 2.4, 'horde floodlight pylon is reachable', `stopped ${flood.toFixed(2)}m away`);
}

section('No falling through the world');
{
  for (const [id, lv] of Object.entries(LEVELS)) {
    const world = buildWorld(lv);
    const p = new LocalPlayer();
    p.reset([...lv.spawns[0]]);
    const keys = new Keys({ z: 1, sp: true });
    // run forward, jump constantly, for 6 seconds
    run(p, world, keys, 6, (pl, k, t) => { k.jump = Math.floor(t * 3) % 2 === 0; });
    const fell = p.pos[1] < (lv.kill ?? -25);
    if (id === 'gauntlet') {
      // the gauntlet is deliberately built over a void; the server catches the
      // fall and resets to the last checkpoint (see campaign.test.js)
      ok(fell, 'gauntlet: running off the start pad does fall into the void');
    } else {
      ok(!fell, `${id}: sprinting from spawn does not drop out of the world`, `y=${p.pos[1].toFixed(1)}`);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
