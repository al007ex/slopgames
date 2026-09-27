// The local player's loadout on the client: the hotbar, switching slots, and
// firing — predicted here with the same rules as the server (rate, magazine,
// semi-auto, bloom and the hashed spread), so your own shots show instantly.
// The server's answer (what was hit, how much damage) arrives as hit markers.

import * as THREE from 'three';
import { WEAPONS, HEALS, RARITY_COLORS, itemName } from '#shared/items.js';
import { spreadFor, shotDirection, pelletDirection, ticksPerShot } from '#shared/weapons.js';
import { aimFrame, aimPoint } from '#shared/aim.js';
import { BTN_FIRE, BTN_ADS, MODE_WALK } from '#shared/movement.js';
import { TICK_HZ, TICK_MS } from '#shared/constants.js';
import { A_SLOT, A_RELOAD } from '#shared/protocol.js';

const $ = (id) => document.getElementById(id);
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const EQUIP_MS = 200;

const ICONS = {
  pistol: 'M3 9h13v3H9v5H5v-5H3z', revolver: 'M3 9h14v3h-6l-1 2H8l-1 3H4l1-5H3z', smg: 'M2 8h17v3h-4v5h-3v-5H9l-2 4H4l2-4H2z',
  ar: 'M1 9h21v2h-6v4h-2v-4h-4l-2 5H5l2-5H1z', burst: 'M1 9h21v2h-6v4h-2v-4h-4l-2 5H5l2-5H1z', scoped: 'M1 10h21v2h-6v4h-2v-4h-4l-2 5H5l2-5H1zM7 6h8v3H7z',
  pump: 'M1 9h21v3H10l-2 4H4l2-4H1z', tactical: 'M1 9h21v3H10l-2 4H4l2-4H1zM13 12h5v2h-5z', sniper: 'M0 10h23v2H9l-2 4H4l2-4H0zM6 6h9v3H6z',
  rocket: 'M1 8h20v5H1zM6 13h3v4H6z', grenade: 'M2 8h8v6H2zM10 9h11v3H10zM5 14h3v3H5z',
  bandage: 'M4 7h15v9H4zM9 7v9M14 7v9', medkit: 'M4 6h15v12H4zM10 9h3v2h2v3h-2v2h-3v-2H8v-3h2z', shield: 'M9 3h5v4l3 3v10H6V10l3-3z',
};

export class Loadout {
  constructor(app) {
    this.app = app;
    this.slots = [null, null, null, null, null];
    this.ammo = { light: 0, medium: 0, heavy: 0, rockets: 0 };
    this.held = 0;
    this.equipAt = 0;
    this.nextShotAt = 0;
    this.latch = false;
    this.bloom = 0;
    this.lastShotAt = 0;
    this.shots = 0;
    this.reload = null;
    this.using = null;
    this.clicked = false;
    this.damageNumbers = [];
    this.buildHotbar();
  }

  get item() { return this.held > 0 ? this.slots[this.held - 1] : null; }
  get weapon() { const it = this.item; return it && WEAPONS[it.key] ? it : null; }

  /** The server's view of the inventory. */
  sync(msg) {
    if (msg.slots) this.slots = msg.slots.map((s) => (s ? { ...s } : null));
    if (msg.ammo) this.ammo = { ...msg.ammo };
    if (msg.held !== undefined && msg.held !== this.held && performance.now() - this.equipAt > 400) this.held = msg.held;
    this.reload = msg.reload;
    this.using = msg.using;
    if (msg.shots !== undefined && msg.shots > this.shots) this.shots = msg.shots;
    this.renderHotbar();
  }

  select(slot) {
    if (slot === this.held || slot < 0 || slot > 5) return;
    this.held = slot;
    this.equipAt = performance.now();
    this.app.queueAction({ type: A_SLOT, slot });
    this.renderHotbar();
    this.app.audio.click();
  }

  onPress(action) {
    const m = /^slot(\d)$/.exec(action);
    if (m) { this.select(Number(m[1]) - 1); return true; }
    if (action === 'reload') { this.app.queueAction({ type: A_RELOAD }); return true; }
    return false;
  }

