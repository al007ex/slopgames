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
import { Avatar } from './render/avatars.js';
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
    this.avatars = new Map();
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
        this.game.start(msg);
        this.state = 'match';
        $('menu').hidden = true;
        $('hud').hidden = false;
        $('play').disabled = false;
        this.updateLockPrompt();
        break;
      case 'joined': this.game.roster.set(msg.player.id, msg.player); break;
      case 'left': this.game.roster.delete(msg.id); break;
      default:
    }
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
    }
    if (this.acc > TICK_MS * 4) this.acc = 0;

    const alpha = this.acc / TICK_MS;
    const me = game.me;
    const pos = game.localRenderPos(alpha, dt);
    const renderMove = { ...me.move, x: pos.x, y: pos.y, z: pos.z };
    const ads = this.input.mouse.right && this.input.locked;
    this.cam.update(dt, renderMove, this.yaw, this.pitch, ads, game.world.grid);

    this.drawPlayers(dt, pos);
    this.terrain.update(this.gfx.camera.position);
    const ground = this.base.terrain.heightAt(pos.x, pos.z);
    this.gfx.follow(pos, this.gfx.camera.position.y - ground);
    this.updateHud(pos);
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
    mine.update(dt, { ...me.move, x: pos.x, y: pos.y, z: pos.z, yaw: this.yaw, pitch: this.pitch, speed: sp, armed: false });
    seen.add(me.id);
    for (const s of game.remoteStates(this.remote)) {
      const av = this.avatarFor(s.id);
      av.update(dt, { ...s, crouch: s.flags & 1, ground: s.flags & 32, armed: false });
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

const app = new App();
window.stormwall = app;
app.boot().catch((error) => {
  console.error(error);
  $('loading-text').textContent = `Something went wrong: ${error.message}`;
});
void THREE; void eyeHeight;
