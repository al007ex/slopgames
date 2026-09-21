// Simulation tests. These drive the real World with no sockets, which is why it
// was kept free of them: movement, eating, boosting, every way to die and the
// bots all get exercised in well under a second.

import { ok, eq, near, section, report } from './harness.js';
import { World } from '../server/world.js';
import { Grid } from '../server/spatial.js';
import { LEFT_GAME } from '../shared/protocol.js';
import {
  SIM_HZ, ARENA_RADIUS, START_MASS, MIN_BOOST_MASS, BASE_SPEED, BOOST_SPEED, FOOD_TARGET,
  FOOD_MAX, FOOD_DECAY_SECONDS, SNAKE_TARGET, MIN_BOTS, DEATH_DROP_RATIO, SKINS,
  segmentsOf, spacingOf, turnRateOf, widthOf,
} from '../shared/rules.js';

const seconds = (world, s, each) => {
  for (let i = 0; i < Math.round(s * SIM_HZ); i++) { each?.(world); world.step(); }
};
const head = (snake) => ({ x: snake.points[0], y: snake.points[1] });

/** A world with no bots and no food, so a test controls everything in it. */
function quietWorld(seed = 1) {
  const world = new World({ seed, bots: false });
  for (const food of [...world.food.values()]) world.removeFood(food, 0);
  world.naturalFood = FOOD_TARGET;   // stop the upkeep from refilling the board
  world.takeEvents();
  return world;
}

/** Put a snake exactly where a test wants it, lying straight behind its head. */
function place(world, { x, y, angle = 0, mass = START_MASS, name = 'test', skin = 0 }) {
  const snake = world.spawnSnake({ name, skin });
  snake.mass = mass;
  snake.angle = snake.targetAngle = angle;
  snake.width = widthOf(mass);
  snake.spacing = spacingOf(mass);
  snake.points = [];
  for (let i = 0; i < segmentsOf(mass); i++) {
    snake.points.push(x - Math.cos(angle) * snake.spacing * i, y - Math.sin(angle) * snake.spacing * i);
  }
  world.bounds(snake);
  return snake;
}

section('A new world');
{
  const world = new World({ seed: 3 });
  eq(world.naturalFood, FOOD_TARGET, 'is stocked with food');
  eq(world.botsAlive, SNAKE_TARGET, 'is full of bots before anyone arrives');
  ok([...world.food.values()].every((f) => Math.hypot(f.x, f.y) < ARENA_RADIUS), 'every pellet is inside the arena');
  ok([...world.snakes.values()].every((s) => Math.hypot(s.points[0], s.points[1]) <= ARENA_RADIUS * 0.6 + 1e-6), 'every snake spawns in the middle 60% of the arena');
  world.humansAlive = 5;
  eq(world.desiredBots(), SNAKE_TARGET - 5, 'bots make room as people arrive');
  world.humansAlive = 40;
  eq(world.desiredBots(), MIN_BOTS, 'but a floor of bots always stays');
}

section('Movement');
{
  const world = quietWorld();
  const snake = place(world, { x: 0, y: 0, angle: 0 });
  seconds(world, 1);
  near(head(snake).x, BASE_SPEED, 1, 'a snake covers its base speed in one second');
  near(head(snake).y, 0, 0.001, 'and goes straight when not steered');

  let maxGap = 0;
  for (let i = 2; i < snake.points.length; i += 2) {
    maxGap = Math.max(maxGap, Math.hypot(snake.points[i] - snake.points[i - 2], snake.points[i + 1] - snake.points[i - 1]));
  }
  ok(maxGap <= snake.spacing + 1e-6, 'the body never stretches past its spacing', `${maxGap} > ${snake.spacing}`);

  const turner = place(world, { x: -500, y: 500, angle: 0 });
  turner.targetAngle = Math.PI / 2;
  world.step();
  near(turner.angle, turnRateOf(turner.mass) / SIM_HZ, 1e-9, 'turning is limited to the turn rate per tick');
  seconds(world, 1);
  near(turner.angle, Math.PI / 2, 1e-9, 'and settles exactly on the target heading');
  ok(turnRateOf(20000) < turnRateOf(10), 'big snakes turn slower than small ones');
}

