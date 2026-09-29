// Everything that doesn't move: the ground, the towers and their windows,
// lamps, parked cars, the circuit with its neon-lined walls, and the harbour.
// Built once from the shared world description, merged into a handful of
// meshes so the whole city costs a few dozen draw calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asphalt, glow, kerb, tread } from './textures.js';

// Sim (x, y) → scene (x, h, −y).
const V = (x, y, h = 0) => new THREE.Vector3(x, h, -y);

const BUILDING_VERT = `
  attribute vec2 facade;
  attribute vec3 info;
  varying vec2 vFacade;
  varying vec3 vInfo;
  varying vec3 vN;

#include <fog_pars_vertex>

  void main() {
    vFacade = facade; vInfo = info; vN = normal;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

#include <fog_vertex>

  }`;

const BUILDING_FRAG = `
  uniform float time;
  varying vec2 vFacade;
  varying vec3 vInfo;
  varying vec3 vN;

#include <fog_pars_fragment>

  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float band(float lo, float hi, float x) { float w = fwidth(x) * 0.8 + 1e-4; return smoothstep(lo - w, lo + w, x) * (1.0 - smoothstep(hi - w, hi + w, x)); }
  void main() {
    float seed = vInfo.x, style = vInfo.y, roof = vInfo.z;
    vec3 base = mix(vec3(0.028, 0.03, 0.04), vec3(0.06, 0.058, 0.07), hash(vec3(seed, 1.0, 2.0)));
    if (roof > 0.5) {
      gl_FragColor = vec4(base * 0.8, 1.0);

#include <fog_fragment>

      return;
    }
    bool tower = style > 0.5 && style < 1.5;
    bool shed = style > 1.5;
    vec2 cellSize = shed ? vec2(9.0, 6.0) : tower ? vec2(2.2, 3.4) : vec2(2.9, 3.6);
    vec2 p = vFacade / cellSize;
    vec2 cell = floor(p), f = fract(p);
    float win = tower ? band(0.04, 0.96, f.x) * band(0.14, 0.86, f.y) : band(0.18, 0.82, f.x) * band(0.26, 0.8, f.y);
    if (shed) win = band(0.3, 0.7, f.x) * band(0.62, 0.78, f.y);
    float h = hash(vec3(cell, seed));
    float lit = step(tower ? 0.66 : 0.74, h);
    lit = max(lit, step(0.94, hash(vec3(cell.y, seed, 3.0))) * step(0.15, h));
    // A few windows flicker, a TV or a failing tube.
    lit *= 1.0 - step(0.985, h) * step(0.5, fract(time * (0.7 + h * 3.0) + h * 10.0));
    vec3 warm = vec3(1.0, 0.66, 0.36), cool = vec3(0.55, 0.72, 1.0);
    vec3 lc = mix(warm, cool, step(tower ? 0.5 : 0.82, hash(vec3(seed, cell.x, 9.0))));
    // Now and then a window in a colour: a neon, a screen, a party.
    float odd = hash(vec3(cell.x, cell.y, seed + 11.0));
    if (odd > 0.985) lc = vec3(1.0, 0.25, 0.4); else if (odd > 0.97) lc = vec3(0.35, 0.85, 1.0);
    lc *= 0.45 + 0.65 * hash(vec3(cell, seed + 4.0));
    vec3 glass = vec3(0.01, 0.013, 0.026) + vec3(0.018, 0.024, 0.06) * f.y * f.y;
    vec3 col = mix(base, glass, win);
    col += win * lit * lc * (tower ? 0.55 : 0.7);
    // Shop fronts along the street.
    if (!shed && vFacade.y < 4.4) {
      float shop = band(0.3, 3.6, vFacade.y) * band(0.06, 0.94, fract(vFacade.x / 7.0));
      float open = step(0.7, hash(vec3(floor(vFacade.x / 7.0), seed, 7.0)));
      vec3 sc = mix(vec3(1.0, 0.7, 0.4), vec3(0.9, 0.95, 1.0), hash(vec3(floor(vFacade.x / 7.0), seed, 8.0)));
      col = mix(col, vec3(0.01, 0.011, 0.016), shop);
      col += shop * open * sc * 0.16 * (0.4 + 0.6 * smoothstep(0.3, 3.6, vFacade.y));
    }
    col *= 0.75 + 0.25 * abs(vN.x);
    gl_FragColor = vec4(col, 1.0);

#include <fog_fragment>

  }`;

