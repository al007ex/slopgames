// The renderer: a night sky, fog, the reflections the cars pick up, and a
// bloom pass so every light glows. Quality trades resolution and bloom for
// frame rate; the frame rate is what makes a drift feel smooth.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const PALETTE = {
  zenith: new THREE.Color('#04050b'),
  horizon: new THREE.Color('#1a1430'),
  glow: new THREE.Color('#5a2a3a'),
  fog: new THREE.Color('#0d0b18'),
};

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setClearColor(PALETTE.fog);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(PALETTE.fog, 0.0021);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2600);
    this.camera.position.set(0, 3, 8);

    // Moonlight and the orange-purple city glow from below the clouds.
    this.hemi = new THREE.HemisphereLight('#4a4f80', '#1a1310', 0.55);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight('#8fa4ff', 0.35);
    this.moon.position.set(-300, 500, 200);
    this.scene.add(this.moon);

    this.scene.add(this.makeSky());
    this.scene.environment = this.makeEnvironment();

    this.quality = 'high';
    this.composer = null;
    this.bloom = null;
    this.setQuality('high');
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** A gradient dome with a haze of city light at the horizon, and stars. */
  makeSky() {
    const group = new THREE.Group();
    const geo = new THREE.SphereGeometry(2400, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { zenith: { value: PALETTE.zenith }, horizon: { value: PALETTE.horizon }, glow: { value: PALETTE.glow } },
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 zenith; uniform vec3 horizon; uniform vec3 glow; varying vec3 vDir;
        void main() {
          float h = max(vDir.y, 0.0);
          vec3 c = mix(horizon, zenith, pow(h, 0.45));
          c += glow * pow(1.0 - h, 10.0) * 0.8;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -10;
    group.add(sky);
    const n = 900, pos = new Float32Array(n * 3);
    let s = 7;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < n; i++) {
      const th = r() * Math.PI * 2, y = 0.15 + r() * 0.85;
      const rad = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * rad * 2300, y * 2300, Math.sin(th) * rad * 2300], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#c9d2ff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false }));
    group.add(stars);
    this.skyGroup = group;
    return group;
  }

  /** What the paint and glass reflect: a dark city with strips of light. */
  makeEnvironment() {
    const env = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: '#0a0b14', side: THREE.BackSide }));
    env.add(box);
    const strip = (color, x, y, z, w, h, ry = 0, intensity = 1) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.rotation.y = ry;
      env.add(m);
    };
    // Overhead lamps, a warm street glow, neon, and the sky.
    strip('#ffffff', 0, 4.9, 0, 6, 1.2, 0, 1); env.children.at(-1).rotation.x = Math.PI / 2;
    strip('#ffb26b', -4.9, 1.2, 0, 10, 1.4, Math.PI / 2, 1.6);
    strip('#ffb26b', 4.9, 1.2, 0, 10, 1.4, Math.PI / 2, 1.6);
    strip('#ff3d5a', 0, 2.5, -4.9, 3, 0.5, 0, 2.2);
    strip('#3de0ff', 2, 3.2, 4.9, 3, 0.4, 0, 2.2);
    strip('#2a2550', 0, 3.2, 4.95, 10, 3, 0, 1);
    strip('#2a2550', 0, 3.2, -4.95, 10, 3, 0, 1);
    const pm = new THREE.PMREMGenerator(this.renderer);
    const tex = pm.fromScene(env, 0.02).texture;
    pm.dispose();
    return tex;
  }

  setQuality(q) {
    this.quality = q;
    const dpr = Math.min(devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
    this.renderer.setPixelRatio(dpr);
    if (this.composer) this.composer.dispose();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q === 'low' ? 0 : 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (q !== 'low') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.85, 0.55, 0.72);
      this.composer.addPass(this.bloom);
    } else this.bloom = null;
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
  }

  render() {
    this.skyGroup.position.copy(this.camera.position);
    this.composer.render();
  }
}
