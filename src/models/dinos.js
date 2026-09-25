// =====================================================================
//  程序化低多边形恐龙模型（20 种）+ 程序化骨架动画
//  createDinoModel(def) → { root, saddle, mouth, size, update(dt, s) }
//  约定见 CONTRACTS.md §1：面朝 +Z，原点在两脚之间地面，root 已按 def.scale 缩放。
//  saddle 锚点自带 1/def.scale 反缩放：挂在上面的骑手世界缩放 = 骑手自身 scale。
// =====================================================================
import * as THREE from 'three';

const PI = Math.PI;
const TAU = PI * 2;
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const EMPTY = Object.freeze({});

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const bump = (x, a, b) => (x <= a || x >= b ? 0 : Math.sin(PI * (x - a) / (b - a)));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (c, t, k, dt) => c + (t - c) * (1 - Math.exp(-k * dt));

// ---------------------------------------------------------------------
//  几何体缓存（单位几何体，靠 mesh.scale 变形；几何体可跨实例共享）
// ---------------------------------------------------------------------
const GEO = new Map();
function geo(key, make) {
  let g = GEO.get(key);
  if (!g) { g = make(); GEO.set(key, g); }
  return g;
}
const gSph = () => geo('sph', () => new THREE.SphereGeometry(1, 12, 9));
const gSphLo = () => geo('sphLo', () => new THREE.SphereGeometry(1, 8, 6));
const gBox = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const gCone = (n = 6) => geo('cone' + n, () => new THREE.ConeGeometry(1, 1, n));
const gCyl = (n = 10) => geo('cyl' + n, () => new THREE.CylinderGeometry(1, 1, 1, n));
const gTorus = () => geo('torus', () => new THREE.TorusGeometry(1, 0.28, 5, 10));
function gTaper(ratio, n) {
  const r = Math.round(clamp(ratio, 0.05, 3) * 20) / 20;
  return geo(`tp${n}_${r}`, () => new THREE.CylinderGeometry(1, r, 1, n, 1));
}
function gShape(key, pts) {
  return geo(key, () => {
    const sh = new THREE.Shape();
    sh.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false, curveSegments: 3 });
    g.translate(0, 0, -0.5);
    return g;
  });
}
// 半椭圆冠（双冠龙）
const CREST_PTS = (() => { const p = [[1, 0]]; for (let i = 1; i <= 8; i++) p.push([Math.cos(PI * i / 8), Math.sin(PI * i / 8)]); return p; })();
const gCrest = () => gShape('crest', CREST_PTS);
// 剑龙骨板
const gPlate = () => gShape('plate', [[-0.5, 0], [0.5, 0], [0.44, 0.38], [0.2, 0.82], [-0.02, 1], [-0.26, 0.8], [-0.46, 0.4]]);
// 棘龙背帆（x=-1 为前端，经 rotation.y=PI/2 后朝 +Z）
const SAIL_TOP = [[-1, 0.28], [-0.8, 0.62], [-0.4, 0.93], [0.1, 1], [0.55, 0.82], [0.92, 0.38], [1, 0]];
const gSail = () => gShape('sail', [[-1, 0], [1, 0], ...SAIL_TOP.slice().reverse()]);
function sailTop(x) {
  for (let i = 0; i < SAIL_TOP.length - 1; i++) {
    const a = SAIL_TOP[i], b = SAIL_TOP[i + 1];
    if (x >= a[0] && x <= b[0]) return lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]));
  }
  return 0;
}
// 翼膜（翼龙），side = ±1
function gMembrane(side, part) {
  return geo(`mem_${part}_${side}`, () => {
    const s = side;
    let tris;
    if (part === 'in') {
      const S0 = [0, 0, 0.08], E = [s * 1.3, 0.05, -0.1], Et = [s * 1.2, 0, -0.95], Hp = [0, -0.06, -1.05];
      tris = [S0, E, Et, S0, Et, Hp];
    } else {
      const O = [0, 0, 0], T = [s * 2.0, -0.02, -0.45], Et = [-s * 0.1, -0.05, -0.85];
      tris = [O, T, Et];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
    g.computeVertexNormals();
    return g;
  });
}

// ---------------------------------------------------------------------
//  构建辅助
// ---------------------------------------------------------------------
function grp(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
function msh(parent, g, mat, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}
// 从 a 到 b 的锥形圆柱段（a 端半径 r0，b 端 r1）；flat 缩放第二截面轴（前伸段=竖直方向）
function seg(parent, a, b, r0, r1, mat, n = 8, flat = 1) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1e-4;
  const m = new THREE.Mesh(gTaper(r1 / r0, n), mat);
  m.position.set(a[0] + dx / 2, a[1] + dy / 2, a[2] + dz / 2);
  _v.set(dx / len, dy / len, dz / len);
  m.quaternion.setFromUnitVectors(DOWN, _v);
  m.scale.set(r0, len, r0 * flat);
  parent.add(m);
  return m;
}
// 从 base 沿 dir 伸出的锥（角、爪、牙、刺）
function spike(parent, base, dir, len, r, mat, n = 5) {
  _v.set(dir[0], dir[1], dir[2]).normalize();
  const m = new THREE.Mesh(gCone(n), mat);
  m.quaternion.setFromUnitVectors(UP, _v);
  m.position.set(base[0] + _v.x * len / 2, base[1] + _v.y * len / 2, base[2] + _v.z * len / 2);
  m.scale.set(r, len, r);
  parent.add(m);
  return m;
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BLANKETS = [0xb3312c, 0x2c5cb3, 0x7a2cb3, 0x1f8a5a, 0xc0781a, 0x2a9ab0, 0xa02c6a];

function makeMats(def) {
  const c = def.colors || {};
  const S = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, flatShading: true, roughness: 0.82, metalness: 0 }, o));
  const eye = c.eye ?? 0xffcc00;
  return {
    main: S(c.main ?? 0x777777),
    belly: S(c.belly ?? 0xcccccc),
    accent: S(c.accent ?? 0x444444),
    extra: S(c.extra ?? 0x999999),
    eye: S(eye, { emissive: eye, emissiveIntensity: 0.55, roughness: 0.3 }),
    pupil: S(0x0a0a0a, { roughness: 0.25 }),
    tooth: S(0xf4efe0, { roughness: 0.5 }),
    claw: S(0x2b2622, { roughness: 0.55 }),
    horn: S(0xe8dcc0, { roughness: 0.6 }),
    beak: S(0x3a3129, { roughness: 0.6 }),
    mouth: S(0x6e2222, { roughness: 0.7 }),
    leather: S(0x6b3f1f, { roughness: 0.7 }),
    blanket: S(BLANKETS[hashStr(def.id) % BLANKETS.length], { side: THREE.DoubleSide }),
    trim: S(0xe8c050, { metalness: 0.55, roughness: 0.35 }),
    membrane: S(c.extra ?? 0x888888, { side: THREE.DoubleSide }),
  };
}

// ---------------------------------------------------------------------
//  物种参数（未缩放单位；root 再乘 def.scale）
// ---------------------------------------------------------------------
const BIPED = {
  hipH: 1.55, hipX: 0.34, legR: 0.26,
  bodyY: 0.1, bodyZ: 0.3, bodyW: 0.5, bodyH: 0.55, bodyL: 1.2, tilt: 0.12,
  neckL: 0.7, neckR: 0.3, neckA: 0.55, neckA2: 0.2,
  headL: 0.95, headH: 0.46, headW: 0.42, headStyle: 'thero', headPitch: 0.05,
  tailN: 4, tailL: 2.5, tailR: 0.42, tailDrop: 0.08,
  armL: 0.6, armR: 0.09, claws: 3, saddleZ: 0.05,
};
const QUAD = {
  hindH: 1.3, frontH: 1.15, hipX: 0.5, shX: 0.48, legR: 0.26, frontLegR: 0.24,
  bodyW: 0.8, bodyH: 0.72, bodyL: 1.5, bodyY: 0.25,
  neckN: 1, neckL: 0.5, neckR: 0.4, neckA: 0.1, neckCurve: 0, neckBaseY: 0.2,
  headL: 1.0, headH: 0.6, headW: 0.6, headStyle: 'cera', headPitch: 0,
  tailN: 4, tailL: 2.0, tailR: 0.45, tailDrop: 0.12, saddleZ: 0.1,
};
const PTERO = {
  hover: 2.2, bodyW: 0.42, bodyH: 0.38, bodyL: 0.85, saddleZ: 0.12, headStyle: 'ptero', headPitch: 0,
  headL: 1, headH: 0.4, headW: 0.34, neckR: 0.13,
  tailN: 1, tailL: 0.4, tailR: 0.09, tailDrop: 0.15, tilt: 0,
};

