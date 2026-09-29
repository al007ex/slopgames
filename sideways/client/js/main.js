// Boot, the frame loop, and the glue between the simulation, the picture,
// the sound and the HUD.

import * as THREE from 'three';
import { buildWorld } from '#shared/world.js';
import { carById } from '#shared/cars.js';
import { View } from './render/scene.js';
import { City } from './render/city.js';
import { CarModel } from './render/car.js';
import { Effects } from './render/fx.js';
import { Crowd } from './render/crowd.js';
import { ChaseCam } from './camera.js';
import { Input } from './input.js';
import { Drive } from './game.js';
import { Audio } from './audio/audio.js';
import { UI } from './ui.js';
import { Minimap } from './minimap.js';

// ------------------------------------------------------------- settings
const DEFAULTS = { where: 'street', car: 'ronin', color: '#e8e6e1', assist: 'easy', gearbox: 'auto', name: '', volume: 0.8, quality: 'high', smoke: 'normal', units: 'kmh', touch: 'auto', camera: 'chase', seen: false };
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('sideways') || '{}') }; } catch { return { ...DEFAULTS }; }
}
const settings = loadSettings();
const save = () => { try { localStorage.setItem('sideways', JSON.stringify(settings)); } catch { /* private mode */ } };
if (!/^#[0-9a-f]{6}$/i.test(settings.color)) settings.color = DEFAULTS.color;

// ---------------------------------------------------------------- world
const world = buildWorld();
const view = new View(document.getElementById('view'));
view.setQuality(settings.quality);
const city = new City(view.scene, world);
const fx = new Effects(view.scene);
const crowd = new Crowd(view.scene, world.pit);
const cam = new ChaseCam(view.camera);
cam.mode = settings.camera;
const input = new Input();
const audio = new Audio();
const minimap = new Minimap(document.getElementById('minimap'), world);

// Cones: one small instanced mesh, driven by the props sim.
const coneMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.26, 0.72, 10).translate(0, 0.36, 0), new THREE.MeshStandardMaterial({ color: '#ff6a1f', roughness: 0.6, emissive: '#ff4a10', emissiveIntensity: 0.25 }), world.cones.length);
view.scene.add(coneMesh);

// The lamps nearest the car get real lights, so the paint lights up as it passes under them.
const lampLights = [0, 1, 2].map(() => { const l = new THREE.PointLight('#ffb36b', 0, 28, 1.5); view.scene.add(l); return l; });

let drive = null;
let model = null;
let state = 'menu';
const sessionId = Math.random().toString(36).slice(2, 12);

function newDrive() {
  drive = new Drive(world, { car: settings.car, assist: settings.assist, manual: settings.gearbox === 'manual', where: settings.where });
  if (model) view.scene.remove(model.root);
  model = new CarModel(carById(settings.car), settings.color);
  view.scene.add(model.root);
  fx.flames.attach(model.root, model.exhaustPoints());
  fx.clear();
  cam.snap(drive.pose);
  if (audio.ready) audio.setCar(drive.spec);
}
newDrive();

// ----------------------------------------------------------------- UI
const ui = new UI(settings, {
  save,
  preview: () => { newDrive(); },
  drive: () => startDriving(),
  act: (what, where) => act(what, where),
  volume: (v) => audio.setVolume(v),
  quality: (q) => view.setQuality(q),
  touch: () => applyTouch(),
  loadBoards: () => fetch('api/scores').then((r) => r.json()).then((d) => ui.boards(d)).catch(() => ui.boards(null)),
});

function applyTouch() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  document.getElementById('touch').hidden = !(settings.touch === 'on' || (settings.touch === 'auto' && coarse));
}
applyTouch();

async function startDriving() {
  newDrive();
  ui.showMenu(false);
  state = 'drive';
  document.getElementById('pause').hidden = true;
  const e = drive.spec.engine;
  await audio.start({ kind: e.kind, limit: e.limit, turbo: !!e.turbo, supercharger: !!e.supercharger, bov: e.kind === 'rotary' ? 'flutter' : 'bov' });
  audio.setVolume(settings.volume);
  audio.setCar(drive.spec);
  if (!settings.seen) {
    settings.seen = true; save();
    ui.hint('W to go · A/D to steer · tap SPACE as you turn in to drift', 7);
  } else ui.hint(settings.where === 'takeover' ? 'Drive into the ring to start the takeover' : settings.where === 'track' ? 'Cross the line to start a judged lap' : 'Chain slides for points · R resets the car', 5);
  ping();
}

