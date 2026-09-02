// Viewmodels, ammo, reload and the local half of shooting.
//
// Shots are hitscan. The client raycasts only to draw a tracer immediately; the
// server re-casts the same ray and is the only thing that decides damage.

import * as THREE from 'three';
import { WEAPONS, WEAPON_ORDER } from '#shared/constants.js';

function mk(w, h, d, color, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  );
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

// Every viewmodel is built with its origin at the REAR of the weapon and the
// barrel running toward -z. Anything that pokes behind the origin ends up
// inside the camera's near plane and fills the screen.

function buildRifle() {
  const g = new THREE.Group();
  g.add(mk(0.09, 0.075, 0.22, 0x22262d, 0, -0.03, -0.11));   // stock
  g.add(mk(0.085, 0.10, 0.50, 0x2f343d, 0, 0, -0.47));       // body
  g.add(mk(0.055, 0.055, 0.28, 0x1c2027, 0, 0.012, -0.86));  // barrel
  g.add(mk(0.07, 0.17, 0.10, 0x3b424e, 0, -0.13, -0.40));    // magazine
  g.add(mk(0.05, 0.05, 0.05, 0xff8c1a, 0, 0.075, -0.62));    // front sight
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, -1.02);
  g.add(muzzle);
  return { group: g, muzzle, scale: 0.55, hip: [0.19, -0.17, -0.30], ads: [0, -0.088, -0.26] };
}

function buildShotgun() {
  const g = new THREE.Group();
  g.add(mk(0.10, 0.09, 0.20, 0x3b2b20, 0, -0.03, -0.10));
  g.add(mk(0.10, 0.13, 0.40, 0x4a382a, 0, 0, -0.40));
  g.add(mk(0.062, 0.062, 0.36, 0x30353d, -0.026, 0.03, -0.68));
  g.add(mk(0.062, 0.062, 0.36, 0x30353d, 0.026, 0.03, -0.68));
  g.add(mk(0.085, 0.06, 0.14, 0x22262d, 0, -0.072, -0.52));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, -0.88);
  g.add(muzzle);
  return { group: g, muzzle, scale: 0.58, hip: [0.20, -0.18, -0.30], ads: [0, -0.094, -0.26] };
}

function buildSword() {
  const g = new THREE.Group();
  g.add(mk(0.08, 0.08, 0.06, 0xc9a04a, 0, 0, -0.03));        // pommel
  g.add(mk(0.055, 0.055, 0.24, 0x4a3524, 0, 0, -0.18));      // grip
  g.add(mk(0.30, 0.05, 0.07, 0x8a6a3a, 0, 0, -0.33));        // guard
  g.add(mk(0.075, 0.022, 1.00, 0xd8dee8, 0, 0, -0.87));      // blade
  g.add(mk(0.028, 0.03, 0.97, 0xf2f6fb, 0, 0.001, -0.87));   // fuller
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -1.38);
  g.add(muzzle);
  return { group: g, muzzle, scale: 0.5, hip: [0.23, -0.20, -0.28], ads: [0.13, -0.16, -0.26] };
}

