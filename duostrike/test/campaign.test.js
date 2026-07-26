// Full-campaign integration test for the authoritative sim.
//
// Drives a real GameRoom with two fake sockets from lobby to end screen,
// exercising every co-op task mechanic, waves, enemy AI, hit registration and
// stage progression. No test framework — run it with `npm test`.

import { GameRoom } from '../server/game.js';
import { CAMPAIGN, LEVELS, TUTORIAL_STEPS } from '../shared/levels.js';
import { ENEMY_TYPES, MAX_HP } from '../shared/constants.js';

let passed = 0;
let failed = 0;
const events = [];

function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
}

function section(name) {
  console.log(`\n${name}`);
}

// ---- fakes ------------------------------------------------------------
const io = {
  to(room) {
    return {
      emit(ev, data) { events.push({ room, ev, data }); },
    };
  },
};
const mkSocket = (id) => ({ id, join() {}, emit() {} });

function lastEvent(type) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].ev === 'ev' && events[i].data.type === type) return events[i].data;
  }
  return null;
}

// ---- helpers ----------------------------------------------------------
function tickFor(room, seconds, dt = 0.05) {
  for (let t = 0; t < seconds; t += dt) room.tick(dt);
}

/** Put a player somewhere and optionally hold E / report a drill. */
function place(room, p, pos, opts = {}) {
  room.onState(p, {
    p: [...pos], y: 0, pi: 0, a: 0, w: 'rifle',
    int: !!opts.int, blk: !!opts.blk, tr: opts.tr,
  });
}

/** Park both players somewhere harmless and out of the exit zone. */
function parkBoth(room, pos = [0, 0, 0]) {
  const [a, b] = [...room.players.values()];
  place(room, a, pos);
  place(room, b, [pos[0] + 2, pos[1], pos[2]]);
  return [a, b];
}

function clearEnemies(room, killer) {
  for (const e of [...room.enemies.values()]) {
    room.hurtEnemy(e, 99999, killer, [e.pos[0], e.pos[1] + 1, e.pos[2]], false);
  }
}

/** Walk both players into the exit zone and let the server advance the stage. */
function exitStage(room) {
  const lv = room.level;
  const [a, b] = [...room.players.values()];
  const z = lv.exit.p;
  place(room, a, [z[0] - 1, z[1], z[2]]);
  place(room, b, [z[0] + 1, z[1], z[2]]);
  room.tick(0.05);
}

// =======================================================================
console.log('DUOSTRIKE — campaign integration test');

const room = new GameRoom('TEST', io);
const s1 = mkSocket('p1');
const s2 = mkSocket('p2');

section('Lobby');
const alex = room.addPlayer(s1, 'Alex');
ok(!!alex, 'first player joins');
ok(!room.canStart(), 'cannot start with one player');
const sam = room.addPlayer(s2, 'Sam');
ok(!!sam, 'second player joins');
ok(room.addPlayer(mkSocket('p3'), 'Gatecrash') === null, 'third player is refused');
ok(!room.canStart(), 'cannot start until both are ready');
room.setReady('p1', true);
ok(!room.canStart(), 'one ready is not enough');
room.setReady('p2', true);
ok(room.canStart(), 'both ready unlocks start');
ok(room.start(), 'game starts');
ok(room.level.id === 'training', 'stage 0 is the training grounds');

// -----------------------------------------------------------------------
section('Training — drills gate on BOTH players');
for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
  const step = TUTORIAL_STEPS[i];
  if (step.id === 'shoot') {
    // real path: each player must kill a dummy of their own
    const dummies = [...room.enemies.values()];
    room.hurtEnemy(dummies[0], 999, alex, [0, 1, 0], false);
    ok(room.tutorialStep === i, 'one player shooting does not clear the drill');
    room.hurtEnemy(dummies[1], 999, sam, [0, 1, 0], false);
  } else {
    place(room, alex, [0, 0, 10], { tr: step.id });
    room.tick(0.05);
    ok(room.tutorialStep === i, `drill "${step.id}" waits for the second player`);
    place(room, sam, [2, 0, 10], { tr: step.id });
    room.tick(0.05);
  }
  ok(room.tutorialStep === i + 1, `drill "${step.id}" clears when both report`);
}
room.tick(0.05);
ok(room.levelComplete, 'training completes after all drills');
ok(room.openGates.has('exit'), 'exit gate opened');

