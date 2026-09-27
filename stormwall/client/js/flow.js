// The shape of a match on the client: the pre-game countdown, riding the Drop
// Blimp (and jumping off it), spectating after you are out, and the results.

import * as THREE from 'three';
import { TICK_HZ } from '#shared/constants.js';
import { MODE_BUS, MODE_DEAD } from '#shared/movement.js';
import { A_JUMP } from '#shared/protocol.js';
import { mat } from './render/avatars.js';

const $ = (id) => document.getElementById(id);
const BUS_DOORS_TICKS = 2 * TICK_HZ;

export class MatchFlow {
  constructor(app) {
    this.app = app;
    this.phase = null;
    this.route = null;
    this.alive = 0;
    this.kills = 0;
    this.results = null;
    this.blimp = makeBlimp();
    this.blimp.visible = false;
    app.gfx.scene.add(this.blimp);
    this.busDir = new THREE.Vector3(1, 0, 0);
  }

  reset() {
    this.phase = null; this.route = null; this.results = null; this.kills = 0;
    this.blimp.visible = false;
    $('results').hidden = true;
    $('banner').hidden = true;
    $('jump-prompt').hidden = true;
    $('spectating').hidden = true;
  }

  onPhase(msg) {
    this.phase = msg.phase;
    this.route = msg.route;
    this.pregameEnds = msg.pregameEnds;
    if (msg.alive) this.alive = msg.alive;
    if (msg.phase === 'bus') { this.app.toast('THE BLIMP IS LAUNCHING', 2000); this.app.audio.tone(null, { freq: 330, to: 660, gain: 0.2, dur: 0.6, type: 'triangle' }); }
    if (msg.phase === 'ended' && !this.results?.victory) this.app.toast('THE MATCH IS OVER', 2500);
    this.app.map.bus = this.route;
    this.updateCounters();
  }

  onAlive(msg) { this.alive = msg.players; this.updateCounters(); }

  onFeed(msg) {
    if (msg.killer === this.app.game.me?.id && msg.victim !== msg.killer) { this.kills++; this.updateCounters(); }
  }

  updateCounters() {
    const c = $('counters');
    if (!this.phase || this.phase === 'pregame') { c.innerHTML = ''; return; }
    c.innerHTML = `<span title="Players left">👤 ${this.alive}</span><span title="Your eliminations">✖ ${this.kills}</span>`;
  }

  onResults(msg) {
    this.results = msg;
    const el = $('results');
    el.hidden = false;
    el.classList.toggle('victory', msg.victory);
    $('res-place').textContent = msg.victory ? '#1 VICTORY' : `#${msg.placement}`;
    $('res-sub').textContent = msg.victory ? 'Last one standing.' : msg.killer ? `Eliminated by ${msg.killer}` : 'Eliminated';
    $('res-kills').textContent = msg.kills;
    $('res-damage').textContent = msg.damage;
    $('res-time').textContent = `${Math.floor(msg.survived / 60)}:${String(msg.survived % 60).padStart(2, '0')}`;
    $('res-xp').textContent = msg.xp ? `+${msg.xp} XP` : '';
    $('res-spectate').hidden = !!msg.victory || this.phase === 'ended';
    this.app.input.unlock();
    if (msg.victory) this.app.audio.victory?.();
  }

  /** Where the blimp is right now, from its route and the render clock. */
  busPos(out = new THREE.Vector3()) {
    const r = this.route;
    const t = Math.min(1, Math.max(0, ((this.app.game.renderTick - r.start) / TICK_HZ) * r.speed / r.length));
    this.busDir.set(r.x1 - r.x0, 0, r.z1 - r.z0).normalize();
    return out.set(r.x0 + (r.x1 - r.x0) * t, r.y, r.z0 + (r.z1 - r.z0) * t);
  }