function act(what, where) {
  if (what === 'resume') setPause(false);
  if (what === 'goto') { settings.where = where; save(); drive.spawn(where); fx.clear(); cam.snap(drive.pose); setPause(false); }
  if (what === 'menu') { setPause(false); state = 'menu'; ui.showMenu(true); audio.suspend(); newDrive(); }
  if (what === 'again') { document.getElementById('results').hidden = true; drive.spawn('takeover'); drive.takeoverDone = null; cam.snap(drive.pose); state = 'drive'; audio.resume(); }
  if (what === 'close') { document.getElementById('results').hidden = true; state = 'drive'; audio.resume(); }
}

function setPause(on) {
  if (state === 'menu') return;
  state = on ? 'pause' : 'drive';
  document.getElementById('pause').hidden = !on;
  if (on) audio.suspend(); else audio.resume();
}

// ------------------------------------------------------------- network
function ping() {
  if (state === 'menu') return;
  fetch(`api/ping?id=${sessionId}`, { method: 'POST' }).catch(() => {});
}
setInterval(ping, 30_000);

const submitted = { street: 0, takeover: 0, track: 0 };
async function submit(board, score) {
  if (score <= submitted[board]) return null;
  submitted[board] = score;
  try {
    const r = await fetch('api/scores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ board, score, name: settings.name || 'anon', car: settings.car }) });
    return await r.json();
  } catch { return null; }
}

// ------------------------------------------------------------ one-shots
function handleKeys() {
  for (const code of input.takeEdges()) {
    if (code === 'Escape') {
      if (ui.sheet) ui.closeSheets();
      else if (state === 'drive') setPause(true);
      else if (state === 'pause') setPause(false);
      continue;
    }
    if (state !== 'drive') continue;
    if (code === 'KeyC') { settings.camera = cam.cycle(); save(); ui.hint(`Camera: ${settings.camera}`, 1.5); }
    if (code === 'KeyR') { drive.resetCar(); cam.snap(drive.pose); fx.skids.trails.clear(); }
    if (code === 'KeyE') input.raw.shiftUp = true;
    if (code === 'KeyQ') input.raw.shiftDown = true;
    if (code === 'KeyM') ui.hint(audio.toggleMute() ? 'Sound off' : 'Sound on', 1.5);
    if (code === 'KeyT') { drive.pilot.manual = !drive.pilot.manual; settings.gearbox = drive.pilot.manual ? 'manual' : 'auto'; save(); ui.hint(`Gearbox: ${settings.gearbox}`, 1.5); }
  }
}

// ------------------------------------------------------------------ FX
const tmpLamps = [];
const wheelAcc = new Float32Array(4);
const SMOKE = { light: 0.5, normal: 1, heavy: 1.8 };

function emitFx(dt) {
  const car = drive.car, s = car.spec, pose = drive.pose;
  const ch = Math.cos(pose.heading), sh = Math.sin(pose.heading);
  const a = s.cgFront, b = s.wheelbase - s.cgFront, half = s.track / 2;
  const smokeK = SMOKE[settings.smoke] || 1;
  // Light for the smoke: brighter under lamps, redder behind the car when braking.
  city.nearestLamps(pose.x, pose.y, 1, tmpLamps);
  const lampD = tmpLamps.length ? Math.sqrt(tmpLamps[0].d) : 99;
  const lit = 0.34 + 0.4 * Math.max(0, 1 - lampD / 22);
  const pit = drive.zone === 'pit';
  const wheels = [[a, -half, car.front], [a, half, car.front], [-b, -half, car.rear], [-b, half, car.rear]];
  for (let i = 0; i < 4; i++) {
    const [lx, lz, ax] = wheels[i];
    const x = pose.x + ch * lx + sh * lz, y = pose.y + sh * lx - ch * lz;
    // Rubber on the road.
    const mark = ax.slide > 1.6 ? Math.min(0.85, (ax.slip - 1.1) * 0.3 + ax.slide * 0.045) : 0;
    fx.skids.mark(i, x, y, s.wheelWidth / 2, mark);
    // Smoke from sliding, spinning or locked tyres.
    const rate = Math.max(0, ax.slide - (i < 2 ? 6 : 2.6)) / 10;
    wheelAcc[i] += Math.min(rate, 1.6) * 42 * smokeK * dt;
    while (wheelAcc[i] >= 1) {
      wheelAcc[i] -= 1;
      const red = drive.controls?.brake > 0.3 || car.gear < 0 ? 0.35 : 0.12;
      fx.light.r = lit + red; fx.light.g = lit * 0.97; fx.light.b = lit * 1.02;
      fx.smoke.emit(x + (Math.random() - 0.5) * 0.4, 0.25 + Math.random() * 0.2, -(y + (Math.random() - 0.5) * 0.4),
        car.vx * 0.22 + (Math.random() - 0.5) * 1.6, 0.4 + Math.random() * 0.6, -car.vy * 0.22 + (Math.random() - 0.5) * 1.6,
        0.7 + Math.random() * 0.5, (pit ? 4.8 : 3.2) + Math.random() * 1.8, (pit ? 0.15 : 0.2) + Math.random() * 0.08, fx.light);
    }
  }
  // Taillight trails at speed, at night they streak.
  if (car.speed > 22 && model) {
    const s1 = Math.min(1, (car.speed - 22) / 25);
    for (let k = 0; k < 2; k++) {
      const z = (k ? 1 : -1) * (s.width / 2 - 0.2);
      const p = new THREE.Vector3(model.x0 - 0.1, 0.72, z).applyMatrix4(model.root.matrixWorld);
      fx.trails.push(k, p, 0.04, s1);
    }
  } else if (fx.trails.lines[0].hist.length) { fx.trails.push(0, fx.trails.lines[0].hist[0], 0.04, 0); fx.trails.push(1, fx.trails.lines[1].hist[0], 0.04, 0); }
}

// --------------------------------------------------------------- events
let resultsTimer = null;
function handleEvents() {
  const { events, vehicle, impact, props } = drive.drain();
  for (const ev of vehicle) {
    audio.vehicleEvent(ev);
    if (ev.type === 'pop') { fx.flames.fire(ev.size); cam.punch(ev.size * 0.08); }
  }
  if (impact && impact.speed > 1.2) {
    const p = Math.min(1, impact.speed / 14);
    audio.hit(p);
    cam.punch(p * 0.9);
    model.kick(p * 1.5);
    if (impact.speed > 3) fx.sparks.burst(impact.x, 0.4, -impact.y, impact.nx, -impact.ny, drive.car.vx, -drive.car.vy, Math.round(8 + p * 30), 0.5 + p);
  }
  for (const h of props) audio.hit(Math.min(0.6, h.speed / 15), 'cone');
  const t = drive.takeover;
  for (const ev of events) {
    switch (ev.type) {
      case 'bank': ui.banked(ev); audio.chime(Math.log10(Math.max(10, ev.points)) - 2); if (drive.zone === 'pit') { crowd.cheer(0.5); audio.cheer(0.5); }
        if (!drive.takeover && ev.points > drive.drift.best * 0.999 && ev.points >= 1500) submit('street', ev.points);
        break;
      case 'crash': ui.lost(ev); break;
      case 'close': ui.callout('PROXIMITY', 'cool'); break;
      case 'transition': break;
      case 'takeover': ui.callout('TAKEOVER', 'hot', 'donuts · rollbacks · flames'); crowd.cheer(1); audio.cheer(1.2); ui.hint('2:30 before the cops show up. Make it count.', 5); break;
      case 'donut': case 'figure8': case 'rollback': case 'burnout': case 'limiter': case 'crowd':
        ui.callout(ev.text, ev.type === 'rollback' || ev.type === 'figure8' ? 'gold' : 'cool', `+${ev.points.toLocaleString('en-US')}`);
        crowd.cheer(ev.type === 'rollback' ? 1.3 : 0.7, drive.car); audio.cheer(ev.type === 'rollback' ? 1.3 : 0.6);
        break;
      case 'flames': crowd.cheer(0.15, drive.car); audio.cheer(0.12); break;
      case 'end': {
        const tk = drive.lastTakeover || t;
        crowd.scatter(8); audio.siren(8); ui.callout(ev.text, 'hot');
        clearTimeout(resultsTimer);
        resultsTimer = setTimeout(async () => {
          if (!tk) return;
          const c = tk.counts;
          state = 'results';
          ui.results('Takeover', tk.score, [['Donuts', c.donut], ['Figure eights', c.figure8], ['Rollbacks', c.rollback], ['Burnouts', c.burnout], ['Flames', c.flames], ['Crowd close calls', c.close]]);
          const r = await submit('takeover', tk.score);
          if (r?.rank) ui.setRank(r.rank <= 10 ? `#${r.rank} on the board` : '');
        }, 2600);
        break;
      }
      case 'lap': ui.callout(ev.text, 'cool'); break;
      case 'clip': ui.callout(ev.text, ev.text.startsWith('PERFECT') ? 'gold' : 'cool'); break;
      case 'zone': ui.callout(ev.text, 'cool'); break;
      case 'lapdone': {
        const r = ev.result;
        ui.callout(`${r.total}/100`, r.total > 80 ? 'gold' : 'cool', `LINE ${r.line} · ANGLE ${r.angle} · STYLE ${r.style}`);
        submit('track', r.total);
        break;
      }
      default: break;
    }
  }
}

// ------------------------------------------------------------ the loop
let last = performance.now();
let slow = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
}

