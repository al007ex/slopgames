// The lobby around the Play button: your level, XP and coins, the locker
// (cosmetics — earned or bought with coins you earned, never with money),
// today's challenges, and your career stats and the leaderboards.

import * as THREE from 'three';
import { CATALOG, isUnlocked, levelFromXp } from '#shared/progression.js';
import { Avatar } from './render/avatars.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const SWATCH = {
  outfit: (i) => [i.shirt, i.pants, i.skin, i.hair],
  glider: (i) => [i.a, i.b],
  pickaxe: (i) => [i.head, i.handle],
};

export class LobbyView {
  constructor(app) {
    this.app = app;
    this.profile = null;
    this.tab = 'play';
    this.lockerKind = 'outfit';
    this.board = 'wins';
    for (const b of document.querySelectorAll('#lobby-tabs button')) b.onclick = () => this.show(b.dataset.tab);
    for (const b of document.querySelectorAll('#locker-kinds button')) b.onclick = () => { this.lockerKind = b.dataset.kind; this.renderLocker(); };
    for (const b of document.querySelectorAll('#board-kinds button')) b.onclick = () => { this.board = b.dataset.board; this.renderBoard(); };
    this.preview = null;
  }

  show(tab) {
    this.tab = tab;
    for (const b of document.querySelectorAll('#lobby-tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
    for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== `panel-${tab}`;
    if (tab === 'career') this.app.net.sendJson({ t: 'leaderboard' });
    if (tab === 'locker') this.startPreview();
    this.render();
  }

  onProfile(p) {
    this.profile = p;
    this.render();
  }

  onLeaderboard(lb) { this.leaderboard = lb; this.renderBoard(); }

  render() {
    const p = this.profile;
    if (!p) return;
    $('lv-num').textContent = p.level;
    $('xp-fill').style.transform = `scaleX(${Math.min(1, p.into / p.need)})`;
    $('xp-text').textContent = `${p.into} / ${p.need} XP`;
    $('coins').textContent = p.coins.toLocaleString();
    if (this.tab === 'locker') this.renderLocker();
    if (this.tab === 'challenges') this.renderChallenges();
    if (this.tab === 'career') this.renderCareer();
  }

  renderLocker() {
    const p = this.profile;
    if (!p) return;
    for (const b of document.querySelectorAll('#locker-kinds button')) b.classList.toggle('on', b.dataset.kind === this.lockerKind);
    const kind = this.lockerKind;
    const account = { xp: p.xp, owned: p.owned };
    $('locker-items').innerHTML = CATALOG[kind].map((item) => {
      const unlocked = isUnlocked(account, kind, item.id);
      const equipped = p.equipped[kind] === item.id;
      const state = equipped ? '<em class="eq">Equipped</em>' : unlocked ? '<em>Equip</em>'
        : item.price > 0 ? `<em class="buy">${item.price.toLocaleString()} ◈</em>` : `<em class="lock">Level ${item.level}</em>`;
      const sw = SWATCH[kind](item).map((c) => `<i style="background:${hex(c)}"></i>`).join('');
      return `<button class="item ${equipped ? 'on' : ''} ${unlocked ? '' : 'locked'}" data-id="${item.id}"><span class="sw">${sw}</span><b>${esc(item.name)}</b>${state}</button>`;
    }).join('');
    for (const el of document.querySelectorAll('#locker-items .item')) {
      el.onclick = () => {
        const id = Number(el.dataset.id);
        const item = CATALOG[kind][id];
        if (isUnlocked(account, kind, id)) this.app.net.sendJson({ t: 'equip', kind, id });
        else if (item.price > 0) this.app.net.sendJson({ t: 'buy', kind, id });
      };
    }
    this.updatePreview();
  }

  renderChallenges() {
    const d = this.profile.daily;
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const hours = Math.floor((next - now) / 3600000), mins = Math.floor(((next - now) % 3600000) / 60000);
    $('challenge-reset').textContent = `New challenges in ${hours}h ${mins}m`;
    $('challenge-list').innerHTML = d.challenges.map((c) => `<div class="challenge ${c.done ? 'done' : ''}">`
      + `<div class="ch-top"><b>${esc(c.text)}</b><span>${c.done ? '✓ Done' : `${c.progress} / ${c.goal}`}</span></div>`
      + `<div class="ch-bar"><i style="transform:scaleX(${Math.min(1, c.progress / c.goal)})"></i></div><small>+250 XP · +100 ◈</small></div>`).join('');
  }

  renderCareer() {
    const s = this.profile.stats;
    const mins = Math.round(s.timePlayed / 60);
    $('career-stats').innerHTML = [
      ['Matches', s.matches], ['Wins', s.wins], ['Top 10%', s.top10], ['Eliminations', s.kills],
      ['K/D', s.kd], ['Win rate', s.matches ? `${Math.round((100 * s.wins) / s.matches)}%` : '—'], ['Damage', s.damage.toLocaleString()], ['Time played', `${mins} min`],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    this.renderBoard();
  }

  renderBoard() {
    for (const b of document.querySelectorAll('#board-kinds button')) b.classList.toggle('on', b.dataset.board === this.board);
    const lb = this.leaderboard;
    if (!lb) { $('board').innerHTML = '<p class="hint">Loading…</p>'; return; }
    const rows = lb[this.board];
    const me = this.profile?.name;
    $('board').innerHTML = rows.length ? rows.map((r, i) => `<div class="lb-row ${r.name === me ? 'me' : ''}"><span>${i + 1}</span><b>${esc(r.name)}</b><em>${this.board === 'level' ? `Lv ${r.level}` : this.board === 'wins' ? `${r.wins} wins` : `${r.kills} elims`}</em><small>K/D ${r.kd}</small></div>`).join('')
      : '<p class="hint">Nobody has finished a match yet. Be the first.</p>';
  }

  /* A turntable of your character in the locker. */
  startPreview() {
    if (this.preview) return;
    const canvas = $('locker-preview');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfefff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    camera.position.set(0, 1.9, 5.8);
    camera.lookAt(0, 1.25, 0);
    this.preview = { renderer, scene, camera, avatar: null, key: '' };
    const loop = () => {
      if (!this.preview) return;
      requestAnimationFrame(loop);
      if (this.tab !== 'locker' || $('menu').hidden) return;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * renderer.getPixelRatio()) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
      const a = this.preview.avatar;
      if (a) { a.object.rotation.y += 0.01; a.update(0.016, { x: 0, y: 0, z: 0, yaw: a.object.rotation.y, pitch: 0, mode: this.lockerKind === 'glider' ? 2 : 0, ground: 1, speed: 0, armed: false }); a.object.rotation.y += 0.01; }
      renderer.render(scene, camera);
    };
    loop();
    this.updatePreview();
  }

  updatePreview() {
    if (!this.preview || !this.profile) return;
    const e = this.profile.equipped;
    const key = `${e.outfit}:${e.glider}:${e.pickaxe}`;
    if (key === this.preview.key) return;
    this.preview.key = key;
    if (this.preview.avatar) this.preview.scene.remove(this.preview.avatar.object);
    const a = new Avatar(e.outfit, e.glider);
    a.hold(`pick${e.pickaxe}`, () => this.app.pickaxeMesh(e.pickaxe));
    if (this.lockerKind === 'glider') a.object.position.y = -0.6;
    this.preview.scene.add(a.object);
    this.preview.avatar = a;
  }

  /** The extra lines on the results screen: XP, level-ups and finished challenges. */
  resultsExtras(res) {
    const lines = [];
    if (res.xp) lines.push(`+${res.xp} XP · +${res.coins} ◈`);
    if (res.levelUp) lines.push(`LEVEL UP! You are now level ${res.level}`);
    for (const c of res.completed || []) lines.push(`Challenge complete: ${c}`);
    return lines.join('<br>');
  }
}

export { levelFromXp };
