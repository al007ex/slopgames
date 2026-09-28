// The canvas renderer. Everyone sees the same 1920 × 1080 slice of world,
// scaled to cover their window. Draw order, bottom to top: ground, water,
// grid, floor items, players and animals, walls and spikes, mills and
// turrets, players on platforms, bushes and gold, then tree canopies.

import * as C from '#shared/config.js';
import { WEAPONS, ITEMS, PROJECTILES } from '#shared/items.js';
import { ANIMALS } from '#shared/animals.js';
import { hatById } from '#shared/hats.js';
import { resourceSprite, TREE, BUSH } from '#shared/world.js';
import * as A from './assets.js';

const OUTLINE = '#525252';
const DARK = '#3d3f42';
const OUTLINE_W = 5.5;
const GRASS = '#b6db66';
const SNOW = '#ffffff';
const SAND = '#dbc666';
const WATER = '#91b2db';
const FONT = 'Hammersmith One';
const HAND_R = 14;
const BAR_W = 50;
const BAR_PAD = 4.5;
const NAME_Y = 34;

// How big each sprite is drawn, as a multiple of the object's radius.
const RES_SIZE = { [TREE]: 1.18, [BUSH]: 1.12, 2: 1.2, 3: 1.2 };
const CACTUS_SIZE = 1.05;
const ITEM_SIZE = {
  wood_wall: 1.3, stone_wall: 1.3, spikes: 1.75, greater_spikes: 1.75, spinning_spikes: 1.75, mill: 1.15, mine: 1.3,
  sapling: 1.05, trap: 1.35, boost_pad: 1.4, turret: 1.3, platform: 1.4, healing_pad: 1.4, spawn_pad: 1.4, blocker: 1.2, teleporter: 1.4,
  apple: 1.9, cookie_1: 1.7, cheese: 1.7,
};
const BLADE_SIZE = 2.35;