export class City {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = { value: 0 };
    this.textures = { asphalt: asphalt(30), road: asphalt(36), concrete: asphalt(58), glow: glow(128, 1.8), kerb: kerb(), tread: tread() };
    this.lampGlow = [];
    this.ground();
    this.buildings();
    this.lamps();
    this.parked();
    this.markings();
    this.circuit();
    this.harbour();
    this.pit();
    this.skyline();
  }

  add(mesh) { this.group.add(mesh); return mesh; }

  // ---------------------------------------------------------------- ground
  ground() {
    const w = this.world, B = w.bounds;
    const tex = this.textures.asphalt;
    tex.repeat.set((B.x1 - B.x0 + 400) / 9, (B.y1 - B.y0 + 400) / 9);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(B.x1 - B.x0 + 400, B.y1 - B.y0 + 400),
      new THREE.MeshStandardMaterial({ map: tex, color: '#8a8c96', roughness: 0.88, metalness: 0.0 }));
    base.rotation.x = -Math.PI / 2;
    base.position.set((B.x0 + B.x1) / 2, 0, -(B.y0 + B.y1) / 2);
    this.add(base);

    // Sidewalks: raised slabs round every block, with a pale kerb edge.
    const slabs = [];
    for (const s of w.sidewalks) {
      const g = new THREE.BoxGeometry(s.x1 - s.x0, 0.08, s.y1 - s.y0);
      g.translate((s.x0 + s.x1) / 2, 0.04, -(s.y0 + s.y1) / 2);
      slabs.push(g);
    }
    const ct = this.textures.concrete.clone();
    ct.needsUpdate = true;
    ct.repeat.set(1 / 6, 1 / 6);
    const walk = this.add(new THREE.Mesh(mergeGeometries(slabs), new THREE.MeshStandardMaterial({ color: '#3a3b44', roughness: 0.92 })));
    walk.receiveShadow = false;

    // The car park, a shade lighter.
    const cp = w.carpark;
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(cp.x1 - cp.x0, cp.y1 - cp.y0), new THREE.MeshStandardMaterial({ map: this.textures.road, color: '#9a9ca6', roughness: 0.85 }));
    lot.rotation.x = -Math.PI / 2;
    lot.position.set((cp.x0 + cp.x1) / 2, 0.01, -(cp.y0 + cp.y1) / 2);
    this.add(lot);
  }

  // ------------------------------------------------------------- buildings
  buildings() {
    const pos = [], nor = [], fac = [], info = [], idx = [];
    const quad = (a, b, c, d, n, fa, fb, fc, fd, inf) => {
      const i = pos.length / 3;
      for (const [p, f] of [[a, fa], [b, fb], [c, fc], [d, fd]]) { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); fac.push(f[0], f[1]); info.push(...inf); }
      idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    };
    const box = (b, seedOffset = 0) => {
      const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y - b.d / 2, y1 = b.y + b.d / 2, h = b.h;
      const s = (b.seed % 997) + seedOffset, st = b.style;
      // South, east, north, west faces (sim y = scene −z).
      quad(V(x0, y0), V(x1, y0), V(x1, y0, h), V(x0, y0, h), new THREE.Vector3(0, 0, 1), [0, 0], [b.w, 0], [b.w, h], [0, h], [s, st, 0]);
      quad(V(x1, y0), V(x1, y1), V(x1, y1, h), V(x1, y0, h), new THREE.Vector3(1, 0, 0), [0, 0], [b.d, 0], [b.d, h], [0, h], [s + 1, st, 0]);
      quad(V(x1, y1), V(x0, y1), V(x0, y1, h), V(x1, y1, h), new THREE.Vector3(0, 0, -1), [0, 0], [b.w, 0], [b.w, h], [0, h], [s + 2, st, 0]);
      quad(V(x0, y1), V(x0, y0), V(x0, y0, h), V(x0, y1, h), new THREE.Vector3(-1, 0, 0), [0, 0], [b.d, 0], [b.d, h], [0, h], [s + 3, st, 0]);
      quad(V(x0, y0, h), V(x1, y0, h), V(x1, y1, h), V(x0, y1, h), new THREE.Vector3(0, 1, 0), [0, 0], [0, 0], [0, 0], [0, 0], [s, st, 1]);
    };
    for (const b of this.world.buildings) box(b);
    this.buildingBox = box;
    this.buildingMesh = this.add(this.makeBuildingMesh(pos, nor, fac, info, idx));

    // Aviation lights on the tallest towers, blinking in turn.
    const tall = this.world.buildings.filter((b) => b.h > 60);
    const geo = new THREE.SphereGeometry(0.5, 8, 6);
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: this.time },
      vertexShader: `attribute float phase; varying float vP; void main() { vP = phase; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float time; varying float vP; void main() { float on = step(0.82, fract(time * 0.8 + vP)); gl_FragColor = vec4(vec3(3.0, 0.15, 0.1) * (0.08 + on), 1.0); }`,
    });
    const inst = new THREE.InstancedMesh(geo, mat, tall.length);
    const phase = new Float32Array(tall.length);
    const m = new THREE.Matrix4();
    tall.forEach((b, i) => { m.makeTranslation(b.x + b.w * 0.3, b.h + 0.6, -(b.y + b.d * 0.3)); inst.setMatrixAt(i, m); phase[i] = (i * 0.37) % 1; });
    geo.setAttribute('phase', new THREE.InstancedBufferAttribute(phase, 1));
    this.add(inst);

    // Neon signs at street level: plain bars of colour, the minimal version.
    const neon = ['#ff3d5a', '#3de0ff', '#b86bff', '#ffd34d', '#ff8a3d', '#4dff9d'];
    const signs = this.world.buildings.filter((b, i) => b.style !== 2 && b.h > 18 && i % 3 === 0);
    const sg = new THREE.BoxGeometry(1, 1, 1);
    const smat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const si = new THREE.InstancedMesh(sg, smat, signs.length);
    const col = new THREE.Color();
    signs.forEach((b, i) => {
      const side = b.seed % 4;
      const vertical = b.seed % 3 === 0;
      const w = vertical ? 0.5 : Math.min(b.w * 0.5, 9), h = vertical ? 5 + (b.seed % 5) : 0.45;
      const y = vertical ? 6 + h / 2 : 5.2;
      const along = ((b.seed >> 3) % 100) / 100 - 0.5;
      let x = b.x, z = -b.y, ry = 0;
      if (side === 0) { z = -(b.y - b.d / 2) + 0.3; x += along * b.w * 0.6; }
      else if (side === 1) { x = b.x + b.w / 2 + 0.3; z += along * b.d * 0.6; ry = Math.PI / 2; }
      else if (side === 2) { z = -(b.y + b.d / 2) - 0.3; x += along * b.w * 0.6; }
      else { x = b.x - b.w / 2 - 0.3; z += along * b.d * 0.6; ry = Math.PI / 2; }
      m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(w, h, 0.15));
      si.setMatrixAt(i, m);
      si.setColorAt(i, col.set(neon[b.seed % neon.length]).multiplyScalar(2.4));
    });
    this.add(si);
  }

  makeBuildingMesh(pos, nor, fac, info, idx) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('facade', new THREE.Float32BufferAttribute(fac, 2));
    g.setAttribute('info', new THREE.Float32BufferAttribute(info, 3));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 } }]),
      vertexShader: BUILDING_VERT,
      fragmentShader: BUILDING_FRAG,
      fog: true,
    });
    mat.uniforms.time = this.time;
    return new THREE.Mesh(g, mat);
  }

  // ----------------------------------------------------------------- lamps
  lamps() {
    const lamps = this.world.lamps;
    const pole = new THREE.CylinderGeometry(0.08, 0.13, 7.6, 6);
    pole.translate(0, 3.8, 0);
    const arm = new THREE.BoxGeometry(2.2, 0.1, 0.1);
    arm.translate(1.0, 7.5, 0);
    const poles = new THREE.InstancedMesh(mergeGeometries([pole, arm]), new THREE.MeshStandardMaterial({ color: '#23252c', roughness: 0.6, metalness: 0.5 }), lamps.length);
    const headG = new THREE.BoxGeometry(0.9, 0.12, 0.34);
    headG.translate(2.0, 7.42, 0);
    const heads = new THREE.InstancedMesh(headG, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc58a').multiplyScalar(5), toneMapped: false }), lamps.length);
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.textures.glow, color: new THREE.Color('#ffae63').multiplyScalar(0.34), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), lamps.length);
    pools.renderOrder = 2;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    lamps.forEach((l, i) => {
      // The arm reaches over the road (the lamp's angle points into the street).
      q.setFromAxisAngle(up, l.angle);
      m.compose(V(l.x, l.y), q, new THREE.Vector3(1, 1, 1));
      poles.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
      const hx = l.x + Math.cos(l.angle) * 2, hy = l.y + Math.sin(l.angle) * 2;
      m.compose(V(hx, hy, 0.03), new THREE.Quaternion(), new THREE.Vector3(17, 1, 17));
      pools.setMatrixAt(i, m);
      this.lampGlow.push({ x: hx, y: hy });
    });
    this.add(poles); this.add(heads); this.add(pools);
  }

  // ------------------------------------------------------------ parked cars
  parked() {
    const cars = this.world.parked;
    const body = new THREE.BoxGeometry(4.3, 0.62, 1.78); body.translate(0, 0.62, 0);
    const cabin = new THREE.BoxGeometry(2.2, 0.52, 1.52); cabin.translate(-0.25, 1.18, 0);
    const paint = (g, c) => { const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    paint(body, [1, 1, 1]); paint(cabin, [0.08, 0.09, 0.11]);
    const wheels = [];
    for (const [x, z] of [[1.35, 0.8], [1.35, -0.8], [-1.35, 0.8], [-1.35, -0.8]]) {
      const w = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10); w.rotateX(Math.PI / 2); w.translate(x, 0.33, z); wheels.push(paint(w, [0.03, 0.03, 0.03]));
    }
    const tail = new THREE.BoxGeometry(0.05, 0.12, 1.5); tail.translate(-2.16, 0.78, 0); paint(tail, [0.4, 0.02, 0.03]);
    const geo = mergeGeometries([body, cabin, ...wheels, tail]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.35 });
    const inst = new THREE.InstancedMesh(geo, mat, cars.length);
    const palette = ['#1b1c22', '#d7d8dc', '#6d737d', '#7a1520', '#1c2f5c', '#2a2d33', '#b8b2a4', '#3d4a3a'];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    cars.forEach((p, i) => {
      q.setFromAxisAngle(up, p.angle);
      m.compose(V(p.x, p.y), q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, c.set(palette[p.color % palette.length]));
    });
    this.add(inst);
  }

  // -------------------------------------------------------------- markings
  markings() {
    const white = [], yellow = [];
    for (const k of this.world.markings) {
      const g = new THREE.PlaneGeometry(k.w, k.h);
      g.rotateX(-Math.PI / 2);
      if (k.angle) g.rotateY(k.angle);
      g.translate(k.x, 0.025, -k.y);
      (k.color === 1 ? yellow : white).push(g);
    }
    const mk = (list, color) => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.06, polygonOffset: true, polygonOffsetFactor: -2 });
      this.add(new THREE.Mesh(mergeGeometries(list), mat));
    };
    mk(white, '#d9d8d2');
    mk(yellow, '#e0b53a');
  }

  // --------------------------------------------------------------- circuit
  circuit() {
    const t = this.world.track, n = t.nodes.length;
    const ribbon = (inner, outer, h, vScale = 1 / 8, fn = null) => {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= n; i++) {
        const nd = t.nodes[i % n];
        const a = typeof inner === 'function' ? inner(nd, i % n) : inner;
        const b = typeof outer === 'function' ? outer(nd, i % n) : outer;
        pos.push(nd.x + nd.nx * a, h, -(nd.y + nd.ny * a), nd.x + nd.nx * b, h, -(nd.y + nd.ny * b));
        uv.push(0, i * 2 * vScale, 1, i * 2 * vScale);
        if (i < n && (!fn || fn(i))) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      // Winding depends on which side is which; make every normal point up.
      const nrm = g.attributes.normal;
      for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
      return g;
    };
    const road = this.textures.road.clone(); road.needsUpdate = true; road.repeat.set(2, 1);
    this.add(new THREE.Mesh(ribbon(t.half + t.wallGap, -(t.half + t.wallGap), 0.02), new THREE.MeshStandardMaterial({ map: road, color: '#a4a6b0', roughness: 0.82, side: THREE.DoubleSide })));
    // White edge lines.
    const lineMat = new THREE.MeshStandardMaterial({ color: '#e8e6df', roughness: 0.5, emissive: '#e8e6df', emissiveIntensity: 0.08, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    this.add(new THREE.Mesh(ribbon(t.half - 0.2, t.half - 0.45, 0.035), lineMat));
    this.add(new THREE.Mesh(ribbon(-t.half + 0.2, -t.half + 0.45, 0.035), lineMat));

    // Kerbs on the inside of every corner, and paint marking the outer zones.
    const inCorner = new Uint8Array(n), zone = new Uint8Array(n);
    for (const c of t.clips) {
      if (c.kind === 'inner') for (let k = -22; k <= 22; k++) inCorner[(c.index + k + n) % n] = c.side > 0 ? 1 : 2;
      else for (let i = c.from; i !== (c.to + 1) % n; i = (i + 1) % n) zone[i] = c.side > 0 ? 1 : 2;
    }
    const kt = this.textures.kerb;
    const kerbMat = new THREE.MeshStandardMaterial({ map: kt, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 });
    this.add(new THREE.Mesh(ribbon(t.half + 0.2, t.half - 1.3, 0.04, 1 / 4, (i) => inCorner[i] === 1), kerbMat));
    this.add(new THREE.Mesh(ribbon(-t.half - 0.2, -t.half + 1.3, 0.04, 1 / 4, (i) => inCorner[i] === 2), kerbMat));
    const zoneMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#3de0ff').multiplyScalar(0.5), transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    this.add(new THREE.Mesh(ribbon(t.half + t.wallGap - 0.2, t.half - 0.6, 0.045, 1 / 8, (i) => zone[i] === 1), zoneMat));
    this.add(new THREE.Mesh(ribbon(-t.half - t.wallGap + 0.2, -t.half + 0.6, 0.045, 1 / 8, (i) => zone[i] === 2), zoneMat));
    // Apex markers.
    const apexMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3d5a').multiplyScalar(1.4), transparent: true, opacity: 0.5, depthWrite: false });
    for (const c of t.clips) if (c.kind === 'inner') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2, 32).rotateX(-Math.PI / 2), apexMat);
      ring.position.set(c.cx, 0.05, -c.cy);
      this.add(ring);
    }

    // Start / finish: a chequered band.
    const f = t.finish;
    const cq = document.createElement('canvas'); cq.width = 64; cq.height = 8;
    const cg = cq.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { cg.fillStyle = (i + j) % 2 ? '#111' : '#eee'; cg.fillRect(i * 4, j * 4, 4, 4); }
    const ctex = new THREE.CanvasTexture(cq); ctex.magFilter = THREE.NearestFilter; ctex.colorSpace = THREE.SRGBColorSpace;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(t.width, 1.6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: ctex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 }));
    line.position.set(f.x, 0.045, -f.y);
    line.rotation.y = Math.atan2(f.ny, f.nx);
    this.add(line);

    // Concrete walls with a neon strip along the top: cyan outside, red inside.
    for (const [list, color] of [[t.walls.left, '#3de0ff'], [t.walls.right, '#ff3d5a']]) {
      const pieces = [], strips = [];
      for (let i = 0; i < list.length; i++) {
        const [x1, y1] = list[i], [x2, y2] = list[(i + 1) % list.length];
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        if (color === '#3de0ff' && Math.abs(mx) < 14 && my > -130) continue; // the paddock gate
        const len = Math.hypot(x2 - x1, y2 - y1) + 0.05, ang = Math.atan2(y2 - y1, x2 - x1);
        const g = new THREE.BoxGeometry(len, 1.05, 0.7); g.rotateY(ang); g.translate(mx, 0.525, -my); pieces.push(g);
        const s = new THREE.BoxGeometry(len, 0.05, 0.14); s.rotateY(ang); s.translate(mx, 1.075, -my); strips.push(s);
      }
      this.add(new THREE.Mesh(mergeGeometries(pieces), new THREE.MeshStandardMaterial({ color: '#5d5f66', roughness: 0.9 })));
      this.add(new THREE.Mesh(mergeGeometries(strips), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.3), toneMapped: false })));
    }

    // Infield: the ground inside the loop.
    const inner = t.nodes.map((nd) => new THREE.Vector2(nd.x - nd.nx * (t.half + t.wallGap + 0.3), nd.y - nd.ny * (t.half + t.wallGap + 0.3)));
    const infield = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(inner)), new THREE.MeshStandardMaterial({ color: '#0b1410', roughness: 1 }));
    infield.rotation.x = -Math.PI / 2;
    infield.position.y = 0.015;
    this.add(infield);

    // Floodlight towers round the outside.
    const towers = [];
    for (let i = 0; i < n; i += 55) {
      const nd = t.nodes[i];
      const side = nd.curv > 0 ? -1 : 1; // outside of the bend
      const off = side * (t.half + t.wallGap + 6);
      towers.push({ x: nd.x + nd.nx * off, y: nd.y + nd.ny * off, face: Math.atan2(-nd.ny * side, -nd.nx * side) });
    }
    const tg = new THREE.CylinderGeometry(0.25, 0.4, 20, 6); tg.translate(0, 10, 0);
    const tm = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ color: '#2a2c33', roughness: 0.7 }), towers.length);
    const hg = new THREE.BoxGeometry(0.3, 0.8, 2.2); hg.translate(0, 20.3, 0);
    const hm = new THREE.InstancedMesh(hg, new THREE.MeshBasicMaterial({ color: new THREE.Color('#e9f1ff').multiplyScalar(2.2), toneMapped: false }), towers.length);
    const pm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.textures.glow, color: new THREE.Color('#cfdcff').multiplyScalar(0.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), towers.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    towers.forEach((tw, i) => {
      q.setFromAxisAngle(up, tw.face);
      m.compose(V(tw.x, tw.y), q, new THREE.Vector3(1, 1, 1));
      tm.setMatrixAt(i, m); hm.setMatrixAt(i, m);
      m.compose(V(tw.x + Math.cos(tw.face) * 14, tw.y + Math.sin(tw.face) * 14, 0.05), new THREE.Quaternion(), new THREE.Vector3(46, 1, 46));
      pm.setMatrixAt(i, m);
      this.lampGlow.push({ x: tw.x, y: tw.y, big: true });
    });
    this.add(tm); this.add(hm); this.add(pm);
  }

  // --------------------------------------------------------------- harbour
  harbour() {
    const w = this.world, H = w.harbor;
    // Concrete underfoot round the circuit.
    const ct = this.textures.concrete.clone(); ct.needsUpdate = true;
    ct.repeat.set((H.x1 - H.x0) / 10, (H.y1 - H.y0) / 10);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(H.x1 - H.x0, H.y1 - H.y0), new THREE.MeshStandardMaterial({ map: ct, color: '#6d6f78', roughness: 0.95 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set((H.x0 + H.x1) / 2, 0.005, -(H.y0 + H.y1) / 2);
    this.add(pad);
    // The paddock, asphalt again.
    const P = w.paddock;
    const pd = new THREE.Mesh(new THREE.PlaneGeometry(P.x1 - P.x0 + 30, P.y1 - P.y0 + 14), new THREE.MeshStandardMaterial({ map: this.textures.road, color: '#8a8c96', roughness: 0.88 }));
    pd.rotation.x = -Math.PI / 2;
    pd.position.set((P.x0 + P.x1) / 2, 0.008, -(P.y0 + P.y1) / 2);
    this.add(pd);

    // The fence and the sea beyond it.
    const fence = [];
    for (const b of w.barriers) {
      const len = Math.hypot(b.x2 - b.x1, b.y2 - b.y1), ang = Math.atan2(b.y2 - b.y1, b.x2 - b.x1);
      const g = new THREE.BoxGeometry(len, b.kind === 'fence' ? 2.4 : 1.1, b.kind === 'fence' ? 0.4 : 1);
      g.rotateY(ang); g.translate((b.x1 + b.x2) / 2, b.kind === 'fence' ? 1.2 : 0.55, -(b.y1 + b.y2) / 2);
      fence.push(g);
    }
    this.add(new THREE.Mesh(mergeGeometries(fence), new THREE.MeshStandardMaterial({ color: '#3b3d45', roughness: 0.8 })));
    const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 1400), new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 } }]),
      fog: true,
      vertexShader: `varying vec3 vW;
#include <fog_pars_vertex>

        void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
      fragmentShader: `uniform float time; varying vec3 vW;
