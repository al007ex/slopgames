// A player on the server: movement, swinging, building, eating, ageing.

import * as C from '#shared/config.js';
import { WEAPONS, ITEMS, PROJECTILES, START_ITEMS, START_WEAPONS, costOf, upgradeChoices } from '#shared/items.js';
import { hatById } from '#shared/hats.js';
import { dist, dirTo, angleDist } from '#shared/util.js';

const RES = C.RESOURCE_TYPES;
const NO_HAT = {};

export class Player {
  constructor(game, sid, { name = 'unknown', skin = 0, bot = false } = {}) {
    this.game = game;
    this.sid = sid;
    this.name = name;
    this.skin = skin;
    this.isPlayer = true;
    this.bot = bot;
    this.alive = false;
    this.clan = null;
    this.outbox = [];
    this.hatsOwned = new Set();
    this.hatId = 0;
    this.hat = NO_HAT;
    this.itemCounts = {};
    this.kills = 0;
    this.gold = 0;
    this.scale = C.PLAYER_SCALE;
    this.x = 0; this.y = 0;
    this.chatAt = 0;
    this.chat = null;
    this.shameTimer = 0;
    this.shameCount = 0;
  }

  send(...msg) { if (!this.bot) this.outbox.push(msg); }

  spawn(at) {
    Object.assign(this, {
      alive: true, lockMove: false, zIndex: 0, xVel: 0, yVel: 0, slowMult: 1, dir: 0, moveDir: null,
      mouseState: 0, hits: 0, autoGather: false, buildIndex: -1, weaponIndex: 0, healCol: 0,
      health: C.MAX_HEALTH, maxHealth: C.MAX_HEALTH, xp: 0, maxXP: C.FIRST_XP, age: 1, upgradePoints: 0, upgrAge: 2,
      items: [...START_ITEMS], weapons: [...START_WEAPONS], weaponXP: {}, reloads: {}, pps: this.pps || 0,
      poison: null, secondTimer: 0, hitTime: 0, noMovTimer: 0, kills: 0,
      wood: 0, food: 0, stone: 0, gold: 0,
    });
    this.x = at.x; this.y = at.y;
    this.applyHat();
    this.health = this.maxHealth;
  }

  // ── hats ──────────────────────────────────────────────────────────────────
  applyHat() {
    const id = this.shameTimer > 0 ? C.CLOWN_HAT : this.hatId;
    this.hat = hatById(id) || NO_HAT;
    this.shownHat = id;
    const max = C.MAX_HEALTH + (this.hat.extraHealth || 0);
    if (max !== this.maxHealth) {
      this.maxHealth = max;
      if (this.health > max) this.health = max;
      this.game?.healthChanged(this);
    }
  }

  // ── weapons ───────────────────────────────────────────────────────────────
  get weapon() { return WEAPONS[this.weaponIndex]; }
  variantOf(weaponId = this.weaponIndex) {
    const xp = this.weaponXP[weaponId] || 0;
    for (let i = C.VARIANTS.length - 1; i >= 0; i--) if (xp >= C.VARIANTS[i].xp) return C.VARIANTS[i];
    return C.VARIANTS[0];
  }