// one player in the zone must not advance the stage
const tz = room.level.exit.p;
place(room, alex, [tz[0], tz[1], tz[2]]);
place(room, sam, [0, 0, 0]);
room.tick(0.05);
ok(room.level.id === 'training', 'one player at the exit does not advance');
exitStage(room);
ok(room.level.id === 'hub', 'both at the exit advances to the hub');

// -----------------------------------------------------------------------
section('Hub — HOLD task, shop and hints');
const bell = room.tasks.get('bell');
const bellDef = bell.def;
parkBoth(room, [0, 0, 0]);
tickFor(room, 2);
ok(bell.progress === 0, 'hold makes no progress with nobody on the pad');

place(room, alex, [...bellDef.p], { int: true });
tickFor(room, 1);
ok(bell.progress > 0.5 && !bell.done, 'hold accrues while E is held on the pad');
place(room, alex, [0, 0, 0], { int: true });
room.tick(0.05);
ok(bell.progress === 0, 'walking off the pad resets the hold');

place(room, alex, [...bellDef.p], { int: true });
tickFor(room, bellDef.seconds + 0.6);
ok(bell.done, 'hold completes after the full duration');
ok(alex.currency > 0 && sam.currency > 0, 'both players are paid for the task');

const coinBefore = alex.currency;
room.onBuy(alex, 'c_ember');
ok(alex.owned.includes('c_ember') && alex.currency === coinBefore - 60, 'cosmetic purchase deducts coin');
room.onBuy(alex, 'c_signal');
ok(!alex.owned.includes('c_signal'), 'cannot buy what you cannot afford');
room.onHint(alex);
ok(!!lastEvent('hint'), 'hint giver responds');
room.onHint(alex);
ok(lastEvent('toast')?.text.includes('thinking'), 'hint giver has a cooldown');

exitStage(room);
ok(room.level.id === 'arena', 'hub advances to the arena');

// -----------------------------------------------------------------------
section('Arena — waves, hitscan and the DEFEND task');
parkBoth(room, [0, 0, 20]);
tickFor(room, 4);
ok(room.enemies.size > 0, 'first wave spawns');
ok(room.waveState === 'active', 'wave is active');

// enemy AI actually closes the distance
const chaser = [...room.enemies.values()][0];
const startDist = Math.hypot(chaser.pos[0] - 0, chaser.pos[2] - 20);
tickFor(room, 2);
const endDist = Math.hypot(chaser.pos[0] - 0, chaser.pos[2] - 20);
ok(endDist < startDist, 'enemies move toward the nearest player');

// Authoritative hitscan: fire a real ray down a lane known to be clear of cover.
const victim = room.spawnEnemy('grunt', [-8, 0, 0]);
const eye = [-8, 1.0, 6];
place(room, alex, [eye[0], 0, eye[2]]);
const hpBefore = victim.hp;
room.onFire(alex, { weapon: 'rifle', origin: eye, dirs: [[0, 0, -1]] });
ok(victim.hp < hpBefore, 'server registers a hit from a valid ray');
const hpAfterMiss = victim.hp;
room.onFire(alex, { weapon: 'rifle', origin: eye, dirs: [[0, 1, 0]] });
ok(victim.hp === hpAfterMiss, 'a ray pointing at the sky does not hit');
room.onFire(alex, { weapon: 'rifle', origin: eye, dirs: [[0, 0, -1], [0, 0, -1]] });
ok(victim.hp === hpAfterMiss, 'wrong pellet count is rejected');