#include <fog_pars_fragment>

        float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 p = vW.xz * 0.35;
          vec2 cell = floor(p + vec2(time * 0.3, 0.0));
          float s = step(0.992, h(cell)) * (0.5 + 0.5 * sin(time * 3.0 + h(cell + 3.0) * 20.0));
          vec3 c = vec3(0.01, 0.014, 0.03) + vec3(0.9, 0.7, 0.5) * s * 0.8;
          gl_FragColor = vec4(c, 1.0);

#include <fog_fragment>

        }`,
    }));
    water.material.uniforms.time = this.time;
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.4, -(H.y0 - 700));
    this.add(water);

    // Containers in the paddock, stacked.
    const cols = ['#8c2b25', '#2c4f7a', '#3f6b45', '#b07a2a'];
    const cg = new THREE.BoxGeometry(12.2, 2.6, 2.44);
    const cm = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.3 });
    const count = w.containers.reduce((a, c) => a + c.stack, 0);
    const ci = new THREE.InstancedMesh(cg, cm, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    let k = 0;
    for (const box of w.containers) for (let s = 0; s < box.stack; s++) {
      q.setFromAxisAngle(up, box.angle + (s % 2) * 0.03);
      m.compose(V(box.x, box.y, 1.3 + s * 2.6), q, new THREE.Vector3(1, 1, 1));
      ci.setMatrixAt(k, m); ci.setColorAt(k, c.set(cols[(box.color + s) % 4])); k++;
    }
    this.add(ci);

    // Two dockside cranes, for the skyline.
    for (const [x, y] of [[-150, -655], [210, -660]]) {
      const legs = [];
      for (const [dx, dy] of [[-6, -4], [6, -4], [-6, 4], [6, 4]]) { const g = new THREE.BoxGeometry(1.2, 30, 1.2); g.translate(x + dx, 15, -(y + dy)); legs.push(g); }
      const beam = new THREE.BoxGeometry(3, 3, 80); beam.translate(x, 32, -(y - 20)); legs.push(beam);
      const cab = new THREE.BoxGeometry(6, 5, 6); cab.translate(x, 28, -y); legs.push(cab);
      this.add(new THREE.Mesh(mergeGeometries(legs), new THREE.MeshStandardMaterial({ color: '#2d2f38', roughness: 0.7 })));
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a1a').multiplyScalar(4), toneMapped: false }));
      light.position.set(x, 34, -(y - 58));
      this.add(light);
    }

    // The roundabout: a grassy island with a lit obelisk.
    const R = w.roundabout;
    const island = new THREE.Mesh(new THREE.CylinderGeometry(R.island, R.island + 0.3, 0.3, 48), new THREE.MeshStandardMaterial({ color: '#16241a', roughness: 1 }));
    island.position.set(R.x, 0.15, -R.y);
    this.add(island);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R.island + 0.15, 0.18, 6, 64).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#c9c7c0', roughness: 0.6 }));
    ring.position.set(R.x, 0.2, -R.y);
    this.add(ring);
    const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.6, 22, 4), new THREE.MeshStandardMaterial({ color: '#1c1d22', roughness: 0.5, metalness: 0.4 }));
    obelisk.position.set(R.x, 11, -R.y);
    this.add(obelisk);
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3d5a').multiplyScalar(4), toneMapped: false }));
    tip.position.set(R.x, 22.6, -R.y);
    this.add(tip);
  }

  // ------------------------------------------------------------------ pit
  pit() {
    // Old rubber: the Pit has seen a few nights like this one.
    const P = this.world.pit;
    const mat = new THREE.MeshBasicMaterial({ map: this.textures.tread, color: '#000000', transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    let s = 3;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 16; i++) {
      const rad = 3 + r() * 7, cx = P.x + (r() - 0.5) * 22, cy = P.y + (r() - 0.5) * 22;
      for (const off of [-0.8, 0.8]) {
        const g = new THREE.RingGeometry(rad + off - 0.13, rad + off + 0.13, 64, 1, r() * 6, 2 + r() * 4.2);
        g.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(g, mat);
        mesh.position.set(cx, 0.03 + i * 0.0005, -cy);
        mesh.renderOrder = 1;
        this.add(mesh);
      }
    }
  }

  // --------------------------------------------------------------- skyline
  skyline() {
    // Far towers beyond the city, so the horizon isn't empty.
    const pos = [], nor = [], fac = [], info = [], idx = [];
    let s = 9;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const far = [];
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, d = 900 + r() * 700;
      const x = 20 + Math.cos(a) * d, y = 300 + Math.sin(a) * d;
      if (y < -500) continue;
      far.push({ x, y, w: 30 + r() * 50, d: 30 + r() * 50, h: 40 + r() * 200 * (y > 0 ? 1 : 0.4), style: r() < 0.4 ? 1 : 0, seed: Math.floor(r() * 1e9) });
    }
    const quad = (a, b, c, d, n, fa, fb, fc, fd, inf) => {
      const i0 = pos.length / 3;
      for (const [p, f] of [[a, fa], [b, fb], [c, fc], [d, fd]]) { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); fac.push(f[0], f[1]); info.push(...inf); }
      idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    };
    for (const b of far) {
      const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y - b.d / 2, y1 = b.y + b.d / 2, h = b.h, sd = b.seed % 997, st = b.style;
      quad(V(x0, y0), V(x1, y0), V(x1, y0, h), V(x0, y0, h), new THREE.Vector3(0, 0, 1), [0, 0], [b.w, 0], [b.w, h], [0, h], [sd, st, 0]);
      quad(V(x1, y0), V(x1, y1), V(x1, y1, h), V(x1, y0, h), new THREE.Vector3(1, 0, 0), [0, 0], [b.d, 0], [b.d, h], [0, h], [sd + 1, st, 0]);
      quad(V(x1, y1), V(x0, y1), V(x0, y1, h), V(x1, y1, h), new THREE.Vector3(0, 0, -1), [0, 0], [b.w, 0], [b.w, h], [0, h], [sd + 2, st, 0]);
      quad(V(x0, y1), V(x0, y0), V(x0, y0, h), V(x0, y1, h), new THREE.Vector3(-1, 0, 0), [0, 0], [b.d, 0], [b.d, h], [0, h], [sd + 3, st, 0]);
    }
    this.add(this.makeBuildingMesh(pos, nor, fac, info, idx));
  }

  update(dt) {
    this.time.value += dt;
  }

  /** The `n` light sources nearest a point (for the moving point lights). */
  nearestLamps(x, y, n, out) {
    out.length = 0;
    for (const l of this.lampGlow) {
      const d = (l.x - x) ** 2 + (l.y - y) ** 2;
      if (d > 90 * 90) continue;
      out.push({ l, d });
    }
    out.sort((a, b) => a.d - b.d);
    out.length = Math.min(out.length, n);
    return out;
  }
}