section('Eating and growing');
{
  const world = quietWorld();
  const snake = place(world, { x: 0, y: 0, angle: 0 });
  const food = world.addFood(60, 0, 5, 2, false);
  world.takeEvents();
  seconds(world, 0.5);
  ok(!world.food.has(food.id), 'food in the path is eaten');
  near(snake.mass, START_MASS + 5, 1e-9, 'and its value is added to mass');
  const events = world.takeEvents();
  ok(events.foodEaten.some((e) => e.id === food.id && e.eater === snake.id), 'the eat event names the eater');

  const grown = place(world, { x: 0, y: 800, angle: 0 });
  grown.mass = 400;
  seconds(world, 2);
  eq(grown.points.length / 2, segmentsOf(400), 'extra mass becomes extra body');
  near(grown.width, widthOf(400), 1e-9, 'and extra width');
}

section('Boosting');
{
  const world = quietWorld();
  const booster = place(world, { x: -1000, y: 0, angle: 0, mass: 200 });
  const cruiser = place(world, { x: -1000, y: 600, angle: 0, mass: 200 });
  booster.boost = true;
  world.takeEvents();
  const x0 = head(booster).x;
  seconds(world, 1);
  near(head(booster).x - x0, BOOST_SPEED, 1, 'boosting moves at boost speed');
  ok(booster.mass < cruiser.mass, 'boosting burns mass');
  const drops = world.takeEvents().foodAdded;
  ok(drops.length > 0, 'and leaves a trail of food behind');
  ok(drops.every((f) => f.color === SKINS[booster.skin].food), 'in the snake’s own colour');
  const dropped = drops.reduce((sum, f) => sum + f.value, 0);
  ok(dropped <= 200 - booster.mass + 1e-6 && dropped > (200 - booster.mass) * 0.5, 'the trail is worth the mass that was burned');

  const tiny = place(world, { x: 0, y: -900, angle: 0, mass: MIN_BOOST_MASS - 1 });
  tiny.boost = true;
  world.step();
  ok(!tiny.boosting, 'a snake at minimum size cannot boost');
  near(tiny.mass, MIN_BOOST_MASS - 1, 1e-9, 'and loses nothing trying');
}

section('Dying');
{
  const world = quietWorld();
  // A long snake heading away down the screen, its body lying across the path
  // of a small one: head at y=250, body reaching up past y=0.
  const wall = place(world, { x: 300, y: 250, angle: Math.PI / 2, mass: 600 });
  wall.targetAngle = Math.PI / 2;
  const victim = place(world, { x: 150, y: 0, angle: 0, mass: 80 });
  world.takeEvents();
  seconds(world, 1.5);
  ok(!victim.alive, 'running your head into a body kills you');
  ok(wall.alive, 'and the body you hit survives');
  eq(wall.kills, 1, 'the owner of that body is credited');
  const deaths = world.takeEvents();
  eq(deaths.deaths[0]?.killer, wall.id, 'the death event names the killer');
  const drop = deaths.foodAdded.filter((f) => f.color === SKINS[victim.skin].food && !f.natural);
  const dropped = drop.reduce((sum, f) => sum + f.value, 0);
  near(dropped, victim.mass * DEATH_DROP_RATIO, 1e-6, 'the body turns into food worth most of its mass');
}
{
  const world = quietWorld();
  const coiler = place(world, { x: 0, y: 0, angle: 0, mass: 800 });
  coiler.targetAngle = Math.PI;    // turn sharply back across its own body
  seconds(world, 3, (w) => { coiler.targetAngle += 0.2; });
  ok(coiler.alive, 'your own body never kills you');
}
{
  const world = quietWorld();
  const a = place(world, { x: -60, y: 0, angle: 0, mass: 30 });
  const b = place(world, { x: 60, y: 0, angle: Math.PI, mass: 30 });
  seconds(world, 1);
  ok(!a.alive && !b.alive, 'a head-on collision takes out both snakes');
}
{
  const world = quietWorld();
  const snake = place(world, { x: ARENA_RADIUS - 120, y: 0, angle: 0 });
  world.takeEvents();
  seconds(world, 2);
  ok(!snake.alive, 'the arena edge kills');
  eq(world.takeEvents().deaths[0]?.killer, 0, 'and nobody is credited');
}
{
  const world = quietWorld();
  const quitter = place(world, { x: 0, y: 0, mass: 300 });
  const other = place(world, { x: 0, y: 900 });
  world.kill(quitter, LEFT_GAME);
  ok(!quitter.alive, 'a player who disconnects is removed');
  eq(other.kills, 0, 'without crediting anyone');
  ok(world.takeEvents().foodAdded.length > 0, 'but their body still drops as food');
}

