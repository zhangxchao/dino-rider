// =====================================================================
//  首领模型（程序化低多边形）
//  export createBossModel(type, def) —— 契约见 CONTRACTS.md §3
//  root 原点在地面、面朝 +Z；每次调用新建材质；update(dt, s) 无逐帧分配。
//  s = { t, move, attack(-1|0..1), pattern, hurt, dead, phase(1..3), burrow(0..1) }
// =====================================================================
import * as THREE from 'three';

const PI = Math.PI;
const TAU = PI * 2;

// ---------------------------------------------------------------------
//  通用工具
// ---------------------------------------------------------------------
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (x) => x * x * (3 - 2 * x);
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// 蓄力：0 → 0.6 渐强，0.6 之后迅速释放
function windup(a) {
  if (a < 0) return 0;
  if (a < 0.6) return smooth(a / 0.6);
  return Math.max(0, 1 - (a - 0.6) / 0.12);
}
// 出招：0.6 之后迅速到位，再缓慢回收
function strike(a) {
  if (a < 0.6) return 0;
  if (a < 0.72) return smooth((a - 0.6) / 0.12);
  return Math.max(0, 1 - (a - 0.72) / 0.28);
}

function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// 几何体缓存（可在实例间共享）
const _geo = new Map();
function cached(key, make) {
  let g = _geo.get(key);
  if (!g) { g = make(); _geo.set(key, g); }
  return g;
}
const G = {
  sphere: (w = 12, h = 9) => cached(`s${w}.${h}`, () => new THREE.SphereGeometry(1, w, h)),
  box: () => cached('b', () => new THREE.BoxGeometry(1, 1, 1)),
  // 肢体：y=0 处半径 1，y=1 处半径 top
  limb: (top = 0.8, seg = 8) => cached(`l${top}.${seg}`, () => {
    const g = new THREE.CylinderGeometry(top, 1, 1, seg, 1);
    g.translate(0, 0.5, 0);
    return g;
  }),
  // 居中圆柱（轴向 Y）
  cyl: (top = 1, seg = 12) => cached(`c${top}.${seg}`, () => new THREE.CylinderGeometry(top, 1, 1, seg, 1)),
  // 圆锥：底面在 y=0，尖端在 y=1
  cone: (seg = 8) => cached(`k${seg}`, () => {
    const g = new THREE.ConeGeometry(1, 1, seg, 1);
    g.translate(0, 0.5, 0);
    return g;
  }),
  ico: (d = 0) => cached(`i${d}`, () => new THREE.IcosahedronGeometry(1, d)),
  dode: () => cached('d', () => new THREE.DodecahedronGeometry(1, 0)),
  octa: () => cached('o', () => new THREE.OctahedronGeometry(1, 0)),
  torus: (tube = 0.2, rs = 6, ts = 16) => cached(`t${tube}.${rs}.${ts}`, () => new THREE.TorusGeometry(1, tube, rs, ts)),
};

function mat(color, o = {}) {
  const opacity = o.opacity ?? 1;
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: o.rough ?? 0.75,
    metalness: o.metal ?? 0.05,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.ei ?? 1,
    transparent: opacity < 1,
    opacity,
    side: o.side ?? THREE.FrontSide,
    depthWrite: o.depthWrite ?? true,
  });
}
const shade = (c, dl = 0, ds = 0, dh = 0) => new THREE.Color(c).offsetHSL(dh, ds, dl);
const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);

