// The map and everything solid in it.

import { ok, near, section } from './harness.js';
import { drive } from './drive.js';
import { buildWorld, trackPlace, PIT, AVENUES, STREETS } from '#shared/world.js';
import { collideCar, carBox, Props } from '#shared/collide.js';
import { Vehicle, STEP } from '#shared/vehicle.js';
import { Pilot, blankInput } from '#shared/pilot.js';
import { CARS } from '#shared/cars.js';

const world = buildWorld();
const { shapes, track } = world;

/** Is a car-sized box at (x, y, heading) clear of everything solid? */
function clear(x, y, heading = 0) {
  const car = new Vehicle(CARS[0]);
  car.reset(x, y, heading);
  const before = { x: car.x, y: car.y };
  collideCar(car, shapes);
  return Math.hypot(car.x - before.x, car.y - before.y) < 1e-6;
}

section('Layout');
{
  const again = buildWorld();
  ok(again.buildings.length === world.buildings.length && again.buildings.every((b, i) => b.x === world.buildings[i].x && b.h === world.buildings[i].h), `the same seed builds the same city (${world.buildings.length} buildings)`);
  for (const [name, sp] of Object.entries(world.spawns)) ok(clear(sp.x, sp.y, sp.heading), `the ${name} spawn is on open road`);
  const blocked = [];
  const island = (x, y) => Math.hypot(x - world.roundabout.x, y - world.roundabout.y) < world.roundabout.island + 1.5;
  for (const s of STREETS) for (let x = world.city.west + 6; x < world.city.east - 6; x += 3) if (!island(x, s.y) && !clearLane(x, s.y)) blocked.push([x, s.y]);
  for (const a of AVENUES) for (let y = world.city.south + 6; y < world.city.north - 6; y += 3) if (!island(a.x, y) && !clearLane(a.x, y)) blocked.push([a.x, y]);
  ok(blocked.length === 0, 'every street and avenue has a clear lane down its middle (round the roundabout)', JSON.stringify(blocked.slice(0, 5)));
  const pitFree = [...Array(24)].every((_, i) => clear(PIT.x + Math.cos(i / 24 * Math.PI * 2) * 18, PIT.y + Math.sin(i / 24 * Math.PI * 2) * 18, i));
  ok(pitFree, 'the Pit is open ground for 18 m all round');
  let maxc = 0;
  for (const n of track.nodes) maxc = Math.max(maxc, Math.abs(n.curv));
  ok(1 / maxc > 25, `the circuit's tightest corner is ${(1 / maxc).toFixed(0)} m radius`);
  ok(track.length > 1500 && track.length < 2600, `the circuit is ${(track.length / 1000).toFixed(2)} km`);
  ok(track.clips.length >= 12, `with ${track.clips.length} judging clips and zones`);
  const lane = track.nodes.every((n, i) => i % 5 || clear(n.x, n.y, Math.atan2(n.ty, n.tx)));
  ok(lane, 'its whole centre line is open');
  function clearLane(x, y) {
    let hit = false;
    shapes.query(x, y, 1.2, (s) => { if (s.tag !== 'lamp') hit = hit || (s.kind === 'circle' ? Math.hypot(x - s.x, y - s.y) < s.r + 1 : Math.abs((x - s.x) * s.c + (y - s.y) * s.s) < s.hw + 1 && Math.abs(-(x - s.x) * s.s + (y - s.y) * s.c) < s.hh + 1); });
    return !hit;
  }
}

