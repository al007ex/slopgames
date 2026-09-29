// M4 — smooth PvP: your own movement predicted exactly, everyone else buffered.

import { ok, eq, near, section } from './harness.js';
import { emptyGame, spawnAt, ticks } from './util.js';
import * as C from '#shared/config.js';
import { ITEMS } from '#shared/items.js';
import { ROCK } from '#shared/world.js';
import { Predictor, Clock, remember, place } from '../client/js/predict.js';
import { swingTicks } from '#shared/physics.js';

/** A client's predictor, seeing the server's objects as the client would. */
function clientFor(g, p) {
  const app = {
    me: { build: -1, weapon: 0, hat: 0, members: [] },
    state: {
      me: p.sid,
      players: new Map([[p.sid, { hat: 0 }]]),
      visibleObjects: (x, y, w, h) => g.objects.near(x + w / 2, y + h / 2, Math.max(w, h) / 2 + 200).filter((o) => o.active),
    },
    friendlySids: () => new Set([p.sid]),
  };
  const pr = new Predictor(app);
  pr.reset(p.x, p.y);
  return pr;
}

const route = (n) => Array.from({ length: n }, (_, i) => (i % 40 < 25 ? 0.3 : i % 40 < 32 ? null : Math.PI / 2 + (i % 7) * 0.2));

section('The client moves exactly like the server');
{
  const g = emptyGame();
  // A few rocks and a wall in the way, so collisions are part of it.
  for (const [x, y] of [[5400, 5150], [5900, 5300], [6300, 5500]]) g.addObject({ x, y, scale: 86, type: ROCK });
  const wall = ITEMS.find((i) => i.name === 'Stone Wall');
  g.addObject({ x: 5700, y: 5050, scale: wall.scale, item: wall, owner: null });
  const p = spawnAt(g, 5000, 5000);
  const pr = clientFor(g, p);
  let worst = 0;
  for (const dir of route(120)) {
    p.queueInput(pr.seq + 1, dir);
    pr.frame(C.TICK_MS, dir, () => {});
    g.tick();
    worst = Math.max(worst, Math.hypot(pr.e.x - p.x, pr.e.y - p.y));
  }
  ok(worst < 1e-6, `120 ticks of walking, turning, stopping and bumping into rocks and a wall: the prediction never strays (worst ${worst.toExponential(1)} units)`);
  ok(Math.hypot(p.x - 5000, p.y - 5000) > 500, 'and the walk really went somewhere');
}

section('With lag: replaying what the server has not seen yet');
{
  const g = emptyGame();
  const p = spawnAt(g, 5000, 5000);
  const pr = clientFor(g, p);
  const LAG = 3;                             // acks come back three ticks late
  const inflight = []; const acks = [];
  let worst = 0; let offset = 0;
  for (const dir of route(90)) {
    pr.frame(C.TICK_MS, dir, (seq, d) => inflight.push({ seq, d, at: g.tickCount + LAG }));
    while (inflight.length && inflight[0].at <= g.tickCount) { const i = inflight.shift(); p.queueInput(i.seq, i.d); }
    g.tick();
    acks.push({ at: g.tickCount + LAG, m: [p.lastSeq, p.x, p.y, p.xVel, p.yVel, p.slowMult, p.zIndex, p.lockMove ? 1 : 0] });
    while (acks.length && acks[0].at <= g.tickCount) pr.reconcile(...acks.shift().m);
    offset = Math.max(offset, Math.hypot(pr.ox, pr.oy));
    if (p.lastSeq) worst = Math.max(worst, Math.abs(pr.pending.length - (pr.seq - p.lastSeq)));
  }
  ok(offset < 1e-6, `acks arriving 3 ticks late never force a correction (largest ${offset.toExponential(1)} units)`);
  ok(pr.pending.length <= LAG * 2 + 1, `only the inputs still in flight are replayed (${pr.pending.length} pending)`);
}

