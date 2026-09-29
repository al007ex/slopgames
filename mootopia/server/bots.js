// Computer players that keep a quiet server lively, and try hard to pass for
// people. Up to `target` of them play when nobody is on; they step aside one
// by one as real players come.
//
// What makes them feel human:
//  - they move like a keyboard: only eight directions, tapping between two to
//    head somewhere at an angle;
//  - they aim like a mouse: turning towards things at a human speed, with a
//    little wobble, a moment late;
//  - each has a personality — skill, nerve, love of building, chattiness;
//  - they settle somewhere with trees, bushes and stone, farm it with
//    auto-hit, ring it with windmills, then walk the edge putting down walls,
//    spikes and traps, and come back to it after dying;
//  - they pick upgrades the way players do, swap hats for the moment, eat when
//    hurt (not always at the perfect time), run home to heal, idle now and
//    then, and chat a little.

import * as C from '#shared/config.js';
import { ITEMS, WEAPONS } from '#shared/items.js';
import { TREE, BUSH, ROCK, GOLD } from '#shared/world.js';
import { dist, dirTo, angleDist } from '#shared/util.js';

const T = C.TICK_MS;
const OCT = Math.PI / 4;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const chance = (p) => Math.random() < p;
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const MILL_GROUP = ITEMS.find((i) => i.name === 'Windmill').group.id;

// The sort of names people type.
const NAME_PARTS = ['clover', 'pip', 'moss', 'bramble', 'toast', 'juni', 'nib', 'pebble', 'sprout', 'maple', 'biscuit', 'fern', 'waffle', 'hazel',
  'nutmeg', 'button', 'sorrel', 'pudding', 'thistle', 'bean', 'mochi', 'kiwi', 'olive', 'sage', 'tofu', 'pickle', 'noodle', 'peanut'];
export function humanName(used = new Set()) {
  for (let i = 0; i < 50; i++) {
    const base = pick(NAME_PARTS);
    const styles = [
      () => base, () => base[0].toUpperCase() + base.slice(1), () => `${base}${Math.floor(rand(1, 99))}`, () => `xX${base}Xx`,
      () => `${base}_${Math.floor(rand(1, 999))}`, () => base.toUpperCase(), () => `${base} :)`, () => `${base}${pick(['uwu', 'yt', 'pro', 'gg'])}`,
      () => `the${base}`, () => `${base}${pick(['!', '~', '<3'])}`,
    ];
    const name = pick(styles)().slice(0, C.MAX_NAME);
    if (!used.has(name)) return name;
  }
  return `player${Math.floor(rand(100, 999))}`;
}

const CHAT = {
  hello: ['hi', 'hello', 'hey', 'yo', 'hii', 'sup'],
  died: ['bruh', 'lag', 'rip', 'noo', 'ok', 'wow'],
  base: ['nice', 'dont break my stuff pls', 'finally', 'my base :)', 'lol'],
  idle: ['anyone wanna team', 'need wood', 'brb', 'this game is fun', 'hmm', 'lol', 'where is the boss', 'gold pls'],
};

// Upgrades people like, per age; anything else on offer is a fallback.
const PREFER = {
  2: ['Short Sword', 'Polearm', 'Hand Axe', 'Bat'],
  3: ['Cookie', 'Stone Wall'],
  4: ['Pit Trap', 'Boost Pad'],
  5: ['Faster Windmill', 'Greater Spikes', 'Sapling', 'Mine'],
  6: ['Great Hammer', 'Hunting Bow', 'Wooden Shield'],
  7: ['Healing Pad', 'Turret', 'Platform', 'Cheese', 'Castle Wall'],
  8: ['Katana', 'Power Mill', 'Great Axe', 'Crossbow'],
  9: ['Spinning Spikes', 'Poison Spikes', 'Spawn Pad', 'Repeater Crossbow', 'Musket'],
};

export class Bots {
  constructor(game, target = 0) {
    this.game = game;
    this.target = target;
    this.list = [];
  }

  humans() { let n = 0; for (const p of this.game.players.values()) if (!p.bot) n++; return n; }