const SPECIES = {
  trex: { hipX: 0.4, legR: 0.33, bodyW: 0.62, bodyH: 0.64, bodyL: 1.3, neckL: 0.5, neckR: 0.42, neckA: 0.45, neckA2: 0.15,
    headL: 1.32, headH: 0.64, headW: 0.62, tailL: 2.6, tailR: 0.5, armL: 0.32, armR: 0.07, claws: 2 },
  giganotosaurus: { hipX: 0.38, legR: 0.31, bodyW: 0.58, bodyH: 0.62, bodyL: 1.42, neckL: 0.6, neckR: 0.38,
    headL: 1.45, headH: 0.56, headW: 0.5, tailL: 2.9, tailR: 0.48, armL: 0.42, armR: 0.08 },
  allosaurus: { headL: 1.05, headH: 0.48, headW: 0.42, armL: 0.62, tailL: 2.6 },
  carnotaurus: { hipH: 1.7, legR: 0.24, bodyW: 0.46, bodyH: 0.5, neckL: 0.55, neckA: 0.6,
    headL: 0.74, headH: 0.52, headW: 0.46, armL: 0.22, armR: 0.06, claws: 2 },
  dilophosaurus: { hipH: 1.6, legR: 0.22, bodyW: 0.42, bodyH: 0.46, bodyL: 1.05, neckL: 0.95, neckR: 0.24, neckA: 0.8, neckA2: 0.3,
    headL: 0.85, headH: 0.38, headW: 0.34, tailL: 2.4, tailR: 0.36, armL: 0.6 },
  spinosaurus: { hipH: 1.35, legR: 0.3, bodyW: 0.52, bodyH: 0.56, bodyL: 1.5, bodyZ: 0.45, neckL: 0.85, neckR: 0.3, neckA: 0.5,
    headL: 1.55, headH: 0.4, headW: 0.36, headStyle: 'croc', tailL: 2.8, tailR: 0.44, armL: 0.75, saddleZ: 0.42 },
  baryonyx: { hipH: 1.5, bodyL: 1.25, neckL: 0.8, neckR: 0.28, headL: 1.3, headH: 0.38, headW: 0.34, headStyle: 'croc',
    armL: 0.85, armR: 0.1 },
  raptor: { hipH: 1.35, hipX: 0.28, legR: 0.2, bodyW: 0.36, bodyH: 0.42, bodyL: 0.95, neckL: 0.6, neckR: 0.2, neckA: 0.7,
    headL: 0.8, headH: 0.32, headW: 0.3, tailL: 2.3, tailR: 0.3, tailDrop: 0.0, armL: 0.7, armR: 0.07 },
  therizinosaurus: { hipH: 1.55, bodyW: 0.6, bodyH: 0.68, bodyL: 1.15, tilt: 0.42, bodyZ: 0.2, bodyY: 0.25,
    neckL: 1.2, neckR: 0.24, neckA: 0.95, neckA2: 0.35, headL: 0.55, headH: 0.3, headW: 0.3, headStyle: 'beak', headPitch: 0.1,
    tailL: 1.8, tailR: 0.38, armL: 1.2, armR: 0.1, saddleZ: -0.08 },
  gallimimus: { hipH: 1.85, hipX: 0.24, legR: 0.2, bodyW: 0.4, bodyH: 0.44, bodyL: 0.85, bodyZ: 0.2,
    neckL: 1.25, neckR: 0.16, neckA: 1.05, neckA2: 0.4, headL: 0.5, headH: 0.26, headW: 0.26, headStyle: 'beak',
    tailL: 2.0, tailR: 0.3, armL: 0.55, armR: 0.06 },
  parasaurolophus: { bodyW: 0.56, bodyH: 0.6, bodyL: 1.3, neckL: 0.75, neckR: 0.3, neckA: 0.6,
    headL: 0.85, headH: 0.38, headW: 0.36, headStyle: 'duck', tailL: 2.4, tailR: 0.46, armL: 0.8, armR: 0.09, claws: 4 },
  pachycephalosaurus: { hipH: 1.45, bodyW: 0.5, bodyH: 0.52, bodyL: 1.1, neckL: 0.55, neckR: 0.28, neckA: 0.5,
    headL: 0.65, headH: 0.46, headW: 0.4, headStyle: 'dome', tailL: 2.2, tailR: 0.4, armL: 0.45, claws: 4 },
  iguanodon: { hipH: 1.6, bodyW: 0.6, bodyH: 0.62, bodyL: 1.35, neckL: 0.7, neckR: 0.32, neckA: 0.5,
    headL: 0.85, headH: 0.42, headW: 0.36, headStyle: 'iguana', tailL: 2.5, tailR: 0.5, armL: 0.95, armR: 0.12 },
  // ---- 四足 ----
  triceratops: { hindH: 1.25, frontH: 1.05, hipX: 0.52, shX: 0.5, legR: 0.28, frontLegR: 0.26, bodyW: 0.85, bodyH: 0.75, bodyL: 1.45, bodyY: 0.3,
    neckL: 0.45, neckR: 0.45, neckA: -0.05, neckBaseY: 0.02, headL: 1.1, headH: 0.65, headW: 0.62, tailL: 1.8, tailR: 0.42 },
  styracosaurus: { hindH: 1.25, frontH: 1.05, hipX: 0.5, shX: 0.48, legR: 0.27, frontLegR: 0.25, bodyW: 0.82, bodyH: 0.72, bodyL: 1.42, bodyY: 0.3,
    neckL: 0.45, neckR: 0.43, neckA: -0.05, neckBaseY: 0.02, headL: 1.05, headH: 0.62, headW: 0.58, tailL: 1.8, tailR: 0.4 },
  stegosaurus: { hindH: 1.5, frontH: 0.95, hipX: 0.45, shX: 0.42, legR: 0.28, frontLegR: 0.2, bodyW: 0.7, bodyH: 0.7, bodyL: 1.5, bodyY: 0.35,
    neckN: 2, neckL: 0.9, neckR: 0.3, neckA: -0.25, neckBaseY: 0.2, headStyle: 'stego', headL: 0.6, headH: 0.3, headW: 0.28,
    tailN: 4, tailL: 2.4, tailR: 0.42, tailDrop: 0.05, saddleZ: 0.35 },
  ankylosaurus: { hindH: 0.95, frontH: 0.85, hipX: 0.6, shX: 0.58, legR: 0.26, frontLegR: 0.24, bodyW: 1.05, bodyH: 0.6, bodyL: 1.5, bodyY: 0.3,
    neckL: 0.35, neckR: 0.38, neckA: 0, neckBaseY: 0.1, headStyle: 'ankylo', headL: 0.7, headH: 0.42, headW: 0.7,
    tailL: 2.1, tailR: 0.36, tailDrop: 0.02, saddleZ: 0.05 },
  brachiosaurus: { hindH: 1.55, frontH: 2.0, hipX: 0.55, shX: 0.55, legR: 0.3, frontLegR: 0.3, bodyW: 0.85, bodyH: 0.8, bodyL: 1.6, bodyY: 0.25,
    neckN: 4, neckL: 3.2, neckR: 0.36, neckA: 1.15, neckCurve: 0.3, neckBaseY: 0.35, headStyle: 'sauro', headL: 0.7, headH: 0.38, headW: 0.36,
    headPitch: 0.35, tailL: 2.2, tailR: 0.45, tailDrop: 0.2, saddleZ: 0.0 },
  diplodocus: { hindH: 1.7, frontH: 1.5, hipX: 0.52, shX: 0.5, legR: 0.3, frontLegR: 0.27, bodyW: 0.8, bodyH: 0.75, bodyL: 1.6, bodyY: 0.3,
    neckN: 4, neckL: 2.8, neckR: 0.32, neckA: 0.28, neckCurve: -0.12, neckBaseY: 0.25, headStyle: 'sauro', headL: 0.65, headH: 0.28, headW: 0.3,
    headPitch: 0.2, tailN: 6, tailL: 3.8, tailR: 0.45, tailDrop: 0.05, saddleZ: 0.0 },
  pteranodon: {},
};

// ---------------------------------------------------------------------
//  公共部件
// ---------------------------------------------------------------------
function buildSaddle(ctx, parent, z, Wz, Hz) {
  const M = ctx.mats, k = ctx.k;
  const g = grp(parent, 0, 0, z);
  const arc = 2.2;
  const bl = new THREE.Mesh(geo('blanket', () => new THREE.CylinderGeometry(1, 1, 1, 16, 1, true, PI - arc / 2, arc)), M.blanket);
  bl.rotation.x = PI / 2;
  bl.scale.set(Wz * 1.06, 0.95 * k, Hz * 1.06);
  g.add(bl);
  const ex = Math.sin(arc / 2), ey = Math.cos(arc / 2);
  for (const s of [-1, 1]) {
    msh(g, gBox(), M.trim, s * Wz * 1.08 * ex, Hz * 1.08 * ey, 0, 0.05 * k, 0.05 * k, 0.96 * k);
    // 皮带 + 马镫
    seg(g, [s * Wz * 0.4, Hz * 1.08, 0.02 * k], [s * Wz * 1.08, Hz * 0.28, 0.02 * k], 0.03 * k, 0.03 * k, M.leather, 4);
    msh(g, gTorus(), M.trim, s * Wz * 1.1, Hz * 0.2, 0.02 * k, 0.09 * k, 0.09 * k, 0.09 * k, 0, PI / 2, 0);
  }
  const top = Hz * 1.03;
  msh(g, gBox(), M.leather, 0, top + 0.06 * k, 0, 0.52 * k, 0.12 * k, 0.72 * k);
  seg(g, [0, top + 0.1 * k, 0.28 * k], [0, top + 0.32 * k, 0.35 * k], 0.07 * k, 0.05 * k, M.leather, 6);
  msh(g, gSphLo(), M.trim, 0, top + 0.34 * k, 0.355 * k, 0.07 * k, 0.07 * k, 0.07 * k);
  msh(g, gBox(), M.leather, 0, top + 0.2 * k, -0.33 * k, 0.5 * k, 0.22 * k, 0.08 * k, -0.25, 0, 0);
  const anchor = grp(g, 0, top + 0.12 * k, 0);
  anchor.scale.setScalar(1 / ctx.def.scale); // 抵消 root 缩放，骑手按自身 scale 显示
  return anchor;
}

function addEyes(ctx, head, x, y, z, r, brow = true) {
  const M = ctx.mats;
  for (const s of [-1, 1]) {
    const e = msh(head, gSphLo(), M.eye, s * x, y, z, r, r, r);
    const p = msh(head, gSphLo(), M.pupil, s * (x + r * 0.62), y, z + r * 0.15, r * 0.4, r * 0.78, r * 0.42);
    e.userData.sy = r; p.userData.sy = r * 0.78;
    ctx.eyes.push(e, p);
    if (brow) msh(head, gBox(), M.main, s * x * 0.92, y + r * 0.9, z + r * 0.1, r * 1.5, r * 0.5, r * 2.4, 0, 0, s * 0.3);
  }
}

// 沿锥段（(0,y0,z0)→(0,y1,z1)，半径 r0→r1，竖直压扁 flat）排列牙齿
function teethRow(parent, M, z0, z1, y0, y1, r0, r1, flat, n, len, rad, up) {
  for (let i = 0; i < n; i++) {
    const u = 0.25 + 0.68 * (i / Math.max(1, n - 1));
    const z = lerp(z0, z1, u), cy = lerp(y0, y1, u), rr = lerp(r0, r1, u);
    for (const s of [-1, 1]) {
      const y = cy + (up ? 1 : -1) * rr * flat * 0.7;
      spike(parent, [s * rr * 0.68, y, z], [0, up ? 1 : -1, 0.12], len * (1 - 0.3 * u), rad, M.tooth, 4);
    }
  }
}

