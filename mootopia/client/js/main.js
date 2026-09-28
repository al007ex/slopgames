// The client: connection, world state, input and the frame loop.

import * as C from '#shared/config.js';
import { WEAPONS, ITEMS, PROJECTILES } from '#shared/items.js';
import { ANIMALS } from '#shared/animals.js';
import { HATS } from '#shared/hats.js';
import { generateWorld, TREE, ROCK } from '#shared/world.js';
import { SERVER_TABLE, CLIENT_TABLE, encode, decode, Writer } from '#shared/protocol.js';
import { lerpAngle } from '#shared/util.js';
import { Renderer, startSwing } from './render.js';
import { UI } from './ui.js';
import * as A from './assets.js';

const $ = (id) => document.getElementById(id);
const OBJ_CELL = 400;
const INTERP_MS = 170;
const AIM_MS = 50;

class State {
  constructor() {
    this.me = 0;
    this.players = new Map();
    this.animals = new Map();
    this.objects = new Map();
    this.grid = new Map();
    this.projectiles = [];
    this.texts = [];
    this.clans = [];
    this.clanNames = new Map();
    this.leader = 0;
  }

  addObject(o) {
    this.objects.set(o.sid, o);
    const k = cellKey(o.x, o.y);
    let cell = this.grid.get(k);
    if (!cell) { cell = new Set(); this.grid.set(k, cell); }
    cell.add(o);
  }

  removeObject(sid) {
    const o = this.objects.get(sid);
    if (!o) return;
    this.objects.delete(sid);
    this.grid.get(cellKey(o.x, o.y))?.delete(o);
  }

  visibleObjects(ox, oy, w, h) {
    const out = [];
    const pad = 300;
    for (let cx = Math.floor((ox - pad) / OBJ_CELL); cx <= Math.floor((ox + w + pad) / OBJ_CELL); cx++) {
      for (let cy = Math.floor((oy - pad) / OBJ_CELL); cy <= Math.floor((oy + h + pad) / OBJ_CELL); cy++) {
        const cell = this.grid.get(cx * 100000 + cy);
        if (cell) for (const o of cell) out.push(o);
      }
    }
    return out;
  }
}

const cellKey = (x, y) => Math.floor(x / OBJ_CELL) * 100000 + Math.floor(y / OBJ_CELL);

class App {
  constructor() {
    this.state = new State();
    this.renderer = new Renderer($('game'));
    this.renderer.showHitboxes = new URLSearchParams(location.search).has('hitboxes');
    this.ui = new UI(this);
    this.writer = new Writer(256);
    this.me = this.freshMe();
    this.requests = [];
    this.pings = [];
    this.mates = [];
    this.keys = new Set();
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    this.aim = 0;
    this.lockAim = false;
    this.moveDir = undefined;
    this.lastAimSent = 0;
    this.sentAim = null;
    this.attacking = false;
    this.alive = false;
    this.inGame = false;
    this.skin = Number(localStorage.getItem('moo.skin') || 0) || 0;
    this.lastFrame = performance.now();
    A.preload({ weapons: WEAPONS, items: ITEMS, animals: ANIMALS, hats: HATS });
    this.setupMenu();
    this.setupInput();
    this.connect();
    window.addEventListener('resize', () => this.renderer.resize());
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    // Browsers throttle animation frames in hidden panes; keep the world moving anyway.
    setInterval(() => { if (performance.now() - this.lastFrame > 200) this.frame(performance.now()); }, 100);
  }

  freshMe() {
    return { weapons: [0], items: [0, 3, 6, 10], weapon: 0, build: -1, res: [0, 0, 0, 0], counts: {}, hats: new Set(), hat: 0,
      clan: 0, clanName: '', clanOwner: false, clanOwnerSid: 0, members: [], asked: new Set(), xp: 0, maxXP: C.FIRST_XP, age: 1, kills: 0 };
  }

