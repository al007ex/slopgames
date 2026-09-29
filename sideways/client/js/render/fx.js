// Tyre smoke, rubber on the road, exhaust flames, sparks and light trails.
// Everything is pooled in a few big buffers; nothing is allocated per frame.

import * as THREE from 'three';
import { smoke as smokeTexture, tread as treadTexture, glow as glowTexture } from './textures.js';

const V3 = THREE.Vector3;

// ------------------------------------------------------------------ smoke

const SMOKE_VERT = `
  attribute vec3 iPos;
  attribute vec4 iData;   // size, alpha, rotation, tile
  attribute vec3 iColor;
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vTile;

#include <fog_pars_vertex>

  void main() {
    vUv = uv; vColor = iColor; vTile = iData.w;
    vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    float c = cos(iData.z), s = sin(iData.z);
    vec2 p = mat2(c, s, -s, c) * position.xy * iData.x;
    mvPosition.xy += p;
    // Fade out when right against the lens, so a cloud never blanks the screen.
    vAlpha = iData.y * smoothstep(0.6, 3.5, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;

#include <fog_vertex>

  }`;
const SMOKE_FRAG = `
  uniform sampler2D map;
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vTile;

#include <fog_pars_fragment>

  void main() {
    vec2 uv = vUv * 0.5 + vec2(mod(vTile, 2.0), floor(vTile / 2.0)) * 0.5;
    float a = texture2D(map, uv).a * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);

#include <fog_fragment>

  }`;

class Smoke {
  constructor(scene, max = 1800) {
    this.max = max;
    this.p = [];
    for (let i = 0; i < max; i++) this.p.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 1, grow: 1, alpha: 1, rot: 0, spin: 0, tile: 0, r: 1, g: 1, b: 1, d: 0 });
    this.next = 0;
    const geo = new THREE.InstancedBufferGeometry();
    geo.copy(new THREE.PlaneGeometry(1, 1));
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.data = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.pos);
    geo.setAttribute('iData', this.data);
    geo.setAttribute('iColor', this.col);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: smokeTexture() } }]),
      vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG,
      transparent: true, depthWrite: false, fog: true,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.order = [];
  }

  emit(x, y, z, vx, vy, vz, size, life, alpha, light) {
    const p = this.p[this.next];
    this.next = (this.next + 1) % this.max;
    Object.assign(p, { alive: true, x, y, z, vx, vy, vz, age: 0, life, size, grow: size * (2.6 + Math.random() * 1.6), alpha, rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.6, tile: Math.floor(Math.random() * 4) });
    p.r = light.r; p.g = light.g; p.b = light.b;
  }

  update(dt, camera) {
    const cam = camera.position;
    const order = this.order;
    order.length = 0;
    for (const p of this.p) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; continue; }
      const drag = Math.exp(-1.6 * dt);
      p.vx *= drag; p.vz *= drag; p.vy = p.vy * Math.exp(-0.8 * dt) + 0.12 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;
      p.d = (p.x - cam.x) ** 2 + (p.y - cam.y) ** 2 + (p.z - cam.z) ** 2;
      order.push(p);
    }
    order.sort((a, b) => b.d - a.d);
    const P = this.pos.array, D = this.data.array, C = this.col.array;
    for (let i = 0; i < order.length; i++) {
      const p = order[i], t = p.age / p.life;
      const size = p.size + (p.grow - p.size) * (1 - (1 - t) * (1 - t));
      const a = p.alpha * Math.min(1, p.age * 6) * (1 - t) * (1 - t);
      P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
      D[i * 4] = size; D[i * 4 + 1] = a; D[i * 4 + 2] = p.rot; D[i * 4 + 3] = p.tile;
      C[i * 3] = p.r; C[i * 3 + 1] = p.g; C[i * 3 + 2] = p.b;
    }
    this.mesh.geometry.instanceCount = order.length;
    this.pos.needsUpdate = this.data.needsUpdate = this.col.needsUpdate = true;
    this.pos.clearUpdateRanges(); this.pos.addUpdateRange(0, order.length * 3);
    this.data.clearUpdateRanges(); this.data.addUpdateRange(0, order.length * 4);
    this.col.clearUpdateRanges(); this.col.addUpdateRange(0, order.length * 3);
  }

  get count() { return this.mesh.geometry.instanceCount; }

  clear() { for (const p of this.p) p.alive = false; }
}

// ------------------------------------------------------------- skid marks

class Skids {
  constructor(scene, max = 9000) {
    this.max = max;
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.uv = new THREE.BufferAttribute(new Float32Array(max * 4 * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.alpha = new THREE.BufferAttribute(new Float32Array(max * 4), 1).setUsage(THREE.DynamicDrawUsage);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('uv', this.uv);
    geo.setAttribute('alpha', this.alpha);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: treadTexture() } }]),
      vertexShader: `attribute float alpha; varying float vA; varying vec2 vUv;
#include <fog_pars_vertex>

        void main() { vA = alpha; vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
      fragmentShader: `uniform sampler2D map; varying float vA; varying vec2 vUv;