  fill() {
    const want = Math.max(0, this.target - this.humans());
    while (this.list.length < want) this.add();
    while (this.list.length > want) this.remove(this.list[this.list.length - 1]);
  }

  /** Called just before a real player joins. */
  makeRoom() { const want = Math.max(0, this.target - this.humans() - 1); while (this.list.length > want) this.remove(this.list[this.list.length - 1]); }

  add() {
    const used = new Set([...this.game.players.values()].map((p) => p.name));
    const name = humanName(used);
    const p = this.game.join({ name, skin: Math.floor(Math.random() * C.SKIN_COLORS.length), bot: true });
    p.brain = newBrain();
    this.game.spawn(p, { name, skin: p.skin });
    this.list.push(p);
    return p;
  }

  remove(p) {
    this.game.leave(p);
    this.list.splice(this.list.indexOf(p), 1);
  }

  update() {
    const now = this.game.time;
    for (const p of this.list) {
      const b = p.brain;
      if (!p.alive) {
        if (!b.respawnAt) {
          b.respawnAt = now + rand(2500, 8000);           // reading the death screen, clicking play
          if (chance(0.3 * b.chatty)) b.sayLater = { at: now + rand(1500, 4000), text: pick(CHAT.died) };
        } else if (now >= b.respawnAt) {
          b.respawnAt = 0;
          this.game.spawn(p, {});
          p.dir = b.aim;                                  // the mouse is still where it was
          b.state = 'home'; b.focus = null; b.goal = null;
        }
        continue;
      }
      think(this.game, p, now);
      steerKeys(p, now);
      turnAim(p);
    }
  }
}

function newBrain() {
  return {
    skill: rand(0.35, 0.95),        // aim, reactions, how well they fight
    nerve: rand(0.25, 0.8),         // how hurt before running
    builder: rand(0.5, 1),          // how keen on base building
    chatty: rand(0, 1),
    home: null, state: 'home', plan: null, planAt: 0, buildRest: 0,
    goal: null, duty: 0,
    aim: 0, aimGoal: 0, reactAt: 0,
    focus: null, focusUntil: 0, idleUntil: 0, nextIdle: 0, nextChat: 0, sayLater: null,
    stuckAt: 0, lastX: 0, lastY: 0, detourUntil: 0, detourDir: 0,
    hp: 100, hurtAt: -1e9, respawnAt: 0, spikeAt: 0, hatAt: 0, wanderUntil: 0, tripUntil: 0, building: false, blockAt: 0,
  };
}

// ── the mind ──────────────────────────────────────────────────────────────
function think(game, p, now) {
  const b = p.brain;
  p.hits = 0;
  if (b.sayLater && now >= b.sayLater.at) { game.chat(p, b.sayLater.text); b.sayLater = null; }
  if (p.health < b.hp - 0.5) b.hurtAt = now;
  b.hp = p.health;

  if (!b.home) chooseHome(game, p);
  if (p.upgradePoints > 0 && chance(0.12)) upgrade(p);         // not the instant it is offered
  hats(game, p, now);

  // Eat when hurt — sooner if careful, and never perfectly on time.
  const food = ITEMS[p.items[0]];
  if (p.health < p.maxHealth * (0.45 + b.nerve * 0.25) && p.canBuild(food) && chance(0.35 + b.skill * 0.4)) {
    p.buildIndex = food.id; p.build(food); p.buildIndex = -1;
  }

  const enemy = nearestEnemy(game, p, 380 + b.skill * 220);
  const beast = nearestBeast(game, p, 420);
  const losing = p.health < p.maxHealth * (0.2 + b.nerve * 0.3);

  // Something charging at us: throw a spike (or a wall) in its way first.
  if (beast && beast.data.charge && beast.chargeTarget === p) blockCharge(p, beast, now);
  if ((enemy || beast) && losing) { b.state = 'flee'; flee(p, enemy || beast, now); return; }
  // Wolves are fair game; boars, tuskers and the bear are not, until you are
  // strong — people run home, where the walls and spikes stop them.
  const strong = p.age >= 8 && p.health > p.maxHealth * 0.7 && (p.weapon.dmg || 0) >= 35;
  if (beast && beast.data.charge && beast.data.health > 1000 && !strong) { b.state = 'flee'; flee(p, beast, now); return; }
  if (enemy && (b.hurtAt > now - 3000 || nearHome(p, 700) || b.state === 'fight' || chance(0.01 + b.nerve * 0.02))) {
    b.state = 'fight'; fight(p, enemy, now); return;
  }
  if (beast && beast.data.charge) { b.state = 'fight'; fight(p, beast, now); return; }
  if (b.state === 'fight' || b.state === 'flee') b.state = 'home';

  // Sometimes people just stop: reading the shop, typing, looking around.
  if (now < b.idleUntil) { b.goal = null; p.mouseState = 0; return; }
  if (now > b.nextIdle) {
    b.nextIdle = now + rand(20000, 60000);
    if (chance(0.5)) { b.idleUntil = now + rand(800, 3500); b.aimGoal = wrap(b.aimGoal + rand(-1, 1)); return; }
  }
  if (now > b.nextChat && chance(0.002 * b.chatty)) {
    b.nextChat = now + 30000;
    game.chat(p, pick(game.alivePlayers().length > 3 ? CHAT.idle.concat(CHAT.hello) : CHAT.idle));
  }

  // Away from home: fine while on a gathering trip, but walk back once there
  // is something to build (or after respawning, or a chase).
  const onTrip = b.focus && now < b.tripUntil;
  const readyToBuild = now >= b.buildRest && canBuildNext(p);
  if (!nearHome(p, 900) && (!b.focus || (!onTrip && readyToBuild))) { b.focus = null; p.mouseState = 0; b.goal = { x: b.home.x, y: b.home.y }; unstick(p, now); return; }

  if (buildBase(game, p, now)) return;
  farm(game, p, now);
}

