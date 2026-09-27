// Boots the client: generates the island (the same one the server has), sets
// up the renderer, connects, and runs the frame loop — fixed 30 Hz input and
// prediction ticks underneath, rendering as fast as the display allows.

import * as THREE from 'three';
import { getWorld, MAP_SEED } from '#shared/worldgen.js';
import { TICK_MS } from '#shared/constants.js';
import { BTN_JUMP, BTN_SPRINT, BTN_CROUCH, BTN_FIRE, BTN_ADS, BTN_USE, eyeHeight } from '#shared/movement.js';
import { quantizeYaw, quantizePitch } from '#shared/protocol.js';
import { createScene } from './render/scene.js';
import { TerrainRenderer } from './render/terrain.js';
import { Avatar, mat } from './render/avatars.js';
import { PieceRenderer } from './render/pieces.js';
import { PropRenderer } from './render/props.js';
import { Particles, WeakMarker } from './render/fx.js';
import { Audio } from './audio.js';
import { B_PIECES, B_PROPS, B_HITS } from '#shared/protocol.js';
import { readPieces, readProps } from '#shared/records.js';
import { readEvents, EV_HARVEST, EV_BREAK, EV_SWING, EV_IMPACT } from '#shared/events.js';
import { PICKAXES } from '#shared/cosmetics.js';
import { ThirdPersonCamera } from './camera.js';
import { ClientGame } from './game.js';
import { Net } from './net.js';
import { Input } from './input.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

