// Build pieces, drawn as instances: one InstancedMesh per shape (type, facing
// and edit) and material, so thirteen thousand map pieces plus whatever players
// build cost a few dozen draw calls. Each instance's colour carries its state —
// blue while it is still building up, darker as it takes damage.

import * as THREE from 'three';
import { CELL, WALL_H } from '#shared/constants.js';
import { WALL, CONE, CONE_H, pieceBoxes, hpAt, hpCap, isBuilding, MAT_STATS } from '#shared/pieces.js';
import { merge, boxAt } from './geom.js';
import { TEXTURES } from './materials.js';

const BUILD_TINT = new THREE.Color(0.55, 0.78, 1.7);
const WHITE = new THREE.Color(1, 1, 1);

export class PieceRenderer {
  constructor(scene) {
    this.scene = scene;
    this.materials = ['wood', 'stone', 'metal'].map((name) => new THREE.MeshLambertMaterial({ map: TEXTURES[name]() }));
    this.geos = new Map();
    this.buckets = new Map();
    this.where = new Map();          // piece id → { bucket, index }
    this.animating = new Set();      // pieces still building up
    this.matrix = new THREE.Matrix4();
    this.color = new THREE.Color();
    this.tick = 0;
  }

  geometryFor(p) {
    const key = p.type === WALL ? `w${p.rot}:${p.edit}` : p.type === CONE ? `c${p.edit}` : `${p.type}:${p.rot}:${p.edit}`;
    let geo = this.geos.get(key);
    if (!geo) {
      geo = p.type === CONE ? coneGeometry(p.edit) : boxesGeometry({ ...p, cx: 0, cz: 0, lv: 0 });
      this.geos.set(key, geo);
    }
    return { key, geo };
  }

  bucketFor(p) {
    const { key, geo } = this.geometryFor(p);
    const bkey = `${key}|${p.mat}`;
    let b = this.buckets.get(bkey);
    if (!b) {
      b = { key: bkey, geo, mat: this.materials[p.mat], mesh: null, capacity: 0, ids: [] };
      this.grow(b, 64);
      this.buckets.set(bkey, b);
    }
    if (b.ids.length >= b.capacity) this.grow(b, b.capacity * 2);
    return b;
  }

  grow(b, capacity) {
    const mesh = new THREE.InstancedMesh(b.geo, b.mat, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) mesh.setColorAt(i, WHITE);
    if (b.mesh) {
      mesh.instanceMatrix.array.set(b.mesh.instanceMatrix.array.subarray(0, b.ids.length * 16));
      mesh.instanceColor.array.set(b.mesh.instanceColor.array.subarray(0, b.ids.length * 3));
      this.scene.remove(b.mesh);
      b.mesh.dispose();
    }
    mesh.count = b.ids.length;
    b.mesh = mesh;
    b.capacity = capacity;
    this.scene.add(mesh);
  }

  add(p) {
    if (this.where.has(p.id)) this.remove(p);
    const b = this.bucketFor(p);
    const index = b.ids.length;
    b.ids.push(p.id);
    this.matrix.makeTranslation(p.cx * CELL, p.lv * WALL_H, p.cz * CELL);
    b.mesh.setMatrixAt(index, this.matrix);
    b.mesh.count = b.ids.length;
    b.mesh.instanceMatrix.needsUpdate = true;
    this.where.set(p.id, { bucket: b, index });
    this.paint(p);
    if (p.start >= 0) this.animating.add(p);
  }

  remove(p) {
    const at = this.where.get(p.id);
    if (!at) return;
    const { bucket: b, index } = at;
    const last = b.ids.length - 1;
    if (index !== last) {
      const movedId = b.ids[last];
      b.ids[index] = movedId;
      b.mesh.getMatrixAt(last, this.matrix);
      b.mesh.setMatrixAt(index, this.matrix);
      b.mesh.getColorAt(last, this.color);
      b.mesh.setColorAt(index, this.color);
      this.where.get(movedId).index = index;
    }
    b.ids.pop();
    b.mesh.count = b.ids.length;
    b.mesh.instanceMatrix.needsUpdate = true;
    if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
    this.where.delete(p.id);
    this.animating.delete(p);
  }