/** Somewhere with plenty to gather close together, and nobody else's buildings: that is home. */
function chooseHome(game, p) {
  let best = null; let bestScore = -1;
  for (let i = 0; i < 14; i++) {
    const a = rand(-Math.PI, Math.PI); const r = rand(0, 1400);
    const x = Math.min(C.MAP - 400, Math.max(400, p.x + Math.cos(a) * r));
    const y = Math.min(C.DESERT_TOP - 300, Math.max(C.SNOW_TOP + 300, p.y + Math.sin(a) * r));
    if (Math.abs(y - C.MAP / 2) < C.RIVER_WIDTH) continue;
    let score = 0; const kinds = new Set(); let blocked = false;
    for (const o of game.objects.near(x, y, 700)) {
      if (!o.active) continue;
      const d = dist(x, y, o.x, o.y);
      if (o.owner && o.owner !== p && d < 700) blocked = true;
      if (d < 150 + o.scale) blocked = true;
      if (o.gives !== null && !o.isItem && d < 650) { score++; kinds.add(o.gives); }
    }
    if (blocked) continue;
    score += kinds.size * 3;
    if (score > bestScore) { best = { x, y }; bestScore = score; }
  }
  p.brain.home = best || { x: p.x, y: p.y };
}

const nearHome = (p, r) => !p.brain.home || dist(p.x, p.y, p.brain.home.x, p.brain.home.y) < r;

function upgrade(p) {
  const choices = p.choices();
  if (!choices.length) return;
  const offers = [];
  for (let i = 0; i < choices.length; i += 2) offers.push({ kind: choices[i] === 0 ? 'weapon' : 'item', id: choices[i + 1] });
  const named = (o) => (o.kind === 'weapon' ? WEAPONS[o.id].name : ITEMS[o.id].name);
  const liked = (PREFER[p.upgrAge] || []).map((n) => offers.find((o) => named(o) === n)).filter(Boolean);
  const choice = liked.length && chance(0.85) ? (chance(0.6) ? liked[0] : pick(liked)) : pick(offers);
  p.upgrade(choice.kind, choice.id);
  if (choice.kind === 'weapon' && WEAPONS[choice.id].type === 0) p.select(choice.id, true);
}

