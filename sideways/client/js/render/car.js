// The cars, drawn from their specs: an extruded side profile for the body, a
// glass cabin, turning and rolling wheels, and a body that squats, dives and
// leans on its springs. Lights are real: the headlamps light the road ahead,
// the brake lights tint the smoke behind.
//
// Local frame: +x forward, +y up, +z to the right; the origin is the centre of
// gravity at ground level.

import * as THREE from 'three';
import { glow } from './textures.js';

// Side profiles (x from the rear bumper, 0‥1 along the length; y in metres).
const PROFILES = {
  coupe: {
    body: [[0, 0.3], [0, 0.66], [0.015, 0.8], [0.06, 0.84], [0.3, 0.86], [0.62, 0.88], [0.9, 0.74], [0.985, 0.62], [1, 0.5], [0.99, 0.3]],
    cabin: [[0.2, 0.84], [0.36, 1.25], [0.55, 1.27], [0.72, 0.87]],
    extras: ['ducktail', 'lip'],
  },
  muscle: {
    body: [[0, 0.32], [0, 0.78], [0.03, 0.88], [0.24, 0.9], [0.66, 0.92], [0.95, 0.86], [1, 0.72], [1, 0.34]],
    cabin: [[0.24, 0.9], [0.38, 1.33], [0.58, 1.34], [0.68, 0.92]],
    extras: ['scoop', 'lip', 'spoiler'],
  },
  wedge: {
    body: [[0, 0.3], [0, 0.72], [0.04, 0.82], [0.28, 0.84], [0.62, 0.8], [0.93, 0.6], [1, 0.46], [0.995, 0.28]],
    cabin: [[0.25, 0.82], [0.4, 1.2], [0.58, 1.21], [0.74, 0.79]],
    extras: ['wing', 'lip'],
  },
};

let glowTex = null;

