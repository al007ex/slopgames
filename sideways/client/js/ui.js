// The menus and the HUD. Plain DOM: cheap to update, easy to read.

import { CARS } from '#shared/cars.js';

const $ = (sel) => document.querySelector(sel);

export const MODES = [
  { id: 'street', name: 'DOWNTOWN', tag: 'Street', icon: '◢', blurb: 'Night streets, parked cars and a roundabout. Chain slides between the towers; the closer the wall, the bigger the score.' },
  { id: 'takeover', name: 'THE PIT', tag: 'Takeover', icon: '◉', blurb: 'The intersection is yours for two and a half minutes. Donuts, rollbacks, flames. Hype the crowd before the cops show up.' },
  { id: 'track', name: 'HARBOR CIRCUIT', tag: 'Track', icon: '⟲', blurb: 'A walled drift circuit. Clip the apexes, kiss the outer zones, and get judged on line, angle and style.' },
];

const fmt = (n) => Math.round(n).toLocaleString('en-US');

/** Relative stats for the car cards, from the specs themselves. */
function stats(spec) {
  const peak = Math.max(...spec.engine.torque.map(([rpm, t]) => rpm * t / 9549 * (spec.engine.turbo ? 1 : 1)));
  return {
    POWER: Math.min(1, peak / 520),
    WEIGHT: 1 - (spec.mass - 1100) / 700,
    ANGLE: (spec.steerLock * 180 / Math.PI - 45) / 20,
    REVS: (spec.engine.limit - 6000) / 3200,
  };
}

export class UI {
  constructor(settings, handlers) {
    this.settings = settings;
    this.h = handlers;
    this.els = {
      menu: $('#menu'), hud: $('#hud'), pause: $('#pause'), results: $('#results'),
      combo: $('#combo'), comboPts: $('#combo-points'), comboMult: $('#combo-mult'), comboAngle: $('#combo-angle div'), comboTags: $('#combo-tags'),
      callouts: $('#callouts'), where: $('#where'),
      score: $('#session-score .val'), best: $('#session-best .val'),
      takeover: $('#takeover'), toTime: $('#to-time'), hype: $('#hype-fill'),
      laps: $('#laps'), lapNo: $('#lap-no'), lapLast: $('#lap-last'), clips: $('#clips'),
      dash: $('#dash'), gear: $('#gear'), rpm: $('#rpm'), speed: $('#speed-v'), unit: $('#speed .unit'), boost: $('#boost-fill'),
      tachFill: $('#tach-fill'), tachRed: $('#tach-red'), hint: $('#hint'),
    };
    this.tachLen = this.els.tachFill.getTotalLength();
    this.els.tachFill.style.strokeDasharray = `${this.tachLen} ${this.tachLen}`;
    this.last = {};
    this.buildMenu();
    this.bindSheets();
  }

  // ------------------------------------------------------------------- menu
  buildMenu() {
    const s = this.settings;
    const modes = $('#modes');
    modes.innerHTML = '';
    for (const m of MODES) {
      const b = document.createElement('button');
      b.className = 'card' + (s.where === m.id ? ' on' : '');
      b.innerHTML = `<span class="ico">${m.icon}</span><span class="txt"><span class="nm">${m.name}<small>${m.tag.toUpperCase()}</small></span><span class="ds">${m.blurb}</span></span>`;
      b.onclick = () => { s.where = m.id; this.h.save(); this.buildMenu(); this.h.preview(); };
      modes.appendChild(b);
    }
    const cars = $('#cars');
    cars.innerHTML = '';
    for (const c of CARS) {
      const b = document.createElement('button');
      b.className = 'card' + (s.car === c.id ? ' on' : '');
      const st = stats(c);
      b.innerHTML = `<span class="txt"><span class="nm">${c.name}<small>${c.tag.toUpperCase()}</small></span><span class="ds">${c.blurb}</span>
        <span class="stats">${Object.entries(st).map(([k, v]) => `<span>${k}</span><span class="bar"><i style="width:${Math.round(Math.max(0.08, Math.min(1, v)) * 100)}%"></i></span>`).join('')}</span></span>`;
      b.onclick = () => { s.car = c.id; if (!c.colors.includes(s.color)) s.color = c.colors[0]; this.h.save(); this.buildMenu(); this.h.preview(); };
      cars.appendChild(b);
    }
    const car = CARS.find((c) => c.id === s.car) || CARS[0];
    const paint = $('#paint');
    paint.innerHTML = '';
    for (const col of car.colors) {
      const b = document.createElement('button');
      b.style.background = col;
      b.className = s.color === col ? 'on' : '';
      b.title = col;
      b.onclick = () => { s.color = col; this.h.save(); this.buildMenu(); this.h.preview(); };
      paint.appendChild(b);
    }
    for (const t of document.querySelectorAll('.toggle')) {
      const key = t.dataset.key;
      for (const b of t.querySelectorAll('button')) {
        b.classList.toggle('on', s[key] === b.dataset.v);
        b.onclick = () => { s[key] = b.dataset.v; this.h.save(); this.buildMenu(); };
      }
    }
    const name = $('#name');
    name.value = s.name || '';
    name.oninput = () => { s.name = name.value.replace(/[^\w \-]/g, '').slice(0, 14); this.h.save(); };
    $('#drive').onclick = () => this.h.drive();
  }

