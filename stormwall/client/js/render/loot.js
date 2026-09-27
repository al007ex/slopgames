// Loot on the client: items floating over the floor with a beam in their
// rarity colour, chests that glow and hum, and ammo boxes. The chest hum is a
// gameplay signal — you hear it through walls and floors, positioned in 3D, so
// you can find a chest you cannot see.

import * as THREE from 'three';
import { RARITY_COLORS, WEAPONS, itemKey, isWeapon, isAmmo, isMaterial } from '#shared/items.js';
import { itemModel } from './weapons.js';
import { mat } from './avatars.js';

const SHOW_DIST = 90;
const HUM_DIST = 28;
const AMMO_COLORS = { light: 0x9ad8ff, medium: 0x5fd35a, heavy: 0xff8a3a, rockets: 0xd84a4a };
const MAT_COLORS = { wood: 0xb07a44, stone: 0x9a6a5a, metal: 0x8ea2b0 };

export class LootRenderer {
  constructor(scene, audio) {
    this.scene = scene;
    this.audio = audio;
    this.items = new Map();
    this.chests = new Map();
    this.beamGeo = new THREE.CylinderGeometry(0.05, 0.14, 3.2, 8, 1, true);
    this.ringGeo = new THREE.RingGeometry(0.35, 0.55, 20);
    this.beamMats = RARITY_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.chestGeo = chestGeometry();
    this.lidGeo = new THREE.BoxGeometry(1.0, 0.18, 0.62);
    this.chestMat = new THREE.MeshLambertMaterial({ color: 0xd8a236, emissive: 0x4a3000 });
    this.boxMat = new THREE.MeshLambertMaterial({ color: 0x4f7a3a, emissive: 0x0e1a08 });
    this.openMat = new THREE.MeshLambertMaterial({ color: 0x6a5a3a });
    this.hums = new Map();
    this.t = 0;
  }

  clear() {
    for (const o of this.items.values()) this.scene.remove(o.group);
    for (const c of this.chests.values()) this.scene.remove(c.group);
    for (const h of this.hums.values()) h.stop();
    this.items.clear(); this.chests.clear(); this.hums.clear();
  }

