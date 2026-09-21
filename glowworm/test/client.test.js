// Client-state tests: the interpolation and event timing that make the game
// look smooth. GameState never touches the DOM, so it runs here as-is.

import { ok, eq, near, section, report } from './harness.js';
import { GameState, INTERP_DELAY, EAT_ANIM_MS } from '../client/js/state.js';
import * as P from '../shared/protocol.js';
import { TICK_MS } from '../shared/rules.js';

/** Feed an encoded server message through the real decoder. */
const deliver = (state, bytes, now) => state.receive(P.decodeServer(bytes), now);
const line = (x, count, step = 10) => { const p = []; for (let i = 0; i < count; i++) p.push(x - i * step, 0); return p; };
const snapshot = (tick, snakes, cx = 0) => P.encodeSnapshot({ tick, cx, cy: 0, snakes });

section('Interpolation');
{
  const state = new GameState();
  // Two snapshots 2 ticks apart, arriving on time; the head moves 20 units.
  deliver(state, P.encodeSnakeInfo([{ id: 5, skin: 3, name: 'wiggle' }]), 0);
  deliver(state, snapshot(100, [{ id: 5, flags: 0, angle: 0, mass: 50, points: line(0, 10) }], 0), 1000);
  deliver(state, snapshot(102, [{ id: 5, flags: P.FLAG_BOOST, angle: 0.4, mass: 60, points: line(20, 10) }], 20), 1000 + 2 * TICK_MS);

  // The render clock runs INTERP_DELAY behind; pick the moment halfway between.
  const offset = 1000 - 100 * TICK_MS;
  const halfway = offset + 101 * TICK_MS + INTERP_DELAY;
  const frame = state.frame(halfway);
  const snake = frame.byId.get(5);
  ok(Boolean(snake), 'the snake is in the frame');
  near(snake.points[0], 10, 0.3, 'the head is blended halfway between snapshots');
  near(snake.mass, 55, 0.01, 'so is the mass');
  near(snake.angle, 0.2, 0.03, 'and the heading');
  eq(snake.info.name, 'wiggle', 'snake info is attached');
  near(frame.camera.x, 10, 0.3, 'the camera focus is blended too');

  const later = state.frame(halfway - 50);
  ok(later.clock >= frame.clock, 'the render clock never runs backwards');
}

section('Growth and disappearance');
{
  const state = new GameState();
  deliver(state, snapshot(10, [{ id: 1, flags: 0, angle: 0, mass: 50, points: line(0, 4) }, { id: 2, flags: 0, angle: 0, mass: 10, points: line(500, 4) }]), 0);
  deliver(state, snapshot(12, [{ id: 1, flags: 0, angle: 0, mass: 60, points: line(10, 6) }]), 2 * TICK_MS);
  const offset = -10 * TICK_MS;
  const frame = state.frame(offset + 11 * TICK_MS + INTERP_DELAY);
  eq(frame.byId.get(1).count, 6, 'a snake that grew is drawn at its new length');
  ok(frame.byId.has(2), 'a snake that just left the newer snapshot is still drawn for now');
}

section('Events wait for the render clock');
{
  const state = new GameState();
  // The opening food sync arrives before any snapshot and applies at once.
  deliver(state, P.encodeFoodAdd(0, [{ id: 1, x: 5, y: 5, value: 2, color: 1 }, { id: 2, x: 9, y: 9, value: 1, color: 2 }]), 0);
  eq(state.food.size, 2, 'the opening food sync is applied immediately');

  deliver(state, snapshot(100, []), 1000);
  const offset = 1000 - 100 * TICK_MS;
  deliver(state, P.encodeFoodEat(104, [{ id: 1, eater: 7 }]), 1001);
  ok(!state.food.get(1).endAt, 'an eat event does not apply before the clock reaches its tick');

  state.frame(offset + 104 * TICK_MS + INTERP_DELAY);
  ok(state.food.get(1)?.endAt > 0, 'it applies once the clock gets there');
  eq(state.food.get(1).eatenBy, 7, 'and remembers who ate it, for the animation');
  state.frame(offset + 104 * TICK_MS + INTERP_DELAY + EAT_ANIM_MS + 1);
  ok(!state.food.has(1), 'the pellet is gone once its animation finishes');
  ok(state.food.has(2), 'other pellets are untouched');

  // The clock is now a few ticks past 104, so pick one comfortably ahead of it.
  deliver(state, P.encodeFoodAdd(120, [{ id: 3, x: 0, y: 0, value: 1, color: 0 }]), 1002);
  ok(!state.food.has(3), 'new food also waits for its tick');
  state.frame(offset + 120 * TICK_MS + INTERP_DELAY);
  ok(state.food.has(3), 'and appears on time');
}

section('Deaths');
{
  const state = new GameState();
  const deaths = [];
  const mine = [];
  state.on('death', (event) => deaths.push(event));
  state.on('youDied', (event) => mine.push(event));
  deliver(state, P.encodeSnakeInfo([{ id: 3, skin: 1, name: 'victim' }, { id: 4, skin: 2, name: 'killer' }]), 0);
  deliver(state, P.encodeWelcome({ you: 3, arena: 2400, simHz: 30, sendEvery: 2, tick: 50 }), 0);
  eq(state.you, 3, 'welcome sets who you are');
  deliver(state, snapshot(50, [{ id: 3, flags: 0, angle: 0, mass: 40, points: line(0, 8) }]), 1000);
  const offset = 1000 - 50 * TICK_MS;
  state.frame(offset + 50 * TICK_MS + INTERP_DELAY);
  deliver(state, P.encodeDeaths(52, [{ victim: 3, killer: 4, score: 40 }]), 1001);
  deliver(state, P.encodeYouDied({ tick: 52, killer: 4, score: 40, aliveMs: 5000, kills: 0, bestRank: 9 }), 1001);
  eq(deaths.length, 0, 'a death waits for the clock like everything else');
  state.frame(offset + 52 * TICK_MS + INTERP_DELAY);
  eq(deaths.length, 1, 'then fires');
  eq(deaths[0].killerInfo?.name, 'killer', 'with the killer’s name attached');
  ok(deaths[0].points?.length === 16, 'and the body as last drawn, for the burst');
  eq(mine.length, 1, 'your own death is announced');
  eq(state.you, 0, 'and you are no longer anyone');
}

section('Clock');
{
  const state = new GameState();
  // Jittery arrivals: the offset settles on the fastest one, not the average.
  const arrivals = [0, 35, 5, 60, 2, 18];
  arrivals.forEach((jitter, i) => deliver(state, snapshot(10 + i * 2, []), 1000 + i * 2 * TICK_MS + jitter));
  near(state.offset, 1000 - 10 * TICK_MS, 1, 'the clock locks to the fastest arrival, ignoring jitter');

  const pong = P.encodePong(500);
  state.receive(P.decodeServer(pong), 560);
  eq(state.rtt, 60, 'round-trip time is measured from pongs');
}

report();
