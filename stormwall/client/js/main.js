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
import { BuildController } from './build.js';
import { Loadout } from './inventory.js';
import { ShotFx, handModel } from './render/weapons.js';
import { WEAPONS, itemKey, itemId } from '#shared/items.js';
import { EV_SHOT, EV_EXPLOSION, EV_RELOAD } from '#shared/events.js';
import { B_PROJECTILES } from '#shared/protocol.js';
import { ThirdPersonCamera } from './camera.js';
import { ClientGame } from './game.js';
import { Net } from './net.js';
import { Input } from './input.js';

const $ = (id) => document.getElementById(id);
// Lets the loading text paint before a long synchronous step — without
// waiting forever in a background tab, where animation frames never come.
const nextFrame = () => new Promise((resolve) => {
  let done = false;
  const go = () => { if (!done) { done = true; setTimeout(resolve, 0); } };
  requestAnimationFrame(go);
  setTimeout(go, 80);
});

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
    this.shotFx = new ShotFx(this.gfx.scene);
    this.weak = new WeakMarker(this.gfx.scene);
    this.audio = new Audio();
    this.mats = [0, 0, 0];
    this.swingAt = -1e9;
    this.game.onBlock(B_PIECES, readPieces, (list) => this.game.applyPieces(list, this.pieceHooks));
    this.game.onBlock(B_PROPS, readProps, (list) => this.game.applyProps(list, this.propHooks));
    this.game.onBlock(B_HITS, readEvents, (events) => this.onEvents(events));
    this.game.onBlock(B_PROJECTILES, (r) => {
      const n = r.u16(); const out = [];
      for (let i = 0; i < n; i++) out.push({ id: r.u16(), kind: r.u8(), x: r.f32(), y: r.f32(), z: r.f32() });
      return out;
    }, (list) => this.shotFx.setProjectiles(list));
    this.pieceHooks = {
      added: (p) => { this.build.confirmSlot(p); this.pieceR.add(p); },
      changed: (p) => this.pieceR.update(p),
      removed: (p) => this.pieceR.remove(p),
    };
    this.propHooks = { changed: (p) => this.propR.paint(p), removed: (p) => this.propR.remove(p) };
    this.avatars = new Map();
    this.actions = [];
    this.build = new BuildController(this);
    this.loadout = new Loadout(this);
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
    // Some embedded views stop animation frames while not being painted; keep
    // the simulation ticking anyway. Hidden tabs throttle this to 1 Hz, so it
    // costs nothing there.
    setInterval(() => { if (performance.now() - this.last > 120) this.frame(performance.now(), false); }, 50);
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
        case EV_SHOT: {
          if (e.a === meId) break;           // our own shots were drawn when we fired
          const av = this.avatars.get(e.a);
          const key = itemKey(e.b);
          const from = av ? { x: av.object.position.x, y: av.object.position.y + 1.4, z: av.object.position.z } : pos;
          if (!WEAPONS[key]?.projectile) this.shotFx.tracer(from, pos);
          this.audio.gun(from, WEAPONS[key]?.cls);
          if (av) this.shotFx.muzzle(from);
          break;
        }
        case EV_EXPLOSION: {
          this.shotFx.explosion(e.x, e.y, e.z, e.b || 4);
          this.fx.burst(e.x, e.y, e.z, { count: 30, color: 0x444444, speed: 9, size: 0.3, life: 1.2 });
          this.audio.boom(pos);
          const m = this.game.me?.move;
          if (m) { const d = Math.hypot(m.x - e.x, m.y - e.y, m.z - e.z); if (d < 30) this.cam.shake = Math.max(this.cam.shake, 0.6 * (1 - d / 30)); }
          break;
        }
        case EV_RELOAD: if (e.a !== meId) this.audio.reload(pos); else this.audio.reload(null); break;
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
        this.loadout.sync(msg);
        break;
      case 'hit': this.loadout.onHit(msg); break;
      case 'note': this.hudNote(msg.text); break;
      case 'feed': this.addFeed(msg); break;
      case 'weak': this.weak.show(msg.x === undefined ? null : msg); break;
      case 'build-denied': this.build.denied(msg); break;
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

  frame(now, fromRaf = true) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (fromRaf) this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    if (this.state === 'match' && this.game.me) this.matchFrame(now, dt);
    else this.menuFrame(now, dt);
    if (!fromRaf) return;
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
    this.handlePresses(mouse.wheel);

    // Fixed-rate ticks: sample input, predict, send.
    this.acc += dt * 1000;
    let ticks = 0;
    while (this.acc >= TICK_MS && ticks < 4) {
      this.acc -= TICK_MS;
      ticks++;
      const input = this.sampleInput();
      game.predict(input);
      this.net.sendInput(input);
      if (this.loadout.held === 0) this.predictSwing(input, now);
      else this.loadout.predict(input, now);
    }
    if (this.acc > TICK_MS * 4) this.acc = 0;

    const alpha = this.acc / TICK_MS;
    const me = game.me;
    const pos = game.localRenderPos(alpha, dt);
    const renderMove = { ...me.move, x: pos.x, y: pos.y, z: pos.z };
    const ads = ((this.input.mouse.right && this.input.locked) || (this.forceButtons & BTN_ADS)) && this.build.mode === 'weapon';
    const w = this.loadout.weapon;
    const scope = ads && w && WEAPONS[w.key].scope;
    this.cam.update(dt, renderMove, this.yaw, this.pitch, ads, game.world.grid, scope || 55);
    $('crosshair').style.setProperty('--spread', `${this.loadout.crosshairGap(ads)}px`);
    $('crosshair').hidden = !!scope && this.cam.adsBlend > 0.8;
    $('scope').hidden = !(scope && this.cam.adsBlend > 0.8);
    this.loadout.frame(dt);
    this.shotFx.update(dt);

    this.drawPlayers(dt, pos);
    this.pieceR.frame(game.renderTick);
    this.build.frame(this.input.mouse.left);
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
    this.mats = msg.mats.slice();
    this.updateMats();
  }

  updateMats() {
    for (let i = 0; i < 3; i++) {
      const el = document.getElementById(`mat-${i}`);
      el.textContent = this.mats[i];
      el.parentElement.classList.toggle('selected', this.build.mode === 'build' && this.build.mat === i);
    }
  }

  queueAction(a) { this.actions.push(a); }
  yawQ() { return quantizeYaw(this.yaw); }
  pitchQ() { return quantizePitch(this.pitch); }

  onBuildMode() {
    const b = this.build;
    document.querySelectorAll('#buildbar .piece').forEach((el, i) => el.classList.toggle('active', b.mode === 'build' && b.piece === i));
    $('buildbar').classList.toggle('on', b.mode !== 'weapon');
    $('buildbar').dataset.mode = b.mode;
    this.updateMats();
  }

  hudNote(text) {
    const n = $('note');
    n.textContent = text;
    n.classList.add('show');
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => n.classList.remove('show'), 1200);
  }

  /** Key presses and clicks, handled once per frame. */
  handlePresses(wheel) {
    for (const action of this.input.takePresses()) {
      if (this.build.onPress(action)) continue;
      if (this.loadout.onPress(action)) continue;
      this.onPress?.(action);
    }
    for (const button of this.input.takeClicks()) {
      if (this.build.onClick(button)) continue;
      if (button === 'left') this.loadout.clicked = true;
    }
    if (wheel && this.build.mode === 'weapon') this.loadout.wheel(wheel);
  }

  addFeed(msg) {
    const name = (id) => this.game.roster.get(id)?.name || '???';
    const li = document.createElement('li');
    const how = msg.cause === 'fall' ? 'fell to their death' : msg.cause === 'storm' ? 'was lost to the storm' : msg.cause === 'quit' ? 'left the match' : null;
    const meId = this.game.me?.id;
    if (msg.killer && !how) li.innerHTML = `<b class="${msg.killer === meId ? 'me' : ''}">${esc(name(msg.killer))}</b> <i>${esc(WEAPONS[msg.weapon]?.name || (msg.cause === 'pickaxe' ? 'Pickaxe' : 'eliminated'))}${msg.head ? ' ✦' : ''}</i> <b class="${msg.victim === meId ? 'me' : ''}">${esc(name(msg.victim))}</b>`;
    else li.innerHTML = `<b class="${msg.victim === meId ? 'me' : ''}">${esc(name(msg.victim))}</b> <i>${how || 'was eliminated'}</i>`;
    $('feed').prepend(li);
    while ($('feed').children.length > 6) $('feed').lastChild.remove();
    setTimeout(() => li.classList.add('old'), 6000);
    setTimeout(() => li.remove(), 7000);
    if (msg.killer === meId && msg.victim !== meId) this.toast(`ELIMINATED ${name(msg.victim).toUpperCase()}`, 1800);
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
      const weapon = this.build.mode === 'weapon';
      if (weapon && this.loadout.fireButton(mouseOn && inp.mouse.left)) buttons |= BTN_FIRE;
      if (weapon && mouseOn && inp.mouse.right) buttons |= BTN_ADS;
      if (inp.held('interact')) buttons |= BTN_USE;
      buttons |= this.forceButtons || 0;     // test hook: hold buttons without a captured mouse
    }
    return {
      mx: axis('right', 'left'), mz: axis('forward', 'back'),
      yaw: quantizeYaw(this.yaw), pitch: quantizePitch(this.pitch), buttons, actions: this.actions.splice(0, 16),
    };
  }

  drawPlayers(dt, pos) {
    const game = this.game;
    const seen = new Set();
    const me = game.me;
    const mine = this.avatarFor(me.id);
    const sp = Math.sqrt(me.move.vx * me.move.vx + me.move.vz * me.move.vz);
    const now = performance.now();
    const held = this.build.mode !== 'weapon' ? 255 : this.loadout.item ? itemId(this.loadout.item.key) : 0;
    this.holdFor(mine, me.id, held, this.loadout.item?.rarity || 0);
    const cams = this.gfx.camera.position;
    mine.object.visible = cams.distanceToSquared(mine.object.position) > 0.8;
    mine.update(dt, { ...me.move, x: pos.x, y: pos.y, z: pos.z, yaw: this.yaw, pitch: this.pitch, speed: sp, armed: held !== 0 && held !== 255, swing: held === 0 ? swingPhase(now - this.swingAt) : 0 });
    seen.add(me.id);
    for (const s of game.remoteStates(this.remote)) {
      const av = this.avatarFor(s.id);
      this.holdFor(av, s.id, s.held, s.rarity);
      av.update(dt, { ...s, crouch: s.flags & 1, ground: s.flags & 32, armed: s.held !== 0 && s.held !== 255, swing: s.held === 0 ? swingPhase(performance.now() - (av.swingAt || -1e9)) : 0 });
      seen.add(s.id);
    }
    for (const [id, av] of this.avatars) {
      if (!seen.has(id)) { this.gfx.scene.remove(av.object); this.avatars.delete(id); }
    }
  }

  /** Puts the right thing in an avatar's hand: pickaxe (0), nothing (255, building) or an item. */
  holdFor(av, id, held, rarity) {
    if (held === 0) av.hold('pickaxe', () => pickaxeMesh(this.game.roster.get(id)?.pickaxe || 0));
    else if (held === 255 || !held) av.hold(null);
    else av.hold(`${held}:${rarity}`, () => handModel(held, rarity));
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

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