class App {
  async boot() {
    $('loading-text').textContent = 'Raising the island…';
    await nextFrame();
    const t0 = performance.now();
    this.base = getWorld(MAP_SEED);
    this.genMs = performance.now() - t0;
    $('loading-text').textContent = 'Painting the landscape…';
    await nextFrame();

    this.canvas = $('view');
    this.gfx = createScene(this.canvas);
    this.terrain = new TerrainRenderer(this.gfx.scene, this.base.terrain);
    this.cam = new ThirdPersonCamera(this.gfx.camera);
    this.input = new Input(this.canvas);
    this.game = new ClientGame(this.base);
    this.pieceR = new PieceRenderer(this.gfx.scene);
    this.propR = new PropRenderer(this.gfx.scene);
    this.fillRenderers();
    this.fx = new Particles(this.gfx.scene);
    this.weak = new WeakMarker(this.gfx.scene);
    this.audio = new Audio();
    this.mats = [0, 0, 0];
    this.swingAt = -1e9;
    this.game.onBlock(B_PIECES, readPieces, (list) => this.game.applyPieces(list, this.pieceHooks));
    this.game.onBlock(B_PROPS, readProps, (list) => this.game.applyProps(list, this.propHooks));
    this.game.onBlock(B_HITS, readEvents, (events) => this.onEvents(events));
    this.pieceHooks = { added: (p) => this.pieceR.add(p), changed: (p) => this.pieceR.update(p), removed: (p) => this.pieceR.remove(p) };
    this.propHooks = { changed: (p) => this.propR.paint(p), removed: (p) => this.propR.remove(p) };
    this.avatars = new Map();
    window.addEventListener('pointerdown', () => this.audio.unlock());
    window.addEventListener('keydown', () => this.audio.unlock());
    this.state = 'menu';
    this.yaw = 0;
    this.pitch = 0;
    this.acc = 0;
    this.last = performance.now();
    this.fps = 60;
    this.remote = [];

    this.net = new Net();
    this.net.on('json', (msg) => this.onJson(msg));
    this.net.on('snapshot', (data) => this.onSnapshot(data));
    this.net.on('close', () => this.onDisconnect());
    this.net.connect();

    $('name').value = localStorage.getItem('sw.name') || '';
    $('play').onclick = () => this.play();
    $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.play(); });
    $('click-to-play').onclick = () => this.input.lock();
    document.addEventListener('pointerlockchange', () => this.updateLockPrompt());

    $('loading').hidden = true;
    $('menu').hidden = false;
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Draws every piece and prop of the client's current world copy. */
  fillRenderers() {
    for (const b of this.pieceR.buckets.values()) { this.gfx.scene.remove(b.mesh); b.mesh.dispose(); }
    for (const b of this.propR.buckets.values()) { this.gfx.scene.remove(b.mesh); b.mesh.dispose(); }
    this.pieceR.buckets.clear(); this.pieceR.where.clear(); this.pieceR.animating.clear();
    this.propR.buckets.clear(); this.propR.where.clear();
    for (const p of this.game.world.pieces.values()) this.pieceR.add(p);
    for (const p of this.game.world.props) if (p && p.alive) this.propR.add(p);
  }

  onEvents(events) {
    const meId = this.game.me?.id;
    for (const e of events) {
      const pos = { x: e.x, y: e.y, z: e.z };
      switch (e.type) {
        case EV_HARVEST:
          this.fx.chips(e.x, e.y, e.z, e.b, e.c === 1);
          this.audio.hit(pos, e.b, e.c === 1 && e.a === meId);
          break;
        case EV_BREAK:
          this.fx.burst(e.x, e.y, e.z, { count: 26, color: [0xb07a44, 0x9a8f86, 0xa8b4bc][e.b] ?? 0x999999, speed: 6, size: 0.22, life: 1.1 });
          this.audio.crumble(pos, e.b);
          break;
        case EV_SWING:
          if (e.a !== meId) { const av = this.avatars.get(e.a); if (av) av.swingAt = performance.now(); this.audio.swing(pos); }
          break;
        case EV_IMPACT:
          this.fx.burst(e.x, e.y, e.z, { count: 5, color: 0x8a7a5a, speed: 2, size: 0.08, life: 0.4 });
          this.audio.hit(pos, 3, false);
          break;
        default:
      }
    }
  }

  play() {
    const name = $('name').value.trim().slice(0, 16) || 'Player';
    localStorage.setItem('sw.name', name);
    this.net.sendJson({ t: 'hello', name });
    this.net.sendJson({ t: 'play', mode: 'sandbox' });
    $('play').disabled = true;
    this.input.lock();
  }

  onJson(msg) {
    switch (msg.t) {
      case 'welcome':
        if (msg.hash !== this.base.hash) console.error(`World mismatch: server ${msg.hash}, client ${this.base.hash}`);
        break;
      case 'match':
        if (this.game.freshWorld(msg.id)) this.fillRenderers();
        this.game.start(msg);
        this.state = 'match';
        $('menu').hidden = true;
        $('hud').hidden = false;
        $('play').disabled = false;
        this.updateLockPrompt();
        break;
      case 'hurt': this.flash(); break;
      case 'died':
        $('vignette').classList.add('dead');
        this.toast(msg.cause === 'fall' ? 'YOU FELL TO YOUR DEATH' : 'ELIMINATED', 3000);
        break;
      case 'respawned':
        $('vignette').classList.remove('dead');
        this.toast('BACK ON YOUR FEET', 1500);
        break;
      case 'inv':
        this.mats = msg.mats;
        this.updateInventory(msg);
        break;
      case 'weak': this.weak.show(msg.x === undefined ? null : msg); break;
      case 'joined': this.game.roster.set(msg.player.id, msg.player); break;
      case 'left': this.game.roster.delete(msg.id); break;
      default:
    }
  }

  flash() {
    const v = $('vignette');
    v.classList.add('show');
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => v.classList.remove('show'), 120);
  }

  toast(text, ms = 2000) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  onSnapshot(data) {
    const snap = this.game.onSnapshot(data, performance.now());
    if (snap && snap.self && !this.aimed) {
      this.aimed = true;
      this.yaw = 0; this.pitch = -0.1;
    }
  }

  onDisconnect() {
    this.state = 'menu';
    $('hud').hidden = true;
    $('menu').hidden = false;
    $('loading-text').textContent = 'Connection lost — reconnecting…';
    setTimeout(() => this.net.connect(), 1500);
  }

  updateLockPrompt() {
    $('click-to-play').hidden = !(this.state === 'match' && !this.input.locked);
  }

  /* ------------------------------------------------------------ loop */

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    if (this.state === 'match' && this.game.me) this.matchFrame(now, dt);
    else this.menuFrame(now, dt);
    this.gfx.renderer.render(this.gfx.scene, this.gfx.camera);
    requestAnimationFrame((t) => this.frame(t));
  }

  menuFrame(now) {
    // A slow flight around the island behind the menu.
    const a = now / 40000;
    const cam = this.gfx.camera;
    cam.position.set(2560 + Math.cos(a) * 1500, 420, 2560 + Math.sin(a) * 1500);
    cam.lookAt(2560, 30, 2560);
    this.terrain.update(cam.position);
    this.gfx.follow(cam.position, 420);
  }

  matchFrame(now, dt) {
    const game = this.game;
    const mouse = this.input.takeMouse();
    if (this.input.locked) {
      this.yaw -= mouse.dx * this.input.sensitivity;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - mouse.dy * this.input.sensitivity));
    }
    game.advanceRender(now, dt * 1000);

    // Fixed-rate ticks: sample input, predict, send.
    this.acc += dt * 1000;
    let ticks = 0;
    while (this.acc >= TICK_MS && ticks < 4) {
      this.acc -= TICK_MS;
      ticks++;
      const input = this.sampleInput();
      game.predict(input);
      this.net.sendInput(input);
      this.predictSwing(input, now);
    }
    if (this.acc > TICK_MS * 4) this.acc = 0;

    const alpha = this.acc / TICK_MS;
    const me = game.me;
    const pos = game.localRenderPos(alpha, dt);
    const renderMove = { ...me.move, x: pos.x, y: pos.y, z: pos.z };
    const ads = this.input.mouse.right && this.input.locked;
    this.cam.update(dt, renderMove, this.yaw, this.pitch, ads, game.world.grid);
    $('crosshair').classList.toggle('ads', ads);

    this.drawPlayers(dt, pos);
    this.pieceR.frame(game.renderTick);
    this.fx.update(dt);
    this.weak.update(dt);
    this.audio.listen(this.gfx.camera);
    this.propR.cull(this.gfx.camera.position, this.gfx.scene.fog.far);
    this.terrain.update(this.gfx.camera.position);
    const ground = this.base.terrain.heightAt(pos.x, pos.z);
    this.gfx.follow(pos, this.gfx.camera.position.y - ground);
    this.updateHud(pos);
  }

  /** Shows the pickaxe swing straight away; the server decides what it hits. */
  predictSwing(input, now) {
    if (!(input.buttons & BTN_FIRE) || now - this.swingAt < 500) return;
    this.swingAt = now;
    const m = this.game.me.move;
    this.audio.swing({ x: m.x, y: m.y + 1.5, z: m.z });
  }

  updateInventory(msg) {
    for (let i = 0; i < 3; i++) document.getElementById(`mat-${i}`).textContent = msg.mats[i];
  }

  sampleInput() {
    const inp = this.input;
    // Keys work whenever a match is on screen; the mouse only once it is captured.
    const active = this.state === 'match';
    const mouseOn = inp.locked;
    const axis = (a, b) => (active ? (inp.held(a) ? 1 : 0) - (inp.held(b) ? 1 : 0) : 0);
    let buttons = 0;
    if (active) {
      if (inp.held('jump')) buttons |= BTN_JUMP;
      if (inp.held('sprint')) buttons |= BTN_SPRINT;
      if (inp.held('crouch')) buttons |= BTN_CROUCH;
      if (mouseOn && inp.mouse.left) buttons |= BTN_FIRE;
      if (mouseOn && inp.mouse.right) buttons |= BTN_ADS;
      if (inp.held('interact')) buttons |= BTN_USE;
      buttons |= this.forceButtons || 0;     // test hook: hold buttons without a captured mouse
    }
    return {
      mx: axis('right', 'left'), mz: axis('forward', 'back'),
      yaw: quantizeYaw(this.yaw), pitch: quantizePitch(this.pitch), buttons, actions: [],
    };
  }

  drawPlayers(dt, pos) {
    const game = this.game;
    const seen = new Set();
    const me = game.me;
    const mine = this.avatarFor(me.id);
    const sp = Math.sqrt(me.move.vx * me.move.vx + me.move.vz * me.move.vz);
    const now = performance.now();
    mine.hold('pickaxe', () => pickaxeMesh(this.game.roster.get(me.id)?.pickaxe || 0));
    mine.update(dt, { ...me.move, x: pos.x, y: pos.y, z: pos.z, yaw: this.yaw, pitch: this.pitch, speed: sp, armed: false, swing: swingPhase(now - this.swingAt) });
    seen.add(me.id);
    for (const s of game.remoteStates(this.remote)) {
      const av = this.avatarFor(s.id);
      if (s.held === 0) av.hold('pickaxe', () => pickaxeMesh(this.game.roster.get(s.id)?.pickaxe || 0));
      av.update(dt, { ...s, crouch: s.flags & 1, ground: s.flags & 32, armed: false, swing: swingPhase(performance.now() - (av.swingAt || -1e9)) });
      seen.add(s.id);
    }
    for (const [id, av] of this.avatars) {
      if (!seen.has(id)) { this.gfx.scene.remove(av.object); this.avatars.delete(id); }
    }
  }

  avatarFor(id) {
    let av = this.avatars.get(id);
    if (!av) {
      const meta = this.game.roster.get(id) || {};
      av = new Avatar(meta.outfit || 0, meta.glider || 0);
      this.avatars.set(id, av);
      this.gfx.scene.add(av.object);
    }
    return av;
  }

  updateHud(pos) {
    const me = this.game.me;
    $('hp-fill').style.transform = `scaleX(${Math.max(0, me.hp) / 100})`;
    $('hp-num').textContent = Math.ceil(me.hp);
    $('shield-fill').style.transform = `scaleX(${Math.max(0, me.shield) / 100})`;
    $('shield-num').textContent = Math.ceil(me.shield);
    if (!this.debugAt || performance.now() - this.debugAt > 250) {
      this.debugAt = performance.now();
      $('debug').textContent = `${Math.round(this.fps)} fps · ${Math.round(this.net.rtt)} ms · ${this.game.players.size + 1} near`
        + `\n${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)} · gen ${Math.round(this.genMs)} ms`;
    }
  }
}

/** 0‥1 through a pickaxe swing that started `ms` ago, 0 when not swinging. */
function swingPhase(ms) { return ms >= 0 && ms < 350 ? ms / 350 : 0; }

function pickaxeMesh(id) {
  const def = PICKAXES[id] || PICKAXES[0];
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.85, 0.05), mat(def.handle));
  handle.position.y = -0.3;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.62), mat(def.head));
  head.position.set(0, -0.68, -0.06);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.18), mat(def.head));
  tip.position.set(0, -0.72, -0.42);
  tip.rotation.x = -0.4;
  g.add(handle, head, tip);
  g.rotation.x = -0.5;
  for (const m of g.children) m.castShadow = true;
  return g;
}

const app = new App();
window.stormwall = app;
app.boot().catch((error) => {
  console.error(error);
  $('loading-text').textContent = `Something went wrong: ${error.message}`;
});
void THREE; void eyeHeight;