#include <fog_pars_fragment>

        void main() { float a = texture2D(map, vUv).a * vA; gl_FragColor = vec4(0.012, 0.012, 0.014, a);
#include <fog_fragment>
}`,
      transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.trails = new Map();
    this.dirty = [Infinity, -1];
  }

  /** Continue wheel `id`'s mark to (x, y) (sim coords) with half-width `hw`. */
  mark(id, x, y, hw, a) {
    const tr = this.trails.get(id);
    if (a <= 0.01) { if (tr) this.trails.delete(id); return; }
    if (!tr) { this.trails.set(id, { x, y, a, v: 0, has: false }); return; }
    const dx = x - tr.x, dy = y - tr.y, len = Math.hypot(dx, dy);
    if (len < 0.35) return;
    if (len > 3) { tr.x = x; tr.y = y; tr.has = false; return; }
    const nx = -dy / len * hw, ny = dx / len * hw;
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const P = this.pos.array, U = this.uv.array, A = this.alpha.array;
    const ax1 = tr.has ? tr.lx : tr.x + nx, ay1 = tr.has ? tr.ly : tr.y + ny;
    const ax2 = tr.has ? tr.rx : tr.x - nx, ay2 = tr.has ? tr.ry : tr.y - ny;
    P.set([ax1, 0.022, -ay1, ax2, 0.022, -ay2, x + nx, 0.022, -(y + ny), x - nx, 0.022, -(y - ny)], i * 12);
    U.set([0, tr.v, 1, tr.v, 0, tr.v + len / 3, 1, tr.v + len / 3], i * 8);
    A.set([tr.a || a, tr.a || a, a, a], i * 4);
    tr.v += len / 3;
    tr.x = x; tr.y = y; tr.a = a; tr.has = true;
    tr.lx = x + nx; tr.ly = y + ny; tr.rx = x - nx; tr.ry = y - ny;
    this.dirty[0] = Math.min(this.dirty[0], i); this.dirty[1] = Math.max(this.dirty[1], i);
  }

  lift(id) { this.trails.delete(id); }

  flush() {
    const [a, b] = this.dirty;
    if (b < 0) return;
    for (const [attr, k] of [[this.pos, 12], [this.uv, 8], [this.alpha, 4]]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(a * k, (b - a + 1) * k);
      attr.needsUpdate = true;
    }
    this.dirty = [Infinity, -1];
  }

  clear() {
    this.pos.array.fill(0); this.alpha.array.fill(0);
    for (const attr of [this.pos, this.alpha]) { attr.clearUpdateRanges(); attr.needsUpdate = true; }
    this.trails.clear();
  }
}

// ------------------------------------------------------------------ flames

const FLAME_FRAG = `
  uniform float time; uniform float power; uniform float seed;
  varying vec2 vUv;
  float h(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    float along = vUv.y;              // 0 at the tip of the pipe, 1 at the end of the flame
    float across = abs(vUv.x - 0.5) * 2.0;
    float flick = 0.75 + 0.25 * sin(time * 90.0 + seed * 7.0 + along * 12.0);
    float body = (1.0 - smoothstep(0.0, 1.0 - along * 0.8, across)) * (1.0 - along) * flick;
    vec3 core = vec3(0.5, 0.65, 1.0) * 1.6;
    vec3 mid = vec3(1.0, 0.55, 0.15) * 1.4;
    vec3 tip = vec3(1.0, 0.25, 0.05) * 0.9;
    vec3 c = mix(core, mid, smoothstep(0.05, 0.3, along));
    c = mix(c, tip, smoothstep(0.45, 1.0, along));
    gl_FragColor = vec4(c * body * power, body * power);
  }`;

class Flames {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.light = new THREE.PointLight('#ff8a3d', 0, 9, 2);
    scene.add(this.light);
    this.time = { value: 0 };
  }

  attach(group, points) {
    for (const f of this.list) f.mesh.removeFromParent();
    this.list = [];
    for (const p of points) {
      const geo = new THREE.PlaneGeometry(0.34, 1.4, 1, 6).translate(0, -0.7, 0).rotateZ(Math.PI / 2);
      // Cross two planes so it reads from any angle.
      const geo2 = geo.clone().rotateX(Math.PI / 2);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, u); }
      const uv2 = geo2.attributes.uv;
      for (let i = 0; i < uv2.count; i++) { const u = uv2.getX(i), v = uv2.getY(i); uv2.setXY(i, v, u); }
      const mat = new THREE.ShaderMaterial({
        uniforms: { time: this.time, power: { value: 0 }, seed: { value: Math.random() * 10 } },
        vertexShader: `varying vec2 vUv; void main() { vUv = vec2(uv.y, 1.0 - uv.x); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: FLAME_FRAG,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      });
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(geo, mat), new THREE.Mesh(geo2, mat));
      mesh.position.copy(p);
      group.add(mesh);
      this.list.push({ mesh, mat, power: 0, len: 1 });
    }
  }

  fire(size) {
    for (const f of this.list) { f.power = Math.max(f.power, Math.min(1, 0.45 + size * 0.45)); f.len = 0.6 + size * (0.7 + Math.random() * 0.8); }
    this.flash = Math.max(this.flash || 0, size);
  }

  update(dt, root) {
    this.time.value += dt;
    let any = 0;
    for (const f of this.list) {
      f.power *= Math.exp(-dt * 16);
      if (f.power < 0.02) f.power = 0;
      f.mat.uniforms.power.value = f.power;
      f.mesh.scale.set(f.len * (0.85 + Math.random() * 0.3), 1 + f.power * 0.3, 1 + f.power * 0.3);
      f.mesh.visible = f.power > 0;
      any = Math.max(any, f.power);
    }
    this.flash = (this.flash || 0) * Math.exp(-dt * 18);
    this.light.intensity = this.flash * 5;
    if (this.list.length && root) this.list[0].mesh.getWorldPosition(this.light.position);
    return any;
  }
}

