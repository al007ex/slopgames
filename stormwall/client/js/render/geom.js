// Geometry helpers: merge simple shapes into one buffer, optionally painting
// each with a flat vertex colour, so a tree or a car is a single draw.

import * as THREE from 'three';

/** Merges geometries (indexed or not) into one non-indexed geometry with position, normal, uv and colour. */
export function merge(parts) {
  let count = 0;
  const flat = parts.map(({ geo, color }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    count += g.attributes.position.count;
    return { g, color: color !== undefined ? new THREE.Color(color) : null };
  });
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2), col = new Float32Array(count * 3);
  let o = 0;
  for (const { g, color } of flat) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    for (let i = 0; i < n; i++) {
      col[(o + i) * 3] = color ? color.r : 1;
      col[(o + i) * 3 + 1] = color ? color.g : 1;
      col[(o + i) * 3 + 2] = color ? color.b : 1;
    }
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/** A box of the given size centred at (x, y, z), optionally oriented by three axes. */
export function boxAt(w, h, d, x, y, z, axes = null) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (axes) {
    const [u, v, n] = axes;
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...v), new THREE.Vector3(...n));
    g.applyMatrix4(m);
  }
  g.translate(x, y, z);
  return g;
}

export function cyl(rTop, rBottom, h, seg, x, y, z) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
  g.translate(x, y + h / 2, z);
  return g;
}
