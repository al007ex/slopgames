// Blocky faceless humanoids. One builder serves players, enemies and NPCs —
// they differ by colour, scale and which animation state they are told to play.

import * as THREE from 'three';
import { ANIM } from '/shared/constants.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);

function shade(hex, mul) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(mul);
  return c;
}

function part(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color }));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  return m;
}

/**
 * Total height ~1.87 at scale 1, matching the 1.85 collider.
 * Limbs hang from pivot groups so they can swing without skinning.
 */
export function makeHumanoid(color, scale = 1) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const mid = shade(color, 0.82);
  const dark = shade(color, 0.6);
  const head = shade(color, 1.12);

  const torso = part(0.64, 0.62, 0.36, color, 0, 1.16, 0);
  const headM = part(0.42, 0.42, 0.42, head, 0, 1.68, 0);
  // a visor band so you can read which way something is facing
  const visor = part(0.30, 0.08, 0.03, 0x1b1f27, 0, 1.70, -0.21);

  const legL = new THREE.Group(); legL.position.set(-0.17, 0.85, 0);
  const legR = new THREE.Group(); legR.position.set(0.17, 0.85, 0);
  legL.add(part(0.24, 0.85, 0.28, dark, 0, -0.425, 0));
  legR.add(part(0.24, 0.85, 0.28, dark, 0, -0.425, 0));

  const armL = new THREE.Group(); armL.position.set(-0.41, 1.42, 0);
  const armR = new THREE.Group(); armR.position.set(0.41, 1.42, 0);
  armL.add(part(0.18, 0.60, 0.22, mid, 0, -0.30, 0));
  armR.add(part(0.18, 0.60, 0.22, mid, 0, -0.30, 0));

  body.add(torso, headM, visor, legL, legR, armL, armR);
  root.scale.setScalar(scale);

  return { root, body, torso, head: headM, legL, legR, armL, armR, materials: [torso.material, headM.material, legL.children[0].material, legR.children[0].material, armL.children[0].material, armR.children[0].material] };
}

/** A canvas-texture name tag. Cheap, no font loading, no addons. */
export function makeLabel(text, color = '#ffffff', scale = 1) {
  const pad = 12;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  ctx.font = '600 42px system-ui, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  cv.width = w;
  cv.height = 64;
  const c2 = cv.getContext('2d');
  c2.font = '600 42px system-ui, sans-serif';
  c2.fillStyle = 'rgba(8,10,15,0.62)';
  c2.beginPath();
  if (c2.roundRect) c2.roundRect(0, 0, w, 64, 12);
  else c2.rect(0, 0, w, 64);
  c2.fill();
  c2.fillStyle = color;
  c2.textBaseline = 'middle';
  c2.fillText(text, pad, 34);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  spr.scale.set((w / 64) * 0.38 * scale, 0.38 * scale, 1);
  spr.renderOrder = 900;
  return spr;
}

export class Actor {
  constructor(color, scale = 1, label = null, labelColor = '#fff') {
    this.rig = makeHumanoid(color, scale);
    this.root = this.rig.root;
    this.scale = scale;
    this.phase = 0;
    this.anim = ANIM.IDLE;
    this.flash = 0;
    this.baseColors = this.rig.materials.map((m) => m.color.clone());

    if (label) {
      this.label = makeLabel(label, labelColor);
      this.label.position.y = 2.25 * scale;
      this.root.add(this.label);
    }
  }

  setColor(hex) {
    const c = new THREE.Color(hex);
    const mults = [1, 1.12, 0.6, 0.6, 0.82, 0.82];
    this.rig.materials.forEach((m, i) => {
      m.color.copy(c).multiplyScalar(mults[i]);
      this.baseColors[i].copy(m.color);
    });
  }

  hitFlash() { this.flash = 0.16; }

  setAnim(anim) { this.anim = anim; }

  update(dt, speed = 0) {
    const { legL, legR, armL, armR, body } = this.rig;
    this.phase += dt * (2 + Math.min(speed, 12) * 1.1);

    if (this.flash > 0) {
      this.flash -= dt;
      const on = this.flash > 0;
      this.rig.materials.forEach((m, i) => {
        if (on) m.color.setRGB(1, 1, 1);
        else m.color.copy(this.baseColors[i]);
      });
    }

    let swing = 0;
    let bodyRotX = 0;
    let bodyY = 0;
    let bodyScaleY = 1;

    switch (this.anim) {
      case ANIM.RUN:
        swing = Math.sin(this.phase * 3.4) * 0.75;
        bodyRotX = 0.12;
        bodyY = Math.abs(Math.sin(this.phase * 3.4)) * 0.05;
        break;
      case ANIM.JUMP:
        swing = 0;
        legL.rotation.x = -0.5; legR.rotation.x = 0.28;
        armL.rotation.x = -1.1; armR.rotation.x = -1.1;
        body.rotation.x = 0.05;
        body.position.y = 0;
        body.scale.y = 1;
        this.postUpdate();
        return;
      case ANIM.SLIDE:
        body.rotation.x = -1.15;
        body.position.y = -0.55;
        body.scale.y = 1;
        legL.rotation.x = 0.3; legR.rotation.x = -0.15;
        armL.rotation.x = 0.6; armR.rotation.x = 0.6;
        this.postUpdate();
        return;
      case ANIM.CROUCH:
        bodyScaleY = 0.62;
        swing = Math.sin(this.phase * 2.2) * 0.25 * Math.min(1, speed / 3);
        break;
      case ANIM.DOWN:
        body.rotation.x = -1.5;
        body.position.y = -0.7;
        body.scale.y = 1;
        legL.rotation.x = 0.2; legR.rotation.x = -0.2;
        armL.rotation.x = 1.2; armR.rotation.x = 1.2;
        this.postUpdate();
        return;
      default: // IDLE
        swing = Math.sin(this.phase * 0.9) * 0.06;
        bodyY = Math.sin(this.phase * 0.9) * 0.012;
    }

    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = -swing * 0.8;
    armR.rotation.x = swing * 0.8;
    body.rotation.x = bodyRotX;
    body.position.y = bodyY;
    body.scale.y = bodyScaleY;
    this.postUpdate();
  }

  postUpdate() {
    if (this.label) this.label.position.y = (2.25 + (this.anim === ANIM.SLIDE ? -0.5 : 0)) * 1;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
}