// ------------------------------------------------------------------ sparks

class Sparks {
  constructor(scene, max = 300) {
    this.max = max;
    this.p = Array.from({ length: max }, () => ({ alive: false }));
    this.next = 0;
    const geo = new THREE.BoxGeometry(1, 0.03, 0.03).translate(0.5, 0, 0);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb060').multiplyScalar(5), toneMapped: false }), max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.dir = new V3();
    this.x = new V3(1, 0, 0);
  }

  burst(x, y, z, nx, nz, vx, vz, n, power) {
    for (let i = 0; i < n; i++) {
      const p = this.p[this.next];
      this.next = (this.next + 1) % this.max;
      const s = (2 + Math.random() * 6) * power;
      Object.assign(p, { alive: true, x, y, z, vx: vx * 0.5 + (nx + (Math.random() - 0.5) * 1.4) * s, vy: 1 + Math.random() * 4 * power, vz: vz * 0.5 + (nz + (Math.random() - 0.5) * 1.4) * s, age: 0, life: 0.25 + Math.random() * 0.5 });
    }
  }

  update(dt) {
    let n = 0;
    for (const p of this.p) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age > p.life) { p.alive = false; continue; }
      p.vy -= 12 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.4; p.vx *= 0.7; p.vz *= 0.7; }
      this.dir.set(p.vx, p.vy, p.vz);
      const len = Math.min(this.dir.length() * 0.035, 0.8) * (1 - p.age / p.life);
      this.q.setFromUnitVectors(this.x, this.dir.normalize());
      this.m.compose(new V3(p.x, p.y, p.z), this.q, new V3(len, 1, 1));
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------ light trails

class Trails {
  constructor(scene, samples = 48) {
    this.n = samples;
    this.lines = [];
    for (let k = 0; k < 2; k++) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(samples * 2 * 3), a = new Float32Array(samples * 2);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('alpha', new THREE.BufferAttribute(a, 1).setUsage(THREE.DynamicDrawUsage));
      const idx = [];
      for (let i = 0; i < samples - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      geo.setIndex(idx);
      const mat = new THREE.ShaderMaterial({
        vertexShader: `attribute float alpha; varying float vA; void main() { vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying float vA; void main() { gl_FragColor = vec4(vec3(1.0, 0.08, 0.12) * 2.2 * vA, vA); }`,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.lines.push({ mesh, hist: [] });
    }
  }

  push(k, p, width, strength) {
    const L = this.lines[k];
    L.hist.unshift({ x: p.x, y: p.y, z: p.z, s: strength });
    if (L.hist.length > this.n) L.hist.pop();
    const pos = L.mesh.geometry.attributes.position.array, al = L.mesh.geometry.attributes.alpha.array;
    for (let i = 0; i < this.n; i++) {
      const h = L.hist[Math.min(i, L.hist.length - 1)] || p;
      const f = 1 - i / this.n;
      pos.set([h.x, h.y + width, h.z, h.x, h.y - width, h.z], i * 6);
      al[i * 2] = al[i * 2 + 1] = (h.s || 0) * f * f * 0.5;
    }
    L.mesh.geometry.attributes.position.needsUpdate = true;
    L.mesh.geometry.attributes.alpha.needsUpdate = true;
  }

  clear() { for (const L of this.lines) L.hist.length = 0; }
}

// -------------------------------------------------------------------- all

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new Smoke(scene);
    this.skids = new Skids(scene);
    this.flames = new Flames(scene);
    this.sparks = new Sparks(scene);
    this.trails = new Trails(scene);
    this.glow = glowTexture(64, 2);
    this.tmp = new V3();
    this.light = { r: 1, g: 1, b: 1 };
    this.smokeScale = 1;
  }

  clear() { this.smoke.clear(); this.skids.clear(); this.trails.clear(); }

  update(dt, camera) {
    this.smoke.update(dt, camera);
    this.skids.flush();
    this.sparks.update(dt);
  }
}