  applyItems(list) {
    for (const rec of list) {
      const existing = this.items.get(rec.id);
      if (!rec.alive) { if (existing) { this.scene.remove(existing.group); this.items.delete(rec.id); } continue; }
      if (existing) { existing.rec = rec; existing.group.position.set(rec.x, rec.y, rec.z); continue; }
      const key = itemKey(rec.kind);
      const group = new THREE.Group();
      let model;
      if (isAmmo(key)) { model = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.3), mat(AMMO_COLORS[key])); model.position.y = 0.35; }
      else if (isMaterial(key)) {
        model = new THREE.Group();
        for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.3), mat(MAT_COLORS[key])); b.position.set(0, 0.2 + i * 0.13, 0); b.rotation.y = i * 0.5; model.add(b); }
      } else { model = itemModel(key, rec.rarity); model.scale.setScalar(isWeapon(key) ? 1.5 : 2); model.position.y = 0.6; }
      group.add(model);
      if (isWeapon(key) || !isAmmo(key) && !isMaterial(key)) {
        const beam = new THREE.Mesh(this.beamGeo, this.beamMats[rec.rarity] || this.beamMats[0]);
        beam.position.y = 1.6;
        const ring = new THREE.Mesh(this.ringGeo, this.beamMats[rec.rarity] || this.beamMats[0]);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        group.add(beam, ring);
      }
      group.position.set(rec.x, rec.y, rec.z);
      this.scene.add(group);
      this.items.set(rec.id, { rec, key, group, model, spin: Math.random() * 6 });
    }
  }

  applyChests(list) {
    for (const rec of list) {
      let c = this.chests.get(rec.id);
      if (!rec.alive) { if (c) { this.scene.remove(c.group); this.chests.delete(rec.id); } continue; }
      if (!c) {
        const group = new THREE.Group();
        const body = new THREE.Mesh(this.chestGeo, rec.box ? this.boxMat : this.chestMat);
        const lid = new THREE.Mesh(this.lidGeo, rec.box ? this.boxMat : this.chestMat);
        lid.position.set(0, 0.62, 0.3);
        const lidPivot = new THREE.Group();
        lidPivot.position.set(0, 0, -0.31);
        lidPivot.add(lid);
        lid.position.set(0, 0.09, 0.31);
        const hinge = new THREE.Group();
        hinge.position.set(0, 0.53, 0);
        hinge.add(lidPivot);
        group.add(body, hinge);
        if (rec.box) group.scale.set(0.8, 0.75, 0.8);
        body.castShadow = lid.castShadow = true;
        group.position.set(rec.x, rec.y, rec.z);
        group.rotation.y = rec.yaw;
        this.scene.add(group);
        c = { rec, group, body, lidPivot };
        this.chests.set(rec.id, c);
      }
      c.rec = rec;
      if (rec.open) {
        c.lidPivot.rotation.x = -1.9;
        c.body.material = this.openMat;
        c.lidPivot.children[0].material = this.openMat;
        const hum = this.hums.get(rec.id);
        if (hum) { hum.stop(); this.hums.delete(rec.id); }
      }
    }
  }

  /** Bob and spin loot, hide what is far away, and keep the nearest chests humming. */
  frame(dt, cam, focus) {
    this.t += dt;
    for (const o of this.items.values()) {
      const dx = o.rec.x - cam.x, dz = o.rec.z - cam.z;
      const visible = dx * dx + dz * dz < SHOW_DIST * SHOW_DIST;
      o.group.visible = visible;
      if (!visible) continue;
      o.model.rotation.y = this.t * 1.2 + o.spin;
      o.model.position.y = (isAmmo(o.key) || isMaterial(o.key) ? 0.3 : 0.6) + Math.sin(this.t * 2 + o.spin) * 0.06;
    }
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 4);
    this.chestMat.emissive.setRGB(0.28 + 0.2 * pulse, 0.18 + 0.12 * pulse, 0);
    // Hum: the three nearest closed chests within earshot.
    const near = [];
    for (const c of this.chests.values()) {
      if (c.rec.open || c.rec.box) continue;
      const d = Math.hypot(c.rec.x - focus.x, c.rec.y - focus.y, c.rec.z - focus.z);
      if (d < HUM_DIST) near.push([d, c]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const keep = new Set(near.slice(0, 3).map(([, c]) => c.rec.id));
    for (const [id, h] of this.hums) if (!keep.has(id)) { h.stop(); this.hums.delete(id); }
    for (const id of keep) if (!this.hums.has(id)) { const c = this.chests.get(id); const h = this.audio.hum?.(c.rec); if (h) this.hums.set(id, h); }
  }

  /** The item or chest you would interact with: close by and nearest the crosshair. */
  target(focus, dir) {
    let best = null, bestScore = Infinity;
    const consider = (kind, o, rec) => {
      const dx = rec.x - focus.x, dz = rec.z - focus.z, dy = rec.y + 0.4 - (focus.y + 1.2);
      const d = Math.hypot(dx, dz);
      if (d > 2.7 || Math.abs(dy) > 2.2) return;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / Math.max(0.2, Math.hypot(dx, dy, dz));
      const score = d * 0.4 + (1 - dot) * 3 + (kind === 'item' && !isWeapon(o.key) ? 0.4 : 0);
      if (score < bestScore) { bestScore = score; best = { kind, id: rec.id, o, rec }; }
    };
    for (const o of this.items.values()) if (!isAmmo(o.key) && !isMaterial(o.key)) consider('item', o, o.rec);
    for (const c of this.chests.values()) if (!c.rec.open) consider('chest', c, c.rec);
    return best;
  }
}

function chestGeometry() {
  const g = new THREE.BoxGeometry(1.0, 0.55, 0.62);
  g.translate(0, 0.275, 0);
  return g;
}

export { WEAPONS };
