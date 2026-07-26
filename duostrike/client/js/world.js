// Scene construction. Every level is boxes, wedges and a ground plane — the
// same primitives the collider walks over, so what you see is what you hit.

import * as THREE from 'three';
import { Actor, makeLabel } from './actors.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);

/** Non-indexed geometry from a list of quads (each 4 Vector3-ish arrays). */
function quadGeometry(quads) {
  const pos = [];
  for (const [a, b, c, d] of quads) {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** A ramp whose surface rises toward `dir`. Positioned like a box: centre XZ, bottom Y. */
export function wedgeGeometry(w, h, d, dir) {
  const t = (x, z) => {
    switch (dir) {
      case '+x': return x / w;
      case '-x': return 1 - x / w;
      case '+z': return z / d;
      default: return 1 - z / d; // '-z'
    }
  };
  const y = (x, z) => t(x, z) * h;
  const c00 = [0, y(0, 0), 0], c10 = [w, y(w, 0), 0];
  const c11 = [w, y(w, d), d], c01 = [0, y(0, d), d];
  const b00 = [0, 0, 0], b10 = [w, 0, 0], b11 = [w, 0, d], b01 = [0, 0, d];

  const g = quadGeometry([
    [c00, c10, c11, c01],   // slope surface
    [b00, b01, b11, b10],   // bottom
    [b00, b01, c01, c00],   // x = 0
    [b10, c10, c11, b11],   // x = w
    [b00, c00, c10, b10],   // z = 0
    [b01, b11, c11, c01],   // z = d
  ]);
  g.translate(-w / 2, 0, -d / 2);
  return g;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

export class World {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(95, innerWidth / innerHeight, 0.05, 500);
    this.camera.rotation.order = 'YXZ';

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x404a58, 1.5);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.25);
    this.sun.position.set(30, 60, 20);
    this.scene.add(this.hemi, this.sun);

    // The viewmodel lives in its own scene, rendered in a second pass with a
    // fixed narrow FOV. Sharing the world camera made the gun balloon at 95deg
    // and warp whenever the FOV slider or the sprint kick moved.
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 12);
    this.vmScene.add(new THREE.HemisphereLight(0xffffff, 0x3a4250, 2.1));
    const vmSun = new THREE.DirectionalLight(0xffffff, 1.1);
    vmSun.position.set(-0.6, 1.2, 0.8);
    this.vmScene.add(vmSun, this.vmCamera);

    this.levelGroup = new THREE.Group();
    this.propGroup = new THREE.Group();
    this.actorGroup = new THREE.Group();
    this.scene.add(this.levelGroup, this.propGroup, this.actorGroup);

    this.materials = new Map();
    this.gates = new Map();
    this.props = new Map();     // taskId -> { ... }
    this.npcs = new Map();
    this.level = null;
    this.time = 0;

    // objective beam — a cheap, always-readable "go here"
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 26, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x38d9c0, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.beacon.visible = false;
    this.scene.add(this.beacon);
  }

  mat(color) {
    if (!this.materials.has(color)) {
      this.materials.set(color, new THREE.MeshLambertMaterial({ color }));
    }
    return this.materials.get(color);
  }

  clear() {
    for (const g of [this.levelGroup, this.propGroup, this.actorGroup]) {
      while (g.children.length) {
        const c = g.children.pop();
        c.traverse?.((o) => {
          if (o.geometry && o.geometry !== BOX) o.geometry.dispose();
          if (o.material && o.material.map) o.material.map.dispose();
        });
      }
    }
    this.gates.clear();
    this.props.clear();
    this.npcs.clear();
  }

  load(level) {
    this.clear();
    this.level = level;
    this.time = 0;

    const sky = new THREE.Color(level.sky ?? 0x0d1016);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, level.fogNear ?? 40, level.fogFar ?? 200);
    // Tint the fill light toward the sky, but never all the way — on the dark
    // levels a literal sky-coloured hemisphere leaves edges unreadable, and you
    // have to see a platform edge to jump to it.
    this.hemi.color.copy(sky).lerp(new THREE.Color(0xffffff), 0.5);
    this.hemi.intensity = level.id === 'horde' || level.id === 'final' ? 1.0 : 1.5;

    if (level.ground) {
      const [w, d] = level.ground.size;
      const [cx, cz] = level.ground.center || [0, 0];
      const g = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.mat(level.ground.color));
      g.rotation.x = -Math.PI / 2;
      g.position.set(cx, 0, cz);
      this.levelGroup.add(g);
    }

    for (const b of level.boxes || []) this.levelGroup.add(this.boxMesh(b));

    for (const s of level.slopes || []) {
      const m = new THREE.Mesh(wedgeGeometry(s.s[0], s.s[1], s.s[2], s.dir), this.mat(s.c));
      m.position.set(s.p[0], s.p[1], s.p[2]);
      this.levelGroup.add(m);
    }

    for (const g of level.gates || []) {
      const m = this.boxMesh(g);
      m.userData.closedY = g.p[1];
      this.levelGroup.add(m);
      this.gates.set(g.id, m);
    }

    for (const n of level.npcs || []) this.addNPC(n);
    for (const t of level.tasks || []) this.addTaskProps(t);

    // exit marker
    const ex = level.exit;
    const exitMesh = new THREE.Mesh(
      new THREE.BoxGeometry(ex.s[0] * 0.9, 0.08, ex.s[2] * 0.9),
      new THREE.MeshBasicMaterial({ color: 0x5fd35f, transparent: true, opacity: 0.35 }),
    );
    exitMesh.position.set(ex.p[0], ex.p[1] + 0.05, ex.p[2]);
    exitMesh.visible = false;
    this.propGroup.add(exitMesh);
    this.exitMesh = exitMesh;
  }

  boxMesh(b) {
    const m = new THREE.Mesh(BOX, this.mat(b.c));
    m.scale.set(b.s[0], b.s[1], b.s[2]);
    m.position.set(b.p[0], b.p[1] + b.s[1] / 2, b.p[2]);
    return m;
  }

  // ------------------------------------------------------------------ NPCs

  addNPC(def) {
    const actor = new Actor(def.color, 1, def.name, '#ffffff');
    actor.root.position.set(def.p[0], def.p[1], def.p[2]);
    actor.root.rotation.y = Math.PI;
    this.actorGroup.add(actor.root);

    const mark = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22),
      new THREE.MeshBasicMaterial({ color: 0xffc93c }),
    );
    mark.position.y = 2.62;
    actor.root.add(mark);

    this.npcs.set(def.id, { def, actor, mark });
  }

  // ------------------------------------------------------------- task props

  pad(x, y, z, r, color, opacity = 0.55) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.12, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity }),
    );
    m.position.set(x, y + 0.07, z);
    return m;
  }

  ringMesh(r, color) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.72, r * 0.94, 28, 1, Math.PI / 2, 0.0001),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
    );
    m.rotation.x = -Math.PI / 2;
    return m;
  }

  addTaskProps(t) {
    const entry = { def: t, kind: t.kind, meshes: [] };
    const add = (m) => { this.propGroup.add(m); entry.meshes.push(m); return m; };

    if (t.kind === 'hold') {
      entry.pad = add(this.pad(t.p[0], t.p[1], t.p[2], t.r, 0x38d9c0));
      entry.ring = add(this.ringMesh(t.r, 0xffffff));
      entry.ring.position.set(t.p[0], t.p[1] + 0.16, t.p[2]);
      entry.post = add(this.boxAt(t.p[0], t.p[1], t.p[2], 0.5, 1.5, 0.5, 0x24374f));
      entry.label = add(this.labelAt(t.label, t.p[0], t.p[1] + 2.3, t.p[2], '#38d9c0'));
    }

    if (t.kind === 'synced') {
      entry.pads = t.pads.map((p) => {
        const pad = add(this.pad(p.p[0], p.p[1], p.p[2], p.r, 0xff8c1a));
        const lever = add(this.boxAt(p.p[0], p.p[1] + 0.6, p.p[2], 0.16, 1.0, 0.16, 0xe8e8e8));
        const lbl = add(this.labelAt(p.id.toUpperCase(), p.p[0], p.p[1] + 2.2, p.p[2], '#ff8c1a'));
        return { def: p, pad, lever, lbl };
      });
    }

    if (t.kind === 'fetch') {
      entry.item = add(new THREE.Mesh(
        new THREE.OctahedronGeometry(0.34, 0),
        new THREE.MeshBasicMaterial({ color: 0x51c9a0 }),
      ));
      entry.glow = add(new THREE.Mesh(
        new THREE.OctahedronGeometry(0.62, 0),
        new THREE.MeshBasicMaterial({ color: 0x51c9a0, transparent: true, opacity: 0.2, depthWrite: false }),
      ));
      // place it before the first snapshot arrives, or it sits at the origin
      entry.item.position.set(t.item.p[0], t.item.p[1] + 0.5, t.item.p[2]);
      entry.glow.position.copy(entry.item.position);
      entry.console = add(this.boxAt(t.console.p[0], t.console.p[1] + 0.6, t.console.p[2], 1.4, 1.2, 1.0, 0x24374f));
      entry.screen = add(this.soloBox(t.console.p[0], t.console.p[1] + 1.05, t.console.p[2] - 0.52, 1.0, 0.5, 0.06, 0xff8c1a));
      entry.label = add(this.labelAt('Terminal', t.console.p[0], t.console.p[1] + 2.1, t.console.p[2], '#ff8c1a'));
    }

    if (t.kind === 'defend') {
      entry.holdPad = add(this.pad(t.hold.p[0], t.hold.p[1], t.hold.p[2], t.hold.r, 0xff8c1a));
      entry.holdLabel = add(this.labelAt('Hold', t.hold.p[0], t.hold.p[1] + 2.2, t.hold.p[2], '#ff8c1a'));
      entry.goalPad = add(this.pad(t.goal.p[0], t.goal.p[1], t.goal.p[2], t.goal.r, 0x38d9c0));
      entry.goalBox = add(this.boxAt(t.goal.p[0], t.goal.p[1] + 0.7, t.goal.p[2], 1.2, 1.4, 1.0, 0x24374f));
      entry.goalLabel = add(this.labelAt('Relay', t.goal.p[0], t.goal.p[1] + 2.4, t.goal.p[2], '#38d9c0'));
    }

    if (t.kind === 'pattern') {
      entry.buttons = t.buttons.map((b) => {
        const pad = add(this.pad(b.p[0], b.p[1], b.p[2], 1.1, b.color, 0.35));
        const cap = add(this.boxAt(b.p[0], b.p[1] + 0.25, b.p[2], 1.0, 0.4, 1.0, b.color));
        return { def: b, pad, cap, lit: 0 };
      });
      entry.label = add(this.labelAt(t.label, t.p[0], t.p[1] + 2.6, t.p[2], '#ffffff'));
    }

    this.props.set(t.id, entry);
  }

  boxAt(x, y, z, w, h, d, color) {
    const m = new THREE.Mesh(BOX, this.mat(color));
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    return m;
  }

  /** Same, but with a private material — use for anything that gets recoloured. */
  soloBox(x, y, z, w, h, d, color) {
    const m = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color }));
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    return m;
  }

  labelAt(text, x, y, z, color) {
    const s = makeLabel(text, color, 0.9);
    s.position.set(x, y, z);
    return s;
  }

  // ---------------------------------------------------------------- updates

  setGateOpen(id, open) {
    const m = this.gates.get(id);
    if (!m) return;
    m.userData.open = open;
  }

  /** Drive prop animation from the authoritative task states. */
  updateProps(dt, taskStates, myId) {
    this.time += dt;
    const t = this.time;

    for (const [, m] of this.gates) {
      const closedY = m.userData.closedY + m.scale.y / 2;
      const target = m.userData.open ? closedY + m.scale.y + 0.6 : closedY;
      m.position.y += (target - m.position.y) * Math.min(1, dt * 2.4);
    }

    for (const st of taskStates || []) {
      const e = this.props.get(st.id);
      if (!e) continue;
      const visible = st.active !== false;

      if (e.kind === 'hold') {
        const frac = st.total ? Math.min(1, st.progress / st.total) : 0;
        // only rebuild the arc when it actually moved — this runs every frame
        if (e.lastFrac === undefined || Math.abs(frac - e.lastFrac) > 0.015) {
          e.lastFrac = frac;
          const geo = e.ring.geometry;
          e.ring.geometry = new THREE.RingGeometry(
            e.def.r * 0.72, e.def.r * 0.94, 28, 1, Math.PI / 2, Math.max(0.0001, frac * Math.PI * 2),
          );
          geo.dispose();
        }
        e.ring.material.color.set(st.done ? 0x5fd35f : 0xffffff);
        e.pad.material.color.set(st.done ? 0x5fd35f : 0x38d9c0);
        e.pad.material.opacity = st.done ? 0.3 : 0.4 + Math.sin(t * 4) * 0.15;
        for (const m of e.meshes) m.visible = visible;
      }

      if (e.kind === 'synced') {
        for (const p of e.pads) {
          const flipped = !!(st.flips && st.flips[p.def.id]);
          p.lever.rotation.x = flipped ? -0.9 : 0.6;
          p.pad.material.color.set(st.done ? 0x5fd35f : flipped ? 0x5fd35f : 0xff8c1a);
          p.pad.material.opacity = 0.4 + Math.sin(t * 4) * 0.15;
        }
      }

      if (e.kind === 'fetch') {
        const held = !!st.carrier;
        const p = st.itemPos || e.def.item.p;
        const bob = held ? 0 : Math.sin(t * 2) * 0.16;
        e.item.position.set(p[0], p[1] + 0.5 + bob, p[2]);
        e.glow.position.copy(e.item.position);
        e.item.rotation.y = t * 1.4;
        e.item.rotation.x = t * 0.7;
        e.glow.rotation.y = -t * 0.9;
        e.item.visible = !st.done;
        e.glow.visible = !st.done;
        e.screen.material.color.set(st.done ? 0x5fd35f : held ? 0x38d9c0 : 0xff8c1a);
      }

      if (e.kind === 'defend') {
        const held = !!st.holder;
        e.holdPad.material.color.set(st.done ? 0x5fd35f : held ? 0x5fd35f : 0xff8c1a);
        e.holdPad.material.opacity = 0.4 + Math.sin(t * 5) * 0.16;
        e.goalPad.material.color.set(st.done ? 0x5fd35f : held ? 0x38d9c0 : 0x6a7788);
        e.goalPad.material.opacity = held ? 0.5 + Math.sin(t * 6) * 0.2 : 0.22;
      }

      if (e.kind === 'pattern') {
        for (const b of e.buttons) {
          if (b.lit > 0) b.lit -= dt;
          const on = b.lit > 0;
          b.cap.position.y = b.def.p[1] + (on ? 0.34 : 0.25);
          b.pad.material.opacity = on ? 0.95 : 0.3;
        }
        for (const m of e.meshes) m.visible = visible;
      }
    }

    for (const [, n] of this.npcs) {
      n.mark.rotation.y += dt * 2;
      n.mark.position.y = 2.62 + Math.sin(t * 2) * 0.09;
      n.actor.update(dt, 0);
    }
  }

  flashPatternButton(taskId, buttonId, seconds = 0.42) {
    const e = this.props.get(taskId);
    if (!e || e.kind !== 'pattern') return;
    const b = e.buttons.find((x) => x.def.id === buttonId);
    if (b) b.lit = seconds;
  }

  setBeacon(pos) {
    if (!pos) { this.beacon.visible = false; return; }
    this.beacon.visible = true;
    this.beacon.position.set(pos[0], pos[1] + 12, pos[2]);
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = innerWidth / innerHeight;
    this.vmCamera.updateProjectionMatrix();
  }

  /** World first, then the viewmodel on a cleared depth buffer so it never clips. */
  render(renderer) {
    renderer.autoClear = true;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.vmScene, this.vmCamera);
    renderer.autoClear = true;
  }
}
