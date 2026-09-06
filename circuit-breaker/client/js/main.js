// Bootstrap: owns the Game, drives the frame loop, and turns clicks and keys
// into calls on the simulation. Everything decorative lives in render.js and
// everything in the DOM lives in ui.js, so this file stays mostly wiring.

import { Game } from '#shared/sim.js';
import { TOWER_ORDER, TOWERS, WAVES } from '#shared/constants.js';
import { idx } from '#shared/grid.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';

const canvas = document.getElementById('board');
const renderer = new Renderer(canvas);

let game = new Game({ seed: (Math.random() * 1e9) | 0 });
let placing = null;      // tower id queued for placement
let selected = null;     // cell index of the inspected tower
let hover = null;        // { col, row } under the pointer
let hoverValid = false;
let running = false;     // false while an overlay is up
let submitted = false;

const view = () => ({ placing, selected, hover, valid: hoverValid });

const ui = new UI({
  pick(id) { placing = placing === id ? null : id; selected = null; },
  rush() { act(game.rush()); },
  surge() { act(game.surge()); },
  upgrade() { if (selected != null) act(game.upgrade(selected)); },
  overclock() { if (selected != null) act(game.overclock(selected)); },
  sell() { if (selected != null && act(game.sell(selected))) selected = null; },
  submitScore(name) { submitScore(name); },
});

/** Report whatever the simulation refused, and pass the result through. */
function act(result) {
  if (!result?.ok && result?.reason) ui.toast(result.reason, true);
  return Boolean(result?.ok);
}

// ---- input ---------------------------------------------------------------

canvas.addEventListener('pointermove', (event) => {
  hover = renderer.cellAt(event.clientX, event.clientY);
  hoverValid = Boolean(placing && hover && game.placementCheck(hover.col, hover.row).ok);
});
canvas.addEventListener('pointerleave', () => { hover = null; });

canvas.addEventListener('pointerdown', (event) => {
  const cell = renderer.cellAt(event.clientX, event.clientY);
  if (!cell) return;
  const index = idx(cell.col, cell.row);

  if (placing) {
    if (act(game.place(cell.col, cell.row, placing))) {
      selected = index;
      // Keep the tower armed so a row of them is one click each, but drop it
      // as soon as the next one is unaffordable.
      if (game.credits < TOWERS[placing].cost) placing = null;
      hoverValid = Boolean(placing && game.placementCheck(cell.col, cell.row).ok);
    }
    return;
  }
  selected = game.towers.has(index) ? index : null;
});

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  const number = Number(event.key);
  if (number >= 1 && number <= TOWER_ORDER.length) {
    ui.handlers.pick(TOWER_ORDER[number - 1]);
    return;
  }
  switch (event.key) {
    case 'Escape': placing = null; selected = null; break;
    case ' ': event.preventDefault(); if (game.phase === 'build') act(game.rush()); break;
    case 'q': case 'Q': act(game.surge()); break;
    default: break;
  }
});

window.addEventListener('resize', () => renderer.resize());

// ---- scores --------------------------------------------------------------

async function fetchScores() {
  try {
    const res = await fetch('./api/scores');
    if (!res.ok) return null;
    return (await res.json()).scores;
  } catch { return null; }
}

async function submitScore(rawName) {
  if (submitted) return;
  submitted = true;
  const name = (rawName || '').trim() || 'anon';
  try {
    localStorage.setItem('circuitbreaker.name', name);
  } catch { /* Private browsing: the name just will not be remembered. */ }
  try {
    const res = await fetch('./api/scores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, score: game.score(), wave: game.wave }),
    });
    const data = await res.json();
    ui.renderScores(data.scores);
    ui.el.ovNameRow.hidden = true;
  } catch {
    ui.toast('Could not save that score.', true);
  }
}

// ---- overlays ------------------------------------------------------------

async function showIntro() {
  ui.showOverlay({
    kicker: 'INCOMING',
    title: 'CIRCUIT BREAKER',
    text: 'Packets enter on the left and walk to your core. Towers cannot wall the route off — only bend it — so build a maze, then manage the heat: every tower shuts down if you push it too hard, and Overclock trades a guaranteed shutdown for five seconds of doubled fire.',
    action: 'Start defending',
    scores: await fetchScores(),
  });
  ui.el.ovAction.onclick = () => { ui.hideOverlay(); running = true; };
}

async function showEnding() {
  running = false;
  const won = game.phase === 'won';
  let remembered = '';
  try { remembered = localStorage.getItem('circuitbreaker.name') || ''; } catch { /* ignore */ }
  ui.el.ovName.value = remembered;

  ui.showOverlay({
    kicker: won ? 'CORE INTACT' : 'CORE BREACHED',
    title: won ? 'You held all 25 waves' : `Wave ${game.wave + 1} got through`,
    text: won
      ? `Nothing reached the core that you could not answer. Final score ${game.score().toLocaleString('en-US')}.`
      : `You cleared ${game.wave} of ${WAVES.length} waves and banked ${game.score().toLocaleString('en-US')} points.`,
    action: 'Play again',
    scores: await fetchScores(),
    askName: true,
  });
  ui.el.ovAction.onclick = () => {
    game = new Game({ seed: (Math.random() * 1e9) | 0 });
    placing = null;
    selected = null;
    submitted = false;
    ui.lastLog = 0;
    ui.hideOverlay();
    running = true;
  };
}

// ---- presence ------------------------------------------------------------

// The portal sleeps a game server once nobody is playing. Both pings say "still
// here": one to the portal that launched us, one to our own server so /health
// reports a player count.
let playerId = '';
try {
  playerId = sessionStorage.getItem('circuitbreaker.id') || '';
  if (!playerId) {
    playerId = Math.random().toString(36).slice(2, 12);
    sessionStorage.setItem('circuitbreaker.id', playerId);
  }
} catch {
  playerId = Math.random().toString(36).slice(2, 12);
}

setInterval(() => {
  fetch(`./api/ping?id=${encodeURIComponent(playerId)}`, { method: 'POST' }).catch(() => {});
  fetch('/api/games/circuit-breaker/heartbeat', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
}, 25_000);

// ---- loop ----------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (running) {
    game.step(dt);
    if (!game.running) showEnding();
  }

  if (placing && hover) hoverValid = game.placementCheck(hover.col, hover.row).ok;
  if (selected != null && !game.towers.has(selected)) selected = null;

  renderer.draw(game, view());
  ui.sync(game, view());
  requestAnimationFrame(frame);
}

renderer.resize();
requestAnimationFrame(frame);
showIntro();