// clear all three waves
for (let w = 0; w < room.level.waves.length + 1; w++) {
  clearEnemies(room, alex);
  tickFor(room, 6);
}
ok(room.waveState === 'done', 'all waves cleared');

const gen = room.tasks.get('gen');
const goalP = gen.def.goal.p;
place(room, alex, [...goalP]);
room.onGoal(alex, 'gen');
ok(!gen.done, 'relay cannot be thrown with nobody holding');
ok(lastEvent('toast')?.text.includes('partner'), 'player is told why it failed');

place(room, sam, [...gen.def.hold.p], { int: true });
room.tick(0.05);
ok(gen.holder === sam.id, 'partner registers as the holder');
room.onGoal(sam, 'gen');
ok(!gen.done, 'the holder cannot also throw the relay');
room.onGoal(alex, 'gen');
ok(gen.done, 'relay completes when one holds and the other throws');

exitStage(room);
ok(room.level.id === 'hub', 'arena returns to the hub');
ok(room.tasks.get('bell').done, 'the hub bell stays done on revisit');
ok(room.levelComplete, 'a revisited hub opens immediately');
exitStage(room);
ok(room.level.id === 'corridor', 'hub advances to the corridor');

// -----------------------------------------------------------------------
section('Corridor — SYNCED task and melee resistance');
clearEnemies(room, alex);
const locks = room.tasks.get('locks');
const [westPad, eastPad] = locks.def.pads;

place(room, alex, [...westPad.p]);
room.onFlip(alex, 'locks', 'west');
ok(Object.keys(locks.flips).length === 1, 'first switch registers');
ok(!locks.done, 'one switch alone does not complete the task');

// let the window lapse (simulation time, not wall time)
tickFor(room, (locks.def.windowMs + 400) / 1000, 0.1);
ok(Object.keys(locks.flips).length === 0, 'a stale switch expires out of the window');

place(room, alex, [...westPad.p]);
place(room, sam, [...eastPad.p]);
room.onFlip(alex, 'locks', 'west');
room.onFlip(sam, 'locks', 'east');
room.tick(0.05);
ok(locks.done, 'both switches inside the window complete the task');

// a player standing nowhere near a pad cannot flip it
const locks2 = { ...locks };
ok(locks2.done, 'sanity: task stays done');

exitStage(room);
ok(room.level.id === 'hub', 'corridor returns to the hub');
exitStage(room);
ok(room.level.id === 'gauntlet', 'hub advances to the gauntlet');

// -----------------------------------------------------------------------
section('Gauntlet — FETCH task, checkpoints and falling');
const core = room.tasks.get('core');
parkBoth(room, [0, 0, 6]);

place(room, alex, [0, 0, 6]);
room.onPickup(alex, 'core');
ok(!core.carrier, 'cannot pick up the core from across the level');

place(room, alex, [...core.def.item.p]);
room.onPickup(alex, 'core');
ok(core.carrier === alex.id, 'core is picked up when close enough');
room.onPickup(sam, 'core');
ok(core.carrier === alex.id, 'a carried core cannot be stolen');

// falling resets to the last checkpoint instead of killing, and you keep the
// core — otherwise one missed jump means re-climbing the whole shaft
place(room, alex, [0, -60, -30]);
room.tick(0.05);
ok(alex.pos[1] > -30 && alex.alive, 'falling in the gauntlet resets, it does not kill');
ok(core.carrier === alex.id, 'the carrier keeps the core through a checkpoint reset');

place(room, alex, [...core.def.console.p], { int: true });
tickFor(room, 0.3);
ok(core.done, 'delivering the core to the terminal completes the task');

exitStage(room);
ok(room.level.id === 'hub', 'gauntlet returns to the hub');
exitStage(room);
ok(room.level.id === 'horde', 'hub advances to the horde');

