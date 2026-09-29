// The crowd in the Pit: a ring of people with their phones up, jumping when
// something good happens and scattering when the car comes too close, or when
// the sirens start. Nobody gets run over: they're quicker than they look.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { carBox } from '#shared/collide.js';

const COUNT = 260;

export class Crowd {
  constructor(scene, pit) {
    this.pit = pit;
    this.people = [];
    let s = 42;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < COUNT; i++) {
      const a = r() * Math.PI * 2;
      const rad = pit.ring + 0.8 + Math.pow(r(), 1.6) * 7;
      this.people.push({
        hx: pit.x + Math.cos(a) * rad, hy: pit.y + Math.sin(a) * rad, a, rad,
        x: 0, y: 0, vx: 0, vy: 0, jump: 0, jumpV: 0, face: 0, phone: r() < 0.55, phase: r() * 10, height: 0.9 + r() * 0.25, calm: 1,
      });
    }
    for (const p of this.people) { p.x = p.hx; p.y = p.hy; }

    const body = new THREE.CylinderGeometry(0.2, 0.24, 1.25, 7); body.translate(0, 0.62, 0);
    const head = new THREE.SphereGeometry(0.15, 8, 6); head.translate(0, 1.42, 0);
    const col = (g, c) => { const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    col(body, [1, 1, 1]); col(head, [0.4, 0.3, 0.24]);
    this.mesh = new THREE.InstancedMesh(mergeGeometries([body, head]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), COUNT);
    this.mesh.frustumCulled = false;
    const shirts = ['#1d1f26', '#2b2e38', '#3a2226', '#23303a', '#5a5d66', '#4a4f5c', '#15161a', '#6b1d25', '#1f3b2e', '#2a2a30'];
    const c = new THREE.Color();
    this.people.forEach((p, i) => this.mesh.setColorAt(i, c.set(shirts[i % shirts.length]).multiplyScalar(0.8 + (i % 5) * 0.08)));
    scene.add(this.mesh);

    const phones = this.people.filter((p) => p.phone).length;
    this.phones = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.15, 0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color('#dfe8ff').multiplyScalar(5), toneMapped: false }), phones);
    this.phones.frustumCulled = false;
    scene.add(this.phones);

    // Police lights, for when it's over.
    this.police = [new THREE.PointLight('#ff1a2a', 0, 60, 1.2), new THREE.PointLight('#1a4dff', 0, 60, 1.2)];
    this.police[0].position.set(pit.x + 36, 3, -(pit.y + 6));
    this.police[1].position.set(pit.x - 36, 3, -(pit.y - 6));
    for (const l of this.police) scene.add(l);
    this.sirens = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    this.visible = true;
    this.hype = 0;
    this.t = 0;
  }

  /** A cheer: the nearer to the action, the higher they jump. */
  cheer(amount, near = null) {
    for (const p of this.people) {
      if (Math.random() > 0.35 + amount * 0.5) continue;
      const k = near ? Math.max(0.3, 1 - Math.hypot(p.x - near.x, p.y - near.y) / 40) : 1;
      if (p.jump <= 0.01) p.jumpV = (1.6 + Math.random() * 1.8) * k * Math.min(1.4, amount + 0.4);
    }
  }

  scatter(seconds = 7) { this.sirens = seconds; }

  update(dt, car, show) {
    this.t += dt;
    this.visible = show;
    this.mesh.visible = this.phones.visible = show;
    for (const l of this.police) l.visible = this.sirens > 0;
    if (!show) return 0;
    const box = car ? carBox(car) : null;
    let hits = 0, k = 0;
    const scatter = this.sirens > 0;
    if (scatter) {
      this.sirens -= dt;
      const on = Math.floor(this.t * 6) % 2;
      this.police[0].intensity = on ? 120 : 10;
      this.police[1].intensity = on ? 10 : 120;
    }
    // The ring tightens as the hype builds, the way a real crowd creeps in.
    const pull = this.hype * 3;
    for (let i = 0; i < this.people.length; i++) {
      const p = this.people[i];
      let tx = p.hx - Math.cos(p.a) * pull, ty = p.hy - Math.sin(p.a) * pull;
      if (scatter) { tx = this.pit.x + Math.cos(p.a) * (p.rad + 30); ty = this.pit.y + Math.sin(p.a) * (p.rad + 30); }
      let ax = (tx - p.x) * (scatter ? 3 : 1.5) - p.vx * 3, ay = (ty - p.y) * (scatter ? 3 : 1.5) - p.vy * 3;
      if (box) {
        const dx = p.x - box.x, dy = p.y - box.y, d = Math.hypot(dx, dy);
        const fast = Math.hypot(car.vx, car.vy);
        const reach = 3.2 + fast * 0.18;
        if (d < reach && d > 0.01) {
          // Step back, away from the car and out of its path.
          const push = (reach - d) * 30;
          ax += dx / d * push; ay += dy / d * push;
          if (d < 2.3) { p.jumpV = Math.max(p.jumpV, 1.5); if (d < 1.7) hits++; }
        }
      }
      p.vx += ax * dt; p.vy += ay * dt;
      const sp = Math.hypot(p.vx, p.vy), max = scatter ? 8 : 7;
      if (sp > max) { p.vx *= max / sp; p.vy *= max / sp; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.jumpV -= 12 * dt;
      p.jump = Math.max(0, p.jump + p.jumpV * dt);
      if (p.jump === 0) p.jumpV = 0;
      // Everyone faces the action.
      const look = box ? Math.atan2(box.y - p.y, box.x - p.x) : p.a + Math.PI;
      p.face += Math.atan2(Math.sin(look - p.face), Math.cos(look - p.face)) * Math.min(1, dt * 5);
      const bob = Math.sin(this.t * 3 + p.phase) * 0.03 * (0.5 + this.hype);
      this.q.setFromAxisAngle(this.up, p.face);
      this.m.compose(new THREE.Vector3(p.x, p.jump + bob, -p.y), this.q, new THREE.Vector3(1, p.height, 1));
      this.mesh.setMatrixAt(i, this.m);
      if (p.phone) {
        const up = this.hype > 0.15 || p.phase > 5;
        const h = up ? 1.75 : 1.05;
        const fx = Math.cos(p.face) * 0.28, fy = Math.sin(p.face) * 0.28;
        this.m.compose(new THREE.Vector3(p.x + fx, p.jump + h * p.height, -(p.y + fy)), this.q, new THREE.Vector3(1, 1, 1));
        this.phones.setMatrixAt(k++, this.m);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.phones.instanceMatrix.needsUpdate = true;
    return hits;
  }
}
