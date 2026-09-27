// M2 — harvesting: a pickaxe on a cooldown, materials by type, weak points,
// yields and caps. Done when a house can be stripped to nothing and you walk
// away with all three material counters stocked.
import { ok, eq, near, section, report } from './harness.js';
import { Match } from '../server/match.js';
import { PROP_KINDS, PROP, propMaxHp } from '../shared/props.js';
import { MAT_STATS, WALL, FLOOR, RAMP, CONE, pieceCenter, pieceBoxes } from '../shared/pieces.js';
import { aimFrame } from '../shared/aim.js';
import { BTN_FIRE } from '../shared/movement.js';
import { EYE_STAND } from '../shared/constants.js';
import { EV_HARVEST } from '../shared/events.js';
import { WOOD, STONE, METAL, CELL, WALL_H, MAT_CAP } from '../shared/constants.js';
import { SWING_TICKS, PICK_REACH } from '../server/harvest.js';
import { propCenter } from '../shared/props.js';

/** Puts p's eye ~1.6 m from a point, looking straight at it through the aim line. */
function aimAt(match, p, tx, ty, tz, from = null, dist = 1.6) {
  let dx, dz, dy;
  if (from) { dx = from.x; dy = from.y; dz = from.z; } else { dx = 1; dy = 0; dz = 0; }
  const len = Math.hypot(dx, dy, dz);
  const ex = tx - (dx / len) * dist, ey = ty - (dy / len) * dist, ez = tz - (dz / len) * dist;
  p.move.x = ex; p.move.y = ey - EYE_STAND; p.move.z = ez; p.move.crouch = 0;
  p.move.vx = p.move.vy = p.move.vz = 0;
  // The aim line starts beside the head, so iterate yaw/pitch until it passes through the target.
  let yaw = Math.atan2(-(tx - ex), -(tz - ez)), pitch = 0;
  for (let i = 0; i < 6; i++) {
    const f = aimFrame(p.move, yaw, pitch, false, {});
    const ax = tx - f.ox, ay = ty - f.oy, az = tz - f.oz;
    yaw = Math.atan2(-ax, -az);
    pitch = Math.atan2(ay, Math.hypot(ax, az));
  }
  p.yaw = yaw; p.pitch = pitch;
}

/** How far from its centre to stand so the eye is clear of an object. */
function standOff(obj, kind) {
  if (kind === 'piece') return 1.6;
  const k = PROP_KINDS[obj.kind];
  const half = k.shape === 'cyl' ? k.r * (obj.s || 1) : Math.max(k.size[0], k.size[2]) * (obj.s || 1) / 2;
  return half + 1.2;
}

/** Swings at an object until it breaks (or the budget runs out); returns swings made. */
function swingUntilGone(match, p, obj, kind, from, maxTicks = 400) {
  // Aim at a tile that is still there — a window or door edit leaves a hole in the middle.
  const boxes = kind === 'piece' && obj.type !== CONE ? pieceBoxes(obj) : [];
  const c = boxes.length ? boxes[0] : kind === 'piece' ? pieceCenter(obj, {}) : propCenter(obj, {});
  let swings = 0;
  for (let t = 0; t < maxTicks && obj.alive; t++) {
    aimAt(match, p, c.x, c.y, c.z, from, standOff(obj, kind));
    p.buttons = BTN_FIRE;
    const before = p.nextSwing;
    match.step();
    if (p.nextSwing !== before) swings++;
  }
  p.buttons = 0;
  return swings;
}

function harvester(match) {
  const p = match.addPlayer({ name: 'harvester', bot: true });
  p.botInput = null;          // stands exactly where the test puts it
  return p;
}

