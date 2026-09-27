// Input tests: mouse, keyboard, the floating touch joystick and the boost
// button. Input only needs addEventListener and a few style properties, so a
// handful of EventTargets stand in for the DOM.

import { ok, eq, near, section, report } from './harness.js';

globalThis.window = new EventTarget();
globalThis.HTMLInputElement = class HTMLInputElement {};
const { Input } = await import('../client/js/input.js');

const element = () => Object.assign(new EventTarget(), {
  style: {},
  hidden: true,
  classList: { set: new Set(), toggle(name, on) { if (on) this.set.add(name); else this.set.delete(name); }, remove(name) { this.set.delete(name); } },
  setPointerCapture() {},
});
const fire = (target, type, props = {}) => {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0, ...props });
  target.dispatchEvent(event);
  return event;
};
const key = (type, code, target = null) => {
  const event = new Event(type, { cancelable: true });
  event.code = code;
  // Dispatch sets `target` to window; pretend it came from a text field when asked.
  if (target) Object.defineProperty(event, 'target', { value: target });
  window.dispatchEvent(event);
  return event;
};
const translate = (style) => (style.transform || '').match(/-?[\d.]+/g)?.map(Number) ?? [0, 0];

function rig() {
  const canvas = element();
  const boostButton = element();
  const stick = element();
  const knob = element();
  const input = new Input(canvas, { boostButton, stick, knob });
  return { input, canvas, boostButton, stick, knob };
}

const head = { x: 200, y: 400 };

section('Nothing happens until the player moves');
{
  const { input, canvas } = rig();
  eq(input.angle(head, 1.2, 1 / 60), null, 'before any input the snake keeps its heading');
  fire(canvas, 'pointermove', { clientX: 300, clientY: 400 });
  eq(input.angle(head, 1.2, 1 / 60), null, 'the first cursor report only records where the pointer is');
  fire(canvas, 'pointermove', { clientX: 300, clientY: 500 });
  ok(input.angle(head, 1.2, 1 / 60) !== null, 'moving it takes control');
  input.disarm();
  eq(input.angle(head, 1.2, 1 / 60), null, 'joining again hands the heading back to the spawn');
}

section('Mouse');
{
  const { input, canvas } = rig();
  fire(canvas, 'pointermove', { clientX: 0, clientY: 0 });
  fire(canvas, 'pointermove', { clientX: 300, clientY: 500 });
  near(input.angle(head, 0, 1 / 60), Math.atan2(100, 100), 1e-9, 'the snake heads for the cursor');
  const down = fire(canvas, 'pointerdown', { clientX: 300, clientY: 500 });
  ok(input.boost, 'holding the button boosts');
  ok(down.defaultPrevented, 'and does not start a text selection or a drag');
  fire(canvas, 'pointerup', { clientX: 300, clientY: 500 });
  ok(!input.boost, 'letting go stops');
}

section('Touch joystick');
{
  const { input, canvas, stick, knob } = rig();
  fire(canvas, 'pointerdown', { pointerType: 'touch', pointerId: 7, clientX: 100, clientY: 600 });
  ok(!stick.hidden, 'a thumb anywhere on the board brings up the joystick');
  eq(translate(stick.style).join(','), '100,600', 'centred where the thumb landed');
  eq(input.angle(head, 0.5, 1 / 60), null, 'a tap without a drag does not steer');

  fire(canvas, 'pointermove', { pointerType: 'touch', pointerId: 7, clientX: 130, clientY: 570 });
  near(input.angle(head, 0.5, 1 / 60), Math.atan2(-30, 30), 1e-9, 'dragging steers in the drag direction');
  eq(translate(knob.style).join(','), '30,-30', 'the knob follows the thumb');

  fire(canvas, 'pointermove', { pointerType: 'touch', pointerId: 7, clientX: 400, clientY: 600 });
  const [kx, ky] = translate(knob.style);
  ok(Math.hypot(kx, ky) <= 56 + 1e-6, 'the knob never leaves the ring');
  ok(translate(stick.style)[0] > 100, 'the ring is dragged along behind a long swipe');
  near(input.angle(head, 0.5, 1 / 60), Math.atan2(0, 270), 0.12, 'and still steers the right way');

  fire(canvas, 'pointerup', { pointerType: 'touch', pointerId: 7 });
  ok(stick.hidden, 'lifting the thumb hides the joystick');
  ok(input.angle(head, 0.5, 1 / 60) !== null, 'but the snake keeps going the way it was pointed');
}

section('Boosting on touch');
{
  const { input, canvas, boostButton, stick } = rig();
  fire(canvas, 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 600 });
  fire(canvas, 'pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 300, clientY: 300 });
  ok(input.boost, 'a second finger on the board boosts');
  eq(translate(stick.style).join(','), '100,600', 'without moving the joystick to the second finger');
  fire(canvas, 'pointerup', { pointerType: 'touch', pointerId: 2 });
  ok(!input.boost, 'lifting it stops');
  ok(!stick.hidden, 'while the first finger keeps steering');

  const press = fire(boostButton, 'pointerdown', { pointerType: 'touch', pointerId: 3 });
  ok(input.boost, 'the ⚡ button boosts while held');
  ok(press.defaultPrevented, 'without the browser treating it as a tap or a long-press');
  ok(boostButton.classList.set.has('held'), 'and shows it is held');
  fire(boostButton, 'pointerup', { pointerType: 'touch', pointerId: 3 });
  ok(!input.boost && !boostButton.classList.set.has('held'), 'releasing it stops');
  fire(boostButton, 'pointerdown', { pointerType: 'touch', pointerId: 4 });
  fire(boostButton, 'lostpointercapture', { pointerId: 4 });
  ok(!input.boost, 'a thumb that slides off the button does not leave boost stuck on');
}

section('Keyboard');
{
  const { input } = rig();
  key('keydown', 'ArrowLeft');
  const start = input.angle(head, 1, 0);
  for (let i = 0; i < 30; i++) input.angle(head, 1, 1 / 60);
  ok(input.angle(head, 1, 0) < start - 1.5, 'holding left turns the snake left', `${start} -> ${input.angle(head, 1, 0)}`);
  key('keyup', 'ArrowLeft');
  const held = input.angle(head, 1, 1 / 60);
  near(input.angle(head, 1, 1 / 60), held, 1e-9, 'letting go stops turning');
  const space = key('keydown', 'Space');
  ok(input.boost, 'space boosts');
  ok(space.defaultPrevented, 'without scrolling the page');
  key('keyup', 'Space');
  ok(!input.boost, 'and stops');
  key('keydown', 'KeyW', new HTMLInputElement());
  ok(!input.boost, 'typing a name does not boost');
}

section('Losing focus');
{
  const { input, canvas } = rig();
  fire(canvas, 'pointerdown', { clientX: 1, clientY: 1 });
  key('keydown', 'Space');
  window.dispatchEvent(new Event('blur'));
  ok(!input.boost, 'switching away releases every boost');
}

report();
