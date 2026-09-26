// =====================================================================
//  弯道：全局“世界弯曲”顶点变换
//  玩法坐标仍然是笔直的 +Z 跑道（x = 横向偏移，z = 里程），渲染时在世界空间把
//  顶点沿 x 平移：offset(z) = X(z) − X(z0) − X'(z0)·(z − z0)，z0 = 玩家所在里程。
//  即以玩家处的切线为基准展开道路中心线 X(z)，前方道路随曲率拐弯，镜头也随之转向。
//  - 所有内置材质通过改写 ShaderChunk 自动生效（含阴影深度材质）
//  - 自定义 ShaderMaterial 需 #include <bend_pars_vertex> 并调用 bendWorld()
//  - 自己改写 onBeforeCompile 的材质需调用 attachBend(shader)
// =====================================================================
import * as THREE from 'three';

const TAU = Math.PI * 2;
function rng(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const D_MIN = -80, D_MAX = 480;

const U = {
  uBendA: { value: new THREE.Vector4() },  // 各分量振幅（已乘强度）
  uBendW: { value: new THREE.Vector4() },  // 角频率
  uBendP: { value: new THREE.Vector4() },  // 在 z0 处的相位（CPU 双精度求模，避免 GPU 大数误差）
  uBendZ: { value: 0 },
};

const BEND_PARS = /* glsl */`
uniform vec4 uBendA;
uniform vec4 uBendW;
uniform vec4 uBendP;
uniform float uBendZ;
vec4 bendWorld( vec4 wp ) {
  float d = clamp( wp.z - uBendZ, ${D_MIN.toFixed(1)}, ${D_MAX.toFixed(1)} );
  wp.x += dot( uBendA, sin( uBendW * d + uBendP ) - sin( uBendP ) - cos( uBendP ) * uBendW * d );
  return wp;
}
`;

THREE.ShaderChunk.bend_pars_vertex = BEND_PARS;
// logdepthbuf_pars_vertex 出现在所有内置顶点着色器的 main() 之前，且只在顶点阶段使用
THREE.ShaderChunk.logdepthbuf_pars_vertex = BEND_PARS + THREE.ShaderChunk.logdepthbuf_pars_vertex;
THREE.ShaderChunk.project_vertex = THREE.ShaderChunk.project_vertex.replace(
  'mvPosition = modelViewMatrix * mvPosition;', 'mvPosition = viewMatrix * bendWorld( modelMatrix * mvPosition );');
THREE.ShaderChunk.worldpos_vertex = THREE.ShaderChunk.worldpos_vertex.replace(
  'worldPosition = modelMatrix * worldPosition;', 'worldPosition = bendWorld( modelMatrix * worldPosition );');

export function attachBend(shader) { Object.assign(shader.uniforms, U); }
// 所有材质默认在编译前挂上共享 uniform（改写了 onBeforeCompile 的材质需手动调用 attachBend）
THREE.Material.prototype.onBeforeCompile = function (shader) { attachBend(shader); };

// —— 每个生态的弯道风格：[振幅, 波长] × 3 ——
const STYLE = {
  jungle:  [[34, 880], [15, 390], [3.0, 170]],
  desert:  [[46, 1250], [14, 560], [2.0, 230]],
  frost:   [[36, 980], [14, 430], [2.6, 190]],
  swamp:   [[28, 760], [16, 330], [3.4, 150]],
  volcano: [[38, 940], [16, 400], [2.8, 175]],
  shadow:  [[34, 820], [17, 350], [3.6, 150]],
  hive:    [[36, 780], [18, 320], [3.8, 140]],
};

const prof = { A: [0, 0, 0, 0], W: [0, 0, 0, 0], P: [0, 0, 0, 0] };
let strength = 0, z0 = 0;
const ph = [0, 0, 0, 0];

export function setBendProfile(biome) {
  const st = STYLE[biome] || STYLE.jungle;
  const r = rng('dino-bend:' + biome);
  for (let i = 0; i < 4; i++) {
    const s = st[i];
    prof.A[i] = s ? s[0] * (0.85 + r() * 0.3) : 0;
    prof.W[i] = s ? TAU / (s[1] * (0.9 + r() * 0.2)) : 0;
    prof.P[i] = r() * TAU;
  }
}

/** 每帧更新：z = 玩家里程，s = 弯曲强度（菜单 0，跑图 1） */
export function updateBend(z, s = 1) {
  z0 = z; strength = s;
  U.uBendZ.value = z;
  for (let i = 0; i < 4; i++) ph[i] = (prof.W[i] * z + prof.P[i]) % TAU;
  U.uBendA.value.set(prof.A[0] * s, prof.A[1] * s, prof.A[2] * s, prof.A[3] * s);
  U.uBendW.value.set(...prof.W);
  U.uBendP.value.set(...ph);
}

export function resetBend() {
  strength = 0;
  U.uBendA.value.set(0, 0, 0, 0);
}

/** 与着色器一致的横向偏移 */
export function bendX(z) {
  if (!strength) return 0;
  const d = Math.min(D_MAX, Math.max(D_MIN, z - z0));
  let o = 0;
  for (let i = 0; i < 4; i++) {
    const w = prof.W[i], p = ph[i];
    o += prof.A[i] * (Math.sin(w * d + p) - Math.sin(p) - Math.cos(p) * w * d);
  }
  return o * strength;
}

/** 把玩法坐标点变换到屏幕上看到的位置（原地修改） */
export function bendVec(v) { v.x += bendX(v.z); return v; }

/** 玩家处的道路曲率 X''(z0)（1/m），正值表示前方向 +x 弯 */
export function curvature() {
  if (!strength) return 0;
  let k = 0;
  for (let i = 0; i < 4; i++) k -= prof.A[i] * prof.W[i] * prof.W[i] * Math.sin(ph[i]);
  return k * strength;
}
