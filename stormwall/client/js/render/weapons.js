// Weapon and item models, tracers, muzzle flashes, explosions and projectiles.

import * as THREE from 'three';
import { WEAPONS, HEALS, RARITY_COLORS, itemKey } from '#shared/items.js';
import { mat } from './avatars.js';

const GUN = 0x2e3238, GRIP = 0x1c1e22;

function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
function tube(r, len, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat(color));
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** A model for any item key, pointing its barrel along −z. */
export function itemModel(key, rarity = 0) {
  const g = new THREE.Group();
  const accent = RARITY_COLORS[rarity] ?? 0xffffff;
  const cls = WEAPONS[key]?.cls;
  switch (cls) {
    case 'pistol': g.add(box(0.06, 0.1, 0.26, GUN, 0, 0, -0.08), box(0.05, 0.14, 0.07, GRIP, 0, -0.1, 0.02), box(0.062, 0.02, 0.2, accent, 0, 0.05, -0.08)); break;
    case 'revolver': g.add(box(0.06, 0.09, 0.14, GUN, 0, 0, 0), tube(0.045, 0.08, GUN, 0, 0, -0.08), tube(0.02, 0.2, GUN, 0, 0.02, -0.2), box(0.05, 0.15, 0.06, 0x6a4a2a, 0, -0.1, 0.05), box(0.062, 0.015, 0.1, accent, 0, 0.055, 0)); break;
    case 'smg': g.add(box(0.07, 0.12, 0.42, GUN, 0, 0, -0.1), box(0.05, 0.18, 0.06, GRIP, 0, -0.12, 0.02), box(0.045, 0.2, 0.05, GRIP, 0, -0.12, -0.16), box(0.072, 0.02, 0.3, accent, 0, 0.065, -0.1), tube(0.018, 0.12, GUN, 0, 0.02, -0.36)); break;
    case 'ar': case 'burst': case 'scoped':
      g.add(box(0.07, 0.12, 0.62, GUN, 0, 0, -0.12), box(0.06, 0.1, 0.24, GRIP, 0, -0.02, 0.28), box(0.05, 0.2, 0.07, GRIP, 0, -0.14, -0.2), box(0.05, 0.15, 0.06, GRIP, 0, -0.11, 0.04), tube(0.02, 0.26, GUN, 0, 0.02, -0.55), box(0.072, 0.025, 0.46, accent, 0, 0.07, -0.1));
      if (cls === 'scoped') g.add(tube(0.035, 0.28, 0x111418, 0, 0.13, -0.08));
      if (cls === 'burst') g.add(box(0.074, 0.05, 0.1, accent, 0, -0.02, -0.34));
      break;
    case 'pump': case 'tactical':
      g.add(box(0.075, 0.1, 0.5, GUN, 0, 0, -0.12), tube(0.03, 0.46, GUN, 0, 0.03, -0.48), box(0.07, 0.07, 0.16, cls === 'pump' ? 0x6a4a2a : GRIP, 0, -0.04, -0.42), box(0.06, 0.12, 0.26, cls === 'pump' ? 0x6a4a2a : GRIP, 0, -0.03, 0.26), box(0.077, 0.02, 0.36, accent, 0, 0.055, -0.1));
      break;
    case 'sniper':
      g.add(box(0.07, 0.11, 0.7, 0x4a3a2a, 0, 0, -0.08), tube(0.022, 0.6, GUN, 0, 0.03, -0.7), tube(0.04, 0.34, 0x101214, 0, 0.13, -0.1), box(0.072, 0.02, 0.4, accent, 0, 0.06, 0.05), box(0.05, 0.16, 0.06, GRIP, 0, -0.1, 0.1));
      break;
    case 'rocket':
      g.add(tube(0.11, 1.1, 0x3a4a3a, 0, 0.05, -0.15), tube(0.13, 0.1, accent, 0, 0.05, -0.65), box(0.06, 0.16, 0.08, GRIP, 0, -0.1, -0.1), box(0.1, 0.08, 0.2, 0x222222, -0.1, 0.12, -0.05));
      break;
    case 'grenade':
      g.add(tube(0.1, 0.22, GUN, 0, 0, -0.05), tube(0.04, 0.44, GUN, 0, 0.02, -0.34), box(0.06, 0.16, 0.08, GRIP, 0, -0.12, 0.08), box(0.06, 0.08, 0.26, GRIP, 0, -0.02, 0.24), tube(0.105, 0.04, accent, 0, 0, -0.05));
      break;
    default:
      if (key === 'bandage') { const r = tube(0.07, 0.12, 0xf2f0e8, 0, 0, -0.05); r.rotation.z = Math.PI / 2; g.add(r); }
      else if (key === 'medkit') g.add(box(0.26, 0.16, 0.1, 0xf4f4f4, 0, 0, -0.06), box(0.14, 0.04, 0.102, 0xd02a2a, 0, 0, -0.06), box(0.04, 0.12, 0.102, 0xd02a2a, 0, 0, -0.06));
      else if (key === 'shield') g.add(tube(0.05, 0.16, 0x3fa8ff, 0, 0, -0.05), tube(0.02, 0.06, 0xdddddd, 0, 0, -0.16));
  }
  return g;
}

