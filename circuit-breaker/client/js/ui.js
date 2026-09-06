// The DOM half of the client: the shop, the readouts and the overlay. Anything
// here is presentation only — it reads the Game and calls back into main.js, and
// never changes game state itself.

import { TOWERS, TOWER_ORDER, HEAT_MAX, OVERCLOCK, SURGE, WAVES, START_INTEGRITY } from '#shared/constants.js';
import { upgradeCost } from '#shared/sim.js';

// Purely cosmetic labels, so they live with the other presentation.
const GLYPH = { pulse: '◆', arc: '⚡', cryo: '✳', rail: '▮', laser: '◎' };
const ROLE = { pulse: 'RAPID', arc: 'CHAIN', cryo: 'SLOW', rail: 'SIEGE', laser: 'BEAM' };

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(handlers) {
    this.handlers = handlers;
    this.toastTimer = null;
    this.cards = new Map();
    this.lastLog = 0;

    this.el = {
      integrity: $('stat-integrity'), credits: $('stat-credits'),
      wave: $('stat-wave'), score: $('stat-score'),
      integrityBox: document.querySelector('.stat.integrity'),
      phase: $('phase-label'), rush: $('rush'), rushBonus: $('rush-bonus'),
      shop: $('shop'), selection: $('selection'),
      selName: $('sel-name'), selBlurb: $('sel-blurb'), selStats: $('sel-stats'),
      selHeat: $('sel-heat'), selUpgrade: $('sel-upgrade'),
      selOverclock: $('sel-overclock'), selSell: $('sel-sell'),
      surge: $('surge'), surgeState: $('surge-state'),
      toast: $('toast'),
      overlay: $('overlay'), ovKicker: $('ov-kicker'), ovTitle: $('ov-title'),
      ovText: $('ov-text'), ovAction: $('ov-action'), ovBoard: $('ov-scoreboard'),
      ovNameRow: $('ov-name-row'), ovName: $('ov-name'), ovSubmit: $('ov-submit'),
    };

    this.buildShop();
    this.el.rush.addEventListener('click', () => handlers.rush());
    this.el.surge.addEventListener('click', () => handlers.surge());
    this.el.selUpgrade.addEventListener('click', () => handlers.upgrade());
    this.el.selOverclock.addEventListener('click', () => handlers.overclock());
    this.el.selSell.addEventListener('click', () => handlers.sell());
    this.el.ovSubmit.addEventListener('click', () => handlers.submitScore(this.el.ovName.value));
  }

  buildShop() {
    for (const id of TOWER_ORDER) {
      const spec = TOWERS[id];
      const card = document.createElement('button');
      card.className = 'card';
      card.style.setProperty('--dot', spec.accent);
      card.setAttribute('aria-pressed', 'false');
      card.innerHTML = `<span class="glyph">${GLYPH[id]}</span>`
        + `<span><span class="name">${spec.name}</span><br><span class="role">${ROLE[id]}</span></span>`
        + `<span class="price">${spec.cost}₡</span>`;
      card.addEventListener('click', () => this.handlers.pick(id));
      this.el.shop.append(card);
      this.cards.set(id, card);
    }
  }

  toast(text, bad = false) {
    const el = this.el.toast;
    el.textContent = text;
    el.classList.toggle('bad', bad);
    el.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
  }

  sync(game, view) {
    const { el } = this;
    el.integrity.textContent = game.integrity;
    el.credits.textContent = Math.floor(game.credits);
    el.wave.textContent = `${game.waveNumber}/${WAVES.length}`;
    el.score.textContent = game.score().toLocaleString('en-US');

    const share = game.integrity / START_INTEGRITY;
    el.integrityBox.classList.toggle('hurt', share <= 0.5 && share > 0.25);
    el.integrityBox.classList.toggle('critical', share <= 0.25);

    if (game.phase === 'build') {
      el.phase.textContent = `BUILD ${Math.max(0, Math.ceil(game.buildTimer))}s`;
      el.phase.classList.remove('live');
      el.rush.disabled = false;
      const bonus = Math.round(Math.max(0, game.buildTimer) * 4);
      el.rushBonus.textContent = bonus > 0 ? `+${bonus}₡` : '';
    } else {
      const left = game.spawnQueue.length + game.packets.length;
      el.phase.textContent = `WAVE ${game.waveNumber} · ${left} LEFT`;
      el.phase.classList.add('live');
      el.rush.disabled = true;
      el.rushBonus.textContent = '';
    }

    for (const [id, card] of this.cards) {
      card.disabled = game.credits < TOWERS[id].cost;
      card.setAttribute('aria-pressed', String(view.placing === id));
    }

    el.surge.disabled = game.surgeCooldown > 0;
    el.surgeState.textContent = game.surgeCooldown > 0 ? `${Math.ceil(game.surgeCooldown)}s` : 'READY';

    this.syncSelection(game, view);

    // Simulation notes (wave cleared, rush bonus) surface as toasts.
    if (game.log.length && game.log[game.log.length - 1].at !== this.lastLog) {
      this.lastLog = game.log[game.log.length - 1].at;
      this.toast(game.log[game.log.length - 1].text);
    }
  }

  syncSelection(game, view) {
    const { el } = this;
    const tower = view.selected != null ? game.towers.get(view.selected) : null;
    if (!tower) { el.selection.hidden = true; return; }
    el.selection.hidden = false;

    const spec = TOWERS[tower.type];
    const level = spec.levels[tower.level - 1];
    const maxed = tower.level >= spec.levels.length;
    const cost = maxed ? 0 : upgradeCost(tower.type, tower.level);
    const boosted = tower.overclockLeft > 0;

    el.selName.textContent = `${spec.name} · L${tower.level}`;
    el.selBlurb.textContent = spec.blurb;
    el.selStats.innerHTML =
      `<dt>Damage</dt><dd>${level.damage}${boosted ? ` ×${OVERCLOCK.damageScale}` : ''}</dd>`
      + `<dt>Every</dt><dd>${(level.fireRate / (boosted ? OVERCLOCK.fireRateScale : 1)).toFixed(2)}s</dd>`
      + `<dt>Range</dt><dd>${level.range.toFixed(1)}</dd>`
      + `<dt>Status</dt><dd>${tower.overheated ? 'SHUT DOWN' : boosted ? 'OVERCLOCKED' : 'ONLINE'}</dd>`;

    const heat = Math.round((tower.heat / HEAT_MAX) * 100);
    el.selHeat.style.width = `${heat}%`;
    el.selHeat.classList.toggle('hot', heat > 75);

    el.selUpgrade.disabled = maxed || game.credits < cost;
    el.selUpgrade.textContent = maxed ? 'Max level' : `Upgrade ${cost}₡`;
    el.selOverclock.disabled = tower.overclockCooldown > 0;
    el.selOverclock.textContent = tower.overclockCooldown > 0
      ? `Overclock ${Math.ceil(tower.overclockCooldown)}s`
      : boosted ? `Overclocked ${tower.overclockLeft.toFixed(1)}s` : 'Overclock';
    el.selSell.textContent = `Sell ${Math.round(tower.invested * 0.6)}₡`;
  }

  // ---- overlay ---------------------------------------------------------

  showOverlay({ kicker, title, text, action, scores = null, askName = false }) {
    const { el } = this;
    el.ovKicker.textContent = kicker;
    el.ovTitle.textContent = title;
    el.ovText.textContent = text;
    el.ovAction.textContent = action;
    el.ovNameRow.hidden = !askName;
    this.renderScores(scores);
    el.overlay.classList.remove('gone');
  }

  hideOverlay() { this.el.overlay.classList.add('gone'); }

  renderScores(scores) {
    const el = this.el.ovBoard;
    if (!scores || !scores.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = scores.slice(0, 8).map((row, i) =>
      `<div><span>${i + 1}. <b>${escapeHtml(row.name)}</b></span>`
      + `<span>wave ${row.wave} · ${row.score.toLocaleString('en-US')}</span></div>`).join('');
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