  // ── the tick ──────────────────────────────────────────────────────────────
  update(delta) {
    if (!this.alive) return;
    const game = this.game;

    if (this.shameTimer > 0) {
      this.shameTimer -= delta;
      if (this.shameTimer <= 0) { this.shameTimer = 0; this.shameCount = 0; this.applyHat(); }
    }

    // Once a second: windmill gold, regeneration, poison and healing pads.
    this.secondTimer -= 1;
    if (this.secondTimer <= 0) {
      this.secondTimer = Math.round(1000 / C.TICK_MS);
      if (this.pps) { this.addResource(3, this.pps, true); this.earnXP(this.pps); }
      if (this.hat.regen) this.changeHealth(this.hat.regen, this);
      if (this.poison) {
        this.changeHealth(-this.poison.dmg, this.poison.by);
        if (this.poison && --this.poison.ticks <= 0) this.poison = null;
      }
      if (this.healCol) this.changeHealth(this.healCol, this);
      if (!this.alive) return;
    }

    if (this.slowMult < 1) this.slowMult = Math.min(1, this.slowMult + C.SLOW_RECOVER * delta);

    // Accelerate towards the input direction.
    this.noMovTimer += delta;
    if (this.xVel || this.yVel) this.noMovTimer = 0;
    if (this.lockMove) {
      this.xVel = 0; this.yVel = 0;
    } else {
      let spd = (this.buildIndex >= 0 ? C.BUILD_SPEED : 1) * (this.weapon.spdMult || 1) * (this.hat.spdMult || 1) * this.slowMult;
      if (this.y <= C.SNOW_TOP) spd *= C.SNOW_SPEED;
      if (!this.zIndex && C.inRiver(this.y)) {
        if (this.hat.waterImmune) { spd *= 0.75; this.xVel += C.WATER_CURRENT * (this.hat.currentMult ?? 0.4) * delta; }
        else { spd *= C.WATER_SPEED; this.xVel += C.WATER_CURRENT * delta; }
      }
      if (this.moveDir !== null) {
        this.xVel += Math.cos(this.moveDir) * C.PLAYER_SPEED * spd * delta;
        this.yVel += Math.sin(this.moveDir) * C.PLAYER_SPEED * spd * delta;
      }
    }

    // Move in up to four sub-steps, colliding with objects after each.
    this.zIndex = 0; this.lockMove = false; this.healCol = 0;
    const travel = Math.hypot(this.xVel, this.yVel) * delta;
    const depth = Math.min(4, Math.max(1, Math.round(travel / 40)));
    const step = 1 / depth;
    const near = [];
    for (let i = 0; i < depth; i++) {
      this.x += this.xVel * delta * step;
      this.y += this.yVel * delta * step;
      for (const o of game.objects.near(this.x, this.y, this.scale + 180, near)) {
        if (o.active) game.objects.collide(this, o, step, game);
        if (!this.alive) return;
      }
    }
  }

  /** Friction, walls of the world and the swing — after player-vs-player pushes. */
  finish(delta) {
    if (!this.alive) return;
    const f = Math.pow(C.DECEL, delta);
    if (this.xVel) { this.xVel *= f; if (Math.abs(this.xVel) <= 0.01) this.xVel = 0; }
    if (this.yVel) { this.yVel *= f; if (Math.abs(this.yVel) <= 0.01) this.yVel = 0; }
    const s = this.scale;
    this.x = Math.min(C.MAP - s, Math.max(s, this.x));
    this.y = Math.min(C.MAP - s, Math.max(s, this.y));

    if (this.buildIndex < 0) {
      const w = this.weapon;
      const swinging = this.mouseState || this.hits > 0;
      if (this.reloads[w.id] > 0) {
        this.reloads[w.id] -= delta;
      } else if (swinging || this.autoGather) {
        let worked = true;
        if (w.gather !== undefined) this.gather();
        else if (w.projectile !== undefined && this.hasRes(w)) this.shoot(w);
        else worked = false;
        if (worked) this.reloads[w.id] = w.speed * (this.hat.atkSpd || 1);
      }
    }
    this.hits = 0;
  }

  shoot(w) {
    this.useRes(w);
    this.noMovTimer = 0;
    if (w.rec) { this.xVel -= w.rec * Math.cos(this.dir); this.yVel -= w.rec * Math.sin(this.dir); }
    const p = PROJECTILES[w.projectile];
    const off = this.scale * 2;
    this.game.addProjectile(this.x + off * Math.cos(this.dir), this.y + off * Math.sin(this.dir), this.dir, p.range, p.speed, w.projectile, this, this.zIndex);
    this.game.swingSeen(this, false, w.id);
  }