function addMarkings(ctx, torso, W, H, L, skipZ) {
  const { F, mats: M } = ctx;
  const gap = 0.5 * ctx.k + 0.12;
  if (F.has('stripes')) {
    for (const u of [0.58, 0.3, 0.02, -0.26, -0.52, -0.76]) {
      const z = u * L;
      if (Math.abs(z - skipZ) < gap) continue;
      const f = Math.sqrt(1 - u * u);
      msh(torso, gSphLo(), M.accent, 0, H * f * 0.32, z, W * f * 0.99, H * f * 0.74, L * 0.055);
    }
  }
  if (F.has('spots')) {
    const r = rng(hashStr(ctx.def.id));
    let placed = 0;
    for (let tries = 0; tries < 60 && placed < 12; tries++) {
      const u = -0.8 + r() * 1.5, a = 0.35 + r() * 1.05, s = r() < 0.5 ? -1 : 1;
      const z = u * L;
      if (Math.abs(z - skipZ) < gap) continue;
      const f = Math.sqrt(1 - u * u);
      const x = s * W * f * Math.sin(a), y = H * f * Math.cos(a);
      const m = msh(torso, gSphLo(), M.accent, x, y, z, 0.13, 0.04, 0.13);
      _v.set(x / (W * W), y / (H * H), z / (L * L)).normalize();
      m.quaternion.setFromUnitVectors(UP, _v);
      const sc = 0.7 + r() * 0.8;
      m.scale.set(0.12 * sc, 0.04, 0.12 * sc);
      placed++;
    }
  }
}

function buildNeck(ctx, parent, base, segs, r0, r1) {
  const M = ctx.mats;
  let p = parent, pos = base, r = r0;
  const dr = (r0 - r1) / segs.length;
  for (let i = 0; i < segs.length; i++) {
    const n = grp(p, pos[0], pos[1], pos[2]);
    ctx.neck.push(n);
    const { len, ang } = segs[i];
    const e = [0, Math.sin(ang) * len, Math.cos(ang) * len];
    const rn = r - dr;
    seg(n, [0, 0, 0], e, r, rn, M.main, 8);
    seg(n, [0, -r * 0.34, r * 0.1], [0, e[1] - rn * 0.34, e[2]], r * 0.74, rn * 0.74, M.belly, 7);
    if (i > 0) msh(n, gSphLo(), M.main, 0, 0, 0, r, r, r);
    p = n; pos = e; r = rn;
  }
  const head = grp(p, pos[0], pos[1], pos[2]);
  msh(head, gSphLo(), M.main, 0, 0, 0, r * 1.02, r * 1.02, r * 1.02);
  ctx.head = head;
  return head;
}

function buildTail(ctx, parent, base) {
  const { P, mats: M, F } = ctx;
  const n = P.tailN, len = P.tailL / n, r0 = P.tailR;
  const whip = F.has('whipTail');
  let p = parent, pos = base, r = r0;
  for (let i = 0; i < n; i++) {
    const g = grp(p, pos[0], pos[1], pos[2]);
    ctx.tail.push(g);
    const u = (i + 1) / n;
    const rn = whip ? r0 * Math.pow(1 - u, 1.4) + 0.025 : Math.max(0.03, r0 * (1 - u * 0.86));
    const e = [0, -P.tailDrop * len, -len];
    seg(g, [0, 0, 0], e, r, rn, M.main, 8);
    if (i > 0) msh(g, gSphLo(), M.main, 0, 0, 0, r * 0.98, r * 0.98, r * 0.98);
    if (F.has('stripes') && i < n - 1) {
      const a = 0.4, b = 0.55;
      seg(g, [0, e[1] * a, e[2] * a], [0, e[1] * b, e[2] * b], lerp(r, rn, a) * 1.07, lerp(r, rn, b) * 1.07, M.accent, 8);
    }
    p = g; pos = e; r = rn;
  }
  ctx.tailEnd = grp(p, pos[0], pos[1], pos[2]);
  ctx.tailEndR = r;
}

