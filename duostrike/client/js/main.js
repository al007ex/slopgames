// Boot, state machine and the frame loop.
//
// The client owns its own movement and draws everything. It never decides an
// outcome: damage, task completion and level progression all arrive from the
// server and are simply applied.

import * as THREE from 'three';
import { Net } from './net.js';
import { Input } from './input.js';
import { World, createRenderer } from './world.js';
import { LocalPlayer } from './player.js';
import { Weapons } from './weapons.js';
import { FX } from './fx.js';
import { HUD } from './hud.js';
import { Actor } from './actors.js';
import {
  WEAPONS, WEAPON_ORDER, ENEMY_TYPES, COSMETICS, FOV, ANIM,
  CLIENT_SEND_HZ, MAX_HP,
} from '#shared/constants.js';
import { LEVELS, TUTORIAL_STEPS, QUEST_TEXT } from '#shared/levels.js';
import { buildWorld, setGate, raycastWorld, rayAABB, dist3D } from '#shared/collision.js';

const $ = (id) => document.getElementById(id);

const TRAIN_WAYPOINTS = [
  [0, 0, 8], [0, 0, 4], [0, 0, 2], [0, 0, 0], [0, 0, -10], [0, 0, -24],
];

class Game {
  constructor() {
    this.canvas = $('gl');
    this.renderer = createRenderer(this.canvas);
    this.world = new World();
    this.world.scene.add(this.world.camera);
    this.fx = new FX(this.world.scene);
    this.hud = new HUD();
    this.input = new Input(this.canvas);
    this.player = new LocalPlayer();
    this.weapons = new Weapons(this.world.vmScene, this.fx);
    this.net = new Net();

    this.phase = 'menu';          // menu | lobby | playing | ended
    this.myId = null;
    this.code = null;
    this.level = null;
    this.cworld = null;           // client-side collision copy
    this.taskStates = [];
    this.players = [];
    this.enemies = new Map();     // id -> { actor, target, state }
    this.remotes = new Map();     // socket id -> { actor, target }
    this.wave = null;
    this.levelComplete = false;
    this.tutorial = null;
    this.trainDone = new Set();
    this.sprintTimer = 0;
    this.spawnRef = [0, 0, 0];
    this.openScreen = null;       // pause | shop | dialogue | null
    this.patternCells = null;
    this.lastSend = 0;
    this.fovCurrent = FOV.base;

    this.settings = {
      name: localStorage.getItem('ds_name') || '',
      fov: +(localStorage.getItem('ds_fov') || FOV.base),
      sens: +(localStorage.getItem('ds_sens') || 1),
      invertY: localStorage.getItem('ds_inv') === '1',
    };

    this.bindUI();
    this.bindNet();
    this.hud.showScreen('menu');
    addEventListener('resize', () => this.onResize());
    this.onResize();
    this.last = performance.now();
    window.__duostrike = this;   // debug handle: inspect state from the console
    requestAnimationFrame((t) => this.loop(t));
  }