  bindSheets() {
    for (const b of document.querySelectorAll('[data-open]')) b.onclick = () => this.open(b.dataset.open);
    for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => this.closeSheets();
    for (const b of document.querySelectorAll('[data-act]')) b.onclick = () => this.h.act(b.dataset.act, b.dataset.where);
  }

  open(id) {
    if (id === 'settings') this.renderSettings();
    if (id === 'boards') this.h.loadBoards();
    $(`#${id}`).hidden = false;
    this.sheet = id;
  }

  closeSheets() {
    for (const id of ['controls', 'settings', 'boards']) $(`#${id}`).hidden = true;
    this.sheet = null;
  }

  renderSettings() {
    const s = this.settings;
    const list = $('#settings-list');
    list.innerHTML = '';
    const row = (label, el) => { const d = document.createElement('label'); d.className = 'set'; d.append(label, el); list.appendChild(d); };
    const seg = (key, options, after) => {
      const d = document.createElement('div'); d.className = 'seg';
      for (const [v, name] of options) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.className = s[key] === v ? 'on' : '';
        b.onclick = () => { s[key] = v; this.h.save(); after?.(v); this.renderSettings(); };
        d.appendChild(b);
      }
      return d;
    };
    const vol = document.createElement('input'); vol.type = 'range'; vol.min = 0; vol.max = 1; vol.step = 0.05; vol.value = s.volume;
    vol.oninput = () => { s.volume = Number(vol.value); this.h.save(); this.h.volume(s.volume); };
    row('Volume', vol);
    row('Graphics', seg('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], (v) => this.h.quality(v)));
    row('Smoke', seg('smoke', [['light', 'Light'], ['normal', 'Normal'], ['heavy', 'Heavy']]));
    row('Speed', seg('units', [['kmh', 'km/h'], ['mph', 'mph']]));
    row('Touch controls', seg('touch', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], () => this.h.touch()));
  }

  showMenu(on) {
    this.els.menu.hidden = !on;
    this.els.hud.hidden = on;
  }

