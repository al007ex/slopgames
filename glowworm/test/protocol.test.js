// Wire format tests. Every message has to survive the round trip, and the body
// encoding in particular has to stay accurate however long a snake gets.

import { ok, eq, near, section, report } from './harness.js';
import * as P from '../shared/protocol.js';
import { NAME_MAX, COORD_SCALE, cleanName, spacingOf } from '../shared/rules.js';

const TAU = Math.PI * 2;
const angleError = (a, b) => Math.abs(((a - b) % TAU + TAU + Math.PI) % TAU - Math.PI);

/** A wiggly body with the real spacing for `mass`. */
function body(mass, count, x = 0, y = 0) {
  const spacing = spacingOf(mass);
  const points = [];
  let angle = 0.3;
  for (let i = 0; i < count; i++) {
    points.push(x, y);
    angle += Math.sin(i * 0.4) * 0.35;
    x -= Math.cos(angle) * spacing;
    y -= Math.sin(angle) * spacing;
  }
  return points;
}

const worstError = (a, b) => {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
};

section('Snapshots');
{
  const snakes = [
    { id: 1, flags: P.FLAG_BOOST, angle: 1.25, mass: 12.5, points: body(12.5, 20, 100, -40) },
    { id: 65000, flags: 0, angle: -2.9, mass: 20000, points: body(20000, 144, -1800, 1500) },
  ];
  const bytes = P.encodeSnapshot({ tick: 987654, cx: 100.3, cy: -40.2, snakes });
  const message = P.decodeServer(bytes);
  eq(message.type, P.SERVER.SNAPSHOT, 'decodes as a snapshot');
  eq(message.tick, 987654, 'keeps the tick');
  near(message.cx, 100.3, 0.5 / COORD_SCALE, 'keeps the camera focus');
  eq(message.snakes.length, 2, 'carries every snake');
  eq(message.snakes[0].id, 1, 'keeps ids');
  eq(message.snakes[1].id, 65000, 'keeps large ids');
  eq(message.snakes[0].flags, P.FLAG_BOOST, 'keeps the boost flag');
  ok(angleError(message.snakes[0].angle, 1.25) <= TAU / 256, 'heading is within one quantisation step');
  near(message.snakes[1].mass, 20000, 0.01, 'keeps mass');
  eq(message.snakes[1].points.length, 288, 'keeps every body point');
  const precision = 0.5 / COORD_SCALE + 1e-6;
  ok(worstError(message.snakes[0].points, snakes[0].points) <= precision, 'a short body is accurate to the quantisation step');
  ok(worstError(message.snakes[1].points, snakes[1].points) <= precision,
    'a 144-point body is just as accurate at the tail — error does not accumulate',
    `worst ${worstError(message.snakes[1].points, snakes[1].points)}`);

  const assembled = P.assembleSnapshot(987654, 100.3, -40.2, snakes.map(P.encodeSnakeBlock));
  ok(assembled.length === bytes.length && assembled.every((b, i) => b === bytes[i]), 'splicing pre-encoded blocks gives identical bytes');

  const empty = P.decodeServer(P.encodeSnapshot({ tick: 1, cx: 0, cy: 0, snakes: [] }));
  eq(empty.snakes.length, 0, 'an empty view is still a valid snapshot');

  // A gap wider than an int8 step can hold: the next points must recover.
  const torn = [0, 0, 200, 0, 205, 0, 210, 0];
  const repaired = P.decodeServer(P.encodeSnapshot({ tick: 2, cx: 0, cy: 0, snakes: [{ id: 3, flags: 0, angle: 0, mass: 10, points: torn }] }));
  ok(repaired.snakes[0].points[2] < 200, 'an oversized step is clamped rather than wrapping');
  ok(Math.abs(repaired.snakes[0].points[6] - 210) < 150, 'and later points pull back towards the truth');

  const perSnake = P.encodeSnakeBlock({ id: 9, flags: 0, angle: 0, mass: 100, points: body(100, 41) }).length;
  ok(perSnake <= 14 + 41 * 2, 'a typical snake costs about two bytes per point', `${perSnake} bytes`);
}

