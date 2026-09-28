// Animals: wander, pause, flee when hurt; hostile ones charge the nearest
// player they can see. The boss winds up, leaps and smashes buildings.

import * as C from '#shared/config.js';
import { TAU, dist, dirTo } from '#shared/util.js';

const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

export class Animal {
  constructor(game, sid, data) {
    this.game = game;
    this.sid = sid;
    this.data = data;
    this.type = data.id;
    this.isAI = true;
    this.scale = data.scale;
    this.weight = data.weight;
    this.noTrap = !!data.noTrap;
    this.colDmg = data.colDmg || 0;
    this.maxHealth = data.health;
    this.spawnCounter = 0;
    this.place();
  }

  place() {
    const at = this.game.animalSpot(this.data);
    Object.assign(this, {
      x: at.x, y: at.y, xVel: 0, yVel: 0, dir: Math.random() * TAU, targetDir: 0,
      health: this.maxHealth, alive: true, zIndex: 0, lockMove: false,
      waitCount: 1000, moveCount: 0, runFrom: null, chargeTarget: null, hitWait: 0,
      poison: null, timer: 1000,
    });
  }

  update(delta) {
    const d = this.data;
    const game = this.game;
    if (!this.alive) {
      this.spawnCounter -= delta;
      if (this.spawnCounter <= 0) this.place();
      return;
    }
    this.timer -= delta;
    if (this.timer <= 0) {
      this.timer = 1000;
      if (this.poison) {
        this.changeHealth(-this.poison.dmg, this.poison.by);
        if (this.poison && --this.poison.ticks <= 0) this.poison = null;
        if (!this.alive) return;
      }
    }

    let charging = false;
    let slow = 1;
    if (!this.zIndex && !this.lockMove && C.inRiver(this.y)) { slow = C.WATER_SPEED; this.xVel += C.WATER_CURRENT * delta; }
    if (this.lockMove) {
      this.xVel = 0; this.yVel = 0;
    } else if (this.waitCount > 0) {
      this.waitCount -= delta;
      if (this.waitCount <= 0) {
        if (d.charge) {
          const target = this.nearestPlayer(d.viewRange);
          if (target) { this.chargeTarget = target; this.moveCount = rand(8000, 12000); }
          else { this.moveCount = rand(1000, 2000); this.targetDir = Math.random() * TAU - Math.PI; }
        } else {
          this.moveCount = rand(4000, 10000);
          this.targetDir = Math.random() * TAU - Math.PI;
        }
      }
    } else if (this.moveCount > 0 && d.speed) {
      let spd = d.speed * slow;
      if (this.runFrom && (this.runFrom.isAI ? this.runFrom.alive : this.runFrom.alive)) {
        this.targetDir = dirTo(this.x, this.y, this.runFrom.x, this.runFrom.y);
        spd *= 1.42;
      } else if (this.chargeTarget?.alive) {
        this.targetDir = dirTo(this.chargeTarget.x, this.chargeTarget.y, this.x, this.y);
        spd *= 1.75;
        charging = true;
      }
      if (this.hitWait) spd *= 0.3;
      this.turnTowards(this.targetDir, d.turnSpeed * delta);
      this.xVel += spd * delta * Math.cos(this.dir);
      this.yVel += spd * delta * Math.sin(this.dir);
      this.moveCount -= delta;
      if (this.moveCount <= 0) {
        this.runFrom = null; this.chargeTarget = null;
        this.waitCount = d.hostile ? 1500 : rand(1500, 6000);
      }
    }

    this.zIndex = 0; this.lockMove = false;
    const travel = Math.hypot(this.xVel, this.yVel) * delta;
    const depth = Math.min(4, Math.max(1, Math.round(travel / 40)));
    const near = [];
    for (let i = 0; i < depth; i++) {
      this.x += this.xVel * delta / depth;
      this.y += this.yVel * delta / depth;
      for (const o of game.objects.near(this.x, this.y, this.scale + 180, near)) {
        if (o.active) game.objects.collide(this, o, 1 / depth, game);
        if (!this.alive) return;
      }
    }

    // The boss: a wind-up, then a slam that can also leap forwards.
    let hitting = false;
    if (this.hitWait > 0) {
      this.hitWait -= delta;
      if (this.hitWait <= 0) {
        hitting = true;
        this.hitWait = 0;
        if (d.leapForce && !rand(0, 2)) { this.xVel += d.leapForce * Math.cos(this.dir); this.yVel += d.leapForce * Math.sin(this.dir); }
        for (const o of game.objects.near(this.x, this.y, d.hitRange + 60)) {
          if (o.active && o.health && dist(this.x, this.y, o.x, o.y) < o.scale + d.hitRange) game.damageObject(o, d.dmg * 5, null, dirTo(o.x, o.y, this.x, this.y));
        }
        game.bossSlam(this);
      }
    }
    if (charging || hitting) {
      for (const p of game.alivePlayers()) {
        const dd = dist(this.x, this.y, p.x, p.y);
        if (d.hitRange) {
          if (!this.hitWait && dd <= d.hitRange + p.scale) {
            if (hitting) {
              const dir = dirTo(p.x, p.y, this.x, this.y);
              p.changeHealth(-d.dmg, null);
              p.xVel += 0.6 * Math.cos(dir); p.yVel += 0.6 * Math.sin(dir);
              this.runFrom = null; this.chargeTarget = null;
              this.waitCount = 3000;
              this.hitWait = !rand(0, 2) ? 600 : 0;
            } else {
              this.hitWait = d.hitDelay;
            }
          }
        } else if (dd <= this.scale + p.scale) {
          const dir = dirTo(p.x, p.y, this.x, this.y);
          p.changeHealth(-d.dmg, null);
          p.xVel += 0.55 * Math.cos(dir); p.yVel += 0.55 * Math.sin(dir);
        }
      }
    }

    const f = Math.pow(C.DECEL, delta);
    this.xVel *= f; this.yVel *= f;
    const s = this.scale;
    if (this.x - s < 0) { this.x = s; this.xVel = 0; } else if (this.x + s > C.MAP) { this.x = C.MAP - s; this.xVel = 0; }
    if (this.y - s < 0) { this.y = s; this.yVel = 0; } else if (this.y + s > C.MAP) { this.y = C.MAP - s; this.yVel = 0; }
  }

  turnTowards(target, max) {
    let diff = ((target - this.dir) % TAU + TAU * 1.5) % TAU - Math.PI;
    if (Math.abs(diff) > max) diff = Math.sign(diff) * max;
    this.dir = ((this.dir + diff) % TAU + TAU) % TAU;
  }

  nearestPlayer(range) {
    let best = null; let bestD = range;
    for (const p of this.game.alivePlayers()) {
      const dd = dist(this.x, this.y, p.x, p.y);
      if (dd <= bestD) { best = p; bestD = dd; }
    }
    return best;
  }

  changeHealth(amount, doer, runFrom) {
    if (!this.alive) return false;
    this.health += amount;
    if (runFrom) {
      if (this.data.hostile && this.data.charge && runFrom.isPlayer) { this.chargeTarget = runFrom; this.waitCount = 0; this.moveCount = 8000; }
      else if (!this.data.still) { this.runFrom = runFrom; this.waitCount = 0; this.moveCount = 2000; }
    }
    if (amount < 0 && doer?.isPlayer) this.game.damageText(doer, this.x, this.y, -amount);
    this.game.animalHealth(this);
    if (this.health <= 0) this.game.killAnimal(this, doer);
    return true;
  }

  get hat() { return null; }
  get poisonImmune() { return false; }
}
