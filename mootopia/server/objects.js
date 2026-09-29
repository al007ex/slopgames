// Everything that stands still on the map — trees, bushes, rocks, gold and
// whatever players build — plus the rules for bumping into it.

import { MAP, SPIKE_KNOCK, POISON, CACTUS_DMG, inRiver } from '#shared/config.js';
import { dist, dirTo } from '#shared/util.js';
import { bump } from '#shared/physics.js';
import { TREE, BUSH, ROCK, GOLD, isCactus } from '#shared/world.js';

const CELL = 240;
const COLS = Math.ceil(MAP / CELL) + 1;
const PLATFORM = 'Platform';

export class GameObject {
  constructor(sid, { x, y, dir = 0, scale, type = null, item = null, owner = null }) {
    this.sid = sid;
    this.x = x; this.y = y; this.dir = dir; this.scale = scale;
    this.type = type;                  // resource kind (TREE…GOLD) — also set for mines and saplings
    this.item = item;                  // the placed item, if a player built it
    this.owner = owner;                // the player who built it
    this.isItem = !!item;
    this.active = true;
    this.health = item?.health;
    this.maxHealth = item?.health;
    this.layer = item ? item.group.layer : type === TREE ? 3 : type === ROCK ? 0 : 2;
    this.colDiv = item?.colDiv || 1;
    this.ignoreCollision = !!item?.ignoreCollision;
    this.hideFromEnemy = !!item?.hideFromEnemy;
    this.dmg = item?.dmg || (type !== null && isCactus(type, y) ? CACTUS_DMG : 0);
    this.pDmg = item?.pDmg || 0;
    this.zIndex = item?.zIndex || 0;
    this.turnSpeed = item?.turnSpeed || 0;
    this.shootCount = item?.shootRate || 0;
    this.cells = [];
    this.sentTo = new Set();
  }

  /**
   * Radius used for collisions: the sprite's silhouette. Walk-over pads use a
   * smaller trigger zone (colDiv) so you have to actually step onto them.
   */
  getScale(ignoreColDiv = false) {
    return this.scale * (ignoreColDiv ? 1 : this.colDiv);
  }

  /** How close a new building may come. Canopies may overhang buildings a little. */
  get placeRadius() {
    if (this.item?.blocker) return this.item.blocker;
    return this.isItem || this.type === ROCK || this.type === GOLD ? this.scale : this.scale * 0.6;
  }

  visibleTo(player) {
    return !this.hideFromEnemy || (this.owner && (this.owner === player || (this.owner.clan && this.owner.clan === player.clan)));
  }

  /** Resource type a swing at this gives, or null if it is a building. */
  get gives() {
    if (this.isItem) return this.item.type === undefined ? null : this.item.type;
    return this.type;
  }
}

export class ObjectManager {
  constructor() {
    this.list = [];
    this.bySid = new Map();
    this.grid = new Map();
    this.nextSid = 1;
    this.spinning = [];
    this.turrets = [];
  }

  add(data) {
    const o = new GameObject(this.nextSid++, data);
    this.list.push(o);
    this.bySid.set(o.sid, o);
    this.insert(o);
    if (o.turnSpeed) this.spinning.push(o);
    if (o.item?.projectile !== undefined) this.turrets.push(o);
    return o;
  }

  insert(o) {
    const r = Math.max(o.scale, o.item?.blocker || 0);
    const x0 = Math.max(0, Math.floor((o.x - r) / CELL)); const x1 = Math.floor((o.x + r) / CELL);
    const y0 = Math.max(0, Math.floor((o.y - r) / CELL)); const y1 = Math.floor((o.y + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = cx * COLS + cy;
      let cell = this.grid.get(k);
      if (!cell) { cell = []; this.grid.set(k, cell); }
      cell.push(o);
      o.cells.push(k);
    }
  }

  remove(o) {
    if (!o.active) return;
    o.active = false;
    for (const k of o.cells) {
      const cell = this.grid.get(k);
      const i = cell.indexOf(o);
      if (i >= 0) cell.splice(i, 1);
    }
    o.cells.length = 0;
    this.bySid.delete(o.sid);
    const i = this.list.indexOf(o);
    if (i >= 0) this.list.splice(i, 1);
    if (o.turnSpeed) this.spinning.splice(this.spinning.indexOf(o), 1);
    if (this.turrets.includes(o)) this.turrets.splice(this.turrets.indexOf(o), 1);
  }

  /** Objects whose grid cells touch the square around (x, y). */
  near(x, y, r, out = []) {
    out.length = 0;
    const seen = new Set();
    const x0 = Math.max(0, Math.floor((x - r) / CELL)); const x1 = Math.floor((x + r) / CELL);
    const y0 = Math.max(0, Math.floor((y - r) / CELL)); const y1 = Math.floor((y + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const cell = this.grid.get(cx * COLS + cy);
      if (!cell) continue;
      for (const o of cell) if (!seen.has(o)) { seen.add(o); out.push(o); }
    }
    return out;
  }

  /** May an item of radius `s` go at (x, y)? */
  canPlace(x, y, s, item) {
    if (x - s < 0 || y - s < 0 || x + s > MAP || y + s > MAP) return false;
    for (const o of this.near(x, y, s + 320)) {
      if (dist(x, y, o.x, o.y) < s + o.placeRadius) return false;
    }
    if (item?.name !== PLATFORM && inRiver(y)) return false;
    return true;
  }

  ownedBy(player) { return this.list.filter((o) => o.owner === player); }

  /**
   * Resolve one moving body (player or animal) against one object. `step` is
   * the share of the tick this sub-step covers. Returns true on contact.
   */
  collide(e, o, step, game) {
    const friendly = !!o.owner && (o.owner === e || (!!o.owner.clan && o.owner.clan === e.clan));
    // The bump itself is shared with the client's prediction; damage is not.
    const hit = bump(e, o, o.getScale(), step, friendly);
    if (!hit) return false;
    if (hit === 'solid') {
      const dir = dirTo(e.x, e.y, o.x, o.y);
      if (o.dmg && !friendly) {
        e.changeHealth(-o.dmg, o.owner, game);
        const knock = SPIKE_KNOCK * (e.weight || 1);
        e.xVel += knock * Math.cos(dir); e.yVel += knock * Math.sin(dir);
        if (o.pDmg && !e.poisonImmune) e.poison = { dmg: o.pDmg, ticks: POISON.ticks, by: o.owner };
      }
      if (e.colDmg && o.health) game.damageObject(o, e.colDmg, null, dirTo(o.x, o.y, e.x, e.y));
    } else if (o.item.trap) {
      if (e.lockMove) o.hideFromEnemy = false;
    } else if (o.item.teleport && e.isPlayer) {
      e.x = 100 + Math.random() * (MAP - 200);
      e.y = 100 + Math.random() * (MAP - 200);
    }
    return true;
  }
}

export { TREE, BUSH, ROCK, GOLD };
