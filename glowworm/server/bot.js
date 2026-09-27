// Bots. They exist so the arena is never empty — a slither-style game with two
// people in it is not a game — so they need to feel like players: go for food,
// steer around bodies, keep off the wall, and every so often try to cut you off.
//
// Each decision scores a fan of headings. Clearance along each one says how far
// the bot could travel before hitting something; a goal (food, prey or a
// wander heading) says where it would like to go; turning away costs a little.

import { ARENA_RADIUS, BASE_SPEED, MIN_BOOST_MASS } from '../shared/rules.js';

const TAU = Math.PI * 2;
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const FAN = 13;
const FAN_SPREAD = Math.PI * 0.83;

export function makeBrain(rng) {
  return {
    skill: 0.55 + rng() * 0.45,       // how far ahead it looks, how much margin it keeps
    aggression: rng() * 0.85,
    mode: 'feed',
    modeUntil: 0,
    preyId: 0,
    wander: rng() * TAU,
  };
}

/** Distance along a ray from (x, y) before it leaves a circle of radius r. */
function rayToWall(x, y, dx, dy, r) {
  const b = x * dx + y * dy;
  const c = x * x + y * y - r * r;
  if (c >= 0) return 0;
  return -b + Math.sqrt(b * b - c);
}

function pickGoal(world, snake, brain) {
  const hx = snake.points[0];
  const hy = snake.points[1];
  const rng = world.rng;

  if (world.tick >= brain.modeUntil) {
    // Re-roll the mood every few seconds rather than every tick, so a bot
    // commits to a hunt instead of twitching between ideas.
    brain.modeUntil = world.tick + Math.round((2 + rng() * 4) * 30);
    brain.mode = 'feed';
    brain.preyId = 0;
    if (snake.mass > 35 && rng() < brain.aggression * 0.6) {
      let prey = null;
      let best = 460;
      for (const other of world.snakes.values()) {
        if (other === snake || other.mass > snake.mass * 1.8) continue;
        const d = Math.hypot(other.points[0] - hx, other.points[1] - hy);
        if (d < best) { best = d; prey = other; }
      }
      if (prey) { brain.mode = 'hunt'; brain.preyId = prey.id; }
    }
    if (rng() < 0.25) brain.wander = wrap(snake.angle + (rng() - 0.5) * 2.4);
  }

  if (brain.mode === 'hunt') {
    const prey = world.snakes.get(brain.preyId);
    if (prey) {
      // Aim at a point in front of the prey's head: the cut-off.
      const lead = 50 + prey.width * 2.8;
      const tx = prey.points[0] + Math.cos(prey.angle) * lead;
      const ty = prey.points[1] + Math.sin(prey.angle) * lead;
      const d = Math.hypot(tx - hx, ty - hy);
      return { angle: Math.atan2(ty - hy, tx - hx), boost: d < 260 && brain.aggression > 0.5 };
    }
    brain.mode = 'feed';
  }

  // Feed: the best pellet nearby, weighted by value, distance and whether it is
  // roughly ahead (turning round for a crumb is how bots die).
  let target = null;
  let bestScore = 0;
  world.foodGrid.query(hx, hy, 420, (food) => {
    const dx = food.x - hx;
    const dy = food.y - hy;
    const d = Math.hypot(dx, dy);
    if (d > 420) return;
    const facing = (dx * Math.cos(snake.angle) + dy * Math.sin(snake.angle)) / (d || 1);
    const score = (food.value / (d + 60)) * (1.4 + facing);
    if (score > bestScore) { bestScore = score; target = food; }
  });
  if (target) return { angle: Math.atan2(target.y - hy, target.x - hx), boost: false };

  // Nothing to eat: wander, drifting back towards the middle when far out.
  const out = Math.hypot(hx, hy);
  if (out > ARENA_RADIUS * 0.62) return { angle: Math.atan2(-hy, -hx), boost: false };
  return { angle: brain.wander, boost: false };
}

export function think(world, snake) {
  const brain = snake.brain;
  const hx = snake.points[0];
  const hy = snake.points[1];
  const half = snake.width / 2;
  const look = (120 + snake.width * 2.5 + BASE_SPEED * 0.55) * (0.7 + brain.skill * 0.5);
  const margin = 4 + brain.skill * 10;

  // Other snakes' body points within reach, as flat [x, y, radius] triples.
  const obstacles = [];
  world.bodyGrid.query(hx, hy, look + 45, (item) => {
    const other = world.slots[item >> 10];
    if (!other || other === snake || !other.alive) return;
    const i = (item & 1023) * 2;
    obstacles.push(other.points[i], other.points[i + 1], other.width / 2);
  });

  const goal = pickGoal(world, snake, brain);
  let bestAngle = snake.angle;
  let bestScore = -Infinity;
  let bestClear = 0;
  let aheadClear = look;

  for (let k = 0; k < FAN; k++) {
    const offset = ((k - (FAN - 1) / 2) / ((FAN - 1) / 2)) * FAN_SPREAD;
    const angle = snake.angle + offset;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let clear = Math.min(look, rayToWall(hx, hy, dx, dy, ARENA_RADIUS - half - 24));

    for (let o = 0; o < obstacles.length; o += 3) {
      const rx = obstacles[o] - hx;
      const ry = obstacles[o + 1] - hy;
      const along = rx * dx + ry * dy;
      if (along < 0 || along > clear + obstacles[o + 2] + half) continue;
      const reach = obstacles[o + 2] + half + margin;
      const perp = rx * rx + ry * ry - along * along;
      if (perp >= reach * reach) continue;
      clear = Math.min(clear, Math.max(0, along - Math.sqrt(reach * reach - perp)));
    }
    if (k === (FAN - 1) / 2) aheadClear = clear;

    let score = (clear / look) * 3 + Math.cos(wrap(angle - goal.angle)) * 1.2 - Math.abs(offset) * 0.22;
    if (clear < half + 30) score -= 6;
    if (score > bestScore) { bestScore = score; bestAngle = angle; bestClear = clear; }
  }

  snake.targetAngle = wrap(bestAngle);
  // Boost only into open space — boosting into a wall of bodies is a fast way
  // to become food.
  snake.boost = goal.boost
    && bestClear > look * 0.7
    && aheadClear > look * 0.5
    && snake.mass > MIN_BOOST_MASS + 8;
}