// ---------------------------------------------------------------------
//  头部（按风格）
// ---------------------------------------------------------------------
function buildHead(ctx, head) {
  const { P, mats: M, F } = ctx;
  const L = P.headL, H = P.headH, W = P.headW;
  ctx.maxJaw = 0.7;
  switch (P.headStyle) {
    case 'thero': {
      msh(head, gSph(), M.main, 0, H * 0.12, L * 0.2, W * 0.5, H * 0.52, L * 0.3);
      const r0 = W * 0.4, r1 = W * 0.24, fl = (H * 0.36) / r0;
      const y0 = H * 0.1, y1 = -H * 0.02, z0 = L * 0.15, z1 = L;
      seg(head, [0, y0, z0], [0, y1, z1], r0, r1, M.main, 6, fl);
      teethRow(head, M, z0, z1, y0, y1, r0, r1, fl, 4, H * 0.17, W * 0.045, false);
      const jr0 = W * 0.34, jr1 = W * 0.2, jfl = 0.62;
      const jy = y0 - r0 * fl - jr0 * jfl + H * 0.04;
      const jaw = grp(head, 0, jy, L * 0.12); ctx.jaw = jaw;
      seg(jaw, [0, 0, 0], [0, H * 0.02, L * 0.86], jr0, jr1, M.main, 6, jfl);
      seg(jaw, [0, -jr0 * jfl * 0.4, L * 0.04], [0, H * 0.02 - jr1 * jfl * 0.4, L * 0.8], jr0 * 0.8, jr1 * 0.75, M.belly, 6, jfl * 0.8);
      msh(jaw, gBox(), M.mouth, 0, jr0 * jfl * 0.55, L * 0.45, jr0 * 1.1, 0.02, L * 0.7);
      teethRow(jaw, M, 0, L * 0.86, 0, H * 0.02, jr0, jr1, jfl, 3, H * 0.13, W * 0.04, true);
      addEyes(ctx, head, W * 0.42, H * 0.3, L * 0.3, W * 0.12, true);
      ctx.mouth = grp(head, 0, jy, L * 1.02);
      ctx.maxJaw = 0.75;
      if (F.has('browHorns')) for (const s of [-1, 1]) spike(head, [s * W * 0.34, H * 0.52, L * 0.38], [s * 0.2, 1, 0.3], H * 0.38, W * 0.08, M.extra, 4);
      if (F.has('bullHorns')) for (const s of [-1, 1]) spike(head, [s * W * 0.36, H * 0.5, L * 0.2], [s, 0.75, 0.1], H * 0.8, W * 0.13, M.horn, 6);
      if (F.has('doubleCrest')) for (const s of [-1, 1]) msh(head, gCrest(), M.accent, s * W * 0.12, H * 0.3, L * 0.52, L * 0.34, H * 0.62, 0.03, 0, PI / 2, 0);
      if (F.has('neckFrill')) {
        const fr = grp(head, 0, -H * 0.05, -0.03);
        fr.rotation.x = -0.2;
        msh(fr, gCyl(14), M.extra, 0, 0, 0, W * 1.7, 0.03, W * 1.7, PI / 2, 0, 0);
        msh(fr, gCyl(14), M.accent, 0, 0, 0.025, W * 1.25, 0.03, W * 1.25, PI / 2, 0, 0);
        ctx.frill = fr;
      }
      break;
    }
    case 'croc': {
      msh(head, gSph(), M.main, 0, H * 0.2, L * 0.12, W * 0.5, H * 0.55, L * 0.2);
      const r0 = W * 0.32, r1 = W * 0.18, fl = (H * 0.3) / r0;
      const y0 = H * 0.12, y1 = 0, z0 = L * 0.1, z1 = L * 0.94;
      seg(head, [0, y0, z0], [0, y1, z1], r0, r1, M.main, 6, fl);
      msh(head, gSphLo(), M.main, 0, y1, L * 0.93, W * 0.27, H * 0.27, L * 0.08); // 吻端玫瑰花结
      teethRow(head, M, z0, z1, y0, y1, r0, r1, fl, 5, H * 0.2, W * 0.04, false);
      const jr0 = W * 0.28, jr1 = W * 0.15, jfl = 0.65;
      const jy = y0 - r0 * fl - jr0 * jfl + H * 0.04;
      const jaw = grp(head, 0, jy, L * 0.08); ctx.jaw = jaw;
      seg(jaw, [0, 0, 0], [0, H * 0.05, L * 0.86], jr0, jr1, M.main, 6, jfl);
      seg(jaw, [0, -jr0 * jfl * 0.4, L * 0.04], [0, H * 0.05 - jr1 * jfl * 0.4, L * 0.8], jr0 * 0.8, jr1 * 0.75, M.belly, 6, jfl * 0.8);
      msh(jaw, gBox(), M.mouth, 0, jr0 * jfl * 0.55, L * 0.45, jr0 * 1.1, 0.02, L * 0.72);
      teethRow(jaw, M, 0, L * 0.86, 0, H * 0.05, jr0, jr1, jfl, 4, H * 0.15, W * 0.035, true);
      addEyes(ctx, head, W * 0.4, H * 0.4, L * 0.14, W * 0.13, true);
      if (ctx.def.id === 'spinosaurus') msh(head, gCrest(), M.accent, 0, H * 0.38, L * 0.34, L * 0.14, H * 0.38, 0.04, 0, PI / 2, 0);
      ctx.mouth = grp(head, 0, jy, L * 0.98);
      ctx.maxJaw = 0.7;
      break;
    }
    case 'beak': {
      msh(head, gSph(), M.main, 0, H * 0.15, L * 0.3, W * 0.5, H * 0.52, L * 0.38);
      const beakMat = ctx.def.id === 'gallimimus' ? M.beak : M.accent;
      msh(head, gCone(6), beakMat, 0, H * 0.0, L * 0.84, W * 0.28, L * 0.5, H * 0.24, PI / 2, 0, 0);
      const jaw = grp(head, 0, -H * 0.18, L * 0.5); ctx.jaw = jaw;
      msh(jaw, gCone(6), beakMat, 0, 0, L * 0.22, W * 0.22, L * 0.4, H * 0.12, PI / 2, 0, 0);
      addEyes(ctx, head, W * 0.38, H * 0.3, L * 0.36, W * 0.17, false);
      ctx.mouth = grp(head, 0, -H * 0.08, L * 1.08);
      ctx.maxJaw = 0.45;
      break;
    }
    case 'duck': {
      msh(head, gSph(), M.main, 0, H * 0.2, L * 0.22, W * 0.5, H * 0.55, L * 0.32);
      seg(head, [0, H * 0.12, L * 0.25], [0, -H * 0.08, L * 0.82], W * 0.36, W * 0.3, M.main, 6, 0.85);
      msh(head, gBox(), M.beak, 0, -H * 0.16, L * 0.9, W * 0.72, H * 0.14, L * 0.26);
      const jaw = grp(head, 0, -H * 0.34, L * 0.25); ctx.jaw = jaw;
      seg(jaw, [0, 0, 0], [0, 0, L * 0.58], W * 0.3, W * 0.26, M.main, 6, 0.45);
      msh(jaw, gBox(), M.beak, 0, 0.0, L * 0.64, W * 0.62, H * 0.1, L * 0.2);
      addEyes(ctx, head, W * 0.42, H * 0.32, L * 0.28, W * 0.13, true);
      // 管状冠
      const cy = H * 0.5;
      seg(head, [0, cy, L * 0.32], [0, cy + 0.26, -0.25], 0.1, 0.11, M.accent, 7);
      msh(head, gSphLo(), M.accent, 0, cy + 0.26, -0.25, 0.11, 0.11, 0.11);
      seg(head, [0, cy + 0.26, -0.25], [0, cy + 0.38, -0.92], 0.11, 0.12, M.accent, 7);
      msh(head, gSphLo(), M.accent, 0, cy + 0.38, -0.92, 0.12, 0.12, 0.12);
      ctx.mouth = grp(head, 0, -H * 0.2, L * 1.02);
      ctx.maxJaw = 0.5;
      break;
    }
    case 'dome': {
      msh(head, gSph(), M.main, 0, H * 0.1, L * 0.35, W * 0.5, H * 0.48, L * 0.42);
      msh(head, gSph(), M.accent, 0, H * 0.45, L * 0.32, W * 0.52, H * 0.5, L * 0.44);
      for (let i = 0; i < 7; i++) {
        const a = PI + (i / 6) * PI; // 后半圈
        const x = Math.cos(a) * W * 0.55, z = L * 0.32 + Math.sin(a) * L * 0.46;
        spike(head, [x, H * 0.32, z], [Math.cos(a), 0.45, Math.sin(a)], H * 0.26, W * 0.07, M.extra, 4);
      }
      seg(head, [0, 0, L * 0.5], [0, -H * 0.12, L * 1.0], W * 0.3, W * 0.2, M.main, 6, 0.9);
      for (const s of [-1, 1]) spike(head, [s * W * 0.14, H * 0.1, L * 0.78], [s * 0.3, 1, 0.3], H * 0.16, W * 0.05, M.extra, 4);
      spike(head, [0, -H * 0.16, L * 0.96], [0, -0.3, 1], L * 0.12, W * 0.1, M.beak, 5);
      const jaw = grp(head, 0, -H * 0.3, L * 0.45); ctx.jaw = jaw;
      seg(jaw, [0, 0, 0], [0, 0, L * 0.48], W * 0.26, W * 0.16, M.main, 6, 0.5);
      addEyes(ctx, head, W * 0.42, H * 0.16, L * 0.56, W * 0.12, false);
      ctx.mouth = grp(head, 0, -H * 0.22, L * 1.05);
      ctx.maxJaw = 0.45;
      break;
    }
    case 'iguana': {
      msh(head, gSph(), M.main, 0, H * 0.18, L * 0.22, W * 0.5, H * 0.52, L * 0.3);
      seg(head, [0, H * 0.14, L * 0.2], [0, -H * 0.04, L * 0.88], W * 0.36, W * 0.26, M.main, 6, 1.0);
      msh(head, gCone(6), M.beak, 0, -H * 0.08, L * 0.95, W * 0.22, L * 0.18, H * 0.18, PI / 2, 0, 0);
      const jaw = grp(head, 0, -H * 0.36, L * 0.2); ctx.jaw = jaw;
      seg(jaw, [0, 0, 0], [0, 0.02, L * 0.66], W * 0.3, W * 0.2, M.main, 6, 0.5);
      addEyes(ctx, head, W * 0.42, H * 0.32, L * 0.28, W * 0.12, true);
      ctx.mouth = grp(head, 0, -H * 0.2, L * 1.03);
      ctx.maxJaw = 0.5;
      break;
    }
    case 'cera': {
      msh(head, gSph(), M.main, 0, 0, L * 0.35, W * 0.5, H * 0.5, L * 0.42);
      seg(head, [0, -H * 0.05, L * 0.55], [0, -H * 0.28, L * 0.98], W * 0.3, W * 0.16, M.main, 6, 1.3);
      spike(head, [0, -H * 0.3, L * 0.93], [0, -0.55, 1], L * 0.2, W * 0.13, M.beak, 5);
      const jaw = grp(head, 0, -H * 0.36, L * 0.38); ctx.jaw = jaw;
      seg(jaw, [0, 0, 0], [0, -H * 0.05, L * 0.48], W * 0.28, W * 0.12, M.main, 6, 0.6);
      spike(jaw, [0, -H * 0.05, L * 0.46], [0, 0.3, 1], L * 0.12, W * 0.08, M.beak, 5);
      addEyes(ctx, head, W * 0.44, H * 0.18, L * 0.52, W * 0.1, true);
      const styr = F.has('spikedFrill');
      const R = W * (styr ? 1.15 : 1.3);
      const fr = grp(head, 0, H * 0.28, L * 0.05);
      fr.rotation.x = -0.6;
      msh(fr, gCyl(16), M.accent, 0, R * 0.35, 0, R, 0.1, R, PI / 2, 0, 0);
      msh(fr, gCyl(16), M.main, 0, R * 0.33, 0.055, R * 0.86, 0.04, R * 0.86, PI / 2, 0, 0);
      if (styr) {
        for (let i = 0; i < 6; i++) {
          const a = lerp(0.42, PI - 0.42, i / 5);
          const len = R * (0.62 + 0.22 * Math.sin(PI * i / 5));
          spike(fr, [Math.cos(a) * R * 0.95, R * 0.35 + Math.sin(a) * R * 0.95, 0], [Math.cos(a), Math.sin(a), -0.25], len, R * 0.085, M.extra, 5);
        }
        for (const a of [0.05, PI - 0.05]) spike(fr, [Math.cos(a) * R, R * 0.35 + Math.sin(a) * R, 0], [Math.cos(a), Math.sin(a), 0], R * 0.25, R * 0.07, M.extra, 4);
        spike(head, [0, 0, L * 0.8], [0, 1, 0.32], L * 0.72, W * 0.12, M.horn, 6);
        for (const s of [-1, 1]) spike(head, [s * W * 0.26, H * 0.42, L * 0.45], [s * 0.2, 1, 0.3], L * 0.12, W * 0.06, M.horn, 4);
      } else {
        for (let i = 0; i < 9; i++) {
          const a = lerp(-0.25, PI + 0.25, i / 8);
          spike(fr, [Math.cos(a) * R, R * 0.35 + Math.sin(a) * R, 0], [Math.cos(a), Math.sin(a), 0], R * 0.2, R * 0.07, M.extra, 4);
        }
        for (const s of [-1, 1]) spike(head, [s * W * 0.26, H * 0.38, L * 0.45], [s * 0.12, 0.45, 1], L * 0.85, W * 0.1, M.horn, 6);
        spike(head, [0, H * 0.0, L * 0.82], [0, 1, 0.35], L * 0.25, W * 0.08, M.horn, 5);
      }
      ctx.mouth = grp(head, 0, -H * 0.3, L * 1.05);
      ctx.maxJaw = 0.5;
      break;
    }
    case 'stego': {
      msh(head, gSph(), M.main, 0, 0, L * 0.3, W * 0.5, H * 0.5, L * 0.38);
      seg(head, [0, -H * 0.05, L * 0.45], [0, -H * 0.2, L * 1.0], W * 0.35, W * 0.2, M.main, 6, 0.9);
      spike(head, [0, -H * 0.24, L * 0.95], [0, -0.3, 1], L * 0.14, W * 0.12, M.beak, 4);
      const jaw = grp(head, 0, -H * 0.32, L * 0.35); ctx.jaw = jaw;
      seg(jaw, [0, 0, 0], [0, 0, L * 0.5], W * 0.26, W * 0.14, M.main, 6, 0.6);
      addEyes(ctx, head, W * 0.42, H * 0.15, L * 0.38, W * 0.13, true);
      ctx.mouth = grp(head, 0, -H * 0.25, L * 1.05);
      ctx.maxJaw = 0.5;
      break;
    }
    case 'ankylo': {
      msh(head, gSph(), M.main, 0, 0, L * 0.4, W * 0.5, H * 0.5, L * 0.45);
      msh(head, gBox(), M.accent, 0, H * 0.4, L * 0.42, W * 0.85, H * 0.18, L * 0.7);
      seg(head, [0, -H * 0.05, L * 0.6], [0, -H * 0.15, L * 1.0], W * 0.3, W * 0.22, M.main, 6, 0.7);
      spike(head, [0, -H * 0.18, L * 0.96], [0, -0.3, 1], L * 0.1, W * 0.12, M.beak, 4);
      for (const s of [-1, 1]) {
        spike(head, [s * W * 0.42, H * 0.3, L * 0.08], [s * 0.8, 0.15, -0.6], 0.36, W * 0.09, M.horn, 4);
        spike(head, [s * W * 0.45, -H * 0.2, L * 0.35], [s * 0.7, -0.5, -0.3], 0.28, W * 0.08, M.horn, 4);
      }
      const jaw = grp(head, 0, -H * 0.36, L * 0.4); ctx.jaw = jaw;
      seg(jaw, [0, 0, 0], [0, 0, L * 0.5], W * 0.3, W * 0.18, M.main, 6, 0.5);
      addEyes(ctx, head, W * 0.43, H * 0.12, L * 0.62, W * 0.08, true);
      ctx.mouth = grp(head, 0, -H * 0.25, L * 1.05);
      ctx.maxJaw = 0.45;
      break;
    }
    case 'sauro': {
      msh(head, gSph(), M.main, 0, 0, L * 0.3, W * 0.5, H * 0.5, L * 0.38);
      seg(head, [0, -H * 0.05, L * 0.4], [0, -H * 0.12, L * 1.0], W * 0.4, W * 0.34, M.main, 6, 0.7);
      if (ctx.def.id === 'brachiosaurus') msh(head, gSph(), M.main, 0, H * 0.42, L * 0.42, W * 0.32, H * 0.4, L * 0.28);
      const jaw = grp(head, 0, -H * 0.36, L * 0.3); ctx.jaw = jaw;
      seg(jaw, [0, 0, 0], [0, 0.02, L * 0.64], W * 0.34, W * 0.3, M.main, 6, 0.5);
      for (const s of [-1, 1]) for (let i = 0; i < 2; i++) spike(head, [s * W * (0.12 + i * 0.12), -H * 0.33, L * (0.96 - i * 0.08)], [0, -1, 0.1], H * 0.14, W * 0.04, M.tooth, 4);
      addEyes(ctx, head, W * 0.44, H * 0.18, L * 0.32, W * 0.12, false);
      ctx.mouth = grp(head, 0, -H * 0.3, L * 1.05);
      ctx.maxJaw = 0.4;
      break;
    }
    case 'ptero': {
      msh(head, gSph(), M.main, 0, 0.02, 0.1, 0.17, 0.2, 0.26);
      msh(head, gCone(6), M.horn, 0, 0.0, 0.84, 0.1, 1.3, 0.12, PI / 2, 0, 0);
      const jaw = grp(head, 0, -0.1, 0.18); ctx.jaw = jaw;
      msh(jaw, gCone(5), M.horn, 0, 0, 0.6, 0.075, 1.2, 0.06, PI / 2, 0, 0);
      msh(head, gCone(4), M.accent, 0, 0.2, -0.45, 0.045, 1.05, 0.2, -PI / 2 + 0.35, 0, 0);
      addEyes(ctx, head, 0.14, 0.08, 0.16, 0.05, false);
      ctx.mouth = grp(head, 0, -0.05, 1.45);
      ctx.maxJaw = 0.5;
      break;
    }
  }
}

