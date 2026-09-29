// Computer players that keep a quiet server lively. There are up to `target`
// of them when nobody is on; they step aside one by one as real players come.
// They gather, build windmills, age up, eat when hurt, fight whoever is close
// and run when they are losing — with a little aim wobble and reaction time so
// they can be beaten.

import * as C from '#shared/config.js';
import { ITEMS, WEAPONS } from '#shared/items.js';
import { TREE, BUSH, ROCK, GOLD } from '#shared/world.js';
import { dist, dirTo } from '#shared/util.js';

const NAMES = ['Clover', 'Pip', 'Mossy', 'Bramble', 'Toast', 'Juniper', 'Nib', 'Pebble', 'Sprout', 'Maple', 'Biscuit', 'Fern', 'Waffle', 'Hazel', 'Tumble', 'Nutmeg', 'Button', 'Sorrel', 'Pudding', 'Thistle'];
const WINDMILL = ITEMS.findIndex((i) => i.name === 'Windmill');
const BOOSTER = 1001;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

export class Bots {
  constructor(game, target = 0) {
    this.game = game;
    this.target = target;
    this.list = [];
  }

  humans() { let n = 0; for (const p of this.game.players.values()) if (!p.bot) n++; return n; }

  /** Add or remove bots so humans + bots ≈ target (never fewer humans' worth of room). */
  fill() {
    const want = Math.max(0, this.target - this.humans());
    while (this.list.length < want) this.add();
    while (this.list.length > want) this.remove(this.list[this.list.length - 1]);
  }

  makeRoom() { const want = Math.max(0, this.target - this.humans() - 1); while (this.list.length > want) this.remove(this.list[this.list.length - 1]); }

  add() {
    const used = new Set(this.list.map((b) => b.name));
    const name = NAMES.find((n) => !used.has(n)) || `Bot${this.list.length}`;
    const p = this.game.join({ name, skin: Math.floor(Math.random() * C.SKIN_COLORS.length), bot: true });
    p.brain = { respawnAt: 0, stuckAt: 0, lastX: 0, lastY: 0, wander: 0, wanderDir: 0, react: 0, focus: null, build: 0 };
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
      if (!p.alive) {
        if (!p.brain.respawnAt) p.brain.respawnAt = now + rand(3000, 6000);
        else if (now >= p.brain.respawnAt) { p.brain.respawnAt = 0; this.game.spawn(p, {}); }
        continue;
      }
      think(this.game, p, now);
    }
  }
}

function think(game, p, now) {
  const b = p.brain;
  p.hits = 0;
  // Spend ages and gold first.
  if (p.upgradePoints > 0) upgrade(p);
  if (p.gold >= 6000 && !p.hatsOwned.has(BOOSTER)) { game.buyHat(p, BOOSTER); game.equipHat(p, BOOSTER); }

  // Hurt: eat if we can.
  if (p.health < p.maxHealth * 0.55 && p.food >= 10) {
    const food = ITEMS[p.items[0]];
    if (p.canBuild(food)) { p.buildIndex = food.id; p.build(food); p.buildIndex = -1; }
  }

  const enemy = nearestEnemy(game, p, 520);
  const beast = nearestBeast(game, p, 380);
  const losing = p.health < p.maxHealth * 0.35;

  if ((enemy || beast) && losing) return flee(p, enemy || beast);
  if (enemy) return fight(p, enemy, now);
  if (beast && beast.data.charge) return fight(p, beast, now);

  if (b.wander > now) { move(p, b.wanderDir); p.mouseState = 0; return; }
  if (tryBuild(game, p, now)) return;
  gather(game, p, now);
}