  // -------------------------------------------------------------------- HUD
  hud(drive, car, dt) {
    const e = this.els, s = this.settings;
    const set = (key, value, fn) => { if (this.last[key] !== value) { this.last[key] = value; fn(value); } };
    // Dash.
    const spec = car.spec;
    const rpmShare = Math.min(1, car.rpm / (spec.engine.limit + 400));
    e.tachFill.style.strokeDashoffset = String(this.tachLen * (1 - rpmShare));
    const redFrom = spec.engine.limit * 0.9 / (spec.engine.limit + 400);
    set('red', redFrom, (v) => { e.tachRed.style.strokeDasharray = `${this.tachLen * (1 - v)} ${this.tachLen}`; e.tachRed.style.strokeDashoffset = String(-this.tachLen * v); });
    set('gear', car.nextGear, (g) => { e.gear.textContent = g < 0 ? 'R' : g === 0 ? 'N' : String(g); });
    set('rpm', Math.round(car.rpm / 50) * 50, (v) => { e.rpm.textContent = `${v} RPM`; });
    const sp = s.units === 'mph' ? car.speed * 2.23694 : car.speed * 3.6;
    set('speed', Math.round(sp), (v) => { e.speed.textContent = String(v); });
    set('unit', s.units, (u) => { e.unit.textContent = u === 'mph' ? 'MPH' : 'KM/H'; });
    set('limit', car.cut || car.rpm > spec.engine.limit * 0.97, (v) => e.dash.classList.toggle('limit', v));
    e.boost.style.width = `${Math.round(car.boost * 100)}%`;

    // The combo in progress.
    const d = drive.drift;
    const showCombo = d.active || this.comboHold > 0;
    this.comboHold = Math.max(0, (this.comboHold || 0) - dt);
    set('comboOn', showCombo, (v) => e.combo.classList.toggle('on', v));
    if (d.active) {
      set('pts', Math.round(d.pending / 10) * 10, (v) => { e.comboPts.textContent = fmt(v); });
      set('mult', d.mult.toFixed(1), (v) => { e.comboMult.textContent = `×${v}`; });
      e.comboAngle.style.width = `${Math.min(100, Math.abs(car.slipAngle) * 180 / Math.PI / 60 * 100)}%`;
      set('tags', [...d.tags].join(' '), (v) => { e.comboTags.textContent = v.toUpperCase(); });
      e.combo.classList.remove('lost');
    }

    // Session panel.
    const t = drive.takeover;
    set('takeoverOn', !!t, (v) => { e.takeover.hidden = !v; });
    const score = t ? t.score : drive.drift.total;
    set('score', score, (v) => { e.score.textContent = fmt(v); });
    set('best', drive.drift.best, (v) => { e.best.textContent = fmt(v); });
    if (t) {
      const left = Math.max(0, t.length - t.time);
      set('toTime', Math.ceil(left), (v) => { e.toTime.textContent = `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; });
      e.hype.style.width = `${Math.round(t.hype * 100)}%`;
    }
    const lap = drive.judge.lap;
    const onTrack = drive.zone === 'track' || !!lap;
    set('lapsOn', onTrack, (v) => { e.laps.hidden = !v; });
    if (onTrack) {
      set('lapNo', drive.judge.laps.length + (lap ? 1 : 0), (v) => { e.lapNo.textContent = v ? String(v) : '–'; });
      const last = drive.judge.laps.at(-1);
      set('lapLast', last ? last.total : null, (v) => { e.lapLast.textContent = v === null ? '–' : `${v}/100`; });
      const key = lap ? [...lap.clips.entries()].map(([k, v]) => `${k}:${typeof v === 'number' ? v.toFixed(1) : (v.good / Math.max(v.in, 0.01)).toFixed(1)}`).join() : '';
      set('clips', key, () => this.drawClips(drive));
    }
    const zone = { street: 'DOWNTOWN', pit: 'THE PIT', track: 'HARBOR CIRCUIT', harbour: 'THE HARBOUR' }[drive.zone] || '';
    set('zone', zone, (v) => { e.where.textContent = v; });
  }

  drawClips(drive) {
    const t = drive.world.track, lap = drive.judge.lap;
    this.els.clips.innerHTML = t.clips.map((c) => {
      const v = lap?.clips.get(c.id);
      const q = c.kind === 'inner' ? v || 0 : v ? Math.min(1, v.good / Math.max(v.in * 0.6, 0.3)) : 0;
      return `<i class="${c.kind}${q > 0.85 ? ' perfect' : q > 0.4 ? ' hit' : ''}"></i>`;
    }).join('');
  }

  /** A big word in the middle of the screen. */
  callout(text, cls = '', sub = '') {
    if (!text) return;
    const el = document.createElement('div');
    el.className = `callout ${cls}`;
    el.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    this.els.callouts.appendChild(el);
    while (this.els.callouts.children.length > 3) this.els.callouts.firstChild.remove();
    setTimeout(() => el.remove(), 1700);
  }

  banked(ev) {
    this.els.comboPts.textContent = `+${fmt(ev.points)}`;
    this.comboHold = 1.2;
    this.callout(ev.text, ev.points > 8000 ? 'gold' : ev.points > 2000 ? 'cool' : '', `+${fmt(ev.points)}`);
  }

  lost(ev) {
    this.comboHold = 1.2;
    this.els.combo.classList.add('lost');
    this.callout('CRASHED', 'hot');
    void ev;
  }

  hint(text, seconds = 4) {
    const h = this.els.hint;
    h.textContent = text;
    h.classList.add('on');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => h.classList.remove('on'), seconds * 1000);
  }

  results(title, score, lines, rank = '') {
    $('#res-title').textContent = title;
    $('#res-score').textContent = fmt(score);
    $('#res-lines').innerHTML = lines.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
    $('#res-rank').textContent = rank;
    this.els.results.hidden = false;
  }

  setRank(text) { $('#res-rank').textContent = text; }

  boards(data) {
    const names = { street: 'Downtown · best combo', takeover: 'The Pit · takeover', track: 'Circuit · best lap' };
    $('#boards-list').innerHTML = Object.entries(names).map(([k, title]) => `<div class="board"><h4>${title.toUpperCase()}</h4><ol>${(data?.[k] || []).map((e) => `<li>${escapeHtml(e.name)} <span>${fmt(e.score)}</span></li>`).join('') || '<li>Nobody yet</li>'}</ol></div>`).join('');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
