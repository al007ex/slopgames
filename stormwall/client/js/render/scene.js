// Renderer, camera, sky, sun, sea and fog. The fog distance opens up when the
// camera is high (the blimp, a long glide) so the whole island is visible
// from the air, and closes in on the ground where it hides terrain LOD changes.

import * as THREE from 'three';

export const SKY_TOP = new THREE.Color(0x3d7fd6);
export const SKY_HORIZON = new THREE.Color(0xbfdcf2);

export function createScene(canvas, { quality = 'high' } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = SKY_HORIZON.clone();
  scene.fog = new THREE.Fog(SKY_HORIZON.clone(), 300, 1700);

  const camera = new THREE.PerspectiveCamera(78, 1, 0.1, 9000);
  camera.rotation.order = 'YXZ';

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5c6b3a, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.9);
  sun.position.set(0.45, 1, 0.3).multiplyScalar(200);
  sun.castShadow = quality !== 'low';
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 500;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);
  const sunOffset = new THREE.Vector3(0.45, 1, 0.3).normalize().multiplyScalar(260);

  // Sky dome: a gradient that ignores fog, drawn behind everything.
  const skyGeo = new THREE.SphereGeometry(8000, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vDir; void main(){ float t = clamp(vDir.y * 2.2, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, t), 1.0); }',
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(40000, 40000),
    new THREE.MeshStandardMaterial({ color: 0x2b6ea3, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.86 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(2560, 0, 2560);
  sea.receiveShadow = true;
  scene.add(sea);

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  /** Keeps the sun's shadow box around the camera and the fog matched to altitude. */
  function follow(focus, altitude) {
    const snap = 4;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    sun.target.position.set(fx, focus.y, fz);
    sun.position.set(fx + sunOffset.x, focus.y + sunOffset.y, fz + sunOffset.z);
    sky.position.copy(camera.position);
    const high = Math.max(0, Math.min(1, (altitude - 60) / 500));
    scene.fog.near = 280 + high * 900;
    scene.fog.far = 1700 + high * 5000;
  }

  return { renderer, scene, camera, sun, sea, sky, resize, follow };
}