function upgrade(p) {
  const choices = p.choices();
  if (!choices.length) return;
  // Prefer a weapon when one is offered; otherwise any item.
  const picks = [];
  for (let i = 0; i < choices.length; i += 2) picks.push({ kind: choices[i] === 0 ? 'weapon' : 'item', id: choices[i + 1] });
  const weapons = picks.filter((c) => c.kind === 'weapon' && WEAPONS[c.id].type === 0 && WEAPONS[c.id].dmg > 5);
  const pick = weapons.length ? weapons[Math.floor(Math.random() * weapons.length)] : picks[Math.floor(Math.random() * picks.length)];
  p.upgrade(pick.kind, pick.id);
  if (pick.kind === 'weapon' && WEAPONS[pick.id].type === 0) p.select(pick.id, true);
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

function move(p, dir) { p.moveDir = dir; }

/**
 * Head for (tx, ty), but if something solid lies across the way, aim along
 * the tangent that just clears it — on whichever side is nearer the goal.
 */
function steer(game, p, tx, ty, ignore) {
  const dir = dirTo(tx, ty, p.x, p.y);
  const far = dist(p.x, p.y, tx, ty);
  const cos = Math.cos(dir); const sin = Math.sin(dir);
  let block = null; let blockAt = Infinity; let side = 0; let clear = 0;
  for (const o of game.objects.near(p.x, p.y, 260)) {
    if (!o.active || o === ignore || o.ignoreCollision) continue;
    const ox = o.x - p.x; const oy = o.y - p.y;
    const along = ox * cos + oy * sin;
    if (along < 0 || along > far) continue;
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

function flee(p, from) {
  const away = dirTo(p.x, p.y, from.x, from.y) + rand(-0.3, 0.3);
  move(p, steer(p.game, p, p.x + Math.cos(away) * 400, p.y + Math.sin(away) * 400, null));
  p.mouseState = 0;
}

function fight(p, target, now) {
  const b = p.brain;
  if (p.buildIndex >= 0) p.buildIndex = -1;
  const w = p.weapon;
  const d = dist(p.x, p.y, target.x, target.y);
  const reach = (w.range || 60) + target.scale * C.PLAYER_HIT_PAD - 10;
  // React a moment late and aim a little off, like a person.
  if (now >= b.react) { b.react = now + rand(150, 350); b.aimOff = rand(-0.22, 0.22); }
  p.dir = dirTo(target.x, target.y, p.x, p.y) + (b.aimOff || 0);
  if (d > reach) {
    move(p, steer(p.game, p, target.x, target.y, null));
    p.mouseState = 0;
  } else {
    move(p, Math.random() < 0.5 ? null : p.dir + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1));
    p.mouseState = 1;
  }
}

/** What to gather next: wood and stone for windmills, food to heal, then whatever pays. */
function want(p) {
  if (p.food < 30) return BUSH;
  if (p.wood < 80) return TREE;
  if (p.stone < 30) return ROCK;
  return Math.random() < 0.02 ? GOLD : TREE;
}

function gather(game, p, now) {
  const b = p.brain;
  if (p.buildIndex >= 0) p.buildIndex = -1;
  const kind = want(p);
  if (!b.focus || !b.focus.active || b.focus.gives !== kind || b.focusUntil < now) {
    b.focus = findResource(game, p, kind);
    b.focusUntil = now + 20000;
  }
  const o = b.focus;
  if (!o) { wander(p, now); return; }
  const w = p.weapon;
  const d = dist(p.x, p.y, o.x, o.y);
  p.dir = dirTo(o.x, o.y, p.x, p.y);
  if (d - o.scale > (w.range || 60) - 8) {
    move(p, steer(game, p, o.x, o.y, o));
    p.mouseState = 0;
    unstick(p, now);
  } else {
    move(p, null);
    p.mouseState = 1;
  }
}

function findResource(game, p, kind) {
  let best = null; let bestD = Infinity;
  for (const r of [900, 2200, 5000]) {
    for (const o of game.objects.near(p.x, p.y, r)) {
      if (!o.active || o.gives !== kind || o.isItem) continue;
      if (kind === BUSH && o.dmg) continue;           // not cacti
      const d = dist(p.x, p.y, o.x, o.y);
      if (d < bestD) { best = o; bestD = d; }
    }
    if (best) return best;
  }
  return null;
}

function tryBuild(game, p, now) {
  const b = p.brain;
  const mill = ITEMS[WINDMILL];
  const mills = p.itemCounts[mill.group.id] || 0;
  if (now < b.build || mills >= 3 || !p.items.includes(mill.id) || !p.canBuild(mill)) return false;
  b.build = now + 4000;
  for (let k = 0; k < 8; k++) {
    p.dir = k / 8 * Math.PI * 2;
    p.buildIndex = mill.id;
    if (p.build(mill)) { b.build = now + 8000; return true; }
  }
  p.buildIndex = -1;
  return false;
}

function wander(p, now) {
  const b = p.brain;
  b.wander = now + rand(1500, 3000);
  b.wanderDir = rand(-Math.PI, Math.PI);
  move(p, b.wanderDir);
}

/** Walking but not getting anywhere: try another way for a moment. */
function unstick(p, now) {
  const b = p.brain;
  if (now - b.stuckAt < 1500) return;
  if (dist(p.x, p.y, b.lastX, b.lastY) < 40) { b.focus = null; wander(p, now); }
  b.stuckAt = now; b.lastX = p.x; b.lastY = p.y;
}

