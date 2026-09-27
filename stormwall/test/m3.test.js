// M3 — building: four pieces on a global grid, health that builds up (wood
// fastest), edits, structural collapse, server-side placement checks, and no
// turbo building. Done when one player can build a 1×1 with a ramp inside, edit
// a window into it, and a second player can tear it down.
import { ok, eq, near, section, report } from './harness.js';
import { flatBase, standIn, YAW, CELL, WALL_H } from './util.js';
import { Match } from '../server/match.js';
import {
  WALL, FLOOR, RAMP, CONE, MAT_STATS, BUILD_COST, WALL_WINDOW, WALL_DOOR, hpAt, pieceBoxes, slotKey, SLOT_CENTER, rampDirFromSelection,
} from '../shared/pieces.js';
import { buildTarget } from '../shared/build.js';
import { A_PLACE, A_EDIT, A_MAT, A_BUILD } from '../shared/protocol.js';
import { stepMovement, BTN_FIRE, BTN_SPRINT, MODE_WALK } from '../shared/movement.js';
import { aimFrame } from '../shared/aim.js';
import { WOOD, STONE, METAL, TICK_HZ } from '../shared/constants.js';

const newMatch = () => new Match({ base: flatBase(), mode: 'test' });

/** Places whatever `type` the player's current view targets; returns the piece or null. */
function place(m, p, type, { mat } = {}) {
  if (mat !== undefined) m.onAction(p, { type: A_MAT, mat });
  const t = buildTarget(type, p.move, p.yaw, p.pitch, m.world, {});
  m.onAction(p, { type: A_PLACE, piece: type, rot: t.rot, cx: t.cx, lv: t.lv, cz: t.cz });
  const before = m.world.nextPieceId;
  m.step();
  return m.world.nextPieceId > before ? m.world.pieces.get(before) : null;
}
const wait = (m, ticks) => { for (let i = 0; i < ticks; i++) m.step(); };

section('Four pieces, one grid, ten materials each');
{
  const m = newMatch();
  const p = standIn(m, 400, 400);
  p.mats = [100, 100, 100];
  p.yaw = YAW.east;
  const wall = place(m, p, WALL);
  ok(wall && wall.type === WALL, 'a wall goes up');
  eq(p.mats[WOOD], 90, 'it costs 10 wood');
  ok(wall.rot === 0 && wall.cx === 401 && wall.cz === 400, 'on the grid line in front of you (the east edge of your cell)');
  eq(wall.lv, 3, 'at the level you stand on');
  wait(m, 3);
  p.yaw = YAW.north; p.pitch = 0;
  const floor = place(m, p, FLOOR, { mat: STONE });
  ok(floor && floor.type === FLOOR && floor.cz === 399 && floor.mat === STONE, 'a floor goes in the cell ahead, in the chosen material');
  eq(p.mats[STONE], 90, '…costing 10 brick');
  wait(m, 3);
  p.pitch = 0.9;
  const cone = place(m, p, CONE, { mat: METAL });
  ok(cone && cone.type === CONE && cone.cx === 400 && cone.lv === 4, 'a cone goes over your head');
  eq(p.mats[METAL], 90, '…costing 10 metal');
  wait(m, 3);
  p.yaw = YAW.south; p.pitch = 0; p.move.z = (400 + 0.7) * CELL;
  const ramp = place(m, p, RAMP, { mat: WOOD });
  ok(ramp && ramp.type === RAMP && ramp.rot === 1 && ramp.cz === 401, 'a ramp goes across the next line, climbing away from you');
  eq(BUILD_COST, 10, 'every piece is 10 of its material');
  eq(CELL / 5.12, 1, 'a cell is 5.12 m — 512 uu'); eq(WALL_H / 3.84, 1, 'a wall is 3.84 m — 384 uu');
}