  onResize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.world.resize();
  }

  // =====================================================================
  // UI wiring
  // =====================================================================

  bindUI() {
    const nameInput = $('nameInput');
    nameInput.value = this.settings.name;
    nameInput.oninput = () => {
      this.settings.name = nameInput.value.trim();
      localStorage.setItem('ds_name', this.settings.name);
    };

    $('createBtn').onclick = async () => {
      this.hud.error('');
      const res = await this.net.createRoom(this.settings.name || 'Player');
      if (res?.error) return this.hud.error(res.error);
      this.enterLobby(res);
    };

    const codeInput = $('codeInput');
    codeInput.oninput = () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    const doJoin = async () => {
      this.hud.error('');
      const code = codeInput.value.trim();
      if (code.length < 4) return this.hud.error('Enter the 4-character room code.');
      const res = await this.net.joinRoom(code, this.settings.name || 'Player');
      if (res?.error) return this.hud.error(res.error);
      this.enterLobby(res);
    };
    $('joinBtn').onclick = doJoin;
    codeInput.onkeydown = (e) => { if (e.key === 'Enter') doJoin(); };
    nameInput.onkeydown = (e) => { if (e.key === 'Enter') $('createBtn').click(); };

    $('copyBtn').onclick = () => {
      navigator.clipboard?.writeText(this.code || '').then(
        () => { $('copyBtn').textContent = 'Copied!'; setTimeout(() => { $('copyBtn').textContent = 'Copy code'; }, 1200); },
        () => {},
      );
    };
    $('readyBtn').onclick = () => this.net.send('ready', { ready: !this.iAmReady });
    $('startBtn').onclick = () => this.net.send('start');
    $('leaveBtn').onclick = () => location.reload();
    $('discLeave').onclick = () => location.reload();
    $('againBtn').onclick = () => this.net.send('again');

    // ---- pause / settings
    const fovSlider = $('fovSlider');
    const sensSlider = $('sensSlider');
    const invert = $('invertY');
    fovSlider.value = this.settings.fov;
    sensSlider.value = this.settings.sens;
    invert.checked = this.settings.invertY;
    $('fovVal').textContent = this.settings.fov;
    $('sensVal').textContent = (+this.settings.sens).toFixed(2);
    fovSlider.oninput = () => {
      this.settings.fov = +fovSlider.value;
      $('fovVal').textContent = fovSlider.value;
      localStorage.setItem('ds_fov', fovSlider.value);
    };
    sensSlider.oninput = () => {
      this.settings.sens = +sensSlider.value;
      $('sensVal').textContent = (+sensSlider.value).toFixed(2);
      localStorage.setItem('ds_sens', sensSlider.value);
    };
    invert.onchange = () => {
      this.settings.invertY = invert.checked;
      this.input.invertY = invert.checked;
      localStorage.setItem('ds_inv', invert.checked ? '1' : '0');
    };
    $('resumeBtn').onclick = () => this.closeScreen();
    $('npcClose').onclick = () => this.closeScreen();
    $('shopClose').onclick = () => this.closeScreen();

    this.input.invertY = this.settings.invertY;
    this.input.onLockChange = (locked) => {
      if (this.phase !== 'playing') return;
      if (!locked && !this.openScreen) this.openScreenNamed('pause');
    };
    this.canvas.addEventListener('mousedown', () => {
      if (this.phase === 'playing' && !this.openScreen) this.input.lock();
    });
  }

  get iAmReady() {
    return !!this.lobby?.players.find((p) => p.id === this.myId)?.ready;
  }

  enterLobby(res) {
    this.myId = res.you;
    this.code = res.code;
    this.lobby = res.lobby;
    this.phase = 'lobby';
    this.hud.renderLobby(res.lobby, this.myId);
    this.hud.showScreen('lobby');
    $('discCode').textContent = res.code;
  }

  openScreenNamed(name) {
    this.openScreen = name;
    this.input.enabled = false;
    this.input.unlock();
    if (name === 'shop') {
      const me = this.me;
      this.hud.renderShop(me?.c ?? 0, me?.own ?? [], me?.col ?? COSMETICS[0].color, (c, owned) => {
        this.net.send('shop', { action: owned ? 'equip' : 'buy', item: c.id });
      });
    }
    this.hud.showScreen(name);
  }

  closeScreen() {
    this.openScreen = null;
    this.input.enabled = true;
    this.hud.hideScreens();
    if (this.phase === 'playing') this.input.lock();
  }

  // =====================================================================
  // Networking
  // =====================================================================

  bindNet() {
    this.net.on('lobby', (l) => {
      this.lobby = l;
      if (this.phase === 'lobby') this.hud.renderLobby(l, this.myId);
      if (this.phase === 'playing') {
        if (l.paused) {
          this.openScreen = 'disconnected';
          this.input.unlock();
          this.input.enabled = false;
          $('discReason').textContent = l.pauseReason || 'Your partner dropped out.';
          $('discCode').textContent = l.code;
          this.hud.showScreen('disconnected');
        } else if (this.openScreen === 'disconnected') {
          this.closeScreen();
        }
      }
      if (this.phase === 'ended' && l.phase === 'lobby') {
        this.phase = 'lobby';
        this.hud.showHUD(false);
        this.hud.renderLobby(l, this.myId);
        this.hud.showScreen('lobby');
      }
    });

    this.net.on('level', (d) => this.onLevel(d));
    this.net.on('snap', (s) => this.onSnap(s));
    this.net.on('ev', (e) => this.onEvent(e));
    this.net.on('gameover', (d) => {
      this.phase = 'ended';
      this.input.unlock();
      this.input.enabled = false;
      this.hud.showHUD(false);
      this.hud.renderEnd(d);
    });
    this.net.on('offline', () => {
      if (this.phase === 'menu') return;
      $('discReason').textContent = 'Lost connection to the server.';
      this.hud.showScreen('disconnected');
    });
  }

  onLevel(d) {
    const level = LEVELS[d.levelId];
    if (!level) return;
    this.phase = 'playing';
    this.level = level;
    this.stage = d.stage;
    this.totalStages = d.total;
    this.questText = d.questText || QUEST_TEXT[d.stage + 1] || null;
    this.levelComplete = false;
    this.taskStates = [];
    this.wave = null;
    this.tutorial = null;
    this.trainDone.clear();
    this.sprintTimer = 0;

    this.world.load(level);
    this.cworld = buildWorld(level);

    for (const [, r] of this.remotes) this.world.actorGroup.remove(r.actor.root);
    this.remotes.clear();
    for (const [, e] of this.enemies) this.world.actorGroup.remove(e.actor.root);
    this.enemies.clear();

    const mine = (d.spawns || []).find((s) => s.id === this.myId);
    const spawn = mine ? mine.pos : level.spawns[0];
    this.spawnRef = [...spawn];
    this.player.reset(spawn);
    this.weapons.refillAll();
    if (level.noCombat) this.weapons.setWeapon('rifle');

    this.hud.showHUD(true);
    this.hud.hideScreens();
    this.hud.setLevel(`${level.name}  ·  Stage ${d.stage + 1}/${d.total}`, level.objective);
    this.hud.toast(`${level.name} — ${level.objective}`, 'warn');
    if (level.hint) this.hud.toast(level.hint, 'hint');
    this.openScreen = null;
    this.input.enabled = true;
    this.input.lock();
  }

  onSnap(s) {
    this.players = s.ps;
    this.taskStates = s.ts || [];
    this.wave = s.wv;
    this.levelComplete = s.lc;
    this.tutorial = s.tut ? { ...s.tut, steps: TUTORIAL_STEPS } : null;

    // gates: keep the local collider in step with the server
    if (this.cworld) {
      for (const g of this.cworld.gates) {
        const open = (s.g || []).includes(g.gateId);
        if (g.open !== open) {
          setGate(this.cworld, g.gateId, open);
          this.world.setGateOpen(g.gateId, open);
        }
      }
    }

    // remote players
    const seen = new Set();
    for (const p of s.ps) {
      if (p.i === this.myId) continue;
      seen.add(p.i);
      let r = this.remotes.get(p.i);
      if (!r) {
        const actor = new Actor(p.col, 1, p.n, '#ffffff');
        this.world.actorGroup.add(actor.root);
        r = { actor, pos: new THREE.Vector3(...p.p), col: p.col };
        actor.root.position.copy(r.pos);
        this.remotes.set(p.i, r);
      }
      if (r.col !== p.col) { r.actor.setColor(p.col); r.col = p.col; }
      r.target = p.p;
      r.yaw = p.y;
      r.anim = p.al ? p.a : ANIM.DOWN;
    }
    for (const [id, r] of this.remotes) {
      if (seen.has(id)) continue;
      this.world.actorGroup.remove(r.actor.root);
      r.actor.dispose();
      this.remotes.delete(id);
    }

    // enemies
    const eseen = new Set();
    for (const e of s.es) {
      eseen.add(e.i);
      let a = this.enemies.get(e.i);
      if (!a) {
        const st = ENEMY_TYPES[e.t];
        const actor = new Actor(st.color, st.scale);
        actor.root.position.set(...e.p);
        this.world.actorGroup.add(actor.root);
        a = { actor, pos: new THREE.Vector3(...e.p), type: e.t };
        this.enemies.set(e.i, a);
      }
      a.target = e.p;
      a.yaw = e.y;
      a.hp = e.hp;
      a.moving = true;
    }
    for (const [id, a] of this.enemies) {
      if (eseen.has(id)) continue;
      this.world.actorGroup.remove(a.actor.root);
      a.actor.dispose();
      this.enemies.delete(id);
    }
  }

  get me() {
    return this.players.find((p) => p.i === this.myId) || null;
  }

  onEvent(ev) {
    switch (ev.type) {
      case 'shot': {
        if (ev.by === this.myId) break;   // shooter already drew it locally
        const src = this.remotes.get(ev.by);
        const from = src ? [src.pos.x, src.pos.y + 1.5, src.pos.z] : ev.origin;
        for (const r of ev.results) this.fx.tracer(from, r.point, 0xffe0a8);
        break;
      }
      case 'ehit': {
        const target = this.enemies.get(ev.id);
        if (target) target.actor.hitFlash();
        if (ev.by === this.myId) {
          this.hud.hitmark(ev.killed);
          this.hud.damageNumber(ev.point, this.world.camera, `${ev.dmg}`, ev.head ? 'head' : '');
        }
        this.fx.bloodHit(ev.point, ev.head);
        if (ev.killed && target) {
          this.fx.death(ev.point, ENEMY_TYPES[target.type].color);
        }
        break;
      }
      case 'eatk': {
        if (ev.ranged) this.fx.tracer(ev.from, ev.to, 0xff7a5a);
        break;
      }
      case 'swing': break;
      case 'hurt': {
        if (ev.id !== this.myId) break;
        this.hud.hurtFlash();
        this.fx.shake(0.34);
        break;
      }
      case 'down': {
        this.hud.toast(ev.id === this.myId ? 'You went down.' : `${ev.name} went down.`, 'bad');
        break;
      }
      case 'teleport': {
        if (ev.id !== this.myId) break;
        this.player.reset(ev.pos);
        if (ev.reason === 'fell') this.hud.toast('Reset to the last checkpoint.', 'warn');
        break;
      }
      case 'task': {
        this.hud.toast(`Task complete — ${ev.label}  (+◈${ev.reward} each)`, 'good');
        this.fx.shake(0.12);
        break;
      }
      case 'flip': {
        this.hud.toast(`${ev.name} threw the ${ev.pad} switch.`, '');
        break;
      }
      case 'pickup': {
        this.hud.toast(`${ev.name} picked up the core.`, '');
        break;
      }
      case 'gate': {
        this.hud.toast(`Gate open — ${ev.label}`, 'good');
        break;
      }
      case 'wave': {
        this.hud.toast(`Wave ${ev.index} of ${ev.total}`, 'bad');
        break;
      }
      case 'waveclear': {
        this.hud.toast(ev.last ? 'All waves cleared.' : `Wave clear. Next in a moment…`, 'good');
        break;
      }
      case 'hint': {
        this.hud.toast(`Old Wick: ${ev.text}`, 'hint');
        break;
      }
      case 'toast': {
        this.hud.toast(ev.text, 'warn');
        break;
      }
      case 'buy': {
        this.hud.toast(`${ev.name} bought ${ev.item}.`, '');
        if (this.openScreen === 'shop') this.openScreenNamed('shop');
        break;
      }
      case 'trainstep': {
        this.hud.toast('Drill passed.', 'good');
        break;
      }
      case 'trainpartial': {
        if (ev.by !== this.myId) this.hud.toast(`${ev.name} did it — your turn.`, 'warn');
        break;
      }
      case 'pattern': {
        this.playPattern(ev.id, ev.seq);
        break;
      }
      case 'press': {
        const t = this.level?.tasks.find((x) => x.id === ev.id);
        if (t) this.world.flashPatternButton(ev.id, ev.pad, ev.ok ? 0.3 : 0.5);
        if (!ev.ok) this.hud.toast('Wrong pad — watch it again.', 'bad');
        break;
      }
      default: break;
    }
  }

  playPattern(taskId, seq) {
    const def = this.level?.tasks.find((t) => t.id === taskId);
    if (!def) return;
    const cells = this.hud.showPattern(seq, def.buttons);
    seq.forEach((id, i) => {
      setTimeout(() => {
        this.world.flashPatternButton(taskId, id, 0.4);
        cells[i]?.classList.add('lit');
      }, 700 + i * 650);
    });
    setTimeout(() => this.hud.hidePattern(), 700 + seq.length * 650 + 900);
  }

  // =====================================================================
  // Interaction
  // =====================================================================

  /** Nearest thing the player could press E on right now. */
  findInteraction() {
    if (!this.level) return null;
    const pos = this.player.pos;
    const near = (p, r, vert = 2.6) =>
      Math.hypot(pos[0] - p[0], pos[2] - p[2]) <= r && Math.abs(pos[1] - p[1]) <= vert;

    for (const n of this.level.npcs || []) {
      if (near(n.p, 3.2)) {
        return { kind: 'npc', npc: n, text: `Talk to ${n.name}` };
      }
    }

    for (const st of this.taskStates) {
      if (st.done || st.active === false) continue;
      const def = (this.level.tasks || []).find((t) => t.id === st.id);
      if (!def) continue;

      if (def.kind === 'hold' && near(def.p, def.r)) {
        return { kind: 'hold', id: def.id, hold: true, text: `Hold to ${def.label.toLowerCase()}` };
      }
      if (def.kind === 'synced') {
        for (const pad of def.pads) {
          if (near(pad.p, pad.r)) {
            return { kind: 'flip', id: def.id, pad: pad.id, text: `Throw the ${pad.id} switch` };
          }
        }
      }
      if (def.kind === 'fetch') {
        const carryingMe = st.carrier === this.myId;
        if (carryingMe && near(def.console.p, def.console.r)) {
          return { kind: 'deliver', id: def.id, hold: true, text: 'Hold to deliver the core' };
        }
        if (!st.carrier && near(st.itemPos || def.item.p, 2.6)) {
          return { kind: 'pickup', id: def.id, text: 'Pick up the core' };
        }
      }
      if (def.kind === 'defend') {
        if (near(def.hold.p, def.hold.r)) {
          return { kind: 'hold', id: def.id, hold: true, text: 'Hold this position' };
        }
        if (near(def.goal.p, def.goal.r)) {
          return { kind: 'goal', id: def.id, text: 'Throw the breaker' };
        }
      }
      if (def.kind === 'pattern') {
        for (const b of def.buttons) {
          if (near(b.p, 2.0, 2.0)) {
            return { kind: 'press', id: def.id, pad: b.id, text: 'Press this pad' };
          }
        }
      }
    }
    return null;
  }

  handleInteraction(inter) {
    if (!inter) return;
    if (inter.kind === 'npc') return this.talkTo(inter.npc);
    if (inter.kind === 'flip') return this.net.send('task', { action: 'flip', id: inter.id, pad: inter.pad });
    if (inter.kind === 'pickup') return this.net.send('task', { action: 'pickup', id: inter.id });
    if (inter.kind === 'goal') return this.net.send('task', { action: 'goal', id: inter.id });
    if (inter.kind === 'press') return this.net.send('task', { action: 'press', id: inter.id, pad: inter.pad });
    // 'hold' and 'deliver' need no message — the server reads `int` from the state stream
  }

  talkTo(npc) {
    if (npc.role === 'shop') return this.openScreenNamed('shop');
    if (npc.role === 'hint') { this.net.send('npc', { action: 'hint' }); return; }
    if (npc.role === 'quest') {
      const text = this.questText || 'Rest here. Buy a colour. Then take the road north when you are both ready.';
      this.hud.renderDialogue(npc.name, text);
      this.openScreen = 'dialogue';
      this.input.enabled = false;
      this.input.unlock();
      return;
    }
    if (npc.role === 'trainer') {
      const step = this.tutorial ? TUTORIAL_STEPS[this.tutorial.step] : null;
      const text = step ? step.text : 'That is the lot. Get out through the gate — both of you.';
      this.hud.renderDialogue(npc.name, text);
      this.openScreen = 'dialogue';
      this.input.enabled = false;
      this.input.unlock();
    }
  }

  // =====================================================================
  // Waypoint
  // =====================================================================

  waypointTarget() {
    if (!this.level) return null;
    if (this.tutorial && this.tutorial.step < TUTORIAL_STEPS.length) {
      return TRAIN_WAYPOINTS[this.tutorial.step] || null;
    }
    if (this.levelComplete) return this.level.exit.p;

    for (const st of this.taskStates) {
      if (st.done || st.active === false) continue;
      const def = (this.level.tasks || []).find((t) => t.id === st.id);
      if (!def) continue;
      if (def.kind === 'hold') return def.p;
      if (def.kind === 'pattern') return def.p;
      if (def.kind === 'synced') {
        const open = def.pads.filter((p) => !(st.flips || {})[p.id]);
        if (!open.length) continue;
        open.sort((a, b) => dist3D(this.player.pos, a.p) - dist3D(this.player.pos, b.p));
        return open[0].p;
      }
      if (def.kind === 'fetch') {
        if (st.carrier === this.myId) return def.console.p;
        if (st.carrier) return def.console.p;
        return st.itemPos || def.item.p;
      }
      if (def.kind === 'defend') {
        if (!st.holder) return def.hold.p;
        if (st.holder === this.myId) return null;
        return def.goal.p;
      }
    }

    if (this.wave && this.wave.st !== 'done' && this.enemies.size) {
      let best = null;
      let bd = Infinity;
      for (const [, e] of this.enemies) {
        const d = dist3D(this.player.pos, [e.pos.x, e.pos.y, e.pos.z]);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) return [best.pos.x, best.pos.y, best.pos.z];
    }
    return null;
  }

  // =====================================================================
  // Frame
  // =====================================================================

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.phase === 'playing') this.update(dt);
    this.hud.tick(dt);
    this.fx.update(dt);
    this.world.render(this.renderer);
    this.input.consume();
  }

  update(dt) {
    const me = this.me;
    const alive = me ? me.al : true;
    const frozen = !alive || !!this.openScreen;
    const canAct = alive && !this.openScreen && this.input.locked && !this.level?.noCombat;

    if (this.input.enabled && this.input.locked) {
      this.player.look(this.input.dx, this.input.dy, this.settings.sens);
    }

    // ---- weapon switching
    if (!this.openScreen) {
      if (this.input.hit('Digit1')) this.weapons.setWeapon('rifle');
      if (this.input.hit('Digit2')) this.weapons.setWeapon('shotgun');
      if (this.input.hit('Digit3')) this.weapons.setWeapon('sword');
      if (this.input.wheel) {
        const i = WEAPON_ORDER.indexOf(this.weapons.current);
        this.weapons.setWeapon(WEAPON_ORDER[(i + (this.input.wheel > 0 ? 1 : -1) + 3) % 3]);
      }
    }

    // ---- movement
    const carrying = !!this.taskStates.find((t) => t.kind === 'fetch' && t.carrier === this.myId && !t.done);
    const events = this.player.update(dt, this.input, this.cworld, {
      frozen,
      carrying,
      aiming: this.weapons.aiming,
    });
    for (const e of events) {
      if (e === 'jump') { this.trainDone.add('jump'); }
      if (e === 'slide') { this.trainDone.add('slide'); this.fx.shake(0.06); }
      if (e === 'walljump') { this.trainDone.add('walljump'); this.fx.shake(0.09); }
      if (e === 'land') this.fx.shake(Math.min(0.14, Math.abs(this.player.vel[1]) * 0.004));
    }
    if (dist3D(this.player.pos, this.spawnRef) > 5) this.trainDone.add('move');
    if (this.input.sprint && this.player.speed2D > 8.5) {
      this.sprintTimer += dt;
      if (this.sprintTimer > 0.7) this.trainDone.add('sprint');
    } else this.sprintTimer = 0;

    // ---- weapons
    const action = this.weapons.update(dt, this.input, this.player, {
      canAct,
      hitTest: (o, d, r) => this.hitTest(o, d, r),
    });
    if (action) {
      if (action.type === 'fire') this.net.send('fire', { weapon: action.weapon, origin: action.origin, dirs: action.dirs });
      if (action.type === 'melee') this.net.send('melee', { origin: action.origin, dir: action.dir });
    }

    // ---- camera
    this.updateCamera(dt);

    // ---- interaction
    const inter = frozen ? null : this.findInteraction();
    this.currentInteraction = inter;
    if (inter && this.input.interactPressed && !inter.hold) this.handleInteraction(inter);
    if (this.world.exitMesh) this.world.exitMesh.visible = this.levelComplete;
    this.hud.prompt(
      inter ? (inter.hold ? `Hold E — ${inter.text.replace(/^Hold( to)? /i, '')}` : inter.text) : '',
      !!inter?.hold,
    );

    // ---- remote actors
    this.updateActors(dt);
    this.world.updateProps(dt, this.taskStates, this.myId);

    // ---- HUD
    if (me) {
      this.hud.setHealth(me.hp);
      this.hud.setCoin(me.c);
      this.hud.setDown(me.al ? 0 : me.dn);
      const partner = this.players.find((p) => p.i !== this.myId);
      this.hud.setPartner(partner);
    }
    this.hud.setAmmo(this.weapons);
    this.hud.setWave(this.wave);
    this.hud.setTasks(this.taskStates, this.players, this.myId, this.tutorial);
    const spread = this.weapons.isGun
      ? (this.weapons.aiming ? 3 : 6 + Math.min(14, this.player.speed2D * 0.9))
      : 9;
    this.hud.setCrosshairSpread(spread);

    const wp = this.waypointTarget();
    this.hud.waypoint(wp, this.world.camera, this.player.pos);
    this.world.setBeacon(wp && dist3D(this.player.pos, wp) > 3 ? wp : null);

    this.sendState();
  }

  updateCamera(dt) {
    const cam = this.world.camera;
    const p = this.player;
    cam.position.set(p.pos[0], p.pos[1] + p.eyeHeight, p.pos[2]);
    cam.rotation.set(p.pitch, p.yaw, p.roll);
    this.weapons.applyPunch(cam);
    this.fx.applyShake(cam);

    // the viewmodel camera only inherits roll and a softened shake
    const vm = this.world.vmCamera;
    vm.position.set(0, 0, 0);
    vm.rotation.set(0, 0, p.roll * 0.45);
    this.fx.applyShake(vm);

    let target = this.settings.fov;
    if (this.weapons.aiming) target *= FOV.adsMul;
    else {
      if (p.sliding) target += FOV.slideAdd;
      else if (this.input.sprint && p.speed2D > 8) target += FOV.sprintAdd;
    }
    this.fovCurrent += (target - this.fovCurrent) * Math.min(1, dt * FOV.lerp);
    if (Math.abs(cam.fov - this.fovCurrent) > 0.01) {
      cam.fov = this.fovCurrent;
      cam.updateProjectionMatrix();
    }
  }

  updateActors(dt) {
    const k = Math.min(1, dt * 14);
    for (const [, r] of this.remotes) {
      if (r.target) {
        r.pos.x += (r.target[0] - r.pos.x) * k;
        r.pos.y += (r.target[1] - r.pos.y) * k;
        r.pos.z += (r.target[2] - r.pos.z) * k;
      }
      const speed = r.target ? Math.hypot(r.target[0] - r.pos.x, r.target[2] - r.pos.z) / Math.max(dt, 0.001) : 0;
      r.actor.root.position.copy(r.pos);
      r.actor.root.rotation.y = r.yaw ?? 0;
      r.actor.setAnim(r.anim ?? ANIM.IDLE);
      r.actor.update(dt, Math.min(speed, 12));
    }
    for (const [, e] of this.enemies) {
      if (e.target) {
        const before = e.pos.x;
        e.pos.x += (e.target[0] - e.pos.x) * k;
        e.pos.y += (e.target[1] - e.pos.y) * k;
        e.pos.z += (e.target[2] - e.pos.z) * k;
        e.speed = Math.abs(e.target[0] - before) > 0.001 ? 6 : 0;
      }
      e.actor.root.position.copy(e.pos);
      e.actor.root.rotation.y = e.yaw ?? 0;
      const moving = e.target && Math.hypot(e.target[0] - e.pos.x, e.target[2] - e.pos.z) > 0.02;
      e.actor.setAnim(moving ? ANIM.RUN : ANIM.IDLE);
      e.actor.update(dt, moving ? 7 : 0);
    }
  }

  hitTest(origin, dir, range) {
    let best = range;
    let point = [origin[0] + dir[0] * range, origin[1] + dir[1] * range, origin[2] + dir[2] * range];
    if (this.cworld) {
      const geo = raycastWorld(this.cworld, origin, dir, range);
      if (geo.hit) { best = geo.dist; point = geo.point; }
    }
    for (const [, e] of this.enemies) {
      const s = ENEMY_TYPES[e.type].scale;
      const min = [e.pos.x - 0.45 * s, e.pos.y, e.pos.z - 0.45 * s];
      const max = [e.pos.x + 0.45 * s, e.pos.y + 1.8 * s, e.pos.z + 0.45 * s];
      const t = rayAABB(origin, dir, min, max);
      if (t >= 0 && t < best) {
        best = t;
        point = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
      }
    }
    return point;
  }

  sendState() {
    const now = performance.now();
    if (now - this.lastSend < 1000 / CLIENT_SEND_HZ) return;
    this.lastSend = now;
    const msg = {
      p: this.player.pos,
      y: this.player.yaw,
      pi: this.player.pitch,
      a: this.player.anim,
      w: this.weapons.current,
      int: this.input.interactHeld && !this.openScreen,
      blk: this.weapons.blocking,
    };
    if (this.tutorial) {
      const cur = TUTORIAL_STEPS[this.tutorial.step]?.id;
      if (cur && this.trainDone.has(cur)) msg.tr = cur;
    }
    this.net.send('state', msg);
  }
}

new Game();