/** Wraps an item model for an avatar's hand (the arm points along −y). */
export function handModel(heldId, rarity) {
  const key = itemKey(heldId);
  const g = new THREE.Group();
  const m = itemModel(key, rarity);
  if (WEAPONS[key]) { m.rotation.x = -Math.PI / 2; m.position.set(0, -0.06, 0.05); }
  else if (HEALS[key]) m.position.set(0, -0.05, -0.05);
  g.add(m);
  return g;
}

export class ShotFx {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.booms = [];
    this.projectiles = new Map();
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.9 });
    this.flash = new THREE.PointLight(0xffc870, 0, 8, 2);
    scene.add(this.flash);
    this.flashT = 0;
    this.flashMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    this.flashMesh.visible = false;
    scene.add(this.flashMesh);
    this.boomGeo = new THREE.SphereGeometry(1, 16, 10);
    this.rocketGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.7, 8).rotateX(Math.PI / 2);
    this.grenadeGeo = new THREE.SphereGeometry(0.12, 8, 6);
  }

  tracer(from, to, color = 0xfff2b0) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z)]);
    const line = new THREE.Line(geo, color === 0xfff2b0 ? this.tracerMat : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    line.userData.age = 0;
    this.scene.add(line);
    this.tracers.push(line);
  }

  muzzle(p) {
    this.flash.position.set(p.x, p.y, p.z);
    this.flash.intensity = 6;
    this.flashMesh.position.set(p.x, p.y, p.z);
    this.flashMesh.visible = true;
    this.flashT = 0.05;
  }

  explosion(x, y, z, r) {
    const m = new THREE.Mesh(this.boomGeo, new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, depthWrite: false }));
    m.position.set(x, y, z);
    m.userData = { age: 0, r };
    this.scene.add(m);
    this.booms.push(m);
    this.flash.position.set(x, y + 1, z);
    this.flash.intensity = 40;
    this.flash.distance = r * 8;
    this.flashT = 0.15;
  }

  /** Replicated rockets and grenades: one mesh each, updated every snapshot. */
  setProjectiles(list) {
    const seen = new Set();
    for (const pr of list) {
      seen.add(pr.id);
      let m = this.projectiles.get(pr.id);
      if (!m) {
        const rocket = itemKey(pr.kind) === 'rocket';
        m = new THREE.Mesh(rocket ? this.rocketGeo : this.grenadeGeo, mat(rocket ? 0x6a7a6a : 0x3a4a3a, { emissive: rocket ? 0x331100 : 0 }));
        m.userData.last = new THREE.Vector3(pr.x, pr.y, pr.z);
        this.projectiles.set(pr.id, m);
        this.scene.add(m);
      }
      const last = m.userData.last;
      if (last.distanceToSquared(new THREE.Vector3(pr.x, pr.y, pr.z)) > 1e-4) m.lookAt(pr.x + (pr.x - last.x), pr.y + (pr.y - last.y), pr.z + (pr.z - last.z));
      m.position.set(pr.x, pr.y, pr.z);
      last.set(pr.x, pr.y, pr.z);
      m.userData.seen = performance.now();
    }
    for (const [id, m] of this.projectiles) if (!seen.has(id) && performance.now() - m.userData.seen > 100) { this.scene.remove(m); this.projectiles.delete(id); }
  }

  update(dt) {
    this.tracers = this.tracers.filter((l) => {
      l.userData.age += dt;
      if (l.userData.age > 0.09) { this.scene.remove(l); l.geometry.dispose(); return false; }
      return true;
    });
    this.booms = this.booms.filter((m) => {
      m.userData.age += dt;
      const t = m.userData.age / 0.45;
      if (t >= 1) { this.scene.remove(m); m.material.dispose(); return false; }
      m.scale.setScalar(m.userData.r * (0.3 + 0.9 * Math.sqrt(t)));
      m.material.opacity = 0.85 * (1 - t);
      m.material.color.setHSL(0.08 - 0.06 * t, 1, 0.6 - 0.35 * t);
      return true;
    });
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) { this.flash.intensity = 0; this.flash.distance = 8; this.flashMesh.visible = false; }
    }
    for (const m of this.projectiles.values()) if (performance.now() - m.userData.seen > 300) { this.scene.remove(m); }
  }
}