function grp(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
function add(parent, geometry, material, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

// 沿方向 d 贴在椭球表面（c 中心, s 半轴），axis 对齐表面法线，可绕法线扭转
function onSurf(parent, geometry, material, c, s, d, sc, lift = 0, axis = AX_Z, twist = 0) {
  _v.set(d[0], d[1], d[2]).normalize();
  const tt = 1 / Math.sqrt((_v.x / s[0]) ** 2 + (_v.y / s[1]) ** 2 + (_v.z / s[2]) ** 2);
  const px = _v.x * tt, py = _v.y * tt, pz = _v.z * tt;
  _n.set(px / (s[0] * s[0]), py / (s[1] * s[1]), pz / (s[2] * s[2])).normalize();
  const m = add(parent, geometry, material,
    c[0] + px + _n.x * lift, c[1] + py + _n.y * lift, c[2] + pz + _n.z * lift, sc[0], sc[1], sc[2]);
  m.quaternion.setFromUnitVectors(axis, _n);
  if (twist) m.rotateOnAxis(axis, twist);
  return m;
}

// 尖刺/晶体：从点 p 沿方向 d 伸出，长度 len。octa=true 使用八面体（居中几何）
function spike(parent, geometry, material, px, py, pz, dx, dy, dz, w, len, octa = false) {
  _v.set(dx, dy, dz).normalize();
  const m = octa
    ? add(parent, geometry, material, px + _v.x * len * 0.5, py + _v.y * len * 0.5, pz + _v.z * len * 0.5, w, len * 0.5, w)
    : add(parent, geometry, material, px, py, pz, w, len, w);
  m.quaternion.setFromUnitVectors(AX_Y, _v);
  return m;
}

// 两点之间的骨骼（肢体几何沿 +Y）
function boneBetween(parent, geometry, material, ax, ay, az, bx, by, bz, r) {
  _v.set(bx - ax, by - ay, bz - az);
  const len = _v.length();
  const m = add(parent, geometry, material, ax, ay, az, r, len, r);
  m.quaternion.setFromUnitVectors(AX_Y, _v.normalize());
  return m;
}

// ---------------------------------------------------------------------
//  1. 剧毒蛛后
// ---------------------------------------------------------------------
function buildSpider(def) {
  const main = def.color ?? 0x3a2a4a;
  const glow = def.projColor ?? 0x9cff3a;
  const mBody = mat(main, { rough: 0.5, metal: 0.15 });
  const mDark = mat(shade(main, -0.08), { rough: 0.7 });
  const mLeg = mat(shade(main, 0.05, 0.05), { rough: 0.5, metal: 0.1 });
  const mBand = mat(mix(main, glow, 0.35), { rough: 0.6 });
  const mGlow = mat(glow, { emissive: glow, ei: 1.6, rough: 0.4 });
  const mEye = mat(0xff4030, { emissive: 0xff2010, ei: 2.5, rough: 0.2 });
  const mFang = mat(0x141018, { rough: 0.25, metal: 0.4 });
  const mHair = mat(shade(main, -0.12), { rough: 0.9 });

  const root = new THREE.Group();
  const rig = grp(root);
  const BODY_Y = 2.0;
  const body = grp(rig, 0, BODY_Y, 1.0);

  // 头胸部
  add(body, G.sphere(12, 9), mBody, 0, 0, 0.35, 1.25, 0.8, 1.35);
  add(body, G.sphere(10, 6), mDark, 0, -0.32, 0.35, 1.05, 0.5, 1.15);
  for (let i = 0; i < 3; i++) {
    add(body, G.cone(5), mHair, 0, 0.64 - i * 0.04, 0.95 - i * 0.5, 0.11, 0.42 - i * 0.06, 0.11, -0.4, 0, 0);
  }

  // 头部 + 眼簇 + 螯肢毒牙
  const head = grp(body, 0, 0.12, 1.55);
  add(head, G.sphere(10, 8), mBody, 0, 0, 0, 0.82, 0.66, 0.78);
  const EYES = [[0.26, 0.22, 0.62, 0.17], [0.52, 0.3, 0.44, 0.11], [0.15, 0.46, 0.5, 0.1], [0.66, 0.08, 0.3, 0.09]];
  for (let i = 0; i < EYES.length; i++) {
    const [x, y, z, r] = EYES[i];
    add(head, G.sphere(8, 6), mEye, x, y, z, r);
    add(head, G.sphere(8, 6), mEye, -x, y, z, r);
  }
  const chel = [];
  for (const sd of [-1, 1]) {
    const c = grp(head, sd * 0.26, -0.28, 0.5);
    add(c, G.sphere(8, 6), mDark, 0, -0.2, 0.12, 0.24, 0.4, 0.26);
    const f = grp(c, 0, -0.5, 0.2);
    add(f, G.cone(6), mFang, 0, 0, 0, 0.1, 0.62, 0.1, PI, 0, sd * 0.3);
    add(f, G.sphere(6, 4), mGlow, -sd * 0.18, -0.64, 0, 0.06);
    chel.push({ g: c, sd });
  }
  const palps = [];
  for (const sd of [-1, 1]) {
    const p = grp(head, sd * 0.42, -0.2, 0.5);
    p.rotation.set(1.2, 0, -sd * 0.35);
    add(p, G.limb(0.7, 6), mLeg, 0, 0, 0, 0.09, 0.55, 0.09);
    const p2 = grp(p, 0, 0.55, 0);
    p2.rotation.x = 1.0;
    add(p2, G.limb(0.5, 6), mBand, 0, 0, 0, 0.07, 0.5, 0.07);
    palps.push({ g: p, sd });
  }

  // 腹部（发光斑纹 + 刚毛 + 纺器）
  const abd = grp(body, 0, 0.3, -0.85);
  const abdC = grp(abd, 0, 0.5, -1.65);
  const AS = [1.5, 1.25, 1.8];
  add(abdC, G.sphere(14, 10), mBody, 0, 0, 0, AS[0], AS[1], AS[2]);
  const MARKS = [
    [0, 1, 0.55, 0.3, 0.42], [0, 1, 0.1, 0.24, 0.36], [0, 1, -0.35, 0.3, 0.44], [0, 0.8, -0.8, 0.22, 0.34],
    [0.55, 1, 0.35, 0.16, 0.3], [-0.55, 1, 0.35, 0.16, 0.3],
    [0.75, 0.9, -0.2, 0.17, 0.32], [-0.75, 0.9, -0.2, 0.17, 0.32],
    [0.6, 0.7, -0.75, 0.15, 0.28], [-0.6, 0.7, -0.75, 0.15, 0.28],
  ];
  for (let i = 0; i < MARKS.length; i++) {
    const [x, y, z, w, l] = MARKS[i];
    onSurf(abdC, G.sphere(8, 6), mGlow, [0, 0, 0], AS, [x, y, z], [w, l, 0.06], 0);
  }
  for (let j = 0; j < 8; j++) {
    const ang = (j / 8) * TAU + 0.2;
    if (Math.sin(ang) > 0.75) continue;
    onSurf(abdC, G.cone(5), mHair, [0, 0, 0], AS, [Math.cos(ang), 0.25, Math.sin(ang)], [0.08, 0.45, 0.08], -0.05, AX_Y);
  }
  for (const sd of [-1, 1]) {
    onSurf(abdC, G.cone(6), mBand, [0, 0, 0], AS, [sd * 0.12, -0.15, -1], [0.14, 0.35, 0.14], -0.05, AX_Y);
  }

  // 八条腿（股节 + 胫节），三角步态交替
  const legs = [];
  const LEG_Z = [1.05, 0.55, 0.05, -0.45];
  const LEG_A = [0.95, 0.35, -0.25, -0.85];
  const L1 = 2.2, L2 = 3.7;
  for (let i = 0; i < 4; i++) {
    for (const sd of [1, -1]) {
      const hip = grp(body, sd * 0.95, 0.05, LEG_Z[i]);
      const baseYaw = sd > 0 ? -LEG_A[i] : PI + LEG_A[i];
      hip.rotation.y = baseYaw;
      add(hip, G.sphere(8, 6), mDark, 0, 0, 0, 0.3);
      const femur = grp(hip);
      add(femur, G.limb(0.75, 7), mLeg, 0, 0, 0, 0.2, L1, 0.2, 0, 0, -PI / 2);
      add(femur, G.cone(5), mHair, L1 * 0.55, 0.12, 0, 0.07, 0.35, 0.07);
      const knee = grp(femur, L1, 0, 0);
      add(knee, G.sphere(8, 6), mBand, 0, 0, 0, 0.21);
      add(knee, G.limb(0.35, 7), mLeg, 0, 0, 0, 0.16, L2, 0.16, 0, 0, -PI / 2);
      add(knee, G.cone(5), mFang, L2 - 0.05, 0, 0, 0.06, 0.3, 0.06, 0, 0, -PI / 2);
      legs.push({ hip, femur, knee, baseYaw, sd, i, gait: (i + (sd > 0 ? 0 : 1)) & 1 });
    }
  }

  const muzzle = grp(head, 0, -0.15, 0.85);

  const P = { rear: 0, front: 0, by: 0, fang: 0.1, abd: 0, glow: 0, splay: 0 };
  let phase = 0;

  function update(dt, s) {
    dt = fin(dt, 0);
    const t = fin(s.t, 0), mv = clamp(fin(s.move, 0), 0, 2);
    const a = fin(s.attack, -1), hurt = clamp(fin(s.hurt, 0), 0, 1), dead = clamp(fin(s.dead, 0), 0, 1);
    const w = windup(a), k = strike(a);
    let rear = 0, front = 0, by = 0, fang = 0.1 + 0.08 * Math.sin(t * 2.3), abdL = 0, glowB = 0, splay = 0;
    switch (a >= 0 ? s.pattern : null) {
      case 'slam':
        rear = 0.45 * w - 0.2 * k; front = 1.3 * w - 0.25 * k; by = 0.25 * w - 0.45 * k; fang = 0.6 * w + 0.3 * k;
        break;
      case 'volley':
        abdL = 0.95 * w + 0.55 * k; glowB = 1.2 * w + 1.8 * k; rear = -0.08 * w; fang = 0.3 * w; by = -0.15 * w;
        break;
      case 'summon':
        by = -0.45 * w - 0.3 * k; glowB = 1.5 * w + 2 * k; splay = w + k; abdL = 0.3 * w; fang = 0.4;
        break;
      case 'charge':
        by = -0.3 * (w + k); rear = 0.12 * w - 0.1 * k; front = 0.5 * k; fang = w + k;
        break;
      case null: case undefined:
        break;
      default:
        fang = w + k; rear = 0.3 * w - 0.12 * k; front = 0.5 * w; glowB = 0.5 * w + k;
    }
    rear += hurt * 0.3;
    P.rear = damp(P.rear, rear, 14, dt);
    P.front = damp(P.front, front, 14, dt);
    P.by = damp(P.by, by, 12, dt);
    P.fang = damp(P.fang, fang, 16, dt);
    P.abd = damp(P.abd, abdL, 10, dt);
    P.glow = damp(P.glow, glowB, 10, dt);
    P.splay = damp(P.splay, splay, 10, dt);

    phase += dt * (1.2 + 6.5 * Math.min(mv, 1.5)) * (1 - dead);
    const g = Math.min(mv, 1) * (1 - dead);

    body.position.y = BODY_Y + P.by + Math.sin(phase * 2) * 0.06 * g + Math.sin(t * 1.8) * 0.03 - dead * 1.5;
    body.rotation.x = -P.rear + dead * 0.08;
    body.rotation.z = Math.sin(phase) * 0.03 * g + hurt * Math.sin(t * 50) * 0.05 + dead * 0.12;
    abd.rotation.x = 0.05 + P.abd + Math.sin(t * 1.5) * 0.03 - dead * 0.15;
    const pulse = 1 + Math.sin(t * 2) * 0.02 + P.glow * 0.03 * Math.sin(t * 22);
    abdC.scale.set(pulse, pulse, pulse);

    for (let i = 0; i < chel.length; i++) {
      const c = chel[i];
      c.g.rotation.z = c.sd * 0.45 * P.fang;
      c.g.rotation.x = -0.4 * P.fang;
    }
    for (let i = 0; i < palps.length; i++) {
      const p = palps[i];
      p.g.rotation.x = 1.2 + Math.sin(t * 3 + i) * 0.1 - P.fang * 0.4;
    }

    for (let i = 0; i < legs.length; i++) {
      const L = legs[i];
      const ph = phase + L.gait * PI;
      const lift = Math.max(0, Math.sin(ph)) * 0.32 * g;
      const swing = Math.cos(ph) * 0.22 * g;
      let alpha = 0.75 + lift, beta = 2.0 + lift * 0.4, yaw = L.baseYaw - L.sd * swing;
      if (L.i === 0) { alpha += P.front; beta -= P.front * 0.6; }
      else if (L.i === 1) { alpha += P.front * 0.35; }
      alpha -= P.splay * 0.3; beta -= P.splay * 0.3;
      alpha += dead * 0.7; beta += dead * 0.9;
      L.hip.rotation.y = yaw;
      L.femur.rotation.z = alpha;
      L.knee.rotation.z = -beta;
    }

    const fade = 1 - dead * 0.85;
    mGlow.emissiveIntensity = (1.3 + 0.45 * Math.sin(t * 3) + P.glow * 2) * fade;
    mEye.emissiveIntensity = (2.2 + P.glow + 0.3 * Math.sin(t * 5)) * fade;
  }

  return { root, rig, muzzle, update };
}

// ---------------------------------------------------------------------
//  2. 沙海巨蠕
// ---------------------------------------------------------------------
function buildSandworm(def) {
  const main = def.color ?? 0xc09060;
  const glow = def.projColor ?? 0xffc04a;
  const mSkin = mat(main, { rough: 0.8 });
  const mRidge = mat(shade(main, -0.12, 0.05), { rough: 0.85 });
  const mBelly = mat(shade(main, 0.1, -0.05), { rough: 0.7 });
  const mSpike = mat(shade(main, -0.25), { rough: 0.6 });
  const mMouth = mat(0x3a0c0a, { rough: 0.9 });
  const mFlesh = mat(0x8a2a24, { rough: 0.6 });
  const mTooth = mat(0xf2e8cc, { rough: 0.35 });
  const mThroat = mat(glow, { emissive: glow, ei: 2.2 });
  const mSand = mat(shade(main, 0.08, -0.1), { rough: 1 });

  const root = new THREE.Group();

  // 沙丘隆起（潜地时仍保留，提示位置）
  const mound = grp(root);
  add(mound, G.sphere(14, 6), mSand, 0, -0.35, 0, 3.4, 1.0, 3.4);
  const R = rng(7);
  for (let i = 0; i < 9; i++) {
    const ang = (i / 9) * TAU + R() * 0.4;
    const r = 2.8 + R() * 1.3;
    add(mound, G.dode(), i % 3 ? mSand : mRidge, Math.cos(ang) * r, 0.05, Math.sin(ang) * r,
      0.3 + R() * 0.35, 0.2 + R() * 0.25, 0.3 + R() * 0.3, R() * 3, R() * 3, 0);
  }

  const rig = grp(root);
  const N = 10, SEG = 0.8;
  const REST = [-0.2, -0.16, -0.1, 0.0, 0.14, 0.26, 0.32, 0.34, 0.3, 0.22];
  const segs = [];
  let prev = null;
  for (let i = 0; i < N; i++) {
    const g = i === 0 ? grp(rig, 0, -1.6, -0.9) : grp(prev, 0, SEG, 0);
    const r = 1.5 - i * 0.024;
    add(g, G.sphere(12, 8), mSkin, 0, SEG * 0.5, 0, r, SEG * 0.68, r);
    add(g, G.torus(0.16, 5, 14), mRidge, 0, SEG * 0.98, 0, r * 0.95, r * 0.95, r * 0.95, PI / 2, 0, 0);
    add(g, G.sphere(8, 5), mBelly, 0, SEG * 0.5, r * 0.62, r * 0.55, SEG * 0.5, r * 0.4);
    add(g, G.cone(5), mSpike, 0, SEG * 0.5, -r * 0.9, 0.18, 0.55, 0.18, -PI / 2, 0, 0);
    g.rotation.x = REST[i];
    segs.push(g);
    prev = g;
  }

  // 头部：口朝本地 +Z（每帧抵消脊柱弯曲，保持朝前）
  const head = grp(prev, 0, SEG, 0);
  add(head, G.cyl(1.05, 12), mSkin, 0, 0, 0.35, 1.5, 1.1, 1.5, PI / 2, 0, 0);
  add(head, G.torus(0.22, 6, 16), mRidge, 0, 0, 0.9, 1.45);
  add(head, G.cyl(1, 14), mMouth, 0, 0, 0.3, 1.3, 0.1, 1.3, PI / 2, 0, 0);
  const throat = add(head, G.sphere(10, 8), mThroat, 0, 0, 0.15, 0.6, 0.6, 0.35);
  for (let ring = 0; ring < 2; ring++) {
    const n = ring ? 10 : 13, rr = ring ? 0.95 : 1.25, zz = ring ? 0.45 : 0.8, len = ring ? 0.45 : 0.6;
    for (let j = 0; j < n; j++) {
      const ang = ((j + ring * 0.5) / n) * TAU;
      spike(head, G.cone(5), mTooth, Math.cos(ang) * rr, Math.sin(ang) * rr, zz,
        -Math.cos(ang), -Math.sin(ang), -0.35, 0.1, len);
    }
  }
  const flaps = [];
  for (let j = 0; j < 5; j++) {
    const ang = (j / 5) * TAU + PI / 2;
    const pivot = grp(head, Math.cos(ang) * 1.4, Math.sin(ang) * 1.4, 0.95);
    pivot.rotation.z = ang - PI / 2;
    const hinge = grp(pivot);
    add(hinge, G.sphere(8, 6), mSkin, 0, 0, 0.8, 0.75, 0.16, 0.95);
    add(hinge, G.sphere(6, 4), mFlesh, 0, -0.09, 0.75, 0.6, 0.08, 0.8);
    add(hinge, G.cone(5), mRidge, 0, 0, 1.6, 0.2, 0.5, 0.12, PI / 2, 0, 0);
    for (let q = -1; q <= 1; q++) add(hinge, G.cone(4), mTooth, q * 0.35, -0.12, 0.95, 0.07, 0.35, 0.07, PI, 0, 0);
    flaps.push(hinge);
  }
  const muzzle = grp(head, 0, 0, 1.3);

  const P = { mouth: 0.2, pitch: 0.25, bend: 0, sway: 1 };

  function update(dt, s) {
    dt = fin(dt, 0);
    const t = fin(s.t, 0), mv = clamp(fin(s.move, 0), 0, 2);
    const a = fin(s.attack, -1), hurt = clamp(fin(s.hurt, 0), 0, 1), dead = clamp(fin(s.dead, 0), 0, 1);
    const burrow = clamp(fin(s.burrow, 0), 0, 1);
    const w = windup(a), k = strike(a);
    let mouth = 0.15 + 0.1 * Math.sin(t * 1.3), pitch = 0.25, bend = 0, sway = 1 + mv * 0.8;
    switch (a >= 0 ? s.pattern : null) {
      case 'slam':
        bend = -0.14 * w + 0.3 * k; pitch = 0.25 - 0.7 * w + 0.9 * k; mouth += 0.6 * w + 0.4 * k;
        break;
      case 'volley':
        bend = -0.1 * (w + k); pitch = 0.25 - 1.0 * w - 0.9 * k; mouth = w + k;
        break;
      case 'barrage': {
        const b = Math.abs(Math.sin(a * PI * 8));
        mouth = 0.5 + 0.45 * b; pitch = 0.1 + 0.15 * b; bend = 0.05; sway = 1.6;
        break;
      }
      case 'burrow':
        pitch = 0.25 + 0.6 * w + 0.6 * k; bend = 0.12 * w + 0.2 * k; mouth = 0.4 * w;
        break;
      case 'summon':
        sway = 1 + 3.5 * (w + k); mouth = 0.8 * (w + k); pitch = 0.25 - 0.6 * w;
        break;
      case 'charge':
        bend = 0.15 * (w + k); pitch = 0.4; mouth = 0.9 * (w + k);
        break;
      case null: case undefined:
        break;
      default:
        mouth = 0.2 + 0.8 * (w + k); pitch = 0.25 - 0.4 * w + 0.35 * k; bend = -0.06 * w + 0.16 * k;
    }
    bend -= hurt * 0.12;
    mouth += hurt * 0.5 + dead * 0.5;
    P.mouth = damp(P.mouth, clamp(mouth, 0, 1.2), 14, dt);
    P.pitch = damp(P.pitch, pitch, 10, dt);
    P.bend = damp(P.bend, bend, 10, dt);
    P.sway = damp(P.sway, sway, 4, dt);

    let sumX = 0, sumZ = 0;
    for (let i = 0; i < N; i++) {
      const upper = i >= 4 ? 1 : 0.25;
      const bx = REST[i] + P.bend * upper + Math.sin(t * 1.2 + i * 0.55) * 0.045 * P.sway
        + hurt * Math.sin(t * 40 + i) * 0.02;
      const bz = Math.sin(t * 0.8 + i * 0.45) * 0.05 * P.sway;
      segs[i].rotation.x = bx;
      segs[i].rotation.z = bz;
      sumX += bx; sumZ += bz;
    }
    head.rotation.x = -sumX + P.pitch;
    head.rotation.z = -sumZ * 0.6;
    for (let j = 0; j < flaps.length; j++) {
      flaps[j].rotation.x = 0.95 - 1.5 * P.mouth + Math.sin(t * 3 + j) * 0.03;
    }
    const th = 1 + P.mouth * 0.25 + Math.sin(t * 6) * 0.05;
    throat.scale.set(0.6 * th, 0.6 * th, 0.35);
    mThroat.emissiveIntensity = (1.6 + P.mouth * 2 + 0.4 * Math.sin(t * 4)) * (1 - dead * 0.8);

    rig.position.y = -burrow * 9.5 - dead * 2.0;
    rig.rotation.x = dead * 1.15;
    rig.visible = burrow < 0.985;
    mound.scale.set(1 + burrow * 0.1, 1 + burrow * 0.35 + Math.sin(t * 6) * 0.05 * burrow, 1 + burrow * 0.1);
  }

  return { root, rig, muzzle, update };
}

// ---------------------------------------------------------------------
//  3. 冰霜巨人
// ---------------------------------------------------------------------
function buildFrostGiant(def) {
  const main = def.color ?? 0x8ab8e0;
  const glow = def.projColor ?? 0x9ae0ff;
  const mSkin = mat(main, { rough: 0.6 });
  const mSkinD = mat(shade(main, -0.1), { rough: 0.7 });
  const mFur = mat(0xeef3f8, { rough: 1 });
  const mLeather = mat(0x3e4a5a, { rough: 0.85 });
  const mIce = mat(0xd4f4ff, { emissive: 0x3aa8ff, ei: 0.35, rough: 0.15, metal: 0.1 });
  const mIceD = mat(0x7ac8f0, { emissive: 0x2a88e0, ei: 0.25, rough: 0.2 });
  const mEye = mat(glow, { emissive: glow, ei: 3 });
  const mCore = mat(glow, { emissive: glow, ei: 2 });
  const mMetal = mat(0x6a7a8a, { rough: 0.35, metal: 0.7 });

  const root = new THREE.Group();
  const rig = grp(root);
  rig.scale.setScalar(0.92);
  const HIP_Y = 3.4;
  const hips = grp(rig, 0, HIP_Y, 0);
  add(hips, G.box(), mLeather, 0, 0, 0, 2.1, 0.8, 1.3);
  add(hips, G.cyl(0.8, 9), mFur, 0, -0.45, 0, 1.25, 0.9, 0.85);
  add(hips, G.box(), mMetal, 0, 0.05, 0.64, 0.5, 0.45, 0.1);

  const legs = [];
  for (const sd of [1, -1]) {
    const hip = grp(hips, sd * 0.72, -0.25, 0);
    add(hip, G.limb(0.85, 8), mSkin, 0, 0, 0, 0.55, 1.55, 0.55, PI, 0, 0);
    const knee = grp(hip, 0, -1.55, 0);
    add(knee, G.sphere(8, 6), mSkinD, 0, 0, 0.05, 0.45);
    add(knee, G.limb(0.8, 8), mSkin, 0, 0, 0, 0.45, 1.3, 0.45, PI, 0, 0);
    add(knee, G.cyl(1.1, 8), mFur, 0, -1.05, 0, 0.62, 0.55, 0.62);
    add(knee, G.box(), mLeather, 0, -1.4, 0.22, 0.75, 0.5, 1.25);
    legs.push({ hip, knee, sd });
  }

  const torso = grp(hips, 0, 0.35, 0);
  add(torso, G.sphere(10, 8), mSkin, 0, 0.75, 0.12, 1.55, 1.15, 1.2);
  add(torso, G.sphere(10, 8), mSkin, 0, 1.85, 0, 2.05, 1.35, 1.35);
  add(torso, G.sphere(8, 6), mSkinD, 0, 1.95, 0.85, 1.3, 0.8, 0.55);
  const core = spike(torso, G.octa(), mCore, 0, 1.95, 1.25, 0, 0.2, 1, 0.3, 0.6, true);
  add(torso, G.torus(0.45, 6, 12), mFur, 0, 2.7, 0, 1.55, 1.2, 1.0, PI / 2, 0, 0);
  for (const sd of [1, -1]) {
    add(torso, G.sphere(8, 6), mIceD, sd * 1.95, 2.75, 0, 0.8, 0.55, 0.8);
    spike(torso, G.octa(), mIce, sd * 2.0, 3.0, 0, sd * 0.3, 1, 0, 0.28, 1.4, true);
    spike(torso, G.octa(), mIce, sd * 2.3, 2.9, -0.3, sd * 0.8, 0.8, -0.3, 0.22, 1.1, true);
    spike(torso, G.octa(), mIce, sd * 1.7, 3.0, 0.35, sd * 0.1, 1, 0.3, 0.2, 0.9, true);
  }
  for (let i = 0; i < 5; i++) {
    const o = i - 2;
    spike(torso, G.octa(), mIce, o * 0.45, 2.3 - Math.abs(o) * 0.25, -1.05, o * 0.25, 0.6, -1, 0.25, 1.5 - Math.abs(o) * 0.25, true);
  }

  // 头部：冰晶王冠 + 冰柱胡须
  const neck = grp(torso, 0, 2.95, 0.25);
  const head = grp(neck, 0, 0.1, 0);
  add(head, G.sphere(10, 8), mSkin, 0, 0.45, 0, 0.72, 0.82, 0.75);
  add(head, G.box(), mSkinD, 0, 0.72, 0.52, 1.1, 0.22, 0.4, 0.2, 0, 0);
  for (const sd of [1, -1]) add(head, G.sphere(6, 5), mEye, sd * 0.27, 0.58, 0.66, 0.12, 0.08, 0.06);
  add(head, G.cone(5), mSkinD, 0, 0.5, 0.68, 0.14, 0.32, 0.14, PI / 2 + 0.4, 0, 0);
  const jaw = grp(head, 0, 0.2, 0.25);
  add(jaw, G.box(), mSkinD, 0, -0.1, 0.25, 0.9, 0.3, 0.6);
  for (let j = -3; j <= 3; j++) {
    spike(jaw, G.cone(5), mIce, j * 0.14, -0.2, 0.45 - Math.abs(j) * 0.05, j * 0.08, -1, 0.15, 0.09, 0.5 + (3 - Math.abs(j)) * 0.18);
  }
  spike(head, G.octa(), mIce, 0, 1.15, 0, 0, 1, 0, 0.18, 0.8, true);
  for (const sd of [1, -1]) spike(head, G.octa(), mIce, sd * 0.35, 1.0, 0.1, sd * 0.5, 1, 0, 0.14, 0.6, true);
  spike(head, G.octa(), mIce, 0, 0.95, -0.35, 0, 1, -0.6, 0.14, 0.6, true);

  // 手臂 + 冰锤
  const arms = [];
  for (const sd of [1, -1]) {
    const sh = grp(torso, sd * 1.95, 2.45, 0);
    add(sh, G.sphere(8, 6), mSkin, 0, 0, 0, 0.7);
    add(sh, G.limb(0.8, 8), mSkin, 0, -0.1, 0, 0.58, 1.8, 0.58, PI, 0, 0);
    const el = grp(sh, 0, -1.9, 0);
    add(el, G.sphere(8, 6), mSkinD, 0, 0, 0, 0.5);
    add(el, G.limb(0.85, 8), mSkin, 0, 0, 0, 0.52, 1.6, 0.52, PI, 0, 0);
    add(el, G.cyl(1, 8), mFur, 0, -1.2, 0, 0.6, 0.45, 0.6);
    const hand = grp(el, 0, -1.75, 0);
    add(hand, G.dode(), mSkinD, 0, 0, 0.05, 0.55, 0.6, 0.55);
    arms.push({ sh, el, hand, sd });
  }
  const armR = arms[0], armL = arms[1];
  const club = grp(armR.hand, 0, 0, 0.1);
  add(club, G.limb(1.25, 7), mIceD, 0, -0.6, 0, 0.16, 3.4, 0.16);
  add(club, G.ico(0), mIce, 0, 3.1, 0, 0.75, 1.1, 0.75);
  for (let j = 0; j < 6; j++) {
    const ang = (j / 6) * TAU;
    spike(club, G.octa(), mIce, Math.cos(ang) * 0.5, 2.9 + (j % 2) * 0.45, Math.sin(ang) * 0.5,
      Math.cos(ang), 0.35, Math.sin(ang), 0.15, 0.9, true);
  }
  spike(club, G.octa(), mIce, 0, 3.9, 0, 0, 1, 0, 0.2, 1.0, true);
  const shard = spike(armL.hand, G.octa(), mIce, 0, -0.5, 0.25, 0, 1, 0.2, 0.22, 0.9, true);
  const shardScale = shard.scale.clone();
  const muzzle = grp(armL.hand, 0, -0.5, 0.35);

  const P = { lean: 0, twist: 0, crouch: 0, rx: 0, lx: 0, rz: 0, lz: 0, re: -0.25, le: -0.25, wrist: 0, head: 0, jaw: 0.05, core: 0, shard: 0 };
  let phase = 0;

  function update(dt, s) {
    dt = fin(dt, 0);
    const t = fin(s.t, 0), mv = clamp(fin(s.move, 0), 0, 2);
    const a = fin(s.attack, -1), hurt = clamp(fin(s.hurt, 0), 0, 1), dead = clamp(fin(s.dead, 0), 0, 1);
    const w = windup(a), k = strike(a);
    let lean = 0, twist = 0, crouch = 0, rx = 0, lx = 0, rz = 0, lz = 0, re = -0.25, le = -0.25;
    let wrist = 0, headP = 0, jawO = 0.05 + 0.04 * Math.sin(t * 1.7), coreB = 0, sh = 0;
    switch (a >= 0 ? s.pattern : null) {
      case 'slam':
        rx = lx = -2.8 * w - 0.75 * k; rz = -0.25 * w; lz = 0.25 * w;
        lean = -0.18 * w + 0.5 * k; crouch = 0.6 * k; re = le = -0.5 * w - 0.1 * k;
        wrist = -0.3 * w + 0.8 * k; headP = -0.3 * w + 0.2 * k; jawO = 0.4 * w + 0.6 * k;
        break;
      case 'barrage':
        twist = -0.45 * w + 0.35 * k; lx = 0.7 * w - 1.8 * k; le = -1.2 * w - 0.2 * k; lean = 0.1 * k;
        sh = w + k * 0.3; jawO = 0.3;
        break;
      case 'volley':
        rx = lx = -0.9 * w - 0.3 * k; rz = 1.2 * w + 1.9 * k; lz = -(1.2 * w + 1.9 * k);
        headP = -0.45 * w - 0.2 * k; jawO = 0.8 * (w + k); lean = -0.2 * w + 0.15 * k; coreB = 2 * w + 3 * k;
        break;
      case 'summon':
        rx = -2.9 * w - 0.9 * k; re = -0.1; headP = -0.5 * w; jawO = w + k; coreB = 2 * (w + k);
        crouch = 0.4 * k; lean = 0.35 * k;
        break;
      case 'charge':
        lean = 0.45 * (w + k); rx = lx = 0.5 * (w + k); headP = 0.2 * (w + k); jawO = 0.5 * (w + k);
        break;
      case null: case undefined:
        break;
      default:
        rx = lx = -2.0 * w - 0.6 * k; lean = -0.12 * w + 0.35 * k; crouch = 0.4 * k; jawO = 0.3 * w + 0.5 * k;
        coreB = w + k;
    }
    lean -= hurt * 0.3; headP -= hurt * 0.2;
    P.lean = damp(P.lean, lean, 12, dt);
    P.twist = damp(P.twist, twist, 12, dt);
    P.crouch = damp(P.crouch, crouch, 12, dt);
    P.rx = damp(P.rx, rx, 14, dt); P.lx = damp(P.lx, lx, 14, dt);
    P.rz = damp(P.rz, rz, 14, dt); P.lz = damp(P.lz, lz, 14, dt);
    P.re = damp(P.re, re, 14, dt); P.le = damp(P.le, le, 14, dt);
    P.wrist = damp(P.wrist, wrist, 14, dt);
    P.head = damp(P.head, headP, 10, dt);
    P.jaw = damp(P.jaw, jawO, 12, dt);
    P.core = damp(P.core, coreB, 8, dt);
    P.shard = damp(P.shard, sh, 10, dt);

    phase += dt * (1.0 + 3.2 * mv) * (1 - dead);
    const g = Math.min(mv, 1.6) * (1 - dead);
    hips.position.y = HIP_Y + Math.abs(Math.cos(phase)) * 0.12 * g - P.crouch;
    torso.rotation.x = P.lean + Math.sin(t * 1.2) * 0.02;
    torso.rotation.y = P.twist;
    torso.rotation.z = Math.sin(phase) * 0.04 * g;

    for (let i = 0; i < 2; i++) {
      const L = legs[i];
      const p = phase + (L.sd > 0 ? 0 : PI);
      L.hip.rotation.x = -Math.sin(p) * 0.5 * g - P.crouch * 0.55 + dead * 0.2;
      L.knee.rotation.x = (0.1 + Math.max(0, Math.sin(p + 0.6)) * 0.7) * g + P.crouch * 1.1;
    }
    const swingR = Math.sin(phase + PI) * -0.35 * g;
    const swingL = Math.sin(phase) * -0.35 * g;
    armR.sh.rotation.x = -0.1 + swingR + P.rx;
    armR.sh.rotation.z = 0.12 + P.rz + dead * 0.6;
    armR.el.rotation.x = P.re;
    armL.sh.rotation.x = -0.1 + swingL + P.lx;
    armL.sh.rotation.z = -0.12 + P.lz - dead * 0.6;
    armL.el.rotation.x = P.le;
    club.rotation.x = 2.2 + P.wrist;
    neck.rotation.x = P.head;
    jaw.rotation.x = P.jaw * 0.5;

    const sc = clamp(P.shard, 0, 1);
    shard.visible = sc > 0.02;
    shard.scale.set(shardScale.x * sc, shardScale.y * sc, shardScale.z * sc);

    rig.rotation.x = -dead * 1.5;
    rig.position.y = -dead * 0.3;
    const fade = 1 - dead * 0.85;
    mCore.emissiveIntensity = (1.6 + 0.4 * Math.sin(t * 2.5) + P.core * 1.5) * fade;
    mEye.emissiveIntensity = (2.6 + P.core * 0.8) * fade;
    mIce.emissiveIntensity = (0.3 + P.core * 0.25 + 0.08 * Math.sin(t * 2)) * fade;
  }

  return { root, rig, muzzle, update, _core: core };
}

// ---------------------------------------------------------------------
//  4. 沼泽三头蛇
// ---------------------------------------------------------------------
function buildHydra(def) {
  const main = def.color ?? 0x3a6a4a;
  const glow = def.projColor ?? 0x7aff4a;
  const mSkin = mat(main, { rough: 0.55, metal: 0.1 });
  const mSkinD = mat(shade(main, -0.08), { rough: 0.65 });
  const mBelly = mat(mix(main, 0xd8d890, 0.5), { rough: 0.7 });
  const mSpike = mat(0xd8d0a0, { rough: 0.5 });
  const mEye = mat(0xffe03a, { emissive: 0xffc81a, ei: 2.6 });
  const mMouth = mat(0x5a1020, { rough: 0.8 });
  const mTooth = mat(0xf0ead0, { rough: 0.4 });
  const mGlow = mat(glow, { emissive: glow, ei: 1.6 });
  const mMoss = mat(0x5a7a2a, { rough: 1 });

  const root = new THREE.Group();
  const rig = grp(root);
  rig.scale.setScalar(0.92);
  const BODY_Y = 2.0;
  const body = grp(rig, 0, BODY_Y, -0.6);
  const BS = [2.5, 1.6, 2.9];
  add(body, G.sphere(14, 10), mSkin, 0, 0, 0, BS[0], BS[1], BS[2]);
  add(body, G.sphere(10, 7), mBelly, 0, -0.45, 0.2, 2.1, 1.1, 2.5);
  const SPOTS = [[0.6, 1, 0.6], [-0.6, 1, 0.6], [0.9, 0.9, -0.3], [-0.9, 0.9, -0.3], [0, 1, -0.9]];
  for (let i = 0; i < SPOTS.length; i++) onSurf(body, G.sphere(8, 6), mGlow, [0, 0, 0], BS, SPOTS[i], [0.3, 0.4, 0.06], 0);
  for (let i = 0; i < 5; i++) {
    onSurf(body, G.cone(5), mSpike, [0, 0, 0], BS, [0, 1, 0.8 - i * 0.45], [0.18, 0.7 - Math.abs(i - 2) * 0.1, 0.18], -0.05, AX_Y);
  }
  for (let i = 0; i < 3; i++) {
    const m = onSurf(body, G.box(), mMoss, [0, 0, 0], BS, [i - 1, -0.1, 0.7 - i * 0.4], [0.5, 0.9, 0.05], 0);
    m.position.y -= 0.35;
  }

  const legs = [];
  const LEGP = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (let i = 0; i < 4; i++) {
    const [sx, sz] = LEGP[i];
    const lg = grp(body, sx * 1.9, -0.7, sz * 1.3);
    add(lg, G.sphere(8, 6), mSkinD, 0, -0.3, 0, 0.65, 0.9, 0.7);
    add(lg, G.sphere(8, 5), mSkinD, 0, -1.0, 0.2, 0.6, 0.35, 0.8);
    legs.push({ g: lg, ph: i === 0 || i === 3 ? 0 : PI });
  }

  const tail = [];
  let tp = grp(body, 0, -0.1, -2.6);
  tp.rotation.x = -PI / 2 - 0.3;
  for (let i = 0; i < 5; i++) {
    const g = i === 0 ? grp(tp) : grp(tail[i - 1], 0, 0.68, 0);
    const r = 0.8 - i * 0.12;
    add(g, G.sphere(8, 6), mSkin, 0, 0.36, 0, r, 0.5, r);
    tail.push(g);
  }
  spike(tail[4], G.cone(5), mSpike, 0, 0.62, 0, 0, 1, 0, 0.25, 0.7);

  function makeHead(parent) {
    const h = grp(parent);
    add(h, G.sphere(10, 8), mSkin, 0, 0.05, 0.15, 0.55, 0.45, 0.62);
    add(h, G.box(), mSkin, 0, 0.0, 0.75, 0.62, 0.3, 0.8);
    for (const x of [-0.12, 0.12]) add(h, G.cone(4), mTooth, x, -0.17, 1.02, 0.05, 0.2, 0.05, PI, 0, 0);
    for (const sd of [-1, 1]) {
      add(h, G.cone(4), mTooth, sd * 0.24, -0.18, 0.98, 0.07, 0.34, 0.07, PI, 0, 0);
      add(h, G.sphere(6, 5), mEye, sd * 0.3, 0.2, 0.5, 0.1, 0.08, 0.1);
      spike(h, G.cone(5), mSpike, sd * 0.3, 0.3, 0.1, sd * 0.4, 0.5, -1, 0.1, 0.7);
    }
    spike(h, G.cone(5), mSpike, 0, 0.42, -0.05, 0, 0.6, -1, 0.09, 0.5);
    add(h, G.sphere(8, 6), mGlow, 0, -0.14, 0.6, 0.2, 0.1, 0.35);
    const jaw = grp(h, 0, -0.18, 0.15);
    add(jaw, G.box(), mSkinD, 0, -0.08, 0.5, 0.55, 0.18, 0.95);
    add(jaw, G.box(), mMouth, 0, 0.02, 0.5, 0.45, 0.04, 0.85);
    for (const x of [-0.18, 0.18]) {
      add(jaw, G.cone(4), mTooth, x, 0.02, 0.85, 0.05, 0.2, 0.05);
      add(jaw, G.cone(4), mTooth, x, 0.02, 0.5, 0.05, 0.18, 0.05);
    }
    return { h, jaw };
  }

  const NX = [-1.25, 0, 1.25];
  const NSEG = 6, SEG = 0.72;
  const REST = [-0.3, -0.2, -0.05, 0.12, 0.28, 0.35];
  const BASE_X = 0.35;
  const necks = [];
  for (let n = 0; n < 3; n++) {
    const base = grp(body, NX[n], 0.95, 1.55);
    base.rotation.x = BASE_X;
    base.rotation.z = -NX[n] * 0.25;
    const segs = [];
    let prev = base;
    for (let i = 0; i < NSEG; i++) {
      const g = i === 0 ? grp(base) : grp(prev, 0, SEG, 0);
      const r = 0.62 - i * 0.035;
      add(g, G.sphere(9, 7), mSkin, 0, SEG * 0.5, 0, r, SEG * 0.72, r);
      if (i % 2 === 0) add(g, G.cone(4), mSpike, 0, SEG * 0.5, -r * 0.85, 0.1, 0.4, 0.1, -PI / 2, 0, 0);
      else add(g, G.sphere(6, 4), mBelly, 0, SEG * 0.5, r * 0.55, r * 0.6, SEG * 0.55, r * 0.5);
      segs.push(g);
      prev = g;
    }
    const holder = grp(prev, 0, SEG, 0);
    const { h, jaw } = makeHead(holder);
    necks.push({ base, segs, holder, head: h, jaw, n, P: { base: 0, bend: 0, pitch: 0.1, jaw: 0.1, spread: 0 } });
  }
  const muzzle = grp(necks[1].head, 0, -0.1, 1.25);

  let phase = 0, glowP = 0;

  function update(dt, s) {
    dt = fin(dt, 0);
    const t = fin(s.t, 0), mv = clamp(fin(s.move, 0), 0, 2);
    const a = fin(s.attack, -1), hurt = clamp(fin(s.hurt, 0), 0, 1), dead = clamp(fin(s.dead, 0), 0, 1);
    const w = windup(a), k = strike(a);
    const pat = a >= 0 ? s.pattern : null;
    let glowT = 0;

    for (let n = 0; n < 3; n++) {
      const N = necks[n];
      let baseA = 0, bend = 0, pitch = 0.1, jawO = 0.1 + 0.08 * Math.sin(t * 2 + n * 1.3), spread = 0;
      switch (pat) {
        case 'breath':
          bend = -0.1 * w + 0.14 * k; baseA = -0.15 * w + 0.35 * k; pitch = 0.1 - 0.35 * w + 0.25 * k;
          jawO = 0.4 * w + k; glowT = w + 2 * k;
          break;
        case 'volley':
          baseA = -0.25 * (w + k); spread = 0.3 * (w + k); pitch = 0.1 - 0.7 * w - 0.5 * k; jawO = 0.7 * w + k;
          glowT = w + 1.5 * k;
          break;
        case 'barrage': {
          const l = Math.sin(PI * clamp((a - 0.15 - n * 0.2) / 0.35, 0, 1));
          baseA = 0.4 * l; bend = 0.1 * l; jawO = 0.2 + 0.8 * l; pitch = 0.1 + 0.2 * l; glowT = 0.8;
          break;
        }
        case 'summon':
          baseA = -0.3 * w - 0.2 * k; pitch = 0.1 - 1.1 * w - 0.6 * k; jawO = w + k; spread = 0.2 * (w + k);
          glowT = 2 * (w + k);
          break;
        case 'charge':
          baseA = 0.5 * (w + k); pitch = 0.3; jawO = 0.8 * (w + k);
          break;
        case null: case undefined:
          break;
        default:
          bend = -0.08 * w + 0.12 * k; baseA = -0.1 * w + 0.3 * k; jawO = 0.4 * w + 0.8 * k; glowT = w + k;
      }
      baseA += -0.2 * hurt + dead * 1.0;
      bend += dead * 0.12;
      pitch += dead * 0.5;
      jawO += dead * 0.4;
      const Q = N.P;
      Q.base = damp(Q.base, baseA, 10, dt);
      Q.bend = damp(Q.bend, bend, 10, dt);
      Q.pitch = damp(Q.pitch, pitch, 10, dt);
      Q.jaw = damp(Q.jaw, jawO, 14, dt);
      Q.spread = damp(Q.spread, spread, 8, dt);

      const side = NX[n] / 1.25;
      const bx0 = BASE_X + Q.base;
      const bz0 = -NX[n] * 0.25 - side * Q.spread;
      N.base.rotation.x = bx0;
      N.base.rotation.z = bz0;
      let sumX = bx0, sumZ = bz0;
      for (let i = 0; i < NSEG; i++) {
        const bx = REST[i] + Q.bend + Math.sin(t * 1.4 + n * 2.1 + i * 0.6) * 0.07 * (1 - dead);
        const bz = Math.sin(t * 1.1 + n * 1.7 + i * 0.5) * 0.09 * (1 - dead);
        N.segs[i].rotation.x = bx;
        N.segs[i].rotation.z = bz;
        sumX += bx; sumZ += bz;
      }
      N.holder.rotation.x = -sumX + Q.pitch;
      N.holder.rotation.z = -sumZ * 0.8;
      N.holder.rotation.y = -side * 0.15;
      N.jaw.rotation.x = clamp(Q.jaw, 0, 1.2) * 0.75;
    }

    phase += dt * (1.0 + 3.5 * mv) * (1 - dead);
    const g = Math.min(mv, 1.4) * (1 - dead);
    for (let i = 0; i < 4; i++) legs[i].g.rotation.x = Math.sin(phase + legs[i].ph) * 0.45 * g;
    body.position.y = BODY_Y + Math.abs(Math.sin(phase)) * 0.1 * g + Math.sin(t * 1.3) * 0.04 - dead * 1.3;
    body.rotation.z = Math.sin(phase) * 0.04 * g + hurt * Math.sin(t * 45) * 0.04;
    body.rotation.x = -hurt * 0.1 + dead * 0.1;
    for (let i = 0; i < tail.length; i++) tail[i].rotation.z = Math.sin(t * 1.5 - i * 0.6) * 0.12 * (1 - dead * 0.8);

    glowP = damp(glowP, glowT, 8, dt);
    const fade = 1 - dead * 0.85;
    mGlow.emissiveIntensity = (1.3 + 0.4 * Math.sin(t * 2.2) + glowP * 1.5) * fade;
    mEye.emissiveIntensity = (2.4 + glowP * 0.6) * fade;
  }

  return { root, rig, muzzle, update };
}

// ---------------------------------------------------------------------
//  5. 熔岩巨魔
// ---------------------------------------------------------------------
function buildMagmaGolem(def) {
  const main = def.color ?? 0x3a2a2a;
  const glow = def.projColor ?? 0xff6a1a;
  const mRock = mat(main, { rough: 0.95 });
  const mRock2 = mat(shade(main, 0.05, 0.02, 0.01), { rough: 0.9 });
  const mObs = mat(0x0c0a12, { rough: 0.15, metal: 0.5 });
  const mLava = mat(mix(glow, 0xffc040, 0.3), { emissive: glow, ei: 2.0, rough: 0.5 });
  const mCore = mat(0xffd060, { emissive: 0xffa020, ei: 3 });
  const mEye = mat(0xffe070, { emissive: 0xffc030, ei: 3 });

  const R = rng(31);
  const crack = (parent, c, s, d, len = 0.9) =>
    onSurf(parent, G.box(), mLava, c, s, d, [0.09, len * (0.7 + R() * 0.6), 0.08], 0, AX_Z, R() * PI);

  const root = new THREE.Group();
  const rig = grp(root);
  rig.scale.setScalar(0.9);
  const HIP_Y = 2.65;
  const hips = grp(rig, 0, HIP_Y, 0);

  const legs = [];
  for (const sd of [1, -1]) {
    const hip = grp(hips, sd * 1.05, -0.2, 0);
    add(hip, G.ico(0), mRock, 0, -0.55, 0, 0.85, 1.0, 0.85, 0, sd, 0);
    crack(hip, [0, -0.55, 0], [0.7, 0.85, 0.7], [sd, 0, 0.6]);
    const knee = grp(hip, 0, -1.05, 0.05);
    add(knee, G.dode(), mRock2, 0, -0.45, 0, 0.78, 0.8, 0.8);
    add(knee, G.ico(0), mRock, 0, -1.0, 0.25, 0.95, 0.42, 1.25);
    legs.push({ hip, knee, sd });
  }

  const torso = grp(hips, 0, 0.3, 0);
  add(torso, G.ico(0), mRock, 0, 0, 0, 1.5, 0.85, 1.15);
  add(torso, G.dode(), mRock2, 0, 1.1, 0.05, 1.65, 1.1, 1.35);
  const CH = [0, 2.65, 0.1], CS = [2.5, 1.8, 1.85];
  add(torso, G.dode(), mRock, CH[0], CH[1], CH[2], CS[0], CS[1], CS[2]);
  const core = add(torso, G.sphere(12, 9), mCore, 0, 2.45, 1.5, 0.62);
  add(torso, G.torus(0.2, 6, 14), mLava, 0, 2.45, 1.55, 0.82);
  const CSx = [CS[0] * 0.86, CS[1] * 0.86, CS[2] * 0.86];
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * TAU;
    crack(torso, CH, CSx, [Math.cos(ang) * 0.8, Math.sin(ang) * 0.6 - 0.1, 1], 1.1);
  }
  for (let i = 0; i < 4; i++) crack(torso, [0, 1.1, 0.05], [1.4, 0.95, 1.15], [i - 1.5, (i % 2) - 0.5, 1]);
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.9;
    spike(torso, G.cone(6), mRock2, x, 3.6 - Math.abs(x) * 0.2, -1.1, x * 0.3, 1, -0.6, 0.35, 0.9);
    add(torso, G.sphere(6, 4), mLava, x + x * 0.08, 4.35 - Math.abs(x) * 0.2, -1.55, 0.14);
  }

  const head = grp(torso, 0, 4.15, 0.85);
  add(head, G.ico(0), mRock2, 0, 0.3, 0, 0.72, 0.62, 0.7);
  add(head, G.box(), mRock, 0, 0.5, 0.45, 1.0, 0.22, 0.35, 0.25, 0, 0);
  for (const sd of [1, -1]) add(head, G.box(), mEye, sd * 0.25, 0.35, 0.62, 0.2, 0.08, 0.06, 0, 0, -sd * 0.25);
  const mouthGlow = add(head, G.box(), mLava, 0, 0.08, 0.6, 0.45, 0.07, 0.06);
  for (const sd of [1, -1]) {
    const h0 = grp(head, sd * 0.55, 0.55, 0);
    h0.rotation.set(0.2, 0, -sd * 0.9);
    add(h0, G.limb(0.7, 6), mObs, 0, 0, 0, 0.2, 0.6, 0.2);
    const h1 = grp(h0, 0, 0.6, 0);
    h1.rotation.set(0.3, 0, sd * 0.6);
    add(h1, G.limb(0.6, 6), mObs, 0, 0, 0, 0.14, 0.55, 0.14);
    const h2 = grp(h1, 0, 0.55, 0);
    h2.rotation.set(0.35, 0, sd * 0.5);
    add(h2, G.cone(6), mObs, 0, 0, 0, 0.085, 0.5, 0.085);
  }

  const arms = [];
  for (const sd of [1, -1]) {
    const sh = grp(torso, sd * 2.3, 3.35, 0);
    add(sh, G.dode(), mRock2, sd * 0.15, 0.25, 0, 1.15, 1.0, 1.1);
    for (let j = 0; j < 3; j++) {
      spike(sh, G.cone(6), mObs, sd * (0.2 + j * 0.3), 0.9 - j * 0.15, (j - 1) * 0.35, sd * (0.3 + j * 0.3), 1, (j - 1) * 0.3, 0.16, 0.8 - j * 0.12);
    }
    add(sh, G.ico(0), mRock, 0, -1.05, 0, 0.72, 1.2, 0.72);
    crack(sh, [0, -1.05, 0], [0.62, 1.0, 0.62], [sd, 0.2, 0.5]);
    crack(sh, [0, -1.05, 0], [0.62, 1.0, 0.62], [0, -0.3, 1]);
    const el = grp(sh, 0, -2.1, 0.1);
    add(el, G.dode(), mRock2, 0, 0, 0, 0.6);
    add(el, G.ico(0), mRock, 0, -1.05, 0, 0.88, 1.25, 0.88);
    const fist = grp(el, 0, -2.15, 0.1);
    add(fist, G.dode(), mRock2, 0, 0, 0, 1.05, 0.95, 1.1);
    for (let j = -1; j <= 1; j++) spike(fist, G.cone(6), mObs, j * 0.4, -0.2, 0.75, j * 0.2, -0.3, 1, 0.14, 0.55);
    crack(fist, [0, 0, 0], [0.9, 0.8, 0.95], [sd, 0.4, 0.3]);
    crack(fist, [0, 0, 0], [0.9, 0.8, 0.95], [-sd * 0.3, 0.7, 0.6]);
    arms.push({ sh, el, fist, sd });
  }
  const muzzle = grp(torso, 0, 2.45, 2.3);

  const P = { lean: 0, crouch: 0, rx: 0, lx: 0, rz: 0, lz: 0, re: -0.2, le: -0.2, head: 0, core: 0 };
  let phase = 0;

  function update(dt, s) {
    dt = fin(dt, 0);
    const t = fin(s.t, 0), mv = clamp(fin(s.move, 0), 0, 2);
    const a = fin(s.attack, -1), hurt = clamp(fin(s.hurt, 0), 0, 1), dead = clamp(fin(s.dead, 0), 0, 1);
    const w = windup(a), k = strike(a);
    let lean = 0, crouch = 0, rx = 0, lx = 0, rz = 0, lz = 0, re = -0.2, le = -0.2, headP = 0, coreB = 0;
    switch (a >= 0 ? s.pattern : null) {
      case 'slam':
        rx = lx = -2.8 * w - 1.0 * k; rz = -0.15 * w; lz = 0.15 * w; re = le = -0.4 * w;
        lean = -0.2 * w + 0.5 * k; crouch = 0.7 * k; headP = -0.2 * w + 0.2 * k; coreB = w;
        break;
      case 'meteor':
        rx = lx = -2.6 * w - 2.9 * k; rz = 0.6 * w + 0.4 * k; lz = -(0.6 * w + 0.4 * k);
        headP = -0.4 * (w + k); lean = -0.25 * w - 0.1 * k; coreB = 3 * w + 4 * k;
        break;
      case 'charge':
        lean = 0.55 * (w + k); rx = lx = 0.6 * (w + k); headP = 0.25 * (w + k); crouch = 0.3 * (w + k);
        break;
      case 'volley':
        rx = lx = 0.5 * w - 0.4 * k; lean = -0.25 * w + 0.2 * k; rz = 1.3 * k; lz = -1.3 * k; coreB = 2 * w + 4 * k;
        break;
      case 'summon':
        rx = lx = -1.2 * w - 0.4 * k; re = le = -0.6 * w; crouch = 0.6 * k; lean = 0.4 * k; coreB = 2 * (w + k);
        break;
      case null: case undefined:
        break;
      default:
        rx = lx = -2.0 * w - 0.8 * k; lean = -0.12 * w + 0.35 * k; crouch = 0.4 * k; coreB = w + k;
    }
    lean -= hurt * 0.25; headP -= hurt * 0.2;
    P.lean = damp(P.lean, lean, 10, dt);
    P.crouch = damp(P.crouch, crouch, 10, dt);
    P.rx = damp(P.rx, rx, 12, dt); P.lx = damp(P.lx, lx, 12, dt);
    P.rz = damp(P.rz, rz, 12, dt); P.lz = damp(P.lz, lz, 12, dt);
    P.re = damp(P.re, re, 12, dt); P.le = damp(P.le, le, 12, dt);
    P.head = damp(P.head, headP, 10, dt);
    P.core = damp(P.core, coreB, 8, dt);

    phase += dt * (0.9 + 2.8 * mv) * (1 - dead);
    const g = Math.min(mv, 1.6) * (1 - dead);
    hips.position.y = HIP_Y + Math.abs(Math.cos(phase)) * 0.15 * g - P.crouch;
    torso.rotation.x = P.lean + dead * 0.4 + Math.sin(t * 1.1) * 0.015;
    torso.rotation.z = Math.sin(phase) * 0.06 * g + hurt * Math.sin(t * 40) * 0.03;
    for (let i = 0; i < 2; i++) {
      const L = legs[i];
      const p = phase + (L.sd > 0 ? 0 : PI);
      L.hip.rotation.x = -Math.sin(p) * 0.4 * g - P.crouch * 0.5;
      L.knee.rotation.x = (0.1 + Math.max(0, Math.sin(p + 0.6)) * 0.55) * g + P.crouch * 1.0;
    }
    for (let i = 0; i < 2; i++) {
      const A = arms[i];
      const sw = Math.sin(phase + (A.sd > 0 ? PI : 0)) * -0.3 * g;
      A.sh.rotation.x = -0.2 + sw + (A.sd > 0 ? P.rx : P.lx) + dead * 0.5;
      A.sh.rotation.z = A.sd * 0.25 + (A.sd > 0 ? P.rz : P.lz);
      A.el.rotation.x = A.sd > 0 ? P.re : P.le;
    }
    head.rotation.x = P.head + dead * 0.5;

    rig.position.y = -dead * 2.5;
    rig.rotation.x = dead * 0.5;
    const fade = 1 - dead * 0.85;
    const pulse = Math.sin(t * 2.4);
    mLava.emissiveIntensity = (1.6 + 0.6 * pulse + P.core * 0.4) * fade;
    mCore.emissiveIntensity = (2.6 + 0.8 * pulse + P.core * 1.2) * fade;
    mEye.emissiveIntensity = (2.6 + P.core * 0.5) * fade;
    const cs = 0.62 * (1 + 0.06 * pulse + P.core * 0.06);
    core.scale.set(cs, cs, cs);
    mouthGlow.scale.y = 0.07 + P.core * 0.04;
  }

  return { root, rig, muzzle, update };
}