section('Food upkeep');
{
  const world = quietWorld();
  const natural = world.addFood(0, 0, 1, 0, false);
  const dropped = world.addFood(10, 0, 3, 0, true);
  seconds(world, FOOD_DECAY_SECONDS + 1);
  ok(world.food.has(natural.id), 'natural food stays until eaten');
  ok(!world.food.has(dropped.id), 'dropped food decays');

  const full = new World({ seed: 5, bots: false });
  for (let i = 0; i < FOOD_MAX + 500; i++) full.addFood(0, 0, 1, 0, true);
  ok(full.food.size <= FOOD_MAX, 'the board never holds more than the food ceiling', `${full.food.size}`);

  const regrow = new World({ seed: 6, bots: false });
  for (const food of [...regrow.food.values()].slice(0, 400)) regrow.removeFood(food, 0);
  seconds(regrow, 5);
  eq(regrow.naturalFood, FOOD_TARGET, 'eaten natural food grows back');
}

section('Spatial grid');
{
  const grid = new Grid(96);
  const items = [];
  for (let i = 0; i < 2000; i++) {
    const item = { x: (Math.sin(i * 12.9898) * 43758.5453 % 1) * 2400, y: (Math.sin(i * 78.233) * 12345.678 % 1) * 2400 };
    item.key = grid.insert(item.x, item.y, item);
    items.push(item);
  }
  let mismatches = 0;
  for (let q = 0; q < 50; q++) {
    const qx = (q * 97) % 2400 - 1200;
    const qy = (q * 53) % 2400 - 1200;
    const r = 60 + (q * 7) % 300;
    const found = new Set();
    grid.query(qx, qy, r, (item) => { if (Math.hypot(item.x - qx, item.y - qy) <= r) found.add(item); });
    const truth = items.filter((item) => Math.hypot(item.x - qx, item.y - qy) <= r);
    if (truth.length !== found.size || truth.some((item) => !found.has(item))) mismatches++;
  }
  eq(mismatches, 0, 'grid queries find exactly what a brute-force scan finds');
  grid.remove(items[0].key, items[0]);
  let seen = false;
  grid.query(items[0].x, items[0].y, 1, (item) => { if (item === items[0]) seen = true; });
  ok(!seen, 'removed items are gone');
}

section('What each client is sent');
{
  const world = quietWorld();
  const near1 = place(world, { x: 100, y: 100 });
  const far = place(world, { x: 2000, y: -2000 });
  const long = place(world, { x: -1400, y: 0, angle: Math.PI, mass: 3000 });   // head far away, body reaching in
  const ids = world.visible(0, 0, 800, 600).map((s) => s.id);
  ok(ids.includes(near1.id), 'snakes on screen are included');
  ok(!ids.includes(far.id), 'snakes far off screen are not');
  ok(long.maxX > -800 === ids.includes(long.id), 'a snake is included when any of its body is on screen, not just its head');
}

section('Bots');
{
  const world = new World({ seed: 11 });
  let wall = 0;
  let deaths = 0;
  let peak = 0;
  seconds(world, 180, (w) => {
    for (const death of w.takeEvents().deaths) { deaths++; if (death.killer === 0) wall++; }
    for (const snake of w.snakes.values()) peak = Math.max(peak, snake.mass);
  });
  ok(deaths > 10, 'bots fight and die — the arena is lively', `${deaths} deaths in 3 minutes`);
  ok(wall <= deaths * 0.15, 'but rarely by driving into the wall', `${wall} of ${deaths}`);
  ok(peak > 600, 'some grow large enough to be worth hunting', `peak ${Math.round(peak)}`);
  ok(world.botsAlive >= SNAKE_TARGET - 2, 'dead bots are replaced', `${world.botsAlive} alive`);
}

section('Determinism and cost');
{
  const run = (seed) => {
    const world = new World({ seed });
    seconds(world, 30);
    return [...world.snakes.values()].map((s) => `${s.id}:${s.mass.toFixed(3)}:${s.points[0].toFixed(3)}`).join('|');
  };
  eq(run(21), run(21), 'the same seed produces the same world');

  const world = new World({ seed: 22 });
  world.humansAlive = 0;
  for (let i = 0; i < 14; i++) world.spawnBot();
  for (const snake of world.snakes.values()) snake.mass = 900;
  const started = performance.now();
  seconds(world, 60);
  const perTick = (performance.now() - started) / (60 * SIM_HZ);
  ok(perTick < 3, 'a crowded tick costs well under its 33 ms budget', `${perTick.toFixed(3)} ms per tick`);
}

report();
