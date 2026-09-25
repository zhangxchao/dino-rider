import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function turnToward(cur, target, maxStep) {
  const d = angleDiff(cur, target);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const WHITE = new THREE.Color(1, 1, 1);

/**
 * 为模型开启阴影，并收集材质用于受击闪白。
 * 返回 { setFlash(amount 0..1, color?) }
 */
export function prepareModel(root, { cast = true, receive = false } = {}) {
  const mats = [];
  const seen = new Set();
  root.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) {
        if (!m || seen.has(m) || !m.emissive) continue;
        seen.add(m);
        mats.push({ m, e: m.emissive.clone(), i: m.emissiveIntensity ?? 1 });
      }
    }
  });
  let last = 0;
  return {
    mats,
    setFlash(a, color = WHITE) {
      if (a <= 0.001 && last <= 0.001) return;
      last = a;
      for (const r of mats) {
        if (a <= 0.001) { r.m.emissive.copy(r.e); r.m.emissiveIntensity = r.i; }
        else {
          r.m.emissive.copy(r.e).lerp(color, a);
          r.m.emissiveIntensity = Math.max(r.i, a * 1.2);
        }
      }
    },
  };
}

/** 释放一个对象树中的几何体与材质（共享几何体由各模块自行缓存，这里只释放材质） */
export function disposeTree(root, { geometry = false } = {}) {
  root.traverse((o) => {
    if (o.material) {
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) {
        if (m.map) m.map.dispose?.();
        m.dispose?.();
      }
    }
    if (geometry && o.geometry) o.geometry.dispose();
  });
}

export function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------
//  性能优化：合并模型中不会动的零件
//  先用多种动画状态跑一遍 animate()，找出变换/可见性从未改变的叶子网格，
//  再把"同一父节点 + 同一材质"的静态零件合并成一个网格，大幅减少 draw call。
//  cacheKey 相同的模型（同一种怪物）复用合并后的几何体。
// ---------------------------------------------------------------------
const _mergeCache = new Map();
const MERGE_CACHE_MAX = 1200;
const _c = new THREE.Color();

function prepGeo(mesh, withColor, bakeColor) {
  let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && !(withColor && name === 'color')) g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  g.morphAttributes = {};
  g.applyMatrix4(mesh.matrix);
  if (bakeColor) {
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = bakeColor.r; arr[i * 3 + 1] = bakeColor.g; arr[i * 3 + 2] = bakeColor.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return g;
}

// 只有颜色不同、没有自发光/透明/贴图的标准材质可以合并成"顶点色"网格
function colorMergeable(m) {
  return m.isMeshStandardMaterial && !m.transparent && m.opacity >= 1 && !m.map && !m.vertexColors && !m.alphaTest
    && (!m.emissive || m.emissive.r + m.emissive.g + m.emissive.b < 0.002 || m.emissiveIntensity === 0);
}
const matState = (m) => [m.color ? m.color.getHex() : 0, m.emissive ? m.emissive.getHex() : 0, m.emissiveIntensity, m.opacity, m.visible].join(',');

export function mergeStaticMeshes(root, animate, cacheKey = null) {
  const leaves = [];
  root.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.children.length === 0 && o.material && !Array.isArray(o.material)
      && o.geometry && !(o.geometry.morphAttributes && o.geometry.morphAttributes.position)) leaves.push(o);
  });
  const snap = leaves.map((m) => ({ p: m.position.clone(), q: m.quaternion.clone(), s: m.scale.clone(), v: m.visible, g: m.geometry, mat: m.material }));
  const mats = new Map();
  for (const m of leaves) if (!mats.has(m.material)) mats.set(m.material, matState(m.material));
  try { animate(); } catch { return { removed: 0, added: 0 }; }
  const animatedMat = new Set();
  for (const [m, st] of mats) if (matState(m) !== st) animatedMat.add(m);

  const groups = new Map();
  leaves.forEach((m, i) => {
    const a = snap[i];
    const still = m.visible && a.v && m.geometry === a.g && m.material === a.mat
      && m.position.distanceToSquared(a.p) < 1e-10 && Math.abs(m.quaternion.dot(a.q)) > 1 - 1e-9 && m.scale.distanceToSquared(a.s) < 1e-10;
    const mat = m.material;
    if (!still || mat.map || mat.isShaderMaterial) return;
    const cm = colorMergeable(mat) && !animatedMat.has(mat);
    const key = m.parent.uuid + (cm ? `|cm|${mat.side}|${mat.flatShading ? 1 : 0}|${m.castShadow ? 1 : 0}` : '|' + mat.uuid);
    if (!groups.has(key)) groups.set(key, { cm, list: [] });
    groups.get(key).list.push(m);
  });

  let removed = 0, added = 0, gi = 0;
  let cmMat = null;
  for (const { cm, list } of groups.values()) {
    if (list.length < 2) continue;
    const parent = list[0].parent;
    const mat0 = list[0].material;
    const withColor = !cm && !!mat0.vertexColors && list.every((m) => m.geometry.attributes.color);
    for (const m of list) m.updateMatrix();
    let sig = null;
    if (cacheKey) {
      sig = cacheKey + '#' + (gi++) + (cm ? 'c' : 'm') + ':' + list.map((m) => m.geometry.uuid + '@' + (cm ? m.material.color.getHexString() : '')
        + m.matrix.elements.map((e) => e.toFixed(3)).join(',')).join(';');
    }
    let geo = sig ? _mergeCache.get(sig) : null;
    let shared = !!geo;
    if (!geo) {
      const geos = list.map((m) => prepGeo(m, withColor, cm ? _c.copy(m.material.color) : null));
      geo = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!geo) continue;
      geo.computeBoundingSphere();
      if (sig && _mergeCache.size < MERGE_CACHE_MAX) { _mergeCache.set(sig, geo); shared = true; }
    }
    let mat = mat0;
    if (cm) {
      // 每个模型实例一份顶点色材质（受击闪白按实例生效）
      if (!cmMat || cmMat.side !== mat0.side || cmMat.flatShading !== mat0.flatShading) {
        let r = 0, me = 0;
        for (const m of list) { r += m.material.roughness; me += m.material.metalness; }
        cmMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: mat0.flatShading, side: mat0.side, roughness: r / list.length, metalness: me / list.length });
      }
      mat = cmMat;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = list[0].castShadow;
    mesh.receiveShadow = list[0].receiveShadow;
    mesh.renderOrder = list[0].renderOrder;
    mesh.userData.mergedGeo = !shared;
    parent.add(mesh);
    for (const m of list) parent.remove(m);
    removed += list.length;
    added++;
  }
  return { removed, added };
}

/** 统计网格数量（调试用） */
export function countMeshes(root) {
  let n = 0;
  root.traverse((o) => { if (o.isMesh) n++; });
  return n;
}
