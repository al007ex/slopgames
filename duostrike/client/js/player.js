// Local player movement — kinematic, no physics engine.
//
// Quake-flavoured accel/friction because that is what makes air-strafing and
// slide-jumping feel good. Sprint, slide, crouch, wall jump and coyote/buffer
// windows are each isolated so they can be tuned (or removed) on their own.

// Relative paths (not /shared/...) so this module imports cleanly in both the
// browser and Node — the movement kit is covered by test/movement.test.js.
import {
  MOVE, PLAYER_RADIUS, HEIGHT_STAND, HEIGHT_CROUCH, HEIGHT_SLIDE, ANIM,
} from '../../shared/constants.js';
import { collideMove, hasHeadroom, wallProbe } from '../../shared/collision.js';

const LOOK_SCALE = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.02;

function friction(vel, coeff, dt) {
  const sp = Math.hypot(vel[0], vel[2]);
  if (sp < 0.05) { vel[0] = 0; vel[2] = 0; return; }
  const drop = Math.max(sp, 4) * coeff * dt;
  const scale = Math.max(0, sp - drop) / sp;
  vel[0] *= scale;
  vel[2] *= scale;
}

function accelerate(vel, wish, wishSpeed, accel, dt) {
  const current = vel[0] * wish[0] + vel[2] * wish[2];
  const add = wishSpeed - current;
  if (add <= 0) return;
  const amount = Math.min(accel * dt * wishSpeed, add);
  vel[0] += wish[0] * amount;
  vel[2] += wish[2] * amount;
}

export class LocalPlayer {
  constructor() {
    this.pos = [0, 0, 0];
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;

    this.height = HEIGHT_STAND;
    this.grounded = false;
    this.crouching = false;
    this.sliding = false;
    this.slideTime = 0;
    this.slideCd = 0;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.wallNormal = null;
    this.wallJumps = 0;
    this.wallJumpCd = 0;
    this.bob = 0;
    this.anim = ANIM.IDLE;
    this.events = [];
  }

  reset(pos) {
    this.pos = [pos[0], pos[1], pos[2]];
    this.vel = [0, 0, 0];
    this.sliding = false;
    this.crouching = false;
    this.height = HEIGHT_STAND;
    this.grounded = false;
    this.wallJumps = 0;
  }

  get eyeHeight() { return this.height - 0.2; }
  get speed2D() { return Math.hypot(this.vel[0], this.vel[2]); }