  /** One swing: hurt or harvest everything in the cone in front of you. */
  gather() {
    const game = this.game;
    const w = this.weapon;
    this.noMovTimer = 0;
    this.slowMult = Math.max(0, this.slowMult - (w.hitSlow ?? C.HIT_SLOW));
    const variant = this.variantOf();
    const inWater = !this.zIndex && C.inRiver(this.y);
    let hitSomething = false;

    for (const o of game.objects.near(this.x, this.y, w.range + 180)) {
      if (!o.active || !o.visibleTo(this)) continue;
      if (dist(this.x, this.y, o.x, o.y) - o.scale > w.range) continue;
      const dir = dirTo(o.x, o.y, this.x, this.y);
      if (angleDist(dir, this.dir) > C.GATHER_ANGLE) continue;
      hitSomething = true;
      if (o.health) {
        const dmg = w.dmg * variant.dmg * (w.sDmg || 1) * (this.hat.structDmg || 1);
        game.damageObject(o, dmg, this, dir);
      } else if (o.gives !== null) {
        this.earnXP(4 * w.gather);
        const count = w.gather + (o.gives === 3 ? 4 : 0);
        if (count) this.addResource(o.gives, count);
        game.objectHit(o, dir);
      }
    }

    for (const t of game.targets()) {
      if (t === this || !t.alive || (t.clan && t.clan === this.clan)) continue;
      if (dist(this.x, this.y, t.x, t.y) - t.scale * C.PLAYER_HIT_PAD > w.range) continue;
      const dir = dirTo(t.x, t.y, this.x, this.y);
      if (angleDist(dir, this.dir) > C.GATHER_ANGLE) continue;
      hitSomething = true;
      if (w.steal && t.isPlayer) {
        const n = Math.min(t.gold, w.steal);
        if (n) { this.addResource(3, n); t.addResource(3, -n); }
      }
      let mult = variant.dmg;
      const tw = t.isPlayer && t.buildIndex < 0 ? t.weapon : null;
      if (tw?.shield && angleDist(dir + Math.PI, t.dir) <= C.SHIELD_ANGLE) mult = tw.shield;
      const dmg = w.dmg * (this.hat.dmgDealt || 1) * (inWater && this.hat.waterDmg ? this.hat.waterDmg : 1);
      const knock = C.PLAYER_KNOCK * (t.weight || 1) + (w.knock || 0);
      t.xVel += knock * Math.cos(dir); t.yVel += knock * Math.sin(dir);
      if (t.hat?.reflect && dmg) this.changeHealth(-dmg * mult * t.hat.reflect, t);
      if (variant.poison && !t.poisonImmune && dmg) t.poison = { dmg: C.POISON.dmg, ticks: C.POISON.ticks, by: this };
      if (dmg) t.changeHealth(-dmg * mult, this, this);
      if (!this.alive) break;
    }
    game.swingSeen(this, hitSomething, w.id);
  }

  // ── building and eating ───────────────────────────────────────────────────
  hasRes(thing, mult = 1) { return costOf(thing, mult).every(([res, n]) => this[res] >= n); }
  useRes(thing, mult = 1) { for (const [res, n] of costOf(thing, mult)) this.addResource(RES.indexOf(res), -n); }

  canBuild(item) {
    if (item.group.limit && (this.itemCounts[item.group.id] || 0) >= item.group.limit) return false;
    return this.hasRes(item);
  }

  build(item) {
    if (!this.canBuild(item)) return false;
    const game = this.game;
    if (item.heal) {
      if (this.hitTime) {
        const since = game.time - this.hitTime;
        this.hitTime = 0;
        if (since <= C.SHAME_WINDOW) {
          if (++this.shameCount >= C.SHAME_LIMIT) { this.shameTimer = C.SHAME_MS; this.shameCount = 0; this.applyHat(); }
        } else {
          this.shameCount = Math.max(0, this.shameCount - 2);
        }
      }
      if (this.shameTimer > 0) return false;
      if (!this.consume(item)) return false;
    } else {
      const d = this.scale + item.scale + (item.placeOffset || 0);
      const x = this.x + d * Math.cos(this.dir);
      const y = this.y + d * Math.sin(this.dir);
      if (!game.objects.canPlace(x, y, item.scale, item)) return false;
      if (item.group.limit) this.changeItemCount(item.group.id, 1);
      if (item.pps) this.pps += item.pps;
      game.addObject({ x, y, dir: this.dir, scale: item.scale, type: item.type ?? null, item, owner: this });
    }
    this.useRes(item);
    this.buildIndex = -1;
    return true;
  }

