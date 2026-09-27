// Duos and squads on the client: the team panel (health, shield, knocked),
// name tags over teammates, pings, and the revive prompt and progress.

import * as THREE from 'three';
import { aimFrame, aimPoint } from '#shared/aim.js';
import { MODE_DBNO } from '#shared/movement.js';
import { PF_TEAM } from '#shared/protocol.js';
import { A_PING, A_INTERACT } from '#shared/protocol.js';
import { TICK_HZ } from '#shared/constants.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TEAM_COLORS = ['#ffd24a', '#4fd2ff', '#7cf07a', '#ff8ad8'];

export class TeamView {
  constructor(app) {
    this.app = app;
    this.members = [];
    this.pings = [];
    this.revive = null;
    this.tags = new Map();
    this.pingGroup = new THREE.Group();
    app.gfx.scene.add(this.pingGroup);
  }

  reset() {
    this.members = []; this.pings = []; this.revive = null;
    for (const el of this.tags.values()) el.remove();
    this.tags.clear();
    this.pingGroup.clear();
    $('team').innerHTML = '';
    this.app.map.pings = [];
  }

  colorOf(id) {
    const i = this.members.findIndex((m) => m.id === id);
    return TEAM_COLORS[Math.max(0, i) % TEAM_COLORS.length];
  }

  onTeam(msg) {
    this.members = msg.members;
    const me = this.app.game.me?.id;
    const others = this.members.filter((m) => m.id !== me);
    $('team').innerHTML = others.map((m) => {
      const name = esc(this.app.game.roster.get(m.id)?.name || '???');
      const state = !m.alive ? 'out' : m.dbno ? 'down' : '';
      return `<div class="mate ${state}"><i style="background:${this.colorOf(m.id)}"></i><span>${name}</span>`
        + `<div class="mbar"><b class="sh" style="width:${m.shield}%"></b></div>`
        + `<div class="mbar"><b class="${m.dbno ? 'dn' : 'hp'}" style="width:${m.dbno || m.hp}%"></b></div></div>`;
    }).join('');
  }

  /** Map markers for teammates, wherever they are (on the blimp too). */
  marks() {
    const me = this.app.game.me?.id;
    return this.members.filter((m) => m.id !== me && m.alive).map((m) => {
      const live = this.app.game.players.get(m.id)?.state;
      return { x: live ? live.x : m.x, z: live ? live.z : m.z, color: this.colorOf(m.id) };
    });
  }

  ping() {
    const game = this.app.game;
    const f = aimFrame(game.me.move, this.app.yawQ(), this.app.pitchQ(), false, {});
    const p = aimPoint(f, game.world.grid, 400, {});
    this.app.queueAction({ type: A_PING, x: p.x, y: p.y, z: p.z });
  }

  onPing(msg) {
    this.pings = this.pings.filter((p) => p.from !== msg.from);
    const color = this.colorOf(msg.from);
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
    marker.renderOrder = 7;
    marker.position.set(msg.x, msg.y + 2.5, msg.z);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 60, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false }));
    beam.position.set(msg.x, msg.y + 30, msg.z);
    this.pingGroup.add(marker, beam);
    this.pings.push({ ...msg, marker, beam });
    this.app.map.pings = this.pings;
    this.app.audio.tone(null, { freq: 880, to: 1320, gain: 0.12, dur: 0.15, type: 'triangle' });
  }

  onReviving(msg) {
    if (msg.cancelled || msg.done) { this.revive = null; return; }
    const name = this.app.game.roster.get(msg.by || msg.target)?.name || '';
    this.revive = { label: msg.by ? `${name} is reviving you` : `Reviving ${name}`, start: msg.start ?? msg.end - 10 * TICK_HZ, end: msg.end };
  }

  frame(dt) {
    const app = this.app;
    const tick = app.game.renderTick;
    // Pings fade out.
    this.pings = this.pings.filter((p) => {
      if (tick > p.until) { this.pingGroup.remove(p.marker, p.beam); return false; }
      p.marker.rotation.y += dt * 2;
      return true;
    });
    app.map.pings = this.pings;
    // Name tags over teammates within sight.
    const cam = app.gfx.camera;
    const v = new THREE.Vector3();
    const seen = new Set();
    for (const s of app.game.remoteStates([])) {
      if (!(s.flags & PF_TEAM)) continue;
      seen.add(s.id);
      let el = this.tags.get(s.id);
      if (!el) { el = document.createElement('div'); el.className = 'mate-tag'; $('hud').appendChild(el); this.tags.set(s.id, el); }
      v.set(s.x, s.y + 2.25, s.z).project(cam);
      const onScreen = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.hidden = !onScreen;
      if (!onScreen) continue;
      el.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
      el.style.color = this.colorOf(s.id);
      el.textContent = `${s.mode === MODE_DBNO ? '✚ ' : ''}${app.game.roster.get(s.id)?.name || ''}`;
    }
    for (const [id, el] of this.tags) if (!seen.has(id)) { el.remove(); this.tags.delete(id); }
    // Revive progress.
    const bar = $('revive');
    if (this.revive) {
      bar.hidden = false;
      bar.querySelector('span').style.transform = `scaleX(${Math.max(0, Math.min(1, (tick - this.revive.start) / (this.revive.end - this.revive.start)))})`;
      bar.querySelector('b').textContent = this.revive.label;
    } else bar.hidden = true;
  }

  /** A knocked teammate close enough to revive, for the interact prompt. */
  reviveTarget(pos) {
    for (const s of this.app.game.remoteStates([])) {
      if (!(s.flags & PF_TEAM) || s.mode !== MODE_DBNO) continue;
      if (Math.hypot(s.x - pos.x, s.z - pos.z) < 2.6) return s;
    }
    return null;
  }

  startRevive(id) { this.app.queueAction({ type: A_INTERACT, kind: 3, id }); }
}