section('Health builds up after placing — wood fastest');
{
  const m = newMatch();
  const hp = { };
  for (const [mat, name] of [[WOOD, 'wood'], [STONE, 'stone'], [METAL, 'metal']]) {
    const p = standIn(m, 300 + mat * 4, 300);
    p.mats = [50, 50, 50];
    p.yaw = YAW.east;
    const w = place(m, p, WALL, { mat });
    hp[name] = { w, start: hpAt(w, m.tick) };
  }
  for (const k of ['wood', 'stone', 'metal']) ok(hp[k].start < MAT_STATS[['wood', 'stone', 'metal'].indexOf(k)].max * 0.3, `${k} starts low (${Math.round(hp[k].start)} HP)`);
  wait(m, TICK_HZ);
  const at1 = { wood: hpAt(hp.wood.w, m.tick), stone: hpAt(hp.stone.w, m.tick), metal: hpAt(hp.metal.w, m.tick) };
  ok(at1.wood > at1.stone && at1.stone > at1.metal, `one second in, wood is the strongest (${Math.round(at1.wood)} / ${Math.round(at1.stone)} / ${Math.round(at1.metal)})`);
  wait(m, 2 * TICK_HZ);
  near(hpAt(hp.wood.w, m.tick), 150, 0.01, 'wood is full (150) within three seconds');
  ok(hpAt(hp.stone.w, m.tick) < 300 && hpAt(hp.metal.w, m.tick) < 400, 'brick and metal are still building');
  wait(m, 13 * TICK_HZ);
  near(hpAt(hp.stone.w, m.tick), 300, 0.01, 'brick ends at 300');
  near(hpAt(hp.metal.w, m.tick), 400, 0.01, 'metal ends at 400');
}

section('The server says no');
{
  const m = newMatch();
  const p = standIn(m, 200, 200);
  p.mats = [100, 0, 0];
  p.yaw = YAW.east;
  ok(place(m, p, WALL), 'a first wall');
  const n = m.world.pieces.size;
  wait(m, 3);
  ok(!place(m, p, WALL), 'the same slot twice: refused');
  ok(!place(m, p, WALL, { mat: STONE }), 'no brick: refused');
  m.onAction(p, { type: A_MAT, mat: WOOD });
  // A floor in the air with nothing to attach to.
  m.onAction(p, { type: A_PLACE, piece: FLOOR, rot: 0, cx: 199, lv: 6, cz: 199 });
  m.step();
  eq(m.world.pieces.size, n, 'a floating floor with nothing to attach to: refused');
  // A slot far from where the player is looking.
  m.onAction(p, { type: A_PLACE, piece: WALL, rot: 0, cx: 260, lv: 3, cz: 200 });
  m.step();
  eq(m.world.pieces.size, n, 'a wall 300 m away: refused');
  // Walls are never built inside someone.
  const other = standIn(m, 203, 200, { name: 'other' });
  other.move.x = 203 * CELL + 0.05;   // standing right on the grid line
  const q = standIn(m, 202, 200, { name: 'builder' });
  q.mats = [100, 0, 0];
  q.yaw = YAW.east;
  q.move.x = 203 * CELL - 0.8;
  ok(!place(m, q, WALL), 'a wall through another player: refused');
  // A floor under your feet lifts you onto it instead.
  const r = standIn(m, 210, 210, { name: 'lifter' });
  r.mats = [100, 0, 0];
  r.pitch = -1.2;
  const y0 = r.move.y;
  const f = place(m, r, FLOOR);
  ok(f && f.cx === 210 && f.cz === 210, 'a floor under your own feet is allowed');
  ok(r.move.y > y0 + 0.05, '…and you are stood on top of it');
}

section('No turbo building');
{
  const m = newMatch();
  const p = standIn(m, 150, 150);
  p.mats = [999, 0, 0];
  // Someone holding the button would send a placement every tick; only one
  // per 0.1 s gets through, and the real client only sends one per click.
  let placed = 0;
  const dirs = [YAW.east, YAW.north, YAW.west, YAW.south];
  for (let t = 0; t < 12; t++) {
    p.yaw = dirs[t % 4];
    const target = buildTarget(WALL, p.move, p.yaw, 0, m.world, {});
    m.onAction(p, { type: A_PLACE, piece: WALL, rot: target.rot, cx: target.cx, lv: target.lv, cz: target.cz });
    const before = m.world.nextPieceId;
    m.step();
    if (m.world.nextPieceId > before) placed++;
  }
  ok(placed <= 4, `a placement every tick for 12 ticks gets ${placed} pieces, not 12`);
}