section('Every prop has health and a material');
{
  ok(PROP_KINDS.every((k) => k.hp > 0 && [WOOD, STONE, METAL].includes(k.mat)), 'all prop kinds have hit points and one of wood / stone / metal');
  eq(PROP_KINDS[PROP.pine].mat, WOOD, 'trees are wood'); eq(PROP_KINDS[PROP.pallet].mat, WOOD, 'pallets are wood'); eq(PROP_KINDS[PROP.sofa].mat, WOOD, 'furniture is wood');
  eq(PROP_KINDS[PROP.rock].mat, STONE, 'rocks are stone'); eq(PROP_KINDS[PROP.car].mat, METAL, 'cars are metal'); eq(PROP_KINDS[PROP.container].mat, METAL, 'containers are metal');
  const m = new Match();
  const pieces = [...m.world.pieces.values()];
  ok(pieces.every((p) => MAT_STATS[p.mat]), 'every map piece is wood, brick or metal');
  const mats = new Set(pieces.map((p) => p.mat));
  ok(mats.size === 3, 'the map is built from all three materials');
}

section('The pickaxe');
{
  const m = new Match();
  const p = harvester(m);
  const tree = m.world.props.find((q) => q && q.kind === PROP.pine && Math.abs(q.s - 1) < 0.05);
  const c = propCenter(tree, {});
  let swings = 0, hits = [];
  const hp0 = propMaxHp(tree);
  for (let t = 0; t < 90; t++) {       // three seconds of holding the button
    aimAt(m, p, c.x, c.y, c.z, null, standOff(tree, 'prop'));
    p.buttons = BTN_FIRE;
    const before = p.nextSwing, woodBefore = p.mats[WOOD];
    m.step();
    if (p.nextSwing !== before) swings++;
    if (p.mats[WOOD] !== woodBefore) hits.push(p.mats[WOOD] - woodBefore);
    if (!tree.alive) break;
  }
  eq(SWING_TICKS, 15, 'one swing every half second');
  ok(swings >= 3 && swings <= 4, `holding the button swings on the cooldown, not every tick (${swings} swings)`);
  const normal = hits.filter((h) => h < 15);
  ok(normal.length > 0 && normal.every((h) => h >= 8 && h <= 12), `a normal hit yields 8–12 (${normal.join(', ')})`);
  ok(!tree.alive, 'a tree comes down');
  const total = p.mats[WOOD];
  ok(total >= 30 && total <= 50, `…and gives 30–50 wood in all (${total} from a ${hp0} HP tree)`);
}

section('Weak points');
{
  const m = new Match();
  const p = harvester(m);
  const rock = m.world.props.find((q) => q && q.kind === PROP.boulder);
  const c = propCenter(rock, {});
  const face = { x: 1, y: -0.1, z: 0.2 };
  aimAt(m, p, c.x, c.y, c.z, face, standOff(rock, 'prop')); p.buttons = BTN_FIRE; m.step(); p.buttons = 0;
  ok(p.weak && p.weak.target === rock, 'the first hit puts a weak point on the object');
  const first = { x: p.weak.x, y: p.weak.y, z: p.weak.z };
  const hpBefore = rock.hp;
  for (let t = 0; t < SWING_TICKS; t++) m.step();
  // Swing at the marker itself.
  const eye = { x: p.move.x, y: p.move.y + EYE_STAND, z: p.move.z };
  aimAt(m, p, first.x, first.y, first.z, { x: first.x - eye.x, y: first.y - eye.y, z: first.z - eye.z }, 1.5);
  const stoneBefore = p.mats[STONE];
  p.buttons = BTN_FIRE;
  let weakEvent = false;
  const origEvent = m.event.bind(m);
  m.event = (type, x, y, z, a, b, c2) => { if (type === EV_HARVEST && c2 === 1) weakEvent = true; origEvent(type, x, y, z, a, b, c2); };
  m.step();
  p.buttons = 0;
  eq(hpBefore - rock.hp, 100, 'hitting the weak point does double damage (100 instead of 50)');
  ok(weakEvent, 'and everyone nearby sees it was a weak-point hit');
  ok(p.mats[STONE] - stoneBefore >= 16, `…and yields double (${p.mats[STONE] - stoneBefore} stone)`);
  ok(p.weak && Math.hypot(p.weak.x - first.x, p.weak.y - first.y, p.weak.z - first.z) > 0.2, 'then the marker moves somewhere else');
}

