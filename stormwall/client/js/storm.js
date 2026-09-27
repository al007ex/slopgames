// The storm on the client: the wall (a huge animated cylinder at the edge of
// the eye), the purple haze and rumble when you are caught in it, and the
// timer. It follows the same plan the server uses, told one phase at a time.

import * as THREE from 'three';
import { stormAt, outsideStorm } from '#shared/storm.js';
import { TICK_HZ } from '#shared/constants.js';

const $ = (id) => document.getElementById(id);

export class StormView {
  constructor(app) {
    this.app = app;
    this.plan = null;
    this.start = 0;
    this.state = null;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float time; varying vec3 vW; varying vec2 vUv;
        void main(){
          float a = vUv.x * 6.2831853 * 60.0;
          float swirl = sin(a + vW.y * 0.05 + time * 1.3) * 0.5 + 0.5;
          float band = sin(vW.y * 0.11 - time * 2.1 + sin(a * 0.3) * 1.5) * 0.5 + 0.5;
          vec3 c = mix(vec3(0.36, 0.13, 0.72), vec3(0.78, 0.52, 1.0), band * 0.6 + swirl * 0.25);
          float fade = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.85, 1.0, vUv.y));
          gl_FragColor = vec4(c, (0.34 + 0.18 * band) * fade);
        }`,
    });
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 160, 1, true), mat);
    this.wall.frustumCulled = false;
    this.wall.renderOrder = 2;
    this.wall.visible = false;
    app.gfx.scene.add(this.wall);
    this.fogColor = new THREE.Color(0x6a3cc8);
  }

  set(msg) {
    this.plan = { circles: msg.circles, phases: msg.phases };
    this.start = msg.start;
  }

  clear() { this.plan = null; this.wall.visible = false; this.state = null; $('storm-timer').hidden = true; }

  now() {
    if (!this.plan) return null;
    return stormAt(this.plan, (this.app.game.renderTick - this.start) / TICK_HZ);
  }

  frame(dt, focus) {
    const s = this.now();
    this.state = s;
    const scene = this.app.gfx.scene;
    if (!s) { this.wall.visible = false; $('storm-timer').hidden = true; return; }
    this.wall.visible = s.r > 0;
    this.wall.scale.set(Math.max(1, s.r), 1400, Math.max(1, s.r));
    this.wall.position.set(s.x, 500, s.z);
    this.wall.material.uniforms.time.value += dt;
    const inside = !outsideStorm(s, focus.x, focus.z);
    $('storm-tint').classList.toggle('on', !inside);
    if (!inside) {
      scene.fog.color.lerp(this.fogColor, 0.08);
      scene.fog.far = Math.min(scene.fog.far, 260);
    }
    this.app.audio.storm?.(!inside);
    // Timer.
    const t = $('storm-timer');
    t.hidden = false;
    const secs = Math.max(0, Math.ceil(s.timeLeft));
    const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    t.querySelector('b').textContent = clock;
    t.querySelector('span').textContent = s.state === 'wait' ? `Storm eye shrinks in` : s.state === 'shrink' ? 'Storm eye shrinking' : 'The storm has closed';
    t.classList.toggle('shrinking', s.state === 'shrink');
    // How far to safety, when outside the next circle.
    const next = s.next;
    const dn = Math.hypot(focus.x - next.x, focus.z - next.z) - next.r;
    $('storm-dist').textContent = dn > 0 ? `${Math.round(dn)} m to the safe zone` : '';
  }
}