// ---------------------------------------------------------------------
//  肢体
// ---------------------------------------------------------------------
function buildBipedLeg(ctx, body, side) {
  const { P, mats: M, F } = ctx;
  const H = P.hipH, R = P.legR;
  const hip = grp(body, side * P.hipX, 0, 0);
  const K = [0, -0.45 * H, 0.2 * H], A = [0, -0.84 * H, -0.1 * H], Ft = [0, -H, 0.03 * H];
  msh(hip, gSph(), M.main, side * R * 0.15, K[1] * 0.45, K[2] * 0.45, R * 1.2, 0.33 * H, R * 1.45, -0.42, 0, 0);
  const knee = grp(hip, K[0], K[1], K[2]);
  const KA = [A[0] - K[0], A[1] - K[1], A[2] - K[2]];
  msh(knee, gSphLo(), M.main, 0, 0, 0, R * 0.62, R * 0.62, R * 0.62);
  seg(knee, [0, 0, 0], KA, R * 0.62, R * 0.42, M.main, 7);
  const ankle = grp(knee, KA[0], KA[1], KA[2]);
  const AF = [Ft[0] - A[0], Ft[1] - A[1], Ft[2] - A[2]];
  seg(ankle, [0, 0, 0], AF, R * 0.4, R * 0.3, M.main, 6);
  const foot = grp(ankle, AF[0], AF[1], AF[2]);
  msh(foot, gBox(), M.main, 0, R * 0.13, R * 0.5, R * 0.95, R * 0.26, R * 1.4);
  for (const tx of [-1, 0, 1]) spike(foot, [tx * R * 0.34, R * 0.12, R * 1.15], [tx * 0.25, -0.3, 1], R * 0.55, R * 0.12, M.claw, 5);
  if (F.has('sickleClaw')) spike(foot, [-side * R * 0.3, R * 0.3, R * 0.75], [-side * 0.1, 1, 0.55], R * 1.0, R * 0.14, M.claw, 5);
  ctx.legs.push({ hip, knee, ankle, foot, side, front: false });
}

function buildArm(ctx, torso, side) {
  const { P, mats: M, F } = ctx;
  const a = P.armL, r = P.armR, W = P.bodyW, H = P.bodyH, L = P.bodyL;
  const sh = grp(torso, side * W * 0.62, -H * 0.15, L * 0.62);
  const E = [side * a * 0.08, -a * 0.5, a * 0.12];
  seg(sh, [0, 0, 0], E, r * 1.35, r, M.main, 6);
  const el = grp(sh, E[0], E[1], E[2]);
  const Wr = [0, -a * 0.15, a * 0.42];
  seg(el, [0, 0, 0], Wr, r, r * 0.8, M.main, 6);
  const hand = grp(el, Wr[0], Wr[1], Wr[2]);
  if (F.has('longClaws')) {
    for (let i = 0; i < 3; i++) spike(hand, [(i - 1) * r * 0.7, 0, 0], [(i - 1) * 0.14, -0.6, 0.8], a * 0.72, r * 0.42, M.horn, 5);
  } else if (F.has('thumbClaw')) {
    spike(hand, [-side * r * 0.4, 0, 0], [-side * 0.15, -0.3, 1], a * 0.42, r * 0.6, M.claw, 5);
    for (const i of [0, 1]) spike(hand, [side * r * 0.5 * i, -r * 0.3, 0], [0, -0.6, 0.8], a * 0.18, r * 0.35, M.claw, 4);
  } else {
    const n = P.claws;
    for (let i = 0; i < n; i++) spike(hand, [(i - (n - 1) / 2) * r * 0.75, 0, 0], [0, -0.6, 0.8], a * 0.18 + 0.05, r * 0.38, M.claw, 4);
  }
  if (F.has('thumbSpike')) spike(hand, [-side * r * 0.6, r * 0.2, 0], [-side * 0.35, 1, 0.35], a * 0.28, r * 0.55, M.horn, 5);
  if (F.has('feathers')) {
    for (let j = 0; j < 3; j++) {
      const u = 0.15 + j * 0.3;
      const q = spike(el, [side * r * 0.3, Wr[1] * u, Wr[2] * u], [side * 0.25, -1, -0.45], a * (0.42 - j * 0.06), r * 1.3, j % 2 ? M.accent : M.extra, 4);
      q.scale.z *= 0.3;
    }
  }
  ctx.arms.push({ sh, el, hand, side });
}

function buildQuadLeg(ctx, body, side, front) {
  const { P, mats: M } = ctx;
  const h = front ? P.frontH : P.hindH, R = front ? P.frontLegR : P.legR;
  const hip = grp(body, side * (front ? P.shX : P.hipX), front ? P.frontH - P.hindH : 0, front ? 1.2 * P.bodyL : 0);
  msh(hip, gSph(), M.main, 0, -h * 0.06, 0, R * 1.15, h * 0.26, R * 1.35);
  const K = [0, -h * 0.5, front ? -h * 0.05 : h * 0.06];
  seg(hip, [0, 0, 0], K, R * 1.05, R * 0.8, M.main, 7);
  const knee = grp(hip, K[0], K[1], K[2]);
  msh(knee, gSphLo(), M.main, 0, 0, 0, R * 0.8, R * 0.8, R * 0.8);
  const Fp = [0, -h * 0.5, -K[2]];
  seg(knee, [0, 0, 0], Fp, R * 0.8, R * 0.72, M.main, 7);
  const foot = grp(knee, Fp[0], Fp[1], Fp[2]);
  msh(foot, gCyl(8), M.main, 0, R * 0.1, R * 0.1, R * 0.95, R * 0.2, R * 1.05);
  for (const i of [-1, 0, 1]) msh(foot, gSphLo(), M.horn, i * R * 0.55, R * 0.12, R * 0.85, R * 0.2, R * 0.15, R * 0.22);
  ctx.legs.push({ hip, knee, ankle: null, foot, side, front });
}

// ---------------------------------------------------------------------
//  物种特征
// ---------------------------------------------------------------------
function buildSail(ctx, torso, sz) {
  const { P, mats: M } = ctx;
  const H = P.bodyH, L = P.bodyL;
  const zFront = sz - 0.42 * ctx.k - 0.05, zBack = -L * 0.95;
  const zc = (zFront + zBack) / 2, half = (zFront - zBack) / 2, h = 1.35, y0 = H * 0.5;
  msh(torso, gSail(), M.accent, 0, y0, zc, half, h, 0.06, 0, PI / 2, 0);
  for (let i = 0; i < 6; i++) {
    const x = -0.85 + i * 0.34;
    const z = zc - x * half;
    seg(torso, [0, y0, z], [0, y0 + h * sailTop(x) * 0.97, z - 0.04], 0.04, 0.018, M.extra, 4);
  }
}

function buildFeathers(ctx, head) {
  const { P, mats: M } = ctx;
  const H = P.headH, L = P.headL;
  for (let i = 0; i < 3; i++) {
    const q = spike(head, [0, H * 0.42, L * 0.12 - i * 0.07], [0, 0.55, -1], 0.26 - i * 0.04, 0.06, i % 2 ? M.accent : M.extra, 4);
    q.scale.x *= 0.4;
  }
  const n = 5, rE = ctx.tailEndR;
  for (let i = 0; i < n; i++) {
    const s = (i - (n - 1) / 2) / ((n - 1) / 2);
    const q = spike(ctx.tailEnd, [0, 0, rE * 2], [s * 0.45, 0.05, -1], 0.55 - Math.abs(s) * 0.12, 0.08, i % 2 ? M.accent : M.extra, 4);
    q.scale.z *= 0.35;
  }
}