/** Hats for the moment: speed to travel, armour or power to fight, fins in water. */
function hats(game, p, now) {
  const b = p.brain;
  const buy = (id, price) => { if (!p.hatsOwned.has(id) && p.gold >= price + 500) game.buyHat(p, id); };
  buy(1001, 6000);
  if (p.age >= 8) { buy(1002, 14000); buy(1005, 18000); }
  if (now < b.hatAt) return;
  b.hatAt = now + rand(1500, 4000);
  let want;
  if (C.inRiver(p.y) && p.hatsOwned.has(1008)) want = 1008;
  else if (b.state === 'fight') want = p.hatsOwned.has(1005) && p.health > 60 ? 1005 : p.hatsOwned.has(1002) ? 1002 : p.hatId;
  else if (!nearHome(p, 400) && p.hatsOwned.has(1001)) want = 1001;
  else want = p.hatsOwned.has(1002) ? 1002 : p.hatsOwned.has(1001) ? 1001 : 0;
  if (want !== p.hatId) game.equipHat(p, want);
}

function nearestEnemy(game, p, range) {
  let best = null; let bestD = range;
  for (const q of game.players.values()) {
    if (q === p || !q.alive || (q.clan && q.clan === p.clan)) continue;
    const d = dist(p.x, p.y, q.x, q.y);
    if (d < bestD) { best = q; bestD = d; }
  }
  return best;
}

function nearestBeast(game, p, range) {
  let best = null; let bestD = range;
  for (const a of game.animals) {
    if (!a.alive || !a.data.hostile || a.data.still) continue;
    const d = dist(p.x, p.y, a.x, a.y);
    if (d < bestD) { best = a; bestD = d; }
  }
  return best;
}

// ── fighting and running ──────────────────────────────────────────────────
function fight(p, target, now) {
  const b = p.brain;
  if (p.buildIndex >= 0) p.buildIndex = -1;
  if (p.weaponIndex !== p.weapons[0] && chance(0.3)) p.select(p.weapons[0], true);
  const w = p.weapon;
  const d = dist(p.x, p.y, target.x, target.y);
  const reach = (w.range || 60) + target.scale * C.PLAYER_HIT_PAD - 12;
  // Lead the target a little, as better players do.
  const lead = b.skill * 4;
  const tx = target.x + (target.xVel || 0) * T * lead; const ty = target.y + (target.yVel || 0) * T * lead;
  aimAt(p, dirTo(tx, ty, p.x, p.y), now);
  if (d > reach) {
    b.goal = { x: tx, y: ty, stopAt: 10 };
    p.mouseState = 0;
    return;
  }
  // In range: swing, and dance a little rather than stand still.
  p.mouseState = 1;
  const side = b.aim + Math.PI / 2 * (chance(0.5) ? 1 : -1);
  b.goal = chance(0.5) ? null : { x: p.x + Math.cos(side) * 120, y: p.y + Math.sin(side) * 120 };
  // A classic: drop a spike between you and them.
  const sid = p.items.find((i) => ITEMS[i].group.name === 'spikes');
  const spikes = sid !== undefined && ITEMS[sid];
  if (spikes && target.isPlayer && now > b.spikeAt && d < 170 && chance(0.04 * b.skill) && p.canBuild(spikes)) {
    b.spikeAt = now + 4000;
    const aim = p.dir; p.dir = dirTo(target.x, target.y, p.x, p.y);
    p.buildIndex = spikes.id; p.build(spikes); p.buildIndex = -1; p.dir = aim;
  }
}

/**
 * What people do when a wolf or boar comes at them: drop spikes between you
 * and it (or a wall, if spikes are too dear), then fight or run from behind it.
 */
function blockCharge(p, beast, now) {
  const b = p.brain;
  const d = dist(p.x, p.y, beast.x, beast.y);
  if (now < b.blockAt || d > 260 || d < p.scale + beast.scale - 5) return;
  const groupItem = (name) => { const id = p.items.find((i) => ITEMS[i].group.name === name); return id === undefined ? null : ITEMS[id]; };
  const item = [groupItem('spikes'), groupItem('walls')].find((it) => it && p.canBuild(it));
  if (!item) return;
  const toward = dirTo(beast.x, beast.y, p.x, p.y);
  const aim = p.dir;
  for (const nudge of [0, 0.35, -0.35]) {
    p.dir = toward + nudge;
    p.buildIndex = item.id;
    if (p.build(item)) { b.blockAt = now + rand(900, 1800) / (0.6 + b.skill); break; }
  }
  p.buildIndex = -1; p.dir = aim;
}

