// Cheap juice: tracers, impact sparks, screen shake. Pooled so a firefight
// never allocates. Deliberately small — a few particles and a shake function
// carry most of the feel.

import * as THREE from 'three';

const MAX_PARTICLES = 220;
const MAX_TRACERS = 28;

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.trauma = 0;
    this.time = 0;

    // ---- particles: one instanced mesh for the whole game
    this.particles = [];
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95 });
    this.pMesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES);
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pMesh.frustumCulled = false;
    this.pMesh.count = MAX_PARTICLES;
    this.pColor = new THREE.Color();
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 0.1, grav: 1 });
      this.pMesh.setColorAt(i, this.pColor.setRGB(1, 1, 1));
    }
    scene.add(this.pMesh);

    // ---- tracers: one LineSegments for all of them
    this.tracers = [];
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_TRACERS * 6), 3));
    tGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_TRACERS * 6), 3));
    this.tMesh = new THREE.LineSegments(tGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }));
    this.tMesh.frustumCulled = false;
    scene.add(this.tMesh);
    for (let i = 0; i < MAX_TRACERS; i++) this.tracers.push({ life: 0 });

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  // -------------------------------------------------------------- emitters

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  freeParticle() {
    for (let i = 0; i < MAX_PARTICLES; i++) if (this.particles[i].life <= 0) return i;
    return -1;
  }

  burst(point, color, count = 8, speed = 5, size = 0.09, spread = null, life = 0.42) {
    for (let n = 0; n < count; n++) {
      const i = this.freeParticle();
      if (i < 0) return;
      const p = this.particles[i];
      p.life = life * (0.6 + Math.random() * 0.7);
      p.max = p.life;
      p.size = size * (0.7 + Math.random() * 0.8);
      p.grav = 1;
      p.pos.set(point[0], point[1], point[2]);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      if (spread) dir.add(new THREE.Vector3(spread[0], spread[1], spread[2]).multiplyScalar(1.1)).normalize();
      p.vel.copy(dir).multiplyScalar(speed * (0.4 + Math.random()));
      this.pColor.set(color);
      this.pMesh.setColorAt(i, this.pColor);
    }
    if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;
  }

  impact(point, normal, color = 0xdfe6f0) {
    this.burst(point, color, 7, 4.5, 0.075, normal, 0.35);
  }

  bloodHit(point, head) {
    this.burst(point, head ? 0xffb038 : 0xd8443a, head ? 14 : 9, 6, 0.1, null, 0.4);
  }

  death(point, color) {
    this.burst([point[0], point[1] + 0.9, point[2]], color, 22, 7, 0.16, null, 0.7);
  }

  tracer(from, to, color = 0xffd9a0) {
    let idx = -1;
    for (let i = 0; i < MAX_TRACERS; i++) if (this.tracers[i].life <= 0) { idx = i; break; }
    if (idx < 0) idx = 0;
    const t = this.tracers[idx];
    t.life = 0.075;
    t.max = 0.075;

    const pos = this.tMesh.geometry.attributes.position;
    const col = this.tMesh.geometry.attributes.color;
    pos.setXYZ(idx * 2, from[0], from[1], from[2]);
    pos.setXYZ(idx * 2 + 1, to[0], to[1], to[2]);
    const c = new THREE.Color(color);
    col.setXYZ(idx * 2, c.r, c.g, c.b);
    col.setXYZ(idx * 2 + 1, c.r, c.g, c.b);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  // ---------------------------------------------------------------- update

  update(dt) {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.9);

    let dirty = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (p.life <= 0) {
        this._m.makeScale(0, 0, 0);
        this.pMesh.setMatrixAt(i, this._m);
        continue;
      }
      p.life -= dt;
      p.vel.y -= 15 * p.grav * dt;
      p.vel.multiplyScalar(1 - Math.min(1, dt * 2.2));
      p.pos.addScaledVector(p.vel, dt);
      const k = Math.max(0, p.life / p.max);
      const s = p.size * (0.35 + k * 0.65);
      this._m.compose(p.pos, this._q.identity(), this._s.set(s, s, s));
      this.pMesh.setMatrixAt(i, this._m);
      dirty = true;
    }
    this.pMesh.instanceMatrix.needsUpdate = true;
    if (!dirty) this.pMesh.instanceMatrix.needsUpdate = true;

    let anyTracer = false;
    for (let i = 0; i < MAX_TRACERS; i++) {
      const t = this.tracers[i];
      if (t.life <= 0) continue;
      t.life -= dt;
      anyTracer = true;
      if (t.life <= 0) {
        const pos = this.tMesh.geometry.attributes.position;
        pos.setXYZ(i * 2, 0, -9999, 0);
        pos.setXYZ(i * 2 + 1, 0, -9999, 0);
        pos.needsUpdate = true;
      }
    }
    this.tMesh.visible = anyTracer;
  }

  /** Applied to the camera after look rotation. */
  applyShake(camera) {
    if (this.trauma <= 0.001) return;
    const t = this.trauma * this.trauma;
    const n = this.time * 34;
    camera.position.x += Math.sin(n * 1.7) * t * 0.22;
    camera.position.y += Math.sin(n * 2.3 + 1.4) * t * 0.22;
    camera.rotation.z += Math.sin(n * 1.9 + 0.7) * t * 0.05;
  }
}