  wheel(dir) {
    if (!dir) return;
    let s = this.held;
    for (let i = 0; i < 6; i++) {
      s = (s + dir + 6) % 6;
      if (s === 0 || this.slots[s - 1]) break;
    }
    this.select(s);
  }

  /** Buttons for this tick; a click shorter than a tick still fires once. */
  fireButton(held) {
    const down = held || this.clicked;
    this.clicked = false;
    return down;
  }

  /**
   * Called once per client tick after the input is built: predicts a shot
   * (muzzle flash, sound, tracer) if the server will fire one this tick.
   */
  predict(input, now) {
    const app = this.app;
    const me = app.game.me;
    const it = this.weapon;
    const down = (input.buttons & BTN_FIRE) !== 0;
    const dt = TICK_MS / 1000;
    if (it) {
      const def = WEAPONS[it.key];
      if (now - this.lastShotAt > 250) this.bloom = Math.max(0, this.bloom - def.bloom.recover * dt);
      const ready = down && (def.auto || !this.latch) && now >= this.nextShotAt && now - this.equipAt >= EQUIP_MS
        && !this.reload && me.move.mode === MODE_WALK && app.build.mode === 'weapon';
      if (ready && it.mag > 0) {
        const bursts = def.burst || 1;
        for (let b = 0; b < bursts && it.mag > 0; b++) setTimeout(() => this.fireLocal(input), b * def.burstGap * TICK_MS);
        this.nextShotAt = now + ticksPerShot(it.key, TICK_HZ) * TICK_MS - 5;
      } else if (ready && it.mag <= 0) app.audio.click();
    } else this.bloom = 0;
    this.latch = down;
  }

  fireLocal(input) {
    const it = this.weapon;
    if (!it || it.mag <= 0) return;
    const app = this.app;
    const me = app.game.me;
    const def = WEAPONS[it.key];
    const ads = (input.buttons & BTN_ADS) !== 0;
    it.mag--;
    this.shots++;
    const spread = spreadFor(it.key, this.bloom, me.move, ads);
    this.bloom = Math.min(def.bloom.max, this.bloom + def.bloom.shot);
    this.lastShotAt = performance.now();
    const f = aimFrame(me.move, input.yaw, input.pitch, ads, {});
    const target = aimPoint(f, app.game.world.grid, def.range, {});
    const tx = target.x - f.ex, ty = target.y - f.ey, tz = target.z - f.ez;
    const tl = Math.hypot(tx, ty, tz) || 1;
    const base = { x: tx / tl, y: ty / tl, z: tz / tl };
    const muzzle = this.muzzlePos(me.move, input.yaw, input.pitch);
    app.shotFx.muzzle(muzzle);
    app.audio.gun(muzzle, def.cls, true);
    app.cam.kick(def.cls);
    if (!def.projectile) {
      const pellets = def.pellets || 1;
      for (let k = 0; k < pellets; k++) {
        const d = pellets > 1 ? pelletDirection(base, def.spread + spread, me.id, this.shots, k, pellets, {}) : shotDirection(base, spread, me.id, this.shots, 0, {});
        const hit = {};
        const t = app.game.world.grid.raycast(f.ex, f.ey, f.ez, d.x, d.y, d.z, def.range, hit);
        const len = t < Infinity ? t : Math.min(def.range, 200);
        app.shotFx.tracer(muzzle, { x: f.ex + d.x * len, y: f.ey + d.y * len, z: f.ez + d.z * len });
      }
    }
    this.renderHotbar();
  }