function tick(dt, render = true) {
  input.enabled = state === 'drive';
  handleKeys();
  const keys = input.poll();

  if (state === 'drive') {
    drive.update(dt, keys);
    handleEvents();
    audio.horn(input.down.has('KeyH'));
  } else if (state === 'menu') {
    // The garage: the car idles on its spot and the camera circles it.
    drive.update(dt, keys);
  }
  const car = drive.car;
  model.update(drive.pose, car, dt, { braking: (drive.controls?.brake || 0) > 0.2 && car.gear >= 0, reversing: car.gear < 0 });
  cam.garage = state === 'menu';
  if (state === 'menu') {
    cam.mode = 'orbit';
  } else if (cam.mode === 'orbit' && settings.camera !== 'orbit') cam.mode = settings.camera;
  cam.lookBack = input.down.has('KeyV');
  cam.update(drive.pose, car, dt);

  if (state === 'drive') emitFx(dt);
  fx.flames.update(dt, model.root);
  fx.update(dt, view.camera);
  city.update(dt);

  // Point lights on the nearest lamps.
  city.nearestLamps(drive.pose.x, drive.pose.y, 3, tmpLamps);
  lampLights.forEach((l, i) => {
    const hit = tmpLamps[i];
    if (!hit) { l.intensity = 0; return; }
    l.position.set(hit.l.x, hit.l.big ? 18 : 7.2, -hit.l.y);
    l.distance = hit.l.big ? 70 : 26;
    l.intensity = hit.l.big ? 70 : 16;
  });

  // Cones.
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  drive.props.list.forEach((p, i) => {
    e.set(p.tilt, p.angle, 0, 'YXZ');
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(p.x, p.tilt > 0.5 ? 0.12 : 0, -p.y), q, new THREE.Vector3(1, 1, 1));
    coneMesh.setMatrixAt(i, m);
  });
  coneMesh.instanceMatrix.needsUpdate = true;

  // The crowd, only when near the Pit.
  const nearPit = Math.hypot(drive.pose.x - world.pit.x, drive.pose.y - world.pit.y) < 260;
  crowd.hype = drive.takeover ? drive.takeover.hype : Math.max(0, crowd.hype - dt * 0.2);
  crowd.update(dt, car, nearPit);

  if (state !== 'menu') {
    audio.update(dt, car, { crowd: nearPit ? 0.25 + (drive.takeover ? drive.takeover.hype * 0.75 : 0) : 0, inside: drive.zone === 'street' });
    ui.hud(drive, car, dt);
    minimap.draw(drive.pose.x, drive.pose.y, drive.pose.heading);
  }

  if (render) view.render();

  // If frames drag at high quality, step down once, quietly.
  if (!render || document.hidden || state !== 'drive') return;
  slow = dt > 1 / 38 ? slow + dt : Math.max(0, slow - dt * 0.5);
  if (slow > 3 && view.quality !== 'low') {
    const next = view.quality === 'high' ? 'medium' : 'low';
    view.setQuality(next);
    settings.quality = next; save();
    ui.hint(`Graphics set to ${next} to keep it smooth`, 3);
    slow = 0;
  }
}

