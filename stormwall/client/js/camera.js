// Over-the-shoulder camera. It sits behind and right of the head, looks along
// the view direction, and pulls in when a wall or the ground is in the way.
// Aiming down sights moves it closer and narrows the field of view.

import { aimFrame, CAM_BACK, ADS_BACK } from '#shared/aim.js';

export class ThirdPersonCamera {
  constructor(camera) {
    this.camera = camera;
    this.adsBlend = 0;
    this.baseFov = 78;
    this.frame = {};
    this.hit = {};
    this.dist = CAM_BACK;
    this.shake = 0;
    this.recoil = 0;
  }

  /** A little visual kick when you fire (the aim itself does not move). */
  kick(cls) {
    const k = { sniper: 0.05, pump: 0.045, tactical: 0.03, revolver: 0.03, rocket: 0.03, grenade: 0.02 }[cls] ?? 0.012;
    this.recoil = Math.min(0.12, this.recoil + k);
  }

  update(dt, move, yaw, pitch, ads, grid, zoomFov = 50) {
    const target = ads ? 1 : 0;
    this.adsBlend += (target - this.adsBlend) * Math.min(1, dt * 14);
    const f = aimFrame(move, yaw, pitch, this.adsBlend > 0.5, this.frame);
    const back = CAM_BACK + (ADS_BACK - CAM_BACK) * this.adsBlend;
    const d = f.dir;
    // Pull in if something is between the head and the ideal camera spot.
    const t = grid.raycast(f.ox, f.oy, f.oz, -d.x, -d.y, -d.z, back + 0.3, this.hit);
    const want = t < back + 0.3 ? Math.max(0.3, t - 0.3) : back;
    this.dist = want < this.dist ? want : this.dist + (want - this.dist) * Math.min(1, dt * 6);
    const cam = this.camera;
    cam.position.set(f.ox - d.x * this.dist, f.oy - d.y * this.dist, f.oz - d.z * this.dist);
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 2);
    }
    this.recoil *= Math.exp(-dt * 14);
    cam.rotation.set(pitch + this.recoil, yaw, 0, 'YXZ');
    const fov = this.baseFov + (zoomFov - this.baseFov) * this.adsBlend;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    return f;
  }
}