  muzzlePos(move, yaw, pitch) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const fx = -s * Math.cos(pitch), fy = Math.sin(pitch), fz = -c * Math.cos(pitch);
    return { x: move.x + c * 0.36 + fx * 0.75, y: move.y + (move.crouch ? 1.0 : 1.4) + fy * 0.75, z: move.z - s * 0.36 + fz * 0.75 };
  }

  /** Crosshair gap in pixels for the current spread. */
  crosshairGap(ads) {
    const it = this.weapon;
    if (!it) return 4;
    const s = spreadFor(it.key, this.bloom, this.app.game.me.move, ads);
    const cam = this.app.gfx.camera;
    const px = (Math.tan((s * Math.PI) / 180) / Math.tan((cam.fov * Math.PI) / 360)) * (window.innerHeight / 2);
    return Math.max(2, Math.min(80, px + (WEAPONS[it.key].pellets ? 10 : 0)));
  }

  /* --------------------------------------------------------- feedback */

  onHit(msg) {
    const hm = $('hitmarker');
    hm.classList.toggle('head', msg.head);
    hm.classList.add('show');
    clearTimeout(this.hmTimer);
    this.hmTimer = setTimeout(() => hm.classList.remove('show'), 90);
    this.app.audio.hitmark(msg.head, msg.shield);
    if (msg.x === undefined) return;
    const el = document.createElement('div');
    el.className = `dmg${msg.head ? ' head' : ''}${msg.shield ? ' shield' : ''}`;
    el.textContent = msg.dmg;
    $('hud').appendChild(el);
    this.damageNumbers.push({ el, pos: new THREE.Vector3(msg.x, msg.y + 0.3, msg.z), age: 0, drift: (Math.random() - 0.5) * 30 });
  }

  frame(dt) {
    const cam = this.app.gfx.camera;
    const v = new THREE.Vector3();
    this.damageNumbers = this.damageNumbers.filter((d) => {
      d.age += dt;
      if (d.age > 0.9) { d.el.remove(); return false; }
      v.copy(d.pos).project(cam);
      if (v.z > 1) { d.el.style.opacity = 0; return true; }
      d.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * window.innerWidth + d.drift * d.age}px, ${(-v.y * 0.5 + 0.5) * window.innerHeight - d.age * 50}px) translate(-50%, -50%)`;
      d.el.style.opacity = String(Math.min(1, (0.9 - d.age) * 4));
      return true;
    });
    // Reload / heal progress.
    const bar = $('progress');
    const tick = this.app.game.serverTickNow(performance.now());
    const job = this.reload ? { label: 'Reloading', start: this.reload.end - this.reload.total, end: this.reload.end } : this.using ? { label: HEALS[this.using.key]?.name || 'Using', start: this.using.start, end: this.using.end } : null;
    if (job && tick < job.end + 2) {
      bar.hidden = false;
      bar.querySelector('span').style.transform = `scaleX(${Math.max(0, Math.min(1, (tick - job.start) / (job.end - job.start)))})`;
      bar.querySelector('b').textContent = `${job.label} ${Math.max(0, (job.end - tick) / TICK_HZ).toFixed(1)}s`;
    } else bar.hidden = true;
  }

  /* ----------------------------------------------------------- hotbar */

  buildHotbar() {
    const bar = $('hotbar');
    bar.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = i === 0 ? '<span class="icon pick"></span><em>1</em>' : `<svg viewBox="0 0 23 20"><path d=""/></svg><em>${i + 1}</em><b></b>`;
      bar.appendChild(el);
    }
    this.renderHotbar();
  }

  renderHotbar() {
    const els = $('hotbar').children;
    for (let i = 0; i < 6; i++) {
      const el = els[i];
      el.classList.toggle('active', i === this.held && this.app.build?.mode === 'weapon');
      if (i === 0) continue;
      const it = this.slots[i - 1];
      el.classList.toggle('empty', !it);
      el.style.background = it ? `linear-gradient(160deg, ${hex(RARITY_COLORS[it.rarity || 0])}cc, rgba(0,0,0,0.55))` : '';
      el.querySelector('path').setAttribute('d', it ? ICONS[WEAPONS[it.key]?.cls || it.key] || '' : '');
      el.querySelector('b').textContent = !it ? '' : WEAPONS[it.key] ? `${it.mag}` : `${it.count}`;
      el.title = it ? itemName(it) : '';
    }
    const it = this.weapon;
    $('ammo').textContent = it ? `${it.mag} / ${this.ammo[WEAPONS[it.key].ammo] || 0}` : '';
    $('ammo').hidden = !it;
    $('item-name').textContent = this.item ? itemName(this.item) : '';
    $('item-name').style.color = this.item ? hex(RARITY_COLORS[this.item.rarity || 0]) : '';
  }
}