function buildPlates(ctx, torso, sz) {
  const { P, mats: M } = ctx;
  const W = P.bodyW, H = P.bodyH, L = P.bodyL;
  const place = (parent, x, y, z, w, h, lean, mat) => {
    const m = msh(parent, gPlate(), mat, x, y, z, w, h, 0.07);
    m.rotation.order = 'ZYX';
    m.rotation.set(0, PI / 2, lean);
    return m;
  };
  const zs = [0.0, -0.2, -0.4, -0.6, -0.78];
  zs.forEach((u, i) => {
    for (const s of [-1, 1]) {
      const uu = u - (s > 0 ? 0.1 : 0);
      const z = uu * L;
      if (z > sz - 0.42 * ctx.k) continue;
      const f = Math.sqrt(Math.max(0.05, 1 - uu * uu));
      const hgt = 0.55 + 0.35 * Math.sin(PI * clamp01((uu + 0.95) / 1.0));
      place(torso, s * W * 0.1, H * f * 0.82, z, 0.55, hgt, -s * 0.16, i % 2 ? M.extra : M.accent);
    }
  });
  // 尾部与颈部小骨板
  for (let i = 0; i < 2 && i < ctx.tail.length; i++) {
    const tg = ctx.tail[i], len = P.tailL / P.tailN;
    for (const s of [-1, 1]) {
      const r = P.tailR * (1 - (i + 0.5) / P.tailN * 0.86);
      place(tg, s * 0.06, r * 0.75, -len * (s > 0 ? 0.3 : 0.65), 0.42 - i * 0.1, 0.5 - i * 0.15, -s * 0.18, M.accent);
    }
  }
  for (const n of ctx.neck) {
    for (const s of [-1, 1]) place(n, s * 0.05, P.neckR * 0.7, 0.2 + (s > 0 ? 0.2 : 0), 0.25, 0.28, -s * 0.15, M.accent);
  }
  // 尾刺
  const te = ctx.tailEnd;
  for (const s of [-1, 1]) {
    spike(te, [s * 0.06, 0.05, 0.12], [s * 0.9, 0.55, -0.3], 0.6, 0.07, M.horn, 5);
    spike(te, [s * 0.06, 0.05, 0.42], [s * 0.9, 0.6, -0.1], 0.55, 0.07, M.horn, 5);
  }
}

function buildArmor(ctx, torso, sz) {
  const { P, mats: M } = ctx;
  const W = P.bodyW, H = P.bodyH, L = P.bodyL;
  for (const u of [0.62, 0.3, -0.02, -0.34, -0.66]) {
    const z = u * L, f = Math.sqrt(1 - u * u);
    for (const a of [0, 0.42, 0.85, 1.25]) {
      for (const s of a === 0 ? [1] : [-1, 1]) {
        if (Math.abs(z - sz) < 0.5 * ctx.k + 0.1 && a < 0.9) continue;
        const x = s * W * f * Math.sin(a), y = H * f * Math.cos(a);
        _v.set(x / (W * W), y / (H * H), z / (L * L)).normalize();
        spike(torso, [x - _v.x * 0.03, y - _v.y * 0.03, z], [_v.x, _v.y, _v.z], 0.2, 0.13, M.accent, 4);
      }
    }
  }
  for (const u of [0.5, 0.15, -0.2, -0.55]) {
    const z = u * L, f = Math.sqrt(1 - u * u);
    for (const s of [-1, 1]) spike(torso, [s * W * f * 0.95, -H * 0.05, z], [s, -0.1, -0.25], 0.38, 0.1, M.horn, 4);
  }
  ctx.tail.forEach((tg, i) => {
    const len = P.tailL / P.tailN, r = P.tailR * (1 - (i + 0.5) / P.tailN * 0.86);
    for (const s of [-1, 1]) spike(tg, [s * r * 0.8, 0, -len * 0.5], [s, 0.1, -0.35], 0.22, 0.07, M.horn, 4);
  });
  const te = ctx.tailEnd;
  msh(te, gSph(), M.accent, 0, 0, -0.15, 0.48, 0.3, 0.42);
  for (const s of [-1, 1]) msh(te, gSphLo(), M.accent, s * 0.36, 0, -0.12, 0.2, 0.2, 0.26);
}

// ---------------------------------------------------------------------
//  体型构建
// ---------------------------------------------------------------------
function buildBiped(ctx) {
  const { P, mats: M, F } = ctx;
  const W = P.bodyW, H = P.bodyH, L = P.bodyL;
  const body = grp(ctx.rig, 0, P.hipH, 0);
  ctx.body = body; ctx.bodyRest = [0, P.hipH, 0];
  const torso = grp(body, 0, P.bodyY, P.bodyZ);
  torso.rotation.x = -P.tilt;
  ctx.torso = torso;
  ctx.torsoMeshes.push(msh(torso, gSph(), M.main, 0, 0, 0, W, H, L));
  ctx.torsoMeshes.push(msh(torso, gSph(), M.belly, 0, -H * 0.3, L * 0.04, W * 0.88, H * 0.72, L * 0.86));
  if (F.has('potBelly')) ctx.torsoMeshes.push(msh(torso, gSph(), M.belly, 0, -H * 0.36, L * 0.22, W * 1.06, H * 0.8, L * 0.7));
  const sz = P.saddleZ * L;
  addMarkings(ctx, torso, W, H, L, sz);
  const f = Math.sqrt(Math.max(0.05, 1 - (sz / L) ** 2));
  ctx.saddle = buildSaddle(ctx, torso, sz, W * f, H * f);
  const head = buildNeck(ctx, torso, [0, H * 0.3, L * 0.78],
    [{ len: P.neckL * 0.55, ang: P.neckA }, { len: P.neckL * 0.45, ang: P.neckA2 }], P.neckR, P.neckR * 0.72);
  ctx.headBase = P.tilt + P.headPitch;
  buildHead(ctx, head);
  buildTail(ctx, torso, [0, H * 0.12, -L * 0.8]);
  for (const s of [-1, 1]) buildBipedLeg(ctx, body, s);
  for (const s of [-1, 1]) buildArm(ctx, torso, s);
  if (F.has('sail')) buildSail(ctx, torso, sz);
  if (F.has('feathers')) buildFeathers(ctx, head);
  ctx.legLen = P.hipH;
  ctx.deadShift = P.hipH * 0.72;
  ctx.deadLift = W * 0.95;
  ctx.bodyHalf = L;
}

function buildQuad(ctx) {
  const { P, mats: M, F } = ctx;
  const W = P.bodyW, H = P.bodyH, L = P.bodyL;
  const hipZ = -0.6 * L;
  const body = grp(ctx.rig, 0, P.hindH, hipZ);
  ctx.body = body; ctx.bodyRest = [0, P.hindH, hipZ];
  const tilt = Math.atan2(P.frontH - P.hindH, 1.2 * L);
  P.tilt = tilt;
  const torso = grp(body, 0, (P.frontH - P.hindH) / 2 + P.bodyY, -hipZ);
  torso.rotation.x = -tilt;
  ctx.torso = torso;
  ctx.torsoMeshes.push(msh(torso, gSph(), M.main, 0, 0, 0, W, H, L));
  ctx.torsoMeshes.push(msh(torso, gSph(), M.belly, 0, -H * 0.3, 0, W * 0.9, H * 0.72, L * 0.9));
  const sz = P.saddleZ * L;
  addMarkings(ctx, torso, W, H, L, sz);
  const f = Math.sqrt(Math.max(0.05, 1 - (sz / L) ** 2));
  ctx.saddle = buildSaddle(ctx, torso, sz, W * f, H * f);
  const segs = [];
  for (let i = 0; i < P.neckN; i++) {
    const u = P.neckN > 1 ? i / (P.neckN - 1) : 0.5;
    segs.push({ len: P.neckL / P.neckN, ang: P.neckA + P.neckCurve * (0.5 - u) });
  }
  const head = buildNeck(ctx, torso, [0, H * P.neckBaseY, L * 0.84], segs, P.neckR, P.neckR * (P.neckN > 1 ? 0.55 : 0.85));
  ctx.headBase = tilt + P.headPitch;
  buildHead(ctx, head);
  buildTail(ctx, torso, [0, H * 0.22, -L * 0.84]);
  for (const s of [-1, 1]) buildQuadLeg(ctx, body, s, true);
  for (const s of [-1, 1]) buildQuadLeg(ctx, body, s, false);
  if (F.has('plates')) buildPlates(ctx, torso, sz);
  if (F.has('armor')) buildArmor(ctx, torso, sz);
  ctx.legLen = P.hindH;
  ctx.deadShift = (P.hindH + P.frontH) * 0.36;
  ctx.deadLift = W * 0.95;
  ctx.bodyHalf = L;
}

function buildPtero(ctx) {
  const { P, mats: M } = ctx;
  const W = P.bodyW, H = P.bodyH, L = P.bodyL;
  const body = grp(ctx.rig, 0, P.hover, 0);
  ctx.body = body; ctx.bodyRest = [0, P.hover, 0];
  const torso = grp(body, 0, 0, 0);
  ctx.torso = torso;
  ctx.torsoMeshes.push(msh(torso, gSph(), M.main, 0, 0, 0, W, H, L));
  ctx.torsoMeshes.push(msh(torso, gSph(), M.belly, 0, -H * 0.3, 0.05, W * 0.88, H * 0.72, L * 0.85));
  const sz = P.saddleZ * L;
  const f = Math.sqrt(1 - (sz / L) ** 2);
  ctx.saddle = buildSaddle(ctx, torso, sz, W * f, H * f);
  const head = buildNeck(ctx, torso, [0, H * 0.3, L * 0.78], [{ len: 0.6, ang: 0.8 }], 0.15, 0.11);
  ctx.headBase = 0.05;
  buildHead(ctx, head);
  buildTail(ctx, torso, [0, 0.02, -L * 0.9]);
  for (const s of [-1, 1]) {
    const sh = grp(torso, s * W * 0.72, H * 0.35, L * 0.35);
    msh(sh, gSphLo(), M.main, 0, 0, 0, 0.13, 0.13, 0.13);
    seg(sh, [0, 0, 0], [s * 1.3, 0.05, -0.1], 0.11, 0.07, M.main, 6);
    sh.add(new THREE.Mesh(gMembrane(s, 'in'), M.membrane));
    const el = grp(sh, s * 1.3, 0.05, -0.1);
    msh(el, gSphLo(), M.main, 0, 0, 0, 0.085, 0.085, 0.085);
    seg(el, [0, 0, 0], [s * 2.0, -0.02, -0.45], 0.07, 0.02, M.main, 5);
    spike(el, [0, 0, 0], [s * 0.15, 0, 1], 0.2, 0.03, M.claw, 4);
    el.add(new THREE.Mesh(gMembrane(s, 'out'), M.membrane));
    ctx.wings.push({ sh, el, side: s });
    // 后腿（悬空下垂）
    const hip = grp(torso, s * 0.18, -H * 0.45, -L * 0.55);
    seg(hip, [0, 0, 0], [0, -0.35, -0.3], 0.08, 0.05, M.main, 5);
    const knee = grp(hip, 0, -0.35, -0.3);
    seg(knee, [0, 0, 0], [0, -0.28, -0.2], 0.05, 0.035, M.main, 5);
    const foot = grp(knee, 0, -0.28, -0.2);
    for (const i of [-1, 0, 1]) spike(foot, [i * 0.04, 0, 0], [i * 0.3, -0.4, 1], 0.12, 0.02, M.claw, 4);
    ctx.legs.push({ hip, knee, ankle: null, foot, side: s, front: false });
  }
  ctx.legLen = 1;
  ctx.deadShift = 0.3;
  ctx.deadLift = W * 0.9;
  ctx.bodyHalf = 1.0;
}