function flee(p, from, now) {
  const b = p.brain;
  p.mouseState = 0;
  if (p.buildIndex >= 0) p.buildIndex = -1;
  const away = dirTo(p.x, p.y, from.x, from.y) + rand(-0.25, 0.25);
  const home = b.home && dist(p.x, p.y, b.home.x, b.home.y) > 150 ? b.home : null;
  // Run home if home is not behind the danger; otherwise just away.
  if (home && angleDist(dirTo(home.x, home.y, p.x, p.y), away) < Math.PI / 2) b.goal = { x: home.x, y: home.y };
  else b.goal = { x: p.x + Math.cos(away) * 500, y: p.y + Math.sin(away) * 500 };
  aimAt(p, away + Math.PI, now);          // looking back over your shoulder
}

// ── farming ───────────────────────────────────────────────────────────────
function want(p) {
  if (p.food < 20 || (p.food < 60 && p.health < p.maxHealth)) return BUSH;
  if (p.wood < 120) return TREE;
  if (p.stone < 60) return ROCK;
  if (p.food < 80) return BUSH;
  return chance(0.03) ? GOLD : chance(0.5) ? TREE : ROCK;
}

const stillGood = (f, kind) => f && (f.isAI ? f.alive : f.active && f.gives === kind);

function farm(game, p, now) {
  const b = p.brain;
  if (p.buildIndex >= 0) p.buildIndex = -1;
  if (p.weaponIndex !== p.weapons[0]) p.select(p.weapons[0], true);
  const kind = want(p);
  if (!stillGood(b.focus, kind) || now > b.focusUntil) {
    b.focus = findResource(game, p, kind) || (kind === BUSH ? huntDeer(game, p) : null);
    b.focusUntil = now + rand(15000, 30000);
    // Nothing of that kind near home: a proper trip out, seen through.
    if (b.focus && b.home && dist(b.home.x, b.home.y, b.focus.x, b.focus.y) > 850) b.tripUntil = now + rand(18000, 28000);
  }
  const o = b.focus;
  if (!o) { wander(p, now); return; }
  const range = (p.weapon.range || 60) + (o.isAI ? o.scale * C.PLAYER_HIT_PAD : o.scale);
  const d = dist(p.x, p.y, o.x, o.y);
  aimAt(p, dirTo(o.x, o.y, p.x, p.y), now);
  if (d > range - 10) {
    b.goal = { x: o.x, y: o.y, stopAt: range - 20 };
    p.mouseState = 0;
    unstick(p, now);
  } else {
    b.goal = null;
    p.mouseState = 1;                 // auto-hit, as everyone does while farming
  }
}

function findResource(game, p, kind) {
  const b = p.brain;
  const cx = b.home ? b.home.x : p.x; const cy = b.home ? b.home.y : p.y;
  let best = null; let bestD = Infinity;
  for (const r of [700, 1500, 3200]) {
    for (const o of game.objects.near(cx, cy, r)) {
      if (!o.active || o.gives !== kind) continue;
      if (kind === BUSH && o.dmg) continue;                 // not cacti
      if (o.isItem && o.owner !== p) continue;              // not other people's mines
      const d = dist(p.x, p.y, o.x, o.y) + dist(cx, cy, o.x, o.y) * 0.5;
      if (d < bestD) { best = o; bestD = d; }
    }
    if (best) return best;
  }
  return null;
}

/** No bushes about: go and hunt something that will not fight back. */
function huntDeer(game, p) {
  let best = null; let bestD = 1500;
  for (const a of game.animals) {
    if (!a.alive || a.data.hostile) continue;
    const d = dist(p.x, p.y, a.x, a.y);
    if (d < bestD) { best = a; bestD = d; }
  }
  return best;
}

function wander(p, now) {
  const b = p.brain;
  if (!b.goal || now > b.wanderUntil) {
    b.wanderUntil = now + rand(2000, 5000);
    const a = rand(-Math.PI, Math.PI);
    b.goal = { x: p.x + Math.cos(a) * 600, y: p.y + Math.sin(a) * 600 };
  }
}

