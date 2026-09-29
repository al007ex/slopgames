// Arrows, bullets and turret shots. They fly in a straight line and stop at
// the nearest thing they touch. Players on platforms (layer 1) shoot over walls.

import { PROJECTILES, WEAPONS } from '#shared/items.js';
import { SHIELD_ANGLE, PLAYER_KNOCK } from '#shared/config.js';
import { dist, angleDist, segmentHitsRect } from '#shared/util.js';

export class Projectile {
  constructor(game, sid, { x, y, dir, range, speed, index, owner, layer }) {
    Object.assign(this, { game, sid, x, y, dir, range, speed, index, owner, layer });
    const data = PROJECTILES[index];
    this.dmg = data.dmg;
    this.scale = data.scale;
    this.active = true;
    this.skipMove = true;   // the first tick only announces it, like a muzzle flash
  }

  update(delta) {
    if (!this.active) return;
    const game = this.game;
    const px = this.x; const py = this.y;
    if (this.skipMove) {
      this.skipMove = false;
    } else {
      let step = this.speed * delta;
      if (step >= this.range) { step = this.range; this.active = false; }
      this.x += step * Math.cos(this.dir);
      this.y += step * Math.sin(this.dir);
      this.range -= step;
    }

    const hits = [];
    for (const t of game.targets()) {
      if (!t.alive || t === this.owner || (this.owner?.clan && t.clan === this.owner.clan)) continue;
      if (segmentHitsRect(px, py, this.x, this.y, t.x - t.scale, t.y - t.scale, t.x + t.scale, t.y + t.scale)) hits.push(t);
    }
    for (const o of game.objects.near(this.x, this.y, this.scale + 180)) {
      if (!o.active || o === this.ignore || this.layer > o.layer || o.ignoreCollision) continue;
      const s = o.getScale();
      if (segmentHitsRect(px, py, this.x, this.y, o.x - s, o.y - s, o.x + s, o.y + s)) hits.push(o);
    }
    if (!hits.length) return;
    let hit = hits[0];
    for (const h of hits) if (dist(px, py, h.x, h.y) < dist(px, py, hit.x, hit.y)) hit = h;

    if (hit.isPlayer || hit.isAI) {
      const knock = PLAYER_KNOCK * (hit.weight || 1);
      hit.xVel += knock * Math.cos(this.dir); hit.yVel += knock * Math.sin(this.dir);
      const w = hit.isPlayer && hit.buildIndex < 0 ? WEAPONS[hit.weaponIndex] : null;
      const blocked = w?.shield && angleDist(this.dir + Math.PI, hit.dir) <= SHIELD_ANGLE;
      if (!blocked) hit.changeHealth(-this.dmg, this.owner, this.owner?.isPlayer ? this.owner : null);
    } else {
      if (hit.item?.projDmg && hit.health) game.damageObject(hit, this.dmg, null, this.dir);
      else game.objectHit(hit, this.dir);
    }
    this.active = false;
    game.projectileGone(this);
  }
}