section('When the server disagrees');
{
  const g = emptyGame();
  const p = spawnAt(g, 5000, 5000);
  const pr = clientFor(g, p);
  for (let i = 0; i < 10; i++) { p.queueInput(pr.seq + 1, 0); pr.frame(C.TICK_MS, 0, () => {}); g.tick(); pr.reconcile(p.lastSeq, p.x, p.y, p.xVel, p.yVel, p.slowMult, p.zIndex, 0); }
  const before = pr.position();
  // Someone hits us: the server knocks us sideways, which the client could not know.
  p.yVel += 1.2;
  p.queueInput(pr.seq + 1, 0); pr.frame(C.TICK_MS, 0, () => {}); g.tick();
  const drawnBefore = pr.position();
  pr.reconcile(p.lastSeq, p.x, p.y, p.xVel, p.yVel, p.slowMult, p.zIndex, 0);
  const drawnAfter = pr.position();
  near(drawnAfter.y, drawnBefore.y, 1e-9, 'a knockback does not teleport you on screen…');
  ok(Math.abs(pr.oy) > 20, '…the difference is held as an offset…');
  pr.frame(90 * 4, 0, () => {});
  ok(Math.abs(pr.oy) < Math.abs(drawnAfter.y - pr.e.y) / 8 + 1, '…that eases out within a few frames');
  void before;
  pr.reconcile(p.lastSeq, p.x + 5000, p.y, 0, 0, 1, 0, 0);
  eq(pr.ox, 0, 'a jump across the map (respawn, teleporter) snaps instead of sliding');
}

section('The server cannot be rushed');
{
  const g = emptyGame();
  const honest = spawnAt(g, 5000, 3000);
  const cheat = spawnAt(g, 5000, 9000);
  let seq = 0;
  for (let t = 0; t < 45; t++) {
    honest.queueInput(t + 1, 0);
    for (let k = 0; k < 3; k++) cheat.queueInput(++seq, 0);   // three inputs a tick
    g.tick();
  }
  near(cheat.x - 5000, honest.x - 5000, 1, 'sending inputs three times as fast moves you no faster');
  ok(cheat.inputs.length <= 4, 'and the backlog is trimmed, so lag cannot pile up');
}

section('Everyone else, drawn from a buffer');
{
  const e = {};
  remember(e, 10, 0, 0, 0); remember(e, 11, 30, 0, 0.2); remember(e, 12, 60, 10, 0.4);
  place(e, 11.5);
  near(e.x, 45, 1e-9, 'halfway between two snapshots is halfway between their positions');
  near(e.y, 5, 1e-9, 'on both axes');
  near(e.dir, 0.3, 1e-9, 'and facing');
  place(e, 12.3);
  near(e.x, 69, 1e-9, 'a late snapshot is bridged by carrying on the same motion…');
  place(e, 20);
  near(e.x, 75, 1e-9, '…but only half a tick ahead, then it waits');
  remember(e, 11, 999, 999, 0);
  place(e, 11.5);
  near(e.x, 45, 1e-9, 'an out-of-order snapshot is ignored');

  const clock = new Clock();
  const arrivals = [[100, 1000], [101, 1150], [102, 1222], [103, 1400], [104, 1444]];
  for (const [tick, at] of arrivals) clock.sample(tick, at);
  const best = Math.min(...arrivals.map(([t, a]) => a - t * C.TICK_MS));
  near(clock.renderTick(1500), (1500 - best) / C.TICK_MS - 1.3, 1e-9, 'the clock follows the fastest packets, and draws 1.3 ticks behind them');
}

section('Swings on the tick');
{
  eq(swingTicks(300), 4, 'the hammer swings every 4th tick');
  eq(swingTicks(100), 2, 'daggers every 2nd');
  eq(swingTicks(700), 8, 'the polearm every 8th');
  const g = emptyGame();
  const p = spawnAt(g, 5000, 5000);
  p.mouseState = 1; p.hits = 1;
  const at = [];
  for (let t = 0; t < 17; t++) { const before = p.outbox.filter((m) => m[0] === 'swing').length; g.tick(); if (p.outbox.filter((m) => m[0] === 'swing').length > before) at.push(t); }
  eq(at.join(','), '0,4,8,12,16', 'and the server agrees with the client’s count');
}