function unstick(p, now) {
  const b = p.brain;
  if (now - b.stuckAt < 1500) return;
  if (dist(p.x, p.y, b.lastX, b.lastY) < 40 && b.goal) { b.focus = null; b.detourUntil = now + 900; b.detourDir = rand(-Math.PI, Math.PI); }
  b.stuckAt = now; b.lastX = p.x; b.lastY = p.y;
}

// ── building a base ───────────────────────────────────────────────────────
/**
 * The plan is a list of places around home, in the order people build them:
 * windmills close in, then walls and spikes round the edge with traps at the
 * gaps, then the nice-to-haves.
 */
export function makePlan(b) {
  const plan = [];
  const start = rand(-Math.PI, Math.PI);
  // Windmills in a ring 150 out, built from just off the middle: at most
  // five, which leaves gaps a player can walk through (you must not wall
  // yourself in with your own windmills).
  const mills = 4 + Math.floor(b.builder * 2);
  const step = Math.PI * 2 / mills;
  for (let i = 0; i < mills; i++) plan.push({ group: 'mill', a: start + i * step, r: 150 });
  // Walls and spikes round the edge, with traps at the gaps.
  const edge = 20;
  for (let i = 0; i < edge; i++) {
    const a = start + i * (Math.PI * 2 / edge);
    plan.push({ group: i % 7 === 3 ? 'trap' : i % 2 ? 'spikes' : 'walls', a, r: 330 });
  }
  // The nice-to-haves go inside, between the windmills.
  plan.push({ group: 'healing', a: start + step / 2, r: 0 }, { group: 'turret', a: start + step * 1.5, r: 0 }, { group: 'spawn', a: start + step * 2.5, r: 0 });
  return plan;
}

/** Could we put down the next thing in the plan right now? */
function canBuildNext(p) {
  const b = p.brain;
  if (!b.plan) return false;
  const mills = p.itemCounts[MILL_GROUP] || 0;
  return b.plan.some((spot) => {
    if (spot.done || (spot.group !== 'mill' && mills < 3)) return false;
    const id = p.items.find((it) => ITEMS[it].group.name === spot.group);
    return id !== undefined && p.canBuild(ITEMS[id]);
  });
}

function buildBase(game, p, now) {
  const b = p.brain;
  if (!b.plan) b.plan = makePlan(b);
  if (now < b.buildRest) return false;
  for (let tries = 0; tries < b.plan.length; tries++) {
    const i = (b.planAt + tries) % b.plan.length;
    const spot = b.plan[i];
    if (spot.done) continue;
    const id = p.items.find((it) => ITEMS[it].group.name === spot.group);
    if (id === undefined) continue;
    const item = ITEMS[id];
    if (!p.canBuild(item)) continue;
    if (spot.group !== 'mill' && (p.itemCounts[MILL_GROUP] || 0) < 3) continue;   // income first
    b.planAt = i;
    if (!b.building && chance(0.35 * (1 - b.builder))) { b.buildRest = now + rand(3000, 8000); return false; }
    b.building = true;
    return placeAt(game, p, item, spot, now);
  }
  b.building = false;
  b.buildRest = now + rand(4000, 9000);
  return false;
}

/** Walk to where you would stand to put `item` at the spot, turn to face it, place it. */
function placeAt(game, p, item, spot, now) {
  const b = p.brain;
  const reach = C.PLAYER_SCALE + item.scale + (item.placeOffset || 0);
  // Stand just inside where it goes (r 0: in the middle, placing round you).
  const out = Math.max(0, spot.r - reach);
  const stand = { x: b.home.x + Math.cos(spot.a) * out, y: b.home.y + Math.sin(spot.a) * out };
  p.mouseState = 0;
  if (dist(p.x, p.y, stand.x, stand.y) > 30) {
    b.goal = { x: stand.x, y: stand.y, stopAt: 20 };
    if (now - (spot.since ??= now) > 12000) spot.done = true;            // cannot get there: skip it
    unstick(p, now);
    return true;
  }
  b.goal = null;
  aimAt(p, spot.a, now, true);
  if (angleDist(b.aim, spot.a) > 0.15) return true;                       // still turning the mouse round
  // Blocked? Nudge the mouse a little either way, as people do, before giving up.
  const aim = p.dir;
  let ok = false;
  for (const nudge of [0, 0.3, -0.3, 0.6, -0.6]) {
    p.dir = spot.a + nudge;
    p.buildIndex = item.id;
    ok = p.build(item);
    if (ok) break;
  }
  p.buildIndex = -1; p.dir = aim;
  spot.done = true;                                                         // placed, or blocked: move on
  b.building = false;
  b.buildRest = now + rand(200, 900);
  if (ok && chance(0.04 * b.chatty)) game.chat(p, pick(CHAT.base));
  return true;
}