export const itemDrawSize = (item) => item.scale * 2 * (ITEM_SIZE[item.sprite] || 1.3);

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.cam = { x: C.MAP / 2, y: C.MAP / 2 };
    this.waterMult = 1;
    this.waterPlus = 1;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth; const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.scale = Math.max(w / C.VIEW_W, h / C.VIEW_H);
    this.dpr = dpr;
    this.viewW = w / this.scale;
    this.viewH = h / this.scale;
  }

  /** Screen pixel → world. */
  toWorld(sx, sy) {
    return { x: this.cam.x - this.viewW / 2 + sx / this.scale, y: this.cam.y - this.viewH / 2 + sy / this.scale };
  }

  follow(target, delta) {
    if (!target) return;
    const dx = target.x - this.cam.x; const dy = target.y - this.cam.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.05) { const step = Math.min(d * 0.01 * delta, d); this.cam.x += step * dx / d; this.cam.y += step * dy / d; }
    else { this.cam.x = target.x; this.cam.y = target.y; }
  }

  frame(s, delta, now) {
    const g = this.g;
    g.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, 0, 0);
    const ox = this.cam.x - this.viewW / 2;
    const oy = this.cam.y - this.viewH / 2;
    this.ox = ox; this.oy = oy;

    this.drawGround(ox, oy, delta);
    this.drawGrid(ox, oy);

    const objs = s.visibleObjects(ox, oy, this.viewW, this.viewH);
    this.drawObjects(objs, -1, now);
    this.drawProjectiles(s, 0);
    this.drawPlayers(s, 0, delta);
    for (const a of s.animals.values()) if (a.visible) this.drawAnimal(a, delta);
    this.drawObjects(objs, 0, now);
    this.drawProjectiles(s, 1);
    this.drawObjects(objs, 1, now);
    this.drawPlayers(s, 1, delta);
    this.drawObjects(objs, 2, now);
    this.drawObjects(objs, 3, now);

    this.drawOverlays(s, delta, now);
    this.drawMapEdge(ox, oy);
  }

  // ── ground ────────────────────────────────────────────────────────────
  drawGround(ox, oy, delta) {
    const g = this.g; const w = this.viewW; const h = this.viewH;
    const band = (y0, y1, color) => {
      const a = Math.max(y0 - oy, 0); const b = Math.min(y1 - oy, h);
      if (b > a) { g.fillStyle = color; g.fillRect(0, a, w, b - a); }
    };
    band(-1e5, C.SNOW_TOP, SNOW);
    band(C.SNOW_TOP, C.DESERT_TOP, GRASS);
    band(C.DESERT_TOP, 1e5, SAND);

    this.waterMult += this.waterPlus * C.WAVE_SPEED * delta;
    if (this.waterMult >= C.WAVE_MAX) { this.waterMult = C.WAVE_MAX; this.waterPlus = -1; }
    else if (this.waterMult <= 1) { this.waterMult = 1; this.waterPlus = 1; }
    band(C.RIVER_TOP - C.RIVER_PADDING, C.RIVER_BOTTOM + C.RIVER_PADDING, SAND);
    const wave = (this.waterMult - 1) * 250;
    band(C.RIVER_TOP - wave, C.RIVER_BOTTOM + wave, WATER);
  }

  drawGrid(ox, oy) {
    const g = this.g;
    g.save();
    g.lineWidth = 4; g.strokeStyle = '#000'; g.globalAlpha = 0.06;
    g.beginPath();
    for (let x = Math.ceil(ox / 60) * 60 - ox; x < this.viewW; x += 60) { g.moveTo(x, 0); g.lineTo(x, this.viewH); }
    for (let y = Math.ceil(oy / 60) * 60 - oy; y < this.viewH; y += 60) { g.moveTo(0, y); g.lineTo(this.viewW, y); }
    g.stroke();
    g.restore();
  }

  drawMapEdge(ox, oy) {
    const g = this.g;
    g.save();
    g.fillStyle = 'rgba(0, 0, 70, 0.35)';
    const l = -ox; const t = -oy; const r = C.MAP - ox; const b = C.MAP - oy;
    if (l > 0) g.fillRect(0, 0, l, this.viewH);
    if (r < this.viewW) g.fillRect(r, 0, this.viewW - r, this.viewH);
    if (t > 0) g.fillRect(Math.max(0, l), 0, Math.min(this.viewW, r) - Math.max(0, l), t);
    if (b < this.viewH) g.fillRect(Math.max(0, l), b, Math.min(this.viewW, r) - Math.max(0, l), this.viewH - b);
    g.restore();
  }

  // ── objects ───────────────────────────────────────────────────────────
  drawObjects(list, layer, now) {
    const g = this.g;
    for (const o of list) {
      if (o.layer !== layer) continue;
      const x = o.x + o.xWiggle - this.ox; const y = o.y + o.yWiggle - this.oy;
      g.save();
      g.translate(x, y);
      if (o.item) this.drawItemAt(o.item, o, now);
      else this.drawResource(o, now);
      g.restore();
    }
  }

  drawResource(o, now) {
    const name = resourceSprite(o.type, o.y);
    const img = A.worldSprite(name);
    if (!img) return;
    const s = o.scale * 2 * (name === 'cactus' ? CACTUS_SIZE : RES_SIZE[o.type]);
    this.g.drawImage(img, -s / 2, -s / 2, s, s);
    if (o.type === TREE || (o.type === BUSH && name === 'bush_1')) {
      const leaves = A.leafSprite(name);
      if (leaves) {
        this.g.rotate(Math.sin(now * 0.0006 + o.sid) * 0.05);
        this.g.drawImage(leaves, -s / 2, -s / 2, s, s);
      }
    }
  }

  drawItemAt(item, o, now) {
    const g = this.g;
    const s = itemDrawSize(item);
    const spin = o?.spin || 0;
    if (item.sprite === 'mill') {
      const base = A.itemSprite(item);
      if (base) g.drawImage(base, -s / 2, -s / 2, s, s);
      const blades = A.millBlades(item);
      if (blades) {
        const b = item.scale * BLADE_SIZE;
        g.rotate((o ? o.dir : 0) + spin);
        g.drawImage(blades, -b / 2, -b / 2, b, b);
      }
      return;
    }
    g.rotate((o ? o.dir : 0) + (item.turnSpeed ? spin : 0));
    const img = A.itemSprite(item);
    if (img) g.drawImage(img, -s / 2, -s / 2, s, s);
    if (item.drawn === 'turret') {
      const top = A.turretTop();
      if (o?.aim !== undefined) g.rotate(o.aim - o.dir);
      g.drawImage(top, -s / 2, -s / 2, s, s);
    }
  }

  // ── players ───────────────────────────────────────────────────────────
  drawPlayers(s, z, delta) {
    const g = this.g;
    for (const p of s.players.values()) {
      if (!p.visible || p.z !== z) continue;
      animate(p, delta);
      g.save();
      g.translate(p.x - this.ox, p.y - this.oy);
      g.rotate(p.dir + p.dirPlus);
      this.drawPlayerBody(p);
      g.restore();
    }
  }

  /** A player in its own frame: +x is forward, +y is to its right. */
  drawPlayerBody(p) {
    const g = this.g;
    const w = WEAPONS[p.weapon] || WEAPONS[0];
    const building = p.build >= 0;
    const handAngle = Math.PI / 4 * (w.armS || 1);
    const oHandAngle = building ? 1 : (w.hndS || 1);
    const oHandDist = building ? 1 : (w.hndD || 1);
    const sc = C.PLAYER_SCALE;
    g.lineWidth = OUTLINE_W; g.lineJoin = 'miter'; g.strokeStyle = DARK;

    if (!building && !w.aboveHand) this.drawTool(w, p.variant, sc);
    g.fillStyle = C.SKIN_COLORS[p.skin] || C.SKIN_COLORS[0];
    circle(g, sc * Math.cos(handAngle), sc * Math.sin(handAngle), HAND_R);
    circle(g, sc * oHandDist * Math.cos(-handAngle * oHandAngle), sc * oHandDist * Math.sin(-handAngle * oHandAngle), HAND_R);
    if (!building && w.aboveHand) this.drawTool(w, p.variant, sc);
    if (building) {
      const item = ITEMS[p.build];
      const size = itemDrawSize(item) * (item.group.id === 0 ? 1 : 0.9);
      g.save();
      g.translate(sc - item.holdOffset + size / 2, 0);
      this.drawItemAt(item, null, 0);
      g.restore();
    }
    g.fillStyle = C.SKIN_COLORS[p.skin] || C.SKIN_COLORS[0];
    circle(g, 0, 0, sc);
    const hat = p.hat ? hatById(p.hat) : null;
    if (hat) {
      g.save();
      g.rotate(Math.PI / 2);
      const shadow = A.hatShadow(hat.id);
      if (shadow) g.drawImage(shadow, -hat.scale / 2, -hat.scale / 2, hat.scale, hat.scale);
      const img = A.hatSprite(hat.id);
      if (img) g.drawImage(img, -hat.scale / 2, -hat.scale / 2, hat.scale, hat.scale);
      g.restore();
    }
  }

  drawTool(w, variant, sc) {
    const g = this.g;
    const img = A.weaponSprite(w, variant);
    if (img) g.drawImage(img, sc + w.xOff - w.length / 2, w.yOff - w.width / 2, w.length, w.width);
    if (w.projectile !== undefined && !w.hideProjectile) {
      const pd = PROJECTILES[w.projectile];
      const arrow = pd.sprite && A.projectileSprite(pd.sprite);
      if (arrow) g.drawImage(arrow, sc - pd.scale / 2, -pd.scale / 2, pd.scale, pd.scale);
    }
  }

  // ── animals ───────────────────────────────────────────────────────────
  drawAnimal(a, delta) {
    const g = this.g;
    const data = ANIMALS[a.type];
    animate(a, delta);
    const img = A.animalSprite(data);
    g.save();
    g.translate(a.x - this.ox, a.y - this.oy);
    g.rotate(a.dir + a.dirPlus - Math.PI / 2);
    if (img) {
      const s = data.scale * 1.2 * (data.spriteMlt || 1);
      g.drawImage(img, -s, -s, s * 2, s * 2);
    }
    g.restore();
  }

  // ── projectiles ───────────────────────────────────────────────────────
  drawProjectiles(s, layer) {
    const g = this.g;
    for (const pr of s.projectiles) {
      if (pr.layer !== layer) continue;
      const data = PROJECTILES[pr.index];
      g.save();
      g.translate(pr.x - this.ox, pr.y - this.oy);
      g.rotate(pr.dir);
      if (data.sprite || data.drawn) {
        const img = A.projectileSprite(data.sprite || data.drawn);
        const sz = data.drawn ? 28 : data.scale;
        if (img) g.drawImage(img, -sz / 2, -sz / 2, sz, sz);
      } else {
        g.fillStyle = '#939393'; g.strokeStyle = DARK; g.lineWidth = OUTLINE_W;
        circle(g, 0, 0, data.scale / 2);
      }
      g.restore();
    }
  }

  // ── names, bars, chat, numbers ────────────────────────────────────────
  drawOverlays(s, delta, now) {
    const g = this.g;
    const me = s.players.get(s.me);
    g.textBaseline = 'middle'; g.textAlign = 'center'; g.lineJoin = 'round';
    for (const a of s.animals.values()) {
      if (!a.visible) continue;
      const data = ANIMALS[a.type];
      const x = a.x - this.ox; const y = a.y - this.oy;
      if (data.nameScale) {
        g.font = `${data.nameScale}px ${FONT}`;
        g.fillStyle = '#fff'; g.strokeStyle = DARK; g.lineWidth = 11;
        g.strokeText(data.name, x, y - data.scale - NAME_Y);
        g.fillText(data.name, x, y - data.scale - NAME_Y);
      }
      if (a.health > 0 && a.health < data.health) this.healthBar(x, y + data.scale, a.health / data.health, '#cc5151');
    }
    for (const p of s.players.values()) {
      if (!p.visible) continue;
      const x = p.x - this.ox; const y = p.y - this.oy;
      const clan = p.clan ? s.clanNames.get(p.clan) : null;
      const text = clan ? `[${clan}] ${p.name}` : p.name;
      g.font = `30px ${FONT}`;
      g.fillStyle = '#fff'; g.strokeStyle = DARK; g.lineWidth = 8;
      const ny = y - C.PLAYER_SCALE - NAME_Y;
      g.strokeText(text, x, ny); g.fillText(text, x, ny);
      if (s.leader === p.sid) {
        const crown = A.icon('crown');
        if (crown) { const cs = 60; g.drawImage(crown, x - cs / 2 - g.measureText(text).width / 2 - 35, ny - cs / 2 - 5, cs, cs); }
      }
      if (p.health > 0) {
        const friendly = p.sid === s.me || (me && p.clan && p.clan === me.clan);
        this.healthBar(x, y + C.PLAYER_SCALE, p.health / p.maxHealth, friendly ? '#8ecc51' : '#cc5151');
      }
      if (p.chat && now - p.chat.at < C.CHAT_SHOW) {
        g.font = `32px ${FONT}`;
        const tw = g.measureText(p.chat.text).width + 34;
        const cy = ny - 60;
        g.fillStyle = 'rgba(0,0,0,0.2)';
        g.beginPath(); g.roundRect(x - tw / 2, cy - 23, tw, 46, 6); g.fill();
        g.fillStyle = '#fff'; g.fillText(p.chat.text, x, cy + 1);
      }
    }
    for (const t of s.texts) {
      t.life -= delta;
      if (t.life <= 0) continue;
      t.y -= t.speed * delta;
      if (t.grow) { t.scale += 0.7 * delta * 0.1; if (t.scale >= t.max) { t.scale = t.max; t.grow = false; } }
      else t.scale = Math.max(t.start, t.scale - 0.7 * delta * 0.1);
      g.font = `${Math.round(t.scale)}px ${FONT}`;
      g.fillStyle = t.color;
      g.globalAlpha = Math.min(1, t.life / 200);
      g.fillText(t.text, t.x - this.ox, t.y - this.oy);
      g.globalAlpha = 1;
    }
    s.texts = s.texts.filter((t) => t.life > 0);
  }

  healthBar(x, y, ratio, color) {
    const g = this.g;
    g.fillStyle = DARK;
    g.beginPath(); g.roundRect(x - BAR_W - BAR_PAD, y + NAME_Y, BAR_W * 2 + BAR_PAD * 2, 17, 8); g.fill();
    g.fillStyle = color;
    g.beginPath(); g.roundRect(x - BAR_W, y + NAME_Y + BAR_PAD, BAR_W * 2 * Math.max(0, Math.min(1, ratio)), 17 - BAR_PAD * 2, 7); g.fill();
  }
}

function circle(g, x, y, r) {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
}

/**
 * The swing: a quarter of the time swinging out to the target angle, three
 * quarters swinging back. A swing that hits something goes a quarter turn; one
 * that only cuts air goes a half turn.
 */
export function animate(e, delta) {
  if (!(e.animTime > 0)) return;
  e.animTime -= delta;
  if (e.animTime <= 0) { e.animTime = 0; e.dirPlus = 0; e.ratio = 0; e.phase = 0; return; }
  if (e.phase === 0) {
    e.ratio += delta / (e.animSpeed * C.HIT_RETURN);
    e.dirPlus = e.targetAngle * Math.min(1, e.ratio);
    if (e.ratio >= 1) { e.ratio = 1; e.phase = 1; }
  } else {
    e.ratio -= delta / (e.animSpeed * (1 - C.HIT_RETURN));
    e.dirPlus = e.targetAngle * Math.max(0, e.ratio);
  }
}

export function startSwing(e, hit, speed) {
  e.animTime = e.animSpeed = speed;
  e.targetAngle = hit ? -C.HIT_ANGLE : -C.MISS_ANGLE;
  e.ratio = 0; e.phase = 0;
}
