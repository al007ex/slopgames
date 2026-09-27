// Players drawn from boxes: legs, torso, arms, head, plus whatever they hold
// and a glider for the way down. Posed by movement mode and animated by speed.

import * as THREE from 'three';
import { OUTFITS, GLIDERS } from '#shared/cosmetics.js';
import { MODE_SKYDIVE, MODE_GLIDE, MODE_DBNO, MODE_BUS, MODE_DEAD } from '#shared/movement.js';

const mats = new Map();
export function mat(color, opts = {}) {
  const key = `${color}|${opts.emissive || 0}|${opts.transparent ? 1 : 0}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, emissive: opts.emissive || 0x000000, transparent: !!opts.transparent, opacity: opts.opacity ?? 1 });
    mats.set(key, m);
  }
  return m;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(boxGeo, material);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export class Avatar {
  constructor(outfit = 0, glider = 0) {
    this.object = new THREE.Group();
    this.body = new THREE.Group();          // everything that tilts for skydiving
    this.object.add(this.body);
    this.phase = 0;
    this.build(outfit, glider);
  }

  build(outfitId, gliderId) {
    const o = OUTFITS[outfitId] || OUTFITS[0];
    this.outfit = outfitId;
    const shirt = mat(o.shirt), pants = mat(o.pants), skin = mat(o.skin), hair = mat(o.hair), accent = mat(o.accent);
    this.body.clear();
    const legPivot = (x) => { const g = new THREE.Group(); g.position.set(x, 0.95, 0); g.add(box(0.21, 0.92, 0.24, pants, 0, -0.46, 0)); g.add(box(0.23, 0.14, 0.3, mat(0x2a2522), 0, -0.88, -0.03)); return g; };
    this.legL = legPivot(-0.12);
    this.legR = legPivot(0.12);
    this.torso = new THREE.Group();
    this.torso.position.y = 0.95;
    this.torso.add(box(0.54, 0.7, 0.3, shirt, 0, 0.35, 0));
    this.torso.add(box(0.56, 0.1, 0.32, accent, 0, 0.1, 0));
    this.torso.add(box(0.36, 0.42, 0.14, accent, 0, 0.42, 0.2));     // backpack
    const armPivot = (x) => { const g = new THREE.Group(); g.position.set(x, 0.63, 0); g.add(box(0.15, 0.62, 0.17, shirt, 0, -0.29, 0)); g.add(box(0.13, 0.12, 0.14, skin, 0, -0.63, 0)); return g; };
    this.armL = armPivot(-0.35);
    this.armR = armPivot(0.35);
    this.head = new THREE.Group();
    this.head.position.y = 0.7;
    this.head.add(box(0.3, 0.32, 0.3, skin, 0, 0.17, 0));
    this.head.add(box(0.32, 0.1, 0.32, hair, 0, 0.34, 0.01));
    this.head.add(box(0.32, 0.18, 0.08, hair, 0, 0.24, 0.13));
    this.head.add(box(0.05, 0.05, 0.02, mat(0x111111), -0.07, 0.19, -0.155));
    this.head.add(box(0.05, 0.05, 0.02, mat(0x111111), 0.07, 0.19, -0.155));
    this.torso.add(this.armL, this.armR, this.head);
    this.hand = new THREE.Group();          // what the right hand holds hangs from here
    this.hand.position.set(0, -0.62, 0);
    this.armR.add(this.hand);
    this.body.add(this.legL, this.legR, this.torso);

    const g = GLIDERS[gliderId] || GLIDERS[0];
    this.glider = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 1.3), mat(g.a));
    canopy.position.set(0, 2.9, 0);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.22, 0.09, 0.3), mat(g.b));
    stripe.position.set(0, 2.9, 0);
    this.glider.add(canopy, stripe);
    for (const x of [-1.4, 1.4]) {
      const line = box(0.02, 1.3, 0.02, mat(0x333333), x * 0.6, 2.25, 0);
      line.rotation.z = x > 0 ? 0.45 : -0.45;
      this.glider.add(line);
    }
    this.glider.visible = false;
    this.object.add(this.glider);
    this.heldKey = null;
  }

  /** Swaps what the right hand holds; `make` builds the mesh the first time. */
  hold(key, make) {
    if (key === this.heldKey) return;
    this.heldKey = key;
    this.hand.clear();
    if (key !== null && make) this.hand.add(make());
  }

  update(dt, s) {
    this.object.position.set(s.x, s.y, s.z);
    this.object.rotation.y = s.yaw;
    const visible = s.mode !== MODE_BUS && s.mode !== MODE_DEAD;
    this.object.visible = visible;
    if (!visible) return;
    const speed = s.speed || 0;
    this.phase += dt * speed * 1.9;
    const swing = Math.sin(this.phase) * Math.min(1, speed / 4.5) * 0.7;
    const body = this.body;
    body.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    this.glider.visible = s.mode === MODE_GLIDE;
    this.torso.position.y = 0.95;
    this.legL.position.y = this.legR.position.y = 0.95;
    const aiming = s.armed;
    const pitch = s.pitch || 0;

    if (s.mode === MODE_SKYDIVE) {
      body.rotation.x = -1.35;
      body.position.y = 1.0;
      this.legL.rotation.set(0.2, 0, -0.25); this.legR.rotation.set(0.2, 0, 0.25);
      this.armL.rotation.set(0, 0, -2.2); this.armR.rotation.set(0, 0, 2.2);
      return;
    }
    if (s.mode === MODE_GLIDE) {
      this.legL.rotation.set(0.15, 0, 0); this.legR.rotation.set(-0.1, 0, 0);
      this.armL.rotation.set(0, 0, -2.6); this.armR.rotation.set(0, 0, 2.6);
      return;
    }
    if (s.mode === MODE_DBNO) {
      body.rotation.x = -1.25;
      body.position.y = 0.25;
      this.legL.rotation.set(swing * 0.5, 0, 0); this.legR.rotation.set(-swing * 0.5, 0, 0);
      this.armL.rotation.set(Math.PI - 0.3 + swing * 0.6, 0, 0); this.armR.rotation.set(Math.PI - 0.3 - swing * 0.6, 0, 0);
      return;
    }
    const crouch = s.crouch ? 1 : 0;
    if (crouch) {
      this.torso.position.y = 0.62;
      this.legL.position.y = this.legR.position.y = 0.62;
      this.legL.rotation.set(0.9 + swing * 0.4, 0, 0);
      this.legR.rotation.set(0.5 - swing * 0.4, 0, 0);
    } else if (!s.ground) {
      this.legL.rotation.set(0.5, 0, 0); this.legR.rotation.set(-0.2, 0, 0);
    } else {
      this.legL.rotation.set(swing, 0, 0); this.legR.rotation.set(-swing, 0, 0);
    }
    if (s.swing > 0) {
      // A pickaxe swing: raise and chop.
      const t = s.swing;
      this.armR.rotation.set(-2.6 + t * 2.4, 0, 0.1);
      this.armL.rotation.set(-0.6, 0, 0);
    } else if (aiming) {
      this.armR.rotation.set(-Math.PI / 2 - pitch, 0, 0);
      this.armL.rotation.set(-Math.PI / 2 - pitch + 0.1, 0, 0.5);
    } else {
      this.armL.rotation.set(-swing * 0.8, 0, 0); this.armR.rotation.set(swing * 0.8, 0, 0);
    }
    this.head.rotation.x = Math.max(-0.5, Math.min(0.5, pitch * 0.5));
  }
}