  /** Returns a camera override while riding the blimp, or null. */
  frame(dt, me) {
    const app = this.app;
    // Pre-game countdown.
    const banner = $('banner');
    if (this.phase === 'pregame' && this.pregameEnds) {
      const left = Math.max(0, Math.ceil((this.pregameEnds - app.game.serverTickNow(performance.now())) / TICK_HZ));
      banner.hidden = false;
      banner.innerHTML = `<small>PRE-GAME ISLAND · nothing hurts here</small><b>The blimp launches in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</b>`;
    } else banner.hidden = true;
    // The blimp.
    const riding = me && me.move.mode === MODE_BUS && this.route;
    const flying = this.route && (this.phase === 'bus' || (this.phase === 'playing' && app.game.renderTick - this.route.start < (this.route.length / this.route.speed + 5) * TICK_HZ));
    this.blimp.visible = !!flying;
    let cam = null;
    if (flying) {
      const pos = this.busPos();
      this.blimp.position.copy(pos);
      this.blimp.rotation.y = Math.atan2(-this.busDir.x, -this.busDir.z) + Math.PI / 2;
      this.blimp.children.forEach((c) => { if (c.userData.prop) c.rotation.x += dt * 20; });
      if (riding) {
        // Orbit the blimp with the mouse.
        const dist = 48;
        const cp = Math.cos(app.pitch), sp = Math.sin(app.pitch);
        cam = new THREE.Vector3(pos.x + Math.sin(app.yaw) * cp * dist, pos.y - sp * dist + 10, pos.z + Math.cos(app.yaw) * cp * dist);
        const doors = app.game.renderTick - this.route.start >= BUS_DOORS_TICKS;
        $('jump-prompt').hidden = false;
        $('jump-prompt').innerHTML = doors ? '<kbd>SPACE</kbd> Jump' : 'Doors opening…';
      } else $('jump-prompt').hidden = true;
    } else $('jump-prompt').hidden = true;
    // Spectating after being eliminated.
    const spec = me && me.move.mode === MODE_DEAD && this.phase && this.phase !== 'pregame' ? this.spectateTarget() : null;
    $('spectating').hidden = !spec;
    if (spec) $('spectating').innerHTML = `Spectating <b>${escapeHtml(app.game.roster.get(spec.id)?.name || '')}</b>`;
    return cam ? { pos: cam, look: this.blimp.position } : spec ? { spectate: spec } : null;
  }

  /** Whoever we are watching: our killer, or anyone still standing nearby. */
  spectateTarget() {
    const states = this.app.game.remoteStates([]);
    let s = states.find((x) => x.id === this.spectating && x.mode !== MODE_DEAD);
    if (!s) { s = states.find((x) => x.mode !== MODE_DEAD && x.mode !== MODE_BUS); if (s) this.spectating = s.id; }
    return s || null;
  }

  jump() { if (this.app.game.me?.move.mode === MODE_BUS) this.app.queueAction({ type: A_JUMP }); }
}

function makeBlimp() {
  const g = new THREE.Group();
  const balloon = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), mat(0xd9453a));
  balloon.scale.set(22, 8, 8);
  const stripe = new THREE.Mesh(new THREE.SphereGeometry(1.01, 24, 14), mat(0xffcf3f));
  stripe.scale.set(22.1, 3, 8.1);
  const gondola = new THREE.Mesh(new THREE.BoxGeometry(12, 3.2, 4.4), mat(0x2f4a8a));
  gondola.position.y = -9.5;
  const windows = new THREE.Mesh(new THREE.BoxGeometry(10, 1, 4.5), mat(0xbfe4ff, { emissive: 0x223344 }));
  windows.position.y = -9.2;
  g.add(balloon, stripe, gondola, windows);
  for (const [y, z, rx] of [[0, 0, 0], [0, 0, Math.PI / 2]]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(5, 9, 0.4), mat(0xffcf3f));
    fin.position.set(-20, y, z);
    fin.rotation.x = rx;
    g.add(fin);
  }
  const prop = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.8), mat(0x333333));
  prop.position.set(-24, 0, 0);
  prop.userData.prop = true;
  g.add(prop);
  for (const x of [-4, 4]) {
    const rope = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3, 0.15), mat(0x444444));
    rope.position.set(x, -7, 0);
    g.add(rope);
  }
  return g;
}

const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