// ---------------------------------------------------------------------
//  6. 暗影魔王（三阶段：2 阶段展开蝠翼，3 阶段光环暴涨）
// ---------------------------------------------------------------------
function wingMembrane() {
  return cached('wingMembrane', () => {
    const O = [0, 0, 0], W = [1.9, 0.9, -0.5];
    const F1 = [3.9, 1.9, -0.9], F2 = [4.3, 0.1, -1.0], F3 = [3.2, -1.5, -0.8], B = [0.3, -1.6, -0.3];
    const mid = (p, q, towards, f) => [0, 1, 2].map((i) => ((p[i] + q[i]) / 2) * (1 - f) + towards[i] * f);
    const M12 = mid(F1, F2, W, 0.25), M23 = mid(F2, F3, W, 0.25), M3B = mid(F3, B, W, 0.2);
    const tris = [O, W, B, W, F1, M12, W, M12, F2, W, F2, M23, W, M23, F3, W, F3, M3B, W, M3B, B];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
    g.computeVertexNormals();
    return g;
  });
}

function buildOverlord(def) {
  const main = def.color ?? 0x1a1024;
  const glow = def.projColor ?? 0xb04aff;
  const mArmor = mat(shade(main, 0.1, 0.05), { rough: 0.35, metal: 0.6 });
  const mArmorD = mat(main, { rough: 0.4, metal: 0.5 });
  const mTrim = mat(mix(glow, 0x888899, 0.55), { rough: 0.3, metal: 0.8 });
  const mGlow = mat(glow, { emissive: glow, ei: 2.2 });
  const mEye = mat(0xffffff, { emissive: glow, ei: 4 });
  const mCape = mat(0x2a0a1e, { rough: 0.85, side: THREE.DoubleSide });
  const mHorn = mat(0x2a2430, { rough: 0.3, metal: 0.2 });
  const mBlade = mat(0x2a2a3a, { rough: 0.2, metal: 0.85 });
  const mWing = mat(0x24081e, { rough: 0.8, side: THREE.DoubleSide, emissive: glow, ei: 0.12 });
  const mAura = mat(glow, { emissive: glow, ei: 1.2, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const mCrystal = mat(0x2a1440, { emissive: glow, ei: 0.8, rough: 0.2, metal: 0.3 });

  const root = new THREE.Group();
  const rig = grp(root);
  rig.scale.setScalar(0.92);
  const HOVER = 0.8;
  const float = grp(rig, 0, HOVER, 0);

  // 长袍下摆 + 触须
  add(float, G.limb(0.55, 10), mArmorD, 0, 0.2, 0, 1.3, 2.4, 1.1);
  for (let i = -1; i <= 1; i++) add(float, G.box(), mArmor, i * 0.7, 1.7, 0.85 - Math.abs(i) * 0.25, 0.6, 1.0, 0.1, -0.2, i * 0.5, 0);
  const tendrils = [];
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * TAU + 0.3;
    const tg = grp(float, Math.cos(ang) * 1.05, 0.3, Math.sin(ang) * 0.9);
    add(tg, G.cone(5), i % 2 ? mArmorD : mCrystal, 0, 0, 0, 0.22, 0.9, 0.22, PI, 0, 0);
    tendrils.push(tg);
  }

  const torso = grp(float, 0, 2.6, 0);
  add(torso, G.box(), mArmorD, 0, 0.2, 0, 1.2, 0.6, 0.8);
  add(torso, G.box(), mArmor, 0, 1.1, 0, 2.0, 1.4, 1.2);
  add(torso, G.box(), mTrim, 0, 1.15, 0.55, 1.4, 1.0, 0.25, 0.12, 0, 0);
  const coreGem = add(torso, G.octa(), mGlow, 0, 1.2, 0.72, 0.28, 0.38, 0.18);
  for (const sd of [-1, 1]) add(torso, G.box(), mArmorD, sd * 0.3, 0.55, 0.45, 0.5, 0.3, 0.1);
  for (let i = 0; i < 5; i++) {
    const o = i - 2;
    spike(torso, G.cone(5), mHorn, o * 0.32, 1.9, -0.45, o * 0.35, 1, -0.5, 0.12, 0.9 - Math.abs(o) * 0.15);
  }

  const head = grp(torso, 0, 2.2, 0.05);
  add(head, G.sphere(10, 8), mArmorD, 0, 0.3, 0, 0.5, 0.58, 0.52);
  add(head, G.box(), mArmor, 0, 0.2, 0.42, 0.62, 0.5, 0.2, -0.1, 0, 0);
  for (const sd of [-1, 1]) add(head, G.box(), mEye, sd * 0.17, 0.3, 0.53, 0.14, 0.05, 0.04, 0, 0, -sd * 0.3);
  add(head, G.cone(5), mHorn, 0, -0.05, 0.45, 0.1, 0.35, 0.1, PI + 0.3, 0, 0);
  for (let i = -1; i <= 1; i++) spike(head, G.cone(5), mTrim, i * 0.2, 0.8, 0.05, i * 0.3, 1, 0.1, 0.07, 0.35 - Math.abs(i) * 0.1);
  for (const sd of [-1, 1]) {
    const h0 = grp(head, sd * 0.42, 0.45, 0);
    h0.rotation.set(0, 0, -sd * 1.0);
    add(h0, G.limb(0.75, 6), mHorn, 0, 0, 0, 0.16, 0.55, 0.16);
    const h1 = grp(h0, 0, 0.55, 0);
    h1.rotation.set(-0.15, 0, sd * 0.45);
    add(h1, G.limb(0.7, 6), mHorn, 0, 0, 0, 0.12, 0.5, 0.12);
    const h2 = grp(h1, 0, 0.5, 0);
    h2.rotation.set(0.15, 0, sd * 0.4);
    add(h2, G.limb(0.6, 6), mHorn, 0, 0, 0, 0.085, 0.45, 0.085);
    const h3 = grp(h2, 0, 0.45, 0);
    h3.rotation.set(0.3, 0, sd * 0.3);
    add(h3, G.cone(6), mHorn, 0, 0, 0, 0.05, 0.45, 0.05);
  }

  const arms = [];
  for (const sd of [1, -1]) {
    const sh = grp(torso, sd * 1.3, 1.45, 0);
    add(sh, G.sphere(8, 6), mArmor, sd * 0.1, 0.25, 0, 0.75, 0.55, 0.75);
    add(sh, G.box(), mTrim, sd * 0.1, 0.02, 0, 1.3, 0.1, 1.2);
    for (let j = 0; j < 3; j++) spike(sh, G.cone(5), mHorn, sd * (0.05 + j * 0.3), 0.6, (j - 1) * 0.2, sd * (0.2 + j * 0.4), 1, 0, 0.1, 0.65 - j * 0.1);
    add(sh, G.limb(0.9, 7), mArmorD, 0, 0, 0, 0.32, 1.2, 0.32, PI, 0, 0);
    const el = grp(sh, 0, -1.25, 0);
    add(el, G.limb(1.15, 7), mArmor, 0, 0, 0, 0.3, 1.1, 0.3, PI, 0, 0);
    spike(el, G.cone(5), mTrim, sd * 0.25, -0.5, -0.1, sd, 0.3, -0.4, 0.08, 0.45);
    const hand = grp(el, 0, -1.2, 0);
    add(hand, G.box(), mArmorD, 0, -0.1, 0, 0.35, 0.4, 0.3);
    for (let j = -1; j <= 1; j++) add(hand, G.cone(4), mHorn, j * 0.11, -0.3, 0.08, 0.05, 0.3, 0.05, PI - 0.3, 0, 0);
    arms.push({ sh, el, hand, sd });
  }
  const armR = arms[0], armL = arms[1];

  // 右手：暗影魔剑
  const sword = grp(armR.hand, 0, -0.15, 0.1);
  add(sword, G.limb(1, 6), mArmorD, 0, -0.35, 0, 0.07, 0.75, 0.07);
  add(sword, G.box(), mTrim, 0, 0.42, 0, 0.8, 0.12, 0.18);
  add(sword, G.box(), mBlade, 0, 1.75, 0, 0.34, 2.6, 0.08);
  add(sword, G.box(), mGlow, 0, 1.75, 0, 0.06, 2.5, 0.1);
  add(sword, G.cone(4), mBlade, 0, 3.05, 0, 0.17, 0.5, 0.05);
  add(sword, G.octa(), mGlow, 0, -0.45, 0, 0.1);
  // 左手：法球（弹幕发射点）
  const orb = add(armL.hand, G.sphere(10, 8), mGlow, 0, -0.55, 0.25, 0.28);
  const orbRing = add(armL.hand, G.torus(0.08, 5, 16), mTrim, 0, -0.55, 0.25, 0.42, 0.42, 0.42, PI / 2, 0, 0);
  const muzzle = grp(armL.hand, 0, -0.55, 0.25);

  // 披风：3 列 × 4 行，逐行摆动
  const capeRows = [];
  const capeG = grp(torso, 0, 1.75, -0.62);
  const ROW = 0.75;
  let prevRow = capeG;
  for (let r = 0; r < 4; r++) {
    const row = r === 0 ? grp(capeG) : grp(prevRow, 0, -ROW, 0);
    const wd = 0.6 + r * 0.08;
    for (let c = -1; c <= 1; c++) add(row, G.box(), mCape, c * wd * 0.98, -ROW / 2, 0, wd, ROW * 1.04, 0.06);
    if (r === 3) for (let c = -1; c <= 1; c++) add(row, G.cone(4), mCape, c * wd * 0.98, -ROW, 0, 0.3, 0.45, 0.04, PI, 0, 0);
    capeRows.push(row);
    prevRow = row;
  }

  // 蝠翼（2 阶段出现）
  const wings = [];
  for (const sd of [1, -1]) {
    const wg = grp(torso, sd * 0.55, 1.55, -0.6);
    wg.scale.set(sd * 0.001, 0.001, 0.001);
    wg.visible = false;
    boneBetween(wg, G.limb(0.7, 6), mHorn, 0, 0, 0, 1.9, 0.9, -0.5, 0.12);
    boneBetween(wg, G.limb(0.3, 5), mHorn, 1.9, 0.9, -0.5, 3.9, 1.9, -0.9, 0.08);
    boneBetween(wg, G.limb(0.3, 5), mHorn, 1.9, 0.9, -0.5, 4.3, 0.1, -1.0, 0.07);
    boneBetween(wg, G.limb(0.3, 5), mHorn, 1.9, 0.9, -0.5, 3.2, -1.5, -0.8, 0.07);
    add(wg, wingMembrane(), mWing);
    wings.push({ g: wg, sd });
  }

  // 环绕晶体 + 光环
  const orbit = grp(float, 0, 2.9, 0);
  const crystals = [];
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * TAU;
    const c = add(orbit, G.octa(), i % 2 ? mCrystal : mGlow, Math.cos(ang) * 2.7, 0, Math.sin(ang) * 2.7, 0.22, 0.55, 0.22);
    crystals.push(c);
  }
  const orbit2 = grp(float, 0, 3.4, 0);
  orbit2.visible = false;
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * TAU;
    const c = add(orbit2, G.octa(), mGlow, Math.cos(ang) * 3.7, 0, Math.sin(ang) * 3.7, 0.35, 0.9, 0.35);
    crystals.push(c);
  }
  const aura = add(float, G.sphere(16, 12), mAura, 0, 2.9, 0, 2.8);
  const rune = add(root, G.torus(0.04, 4, 32), mGlow, 0, 0.06, 0, 3.2, 3.2, 3.2, PI / 2, 0, 0);
  const rune2 = add(root, G.torus(0.03, 4, 6), mGlow, 0, 0.06, 0, 2.6, 2.6, 2.6, PI / 2, 0, 0);

  const P = { lean: 0, rise: 0, rx: 0, lx: 0, rz: 0, lz: 0, re: 0, le: 0, head: 0, core: 0, cape: 0, sword: 0 };
  let wingS = 0, auraS = 2.8, auraO = 0.08, phaseMul = 1, spin = 0, spin2 = 0;

  function update(dt, s) {
    dt = fin(dt, 0);
    const t = fin(s.t, 0), mv = clamp(fin(s.move, 0), 0, 2);
    const a = fin(s.attack, -1), hurt = clamp(fin(s.hurt, 0), 0, 1), dead = clamp(fin(s.dead, 0), 0, 1);
    const phase = clamp(Math.round(fin(s.phase, 1)), 1, 3);
    const w = windup(a), k = strike(a);
    let lean = 0, rise = 0, rx = 0, lx = 0, rz = 0, lz = 0, re = 0, le = 0, headP = 0, coreB = 0, capeB = 0, sw = 0;
    switch (a >= 0 ? s.pattern : null) {
      case 'barrage':
        lx = -1.5 * w - 1.6 * k; le = 0.3 * w + 0.5 * k; lz = -0.1 * w; coreB = w + 2 * k; lean = 0.08 * k;
        break;
      case 'volley':
        rz = 1.2 * w + 1.5 * k; lz = -(1.2 * w + 1.5 * k); rx = lx = -0.3 * w - 0.2 * k; rise = 0.6 * w + 0.4 * k;
        coreB = 2 * w + 3 * k; headP = -0.2 * w;
        break;
      case 'meteor':
        rx = lx = -2.9 * w - 2.4 * k; rz = 0.3 * w; lz = -0.3 * w; headP = -0.45 * w - 0.2 * k; rise = 1.0 * w + 0.6 * k;
        coreB = 2.5 * (w + k); sw = -0.8 * w;
        break;
      case 'summon':
        rx = -2.8 * w - 0.6 * k; sw = -1.6 * w + 0.4 * k; lean = 0.3 * k; rise = -0.4 * k; coreB = 2 * (w + k);
        lz = -0.9 * (w + k);
        break;
      case 'charge':
        lean = 0.5 * (w + k); rx = -1.4 * (w + k); capeB = 0.6 * (w + k); headP = 0.2 * (w + k);
        break;
      case 'slam':
        rx = lx = -2.9 * w - 0.7 * k; lean = -0.15 * w + 0.4 * k; rise = 0.4 * w - 0.5 * k; sw = -0.5 * w + 0.3 * k;
        break;
      case 'breath':
        headP = -0.3 * w + 0.25 * k; lean = -0.2 * w + 0.35 * k; rz = 0.8 * (w + k); lz = -0.8 * (w + k); coreB = 3 * k + w;
        break;
      case null: case undefined:
        break;
      default:
        lx = -1.2 * (w + k); coreB = w + k;
    }
    lean -= hurt * 0.3; headP -= hurt * 0.2;
    P.lean = damp(P.lean, lean, 10, dt);
    P.rise = damp(P.rise, rise, 6, dt);
    P.rx = damp(P.rx, rx, 12, dt); P.lx = damp(P.lx, lx, 12, dt);
    P.rz = damp(P.rz, rz, 12, dt); P.lz = damp(P.lz, lz, 12, dt);
    P.re = damp(P.re, re, 12, dt); P.le = damp(P.le, le, 12, dt);
    P.head = damp(P.head, headP, 10, dt);
    P.core = damp(P.core, coreB, 8, dt);
    P.cape = damp(P.cape, capeB + mv * 0.25, 4, dt);
    P.sword = damp(P.sword, sw, 12, dt);

    float.position.y = (HOVER + Math.sin(t * 1.6) * 0.18 + P.rise) * (1 - dead) - dead * 0.5;
    torso.rotation.x = P.lean + mv * 0.08 + dead * 0.6;
    float.rotation.z = hurt * Math.sin(t * 40) * 0.03;

    armR.sh.rotation.x = -0.35 + P.rx + Math.sin(t * 1.3) * 0.04 + dead * 0.3;
    armR.sh.rotation.z = 0.15 + P.rz + dead * 0.4;
    armR.el.rotation.x = -0.6 + P.re;
    armL.sh.rotation.x = -0.5 + P.lx + Math.sin(t * 1.3 + 1) * 0.05 + dead * 0.3;
    armL.sh.rotation.z = -0.2 + P.lz - dead * 0.4;
    armL.el.rotation.x = -0.9 + P.le;
    sword.rotation.x = 1.3 + P.sword;
    head.rotation.x = P.head + dead * 0.5;

    for (let r = 0; r < capeRows.length; r++) {
      capeRows[r].rotation.x = (r === 0 ? 0.22 : 0.06) + Math.sin(t * 2.2 - r * 0.9) * 0.07 + P.cape * (r === 0 ? 1 : 0.35);
    }
    for (let i = 0; i < tendrils.length; i++) {
      tendrils[i].rotation.x = Math.sin(t * 2 + i) * 0.15 - mv * 0.2;
      tendrils[i].rotation.z = Math.cos(t * 1.7 + i * 1.3) * 0.15;
    }

    // 阶段：翅膀 / 光环 / 发光倍率
    wingS = damp(wingS, phase >= 2 && dead < 1 ? 1 : 0, 3, dt);
    for (let i = 0; i < 2; i++) {
      const W = wings[i];
      const ws = Math.max(0.001, wingS);
      W.g.visible = wingS > 0.02;
      W.g.scale.set(W.sd * ws, ws, ws);
      W.g.rotation.y = W.sd * (0.35 + Math.sin(t * 2.2) * 0.3 - P.cape * 0.3);
      W.g.rotation.z = W.sd * (0.2 + Math.sin(t * 2.4) * 0.3 * (1 - dead));
    }
    const auraTarget = phase === 3 ? 4.3 : phase === 2 ? 3.3 : 2.8;
    const auraOp = phase === 3 ? 0.22 : phase === 2 ? 0.12 : 0.07;
    auraS = damp(auraS, auraTarget, 3, dt);
    auraO = damp(auraO, auraOp * (1 - dead), 3, dt);
    phaseMul = damp(phaseMul, phase === 3 ? 2.2 : phase === 2 ? 1.4 : 1, 3, dt);
    const ap = auraS * (1 + Math.sin(t * 3) * 0.03);
    aura.scale.set(ap, ap, ap);
    mAura.opacity = auraO;
    aura.visible = auraO > 0.005;
    rune.scale.setScalar(auraS * 1.1);
    rune.rotation.z = t * 0.3;
    rune2.scale.setScalar(auraS * 0.9);
    rune2.rotation.z = -t * 0.5;

    spin += dt * (0.6 + (phaseMul - 1) * 0.8) * (1 - dead);
    spin2 -= dt * 1.2 * (1 - dead);
    orbit.rotation.y = spin;
    orbit.position.y = 2.9 + Math.sin(t * 1.2) * 0.2 - dead * 2.6;
    orbit.scale.setScalar(1 - dead * 0.5);
    orbit2.visible = phase >= 3 && dead < 1;
    orbit2.rotation.y = spin2;
    for (let i = 0; i < crystals.length; i++) {
      crystals[i].rotation.y = t * 2 + i;
      crystals[i].position.y = Math.sin(t * 2 + i * 1.7) * 0.3;
    }

    const fade = 1 - dead * 0.9;
    const pulse = Math.sin(t * 3);
    mGlow.emissiveIntensity = (2 + 0.5 * pulse + P.core) * phaseMul * fade;
    mEye.emissiveIntensity = (3.5 + P.core) * phaseMul * fade;
    mCrystal.emissiveIntensity = (0.7 + 0.3 * pulse) * phaseMul * fade;
    mWing.emissiveIntensity = 0.12 * phaseMul * fade;
    const os = 0.28 * (1 + P.core * 0.25 + 0.05 * pulse);
    orb.scale.set(os, os, os);
    orbRing.rotation.z = t * 2;
    coreGem.rotation.z = Math.sin(t) * 0.1;
    rig.rotation.x = -dead * 0.9;
    rig.position.y = -dead * 2.2;
  }

  return { root, rig, muzzle, update };
}

// ---------------------------------------------------------------------
//  导出
// ---------------------------------------------------------------------
const BUILDERS = {
  spider: buildSpider,
  sandworm: buildSandworm,
  frostGiant: buildFrostGiant,
  hydra: buildHydra,
  magmaGolem: buildMagmaGolem,
  overlord: buildOverlord,
};

export const BOSS_MODEL_TYPES = Object.keys(BUILDERS);

export function createBossModel(type, def = {}) {
  let build = BUILDERS[type];
  if (!build) {
    console.warn(`[bosses] 未知首领类型 "${type}"，使用 spider 代替`);
    build = buildSpider;
  }
  const m = build(def);
  m.root.name = `boss-${type}`;
  m.root.userData.bossType = type;
  const size = { height: def.height ?? 5, radius: def.radius ?? 3 };
  const update = m.update;
  // 初始化一帧静止姿态
  update(0, { t: 0, move: 0, attack: -1, pattern: null, hurt: 0, dead: 0, phase: 1, burrow: 0 });
  return { root: m.root, muzzle: m.muzzle, size, update };
}