document.getElementById('loading').classList.add('gone');
ui.showMenu(true);
requestAnimationFrame(frame);
addEventListener('visibilitychange', () => { if (document.hidden && state === 'drive') setPause(true); });

// For poking at a running game from the console.
window.sideways = {
  get drive() { return drive; }, get state() { return state; }, get model() { return model; }, view, audio, settings, input, cam, fx, crowd,
  /** Run `seconds` of game at 60 fps right now, holding `keys` (codes), then draw one frame. */
  run(seconds, keys = []) {
    for (const k of keys) input.down.add(k);
    for (let t = 0; t < seconds; t += 1 / 60) tick(1 / 60, false);
    for (const k of keys) input.down.delete(k);
    view.render();
    // Keep redrawing for a moment, so a hidden pane's compositor picks it up.
    let n = 0;
    const id = setInterval(() => { view.render(); if (++n > 30) clearInterval(id); }, 50);
    const c = drive.car;
    return { kmh: +(c.speed * 3.6).toFixed(1), rpm: Math.round(c.rpm), gear: c.gear, beta: +(c.slipAngle * 57.3).toFixed(1), x: +c.x.toFixed(1), y: +c.y.toFixed(1), zone: drive.zone, score: drive.drift.total, pending: Math.round(drive.drift.pending), smoke: 0 };
  },
};
