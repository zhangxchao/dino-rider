import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** 只把前 n 个元素标记为需要上传到 GPU（默认会整块上传整个缓冲，哪怕只用了几个）；n 为 0 时什么也不传 */
export function uploadRange(attr, n) {
  if (!attr) return;
  attr.clearUpdateRanges();
  if (n <= 0) return;
  attr.addUpdateRange(0, n * attr.itemSize);
  attr.needsUpdate = true;
}

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
    if ((o.isMesh || o.isSkinnedMesh) && !o.userData.rigidBone) {
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

function prepGeo(mesh, withColor, bakeColor, applyMatrix = true) {
  let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && !(withColor && name === 'color')) g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  g.morphAttributes = {};
  if (applyMatrix) g.applyMatrix4(mesh.matrix);
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

// ---------------------------------------------------------------------
//  性能优化：刚体蒙皮
//  合并静态零件后，会动的零件（腿、头、尾巴…）仍然各占一次绘制。这里把它们也合成
//  少数几个 SkinnedMesh：每个零件的顶点绑定到零件自己（原网格隐藏后留作“骨骼”，
//  动画代码照常改它们的变换），同一只怪物的所有零件按材质合并，每类材质只画一次。
//  原零件退出所有渲染层（不再绘制，但 visible 仍由动画控制）；某个零件或它所在的分组
//  被动画隐藏时，每帧把对应骨骼压成一个点，所以沙虫钻地、武器显隐等照常生效。
//  steps：动画采样函数列表；在采样中会换几何体 / 换材质的零件保持原样。
// ---------------------------------------------------------------------
const _skinCache = new Map();
const SKIN_CACHE_MAX = 600;
const IDENTITY = new THREE.Matrix4();

function shownIn(o, root) {
  for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false;
  return true;
}

// ---------------------------------------------------------------------
//  骨骼图集：不投影的刚体蒙皮网格（怪物、恐龙宝宝）共用一张骨骼贴图，每帧只上传一次，
//  省掉每只怪物单独上传骨骼贴图的十几次 WebGL 调用。着色器按材质的 boneOffset 取自己那一段。
//  （投影的玩家 / 首领仍用各自的贴图：阴影用的是内置深度材质，没法按物体传偏移）
// ---------------------------------------------------------------------
if (!THREE.ShaderChunk.skinning_pars_vertex.includes('boneOffset')) { // 开发时模块热更新会重复执行
  THREE.ShaderChunk.skinning_pars_vertex = THREE.ShaderChunk.skinning_pars_vertex
    .replace('uniform highp sampler2D boneTexture;', 'uniform highp sampler2D boneTexture;\n\tuniform float boneOffset;')
    .replace('int j = int( i ) * 4;', 'int j = ( int( i ) + int( boneOffset ) ) * 4;');
}

const ATLAS_W = 128, ATLAS_H = 64;          // 每根骨骼 4 个像素：共 2048 根
const atlas = { data: new Float32Array(ATLAS_W * ATLAS_H * 4), tex: null, free: [[0, (ATLAS_W * ATLAS_H) / 4]] };

function atlasAlloc(n) {
  for (let i = 0; i < atlas.free.length; i++) {
    const f = atlas.free[i];
    if (f[1] < n) continue;
    const start = f[0];
    f[0] += n; f[1] -= n;
    if (!f[1]) atlas.free.splice(i, 1);
    return start;
  }
  return -1;
}
function atlasRelease(start, n) {
  atlas.free.push([start, n]);
  atlas.free.sort((a, b) => a[0] - b[0]);
  for (let i = atlas.free.length - 2; i >= 0; i--) {
    const a = atlas.free[i], b = atlas.free[i + 1];
    if (a[0] + a[1] === b[0]) { a[1] += b[1]; atlas.free.splice(i + 1, 1); }
  }
}
/** 把骨架的矩阵放进图集；图集满了返回 null（退回独立骨骼贴图） */
function useAtlas(skeleton) {
  const n = skeleton.bones.length;
  const start = atlasAlloc(n);
  if (start < 0) return null;
  if (!atlas.tex) atlas.tex = new THREE.DataTexture(atlas.data, ATLAS_W, ATLAS_H, THREE.RGBAFormat, THREE.FloatType);
  skeleton.boneMatrices = atlas.data.subarray(start * 16, (start + n) * 16);
  skeleton.boneTexture = atlas.tex;
  let released = false;
  // 释放时只归还图集里的这一段（共享贴图不能销毁）
  skeleton.dispose = () => { if (released) return; released = true; skeleton.boneMatrices.fill(0); atlasRelease(start, n); };
  return { value: start };
}
function atlasOnBeforeCompile(shader, renderer) {
  THREE.Material.prototype.onBeforeCompile.call(this, shader, renderer);
  shader.uniforms.boneOffset = this.userData.boneOffset;
}

function hideHiddenBones(skeleton, root) {
  const update = skeleton.update.bind(skeleton);
  skeleton.update = () => {
    update();
    const bones = skeleton.bones, arr = skeleton.boneMatrices;
    for (let i = 0; i < bones.length; i++) if (!shownIn(bones[i], root)) arr.fill(0, i * 16, i * 16 + 16);
  };
}

export function rigidSkin(root, steps, cacheKey = null, { atlas: toAtlas = false } = {}) {
  const leaves = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.children.length === 0 && o.material && !Array.isArray(o.material)
      && !o.material.isShaderMaterial && !o.material.map && o.geometry && o.geometry.attributes.position
      && !(o.geometry.morphAttributes && o.geometry.morphAttributes.position)
      // 镜像零件（负缩放）单独绘制时 three.js 会翻转正反面，合并后做不到，单面材质的保持原样
      && !(o.material.side !== THREE.DoubleSide && o.matrixWorld.determinant() < 0)) leaves.push(o);
  });
  const snap = leaves.map((m) => ({ g: m.geometry, mat: m.material }));
  const mats = new Map();
  for (const m of leaves) if (!mats.has(m.material)) mats.set(m.material, matState(m.material));
  const unstable = new Set();
  try {
    for (const step of steps) {
      step();
      leaves.forEach((m, i) => {
        const s = snap[i];
        if (m.geometry !== s.g || m.material !== s.mat) unstable.add(m);
      });
    }
  } catch { return { removed: 0, added: 0 }; }
  const animatedMat = new Set();
  for (const [m, st] of mats) if (matState(m) !== st) animatedMat.add(m);

  const groups = new Map();
  leaves.forEach((m, i) => {
    if (unstable.has(m)) return;
    const mat = m.material;
    const cm = colorMergeable(mat) && !animatedMat.has(mat);
    if (!cm && mat.vertexColors && !m.geometry.attributes.color) return;
    const key = (cm ? `cm|${mat.side}|${mat.flatShading ? 1 : 0}` : 'm|' + mat.uuid) + `|${m.castShadow ? 1 : 0}|${m.receiveShadow ? 1 : 0}|${m.renderOrder}`;
    if (!groups.has(key)) groups.set(key, { cm, list: [] });
    groups.get(key).list.push(m);
  });
  // 同一个材质如果还被其它照常绘制的零件用着，就不合并（同一材质混用蒙皮 / 非蒙皮会让着色器来回切换）
  const merged = new Set();
  for (const gr of groups.values()) if (gr.list.length >= 2) for (const m of gr.list) merged.add(m);
  const stillDrawn = new Set();
  root.traverse((o) => { if (o.isMesh && !merged.has(o) && o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) stillDrawn.add(m); });
  const used = [...groups.values()].filter((gr) => gr.list.length >= 2 && (gr.cm || !stillDrawn.has(gr.list[0].material)));
  if (!used.length) return { removed: 0, added: 0 };

  // 所有参与合并的零件共用一副骨架（每帧只更新一次骨骼贴图）
  const bones = [];
  const boneIdx = new Map();
  for (const gr of used) for (const m of gr.list) { boneIdx.set(m, bones.length); bones.push(m); }
  const skeleton = new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4()));
  const boneOffset = toAtlas ? useAtlas(skeleton) : null;
  hideHiddenBones(skeleton, root);

  let removed = 0, added = 0, gi = 0;
  const cmMats = new Map();
  for (const { cm, list } of used) {
    const mat0 = list[0].material;
    const withColor = !cm && !!mat0.vertexColors;
    const sig = cacheKey ? cacheKey + '#' + (gi++) + (cm ? 'c' : 'm') + ':' + list.map((m) => m.geometry.uuid + '@' + (cm ? m.material.color.getHexString() : '') + '>' + boneIdx.get(m)).join(';') : null;
    let geo = sig ? _skinCache.get(sig) : null;
    let shared = !!geo;
    if (!geo) {
      const geos = list.map((m) => {
        const g = prepGeo(m, withColor, cm ? _c.copy(m.material.color) : null, false);
        const n = g.attributes.position.count, b = boneIdx.get(m);
        const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
        for (let k = 0; k < n; k++) { si[k * 4] = b; sw[k * 4] = 1; }
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
        return g;
      });
      geo = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!geo) continue;
      if (sig && _skinCache.size < SKIN_CACHE_MAX) { _skinCache.set(sig, geo); shared = true; }
    }
    let mat = mat0;
    if (cm) {
      // 每个模型实例一份顶点色材质（受击闪白按实例生效）
      const mk = mat0.side + '|' + mat0.flatShading;
      mat = cmMats.get(mk);
      if (!mat) {
        let r = 0, me = 0;
        for (const m of list) { r += m.material.roughness; me += m.material.metalness; }
        mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: mat0.flatShading, side: mat0.side, roughness: r / list.length, metalness: me / list.length });
        cmMats.set(mk, mat);
      }
    }
    if (boneOffset) { mat.userData.boneOffset = boneOffset; mat.onBeforeCompile = atlasOnBeforeCompile; }
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.bindMode = THREE.DetachedBindMode;
    mesh.bind(skeleton, IDENTITY);
    // 顶点已经由骨骼（零件的世界矩阵）放到世界空间，网格自身始终保持单位矩阵
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.castShadow = list[0].castShadow;
    mesh.receiveShadow = list[0].receiveShadow;
    mesh.renderOrder = list[0].renderOrder;
    mesh.userData.mergedGeo = !shared;
    root.add(mesh);
    for (const m of list) { m.layers.disableAll(); m.userData.rigidBone = true; }
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
