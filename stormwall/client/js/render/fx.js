// Short-lived effects: chips flying off what you hit, dust when something
// breaks, tracers and muzzle flashes, and the weak-point marker.

import * as THREE from 'three';

const MAT_CHIP = [0xb07a44, 0x9a8f86, 0xa8b4bc, 0x7a6a50, 0xb02020];

export class Particles {
  constructor(scene, capacity = 900) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.capacity = capacity;
    this.items = [];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.c = new THREE.Color();
    scene.add(this.mesh);
  }

  burst(x, y, z, { count = 8, color = 0xffffff, speed = 4, size = 0.12, life = 0.7, up = 2, gravity = 14 } = {}) {
    for (let i = 0; i < count; i++) {
      if (this.items.length >= this.capacity) this.items.shift();
      const a = Math.random() * Math.PI * 2, e = Math.random() * 0.9;
      this.items.push({
        x, y, z, vx: Math.cos(a) * Math.cos(e) * speed * (0.4 + Math.random()), vy: up + Math.sin(e) * speed * Math.random(),
        vz: Math.sin(a) * Math.cos(e) * speed * (0.4 + Math.random()), life, age: 0, size: size * (0.6 + Math.random() * 0.8),
        color, spin: Math.random() * 10, gravity,
      });
    }
  }

  chips(x, y, z, mat, weak = false) {
    this.burst(x, y, z, { count: weak ? 14 : 8, color: MAT_CHIP[mat] ?? 0xffffff, speed: weak ? 5 : 3.5 });
    if (weak) this.burst(x, y, z, { count: 6, color: 0x7fd4ff, speed: 3, size: 0.08, life: 0.4, gravity: 2 });
  }

  update(dt) {
    let n = 0;
    const keep = [];
    for (const it of this.items) {
      it.age += dt;
      if (it.age >= it.life) continue;
      it.vy -= it.gravity * dt;
      it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      const k = 1 - it.age / it.life;
      this.e.set(it.spin * it.age, it.spin * 0.7 * it.age, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(it.x, it.y, it.z), this.q, this.s.setScalar(it.size * (0.4 + 0.6 * k)));
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, this.c.set(it.color));
      n++;
      keep.push(it);
    }
    this.items = keep;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** The glowing weak-point marker: a ring on the struck surface that pulses. */
export class WeakMarker {
  constructor(scene) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.34, 24), new THREE.MeshBasicMaterial({ color: 0x6fd6ff, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), new THREE.MeshBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
    this.group = new THREE.Group();
    this.group.add(ring, dot);
    this.group.renderOrder = 5;
    ring.renderOrder = dot.renderOrder = 5;
    this.group.visible = false;
    this.t = 0;
    scene.add(this.group);
  }

  show(w) {
    if (!w || w.x === undefined) { this.group.visible = false; return; }
    this.group.visible = true;
    this.group.position.set(w.x + (w.nx || 0) * 0.03, w.y + (w.ny || 0) * 0.03, w.z + (w.nz || 0) * 0.03);
    this.group.lookAt(w.x + (w.nx || 0), w.y + (w.ny || 0), w.z + (w.nz || 0));
    this.t = 0;
  }

  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;
    const pulse = 1 + Math.sin(this.t * 9) * 0.12;
    this.group.scale.setScalar(Math.min(1, this.t * 8) * pulse);
    this.group.children[0].rotation.z += dt * 2.5;
    if (this.t > 6) this.group.visible = false;
  }
}