// ── hands on the keyboard and mouse ───────────────────────────────────────
/** Point the mouse somewhere; the hand gets there at its own pace, a moment late. */
function aimAt(p, dir, now, exact = false) {
  const b = p.brain;
  const far = angleDist(dir, b.aimGoal) > 0.4;
  if (far && now < b.reactAt) return;                 // not noticed yet
  if (far) b.reactAt = now + rand(120, 380) * (1.3 - b.skill);
  b.aimGoal = exact ? dir : dir + (1 - b.skill) * rand(-0.18, 0.18);
}

export function turnAim(p) {
  const b = p.brain;
  const max = 0.22 + b.skill * 0.35;                  // radians a tick
  let diff = wrap(b.aimGoal - b.aim);
  if (Math.abs(diff) > max) diff = Math.sign(diff) * max * rand(0.8, 1.15);
  b.aim = wrap(b.aim + diff + rand(-0.02, 0.02));
  p.dir = b.aim;
}

/**
 * Turn the goal into keys: one of eight directions, tapping between two
 * neighbours to head somewhere in between, going round anything in the way.
 */
export function steerKeys(p, now) {
  const b = p.brain;
  let want = null;
  if (now < b.detourUntil) want = b.detourDir;
  else if (b.goal && dist(p.x, p.y, b.goal.x, b.goal.y) > (b.goal.stopAt ?? 25)) want = steer(p.game, p, b.goal.x, b.goal.y);
  if (want === null) { p.moveDir = null; return; }
  // In the river the current is stronger than anyone can swim against: swim
  // straight for the bank you want and let it carry you, as people do.
  if (!p.zIndex && C.inRiver(p.y) && b.goal && !C.inRiver(b.goal.y)) want = b.goal.y < p.y ? -Math.PI / 2 : Math.PI / 2;
  const k = ((wrap(want) + Math.PI * 2) % (Math.PI * 2)) / OCT;
  const lo = Math.floor(k); const frac = k - lo;
  b.duty = (b.duty + 1) % 6;
  const hi = frac > 0.75 || (frac > 0.25 && b.duty / 6 < frac);
  p.moveDir = wrap((hi ? lo + 1 : lo) * OCT);
}

/**
 * Head for (tx, ty), but if something solid lies across the way, aim along
 * the tangent that just clears it — on whichever side is nearer the goal.
 */
function steer(game, p, tx, ty) {
  const dir = dirTo(tx, ty, p.x, p.y);
  const far = dist(p.x, p.y, tx, ty);
  const cos = Math.cos(dir); const sin = Math.sin(dir);
  let block = null; let blockAt = Infinity; let side = 0; let clear = 0;
  for (const o of game.objects.near(p.x, p.y, 260)) {
    if (!o.active || o.ignoreCollision) continue;
    const ox = o.x - p.x; const oy = o.y - p.y;
    const along = ox * cos + oy * sin;
    if (along < 0 || along > far - 10) continue;
    const across = -ox * sin + oy * cos;
    const need = o.getScale() + p.scale + 10;
    if (Math.abs(across) >= need || along >= blockAt) continue;
    block = o; blockAt = along; side = across > 0 ? -1 : 1; clear = need;
  }
  if (!block) return dir;
  const toBlock = dirTo(block.x, block.y, p.x, p.y);
  const d = Math.max(clear + 1, dist(p.x, p.y, block.x, block.y));
  return toBlock + side * Math.asin(Math.min(1, clear / d));
}