  // ── network ───────────────────────────────────────────────────────────
  connect() {
    const url = new URL('ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => { $('status').textContent = ''; $('enter').disabled = false; };
    ws.onmessage = (e) => { for (const m of decode(SERVER_TABLE, e.data)) this.onMessage(m); };
    ws.onclose = () => {
      $('status').textContent = 'Disconnected — reconnecting…';
      $('enter').disabled = true;
      this.showMenu();
      this.state = new State();
      setTimeout(() => this.connect(), 1500);
    };
    $('enter').disabled = true;
  }

  send(type, ...args) {
    if (this.ws?.readyState !== 1) return;
    this.ws.send(encode(CLIENT_TABLE, [[type, ...args]], this.writer));
  }

  onMessage([type, ...m]) {
    const s = this.state;
    const now = performance.now();
    switch (type) {
      case 'welcome':
        s.me = m[0];
        this.seed = m[2];
        this.menuWorld = generateWorld(this.seed);
        break;
      case 'spawned': {
        s.me = m[0];
        this.me = { ...this.freshMe(), weapons: m[2], items: m[1], hats: new Set(m[3]), hat: m[4], clan: this.me.clan, clanName: this.me.clanName,
          clanOwner: this.me.clanOwner, clanOwnerSid: this.me.clanOwnerSid, members: this.me.members, asked: this.me.asked };
        this.alive = true;
        this.enterGame();
        this.ui.renderHotbar();
        this.ui.setAge(0, C.FIRST_XP, 1);
        this.ui.setKills(0);
        this.ui.setUpgrades(0, 2, []);
        break;
      }
      case 'info': {
        const [sid, name, skin, hp, max] = m;
        const p = s.players.get(sid) || this.newPlayer(sid);
        Object.assign(p, { name, skin, health: hp, maxHealth: max });
        break;
      }
      case 'tick': this.applyTick(m[0], m[1], now); break;
      case 'objs': this.addObjects(m[0]); break;
      case 'rm': s.removeObject(m[0]); break;
      case 'wiggle': {
        const o = s.objects.get(m[0]);
        if (o) { o.xWiggle += C.GATHER_WIGGLE * Math.cos(m[1]); o.yWiggle += C.GATHER_WIGGLE * Math.sin(m[1]); }
        break;
      }
      case 'hp': { const p = s.players.get(m[0]); if (p) { p.health = m[1]; p.maxHealth = m[2]; } break; }
      case 'ahp': { const a = s.animals.get(m[0]); if (a) a.health = m[1]; break; }
      case 'txt': this.floatText(m[0], m[1], m[2]); break;
      case 'swing': {
        const p = s.players.get(m[0]);
        if (p) startSwing(p, m[1], WEAPONS[m[2]].speed);
        break;
      }
      case 'slam': { const a = s.animals.get(m[0]); if (a) { a.animTime = a.animSpeed = 500; a.targetAngle = -0.5; a.ratio = 0; a.phase = 0; } break; }
      case 'died': this.died(); break;
      case 'dead': { const p = s.players.get(m[0]); if (p) p.visible = false; break; }
      case 'kills': this.me.kills = m[0]; this.ui.setKills(m[0]); break;
      case 'adead': s.animals.delete(m[0]); break;
      case 'left': s.players.delete(m[0]); break;
      case 'res': this.me.res[m[0]] = m[1]; this.ui.setResource(m[0], m[1]); break;
      case 'xp':
        if (m[1]) this.me.maxXP = m[1];
        if (m[2]) this.me.age = m[2];
        this.me.xp = m[0];
        this.ui.setAge(this.me.xp, this.me.maxXP, this.me.age);
        break;
      case 'upg': this.ui.setUpgrades(m[0], m[1], m[2]); break;
      case 'loadout':
        this.me.items = m[0]; this.me.weapons = m[1];
        if (!this.me.weapons.includes(this.me.weapon)) this.me.weapon = this.me.weapons[0];
        this.ui.renderHotbar();
        break;
      case 'count': this.me.counts[m[0]] = m[1]; this.ui.refreshHotbar(); break;
      case 'proj': {
        const [x, y, dir, range, index, layer, sid] = m;
        s.projectiles.push({ x, y, dir, range, index, layer, sid, speed: PROJECTILES[index].speed });
        if (index === 1 || index === 4) {
          for (const o of s.visibleObjects(x - 80, y - 80, 160, 160)) if (o.item?.drawn === 'turret' && Math.hypot(o.x - x, o.y - y) < 80) o.aim = dir;
        }
        break;
      }
      case 'prm': s.projectiles = s.projectiles.filter((p) => p.sid !== m[0]); break;
      case 'leaders':
        s.leader = m[0][0] || 0;
        this.ui.setLeaders(m[0]);
        break;
      case 'mm': this.mates = m[0]; break;
      case 'ping': this.pings.push({ x: m[0], y: m[1], at: now }); break;
      case 'chat': { const p = s.players.get(m[0]); if (p) p.chat = { text: m[1], at: now }; break; }
      case 'hats':
        this.me.hats = new Set(m[0]); this.me.hat = m[1];
        if (!$('shop').hidden) this.ui.renderShop();
        break;
      case 'clans':
        s.clans = m[0];
        for (let i = 0; i < m[0].length; i += 3) s.clanNames.set(m[0][i], m[0][i + 1]);
        if (!$('clans').hidden) this.ui.renderClans();
        break;
      case 'members': {
        const [id, name, owner, list] = m;
        Object.assign(this.me, { clan: id, clanName: name, clanOwner: !!owner, members: list, asked: new Set() });
        if (id) s.clanNames.set(id, name);
        this.me.clanOwnerSid = owner ? s.me : (this.me.clanOwnerSid && list.includes(this.me.clanOwnerSid) ? this.me.clanOwnerSid : this.guessOwner(id));
        if (!$('clans').hidden) this.ui.renderClans();
        break;
      }
      case 'request':
        this.requests.push({ sid: m[0], name: m[1] });
        if (this.requests.length === 1) this.ui.nextRequest();
        break;
      case 'declined': break;
      default:
    }
  }

  guessOwner(id) {
    for (let i = 0; i < this.state.clans.length; i += 3) if (this.state.clans[i] === id) return this.state.clans[i + 2];
    return 0;
  }

  newPlayer(sid) {
    const p = { sid, name: '', skin: 0, x: 0, y: 0, x1: 0, y1: 0, x2: 0, y2: 0, dt: 0, dir: 0, d1: 0, d2: 0, build: -1, weapon: 0, variant: 0,
      clan: 0, hat: 0, z: 0, health: 100, maxHealth: 100, visible: false, fresh: true, dirPlus: 0, animTime: 0 };
    this.state.players.set(sid, p);
    return p;
  }

  applyTick(ps, as, now) {
    const s = this.state;
    for (const p of s.players.values()) p.visible = false;
    for (let i = 0; i < ps.length; i += 11) {
      const sid = ps[i];
      const p = s.players.get(sid) || this.newPlayer(sid);
      this.moveTo(p, ps[i + 1], ps[i + 2], ps[i + 3]);
      p.build = ps[i + 4]; p.weapon = ps[i + 5]; p.variant = ps[i + 6];
      p.clan = ps[i + 7]; p.hat = ps[i + 8]; p.z = ps[i + 9];
      p.visible = true;
      if (sid === s.me) {
        const changed = this.me.build !== p.build || this.me.weapon !== p.weapon;
        this.me.build = p.build; this.me.weapon = p.weapon;
        if (changed) this.ui.refreshHotbar();
      }
    }
    const seen = new Set();
    for (let i = 0; i < as.length; i += 6) {
      const sid = as[i];
      let a = s.animals.get(sid);
      if (!a) { a = { sid, type: as[i + 1], dirPlus: 0, animTime: 0, fresh: true }; s.animals.set(sid, a); }
      a.type = as[i + 1];
      this.moveTo(a, as[i + 2], as[i + 3], as[i + 4]);
      a.health = as[i + 5];
      a.visible = true;
      seen.add(sid);
    }
    for (const [sid, a] of s.animals) if (!seen.has(sid)) s.animals.delete(sid);
  }

  moveTo(e, x, y, dir) {
    if (e.fresh) { e.x = e.x1 = e.x2 = x; e.y = e.y1 = e.y2 = y; e.dir = e.d1 = e.d2 = dir; e.fresh = false; e.dt = 0; return; }
    e.x1 = e.x; e.y1 = e.y; e.x2 = x; e.y2 = y;
    e.d1 = e.dir; e.d2 = dir;
    e.dt = 0;
  }

  addObjects(flat) {
    for (let i = 0; i < flat.length; i += 8) {
      const [sid, x, y, dir, scale, type, itemId, owner] = flat.slice(i, i + 8);
      const item = itemId >= 0 ? ITEMS[itemId] : null;
      const layer = item ? item.group.layer : type === TREE ? 3 : type === ROCK ? 0 : 2;
      this.state.addObject({ sid, x, y, dir, scale, type, item, owner, layer, xWiggle: 0, yWiggle: 0, spin: 0 });
    }
  }

  floatText(x, y, amount) {
    const heal = amount < 0;
    this.state.texts.push({ x, y, text: String(Math.abs(amount)), color: heal ? '#8ecc51' : '#fff', scale: 50, start: 50, max: 75, grow: true, speed: 0.18, life: 600 });
  }

  // ── menu, death ───────────────────────────────────────────────────────
  setupMenu() {
    const box = $('skins');
    C.SKIN_COLORS.forEach((color, i) => {
      const d = document.createElement('div');
      d.className = 'skin' + (i === this.skin ? ' on' : '');
      d.style.background = color;
      d.onclick = () => {
        this.skin = i;
        try { localStorage.setItem('moo.skin', String(i)); } catch {}
        for (const el of box.children) el.classList.remove('on');
        d.classList.add('on');
      };
      box.appendChild(d);
    });
    try { $('name').value = localStorage.getItem('moo.name') || ''; } catch {}
    $('enter').onclick = () => this.play();
    $('name').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.play(); });
  }

  play() {
    const name = $('name').value.trim();
    try { localStorage.setItem('moo.name', name); } catch {}
    this.send('spawn', name, this.skin);
  }

  enterGame() {
    this.inGame = true;
    $('menu').hidden = true;
    $('died').hidden = true;
    $('hud').hidden = false;
  }

  showMenu() {
    this.inGame = false;
    this.alive = false;
    $('hud').hidden = true;
    $('menu').hidden = false;
    this.ui.closeWindows();
  }

  died() {
    this.alive = false;
    this.attacking = false;
    const d = $('died');
    d.hidden = false;
    d.firstElementChild.style.animation = 'none';
    void d.offsetWidth;
    d.firstElementChild.style.animation = '';
    $('hud').hidden = true;
    this.ui.closeWindows();
    setTimeout(() => { if (!this.alive) { d.hidden = true; this.showMenu(); } }, C.DEATH_FADE);
  }

  // ── input ─────────────────────────────────────────────────────────────
  setupInput() {
    const canvas = $('game');
    window.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.alive || e.button !== 0) return;
      this.attacking = true;
      this.send('attack', 1, this.aimDir());
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !this.attacking) return;
      this.attacking = false;
      if (this.alive) this.send('attack', 0, this.aimDir());
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => { this.keys.clear(); if (this.attacking && this.alive) { this.attacking = false; this.send('attack', 0, this.aimDir()); } });

    window.addEventListener('keydown', (e) => {
      const chat = $('chat');
      if (document.activeElement === chat) {
        if (e.key === 'Enter') { const t = chat.value.trim(); if (t) this.send('chat', t); chat.value = ''; chat.hidden = true; chat.blur(); }
        if (e.key === 'Escape') { chat.value = ''; chat.hidden = true; chat.blur(); }
        return;
      }
      if (!this.alive) return;
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.key === 'Enter') { chat.hidden = false; chat.focus(); e.preventDefault(); return; }
      if (e.repeat) return;
      const k = e.code;
      this.keys.add(k);
      if (k === 'Space') { e.preventDefault(); if (!this.attacking) { this.attacking = true; this.send('attack', 1, this.aimDir()); } return; }
      if (k === 'KeyE') this.send('auto');
      else if (k === 'KeyX') this.lockAim = !this.lockAim;
      else if (k === 'KeyR') this.send('ping');
      else if (k === 'KeyQ') this.chooseGroup(0);
      else if (k === 'KeyF') this.chooseGroup(5, 6);
      else if (k === 'KeyV') this.chooseGroup(2);
      else if (k === 'Escape') this.ui.closeWindows();
      else if (/^Digit[1-9]$/.test(k)) {
        const slot = this.ui.hotbarSlots()[Number(k.slice(5)) - 1];
        if (slot) this.choose(slot.kind, slot.id);
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space' && this.attacking && this.alive) { this.attacking = false; this.send('attack', 0, this.aimDir()); }
    });
    $('chat').addEventListener('blur', () => { $('chat').hidden = true; });
  }

  choose(kind, id) {
    if (!this.alive) return;
    if (kind === 'weapon') { this.me.build = -1; this.me.weapon = id; this.send('select', id, 1); }
    else { this.me.build = this.me.build === id ? -1 : id; this.send('select', id, 0); }
    this.ui.refreshHotbar();
  }

  chooseGroup(...groups) {
    const id = this.me.items.find((i) => groups.includes(ITEMS[i].group.id));
    if (id !== undefined) this.choose('item', id);
  }

  aimDir() {
    if (this.lockAim) return this.aim;
    this.aim = Math.atan2(this.mouse.y - innerHeight / 2, this.mouse.x - innerWidth / 2);
    return this.aim;
  }

  sendInput(now) {
    const held = (...codes) => codes.some((c) => this.keys.has(c));
    const dx = (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0);
    const dy = (held('KeyS', 'ArrowDown') ? 1 : 0) - (held('KeyW', 'ArrowUp') ? 1 : 0);
    const dir = dx || dy ? Math.atan2(dy, dx) : null;
    if (dir !== this.moveDir) { this.moveDir = dir; this.send('move', dir); }
    const aim = this.aimDir();
    if (now - this.lastAimSent > AIM_MS && (this.sentAim === null || Math.abs(aim - this.sentAim) > 0.01)) {
      this.lastAimSent = now; this.sentAim = aim;
      this.send('aim', aim);
    }
  }

  // ── the frame ─────────────────────────────────────────────────────────
  loop(now) {
    this.frame(now);
    requestAnimationFrame(this.loop);
  }

  frame(now) {
    const delta = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;
    const s = this.state;
    if (this.alive) this.sendInput(now);

    for (const e of [...s.players.values(), ...s.animals.values()]) {
      if (!e.visible) continue;
      e.dt += delta;
      const t = Math.min(1.7, e.dt / INTERP_MS);
      e.x = e.x1 + (e.x2 - e.x1) * t;
      e.y = e.y1 + (e.y2 - e.y1) * t;
      e.dir = lerpAngle(e.d1, e.d2, Math.min(1.2, e.dt / C.TICK_MS));
    }
    const me = s.players.get(s.me);
    if (me && this.alive) me.dir = this.aimDir();

    for (const o of s.objects.values()) {
      if (o.xWiggle) { o.xWiggle *= Math.pow(0.99, delta); if (Math.abs(o.xWiggle) < 0.05) o.xWiggle = 0; }
      if (o.yWiggle) { o.yWiggle *= Math.pow(0.99, delta); if (Math.abs(o.yWiggle) < 0.05) o.yWiggle = 0; }
      if (o.item?.turnSpeed) o.spin += o.item.turnSpeed * delta;
    }
    for (const pr of s.projectiles) {
      const step = Math.min(pr.range, pr.speed * delta);
      pr.x += step * Math.cos(pr.dir); pr.y += step * Math.sin(pr.dir);
      pr.range -= step;
    }
    s.projectiles = s.projectiles.filter((pr) => pr.range > 0);

    if (this.inGame && me) this.renderer.follow(me, delta);
    else this.menuCamera(now);
    this.renderer.frame(this.inGame ? s : this.menuState(), delta, now);
    if (this.inGame) {
      this.pings = this.pings.filter((p) => now - p.at < C.PING_MS);
      this.ui.drawMinimap(me, this.mates, this.pings, now);
    }
  }

  menuCamera(now) {
    const t = now * 0.00002;
    this.renderer.cam.x = C.MAP / 2 + Math.cos(t) * 2600;
    this.renderer.cam.y = C.MAP / 2 - 1600 + Math.sin(t * 1.3) * 900;
  }

  /** Behind the menu: the natural world, drifting past. */
  menuState() {
    if (!this.menuView) {
      const view = new State();
      (this.menuWorld || []).forEach((r, i) => view.addObject({ sid: -1 - i, ...r, item: null, owner: 0, layer: r.type === TREE ? 3 : r.type === ROCK ? 0 : 2, xWiggle: 0, yWiggle: 0, spin: 0 }));
      if (this.menuWorld) this.menuView = view;
      return view;
    }
    return this.menuView;
  }
}

window.app = new App();