// ---------------------------------------------------------------------
//  动画
// ---------------------------------------------------------------------
function makeUpdater(ctx) {
  const { def, P, kind } = ctx;
  const style = def.attack;
  const skillType = def.skill && def.skill.type;
  const sq = Math.sqrt(def.scale || 1);
  const nNeck = ctx.neck.length, nTail = ctx.tail.length;
  const neckW = nNeck === 1 ? [1] : nNeck === 2 ? [0.6, 0.4] : ctx.neck.map((_, i) => (1.2 - 0.4 * i / (nNeck - 1)) / nNeck);
  const rearAmt = kind === 'quad' ? 0.55 : 0.32;
  const legLen = ctx.legLen;
  const sickle = ctx.F.has('sickleClaw');
  const [bx, by, bz] = ctx.bodyRest;
  const torsoBase = ctx.torsoMeshes.map((m) => [m.scale.x, m.scale.y]);
  const st = { time: 0, phase: 0, moveS: 0, airS: 0, blink: 0, blinkT: 1.5 + Math.random() * 3 };

  return function update(dt, s) {
    s = s || EMPTY;
    dt = dt > 0 ? Math.min(dt, 0.1) : 0;
    st.time += dt;
    const t = typeof s.t === 'number' ? s.t : st.time;
    const move = clamp(+s.move || 0, 0, 1.8);
    const atk = typeof s.attack === 'number' && s.attack >= 0 ? Math.min(s.attack, 1) : -1;
    const sk = typeof s.skill === 'number' && s.skill >= 0 ? Math.min(s.skill, 1) : -1;
    const hurt = clamp(+s.hurt || 0, 0, 1);
    const dead = clamp(+s.dead || 0, 0, 1);
    st.moveS = damp(st.moveS, move, 6, dt);
    st.airS = damp(st.airS, s.air ? 1 : 0, 9, dt);
    const A = st.moveS, Ag = Math.min(A, 1.3), air = st.airS;
    if (kind === 'ptero') st.phase += dt * TAU * (1.2 + 0.9 * A + (s.air ? 0.6 : 0));
    else if (A > 0.02) st.phase += dt * TAU * (0.45 + 1.2 * A) / sq;
    const ph = st.phase;
    const breathe = Math.sin(t * 1.8);

    st.blinkT -= dt;
    if (st.blinkT < 0) { st.blink = 0.14; st.blinkT = 2 + Math.random() * 4; }
    if (st.blink > 0) st.blink -= dt;

    let bodyY = 0, bodyZ = 0, pitch = 0, yaw = 0, roll = 0, crouch = 0, rear = 0, rigYaw = 0;
    let neckX = 0, neckY = 0, headX = 0, headY = 0, headZ = 0, jaw = 0;
    let tailY = 0, tailX = 0, tailSway = 1, whipK = -1;
    let armX = 0, elbowX = 0, armOut = 0, chest = 0, frill = 0;
    let legStretch = 0, kick = 0, stompLeg = 0, wingSweep = 0, wingSpread = 0;

    // ---- 待机 ----
    const idle = 1 - Math.min(A, 1);
    neckX += Math.sin(t * 0.9) * 0.03;
    neckY += Math.sin(t * 0.37) * 0.16 * idle;
    headX += Math.sin(t * 0.7 + 1) * 0.03;
    headY += Math.sin(t * 0.53 + 2) * 0.06 * idle;
    armX += Math.sin(t * 1.1) * 0.05;

    // ---- 步态 ----
    if (kind === 'biped') {
      bodyY += -0.05 * Ag + 0.06 * Ag * Math.cos(2 * ph);
      roll += 0.035 * Ag * Math.sin(ph);
      pitch += 0.07 * Ag;
      neckX += -0.05 * Ag * Math.cos(2 * ph) - 0.06 * Ag;
    } else if (kind === 'quad') {
      bodyY += 0.035 * Ag * Math.cos(2 * ph);
      roll += 0.025 * Ag * Math.sin(ph);
      neckX += 0.04 * Ag * Math.sin(2 * ph);
    } else {
      bodyY += Math.sin(ph) * 0.13 - 0.04;
      pitch += 0.12 * Math.min(A, 1.2);
    }
    if (air > 0.01) { tailX += -0.12 * air; neckX += -0.08 * air; }

    // ---- 近战攻击 ----
    if (atk >= 0) {
      const a = atk;
      switch (style) {
        case 'bite': {
          const open = a < 0.35 ? smooth(a / 0.35) : a < 0.5 ? 1 - smooth((a - 0.35) / 0.15) : 0;
          const lunge = a < 0.35 ? -0.35 * smooth(a / 0.35) : a < 0.55 ? lerp(-0.35, 1, smooth((a - 0.35) / 0.2)) : 1 - smooth((a - 0.55) / 0.45);
          jaw = Math.max(jaw, open);
          neckX += lunge * 0.28; headX += -open * 0.3 + lunge * 0.1;
          bodyZ += lunge * 0.3; pitch += lunge * 0.1;
          break;
        }
        case 'horn': {
          const lower = a < 0.35 ? smooth(a / 0.35) : 1 - smooth((a - 0.35) / 0.5);
          const thrust = bump(a, 0.3, 0.75);
          neckX += lower * 0.45 - thrust * 0.5; headX += lower * 0.35 - thrust * 0.45;
          bodyZ += thrust * 0.55; pitch += lower * 0.1 - thrust * 0.08; crouch += lower * 0.15;
          break;
        }
        case 'claw': {
          const raise = a < 0.35 ? smooth(a / 0.35) : a < 0.5 ? 1 - smooth((a - 0.35) / 0.15) : 0;
          const swipe = a < 0.35 ? 0 : a < 0.5 ? smooth((a - 0.35) / 0.15) : 1 - smooth((a - 0.5) / 0.5);
          armX += -1.6 * raise + 0.7 * swipe; elbowX += -0.5 * raise - 0.3 * swipe; armOut += 0.25 * raise;
          bodyZ += swipe * 0.35; pitch += swipe * 0.12 - raise * 0.1; neckX += swipe * 0.15;
          jaw = Math.max(jaw, raise * 0.5);
          if (sickle) kick = swipe;
          break;
        }
        case 'tail': {
          const sw = a < 0.3 ? 0.6 * smooth(a / 0.3) : a < 0.55 ? lerp(0.6, -1.25, smooth((a - 0.3) / 0.25)) : -1.25 * (1 - smooth((a - 0.55) / 0.45));
          tailY += sw; rigYaw += -sw * 0.45; yaw += sw * 0.15; neckY += -sw * 0.2;
          break;
        }
        case 'stomp': {
          const r = a < 0.45 ? smooth(a / 0.45) : a < 0.6 ? 1 - smooth((a - 0.45) / 0.15) : 0;
          if (kind === 'biped') stompLeg = r; else rear += r * 0.7;
          neckX += -r * 0.2; jaw = Math.max(jaw, r * 0.5);
          break;
        }
        case 'peck': {
          const j = a < 0.3 ? -0.3 * smooth(a / 0.3) : a < 0.5 ? lerp(-0.3, 1, smooth((a - 0.3) / 0.2)) : 1 - smooth((a - 0.5) / 0.5);
          neckX += j * 0.55; headX += j * 0.25; bodyZ += j * 0.2;
          jaw = Math.max(jaw, bump(a, 0.15, 0.5) * 0.8);
          break;
        }
        case 'headbutt': {
          const lower = a < 0.35 ? smooth(a / 0.35) : a < 0.55 ? 1 : 1 - smooth((a - 0.55) / 0.45);
          const lunge = bump(a, 0.35, 0.8);
          neckX += lower * 0.45; headX += lower * 0.45; bodyZ += lunge * 0.7; pitch += lower * 0.14; crouch += lower * 0.12;
          break;
        }
      }
    }

    // ---- 技能 ----
    if (sk >= 0) {
      const k = sk;
      const env = smooth(k / 0.15) * (1 - smooth((k - 0.8) / 0.2));
      switch (skillType) {
        case 'roar':
          neckX += -0.5 * env; headX += -0.35 * env; jaw = Math.max(jaw, env);
          headZ += Math.sin(t * 47) * 0.05 * env; headY += Math.sin(t * 31) * 0.05 * env;
          pitch += -0.1 * env; armX += -0.6 * env; armOut += 0.3 * env; chest += env;
          break;
        case 'charge':
          neckX += 0.45 * env; headX += 0.35 * env; pitch += 0.12 * env; crouch += 0.1 * env; tailSway *= 1 - 0.7 * env;
          break;
        case 'pounce': {
          const c = bump(k, 0, 0.3);
          const str = smooth((k - 0.2) / 0.15) * (1 - smooth((k - 0.75) / 0.2));
          crouch += c * 0.45; legStretch = str; armX += -1.3 * str; jaw = Math.max(jaw, str * 0.9);
          neckX += 0.25 * str; pitch += 0.15 * str - 0.1 * c; tailX += -0.15 * str; tailSway *= 1 - 0.6 * str;
          break;
        }
        case 'spin':
          tailSway *= 1 - 0.8 * env; tailX += -0.1 * env; neckX += 0.25 * env; crouch += 0.12 * env; armX += 0.4 * env;
          break;
        case 'stomp': {
          const r = k < 0.5 ? smooth(k / 0.5) : k < 0.62 ? 1 - smooth((k - 0.5) / 0.12) : 0;
          rear += r; jaw = Math.max(jaw, r * 0.8); neckX += -0.35 * r; armX += -0.8 * r;
          break;
        }
        case 'frenzy':
          jaw = Math.max(jaw, (0.5 + 0.5 * Math.sin(t * 24)) * 0.9 * env);
          headY += Math.sin(t * 17) * 0.18 * env; neckX += 0.15 * env; armX += Math.sin(t * 20) * 0.8 * env;
          break;
        case 'fortress':
          crouch += 0.8 * env; neckX += 0.35 * env; headX += 0.25 * env; tailY += 0.6 * env; tailSway *= 1 - 0.8 * env;
          break;
        case 'dive': {
          const sw = smooth(k / 0.2) * (1 - smooth((k - 0.75) / 0.12));
          wingSweep = sw; wingSpread = bump(k, 0.75, 1.0);
          pitch += 0.75 * sw; neckX += 0.3 * sw; jaw = Math.max(jaw, wingSpread * 0.6);
          break;
        }
        case 'sonic':
          neckX += -0.35 * env; headX += -0.3 * env; jaw = Math.max(jaw, 0.7 * env); chest += env;
          headZ += Math.sin(t * 40) * 0.03 * env;
          break;
        case 'venom': {
          frill = env; jaw = Math.max(jaw, 0.95 * env);
          const sp = bump(k, 0.35, 0.65);
          neckX += sp * 0.35 - 0.2 * env; bodyZ += sp * 0.25;
          break;
        }
        case 'wave':
          whipK = k; rigYaw += -0.25 * bump(k, 0.25, 0.7); neckY += 0.2 * env;
          break;
        case 'spikes': {
          const c = bump(k, 0, 0.45), pop = bump(k, 0.4, 0.7);
          crouch += c * 0.3; neckX += 0.4 * env; headZ += Math.sin(t * 38) * 0.12 * c; pitch += -pop * 0.15;
          break;
        }
        case 'sprint':
          pitch += 0.18 * env; neckX += 0.55 * env; armX += 0.6 * env; tailSway *= 1 - 0.6 * env; tailX += -0.08 * env;
          break;
      }
    }

    // ---- 受击 / 死亡 ----
    if (hurt > 0) {
      pitch += -0.14 * hurt; neckX += -0.25 * hurt; jaw = Math.max(jaw, 0.4 * hurt);
      headZ += Math.sin(t * 50) * 0.08 * hurt; bodyZ -= 0.15 * hurt;
    }
    const e = smooth(dead);
    if (e > 0) {
      neckX += 0.45 * e; jaw = Math.max(jaw, 0.35 * e); tailSway *= 1 - e;
      if (kind === 'ptero') bodyY += -(P.hover - 0.45) * e;
    }

    // ================= 应用 =================
    const cr = crouch * (kind === 'quad' ? 0.18 : 0.26) * legLen;
    ctx.body.position.set(bx, by + bodyY - cr, bz + bodyZ);
    const pTot = pitch - rear * rearAmt;
    ctx.body.rotation.set(pTot, yaw, roll);

    const bs = 1 + 0.015 * breathe + 0.06 * chest;
    for (let i = 0; i < ctx.torsoMeshes.length; i++) {
      const m = ctx.torsoMeshes[i];
      m.scale.x = torsoBase[i][0] * bs;
      m.scale.y = torsoBase[i][1] * bs;
    }

    for (let i = 0; i < nNeck; i++) {
      const n = ctx.neck[i];
      n.rotation.x = neckX * neckW[i];
      n.rotation.y = neckY / nNeck;
    }
    ctx.head.rotation.set(ctx.headBase + headX, headY, headZ);
    if (ctx.jaw) ctx.jaw.rotation.x = clamp01(jaw) * ctx.maxJaw;
    if (ctx.frill) {
      const fs = lerp(0.18, 1, frill) + 0.04 * frill * Math.sin(t * 30);
      ctx.frill.scale.set(fs, fs, 1);
    }

    const swayAmp = (0.07 * (1 - 0.5 * Math.min(A, 1))) * tailSway;
    for (let i = 0; i < nTail; i++) {
      const g = ctx.tail[i];
      let ry = swayAmp * Math.sin(t * 1.3 - i * 0.7) + 0.1 * Ag * tailSway * Math.sin(ph - i * 0.8) + tailY * 1.4 / nTail;
      if (whipK >= 0) {
        const ki = whipK - i * 0.04;
        const w = ki < 0 ? 0 : ki < 0.35 ? 0.9 * smooth(ki / 0.35) : ki < 0.5 ? lerp(0.9, -1.2, smooth((ki - 0.35) / 0.15)) : -1.2 * (1 - smooth((ki - 0.5) / 0.5));
        ry += w * 0.35;
      }
      const rx = -0.02 + 0.03 * Math.sin(t * 0.9 - i * 0.8) + tailX / nTail * 1.5 + 0.08 * e;
      g.rotation.set(rx, ry * (1 - e), 0);
    }

    for (let i = 0; i < ctx.legs.length; i++) {
      const lg = ctx.legs[i];
      let hx, kx;
      if (kind === 'ptero') {
        hx = 0.35 + 0.1 * Math.sin(t * 2 + lg.side) - 0.3 * wingSpread;
        kx = 0.3 + 0.1 * Math.sin(t * 2.3 + lg.side);
        lg.hip.rotation.x = hx; lg.knee.rotation.x = kx;
        continue;
      }
      const lp = ph + (kind === 'quad' ? (lg.front === (lg.side < 0) ? 0 : PI) : (lg.side > 0 ? PI : 0));
      const sw = Math.sin(lp), lift = Math.max(0, Math.cos(lp));
      hx = -sw * (kind === 'quad' ? 0.42 : 0.55) * Ag;
      kx = lift * (kind === 'quad' ? 0.7 : 0.9) * Ag;
      hx += -crouch * 0.5; kx += crouch;
      const comp = kind === 'quad' && lg.front ? pitch : pTot;
      hx -= comp;
      if (lg.front && rear > 0) { hx += -rear * 0.5; kx += rear * 0.9; }
      if (stompLeg > 0 && lg.side > 0) { hx += -stompLeg * 0.8; kx += stompLeg * 1.1; }
      if (kick > 0 && lg.side > 0) { hx += -kick * 1.1; kx += kick * 0.3; }
      if (legStretch > 0) { hx += legStretch * 0.9; kx += -legStretch * 0.3; }
      hx = lerp(hx, -0.5 - comp, air); kx = lerp(kx, 1.1, air);
      hx = lerp(hx, lg.front ? -0.35 : -0.2, e); kx = lerp(kx, 0.15, e);
      lg.hip.rotation.x = hx;
      lg.knee.rotation.x = kx;
      const footX = -(comp + hx + kx) + (kind === 'quad' ? 0 : lift * 0.3 * Ag);
      if (lg.ankle) lg.ankle.rotation.x = footX;
      else lg.foot.rotation.x = footX;
    }

    for (let i = 0; i < ctx.arms.length; i++) {
      const ar = ctx.arms[i];
      const swing = Math.sin(ph + (ar.side > 0 ? 0 : PI)) * 0.25 * Ag;
      ar.sh.rotation.x = armX + swing - 0.4 * air - 0.6 * e;
      ar.sh.rotation.z = ar.side * (0.05 + armOut);
      ar.el.rotation.x = elbowX - 0.4 * air;
    }

    for (let i = 0; i < ctx.wings.length; i++) {
      const w = ctx.wings[i];
      const amp = (0.6 + 0.2 * Math.min(A, 1.5)) * (1 - wingSweep) * (1 - e);
      let fl = 0.08 + Math.sin(ph) * amp;
      fl = lerp(fl, -0.3, wingSweep * 0.8);
      fl = lerp(fl, 0.3, wingSpread);
      fl = lerp(fl, -0.45, e);
      w.sh.rotation.set(0, w.side * 0.95 * wingSweep, w.side * fl);
      w.el.rotation.set(0, w.side * 0.55 * wingSweep, w.side * (Math.sin(ph - 0.9) * amp * 0.55 - 0.05 - 0.3 * e));
    }

    const eyeOpen = e > 0.5 ? 0.12 : st.blink > 0 ? 0.12 : 1;
    for (let i = 0; i < ctx.eyes.length; i++) {
      const m = ctx.eyes[i];
      m.scale.y = m.userData.sy * eyeOpen;
    }

    ctx.rig.rotation.set(0, rigYaw, e * 1.45);
    ctx.rig.position.set(e * ctx.deadShift, e * ctx.deadLift, 0);
  };
}