export class CarModel {
  constructor(spec, color = '#e8e6e1') {
    this.spec = spec;
    const s = spec;
    const L = s.length, W = s.width;
    const a = s.cgFront, b = s.wheelbase - s.cgFront;
    const off = (a - b) / 2;
    this.x0 = off - L / 2; // rear bumper
    this.x1 = off + L / 2; // front bumper
    glowTex ||= glow(128, 1.6);

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

    this.paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.3 });
    const trim = new THREE.MeshStandardMaterial({ color: '#0d0e12', roughness: 0.5, metalness: 0.3 });
    const glass = new THREE.MeshPhysicalMaterial({ color: '#07080c', metalness: 0.2, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.6 });

    const prof = PROFILES[s.body] || PROFILES.coupe;
    const map = (pts) => pts.map(([u, y]) => new THREE.Vector2(this.x0 + u * L, y));
    // Body, with the wheel arches cut out of its lower edge.
    const shape = new THREE.Shape();
    const body = map(prof.body);
    shape.moveTo(body[0].x, body[0].y);
    for (const p of body.slice(1)) shape.lineTo(p.x, p.y);
    const R = s.wheelRadius + 0.05;
    const arch = (cx) => {
      shape.lineTo(cx + R, 0.3);
      shape.absarc(cx, s.wheelRadius, R, Math.atan2(0.3 - s.wheelRadius, R), Math.PI - Math.atan2(0.3 - s.wheelRadius, R), false);
    };
    arch(a); arch(-b);
    shape.lineTo(body[0].x, body[0].y);
    const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: W - 0.16, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 3, curveSegments: 10 });
    bodyGeo.translate(0, 0, -(W - 0.16) / 2);
    this.body.add(new THREE.Mesh(bodyGeo, this.paint));

    const cab = new THREE.Shape(map(prof.cabin));
    const cabGeo = new THREE.ExtrudeGeometry(cab, { depth: W - 0.46, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.08, bevelSegments: 3 });
    cabGeo.translate(0, 0, -(W - 0.46) / 2);
    this.body.add(new THREE.Mesh(cabGeo, glass));
    // A body-coloured roof over the glass.
    const cp = map(prof.cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry((cp[2].x - cp[1].x) * 0.96, 0.05, W - 0.52), this.paint);
    roof.position.set((cp[1].x + cp[2].x) / 2, (cp[1].y + cp[2].y) / 2 + 0.07, 0);
    this.body.add(roof);

    // Details.
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); this.body.add(m); return m; };
    add(new THREE.BoxGeometry(L * 0.94, 0.08, W + 0.02), trim, off, 0.26, 0); // sills
    if (prof.extras.includes('lip')) add(new THREE.BoxGeometry(0.3, 0.05, W - 0.1), trim, this.x1 - 0.05, 0.24, 0);
    if (prof.extras.includes('ducktail')) add(new THREE.BoxGeometry(0.28, 0.06, W - 0.3), this.paint, this.x0 + 0.16, 0.9, 0).rotation.z = -0.25;
    if (prof.extras.includes('spoiler')) add(new THREE.BoxGeometry(0.22, 0.05, W - 0.34), trim, this.x0 + 0.18, 0.98, 0);
    if (prof.extras.includes('scoop')) add(new THREE.BoxGeometry(0.7, 0.1, 0.5), trim, this.x0 + L * 0.8, 0.95, 0);
    if (prof.extras.includes('wing')) {
      add(new THREE.BoxGeometry(0.34, 0.04, W - 0.1), trim, this.x0 + 0.2, 1.22, 0);
      for (const z of [-0.5, 0.5]) add(new THREE.BoxGeometry(0.16, 0.36, 0.04), trim, this.x0 + 0.26, 1.02, z);
    }
    for (const z of [-1, 1]) add(new THREE.BoxGeometry(0.14, 0.08, 0.16), this.paint, (cp[3].x + cp[2].x) / 2 + 0.2, 0.95, z * (W / 2 - 0.02));

    // Lights: slim bars front and back. They're HDR so they bloom.
    this.headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4e0').multiplyScalar(4), toneMapped: false });
    this.tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1830').multiplyScalar(1.4), toneMapped: false });
    this.revMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(0.2), toneMapped: false });
    const fy = body[body.length - 2].y - 0.07;
    for (const z of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.07, 0.42), this.headMat, this.x1 + 0.07, fy, z * (W / 2 - 0.3));
    const ty = prof.body[1][1] - 0.05;
    add(new THREE.BoxGeometry(0.05, 0.08, W - 0.3), this.tailMat, this.x0 - 0.08, ty, 0);
    for (const z of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.07, 0.16), this.revMat, this.x0 - 0.085, ty - 0.12, z * 0.45);

    // Exhaust tips (a pair for the V8, one otherwise).
    this.exhausts = s.engine.kind === 'v8' ? [-0.55, 0.55] : [0.5];
    const tipGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10).rotateZ(Math.PI / 2);
    const chrome = new THREE.MeshStandardMaterial({ color: '#888', metalness: 1, roughness: 0.25 });
    for (const z of this.exhausts) add(tipGeo, chrome, this.x0 - 0.05, 0.3, z);

    // Wheels.
    this.wheels = [];
    const tire = new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: '#b8bcc4', metalness: 0.9, roughness: 0.25 });
    const caliper = new THREE.MeshStandardMaterial({ color: '#d0202e', roughness: 0.5 });
    for (const [x, front] of [[a, true], [-b, false]]) for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, s.wheelRadius, side * (s.track / 2));
      const spin = new THREE.Group();
      pivot.add(spin);
      const tg = new THREE.CylinderGeometry(s.wheelRadius, s.wheelRadius, s.wheelWidth, 22).rotateX(Math.PI / 2);
      spin.add(new THREE.Mesh(tg, tire));
      const rimG = new THREE.CylinderGeometry(s.wheelRadius * 0.66, s.wheelRadius * 0.66, s.wheelWidth + 0.01, 18).rotateX(Math.PI / 2);
      const rim = new THREE.Mesh(rimG, rimMat); spin.add(rim);
      for (let k = 0; k < 5; k++) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(s.wheelRadius * 1.2, 0.05, 0.03), rimMat);
        sp.rotation.z = k * Math.PI * 2 / 5;
        sp.position.z = side * (s.wheelWidth / 2 + 0.005);
        spin.add(sp);
      }
      const cal = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.05), caliper);
      cal.position.set(front ? -0.12 : 0.12, 0.1, side * (s.wheelWidth / 2 - 0.06));
      pivot.add(cal);
      this.root.add(pivot);
      this.wheels.push({ pivot, spin, front, side, angle: 0 });
    }

    // A soft shadow under the car.
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.25, W * 1.6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: glowTex, color: '#000000', transparent: true, opacity: 0.85, depthWrite: false }));
    shadow.position.set(off, 0.03, 0);
    shadow.renderOrder = 1;
    this.root.add(shadow);

    // The headlamps light the road; the tail lights tint whatever is behind.
    this.headlight = new THREE.SpotLight('#fff2dc', 28, 80, 0.5, 0.6, 1.6);
    this.headlight.position.set(this.x1 - 0.2, 0.7, 0);
    this.headlight.target.position.set(this.x1 + 20, -1.5, 0);
    this.root.add(this.headlight, this.headlight.target);
    this.tailLight = new THREE.PointLight('#ff2030', 3, 14, 1.6);
    this.tailLight.position.set(this.x0 - 0.8, 0.6, 0);
    this.root.add(this.tailLight);
    // Headlight beams, just visible in the haze and smoke.
    const beamMat = new THREE.MeshBasicMaterial({ color: '#fff0d8', transparent: true, opacity: 0.012, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const z of [-1, 1]) {
      const beam = new THREE.Mesh(new THREE.ConeGeometry(2.6, 16, 20, 1, true).rotateZ(Math.PI / 2).translate(8, 0, 0), beamMat);
      beam.position.set(this.x1, fy, z * (W / 2 - 0.3));
      beam.rotation.z = -0.06;
      this.body.add(beam);
    }

    // Suspension state for the visual body motion.
    this.roll = 0; this.rollV = 0;
    this.pitch = 0; this.pitchV = 0;
    this.heave = 0; this.heaveV = 0;
    this.bump = 0;
  }

  setColor(color) { this.paint.color.set(color); }

  /** Exhaust tip positions in local space. */
  exhaustPoints() { return this.exhausts.map((z) => new THREE.Vector3(this.x0 - 0.15, 0.3, z)); }

  /**
   * Place the model: `pose` is the interpolated { x, y, heading }, `car` the sim
   * (for the wheels and the accelerations), `dt` the frame time.
   */
  update(pose, car, dt, { braking = false, reversing = false } = {}) {
    const s = this.spec;
    this.root.position.set(pose.x, 0, -pose.y);
    this.root.rotation.y = pose.heading;

    // Springs: the body chases where the accelerations push it.
    const k = 60, c = 11;
    const targetRoll = THREE.MathUtils.clamp(car.ay * 0.0085, -0.07, 0.07);
    const targetPitch = THREE.MathUtils.clamp(car.ax * 0.0065, -0.06, 0.05);
    this.rollV += ((targetRoll - this.roll) * k - this.rollV * c) * dt; this.roll += this.rollV * dt;
    this.pitchV += ((targetPitch - this.pitch) * k - this.pitchV * c) * dt; this.pitch += this.pitchV * dt;
    this.heaveV += ((this.bump - this.heave) * 90 - this.heaveV * 12) * dt; this.heave += this.heaveV * dt;
    this.bump *= Math.exp(-10 * dt);
    this.body.rotation.set(this.roll, 0, this.pitch);
    this.body.position.y = 0.02 + this.heave - Math.abs(this.roll) * 0.4;

    // Wheels: steer the fronts, spin all four at their own speed.
    for (const w of this.wheels) {
      if (w.front) w.pivot.rotation.y = car.steer;
      const omega = w.front ? car.wf : car.wr;
      w.angle -= omega * dt;
      w.spin.rotation.z = w.angle;
    }

    this.tailMat.color.set('#ff1830').multiplyScalar(braking ? 5 : 1.4);
    this.tailLight.intensity = braking ? 9 : 3;
    this.revMat.color.set('#ffffff').multiplyScalar(reversing ? 4 : 0.2);
  }

  /** A jolt through the springs (a hit, a kerb). */
  kick(amount) { this.heaveV += amount; }
}