section('Food, info, deaths, board');
{
  const foods = [
    { id: 1, x: 12.25, y: -8.5, value: 0.4, color: 3 },
    { id: 0xfffffff0, x: -2399, y: 2399, value: 300, color: 11 },
  ];
  const added = P.decodeServer(P.encodeFoodAdd(55, foods));
  eq(added.tick, 55, 'food add keeps its tick');
  eq(added.foods[1].id, 0xfffffff0, 'food ids use the full 32 bits');
  near(added.foods[0].x, 12.25, 0.25, 'food positions survive');
  eq(added.foods[0].value, 1, 'food value is at least 1 on the wire');
  eq(added.foods[1].value, 255, 'and at most 255');
  eq(added.foods[1].color, 11, 'food colour survives');

  const eaten = P.decodeServer(P.encodeFoodEat(56, [{ id: 7, eater: 12 }, { id: 8, eater: 0 }]));
  eq(eaten.eaten[0].eater, 12, 'eaten food names who ate it');
  eq(eaten.eaten[1].eater, 0, 'decayed food has no eater');

  const emoji = 'ñøødle 🐍 é';
  const info = P.decodeServer(P.encodeSnakeInfo([{ id: 4, skin: 7, name: emoji }, { id: 5, skin: 0, name: 'x'.repeat(40) }]));
  eq(info.snakes[0].name, emoji, 'names survive unicode, emoji included');
  eq(info.snakes[0].skin, 7, 'skins survive');
  eq([...info.snakes[1].name].length, NAME_MAX, 'over-long names are cut to the limit');

  const deaths = P.decodeServer(P.encodeDeaths(99, [{ victim: 3, killer: P.LEFT_GAME, score: 1234.9 }]));
  eq(deaths.deaths[0].killer, P.LEFT_GAME, 'a player leaving is distinguishable from a kill');
  eq(deaths.deaths[0].score, 1234, 'death scores are whole numbers');

  const board = P.decodeServer(P.encodeBoard({
    humans: 3, total: 21, top: [{ id: 1, score: 900.7 }, { id: 2, score: 12 }], rank: 14, score: 55.5,
    dots: [{ x: 0, y: 255, size: 9, flags: 3 }],
  }));
  eq(board.total, 21, 'board carries the population');
  eq(board.top[0].score, 900, 'board carries the top scores');
  eq(board.rank, 14, 'board carries your rank');
  eq(board.dots[0].flags, 3, 'minimap dots carry their flags');

  const died = P.decodeServer(P.encodeYouDied({ tick: 5, killer: 9, score: 77.7, aliveMs: 61234, kills: 2, bestRank: 4 }));
  eq(died.killer, 9, 'death notice names the killer');
  eq(died.aliveMs, 61234, 'and how long you lasted');

  const welcome = P.decodeServer(P.encodeWelcome({ you: 42, arena: 2400, simHz: 30, sendEvery: 2, tick: 1e6 }));
  eq(welcome.you, 42, 'welcome carries your id');
  eq(welcome.tick, 1e6, 'and the current tick');

  near(P.decodeServer(P.encodePong(1234.5)).t, 1234.5, 0, 'pong echoes the timestamp exactly');
}

section('Client messages');
{
  const join = P.decodeClient(P.encodeJoin('hello', 5));
  eq(join.name, 'hello', 'join carries the name');
  eq(join.skin, 5, 'and the skin');

  let worst = 0;
  for (let i = 0; i < 64; i++) {
    const angle = -Math.PI + (i / 64) * TAU;
    worst = Math.max(worst, angleError(P.decodeClient(P.encodeInput(angle, true)).angle, angle));
  }
  ok(worst < 0.0002, 'steering is precise to a fraction of a degree', `worst ${worst}`);
  eq(P.decodeClient(P.encodeInput(0, true)).boost, true, 'input carries boost');
  eq(P.decodeClient(P.encodeInput(0, false)).boost, false, 'and its absence');

  const view = P.decodeClient(P.encodeView(1234.4, 700.6));
  eq(view.halfWidth, 1234, 'view sizes are whole units');
  eq(view.halfHeight, 701, 'and rounded');
  eq(P.decodeClient(P.encodeView(-5, 999999)).halfHeight, 65535, 'view sizes are clamped to the field');
}

section('Malformed input is rejected, not misread');
{
  const snapshot = P.encodeSnapshot({ tick: 1, cx: 0, cy: 0, snakes: [{ id: 1, flags: 0, angle: 0, mass: 10, points: body(10, 20) }] });
  let threw = null;
  try { P.decodeServer(snapshot.slice(0, snapshot.length - 3)); } catch (error) { threw = error; }
  ok(threw instanceof RangeError, 'a truncated snapshot throws');
  threw = null;
  try { P.decodeClient(new Uint8Array([99])); } catch (error) { threw = error; }
  ok(threw instanceof TypeError, 'an unknown message type throws');
  threw = null;
  try { P.decodeClient(new Uint8Array([P.CLIENT.JOIN, 1, 200])); } catch (error) { threw = error; }
  ok(threw instanceof RangeError, 'a name claiming more bytes than were sent throws');
  threw = null;
  try { P.decodeClient(new Uint8Array([])); } catch (error) { threw = error; }
  ok(threw instanceof RangeError, 'an empty message throws');
}

section('Names');
{
  const rlo = String.fromCodePoint(0x202e);
  const zwsp = String.fromCodePoint(0x200b);
  eq(cleanName(`  evil${rlo}name  `), 'evilname', 'bidi overrides are removed');
  eq(cleanName(`in${zwsp}visible`), 'invisible', 'zero-width characters are removed');
  eq(cleanName('tab\tand\nnewline'), 'tab and newline', 'control characters collapse to spaces');
  eq(cleanName(''), 'unnamed worm', 'an empty name gets a default');
  eq(cleanName(`   ${zwsp}  `), 'unnamed worm', 'so does a name made only of invisible characters');
  eq([...cleanName('🐍'.repeat(40))].length, NAME_MAX, 'long names are cut by characters, not bytes');
  eq(cleanName('ｗｉｄｅ'), 'wide', 'full-width letters are normalised');
}

report();