  /** Re-shaped (edited) pieces move to the bucket for their new shape. */
  update(p) {
    const at = this.where.get(p.id);
    const { key } = this.geometryFor(p);
    if (!at || at.bucket.key !== `${key}|${p.mat}`) { this.add(p); return; }
    this.paint(p);
    if (p.start >= 0 && isBuilding(p, this.tick)) this.animating.add(p);
  }

  paint(p) {
    const at = this.where.get(p.id);
    if (!at) return;
    const max = MAT_STATS[p.mat].max;
    const cap = hpCap(p, this.tick);
    const hp = Math.max(0, hpAt(p, this.tick));
    this.color.copy(WHITE);
    if (p.start >= 0 && cap < max) this.color.lerp(BUILD_TINT, 1 - (cap - MAT_STATS[p.mat].start) / (max - MAT_STATS[p.mat].start));
    if (p.damage > 0) this.color.multiplyScalar(0.45 + 0.55 * Math.min(1, hp / max));
    at.bucket.mesh.setColorAt(at.index, this.color);
    at.bucket.mesh.instanceColor.needsUpdate = true;
  }

  /** Called every frame with the current server tick estimate. */
  frame(tick) {
    this.tick = tick;
    for (const p of this.animating) {
      this.paint(p);
      if (!isBuilding(p, tick)) this.animating.delete(p);
    }
  }
}

function boxesGeometry(p) {
  return merge(pieceBoxes(p).map((b) => {
    const axes = b.ux ? [b.ux, b.uy, b.uz] : null;
    const g = boxAt(b.hx * 2, b.hy * 2, b.hz * 2, 0, 0, 0, axes);
    g.translate(b.x, b.y, b.z);
    scaleUv(g, b);
    return { geo: g };
  }));
}

/** Texture repeats by size, so a small tile shows a small piece of the pattern. */
function scaleUv(g, b) {
  const uv = g.attributes.uv;
  const sx = Math.max(b.hx, b.hz) * 2 / CELL, sy = b.hy * 2 / WALL_H;
  const s = Math.max(0.1, Math.max(sx, sy));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s * 1.5, uv.getY(i) * s * 1.5);
}

/** A square pyramid over one cell, or the quadrants of one left by an edit. */
export function coneGeometry(edit) {
  const a = CELL / 2, h = CONE_H;
  const pos = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  // Adds a triangle wound so its face points along `out`.
  const face = (p, q, r, out) => {
    e1.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    e2.set(r[0] - p[0], r[1] - p[1], r[2] - p[2]);
    n.crossVectors(e1, e2);
    if (n.x * out[0] + n.y * out[1] + n.z * out[2] < 0) pos.push(...p, ...r, ...q);
    else pos.push(...p, ...q, ...r);
  };
  const apex = [a, h, a], mid = [a, 0, a];
  for (let q = 0; q < 4; q++) {
    if ((edit >> q) & 1) continue;
    const qx = q & 1, qz = q >> 1;
    const sx = qx ? 1 : -1, sz = qz ? 1 : -1;
    const k = [qx ? CELL : 0, 0, qz ? CELL : 0];
    const mx = [qx ? CELL : 0, 0, a], mz = [a, 0, qz ? CELL : 0];
    face(apex, mx, k, [sx * h, a, 0]);          // the x-facing roof slope
    face(apex, k, mz, [0, a, sz * h]);          // the z-facing roof slope
    face(mid, k, mx, [0, -1, 0]);               // underside
    face(mid, mz, k, [0, -1, 0]);
    if ((edit >> (q ^ 1)) & 1) face(apex, mid, mz, [-sx, 0, 0]);   // cut face towards a removed neighbour
    if ((edit >> (q ^ 2)) & 1) face(apex, mid, mx, [0, 0, -sz]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const p = g.attributes.position;
  const uv = [];
  for (let i = 0; i < p.count; i++) uv.push(p.getX(i) / CELL * 1.5, (p.getZ(i) + p.getY(i)) / CELL * 1.5);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
