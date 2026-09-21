// Bootstrap and frame loop. Owns the game phase (menu → playing → dead) and
// is the only place that talks to the server; rendering, input and the DOM
// each live in their own module.

import { encodeJoin, encodeInput, encodeView, encodePing, SERVER } from '#shared/protocol.js';
import { viewDiagonalOf } from '#shared/rules.js';
import { GameState } from './state.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Net } from './net.js';

const touch = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', touch);

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const input = new Input(canvas, {
  boostButton: document.getElementById('boost'),
  stick: document.getElementById('stick'),
  knob: document.getElementById('knob'),
});

let state = new GameState();
let phase = 'menu';           // menu | joining | playing | dead
let lastInput = { angle: 0, boost: false, at: 0 };
let lastView = { halfWidth: 0, halfHeight: 0, at: 0 };

const ui = new UI({
  onPlay: (name, skin) => {
    if (!net.open || phase === 'joining' || phase === 'playing') return;
    phase = 'joining';
    net.send(encodeJoin(name, skin));
    // On a phone, the address bar and home indicator eat a lot of arena.
    if (touch && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  },
  onMenu: () => { phase = 'menu'; ui.showMenu(); },
});

function wireState() {
  state.on('welcome', (message) => {
    if (!message.you) return;
    phase = 'playing';
    lastInput = { angle: null, boost: false, at: 0 };
    input.disarm();
    ui.hideMenu();
  });
  state.on('death', (event) => {
    renderer.burst(event.points, event.victimInfo?.skin ?? 0);
    ui.death(event, state.you);
  });
  state.on('youDied', (message) => {
    phase = 'dead';
    input.release();
    const killerName = state.info.get(message.killer)?.name;
    // A beat to watch it happen before the card comes up.
    setTimeout(() => { if (phase === 'dead') ui.showDeath({ ...message, killerName }); }, 1100);
  });
}
wireState();

const socketUrl = () => {
  const url = new URL('ws', location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
};

const net = new Net(socketUrl(), {
  onMessage(message, now) {
    state.receive(message, now);
    if (message.type === SERVER.BOARD) ui.updateBoard(state);
  },
  onStatus(status) {
    if (status === 'open') {
      // Every connection starts from a full sync, so start from a clean slate.
      state = new GameState();
      wireState();
      lastView = { halfWidth: 0, halfHeight: 0, at: 0 };
      if (phase !== 'menu') { phase = 'menu'; ui.showMenu(); }
    }
    ui.status(status === 'open' ? null : status);
  },
});

// Two kinds of "still here": our own server counts sockets, and the portal that
// launched the game keeps it awake while this heartbeat keeps arriving.
setInterval(() => {
  fetch('/api/games/glowworm/heartbeat', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
}, 25_000);
setInterval(() => net.send(encodePing(performance.now())), 2000);

window.addEventListener('resize', () => renderer.resize());

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const view = state.frame(now);
  const you = view.youSnake;

  // The camera pulls back as you grow; small screens see a little less.
  const diagonal = Math.hypot(window.innerWidth, window.innerHeight);
  const smallScreen = Math.min(1, Math.max(0.72, diagonal / 1500));
  const mass = you ? you.mass : 120;
  const scale = diagonal / (viewDiagonalOf(mass) * smallScreen);
  renderer.zoomTo(scale, dt);
  let focus = you ? { x: you.points[0], y: you.points[1] } : view.camera;
  if (!you && focus && window.innerWidth > 900 && ui.overlayOpen) {
    // The menu card sits in the middle of the screen; shift the camera so the
    // snake being watched plays out in the open space to its left.
    focus = { x: focus.x + (window.innerWidth * 0.27) / renderer.scale, y: focus.y };
  }
  renderer.aim(focus, Boolean(you), dt);

  // Tell the server how much world we can see, so it sends what is on screen.
  const halfWidth = window.innerWidth / 2 / renderer.targetScale;
  const halfHeight = window.innerHeight / 2 / renderer.targetScale;
  if (Math.abs(halfWidth - lastView.halfWidth) > lastView.halfWidth * 0.06
    || Math.abs(halfHeight - lastView.halfHeight) > lastView.halfHeight * 0.06
    || now - lastView.at > 3000) {
    net.send(encodeView(halfWidth, halfHeight));
    lastView = { halfWidth, halfHeight, at: now };
  }

  if (phase === 'playing' && you) {
    const head = renderer.toScreen(you.points[0], you.points[1]);
    const wanted = input.angle(head, you.angle, dt);
    // Nothing chosen yet: hold the heading the server spawned us with.
    const angle = wanted ?? lastInput.angle ?? you.angle;
    const boost = input.boost;
    const turned = lastInput.angle === null || Math.abs(angle - lastInput.angle) > 0.012;
    const changed = turned || boost !== lastInput.boost;
    if ((changed && now - lastInput.at > 33) || now - lastInput.at > 250) {
      net.send(encodeInput(angle, boost));
      lastInput = { angle, boost, at: now };
    }
  }

  renderer.draw(view, state, { time: now / 1000, dt });
  ui.frame(view, state, now);
  requestAnimationFrame(frame);
}

ui.showMenu();
requestAnimationFrame(frame);