section('Getting between the three');
{
  // Drive from the city down the boulevard, through the paddock and onto the circuit.
  const car = new Vehicle(CARS[0]);
  const p = new Pilot(car);
  const keys = blankInput();
  car.reset(0, 120, -Math.PI / 2);
  const route = [[0, 30], [0, -60], [0, -100], [0, -130], [60, -135]];
  let leg = 0, t = 0, hits = 0;
  while (t < 60 && leg < route.length) {
    const [tx, ty] = route[leg];
    const want = Math.atan2(ty - car.y, tx - car.x);
    const err = Math.atan2(Math.sin(want - Math.atan2(car.vy, car.vx) ), Math.cos(want - Math.atan2(car.vy, car.vx)));
    keys.steer = car.speed < 2 ? Math.sign(Math.atan2(Math.sin(want - car.heading), Math.cos(want - car.heading))) : Math.abs(err) < 0.05 ? 0 : Math.sign(err);
    keys.throttle = car.speed < 12 ? 1 : 0;
    car.step(STEP, p.update(STEP, keys));
    const hit = collideCar(car, shapes);
    if (hit && hit.speed > 1) hits++;
    if (Math.hypot(car.x - tx, car.y - ty) < 8) leg++;
    t += STEP;
  }
  ok(leg === route.length, `the boulevard leads from downtown to the circuit (${t.toFixed(0)} s)`);
  ok(hits === 0, 'without touching a wall');
}

section('Walls');
{
  // Straight into a building at 50 km/h.
  const car = new Vehicle(CARS[1]);
  const b = world.buildings.find((w) => w.x > 60 && w.y > 380 && w.y < 440);
  car.reset(b.x - b.w / 2 - 30, b.y, 0);
  car.vx = 50 / 3.6;
  let worst = null, inside = false;
  for (let i = 0; i < 480; i++) {
    car.step(STEP, { steer: 0, throttle: 0, brake: 0, handbrake: 0, clutch: 1 });
    const h = collideCar(car, shapes);
    if (h && (!worst || h.speed > worst.speed)) worst = h;
    const box = carBox(car);
    if (box.x + box.hw > b.x - b.w / 2 + 0.05) inside = true;
  }
  ok(worst && worst.speed > 12, `a head-on hit registers (${worst?.speed.toFixed(1)} m/s)`);
  ok(!inside, 'the car never ends up inside the building');
  ok(car.vx < 0.5 && car.vx > -6, `it bounces back a little (${car.vx.toFixed(1)} m/s)`);

  // A glancing scrape keeps most of the speed.
  const g = new Vehicle(CARS[0]);
  const wallY = b.y - b.d / 2;
  g.reset(b.x - b.w / 2 - 10, wallY - 1.2, 0.12);
  g.vx = 20 * Math.cos(0.12); g.vy = 20 * Math.sin(0.12);
  for (let i = 0; i < 120; i++) { g.step(STEP, { steer: 0, throttle: 0, brake: 0, handbrake: 0, clutch: 1 }); collideCar(g, shapes); }
  ok(g.speed > 14, `a glancing scrape keeps most of the speed (${(g.speed * 3.6).toFixed(0)} km/h)`);

  // Flat out at 250 km/h into the harbour fence: no tunnelling.
  const f = new Vehicle(CARS[0]);
  f.reset(0, -600, -Math.PI / 2);
  f.vy = -70;
  for (let i = 0; i < 240; i++) { f.step(STEP, { steer: 0, throttle: 0, brake: 0, handbrake: 0, clutch: 1 }); collideCar(f, shapes); }
  ok(f.y > world.harbor.y0, `even at 250 km/h nothing goes through a wall (${f.y.toFixed(1)})`);
}

section('Cones');
{
  const props = new Props();
  const cone = props.add(20, 0, 0.3, 4, 'cone');
  const car = new Vehicle(CARS[0]);
  car.reset(0, 0, 0);
  car.vx = 15;
  let hit = 0;
  for (let i = 0; i < 480; i++) {
    car.step(STEP, { steer: 0, throttle: 0, brake: 0, handbrake: 0, clutch: 1 });
    hit += props.hitByCar(car).length;
    props.step(STEP, null);
  }
  ok(hit > 0 && cone.x > 30, `a cone gets punted down the road (${cone.x.toFixed(0)} m)`);
  ok(car.speed > 12, 'and the car hardly notices');
  ok(cone.tilt > 1.2, 'and it ends up on its side');
}

section('Where you are on the circuit');
{
  const n = track.nodes[300];
  const at = trackPlace(track, n.x + n.nx * 3, n.y + n.ny * 3);
  ok(at.index === 300, 'the nearest point of the centre line is found');
  near(at.offset, 3, 0.05, 'with the offset to the left');
  const far = trackPlace(track, 0, 400);
  ok(!far.onTrack, 'downtown is not on the circuit');
}
