// 离屏渲染恐龙 / 骑手头像（用于选择界面和 HUD）
import * as THREE from 'three';
import { DINOS, RIDERS } from './data.js';
import { createDinoModel } from './models/dinos.js';
import { createRiderModel } from './models/riders.js';

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

export async function renderThumbnails(onProgress) {
  const out = { dino: {}, rider: {} };
  const size = 256;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return out;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x404050, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(4, 8, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd0ff, 1.6);
  rim.position.set(-6, 4, -6);
  scene.add(rim);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 500);
  const box = new THREE.Box3();
  const c = new THREE.Vector3();
  const s = new THREE.Vector3();
  const idle = { t: 0.3, move: 0, air: false, attack: -1, skill: -1, hurt: 0, dead: 0, bounce: 0, shoot: -1, cheer: false, lean: 0 };

  const shoot = (root, dirX, dirY, dirZ, fill = 1.12) => {
    scene.add(root);
    root.updateMatrixWorld(true);
    box.setFromObject(root);
    box.getCenter(c);
    box.getSize(s);
    const radius = s.length() * 0.5;
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * fill * 0.82;
    const d = new THREE.Vector3(dirX, dirY, dirZ).normalize();
    cam.position.copy(c).addScaledVector(d, dist);
    cam.near = dist / 50; cam.far = dist * 5;
    cam.updateProjectionMatrix();
    cam.lookAt(c);
    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL('image/png');
    scene.remove(root);
    root.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); });
    return url;
  };

  const total = DINOS.length + RIDERS.length;
  let done = 0;
  for (const def of DINOS) {
    try {
      const m = createDinoModel(def);
      m.update(0.016, idle);
      out.dino[def.id] = shoot(m.root, 1, 0.42, 0.9, def.body === 'sauropod' ? 1.0 : 1.08);
    } catch (e) { console.warn('thumb dino failed', def.id, e); }
    onProgress && onProgress(++done / total, def.name);
    await nextFrame();
  }
  for (const def of RIDERS) {
    try {
      const m = createRiderModel(def);
      m.update(0.016, idle);
      out.rider[def.id] = shoot(m.root, 0.7, 0.25, 1, 0.95);
    } catch (e) { console.warn('thumb rider failed', def.id, e); }
    onProgress && onProgress(++done / total, def.name);
    await nextFrame();
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