export class Weapons {
  constructor(vmScene, fx) {
    this.fx = fx;
    this.root = new THREE.Group();
    vmScene.add(this.root);

    this.models = {
      rifle: buildRifle(),
      shotgun: buildShotgun(),
      sword: buildSword(),
    };
    for (const k of WEAPON_ORDER) {
      const m = this.models[k];
      m.group.visible = false;
      m.group.scale.setScalar(m.scale);
      this.root.add(m.group);
    }

    // muzzle flash quad, reparented to whichever muzzle is firing
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.34),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthTest: false, blending: THREE.AdditiveBlending }),
    );
    this.flash.renderOrder = 950;
    this.flashTime = 0;

    // sword arc
    this.trail = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 1.15, 20, 1, 0, Math.PI * 0.7),
      new THREE.MeshBasicMaterial({ color: 0xdfe9ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthTest: false, blending: THREE.AdditiveBlending }),
    );
    this.trail.position.set(0.1, -0.1, -0.75);
    this.trail.renderOrder = 940;
    this.root.add(this.trail);
    this.trailTime = 0;

    this.ammo = {
      rifle: { mag: WEAPONS.rifle.mag, reserve: WEAPONS.rifle.reserve },
      shotgun: { mag: WEAPONS.shotgun.mag, reserve: WEAPONS.shotgun.reserve },
    };
    this.current = 'rifle';
    this.cooldown = 0;
    this.reloading = 0;
    this.reloadTotal = 0;
    this.swingTime = 0;
    this.punch = { x: 0, y: 0 };
    this.sway = { x: 0, y: 0 };
    this.bobT = 0;
    this.aiming = false;
    this.blocking = false;

    this.setWeapon('rifle');
  }

  get def() { return WEAPONS[this.current]; }
  get isGun() { return this.def.kind === 'gun'; }
  get mag() { return this.isGun ? this.ammo[this.current].mag : Infinity; }
  get reserve() { return this.isGun ? this.ammo[this.current].reserve : Infinity; }
  get reloadFrac() { return this.reloadTotal ? 1 - this.reloading / this.reloadTotal : 0; }

  setWeapon(id) {
    if (!WEAPONS[id] || this.current === id && this.models[id].group.visible) return;
    this.current = id;
    this.reloading = 0;
    this.cooldown = Math.max(this.cooldown, 0.18);
    for (const k of WEAPON_ORDER) this.models[k].group.visible = k === id;
    const m = this.models[id];
    if (this.flash.parent) this.flash.parent.remove(this.flash);
    m.muzzle.add(this.flash);
    this.trail.visible = id === 'sword';
  }

  refillAll() {
    for (const k of ['rifle', 'shotgun']) {
      this.ammo[k].mag = WEAPONS[k].mag;
      this.ammo[k].reserve = WEAPONS[k].reserve;
    }
    this.reloading = 0;
  }

  startReload() {
    if (!this.isGun || this.reloading > 0) return;
    const a = this.ammo[this.current];
    if (a.mag >= this.def.mag || a.reserve <= 0) return;
    this.reloading = this.def.reload;
    this.reloadTotal = this.def.reload;
  }

  finishReload() {
    const a = this.ammo[this.current];
    const need = this.def.mag - a.mag;
    const take = Math.min(need, a.reserve);
    a.mag += take;
    a.reserve -= take;
  }

  /** Cone of unit directions around `dir`. */
  spreadDirs(dir, spread, pellets) {
    const out = [];
    const base = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    const up = Math.abs(base.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(base, up).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, base).normalize();
    for (let i = 0; i < pellets; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      const v = base.clone()
        .addScaledVector(right, Math.cos(a) * r)
        .addScaledVector(realUp, Math.sin(a) * r)
        .normalize();
      out.push([v.x, v.y, v.z]);
    }
    return out;
  }

  /**
   * @param hitTest (origin, dir, range) => point[]  — for the local tracer only
   * @returns action to forward to the server, or null
   */
  update(dt, input, player, opts) {
    const canAct = opts.canAct !== false;
    this.cooldown -= dt;
    this.flashTime -= dt;
    this.trailTime -= dt;
    this.swingTime -= dt;

    this.flash.material.opacity = this.flashTime > 0 ? Math.min(1, this.flashTime * 22) : 0;
    if (this.flashTime > 0) {
      this.flash.rotation.z = Math.random() * Math.PI;
      const s = 0.7 + Math.random() * 0.6;
      this.flash.scale.set(s, s, s);
    }
    this.trail.material.opacity = this.trailTime > 0 ? Math.min(0.8, this.trailTime * 6) : 0;
    if (this.trailTime > 0) this.trail.rotation.z = -2.2 + (1 - this.trailTime / 0.2) * 3.0;

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { this.reloading = 0; this.finishReload(); }
    }

    this.aiming = canAct && input.aim && this.isGun;
    this.blocking = canAct && input.aim && !this.isGun;

    let action = null;
    if (canAct) {
      if (input.reloadPressed) this.startReload();

      const wantsFire = this.def.auto ? input.fire : input.firePressed;
      if (wantsFire && this.cooldown <= 0 && this.reloading <= 0) {
        action = this.isGun ? this.fireGun(player, opts) : this.swing(player);
      }
      if (this.isGun && this.mag <= 0 && this.reloading <= 0 && input.fire) this.startReload();
    }

    this.animate(dt, player, input);
    return action;
  }

  fireGun(player, opts) {
    const a = this.ammo[this.current];
    if (a.mag <= 0) { this.cooldown = 0.14; return null; }
    const w = this.def;
    a.mag--;
    this.cooldown = 60 / w.rpm;
    this.flashTime = 0.05;

    const origin = player.eyePos;
    const spread = this.aiming ? w.adsSpread : w.spread;
    const dirs = this.spreadDirs(player.lookDir, spread, w.pellets);

    // Local-only tracer preview. The muzzle lives in the viewmodel scene, whose
    // coordinates are camera-local, so the tracer starts from the eye instead.
    const look = player.lookDir;
    const from = [
      origin[0] + look[0] * 0.9,
      origin[1] + look[1] * 0.9 - 0.12,
      origin[2] + look[2] * 0.9,
    ];
    for (const d of dirs) {
      const end = opts.hitTest ? opts.hitTest(origin, d, w.range) : [
        origin[0] + d[0] * w.range, origin[1] + d[1] * w.range, origin[2] + d[2] * w.range,
      ];
      this.fx.tracer(from, end, this.current === 'shotgun' ? 0xffc27a : 0xffe0a8);
    }

    this.punch.y += w.recoil * 0.011;
    this.punch.x += (Math.random() - 0.5) * w.recoil * 0.007;
    this.fx.shake(w.shake);
    return { type: 'fire', weapon: this.current, origin, dirs };
  }

  swing(player) {
    const w = this.def;
    this.cooldown = 60 / w.rpm;
    this.trailTime = 0.2;
    this.swingTime = 0.22;
    this.fx.shake(w.shake);
    this.punch.y += 0.05;
    return { type: 'melee', origin: player.eyePos, dir: player.lookDir };
  }

  animate(dt, player, input) {
    const m = this.models[this.current];
    const target = this.aiming ? m.ads : m.hip;

    // recoil punch decays back to zero
    this.punch.x *= Math.max(0, 1 - dt * 9);
    this.punch.y *= Math.max(0, 1 - dt * 9);

    // sway from mouse movement, damped
    this.sway.x += (-input.dx * 0.00025 - this.sway.x) * Math.min(1, dt * 12);
    this.sway.y += (input.dy * 0.00025 - this.sway.y) * Math.min(1, dt * 12);
    this.sway.x = Math.max(-0.05, Math.min(0.05, this.sway.x));
    this.sway.y = Math.max(-0.05, Math.min(0.05, this.sway.y));

    // walk bob
    const sp = player.speed2D;
    if (player.grounded) this.bobT += dt * (4 + sp * 1.1);
    const bobAmt = this.aiming ? 0.1 : 1;
    const bobX = Math.cos(this.bobT) * 0.011 * Math.min(sp / 6, 1.4) * bobAmt;
    const bobY = Math.abs(Math.sin(this.bobT)) * 0.013 * Math.min(sp / 6, 1.4) * bobAmt;

    const swingPose = this.swingTime > 0 ? (this.swingTime / 0.22) : 0;

    const g = m.group;
    const tx = target[0] + this.sway.x + bobX;
    const ty = target[1] + this.sway.y + bobY - this.punch.y * 0.35;
    const tz = target[2] + this.punch.y * 0.9 + swingPose * 0.16;
    const k = Math.min(1, dt * 16);
    g.position.x += (tx - g.position.x) * k;
    g.position.y += (ty - g.position.y) * k;
    g.position.z += (tz - g.position.z) * k;

    const rollTarget = player.roll * 1.6 + this.sway.x * 3 - swingPose * 0.7;
    const pitchTarget = this.punch.y * 2.2 + this.sway.y * 2 + (player.sliding ? 0.12 : 0) + swingPose * 0.9;
    g.rotation.z += (rollTarget - g.rotation.z) * k;
    g.rotation.x += (pitchTarget - g.rotation.x) * k;
    g.rotation.y += ((this.blocking ? -0.55 : 0) - g.rotation.y) * k;
  }

  /** Camera-space recoil offset added after look rotation. */
  applyPunch(camera) {
    camera.rotation.x += this.punch.y * 0.55;
    camera.rotation.y += this.punch.x * 0.55;
  }
}