section('Caps');
{
  const m = new Match();
  const p = harvester(m);
  p.mats[WOOD] = 995;
  const tree = m.world.props.find((q) => q && q.kind === PROP.oak);
  swingUntilGone(m, p, tree, 'prop');
  eq(p.mats[WOOD], MAT_CAP, 'materials stop at 999');
  eq(MAT_CAP, 999, 'the cap is 999 per material');
}

section('Done when: strip a house to nothing and walk away with all three materials');
{
  const m = new Match();
  const p = harvester(m);
  // A brick-and-timber house in a suburb, with a kitchen and a car out front.
  const houses = m.base.buildings.filter((b) => b.kind === 'home' && b.poi >= 0 && b.floors === 2);
  let house = null;
  for (const h of houses) {
    const x0 = h.cx * CELL - 8, x1 = (h.cx + h.w) * CELL + 8, z0 = h.cz * CELL - 12, z1 = (h.cz + h.d) * CELL + 12;
    const props = m.world.props.filter((q) => q && q.x > x0 && q.x < x1 && q.z > z0 && q.z < z1);
    const metal = props.filter((q) => PROP_KINDS[q.kind].mat === METAL);
    const pieces = [...m.world.pieces.values()].filter((q) => q.cx >= h.cx && q.cx <= h.cx + h.w && q.cz >= h.cz && q.cz <= h.cz + h.d && q.lv >= h.lv && q.lv <= h.lv + h.floors);
    if (metal.length && pieces.some((q) => q.mat === STONE)) { house = { ...h, props, pieces }; break; }
  }
  ok(house, 'found a two-storey brick house with metal in it');
  const out = { x: 0, y: 0, z: 1 };
  // Top down, so nothing is lost to collapse: furniture and car, roof, then each storey.
  let swings = 0;
  for (const q of house.props) swings += swingUntilGone(m, p, q, 'prop', { x: 0.3, y: -0.4, z: 1 });
  const order = [...house.pieces].sort((a, b) => b.lv - a.lv || (a.type === CONE ? -1 : 0) - (b.type === CONE ? -1 : 0) || (a.type === FLOOR) - (b.type === FLOOR));
  for (const q of order) {
    if (!q.alive) continue;
    const dir = q.type === WALL ? (q.rot === 0 ? { x: 1, y: -0.15, z: 0.05 } : { x: 0.05, y: -0.15, z: 1 })
      : q.type === CONE ? { x: 0.2, y: -1, z: 0.3 } : q.type === FLOOR ? { x: 0.2, y: -1, z: 0.25 } : { x: 0.3, y: -0.8, z: 0.2 };
    swings += swingUntilGone(m, p, q, 'piece', dir);
  }
  const standing = house.pieces.filter((q) => q.alive).length + house.props.filter((q) => q.alive).length;
  if (process.env.DEBUG) {
    console.log('house', house.cx, house.cz, house.w, house.d, house.lv, house.floors);
    for (const q of house.pieces.filter((q) => q.alive)) console.log('  piece', ['wall', 'floor', 'ramp', 'cone'][q.type], q.cx, q.lv, q.cz, 'rot', q.rot, 'hp', q.damage);
    for (const q of house.props.filter((q) => q.alive)) console.log('  prop', PROP_KINDS[q.kind].name, q.x.toFixed(1), q.y.toFixed(1), q.z.toFixed(1), q.hp);
  }
  eq(standing, 0, `every wall, floor, roof, stair and stick of furniture is gone (${house.pieces.length} pieces, ${house.props.length} props)`);
  const [wood, stone, metal] = p.mats;
  ok(wood > 150, `wood counter stocked: ${wood}`);
  ok(stone > 100, `stone counter stocked: ${stone}`);
  ok(metal > 40, `metal counter stocked: ${metal}`);
  ok(swings > 0 && (m.collapsed || 0) === 0, `stripped by hand, top down, in ${swings} swings with nothing lost to collapse`);
  void out; void out; void WALL_H; void RAMP; void PICK_REACH;
}

report();
