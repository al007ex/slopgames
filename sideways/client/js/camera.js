// The camera. The chase cam trails the direction of travel more than the
// nose, so in a slide you see the car side-on, the way a drift is meant to be
// seen. All smoothing is frame-rate independent.

import * as THREE from 'three';

const MODES = ['chase', 'far', 'bumper', 'orbit'];

export class ChaseCam {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3(0, 3, 8);
    this.look = new THREE.Vector3();
    this.dir = 0;           // smoothed follow direction (sim angle)
    this.shake = 0;
    this.fov = 62;
    this.orbit = 0;
    this.t = 0;
    this.lookBack = false;
  }

  cycle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    return this.mode;
  }

  snap(pose) {
    this.dir = pose.heading;
    this.update(pose, null, 1, true);
  }

  punch(amount) { this.shake = Math.min(1.2, this.shake + amount); }

  update(pose, car, dt, snap = false) {
    this.t += dt;
    const speed = car ? car.speed : 0;
    // Follow a blend of the heading and the velocity, weighted to the velocity
    // as the car slides, and not at all when crawling or rolling backwards.
    let follow = pose.heading;
    if (car && speed > 2) {
      const vel = Math.atan2(car.vy, car.vx);
      const diff = Math.atan2(Math.sin(vel - pose.heading), Math.cos(vel - pose.heading));
      const w = Math.min(1, (speed - 2) / 6) * (Math.abs(diff) < 2 ? 0.72 : 0);
      follow = pose.heading + diff * w;
    }
    const d = Math.atan2(Math.sin(follow - this.dir), Math.cos(follow - this.dir));
    this.dir += d * (snap ? 1 : 1 - Math.exp(-(this.mode === 'bumper' ? 14 : 4.2) * dt));

    const cx = pose.x, cy = pose.y;
    const back = this.lookBack ? -1 : 1;
    let dist = 6.4 + Math.min(speed, 40) * 0.035, height = 2.15 + Math.min(speed, 40) * 0.012, ahead = 2.4;
    if (this.mode === 'far') { dist = 11 + speed * 0.04; height = 4.2; ahead = 3; }
    const target = new THREE.Vector3();
    const look = new THREE.Vector3();
    if (this.mode === 'bumper') {
      const h = pose.heading;
      target.set(cx + Math.cos(h) * 0.6 * back, 1.05, -(cy + Math.sin(h) * 0.6 * back));
      look.set(cx + Math.cos(h) * 30 * back, 0.9, -(cy + Math.sin(h) * 30 * back));
    } else if (this.mode === 'orbit') {
      this.orbit += dt * 0.3;
      const r = this.garage ? 6.8 : 11, hgt = this.garage ? 1.9 : 3.2;
      target.set(cx + Math.cos(this.orbit) * r, hgt, -(cy + Math.sin(this.orbit) * r));
      // In the garage the car sits a little high in the frame, clear of the menu.
      look.set(cx, this.garage ? -0.6 : 0.8, -cy);
    } else {
      const a = this.dir + (back < 0 ? Math.PI : 0);
      target.set(cx - Math.cos(a) * dist, height, -(cy - Math.sin(a) * dist));
      look.set(cx + Math.cos(a) * ahead, 0.95, -(cy + Math.sin(a) * ahead));
    }
    if (snap) { this.pos.copy(target); this.look.copy(look); }
    else {
      const k = 1 - Math.exp(-(this.mode === 'bumper' ? 30 : 9) * dt);
      this.pos.lerp(target, k);
      this.look.lerp(look, 1 - Math.exp(-14 * dt));
    }
    this.camera.position.copy(this.pos);
    // Shake: small, fast, decaying.
    if (this.shake > 0.001) {
      const s = this.shake * 0.12;
      this.camera.position.x += (Math.sin(this.t * 71) + Math.sin(this.t * 43)) * s;
      this.camera.position.y += (Math.sin(this.t * 57) + Math.sin(this.t * 91)) * s * 0.7;
      this.shake *= Math.exp(-dt * 7);
    }
    this.camera.lookAt(this.look);
    const fov = (this.mode === 'bumper' ? 72 : 60) + Math.min(speed, 55) * 0.2;
    this.fov += (fov - this.fov) * (1 - Math.exp(-3 * dt));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
  }
}