section('Editing');
{
  const m = newMatch();
  const p = standIn(m, 100, 100);
  p.mats = [200, 0, 0];
  p.yaw = YAW.east;
  const wall = place(m, p, WALL);
  wait(m, 3);
  m.onAction(p, { type: A_EDIT, id: wall.id, value: WALL_WINDOW });
  m.step();
  eq(wall.edit, WALL_WINDOW, 'a window edit');
  eq(pieceBoxes(wall).length, 4, 'the wall is now a frame round a hole');
  const hit = {};
  m.world.grid.raycast(100.5 * CELL, 3 * WALL_H + WALL_H / 2, 100.5 * CELL, 1, 0, 0, 20, hit);
  ok(hit.collider === null || m.world.ownerOf(hit.collider) !== wall, 'you can see (and shoot) through the window');
  m.onAction(p, { type: A_EDIT, id: wall.id, value: WALL_DOOR });
  m.step();
  // Walk through the door.
  const walker = p;
  for (let t = 0; t < 60; t++) stepMovement(walker.move, { mz: 1, yaw: YAW.east, buttons: 0 }, m.world);
  ok(walker.move.x > 101 * CELL + 1, 'a door edit lets you walk through');
  // Floor hole.
  const q = standIn(m, 120, 120, { name: 'q' });
  q.mats = [200, 0, 0];
  q.yaw = YAW.north;
  const floorA = place(m, q, FLOOR);
  wait(m, 3);
  m.onAction(q, { type: A_EDIT, id: floorA.id, value: 0b0001 });
  m.step();
  eq(pieceBoxes(floorA).length, 2, 'a floor hole edit leaves an L of three tiles');
  // Stairs turn: re-aim a ramp by selecting the side it should climb to.
  const r = standIn(m, 140, 140, { name: 'r' });
  r.mats = [200, 0, 0];
  r.yaw = YAW.east;
  r.move.x = 140 * CELL + 3.5;
  const ramp = place(m, r, RAMP);
  eq(ramp.rot, 0, 'a ramp climbing east');
  wait(m, 3);
  m.onAction(r, { type: A_EDIT, id: ramp.id, value: 0b1100 });
  m.step();
  eq(ramp.rot, 1, 'editing it turns the stairs to climb south');
  eq(rampDirFromSelection(0b0110), -1, 'a diagonal selection is not a valid stairs edit');
  // Nobody edits someone else's walls, or the map.
  const enemy = standIn(m, 101, 102, { name: 'enemy' });
  const before = wall.edit;
  m.onAction(enemy, { type: A_EDIT, id: wall.id, value: WALL_WINDOW });
  m.step();
  eq(wall.edit, before, "you cannot edit an enemy's wall");
}

section('Structural support');
{
  const m = newMatch();
  const p = standIn(m, 50, 50);
  p.mats = [999, 0, 0];
  // A stack held up by one ground wall: wall, floor on it, wall on that, floor on top.
  const w0 = m.world.addPiece({ id: m.world.nextPieceId++, type: WALL, rot: 0, cx: 51, lv: 3, cz: 50, mat: WOOD, edit: 0, start: -1, damage: 0, team: 1 });
  const f1 = m.world.addPiece({ id: m.world.nextPieceId++, type: FLOOR, rot: 0, cx: 51, lv: 4, cz: 50, mat: WOOD, edit: 0, start: -1, damage: 0, team: 1 });
  const w1 = m.world.addPiece({ id: m.world.nextPieceId++, type: WALL, rot: 1, cx: 51, lv: 4, cz: 51, mat: WOOD, edit: 0, start: -1, damage: 0, team: 1 });
  const f2 = m.world.addPiece({ id: m.world.nextPieceId++, type: FLOOR, rot: 0, cx: 51, lv: 5, cz: 50, mat: WOOD, edit: 0, start: -1, damage: 0, team: 1 });
  ok(w0.grounded && !f1.grounded && !w1.grounded && !f2.grounded, 'only the bottom wall touches the ground');
  m.destroyStructure(w0, 'piece');
  ok(!f1.alive && !w1.alive && !f2.alive, 'destroying the base piece brings down everything it held up');
  // Two supports: losing one is fine.
  const a = m.world.addPiece({ id: m.world.nextPieceId++, type: WALL, rot: 0, cx: 60, lv: 3, cz: 60, mat: WOOD, edit: 0, start: -1, damage: 0, team: 1 });
  const b = m.world.addPiece({ id: m.world.nextPieceId++, type: WALL, rot: 0, cx: 61, lv: 3, cz: 60, mat: WOOD, edit: 0, start: -1, damage: 0, team: 1 });
  const top = m.world.addPiece({ id: m.world.nextPieceId++, type: FLOOR, rot: 0, cx: 60, lv: 4, cz: 60, mat: WOOD, edit: 0, start: -1, damage: 0, team: 1 });
  m.destroyStructure(a, 'piece');
  ok(top.alive, 'a floor on two walls survives losing one of them');
  m.destroyStructure(b, 'piece');
  ok(!top.alive, '…and falls when the second goes');
}

