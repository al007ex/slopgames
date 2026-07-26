// All DOM: the in-game HUD and every full-screen panel.
// Nothing here decides anything — it renders whatever state it is handed.

import * as THREE from 'three';
import { COSMETICS, MAX_HP } from '/shared/constants.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), screens: $('screens'),
      levelName: $('levelName'), objective: $('objective'), taskList: $('taskList'),
      waveBox: $('waveBox'), partnerBox: $('partnerBox'), coin: $('coin'),
      healthFill: $('healthFill'), healthNum: $('healthNum'),
      ammoBox: $('ammoBox'), ammoMag: $('ammoMag'), ammoRes: $('ammoRes'),
      weaponName: $('weaponName'), weaponSlots: $('weaponSlots'),
      reloadBar: $('reloadBar'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
      toasts: $('toasts'), dmgNumbers: $('dmgNumbers'), damageFlash: $('damageFlash'),
      waypoint: $('waypoint'), wpArrow: $('wpArrow'), wpDist: $('wpDist'),
      prompt: $('prompt'), promptText: $('promptText'),
      downOverlay: $('downOverlay'), downTimer: $('downTimer'),
      patternOverlay: $('patternOverlay'),
      roomCode: $('roomCode'), slots: $('slots'),
      readyBtn: $('readyBtn'), startBtn: $('startBtn'), lobbyNote: $('lobbyNote'),
      menuError: $('menuError'), shopGrid: $('shopGrid'), shopCoin: $('shopCoin'),
      npcName: $('npcName'), npcLine: $('npcLine'),
      endStats: $('endStats'), endPlayers: $('endPlayers'),
      discReason: $('discReason'), discCode: $('discCode'),
      loadTitle: $('loadTitle'), loadSub: $('loadSub'),
    };
    this._v = new THREE.Vector3();
    this._hitTimer = 0;
    this._toasts = [];
    this._lastObjective = '';
  }

  // ---------------------------------------------------------------- screens

  showScreen(name) {
    for (const s of this.el.screens.children) s.classList.toggle('on', s.id === name);
    this.current = name || null;
  }

  hideScreens() {
    for (const s of this.el.screens.children) s.classList.remove('on');
    this.current = null;
  }

  showHUD(on) {
    this.el.hud.classList.toggle('hidden', !on);
  }

  error(msg) {
    this.el.menuError.textContent = msg || '';
  }

  loading(title, sub = '') {
    this.el.loadTitle.textContent = title;
    this.el.loadSub.textContent = sub;
    this.showScreen('loading');
  }

  // ------------------------------------------------------------------ lobby

  renderLobby(lobby, youId) {
    this.el.roomCode.textContent = lobby.code;
    const slots = [...this.el.slots.children];
    slots.forEach((el, i) => {
      const p = lobby.players.find((x) => x.slot === i);
      el.classList.toggle('empty', !p);
      el.classList.toggle('ready', !!p?.ready);
      el.classList.toggle('me', p?.id === youId);
      el.querySelector('.who').textContent = p ? p.name : 'Waiting…';
      el.querySelector('.state').textContent = p ? (p.ready ? 'Ready' : 'Not ready') : '';
    });
    const me = lobby.players.find((x) => x.id === youId);
    this.el.readyBtn.textContent = me?.ready ? 'Unready' : 'Ready';
    this.el.readyBtn.classList.toggle('primary', !me?.ready);
    this.el.startBtn.disabled = !lobby.canStart;
    this.el.lobbyNote.textContent = lobby.players.length < 2
      ? 'Waiting for a second player. This game needs exactly two.'
      : lobby.canStart ? 'Both ready — start whenever you like.'
        : 'Both slots filled. Both players must press Ready.';
  }

  // ------------------------------------------------------------------- HUD

  setLevel(name, objective) {
    this.el.levelName.textContent = name;
    this.el.objective.textContent = objective;
  }

  setHealth(hp) {
    const pct = Math.max(0, Math.min(100, (hp / MAX_HP) * 100));
    this.el.healthFill.style.width = `${pct}%`;
    this.el.healthFill.classList.toggle('low', pct <= 30);
    this.el.healthNum.textContent = Math.max(0, Math.round(hp));
  }

  setAmmo(weapons) {
    if (weapons.isGun) {
      this.el.ammoMag.textContent = weapons.mag;
      this.el.ammoRes.textContent = `/ ${weapons.reserve}`;
      this.el.ammoBox.classList.toggle('empty', weapons.mag === 0);
      this.el.ammoBox.style.visibility = 'visible';
    } else {
      this.el.ammoMag.textContent = '∞';
      this.el.ammoRes.textContent = '';
      this.el.ammoBox.classList.remove('empty');
    }
    this.el.weaponName.textContent = weapons.def.name;
    for (const s of this.el.weaponSlots.children) {
      s.classList.toggle('on', s.dataset.w === weapons.current);
    }
    const reloading = weapons.reloading > 0;
    this.el.reloadBar.classList.toggle('hidden', !reloading);
    if (reloading) this.el.reloadBar.firstElementChild.style.width = `${weapons.reloadFrac * 100}%`;
  }

  setCrosshairSpread(px) {
    this.el.crosshair.style.setProperty('--sp', `${px.toFixed(1)}px`);
  }

  setCoin(n) {
    this.el.coin.textContent = n;
  }

  setWave(wv) {
    if (!wv) { this.el.waveBox.classList.add('hidden'); return; }
    this.el.waveBox.classList.remove('hidden');
    const label = wv.st === 'done' ? 'ALL WAVES CLEAR'
      : wv.st === 'idle' ? `WAVE ${Math.min(wv.i + 1, wv.n)} INCOMING`
        : `WAVE ${wv.i} / ${wv.n}`;
    this.el.waveBox.innerHTML = `${label}<small>${wv.alive} hostile${wv.alive === 1 ? '' : 's'} left</small>`;
  }

  setPartner(p) {
    if (!p) {
      this.el.partnerBox.innerHTML = '<div class="pname">No partner</div>';
      return;
    }
    const pct = Math.max(0, Math.min(100, (p.hp / MAX_HP) * 100));
    this.el.partnerBox.classList.toggle('down', !p.al);
    this.el.partnerBox.innerHTML =
      `<div class="pname"><span>${escapeHTML(p.n)}</span><em>${p.al ? `${p.hp} hp` : `down ${p.dn}s`}</em></div>` +
      `<div class="pbar"><i style="width:${p.al ? pct : 0}%"></i></div>`;
  }

  setTasks(tasks, players, youId, tutorial) {
    const ul = this.el.taskList;
    const rows = [];

    if (tutorial) {
      const { step, done, steps } = tutorial;
      if (steps[step]) {
        const who = done.map((d) => `${escapeHTML(d.name)}: ${d.ok ? '<span class="ok">✅</span>' : '<span class="wait">waiting…</span>'}`).join(' &middot; ');
        rows.push(`<li>Drill ${step + 1} of ${steps.length} — ${escapeHTML(steps[step].text)}<span class="sub">${who}</span></li>`);
      }
    }

    for (const t of tasks || []) {
      if (t.active === false) continue;
      const name = (id) => escapeHTML(players.find((p) => p.i === id)?.n || 'someone');
      let sub = '';
      if (t.kind === 'hold') {
        const pct = Math.round((t.progress / t.total) * 100);
        sub = t.done ? '<span class="ok">done</span>'
          : t.holders.length ? `holding — ${pct}%` : 'nobody on the pad';
      } else if (t.kind === 'synced') {
        sub = Object.keys(t.flips || {}).length === 0 ? 'no switches thrown'
          : Object.keys(t.flips).map((k) => `${escapeHTML(k)}: <span class="ok">thrown ✅</span>`).join(' &middot; ');
        if (!t.done && Object.keys(t.flips || {}).length === 1) sub += ' &middot; <span class="wait">hurry</span>';
      } else if (t.kind === 'fetch') {
        sub = t.done ? '<span class="ok">delivered</span>'
          : t.carrier ? `${name(t.carrier)} is carrying it` : 'core not picked up';
      } else if (t.kind === 'defend') {
        sub = t.done ? '<span class="ok">relay set</span>'
          : t.holder ? `${name(t.holder)} <span class="ok">holding ✅</span> — other player, go to the relay`
            : '<span class="wait">nobody holding</span>';
      } else if (t.kind === 'pattern') {
        sub = t.done ? '<span class="ok">matched</span>'
          : t.showing ? 'watch the sequence…' : `${t.input} / ${t.len} entered`;
      }
      rows.push(`<li class="${t.done ? 'done' : ''}">${escapeHTML(t.label)}<span class="sub">${sub}</span></li>`);
    }

    const html = rows.join('');
    if (ul.dataset.h !== html) { ul.innerHTML = html; ul.dataset.h = html; }
  }

  prompt(text, busy = false) {
    const on = !!text;
    this.el.prompt.classList.toggle('hidden', !on);
    this.el.prompt.classList.toggle('busy', busy);
    if (on) this.el.promptText.textContent = text;
  }

  setDown(seconds) {
    const on = seconds > 0;
    this.el.downOverlay.classList.toggle('hidden', !on);
    if (on) this.el.downTimer.textContent = seconds;
  }

  // ------------------------------------------------------------------- juice

  toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = escapeHTML(text);
    this.el.toasts.appendChild(el);
    this._toasts.push({ el, until: performance.now() + 5200 });
    while (this._toasts.length > 5) {
      const old = this._toasts.shift();
      old.el.remove();
    }
  }

  hitmark(kill) {
    this.el.hitmarker.classList.add('on');
    this.el.hitmarker.classList.toggle('kill', !!kill);
    this._hitTimer = kill ? 0.28 : 0.13;
  }

  hurtFlash() {
    this.el.damageFlash.style.transition = 'none';
    this.el.damageFlash.style.opacity = '0.85';
    requestAnimationFrame(() => {
      this.el.damageFlash.style.transition = 'opacity .35s ease-out';
      this.el.damageFlash.style.opacity = '0';
    });
  }

  damageNumber(worldPos, camera, text, kind = '') {
    const v = this._v.set(worldPos[0], worldPos[1], worldPos[2]).project(camera);
    if (v.z > 1) return;
    const el = document.createElement('div');
    el.className = `dmg ${kind}`;
    el.textContent = text;
    el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
    this.el.dmgNumbers.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }

  waypoint(worldPos, camera, playerPos) {
    if (!worldPos) { this.el.waypoint.classList.add('hidden'); return; }
    const v = this._v.set(worldPos[0], worldPos[1] + 1.4, worldPos[2]).project(camera);
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * innerWidth;
    let y = (-v.y * 0.5 + 0.5) * innerHeight;
    if (behind) { x = innerWidth - x; y = innerHeight - y; }

    const m = 56;
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    let rot = 0;
    const off = behind || x < m || x > innerWidth - m || y < m || y > innerHeight - m;
    if (off) {
      const dx = x - cx;
      const dy = y - cy;
      const ang = Math.atan2(dy, dx);
      const rx = (innerWidth / 2 - m);
      const ry = (innerHeight / 2 - m);
      const scale = Math.min(Math.abs(rx / Math.cos(ang)), Math.abs(ry / Math.sin(ang)));
      x = cx + Math.cos(ang) * scale;
      y = cy + Math.sin(ang) * scale;
      rot = ang + Math.PI / 2;
    }
    const dist = Math.hypot(worldPos[0] - playerPos[0], worldPos[2] - playerPos[2]);
    this.el.waypoint.classList.remove('hidden');
    this.el.waypoint.style.left = `${x}px`;
    this.el.waypoint.style.top = `${y}px`;
    this.el.wpArrow.style.transform = `rotate(${rot}rad)`;
    this.el.wpDist.textContent = `${Math.round(dist)}m`;
  }

  showPattern(seq, buttons) {
    const wrap = this.el.patternOverlay;
    wrap.innerHTML = '';
    wrap.classList.remove('hidden');
    const colorOf = (id) => {
      const b = buttons.find((x) => x.id === id);
      return b ? `#${b.color.toString(16).padStart(6, '0')}` : '#fff';
    };
    const cells = seq.map((id) => {
      const i = document.createElement('i');
      i.style.background = colorOf(id);
      i.style.color = colorOf(id);
      wrap.appendChild(i);
      return i;
    });
    return cells;
  }

  hidePattern() {
    this.el.patternOverlay.classList.add('hidden');
    this.el.patternOverlay.innerHTML = '';
  }

  // -------------------------------------------------------------------- shop

  renderShop(currency, owned, equippedColor, onPick) {
    this.el.shopCoin.textContent = currency;
    this.el.shopGrid.innerHTML = '';
    for (const c of COSMETICS) {
      const has = owned.includes(c.id);
      const equipped = has && c.color === equippedColor;
      const el = document.createElement('button');
      el.className = `sw ${has ? 'owned' : ''} ${equipped ? 'equipped' : ''} ${!has && currency < c.cost ? 'cant' : ''}`;
      el.innerHTML =
        `<i style="background:#${c.color.toString(16).padStart(6, '0')}"></i>` +
        `<span class="meta"><b>${escapeHTML(c.name)}</b>` +
        `<span class="cost">${equipped ? 'Equipped' : has ? 'Owned — click to wear' : `◈ ${c.cost}`}</span></span>`;
      el.onclick = () => onPick(c, has);
      this.el.shopGrid.appendChild(el);
    }
  }

  renderDialogue(name, line) {
    this.el.npcName.textContent = name;
    this.el.npcLine.textContent = line;
    this.showScreen('dialogue');
  }

  renderEnd(data) {
    const mm = Math.floor(data.seconds / 60);
    const ss = String(data.seconds % 60).padStart(2, '0');
    this.el.endStats.innerHTML = [
      ['Time', `${mm}:${ss}`], ['Kills', data.kills],
      ['Tasks', data.tasks], ['Downs', data.deaths],
    ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    this.el.endPlayers.innerHTML = data.players.map((p) =>
      `<div class="eprow"><b>${escapeHTML(p.name)}</b>` +
      `<span>${p.kills} kills &middot; ${p.deaths} downs &middot; ◈ ${p.currency} &middot; ${p.cosmetics} colour${p.cosmetics === 1 ? '' : 's'}</span></div>`).join('');
    this.showScreen('end');
  }

  tick(dt) {
    if (this._hitTimer > 0) {
      this._hitTimer -= dt;
      if (this._hitTimer <= 0) this.el.hitmarker.classList.remove('on');
    }
    const now = performance.now();
    while (this._toasts.length && this._toasts[0].until < now) {
      this._toasts.shift().el.remove();
    }
  }
}

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