  get forward() {
    return [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)];
  }

  get lookDir() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  get eyePos() {
    return [this.pos[0], this.pos[1] + this.eyeHeight, this.pos[2]];
  }

  look(dx, dy, sens) {
    this.yaw -= dx * LOOK_SCALE * sens;
    this.pitch -= dy * LOOK_SCALE * sens;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
  }

  /**
   * @param opts { frozen, carrying, aiming, canSprint }
   * @returns array of event strings consumed by FX/tutorial reporting
   */
  update(dt, input, world, opts = {}) {
    this.events.length = 0;
    if (!world) return this.events;

    const wasGrounded = this.grounded;
    this.slideCd -= dt;
    this.wallJumpCd -= dt;

    if (opts.frozen) {
      this.vel[0] = 0;
      this.vel[2] = 0;
      this.vel[1] -= MOVE.gravity * dt;
      const r = collideMove(world, this.pos, PLAYER_RADIUS, this.height, [0, this.vel[1] * dt, 0]);
      this.grounded = r.grounded;
      if (r.grounded) this.vel[1] = 0;
      this.anim = ANIM.DOWN;
      return this.events;
    }

    // ---- intent ------------------------------------------------------
    const mx = input.moveX;
    const mz = input.moveZ;
    const fw = this.forward;
    const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    let wish = [fw[0] * mz + right[0] * mx, 0, fw[2] * mz + right[2] * mx];
    const wl = Math.hypot(wish[0], wish[2]);
    if (wl > 0) { wish[0] /= wl; wish[2] /= wl; } else wish = [0, 0, 0];

    this.crouching = input.crouch && !this.sliding;

    const carrying = !!opts.carrying;
    const canSprint = input.sprint && mz > 0 && !this.crouching && !carrying && !opts.aiming;

    // ---- slide -------------------------------------------------------
    if (input.slidePressed && this.grounded && !this.sliding && this.slideCd <= 0 &&
        this.speed2D > 4.5 && !carrying) {
      this.sliding = true;
      this.slideTime = 0;
      const sp = this.speed2D || 1;
      const dirX = this.vel[0] / sp;
      const dirZ = this.vel[2] / sp;
      const boost = Math.max(MOVE.slideImpulse, sp);
      this.vel[0] = dirX * boost;
      this.vel[2] = dirZ * boost;
      this.events.push('slide');
    }
    if (this.sliding) {
      this.slideTime += dt;
      const stop = !input.slideHeld || this.slideTime > MOVE.slideMaxTime ||
        (this.grounded && this.speed2D < MOVE.slideMinSpeed) ||
        (!this.grounded && this.slideTime > 0.45);
      if (stop) {
        this.sliding = false;
        this.slideCd = MOVE.slideCooldown;
      }
    }

    // ---- collider height (never stand up into a ceiling) --------------
    let targetH = HEIGHT_STAND;
    if (this.sliding) targetH = HEIGHT_SLIDE;
    else if (this.crouching) targetH = HEIGHT_CROUCH;
    if (targetH > this.height && !hasHeadroom(world, this.pos, PLAYER_RADIUS, targetH)) {
      targetH = this.height;
    }
    this.height += (targetH - this.height) * Math.min(1, dt * 16);

    // ---- speed target ------------------------------------------------
    let wishSpeed = MOVE.walkSpeed;
    if (this.crouching) wishSpeed = MOVE.crouchSpeed;
    else if (canSprint) wishSpeed = MOVE.sprintSpeed;
    if (carrying) wishSpeed *= 0.72;
    if (opts.aiming && !this.sliding) wishSpeed *= 0.8;

    // ---- accelerate --------------------------------------------------
    if (this.grounded) {
      if (this.sliding) {
        friction(this.vel, MOVE.slideFriction, dt);
        accelerate(this.vel, wish, MOVE.crouchSpeed * 0.6, MOVE.groundAccel * 0.25, dt);
      } else {
        friction(this.vel, MOVE.groundFriction, dt);
        accelerate(this.vel, wish, wishSpeed, MOVE.groundAccel, dt);
      }
    } else {
      friction(this.vel, MOVE.airFriction, dt);
      accelerate(this.vel, wish, MOVE.airSpeed, MOVE.airAccel, dt);
    }

    // ---- jump buffering & coyote time --------------------------------
    if (input.jumpPressed) this.jumpBuf = MOVE.jumpBuffer;
    else this.jumpBuf -= dt;
    if (this.grounded) { this.coyote = MOVE.coyoteTime; this.wallJumps = 0; }
    else this.coyote -= dt;

    if (this.jumpBuf > 0) {
      if (this.grounded || this.coyote > 0) {
        this.vel[1] = MOVE.jumpVel;
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuf = 0;
        if (this.sliding) { this.sliding = false; this.slideCd = MOVE.slideCooldown * 0.5; }
        this.events.push('jump');
      } else if (this.wallNormal && this.wallJumps < MOVE.maxWallJumps && this.wallJumpCd <= 0) {
        const n = this.wallNormal;
        this.vel[1] = MOVE.wallJumpUp;
        this.vel[0] = this.vel[0] * 0.35 + n[0] * MOVE.wallJumpOut;
        this.vel[2] = this.vel[2] * 0.35 + n[2] * MOVE.wallJumpOut;
        this.wallJumps++;
        this.wallJumpCd = MOVE.wallJumpCooldown;
        this.jumpBuf = 0;
        this.events.push('walljump');
      }
    }

    // ---- gravity (softened while hugging a wall) ---------------------
    const hugging = !this.grounded && this.wallNormal && this.vel[1] < 0 &&
      (wish[0] * -this.wallNormal[0] + wish[2] * -this.wallNormal[2]) > 0.25;
    this.vel[1] -= (hugging ? MOVE.wallSlideGravity : MOVE.gravity) * dt;
    if (this.vel[1] < -55) this.vel[1] = -55;

    // ---- integrate & collide -----------------------------------------
    const before = [this.pos[0], this.pos[1], this.pos[2]];
    const disp = [this.vel[0] * dt, this.vel[1] * dt, this.vel[2] * dt];
    const res = collideMove(world, this.pos, PLAYER_RADIUS, this.height, disp);

    // kill velocity on any axis we did not actually travel along
    if (Math.abs((this.pos[0] - before[0]) - disp[0]) > 1e-3) this.vel[0] = 0;
    if (Math.abs((this.pos[2] - before[2]) - disp[2]) > 1e-3) this.vel[2] = 0;
    this.grounded = res.grounded;
    if (res.grounded && this.vel[1] < 0) this.vel[1] = 0;
    if (res.ceiling && this.vel[1] > 0) this.vel[1] = 0;

    if (this.grounded && !wasGrounded) this.events.push('land');

    this.wallNormal = this.grounded
      ? null
      : wallProbe(world, this.pos, PLAYER_RADIUS + 0.18, this.height);

    // ---- presentation -------------------------------------------------
    const targetRoll = (this.sliding ? 0.07 : 0) - mx * 0.018;
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 9);
    if (this.grounded && !this.sliding) this.bob += this.speed2D * dt * 1.5;

    if (this.sliding) this.anim = ANIM.SLIDE;
    else if (!this.grounded) this.anim = ANIM.JUMP;
    else if (this.crouching) this.anim = ANIM.CROUCH;
    else if (this.speed2D > 0.6) this.anim = ANIM.RUN;
    else this.anim = ANIM.IDLE;

    return this.events;
  }
}