section('Ramp rush');
{
  const m = newMatch();
  const p = standIn(m, 600, 600);
  p.mats = [999, 0, 0];
  p.yaw = YAW.east;
  p.botInput = { mz: 1, mx: 0, yaw: YAW.east, pitch: -0.2, buttons: BTN_SPRINT };
  const y0 = p.move.y;
  let ramps = 0;
  for (let t = 0; t < 12 * TICK_HZ; t++) {
    // Click whenever a ramp would go somewhere new.
    const target = buildTarget(RAMP, p.move, p.yaw, p.pitch, m.world, {});
    if (!m.world.slots.get(slotKey(SLOT_CENTER, target.cx, target.lv, target.cz)) && t % 3 === 0) {
      m.onAction(p, { type: A_PLACE, piece: RAMP, rot: target.rot, cx: target.cx, lv: target.lv, cz: target.cz });
    }
    const before = m.world.nextPieceId;
    m.step();
    if (m.world.nextPieceId > before) ramps++;
  }
  ok(ramps >= 6, `running and clicking chains ramps (${ramps} placed)`);
  ok(p.move.y - y0 > 5 * WALL_H, `…and climbs (${((p.move.y - y0) / WALL_H).toFixed(1)} levels up)`);
  eq(p.move.mode, MODE_WALK, 'still on your feet');
}

section('Done when: a 1×1 with a ramp, a window edit, and someone tears it down');
{
  const m = newMatch();
  const a = standIn(m, 700, 700, { name: 'builder' });
  a.mats = [200, 0, 0];
  const walls = [];
  for (const yaw of [YAW.east, YAW.west, YAW.south, YAW.north]) {
    a.yaw = yaw;
    walls.push(place(m, a, WALL));
    wait(m, 3);
  }
  ok(walls.every(Boolean), 'four walls around the builder');
  // Step to the back of the box and put a ramp in it.
  a.move.x = 700 * CELL + 1.0;
  a.yaw = YAW.east;
  const ramp = place(m, a, RAMP);
  ok(ramp && ramp.cx === 700 && ramp.cz === 700, 'a ramp inside the box');
  wait(m, 3);
  a.pitch = 0.9;
  const roof = place(m, a, CONE);
  ok(roof, 'and a cone on top');
  const north = walls[3];
  m.onAction(a, { type: A_EDIT, id: north.id, value: WALL_WINDOW });
  m.step();
  eq(north.edit, WALL_WINDOW, 'a window edited into the north wall');
  // Player two walks up and takes it apart with a pickaxe.
  const b = standIn(m, 702, 700, { name: 'wrecker', team: 99 });
  const pieces = [...walls, ramp, roof];
  let swings = 0;
  for (const target of pieces) {
    for (let t = 0; t < 30 * TICK_HZ && target.alive; t++) {
      const box = target.type === CONE ? null : pieceBoxes(target)[0];
      const c = box || { x: (target.cx + 0.5) * CELL, y: target.lv * WALL_H + 0.6, z: (target.cz + 0.5) * CELL };
      // Stand 1.6 m off the piece, on its outside, and look straight at it.
      b.move.x = c.x + (target.type === WALL && target.rot === 0 ? (c.x > 700.5 * CELL ? 1.6 : -1.6) : 1.6);
      b.move.z = c.z + (target.type === WALL && target.rot === 1 ? (c.z > 700.5 * CELL ? 1.6 : -1.6) : 0.3);
      b.move.y = c.y - 1.4;
      let yaw = 0, pitch = 0;
      for (let i = 0; i < 6; i++) {
        const f = aimFrame(b.move, yaw, pitch, false, {});
        const ax = c.x - f.ox, ay = c.y - f.oy, az = c.z - f.oz;
        yaw = Math.atan2(-ax, -az); pitch = Math.atan2(ay, Math.hypot(ax, az));
      }
      b.yaw = yaw; b.pitch = pitch; b.buttons = BTN_FIRE;
      const n = b.nextSwing;
      m.step();
      if (b.nextSwing !== n) swings++;
    }
  }
  b.buttons = 0;
  ok(pieces.every((q) => !q.alive), `the whole box comes down (${swings} pickaxe swings)`);
  eq(b.mats[WOOD], 0, 'breaking player builds yields no materials');
  void A_BUILD; void near;
}

report();