// ---------------------------------------------------------------------
//  入口
// ---------------------------------------------------------------------
export function createDinoModel(def) {
  const scale = def.scale || 1;
  const kind = def.body === 'pterosaur' ? 'ptero'
    : (def.body === 'theropod' || def.body === 'ornithopod') ? 'biped' : 'quad';
  const base = kind === 'ptero' ? PTERO : kind === 'biped' ? BIPED : QUAD;
  const P = Object.assign({}, base, SPECIES[def.id] || {});
  const root = new THREE.Group();
  root.name = 'dino-' + def.id;
  const rig = grp(root);
  const ctx = {
    def, P, kind, root, rig,
    F: new Set(def.features || []),
    mats: makeMats(def),
    k: 1 / scale, // 鞍具部件按世界尺寸保持一致
    neck: [], tail: [], legs: [], arms: [], wings: [], eyes: [], torsoMeshes: [],
    body: null, torso: null, head: null, jaw: null, frill: null, mouth: null, saddle: null,
    headBase: 0, maxJaw: 0.7,
  };
  if (kind === 'biped') buildBiped(ctx);
  else if (kind === 'quad') buildQuad(ctx);
  else buildPtero(ctx);
  if (!ctx.mouth) ctx.mouth = grp(ctx.head, 0, 0, P.headL);

  root.scale.setScalar(scale);
  const update = makeUpdater(ctx);
  update(0, EMPTY);
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root, true);
  const dims = box.getSize(new THREE.Vector3());
  const seat = ctx.saddle.getWorldPosition(new THREE.Vector3());
  const size = {
    height: seat.y,
    length: dims.z,
    radius: Math.max(ctx.bodyHalf * scale, P.bodyW * scale * 1.1),
    top: box.max.y,
    width: dims.x,
  };
  root.userData.dinoId = def.id;
  return { root, saddle: ctx.saddle, mouth: ctx.mouth, size, update };
}
