// Props, drawn as instances of one merged, vertex-coloured model per kind.
// Trees and rocks — thousands of them — are also split by region so the ones
// beyond the fog are skipped; everything else is one draw per kind.

import * as THREE from 'three';
import { PROP_KINDS, propMaxHp } from '#shared/props.js';
import { hash01 } from '#shared/rng.js';
import { merge, boxAt, cyl } from './geom.js';

const REGION = 640;
const REGIONS = 8;
const REGIONED = new Set(['pine', 'oak', 'deadtree', 'rock', 'boulder']);

const BARK = 0x6b4a2e, LEAF = 0x3f7a35, LEAF2 = 0x4d8c3a, PINE = 0x2f6a3a, GREY = 0x8a8680, DARK = 0x2a2a2e, GLASS = 0x223344;

function model(name) {
  const cone = (r, h, y) => { const g = new THREE.ConeGeometry(r, h, 7); g.translate(0, y + h / 2, 0); return g; };
  const ico = (r, x, y, z, detail = 0) => { const g = new THREE.IcosahedronGeometry(r, detail); g.translate(x, y, z); return g; };
  switch (name) {
    case 'pine': return merge([
      { geo: cyl(0.28, 0.45, 3.2, 6, 0, 0, 0), color: BARK },
      { geo: cone(2.7, 3.8, 2.2), color: PINE }, { geo: cone(2.1, 3.3, 4.3), color: PINE }, { geo: cone(1.35, 2.8, 6.4), color: 0x3a7a44 },
    ]);
    case 'oak': return merge([
      { geo: cyl(0.4, 0.6, 3.6, 6, 0, 0, 0), color: BARK },
      { geo: ico(2.9, 0, 5.4, 0), color: LEAF }, { geo: ico(2.1, 1.5, 6.3, 0.9), color: LEAF2 }, { geo: ico(1.9, -1.4, 6.0, -0.8), color: LEAF2 },
    ]);
    case 'deadtree': {
      const b1 = boxAt(0.18, 2.2, 0.18, 0, 0, 0); b1.rotateZ(0.8); b1.translate(0.7, 4, 0);
      const b2 = boxAt(0.16, 1.8, 0.16, 0, 0, 0); b2.rotateX(-0.7); b2.translate(0, 4.8, 0.5);
      return merge([{ geo: cyl(0.14, 0.35, 6, 5, 0, 0, 0), color: 0x6a5e50 }, { geo: b1, color: 0x6a5e50 }, { geo: b2, color: 0x6a5e50 }]);
    }
    case 'rock': { const g = new THREE.DodecahedronGeometry(1, 0); g.scale(1.4, 0.95, 1.2); g.translate(0, 0.95 - 0.35 * 1.9, 0); return merge([{ geo: g, color: GREY }]); }
    case 'boulder': { const g = new THREE.IcosahedronGeometry(1, 1); g.scale(2.2, 1.6, 1.9); g.translate(0, 1.6 - 0.35 * 3.2, 0); return merge([{ geo: g, color: 0x7c7872 }]); }
    case 'car': return merge([
      { geo: boxAt(4.4, 0.8, 1.9, 0, 0.55, 0), color: 0xffffff }, { geo: boxAt(2.3, 0.62, 1.72, -0.2, 1.25, 0), color: 0xffffff },
      { geo: boxAt(2.1, 0.5, 1.76, -0.2, 1.25, 0), color: GLASS },
      ...[[-1.4, -0.95], [1.4, -0.95], [-1.4, 0.95], [1.4, 0.95]].map(([x, z]) => { const g = new THREE.CylinderGeometry(0.36, 0.36, 0.25, 10); g.rotateX(Math.PI / 2); g.translate(x, 0.36, z); return { geo: g, color: DARK }; }),
    ]);
    case 'truck': return merge([
      { geo: boxAt(2.0, 2.2, 2.3, 2.3, 1.3, 0), color: 0xffffff }, { geo: boxAt(1.6, 0.8, 2.32, 2.45, 1.9, 0), color: GLASS },
      { geo: boxAt(4.4, 2.8, 2.4, -1.1, 1.6, 0), color: 0xd8d8d8 }, { geo: boxAt(6.6, 0.3, 2.2, 0, 0.45, 0), color: DARK },
    ]);
    case 'container': {
      const parts = [{ geo: boxAt(6.1, 2.6, 2.45, 0, 1.3, 0), color: 0xffffff }];
      for (let i = -2; i <= 2; i++) parts.push({ geo: boxAt(0.12, 2.5, 2.5, i * 1.3, 1.3, 0), color: 0xdddddd });
      return merge(parts);
    }
    case 'pallet': return merge([0, 0.3, 0.6].map((y) => ({ geo: boxAt(1.2, 0.12, 1.0, 0, y + 0.06, 0), color: 0xb8925a })).concat([{ geo: boxAt(1.0, 0.9, 0.8, 0, 0.45, 0), color: 0x9a7a4a }]));
    case 'haybale': { const g = new THREE.CylinderGeometry(0.78, 0.78, 1.6, 12); g.rotateZ(Math.PI / 2); g.translate(0, 0.78, 0); return merge([{ geo: g, color: 0xe0c060 }]); }
    case 'crate': return merge([{ geo: boxAt(1.1, 1.1, 1.1, 0, 0.55, 0), color: 0xb88a50 }, { geo: boxAt(1.14, 0.12, 1.14, 0, 0.55, 0), color: 0x8a6030 }]);
    case 'fence': return merge([
      { geo: boxAt(0.12, 1.1, 0.12, -1.25, 0.55, 0), color: 0x9a7a54 }, { geo: boxAt(0.12, 1.1, 0.12, 1.25, 0.55, 0), color: 0x9a7a54 },
      { geo: boxAt(2.6, 0.12, 0.06, 0, 0.85, 0), color: 0xb09068 }, { geo: boxAt(2.6, 0.12, 0.06, 0, 0.45, 0), color: 0xb09068 },
    ]);
    case 'sofa': return merge([{ geo: boxAt(2.0, 0.45, 0.9, 0, 0.25, 0), color: 0x7a4a8a }, { geo: boxAt(2.0, 0.5, 0.2, 0, 0.7, -0.35), color: 0x6a3a7a }, { geo: boxAt(0.2, 0.3, 0.9, -0.9, 0.6, 0), color: 0x6a3a7a }, { geo: boxAt(0.2, 0.3, 0.9, 0.9, 0.6, 0), color: 0x6a3a7a }]);
    case 'bed': return merge([{ geo: boxAt(2.1, 0.4, 1.6, 0, 0.2, 0), color: 0x8a6040 }, { geo: boxAt(1.9, 0.2, 1.5, 0.05, 0.5, 0), color: 0xe8e8f0 }, { geo: boxAt(0.1, 0.9, 1.6, -1.0, 0.45, 0), color: 0x7a5030 }, { geo: boxAt(0.5, 0.15, 1.3, -0.7, 0.66, 0), color: 0xffffff }]);
    case 'table': return merge([{ geo: boxAt(1.6, 0.08, 0.9, 0, 0.76, 0), color: 0xa07040 }, ...[[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]].map(([x, z]) => ({ geo: boxAt(0.08, 0.76, 0.08, x, 0.38, z), color: 0x7a5030 }))]);
    case 'chair': return merge([{ geo: boxAt(0.5, 0.06, 0.5, 0, 0.48, 0), color: 0xa07040 }, { geo: boxAt(0.5, 0.5, 0.06, 0, 0.75, -0.22), color: 0x8a5a30 }, ...[[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].map(([x, z]) => ({ geo: boxAt(0.05, 0.48, 0.05, x, 0.24, z), color: 0x7a5030 }))]);
    case 'shelf': return merge([{ geo: boxAt(1.3, 2.0, 0.08, 0, 1.0, -0.2), color: 0x8a6040 }, ...[0.05, 0.7, 1.35, 1.95].map((y) => ({ geo: boxAt(1.3, 0.06, 0.45, 0, y, 0), color: 0xa07848 })), { geo: boxAt(1.1, 0.4, 0.3, 0, 0.9, 0), color: 0x5a7aa8 }]);
    case 'fridge': return merge([{ geo: boxAt(0.8, 1.9, 0.75, 0, 0.95, 0), color: 0xe8ecef }, { geo: boxAt(0.04, 0.5, 0.04, 0.3, 1.3, 0.39), color: 0x888888 }]);
    case 'stove': return merge([{ geo: boxAt(0.8, 0.95, 0.7, 0, 0.475, 0), color: 0xdadada }, { geo: boxAt(0.6, 0.02, 0.5, 0, 0.96, 0), color: DARK }]);
    case 'washer': return merge([{ geo: boxAt(0.75, 0.95, 0.7, 0, 0.475, 0), color: 0xf2f2f2 }, { geo: new THREE.CylinderGeometry(0.22, 0.22, 0.04, 14).rotateX(Math.PI / 2).translate(0, 0.45, 0.36), color: 0x445566 }]);
    case 'toilet': return merge([{ geo: boxAt(0.4, 0.45, 0.55, 0, 0.225, 0.05), color: 0xf4f4f4 }, { geo: boxAt(0.45, 0.4, 0.2, 0, 0.6, -0.25), color: 0xf4f4f4 }]);
    case 'fireplace': return merge([{ geo: boxAt(1.6, 1.6, 0.7, 0, 0.8, 0), color: 0x9a5a48 }, { geo: boxAt(0.8, 0.7, 0.2, 0, 0.45, 0.3), color: 0x1a1210 }, { geo: boxAt(1.8, 0.12, 0.8, 0, 1.3, 0.05), color: 0x7a4a3a }]);
    case 'pump': return merge([{ geo: boxAt(0.8, 1.7, 0.5, 0, 0.85, 0), color: 0xd03a2a }, { geo: boxAt(0.6, 0.4, 0.52, 0, 1.3, 0), color: 0x223344 }]);
    case 'barrel': return merge([{ geo: cyl(0.35, 0.35, 1.0, 10, 0, 0, 0), color: 0x3a6ab0 }, { geo: cyl(0.36, 0.36, 0.06, 10, 0, 0.3, 0), color: 0x2a4a80 }]);
    case 'silo': return merge([{ geo: cyl(3, 3, 13, 14, 0, 0, 0), color: 0xc8ccd0 }, { geo: (() => { const g = new THREE.SphereGeometry(3, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2); g.translate(0, 13, 0); return g; })(), color: 0xa8aeb4 }]);
    case 'tractor': return merge([
      { geo: boxAt(2.4, 1.1, 1.4, 0.4, 1.0, 0), color: 0x3a9a3a }, { geo: boxAt(1.2, 1.2, 1.3, -0.6, 2.0, 0), color: 0x2a7a2a },
      ...[[-1.1, 0.9, 0.85], [-1.1, -0.9, 0.85], [1.2, 0.8, 0.5], [1.2, -0.8, 0.5]].map(([x, z, r]) => { const g = new THREE.CylinderGeometry(r, r, 0.4, 12); g.rotateX(Math.PI / 2); g.translate(x, r, z); return { geo: g, color: DARK }; }),
    ]);
    case 'boat': return merge([{ geo: boxAt(4.2, 0.8, 1.7, 0, 0.4, 0), color: 0xf0f0f0 }, { geo: boxAt(1.2, 0.8, 1.2, -0.6, 1.2, 0), color: 0x3a6ab0 }]);
    case 'pipe': { const g = new THREE.CylinderGeometry(0.6, 0.6, 6, 12); g.rotateZ(Math.PI / 2); g.translate(0, 0.6, 0); return merge([{ geo: g, color: 0x8a949c }]); }
    case 'tires': return merge([0, 0.37, 0.74].map((y) => { const g = new THREE.TorusGeometry(0.38, 0.17, 6, 12); g.rotateX(Math.PI / 2); g.translate(0, y + 0.18, 0); return { geo: g, color: 0x1e1e20 }; }));
    case 'lamp': return merge([{ geo: cyl(0.1, 0.15, 5.5, 6, 0, 0, 0), color: 0x44484c }, { geo: boxAt(1.2, 0.15, 0.3, 0.5, 5.5, 0), color: 0x44484c }, { geo: boxAt(0.5, 0.1, 0.25, 0.9, 5.42, 0), color: 0xfff2b0 }]);
    default: return merge([{ geo: boxAt(1, 1, 1, 0, 0.5, 0), color: 0xff00ff }]);
  }
}

const TINTS = {
  car: [0xd83a3a, 0x3a6ad8, 0xf2f2f2, 0x2a2a2a, 0xe8c83a, 0x3aa85a, 0x9aa0a8],
  truck: [0xf2f2f2, 0xd84a2a, 0x2a5aa8],
  container: [0xc83a2a, 0x2a6ab0, 0x3a9a4a, 0xe8a83a, 0x8a3ab0, 0x707880],
};

export class PropRenderer {
  constructor(scene) {
    this.scene = scene;
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.geos = new Map();
    this.buckets = new Map();
    this.where = new Map();
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.color = new THREE.Color();
  }

  bucketFor(p) {
    const name = PROP_KINDS[p.kind].name;
    const region = REGIONED.has(name) ? Math.min(REGIONS - 1, Math.floor(p.x / REGION)) + Math.min(REGIONS - 1, Math.floor(p.z / REGION)) * REGIONS : -1;
    const key = `${p.kind}|${region}`;
    let b = this.buckets.get(key);
    if (!b) {
      let geo = this.geos.get(p.kind);
      if (!geo) { geo = model(name); this.geos.set(p.kind, geo); }
      b = { key, geo, region, mesh: null, capacity: 0, ids: [], cx: ((region % REGIONS) + 0.5) * REGION, cz: (Math.floor(region / REGIONS) + 0.5) * REGION };
      this.grow(b, region >= 0 ? 256 : 64);
      this.buckets.set(key, b);
    }
    if (b.ids.length >= b.capacity) this.grow(b, b.capacity * 2);
    return b;
  }

  grow(b, capacity) {
    const mesh = new THREE.InstancedMesh(b.geo, this.material, capacity);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Regional buckets are compact enough to cull by their instances' bounds.
    mesh.frustumCulled = b.region >= 0;
    b.dirty = true;
    for (let i = 0; i < capacity; i++) mesh.setColorAt(i, this.color.set(1, 1, 1));
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
    if (this.where.has(p.id)) return;
    const b = this.bucketFor(p);
    const index = b.ids.length;
    b.ids.push(p.id);
    const s = p.s || 1;
    this.q.setFromAxisAngle(this.up, p.yaw || 0);
    this.m.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.set(s, s, s));
    b.mesh.setMatrixAt(index, this.m);
    b.mesh.count = b.ids.length;
    b.mesh.instanceMatrix.needsUpdate = true;
    b.dirty = true;
    this.where.set(p.id, { bucket: b, index });
    this.paint(p);
  }

  paint(p) {
    const at = this.where.get(p.id);
    if (!at) return;
    const name = PROP_KINDS[p.kind].name;
    const tints = TINTS[name];
    if (tints) this.color.set(tints[Math.floor(hash01(p.id, 9) * tints.length)]);
    else this.color.set(1, 1, 1).multiplyScalar(0.88 + hash01(p.id, 4) * 0.24);
    if (p.hp !== undefined) this.color.multiplyScalar(0.45 + 0.55 * Math.max(0, p.hp) / propMaxHp(p));
    at.bucket.mesh.setColorAt(at.index, this.color);
    at.bucket.mesh.instanceColor.needsUpdate = true;
  }

  remove(p) {
    const at = this.where.get(p.id);
    if (!at) return;
    const { bucket: b, index } = at;
    const last = b.ids.length - 1;
    if (index !== last) {
      const moved = b.ids[last];
      b.ids[index] = moved;
      b.mesh.getMatrixAt(last, this.m); b.mesh.setMatrixAt(index, this.m);
      b.mesh.getColorAt(last, this.color); b.mesh.setColorAt(index, this.color);
      this.where.get(moved).index = index;
    }
    b.ids.pop();
    b.mesh.count = b.ids.length;
    b.mesh.instanceMatrix.needsUpdate = true;
    b.mesh.instanceColor.needsUpdate = true;
    this.where.delete(p.id);
  }

  /** Hides regions of trees and rocks that are beyond the fog. */
  cull(camera, far) {
    const lim = (far + REGION) * (far + REGION);
    for (const b of this.buckets.values()) {
      if (b.region < 0) continue;
      const dx = b.cx - camera.x, dz = b.cz - camera.z;
      b.mesh.visible = dx * dx + dz * dz < lim;
      if (b.dirty && b.mesh.visible) { b.mesh.computeBoundingSphere(); b.dirty = false; }
    }
  }
}
