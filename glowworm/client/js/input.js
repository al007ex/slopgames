// Steering and boosting from whatever the player has.
//
//  - Mouse: the snake heads for the cursor; hold a button to boost.
//  - Keyboard: ←/→ or A/D turn, Space/↑/W boosts.
//  - Touch: a floating joystick wherever the thumb lands, plus a boost button.
//    A second finger anywhere on the board also boosts, for two-thumb players.
//
// The joystick is "floating" because a fixed one is always in the wrong place
// on some phone, and it drags along behind the thumb so it never runs out of
// travel in the middle of a turn.

const STICK_RADIUS = 56;
const STICK_DEADZONE = 10;
const KEY_TURN_RATE = 3.4;   // radians per second

export class Input {
  constructor(canvas, { boostButton, stick, knob }) {
    this.canvas = canvas;
    this.stick = stick;
    this.knob = knob;
    this.mode = 'mouse';
    this.mouse = null;
    this.mouseBoost = false;
    this.keyBoost = false;
    this.buttonBoost = false;
    this.touchBoost = false;
    this.left = false;
    this.right = false;
    this.keyAngle = null;
    this.stickId = null;
    this.stickOrigin = null;
    this.stickAngle = null;
    this.extraTouches = new Set();
    // Until the player moves after joining, the snake keeps its spawn heading
    // (which points inwards). Otherwise wherever the cursor happened to be when
    // Play was pressed becomes an instant, often fatal, heading.
    this.armed = false;

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const press = (on) => (e) => {
      e.preventDefault();
      this.buttonBoost = on;
      boostButton.classList.toggle('held', on);
      if (on) boostButton.setPointerCapture?.(e.pointerId);
    };
    boostButton.addEventListener('pointerdown', press(true));
    boostButton.addEventListener('pointerup', press(false));
    boostButton.addEventListener('pointercancel', press(false));
    boostButton.addEventListener('lostpointercapture', () => { this.buttonBoost = false; boostButton.classList.remove('held'); });
    boostButton.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    // Alt-tabbing away mid-boost must not leave the boost stuck on.
    window.addEventListener('blur', () => this.release());
  }

  get boost() {
    return this.mouseBoost || this.keyBoost || this.buttonBoost || this.touchBoost;
  }

  release() {
    this.mouseBoost = this.keyBoost = this.buttonBoost = this.touchBoost = false;
    this.left = this.right = false;
    this.extraTouches.clear();
    this.endStick();
  }

  /** Forget the pre-join cursor position and wait for a fresh intent. */
  disarm() {
    this.armed = false;
    this.stickAngle = null;
    this.keyAngle = null;
  }

  down(e) {
    e.preventDefault();
    this.armed = true;
    if (e.pointerType === 'mouse') {
      this.mode = 'mouse';
      this.mouse = { x: e.clientX, y: e.clientY };
      if (e.button === 0 || e.button === 2) this.mouseBoost = true;
      return;
    }
    this.canvas.setPointerCapture?.(e.pointerId);
    // A touchscreen laptop reports a mouse as its main pointer, so the touch
    // layout (and its boost button) switches on at the first real touch.
    this.canvas.ownerDocument?.body.classList.add('touch');
    if (this.stickId === null) {
      this.mode = 'touch';
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stick.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.knob.style.transform = 'translate(0px, 0px)';
      this.stick.hidden = false;
    } else {
      this.extraTouches.add(e.pointerId);
      this.touchBoost = true;
    }
  }

  move(e) {
    if (e.pointerType === 'mouse') {
      if (this.mouse && Math.hypot(e.clientX - this.mouse.x, e.clientY - this.mouse.y) > 2) this.armed = true;
      this.mouse = { x: e.clientX, y: e.clientY };
      if (!this.left && !this.right) this.mode = 'mouse';
      return;
    }
    if (e.pointerId !== this.stickId) return;
    e.preventDefault();
    let dx = e.clientX - this.stickOrigin.x;
    let dy = e.clientY - this.stickOrigin.y;
    const distance = Math.hypot(dx, dy);
    if (distance > STICK_DEADZONE) this.stickAngle = Math.atan2(dy, dx);
    if (distance > STICK_RADIUS) {
      // Drag the base along so the knob always has room to move.
      const pull = (distance - STICK_RADIUS) / distance;
      this.stickOrigin.x += dx * pull;
      this.stickOrigin.y += dy * pull;
      this.stick.style.transform = `translate(${this.stickOrigin.x}px, ${this.stickOrigin.y}px)`;
      dx -= dx * pull;
      dy -= dy * pull;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  up(e) {
    if (e.pointerType === 'mouse') {
      if (e.button === 0 || e.button === 2) this.mouseBoost = false;
      return;
    }
    if (e.pointerId === this.stickId) this.endStick();
    if (this.extraTouches.delete(e.pointerId) && !this.extraTouches.size) this.touchBoost = false;
  }

  endStick() {
    // The snake keeps its last heading when the thumb lifts, like slither.io.
    this.stickId = null;
    this.stick.hidden = true;
  }

  key(e, down) {
    if (e.target instanceof HTMLInputElement) return;
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA':
        this.left = down;
        break;
      case 'ArrowRight': case 'KeyD':
        this.right = down;
        break;
      case 'Space': case 'ArrowUp': case 'KeyW':
        this.keyBoost = down;
        e.preventDefault();
        return;
      default:
        return;
    }
    e.preventDefault();
    if (down) this.armed = true;
    if (down && this.mode !== 'keys') { this.mode = 'keys'; this.keyAngle = null; }
  }

  /** Where the player wants to go, or null for "keep going". */
  angle(head, current, dt) {
    if (!this.armed) return null;
    if (this.mode === 'mouse' && this.mouse) {
      const dx = this.mouse.x - head.x;
      const dy = this.mouse.y - head.y;
      return Math.hypot(dx, dy) > 4 ? Math.atan2(dy, dx) : null;
    }
    if (this.mode === 'touch') return this.stickAngle;
    if (this.mode === 'keys') {
      if (this.keyAngle === null) this.keyAngle = current;
      this.keyAngle += ((this.right ? 1 : 0) - (this.left ? 1 : 0)) * KEY_TURN_RATE * dt;
      return this.keyAngle;
    }
    return null;
  }
}
