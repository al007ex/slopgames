// Helpers for building small, controlled worlds in tests.

import { Game } from '../server/game.js';
import { TICK_MS } from '#shared/config.js';

/** A game with no nature and no animals unless asked for. */
export function emptyGame({ nature = false, animals = false } = {}) {
  const g = new Game({ seed: 7, animals });
  if (!nature) for (const o of [...g.objects.list]) g.objects.remove(o);
  return g;
}

/** Join and spawn a player at (x, y) facing `dir`. */
export function spawnAt(g, x, y, { dir = 0, name = 'T', skin = 0 } = {}) {
  const p = g.join({ name });
  g.spawn(p, { name, skin });
  p.x = x; p.y = y; p.dir = dir; p.xVel = 0; p.yVel = 0;
  p.outbox = [];
  return p;
}

export function ticks(g, n) { for (let i = 0; i < n; i++) g.tick(TICK_MS); }

/** Every message of one type a player has been sent since the last clear. */
export function sent(p, type) { return p.outbox.filter((m) => m[0] === type); }

/** Keep outboxes from growing forever in long tests. */
export function drain(g) { for (const p of g.players.values()) p.outbox = []; }