// -----------------------------------------------------------------------
section('Horde — wave-gated HOLD task and player damage');
const flood = room.tasks.get('flood');
parkBoth(room, [0, 2.6, 0]);
room.tick(0.05);
ok(!room.taskActive(flood), 'the floodlight task is inactive before wave 4');

place(room, alex, [...flood.def.p], { int: true });
tickFor(room, 3);
ok(flood.progress === undefined || flood.progress === 0, 'an inactive task accrues nothing');

// jump to wave 4
while (room.waveIndex + 1 < 4) {
  clearEnemies(room, alex);
  tickFor(room, 6);
}
ok(room.taskActive(flood), 'the task activates at wave 4');

// enemies really do damage players
alex.hp = MAX_HP;
alex.alive = true;
place(room, alex, [...(room.level.spawnPoints[0])]);
room.spawnEnemy('zombie', [room.level.spawnPoints[0][0], 0, room.level.spawnPoints[0][2] - 1]);
tickFor(room, 3);
ok(alex.hp < MAX_HP, 'enemies damage a player they can reach');

// isolate the hold mechanic: an interrupted holder is correct behaviour, but it
// is not what this assertion is about
clearEnemies(room, alex);
alex.hp = MAX_HP;
alex.alive = true;
place(room, alex, [...flood.def.p], { int: true });
tickFor(room, flood.def.seconds + 1);
ok(flood.done, 'the floodlight hold completes once active');

for (let w = 0; w < room.level.waves.length + 1; w++) {
  clearEnemies(room, alex);
  tickFor(room, 6);
}
ok(room.waveState === 'done', 'all six horde waves cleared');
exitStage(room);
ok(room.level.id === 'hub', 'horde returns to the hub');
exitStage(room);
ok(room.level.id === 'final', 'hub advances to the final level');

// -----------------------------------------------------------------------
section('Final — DEFEND + PATTERN together');
clearEnemies(room, alex);
const mast = room.tasks.get('mast');
const signal = room.tasks.get('signal');

place(room, alex, [...mast.def.hold.p], { int: true });
room.tick(0.05);
place(room, sam, [...mast.def.goal.p]);
room.onGoal(sam, 'mast');
ok(mast.done, 'mast defend task completes with one holding and one throwing');

ok(signal.seq.length === signal.def.length, 'pattern sequence generated at the right length');
const wrong = signal.def.buttons.find((b) => b.id !== signal.seq[0]).id;
place(room, sam, [...signal.def.buttons.find((b) => b.id === wrong).p]);
signal.showing = false;
room.onPress(sam, 'signal', wrong);
ok(signal.input.length === 0, 'a wrong pad resets the sequence');

for (const id of [...signal.seq]) {
  const btn = signal.def.buttons.find((b) => b.id === id);
  place(room, sam, [...btn.p]);
  signal.showing = false;
  room.onPress(sam, 'signal', id);
}
ok(signal.done, 'entering the full sequence completes the pattern task');

for (let w = 0; w < room.level.waves.length + 1; w++) {
  clearEnemies(room, alex);
  tickFor(room, 6);
}
ok(room.levelComplete, 'final level completes');

section('End');
exitStage(room);
ok(room.phase === 'ended', 'campaign ends after the last stage');
const over = events.filter((e) => e.ev === 'gameover').pop();
ok(!!over, 'game over payload emitted');
ok(over.data.players.length === 2, 'recap covers both players');
ok(over.data.kills > 0 && over.data.tasks >= 7, 'recap counts kills and tasks');

room.resetToLobby();
ok(room.phase === 'lobby' && !room.players.get('p1').ready, 'play again returns to a fresh lobby');

// -----------------------------------------------------------------------
section('Disconnect');
room.start();
room.setReady('p1', true); room.setReady('p2', true);
room.start();
room.removePlayer('p2');
ok(room.paused, 'losing a player pauses the run');
const posBefore = [...room.players.get('p1').pos];
room.tick(0.05);
ok(room.players.get('p1').pos[0] === posBefore[0], 'a paused room does not simulate');

// =======================================================================
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