  consume(item) {
    const healed = this.changeHealth(item.heal, this);
    if (item.healOverTime) {
      if (!healed && this.health >= this.maxHealth) return false;
      this.poison = { dmg: -item.healOverTime, ticks: item.healTicks, by: this };
      return true;
    }
    return healed;
  }

  changeItemCount(groupId, by) {
    this.itemCounts[groupId] = (this.itemCounts[groupId] || 0) + by;
    this.send('count', groupId, this.itemCounts[groupId]);
  }

  // ── health, resources, XP ─────────────────────────────────────────────────
  changeHealth(amount, doer, source) {
    if (!this.alive) return false;
    if (amount > 0 && this.health >= this.maxHealth) return false;
    if (amount < 0) {
      amount *= this.hat.dmgTaken || 1;
      this.hitTime = this.game.time;
    }
    this.health += amount;
    if (this.health > this.maxHealth) { amount -= this.health - this.maxHealth; this.health = this.maxHealth; }
    this.game.healthChanged(this);
    if (doer?.isPlayer && doer.alive && !(doer === this && amount < 0)) this.game.damageText(doer, this.x, this.y, -amount);
    if (this.health <= 0) this.game.killPlayer(this, doer);
    return true;
  }

  addResource(type, amount, auto = false) {
    if (!auto && amount > 0) this.weaponXP[this.weaponIndex] = (this.weaponXP[this.weaponIndex] || 0) + amount;
    const key = RES[type];
    this[key] = Math.max(0, this[key] + amount);
    this.send('res', type, Math.floor(this[key]));
  }

  earnXP(amount) {
    if (this.age >= C.MAX_AGE) return;
    this.xp += amount;
    if (this.xp >= this.maxXP) {
      this.age++;
      this.xp = 0;
      this.maxXP *= C.XP_GROWTH;
      this.upgradePoints++;
      this.send('upg', this.upgradePoints, this.upgrAge, this.choices());
      this.send('xp', 0, Math.round(this.maxXP), this.age);
    } else {
      this.send('xp', Math.floor(this.xp), 0, 0);
    }
  }

  /** This age's upgrade choices, flattened for the wire: [kind (0 weapon, 1 item), id, …]. */
  choices() {
    if (this.upgradePoints <= 0) return [];
    return upgradeChoices(this.upgrAge, this.items, this.weapons).flatMap((c) => [c.kind === 'weapon' ? 0 : 1, c.id]);
  }

  /** Pick one of this age's upgrades. */
  upgrade(kind, id) {
    if (this.upgradePoints <= 0) return false;
    const ok = upgradeChoices(this.upgrAge, this.items, this.weapons).some((c) => c.kind === kind && c.id === id);
    if (!ok) return false;
    if (kind === 'weapon') {
      const w = WEAPONS[id];
      this.weapons[w.type] = w.id;
      if (this.weapon.type === w.type) this.weaponIndex = w.id;
    } else {
      const it = ITEMS[id];
      const at = this.items.findIndex((i) => ITEMS[i].group === it.group);
      if (at >= 0) { if (this.buildIndex === this.items[at]) this.buildIndex = id; this.items[at] = id; } else this.items.push(id);
    }
    this.upgrAge++;
    this.upgradePoints--;
    this.send('loadout', this.items, this.weapons);
    this.send('upg', this.upgradePoints, this.upgrAge, this.choices());
    return true;
  }

  select(id, isWeapon) {
    if (isWeapon) {
      if (!this.weapons.includes(id)) return;
      this.buildIndex = -1;
      this.weaponIndex = id;
      return;
    }
    if (!this.items.includes(id)) return;
    if (this.buildIndex === id) { this.buildIndex = -1; this.mouseState = 0; return; }
    this.buildIndex = id;
    this.mouseState = 0;
  }

  get poisonImmune() { return false; }

  canSee(o) {
    return Math.abs(o.x - this.x) - (o.scale || 0) <= C.SEE_X && Math.abs(o.y - this.y) - (o.scale || 0) <= C.SEE_Y;
  }
}
