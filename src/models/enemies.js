// =====================================================================
//  普通怪物模型（14 种）—— 低多边形程序化建模 + 程序化动画
//  契约见 CONTRACTS.md §3：createEnemyModel(type, def) -> { root, muzzle, size, update }
// =====================================================================
import * as THREE from 'three';

const PI = Math.PI;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------
//  几何体缓存（几何体可跨实例共享；材质每个实例新建）
// ---------------------------------------------------------------------
const geoCache = new Map();
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

const G = {
  box: (w, h, d) => cached(`box|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)),
  sph: (r, ws = 10, hs = 8) => cached(`sph|${r}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs)),
  hemi: (r, ws = 12) => cached(`hemi|${r}|${ws}`, () => new THREE.SphereGeometry(r, ws, 6, 0, TAU, 0, PI / 2)),
  cyl: (rt, rb, h, s = 8) => cached(`cyl|${rt}|${rb}|${h}|${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s)),
  cone: (r, h, s = 6) => cached(`cone|${r}|${h}|${s}`, () => new THREE.ConeGeometry(r, h, s)),
  ico: (r, d = 0) => cached(`ico|${r}|${d}`, () => new THREE.IcosahedronGeometry(r, d)),
  dodec: (r) => cached(`dod|${r}`, () => new THREE.DodecahedronGeometry(r, 0)),
  oct: (r) => cached(`oct|${r}`, () => new THREE.OctahedronGeometry(r, 0)),
  torus: (r, t, rs = 6, ts = 12, arc = TAU) =>
    cached(`tor|${r}|${t}|${rs}|${ts}|${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc)),
  // 蝙蝠翼膜（右翼，展向 +X，弦向 +Y；网格绕 X 旋转 -90° 后弦向朝 -Z）
  wing: () => cached('batwing', () => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.05);
    s.lineTo(0.5, -0.12);
    s.lineTo(1.25, 0.0);
    s.lineTo(1.05, 0.28);
    s.lineTo(0.82, 0.2);
    s.lineTo(0.66, 0.46);
    s.lineTo(0.44, 0.3);
    s.lineTo(0.24, 0.5);
    s.lineTo(0.0, 0.34);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  }),
};

// ---------------------------------------------------------------------
//  材质 & 构建辅助
// ---------------------------------------------------------------------
function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, metalness: 0, ...o });
}
function glowMat(color, intensity = 1.6, o = {}) {
  return mat(color, { emissive: color, emissiveIntensity: intensity, roughness: 0.4, ...o });
}
const _c = new THREE.Color();
function shade(hex, f) {
  return _c.setHex(hex).multiplyScalar(f).getHex();
}
function add(parent, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function grp(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------------
//  动画曲线：攻击进度 a ∈ [0,1]（a<0 表示未攻击）
//  windup 蓄力 0→1（0~0.45），strike 出手 0→1（0.45~0.6）后回收（0.6~1）
// ---------------------------------------------------------------------
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ss = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
const lerp = (a, b, t) => a + (b - a) * t;
function windup(a) {
  if (a < 0) return 0;
  if (a < 0.45) return ss(a / 0.45);
  if (a < 0.6) return 1 - ss((a - 0.45) / 0.15);
  return 0;
}
function strike(a) {
  if (a < 0.45) return 0;
  if (a < 0.6) return ss((a - 0.45) / 0.15);
  return 1 - ss((a - 0.6) / 0.4);
}
// 攻击姿态权重：前 20% 进入、后 25% 退出
function stance(a) {
  if (a < 0) return 0;
  return ss(Math.min(1, a / 0.2, (1 - a) / 0.25));
}

// =====================================================================
//  各怪物构建器：build(c) -> { designR, muzzle, anim(t, mv, a, hurt, d, dt), customDeath?, groundY? }
//  c = { def, color, base }；base 为可动画的根节点（通用层负责悬浮高度、受击、倒地）
// =====================================================================

// ---------------- 史莱姆 ----------------
function buildSlime(c) {
  const jellyM = mat(c.color, { transparent: true, opacity: 0.8, roughness: 0.25 });
  const coreM = mat(shade(c.color, 0.5), { roughness: 0.5 });
  const whiteM = mat(0xffffff, { roughness: 0.3 });
  const blackM = mat(0x111111, { roughness: 0.3 });

  const body = grp(c.base);
  const jelly = add(body, G.ico(0.9, 1), jellyM, 0, 0.74, 0);
  jelly.scale.set(1, 0.82, 1);
  const core = add(body, G.ico(0.3, 0), coreM, 0, 0.62, -0.05);
  const shine = add(body, G.sph(0.14), whiteM, -0.34, 1.2, 0.3);
  shine.scale.set(1, 0.55, 1);
  const eyes = grp(body, 0, 0.9, 0);
  add(eyes, G.sph(0.17), whiteM, -0.28, 0, 0.72);
  add(eyes, G.sph(0.17), whiteM, 0.28, 0, 0.72);
  add(eyes, G.sph(0.085), blackM, -0.27, -0.01, 0.87);
  add(eyes, G.sph(0.085), blackM, 0.27, -0.01, 0.87);
  const mouth = add(body, G.torus(0.12, 0.03, 4, 10, PI), blackM, 0, 0.66, 0.87);
  mouth.rotation.z = PI;
  const muzzle = grp(body, 0, 0.75, 0.95);

  return {
    designR: 0.9, customDeath: true, muzzle,
    anim(t, mv, a, hurt, d) {
      const m = Math.min(mv, 1.3);
      const cyc = (t * (1.1 + 1.7 * m)) % 1;
      const air = Math.sin(cyc * PI);
      const w = windup(a), s = strike(a);
      let h = air * 0.5 * m + 0.55 * s;
      let sy = 1 + (0.16 * air - 0.2 * (1 - air) ** 3) * m + 0.04 * Math.sin(t * 3.1);
      sy *= 1 - 0.3 * w + 0.28 * s;
      let sxz = 1 / Math.sqrt(sy);
      if (d > 0) {
        const e = ss(d);
        sy *= 1 - 0.85 * e;
        sxz *= 1 + 0.7 * e;
        h *= 1 - e;
      }
      body.scale.set(sxz, sy, sxz);
      body.position.set(0, h, 0.9 * s);
      jellyM.opacity = 0.8 * (1 - 0.5 * d);
      eyes.scale.y = (t * 0.31) % 1 > 0.95 ? 0.15 : 1;
      core.rotation.set(t * 0.7, t * 1.1, 0);
      core.position.y = 0.62 + 0.05 * Math.sin(t * 2.2);
    },
  };
}

// ---------------- 哥布林 ----------------
function buildGoblin(c) {
  const skin = mat(c.color), cloth = mat(0x7a4a2a), dark = mat(0x3a2a1a), wood = mat(0x6a4020);
  const eyeM = glowMat(0xffe040, 1.3), tooth = mat(0xf0ead0);

  const hips = grp(c.base, 0, 0.62, 0);
  add(hips, G.box(0.58, 0.24, 0.44), cloth, 0, -0.02, 0);
  const torso = grp(hips, 0, 0.08, 0);
  add(torso, G.box(0.54, 0.5, 0.38), skin, 0, 0.26, 0);
  add(torso, G.sph(0.25), skin, 0, 0.16, 0.1);
  const strap = add(torso, G.box(0.1, 0.66, 0.42), dark, 0, 0.28, 0);
  strap.rotation.z = 0.7;

  const head = grp(torso, 0, 0.62, 0.02);
  add(head, G.sph(0.3, 10, 8), skin, 0, 0.1, 0).scale.set(1.1, 0.95, 1);
  const earL = add(head, G.cone(0.1, 0.5, 4), skin, -0.38, 0.16, -0.02);
  earL.rotation.z = PI / 2 - 0.3;
  const earR = add(head, G.cone(0.1, 0.5, 4), skin, 0.38, 0.16, -0.02);
  earR.rotation.z = -(PI / 2 - 0.3);
  add(head, G.cone(0.07, 0.24, 4), skin, 0, 0.06, 0.34).rotation.x = PI / 2;
  add(head, G.sph(0.06, 6, 4), eyeM, -0.12, 0.18, 0.26);
  add(head, G.sph(0.06, 6, 4), eyeM, 0.12, 0.18, 0.26);
  add(head, G.box(0.38, 0.05, 0.08), dark, 0, 0.27, 0.25);
  add(head, G.cone(0.03, 0.09, 3), tooth, -0.08, -0.05, 0.25);
  add(head, G.cone(0.03, 0.09, 3), tooth, 0.08, -0.05, 0.25);

  const armL = grp(torso, -0.35, 0.44, 0);
  add(armL, G.box(0.14, 0.48, 0.14), skin, 0, -0.24, 0);
  add(armL, G.sph(0.09), skin, 0, -0.52, 0);
  const armR = grp(torso, 0.35, 0.44, 0);
  add(armR, G.box(0.14, 0.48, 0.14), skin, 0, -0.24, 0);
  add(armR, G.sph(0.09), skin, 0, -0.52, 0);
  const club = grp(armR, 0, -0.52, 0);
  club.rotation.x = 2.2;
  add(club, G.cyl(0.045, 0.05, 0.42, 6), wood, 0, 0.12, 0);
  add(club, G.cyl(0.15, 0.08, 0.5, 7), wood, 0, 0.5, 0);
  add(club, G.cone(0.05, 0.14, 4), dark, 0.15, 0.55, 0).rotation.z = -PI / 2;
  add(club, G.cone(0.05, 0.14, 4), dark, -0.15, 0.62, 0).rotation.z = PI / 2;

  const legL = grp(hips, -0.15, 0, 0), legR = grp(hips, 0.15, 0, 0);
  for (const L of [legL, legR]) {
    add(L, G.box(0.17, 0.46, 0.18), skin, 0, -0.25, 0);
    add(L, G.box(0.2, 0.1, 0.3), dark, 0, -0.55, 0.05);
  }
  const muzzle = grp(head, 0, 0.1, 0.36);

  return {
    designR: 0.7, muzzle,
    anim(t, mv, a) {
      const m = Math.min(mv, 1.4), p = t * (6 + 5 * m);
      const sw = Math.sin(p) * 0.7 * m;
      legL.rotation.x = sw;
      legR.rotation.x = -sw;
      hips.position.y = 0.62 + Math.abs(Math.cos(p)) * 0.06 * m + 0.012 * Math.sin(t * 2);
      const w = windup(a), s = strike(a), act = Math.max(w, s);
      torso.rotation.set(0.1 * m - 0.25 * w + 0.35 * s, sw * 0.12 - 0.3 * w + 0.3 * s, 0);
      armL.rotation.x = -sw * 0.8 * (1 - act) - 0.3 * act;
      armR.rotation.x = (-0.5 + sw * 0.5) * (1 - act) - 3.3 * w - 0.4 * s;
      head.rotation.x = 0.06 * Math.sin(t * 1.7);
      earL.rotation.x = 0.15 * Math.sin(t * 3.3);
      earR.rotation.x = 0.15 * Math.sin(t * 3.3 + 1);
    },
  };
}

// ---------------- 吸血蝙蝠 ----------------
function buildBat(c) {
  const fur = mat(c.color), wingM = mat(shade(c.color, 0.7), { side: THREE.DoubleSide });
  const eyeM = glowMat(0xff3030, 2.2), fang = mat(0xffffff);

  const body = grp(c.base);
  add(body, G.sph(0.32), fur).scale.set(1, 1.05, 1.2);
  const head = grp(body, 0, 0.22, 0.28);
  add(head, G.sph(0.24), fur);
  add(head, G.cone(0.09, 0.3, 4), fur, -0.13, 0.26, -0.02).rotation.z = 0.25;
  add(head, G.cone(0.09, 0.3, 4), fur, 0.13, 0.26, -0.02).rotation.z = -0.25;
  add(head, G.sph(0.05, 6, 4), eyeM, -0.09, 0.06, 0.2);
  add(head, G.sph(0.05, 6, 4), eyeM, 0.09, 0.06, 0.2);
  add(head, G.cone(0.025, 0.1, 3), fang, -0.05, -0.12, 0.19).rotation.x = PI;
  add(head, G.cone(0.025, 0.1, 3), fang, 0.05, -0.12, 0.19).rotation.x = PI;

  const wL = grp(body, -0.22, 0.08, 0.02), wR = grp(body, 0.22, 0.08, 0.02);
  add(wR, G.wing(), wingM).rotation.x = -PI / 2;
  const mL = add(wL, G.wing(), wingM);
  mL.rotation.x = -PI / 2;
  mL.scale.x = -1;
  add(wR, G.box(1.2, 0.05, 0.05), fur, 0.6, 0, 0.05);
  add(wL, G.box(1.2, 0.05, 0.05), fur, -0.6, 0, 0.05);
  add(body, G.cone(0.05, 0.18, 3), fur, -0.1, -0.35, -0.1).rotation.x = PI;
  add(body, G.cone(0.05, 0.18, 3), fur, 0.1, -0.35, -0.1).rotation.x = PI;
  const muzzle = grp(head, 0, 0, 0.3);

  return {
    designR: 0.7, groundY: 0.35, muzzle,
    anim(t, mv, a, hurt, d) {
      const flap = Math.sin(t * (13 + 5 * mv));
      const fold = ss(d * 2);
      wR.rotation.z = lerp(flap * 0.85 + 0.1, -1.1, fold);
      wL.rotation.z = -wR.rotation.z;
      const w = windup(a), s = strike(a);
      c.base.position.y += 0.28 * Math.sin(t * 2.3) + 0.12 * flap + 0.5 * w - 1.9 * s;
      c.base.rotation.x = 0.25 * Math.min(mv, 1) + 0.6 * s - 0.3 * w;
      head.rotation.x = -0.1 * Math.sin(t * 1.3);
    },
  };
}

// ---------------- 沙漠巨蝎 ----------------
function buildScorpion(c) {
  const shell = mat(c.color, { roughness: 0.55 }), dark = mat(shade(c.color, 0.6), { roughness: 0.6 });
  const eyeM = mat(0x111111, { roughness: 0.2 }), stingM = glowMat(0xc8ff3a, 1.4);

  const body = grp(c.base, 0, 0.5, 0);
  add(body, G.box(0.86, 0.34, 0.78), shell, 0, 0.04, 0.45);
  add(body, G.sph(0.06, 6, 4), eyeM, -0.12, 0.24, 0.72);
  add(body, G.sph(0.06, 6, 4), eyeM, 0.12, 0.24, 0.72);
  for (const [w, h, l, z] of [[0.94, 0.32, 0.4, 0.0], [0.84, 0.3, 0.38, -0.38], [0.7, 0.27, 0.36, -0.72]]) {
    add(body, G.box(w, h, l), shell, 0, 0.02, z);
  }

  const legs = [];
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 4; i++) {
      const p = grp(body, side * 0.4, 0, 0.45 - i * 0.26);
      const up = add(p, G.box(0.5, 0.08, 0.08), dark, side * 0.22, 0.12, 0);
      up.rotation.z = side * 0.45;
      const lo = add(p, G.box(0.07, 0.72, 0.07), dark, side * 0.6, -0.14, 0);
      lo.rotation.z = side * 0.3;
      legs.push({ p, side, i, yaw: -side * (0.35 - i * 0.23) });
    }
  }

  const claws = [];
  for (const side of [-1, 1]) {
    const arm = grp(body, side * 0.32, 0.05, 0.78);
    arm.rotation.y = side * 0.35;
    add(arm, G.box(0.13, 0.12, 0.5), dark, 0, 0, 0.25);
    const hand = grp(arm, 0, 0.05, 0.55);
    hand.rotation.y = -side * 0.55;
    add(hand, G.sph(0.17, 8, 6), shell, 0, 0, 0.1).scale.set(1, 0.8, 1.5);
    add(hand, G.cone(0.06, 0.38, 4), shell, side * 0.06, 0, 0.42).rotation.x = PI / 2;
    const jaw = grp(hand, -side * 0.06, 0, 0.26);
    add(jaw, G.cone(0.05, 0.34, 4), shell, 0, 0, 0.16).rotation.x = PI / 2;
    claws.push({ arm, jaw, side });
  }

  const TL = 0.34;
  const tail = [];
  let parent = grp(body, 0, 0.08, -0.9);
  for (let i = 0; i < 5; i++) {
    const seg = i === 0 ? parent : grp(parent, 0, 0, -TL);
    add(seg, G.box(0.3 - i * 0.03, 0.24 - i * 0.015, TL), shell, 0, 0, -TL / 2);
    tail.push(seg);
    parent = seg;
  }
  const sting = grp(parent, 0, 0, -TL);
  add(sting, G.sph(0.14, 7, 5), shell, 0, 0, -0.1).scale.set(1, 0.9, 1.3);
  add(sting, G.cone(0.06, 0.34, 5), stingM, 0, 0.06, -0.32).rotation.x = -PI / 2 + 0.5;
  const muzzle = grp(sting, 0, 0.1, -0.45);
  const CURL = [0.85, 0.65, 0.65, 0.65, 0.6];

  return {
    designR: 1.3, muzzle,
    anim(t, mv, a) {
      const m = Math.min(mv, 1.5), p = t * (8 + 6 * m);
      for (const L of legs) {
        const q = p + L.i * 1.6 + (L.side > 0 ? PI : 0);
        L.p.rotation.y = L.yaw + Math.sin(q) * 0.3 * m;
        L.p.rotation.z = L.side * Math.max(0, Math.cos(q)) * 0.25 * m;
      }
      const w = windup(a), s = strike(a);
      for (let i = 0; i < 5; i++) {
        tail[i].rotation.x = CURL[i] + (i === 0 ? 0.55 * s - 0.25 * w : 0.1 * w - 0.08 * s) + 0.04 * Math.sin(t * 2 + i);
      }
      tail[0].rotation.y = 0.15 * Math.sin(t * 1.3);
      for (const cl of claws) {
        cl.jaw.rotation.y = cl.side * (0.3 + 0.2 * Math.sin(t * 4 + cl.side) + 0.3 * w - 0.4 * s);
        cl.arm.rotation.x = -0.25 * w + 0.15 * s;
      }
      body.position.set(0, 0.5 + 0.02 * Math.sin(p * 2) * m, -0.1 * w + 0.28 * s);
    },
  };
}

// ---------------- 骷髅骨架（战士 / 弓手共用） ----------------
function skeletonRig(c, eyeColor) {
  const bone = mat(c.color, { roughness: 0.9 }), dark = mat(0x1a1410), eyeM = glowMat(eyeColor, 2.4);
  const hips = grp(c.base, 0, 0.92, 0);
  add(hips, G.box(0.36, 0.14, 0.2), bone);
  const torso = grp(hips, 0, 0.05, 0);
  add(torso, G.cyl(0.045, 0.05, 0.64, 5), bone, 0, 0.32, -0.05);
  const ribY = [0.5, 0.39, 0.28], ribR = [0.2, 0.19, 0.16];
  for (let i = 0; i < 3; i++) {
    add(torso, G.torus(ribR[i], 0.03, 4, 10, PI), bone, 0, ribY[i], -0.05).rotation.x = PI / 2;
  }
  add(torso, G.box(0.52, 0.06, 0.08), bone, 0, 0.62, -0.04);
  const head = grp(torso, 0, 0.72, -0.02);
  add(head, G.sph(0.19, 8, 6), bone, 0, 0.12, 0);
  const jaw = grp(head, 0, 0.02, 0);
  add(jaw, G.box(0.2, 0.07, 0.2), bone, 0, -0.03, 0.07);
  add(head, G.sph(0.06, 6, 4), dark, -0.075, 0.13, 0.14);
  add(head, G.sph(0.06, 6, 4), dark, 0.075, 0.13, 0.14);
  add(head, G.sph(0.03, 5, 4), eyeM, -0.075, 0.13, 0.18);
  add(head, G.sph(0.03, 5, 4), eyeM, 0.075, 0.13, 0.18);

  function limb(parent, x, y, l1, l2, r) {
    const a = grp(parent, x, y, 0);
    add(a, G.cyl(r, r * 0.85, l1, 5), bone, 0, -l1 / 2, 0);
    const j = grp(a, 0, -l1, 0);
    add(j, G.cyl(r * 0.85, r * 0.7, l2, 5), bone, 0, -l2 / 2, 0);
    return [a, j];
  }
  const [armL, elbL] = limb(torso, -0.29, 0.6, 0.32, 0.3, 0.035);
  const [armR, elbR] = limb(torso, 0.29, 0.6, 0.32, 0.3, 0.035);
  add(elbL, G.box(0.08, 0.1, 0.06), bone, 0, -0.34, 0);
  add(elbR, G.box(0.08, 0.1, 0.06), bone, 0, -0.34, 0);
  const [legL, kneeL] = limb(hips, -0.12, -0.04, 0.42, 0.4, 0.04);
  const [legR, kneeR] = limb(hips, 0.12, -0.04, 0.42, 0.4, 0.04);
  add(kneeL, G.box(0.1, 0.05, 0.22), bone, 0, -0.43, 0.05);
  add(kneeR, G.box(0.1, 0.05, 0.22), bone, 0, -0.43, 0.05);
  return { bone, dark, hips, torso, head, jaw, armL, elbL, armR, elbR, legL, kneeL, legR, kneeR };
}

function walkSkeleton(r, t, m) {
  const p = t * (6 + 5 * m), sw = Math.sin(p) * 0.6 * m;
  r.legL.rotation.x = sw;
  r.legR.rotation.x = -sw;
  r.kneeL.rotation.x = Math.max(0, Math.sin(p + 1.2)) * 0.8 * m;
  r.kneeR.rotation.x = Math.max(0, Math.sin(p + PI + 1.2)) * 0.8 * m;
  r.hips.position.y = 0.92 + Math.abs(Math.cos(p)) * 0.04 * m;
  r.torso.rotation.set(0.06 * m, sw * 0.15, 0);
  r.jaw.rotation.x = 0.12 + 0.12 * Math.sin(t * 7);
  r.head.rotation.z = 0.08 * Math.sin(t * 1.1);
  return sw;
}

// ---------------- 骷髅战士 ----------------
function buildSkeleton(c) {
  const r = skeletonRig(c, 0xff5020);
  const metal = mat(0x9aa0a8, { metalness: 0.7, roughness: 0.35 });
  const wood = mat(0x6a4a2a), rimM = mat(0x5a5a60, { metalness: 0.6, roughness: 0.4 });

  const sword = grp(r.elbR, 0, -0.34, 0.02);
  sword.rotation.x = 2.3;
  add(sword, G.cyl(0.025, 0.025, 0.18, 5), wood);
  add(sword, G.box(0.24, 0.04, 0.05), metal, 0, 0.1, 0);
  add(sword, G.box(0.07, 0.75, 0.02), metal, 0, 0.5, 0);
  add(sword, G.cone(0.05, 0.12, 4), metal, 0, 0.93, 0);

  const shield = grp(r.elbL, -0.04, -0.18, 0.08);
  add(shield, G.cyl(0.28, 0.28, 0.05, 10), wood).rotation.x = PI / 2;
  add(shield, G.torus(0.28, 0.03, 4, 12), rimM);
  add(shield, G.sph(0.07, 6, 4), metal, 0, 0, 0.04);
  const muzzle = grp(r.head, 0, 0.1, 0.25);

  return {
    designR: 0.7, muzzle,
    anim(t, mv, a) {
      const m = Math.min(mv, 1.4);
      const sw = walkSkeleton(r, t, m);
      const w = windup(a), s = strike(a), act = Math.max(w, s);
      r.armR.rotation.x = (-0.5 + sw * 0.4) * (1 - act) - 3.2 * w - 0.3 * s;
      r.armR.rotation.z = 0.25 * w - 0.15 * s;
      r.elbR.rotation.x = -0.4 * (1 - act);
      r.armL.rotation.x = (-0.9 - sw * 0.3) * (1 - act) - 1.2 * act;
      r.elbL.rotation.x = -0.6;
      shield.rotation.x = -(r.armL.rotation.x + r.elbL.rotation.x);
      r.torso.rotation.x += -0.2 * w + 0.3 * s;
      r.torso.rotation.y += -0.4 * w + 0.5 * s;
    },
  };
}

// ---------------- 骷髅弓手 ----------------
function buildArcher(c) {
  const r = skeletonRig(c, 0x60ff90);
  const cloth = mat(0x3a3448), wood = mat(0x5a3a1a), stringM = mat(0xe0e0e0);
  const fletch = mat(0xc03030), tip = mat(0x9aa0a8, { metalness: 0.6, roughness: 0.4 });

  add(r.head, G.cone(0.27, 0.46, 6), cloth, 0, 0.3, -0.07);
  add(r.head, G.sph(0.23, 8, 6), cloth, 0, 0.1, -0.12);
  add(r.torso, G.box(0.48, 0.85, 0.05), cloth, 0, 0.3, -0.17).rotation.x = 0.12;
  const quiver = grp(r.torso, 0.1, 0.4, -0.23);
  quiver.rotation.z = -0.4;
  add(quiver, G.cyl(0.08, 0.07, 0.5, 6), wood);
  add(quiver, G.box(0.05, 0.12, 0.02), fletch, 0.03, 0.3, 0);
  add(quiver, G.box(0.05, 0.12, 0.02), fletch, -0.03, 0.32, 0.02);

  // 弓：握在左手，弓臂向 +Z 凸出，弦在后方
  const bow = grp(r.elbL, 0, -0.32, 0.02);
  add(bow, G.torus(0.45, 0.025, 4, 12, PI * 0.9), wood, 0, 0, -0.45).rotation.set(0, PI / 2, 0.55 * PI);
  const TIP_Y = 0.445, TIP_Z = -0.38;
  const sTop = grp(bow, 0, TIP_Y, TIP_Z), sBot = grp(bow, 0, -TIP_Y, TIP_Z);
  add(sTop, G.cyl(0.008, 0.008, TIP_Y, 3), stringM, 0, -TIP_Y / 2, 0);
  add(sBot, G.cyl(0.008, 0.008, TIP_Y, 3), stringM, 0, TIP_Y / 2, 0);
  const arrow = grp(bow, 0, 0, TIP_Z);
  add(arrow, G.box(0.02, 0.02, 0.75), wood, 0, 0, 0.3);
  add(arrow, G.cone(0.03, 0.08, 4), tip, 0, 0, 0.7).rotation.x = PI / 2;
  const muzzle = grp(bow, 0, 0, 0.12);

  return {
    designR: 0.7, muzzle,
    anim(t, mv, a) {
      const m = Math.min(mv, 1.4);
      const sw = walkSkeleton(r, t, m);
      const aim = stance(a), w = windup(a);
      r.armL.rotation.x = lerp(-0.5 - sw * 0.3, -1.45, aim);
      r.elbL.rotation.x = lerp(-0.5, 0, aim);
      r.armR.rotation.x = lerp(sw * 0.4 - 0.2, -1.45, aim);
      r.elbR.rotation.x = -2.4 * w * aim;
      bow.rotation.x = -(r.armL.rotation.x + r.elbL.rotation.x);
      const draw = 0.3 * w;
      const ang = Math.atan2(draw, TIP_Y), len = Math.sqrt(TIP_Y * TIP_Y + draw * draw) / TIP_Y;
      sTop.rotation.x = ang;
      sBot.rotation.x = -ang;
      sTop.scale.y = sBot.scale.y = len;
      arrow.position.z = TIP_Z - draw;
      arrow.scale.setScalar(a >= 0 && a < 0.5 ? 1 : 0.0001);
    },
  };
}

// ---------------- 冰原狼 ----------------
function buildWolf(c) {
  const fur = mat(c.color), dark = mat(shade(c.color, 0.7));
  const ice = mat(0xa8e4ff, { emissive: 0x3aa8ff, emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.1 });
  const eyeM = glowMat(0x7ae8ff, 2.5), nose = mat(0x1a1a22);

  const body = grp(c.base, 0, 0.97, 0);
  add(body, G.box(0.6, 0.52, 1.25), fur, 0, 0, -0.05);
  add(body, G.box(0.68, 0.62, 0.5), fur, 0, 0.04, 0.42);
  add(body, G.ico(0.4, 0), dark, 0, 0.12, 0.52).scale.set(1, 0.9, 0.8);

  const head = grp(body, 0, 0.3, 0.78);
  add(head, G.box(0.42, 0.36, 0.42), fur, 0, 0.04, 0.08);
  add(head, G.box(0.24, 0.18, 0.34), fur, 0, -0.03, 0.42);
  add(head, G.box(0.1, 0.08, 0.06), nose, 0, 0.04, 0.6);
  const jaw = grp(head, 0, -0.12, 0.26);
  add(jaw, G.box(0.2, 0.07, 0.32), dark, 0, 0, 0.14);
  const earL = add(head, G.cone(0.08, 0.26, 4), dark, -0.13, 0.33, 0.02);
  const earR = add(head, G.cone(0.08, 0.26, 4), dark, 0.13, 0.33, 0.02);
  add(head, G.sph(0.045, 6, 4), eyeM, -0.12, 0.12, 0.3);
  add(head, G.sph(0.045, 6, 4), eyeM, 0.12, 0.12, 0.3);

  const tail = grp(body, 0, 0.15, -0.66);
  add(tail, G.cone(0.13, 0.8, 5), fur, 0, 0.2, -0.35).rotation.x = -1.05;
  for (let i = 0; i < 3; i++) {
    add(body, G.cone(0.08, 0.34 - i * 0.06, 4), ice, 0, 0.32, 0.3 - i * 0.3).rotation.x = -0.4;
  }

  const legs = [];
  for (const [x, z, off] of [[-0.22, 0.48, 0], [0.22, 0.48, PI], [-0.22, -0.52, PI], [0.22, -0.52, 0]]) {
    const L = grp(body, x, -0.12, z);
    add(L, G.box(0.16, 0.46, 0.2), fur, 0, -0.2, 0);
    const K = grp(L, 0, -0.42, 0);
    add(K, G.box(0.12, 0.42, 0.14), fur, 0, -0.2, 0);
    add(K, G.box(0.16, 0.08, 0.2), dark, 0, -0.42, 0.04);
    legs.push({ L, K, off, dir: z > 0 ? 1 : -1 });
  }
  const muzzle = grp(head, 0, 0, 0.62);

  return {
    designR: 1.0, muzzle,
    anim(t, mv, a) {
      const m = Math.min(mv, 1.6), p = t * (7 + 6 * m);
      for (const g of legs) {
        const q = p + g.off;
        g.L.rotation.x = Math.sin(q) * 0.55 * m;
        g.K.rotation.x = g.dir * Math.max(0, Math.cos(q)) * 0.6 * m;
      }
      const w = windup(a), s = strike(a);
      body.position.set(0, 0.97 + Math.abs(Math.sin(p)) * 0.05 * m, -0.2 * w + 0.55 * s);
      body.rotation.x = 0.04 * Math.sin(p * 2) * m - 0.12 * w + 0.18 * s;
      head.rotation.x = 0.05 * Math.sin(p) - 0.35 * w + 0.35 * s;
      jaw.rotation.x = 0.12 + 0.06 * Math.sin(t * 5) + 0.7 * w;
      tail.rotation.y = Math.sin(t * (3 + 4 * m)) * 0.35;
      earL.rotation.z = 0.1 * Math.sin(t * 2);
      earR.rotation.z = -0.1 * Math.sin(t * 2 + 0.5);
    },
  };
}

// ---------------- 雪怪 ----------------
function buildYeti(c) {
  const furM = mat(c.color, { roughness: 1 }), skinM = mat(0x7a8aa8), hornM = mat(0xe0d8c0);
  const eyeM = glowMat(0x40c0ff, 1.8), mouthM = mat(0x3a1a2a), tooth = mat(0xffffff);

  const hips = grp(c.base, 0, 1.0, 0);
  add(hips, G.ico(0.6, 1), furM, 0, 0.1, 0).scale.set(1.1, 0.8, 0.9);
  const torso = grp(hips, 0, 0.3, 0);
  add(torso, G.ico(0.95, 1), furM, 0, 0.75, 0).scale.set(1.15, 1.0, 0.85);
  add(torso, G.sph(0.55, 8, 6), skinM, 0, 0.55, 0.45).scale.set(1, 1.1, 0.4);
  for (const [x, y, z, rz] of [[-0.8, 1.45, 0, 0.6], [0.8, 1.45, 0, -0.6], [-0.4, 1.6, -0.3, 0.3], [0.4, 1.6, -0.3, -0.3]]) {
    add(torso, G.cone(0.2, 0.45, 5), furM, x, y, z).rotation.z = rz;
  }
  const head = grp(torso, 0, 1.55, 0.2);
  add(head, G.ico(0.5, 1), furM, 0, 0.1, 0);
  add(head, G.sph(0.34, 8, 6), skinM, 0, 0.02, 0.26).scale.set(1, 0.9, 0.6);
  add(head, G.sph(0.06, 6, 4), eyeM, -0.13, 0.12, 0.45);
  add(head, G.sph(0.06, 6, 4), eyeM, 0.13, 0.12, 0.45);
  add(head, G.box(0.45, 0.08, 0.1), furM, 0, 0.22, 0.42);
  const jaw = grp(head, 0, -0.1, 0.3);
  add(jaw, G.box(0.3, 0.1, 0.12), mouthM, 0, -0.03, 0.14);
  add(jaw, G.cone(0.035, 0.12, 4), tooth, -0.1, 0.03, 0.18);
  add(jaw, G.cone(0.035, 0.12, 4), tooth, 0.1, 0.03, 0.18);
  add(head, G.cone(0.09, 0.4, 5), hornM, -0.38, 0.42, -0.05).rotation.z = 0.6;
  add(head, G.cone(0.09, 0.4, 5), hornM, 0.38, 0.42, -0.05).rotation.z = -0.6;

  const arms = [];
  for (const side of [-1, 1]) {
    const arm = grp(torso, side * 1.0, 1.0, 0);
    add(arm, G.cyl(0.3, 0.26, 0.9, 7), furM, 0, -0.45, 0);
    const elb = grp(arm, 0, -0.9, 0);
    add(elb, G.cyl(0.28, 0.24, 0.8, 7), furM, 0, -0.4, 0);
    add(elb, G.dodec(0.36), skinM, 0, -0.9, 0.05);
    arms.push({ arm, elb, side });
  }
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = grp(hips, side * 0.45, 0, 0);
    add(leg, G.cyl(0.32, 0.28, 0.55, 7), furM, 0, -0.28, 0);
    const knee = grp(leg, 0, -0.55, 0);
    add(knee, G.cyl(0.28, 0.26, 0.4, 7), furM, 0, -0.2, 0);
    add(knee, G.box(0.5, 0.18, 0.7), skinM, 0, -0.42, 0.12);
    legs.push({ leg, knee, side });
  }
  const muzzle = grp(head, 0, 0, 0.55);

  return {
    designR: 1.6, muzzle,
    anim(t, mv, a) {
      const m = Math.min(mv, 1.4), p = t * (4 + 3.5 * m);
      const sw = Math.sin(p) * 0.45 * m;
      const w = windup(a), s = strike(a), act = Math.max(w, s);
      legs[0].leg.rotation.x = sw;
      legs[1].leg.rotation.x = -sw;
      legs[0].knee.rotation.x = Math.max(0, Math.sin(p + 1.2)) * 0.6 * m;
      legs[1].knee.rotation.x = Math.max(0, Math.sin(p + PI + 1.2)) * 0.6 * m;
      hips.position.y = 1.0 + Math.abs(Math.cos(p)) * 0.08 * m - 0.15 * s;
      hips.rotation.z = Math.sin(p) * 0.08 * m;
      torso.rotation.x = 0.15 + 0.05 * m - 0.3 * w + 0.5 * s;
      for (const A of arms) {
        const walkA = (A.side < 0 ? -sw : sw) * 0.7;
        A.arm.rotation.x = walkA * (1 - act) - 3.0 * w - 0.9 * s;
        A.arm.rotation.z = A.side * (0.15 + 0.05 * Math.sin(t * 1.5)) * (1 - act) - A.side * 0.25 * w;
        A.elb.rotation.x = -0.3 * (1 - act) - 0.4 * w;
      }
      head.rotation.x = -0.15 + 0.05 * Math.sin(t * 1.3) + 0.2 * w - 0.15 * s;
      jaw.rotation.x = 0.1 + 0.5 * w + 0.4 * s;
    },
  };
}

// ---------------- 毒孢菇 ----------------
function buildMushroom(c) {
  const capM = mat(c.color), spotM = mat(0xfff4e0), stemM = mat(0xf0e2c8), gillM = mat(0x8a6a7a);
  const faceM = mat(0x2a1a2a), eyeM = glowMat(0xfff080, 1.2);

  const body = grp(c.base);
  add(body, G.cyl(0.36, 0.46, 0.9, 9), stemM, 0, 0.62, 0);
  const legL = grp(body, -0.2, 0.25, 0), legR = grp(body, 0.2, 0.25, 0);
  add(legL, G.sph(0.18, 7, 5), stemM, 0, -0.13, 0.08).scale.set(1, 0.7, 1.3);
  add(legR, G.sph(0.18, 7, 5), stemM, 0, -0.13, 0.08).scale.set(1, 0.7, 1.3);
  add(body, G.sph(0.075, 6, 5), faceM, -0.14, 0.8, 0.37).scale.set(0.9, 1.4, 0.6);
  add(body, G.sph(0.075, 6, 5), faceM, 0.14, 0.8, 0.37).scale.set(0.9, 1.4, 0.6);
  add(body, G.sph(0.03, 5, 4), eyeM, -0.13, 0.82, 0.41);
  add(body, G.sph(0.03, 5, 4), eyeM, 0.13, 0.82, 0.41);
  add(body, G.box(0.14, 0.035, 0.04), faceM, -0.15, 0.93, 0.38).rotation.z = -0.35;
  add(body, G.box(0.14, 0.035, 0.04), faceM, 0.15, 0.93, 0.38).rotation.z = 0.35;
  const mouth = add(body, G.box(0.16, 0.05, 0.04), faceM, 0, 0.6, 0.41);

  const cap = grp(body, 0, 1.05, 0);
  add(cap, G.hemi(0.9, 12), capM).scale.set(1, 0.75, 1);
  add(cap, G.cyl(0.88, 0.5, 0.18, 12), gillM, 0, -0.06, 0);
  const Z = new THREE.Vector3(0, 0, 1), n = new THREE.Vector3();
  const spots = [[0, 1.35], [1.3, 0.55], [2.5, 0.8], [3.7, 0.5], [4.8, 0.85], [5.7, 0.45]];
  for (const [az, el] of spots) {
    const x = 0.9 * Math.cos(el) * Math.sin(az), y = 0.675 * Math.sin(el), z = 0.9 * Math.cos(el) * Math.cos(az);
    const sp = add(cap, G.sph(0.15, 7, 5), spotM, x, y, z);
    sp.scale.set(1, 1, 0.35);
    n.set(x / 0.81, y / 0.4556, z / 0.81).normalize();
    sp.quaternion.setFromUnitVectors(Z, n);
  }
  const muzzle = grp(cap, 0, 0.72, 0);

  return {
    designR: 0.9, muzzle,
    anim(t, mv, a, hurt, d) {
      const m = Math.min(mv, 1.4), p = t * (6 + 4 * m);
      legL.rotation.x = Math.sin(p) * 0.6 * m;
      legR.rotation.x = -Math.sin(p) * 0.6 * m;
      body.rotation.z = Math.sin(p) * 0.12 * m + 0.03 * Math.sin(t * 1.4);
      body.position.y = Math.abs(Math.cos(p)) * 0.05 * m;
      const w = windup(a), s = strike(a);
      const sy = 1 - 0.25 * w + 0.3 * s, sxz = 1 + 0.12 * w + 0.12 * s;
      cap.scale.set(sxz, sy, sxz);
      cap.position.y = 1.05 - 0.08 * w + 0.1 * s - 0.35 * d;
      cap.rotation.x = 0.04 * Math.sin(t * 1.9) + 0.6 * ss(d);
      body.scale.y = 1 - 0.18 * w + 0.1 * s;
      mouth.scale.y = 1 + 2.5 * s;
    },
  };
}

// ---------------- 幽魂鬼火 ----------------
function buildWisp(c) {
  const coreM = glowMat(c.color, 2.5, { transparent: true, opacity: 0.9 });
  const flameM = glowMat(c.color, 1.6, { transparent: true, opacity: 0.5, depthWrite: false });
  const innerM = glowMat(0xffffff, 2.2), eyeM = mat(0x0a1a1a, { roughness: 0.3 });

  const body = grp(c.base);
  const core = add(body, G.ico(0.42, 1), coreM);
  add(body, G.ico(0.22, 0), innerM);
  const flames = [
    add(body, G.cone(0.4, 1.1, 7), flameM, 0, 0.45, -0.05),
    add(body, G.cone(0.26, 0.85, 6), flameM, 0.16, 0.45, -0.12),
    add(body, G.cone(0.26, 0.85, 6), flameM, -0.16, 0.45, -0.12),
  ];
  flames[1].rotation.z = -0.35;
  flames[2].rotation.z = 0.35;
  add(body, G.sph(0.07, 6, 5), eyeM, -0.14, 0.06, 0.37).scale.set(0.8, 1.4, 0.5);
  add(body, G.sph(0.07, 6, 5), eyeM, 0.14, 0.06, 0.37).scale.set(0.8, 1.4, 0.5);
  add(body, G.sph(0.06, 6, 5), eyeM, 0, -0.13, 0.39).scale.set(1.2, 0.8, 0.5);
  const trail = [];
  for (let i = 0; i < 5; i++) trail.push(add(body, G.ico(0.14 - i * 0.022, 0), coreM));
  const muzzle = grp(body, 0, 0, 0.5);

  return {
    designR: 0.7, customDeath: true, muzzle,
    anim(t, mv, a, hurt, d) {
      const w = windup(a), s = strike(a);
      c.base.position.y += 0.3 * Math.sin(t * 1.8) + 1.6 * ss(d);
      body.rotation.set(0.25 * Math.min(mv, 1), 0.3 * Math.sin(t * 0.7) + d * 6, 0);
      const pulse = 1 + 0.06 * Math.sin(t * 7) + 0.45 * w - 0.2 * s;
      core.scale.setScalar(pulse);
      for (let i = 0; i < 3; i++) {
        const f = flames[i];
        f.scale.set(1 + 0.1 * Math.sin(t * 13 + i * 2), (1 + 0.25 * Math.sin(t * 9 + i * 1.7)) * (1 + 0.5 * w), 1);
        f.rotation.x = -0.5 * Math.min(mv, 1.2) - 0.1 * Math.sin(t * 5 + i);
      }
      for (let i = 0; i < 5; i++) {
        const q = t * 2.2 - i * 0.7;
        trail[i].position.set(Math.sin(q) * 0.3, -0.25 - i * 0.12 + 0.05 * Math.cos(q * 1.3), -0.35 - i * 0.26);
      }
      body.scale.setScalar(Math.max(0.001, 1 - ss(d)));
    },
  };
}

// ---------------- 火焰小鬼 ----------------
function buildImp(c) {
  const skin = mat(c.color), dark = mat(0x3a0a0a), hornM = mat(0x2a1a14);
  const eyeM = glowMat(0xffe040, 2.2), tooth = mat(0xffffff);
  const wingM = mat(shade(c.color, 0.55), { side: THREE.DoubleSide });
  const fireM = glowMat(0xff7a1a, 2.6, { transparent: true, opacity: 0.92 }), fireCore = glowMat(0xffe070, 3);

  const hips = grp(c.base, 0, 0.5, 0);
  const legs = [];
  for (const side of [-1, 1]) {
    const L = grp(hips, side * 0.12, 0, 0);
    add(L, G.box(0.13, 0.42, 0.15), skin, 0, -0.22, 0);
    add(L, G.box(0.13, 0.08, 0.17), dark, 0, -0.46, 0.02);
    legs.push(L);
  }
  const torso = grp(hips, 0, 0.05, 0);
  add(torso, G.sph(0.28, 8, 6), skin, 0, 0.22, 0).scale.set(1, 1.15, 0.9);
  const head = grp(torso, 0, 0.62, 0.03);
  add(head, G.sph(0.26, 9, 7), skin, 0, 0.05, 0).scale.set(1.1, 1, 1);
  for (const side of [-1, 1]) {
    const h = add(head, G.cone(0.06, 0.3, 5), hornM, side * 0.14, 0.3, -0.02);
    h.rotation.set(-0.3, 0, -side * 0.35);
    add(head, G.cone(0.06, 0.22, 4), skin, side * 0.3, 0.08, 0).rotation.z = -side * (PI / 2 - 0.25);
    add(head, G.sph(0.055, 6, 4), eyeM, side * 0.1, 0.1, 0.22);
    add(head, G.cone(0.022, 0.07, 3), tooth, side * 0.06, -0.1, 0.24).rotation.x = PI;
  }
  add(head, G.box(0.22, 0.04, 0.05), dark, 0, -0.06, 0.24);

  const wL = grp(torso, -0.1, 0.35, -0.2), wR = grp(torso, 0.1, 0.35, -0.2);
  const mR = add(wR, G.wing(), wingM);
  mR.rotation.x = -PI / 2;
  mR.scale.setScalar(0.45);
  const mL = add(wL, G.wing(), wingM);
  mL.rotation.x = -PI / 2;
  mL.scale.set(-0.45, 0.45, 0.45);

  const tail = grp(hips, 0, 0.05, -0.18);
  add(tail, G.box(0.05, 0.05, 0.42), dark, 0, 0, -0.2);
  add(tail, G.cone(0.08, 0.15, 4), dark, 0, 0, -0.45).rotation.x = -PI / 2;

  const armL = grp(torso, -0.3, 0.4, 0), armR = grp(torso, 0.3, 0.4, 0);
  for (const A of [armL, armR]) {
    add(A, G.box(0.09, 0.34, 0.09), skin, 0, -0.17, 0);
    add(A, G.sph(0.07, 6, 4), skin, 0, -0.36, 0);
  }
  const fire = grp(armR, 0, -0.52, 0.04);
  const fireOuter = add(fire, G.ico(0.2, 1), fireM);
  add(fire, G.ico(0.11, 0), fireCore);

  return {
    designR: 0.7, muzzle: fire,
    anim(t, mv, a) {
      const m = Math.min(mv, 1.4), p = t * (7 + 5 * m);
      legs[0].rotation.x = Math.sin(p) * 0.6 * m;
      legs[1].rotation.x = -Math.sin(p) * 0.6 * m;
      hips.position.y = 0.5 + Math.abs(Math.sin(p)) * 0.1 * m + 0.03 * Math.sin(t * 3);
      const flap = Math.sin(t * 18) * 0.45;
      wR.rotation.set(0, -0.5 - flap, 0.3);
      wL.rotation.set(0, 0.5 + flap, -0.3);
      tail.rotation.set(0.5 + 0.1 * Math.sin(t * 2.5), 0.4 * Math.sin(t * 3), 0);
      const w = windup(a), s = strike(a), act = Math.max(w, s);
      armR.rotation.x = -2.2 * (1 - act) - 3.4 * w - 1.0 * s;
      armL.rotation.x = -Math.sin(p) * 0.5 * m * (1 - act) - 0.5 * act;
      torso.rotation.set(0.08 * m - 0.2 * w + 0.3 * s, -0.3 * w + 0.35 * s, 0);
      const fs = a < 0.5 ? 1 : a < 0.75 ? 0.001 : ss((a - 0.75) / 0.25);
      fire.scale.setScalar(Math.max(0.001, fs * (1 + 0.1 * Math.sin(t * 15) + 0.3 * w)));
      fireOuter.rotation.set(t * 3, t * 4, 0);
    },
  };
}

// ---------------- 岩石傀儡 ----------------
function buildGolem(c) {
  const rock = mat(c.color, { roughness: 1 }), rockD = mat(shade(c.color, 0.7), { roughness: 1 });
  const lava = glowMat(0xff5a10, 2.2), eyeM = glowMat(0xffa020, 3);

  const hips = grp(c.base, 0, 1.0, 0);
  add(hips, G.dodec(0.62), rockD, 0, 0.05, 0).scale.set(1.2, 0.7, 1);
  const seams = [add(hips, G.ico(0.5, 0), lava, 0, 0.35, 0)];
  const torso = grp(hips, 0, 0.45, 0);
  add(torso, G.dodec(1.0), rock, 0, 0.85, 0).scale.set(1.25, 0.95, 0.95);
  add(torso, G.dodec(0.6), rockD, 0.25, 1.4, -0.3);
  for (const [x, y, rz] of [[0.25, 0.95, 0.4], [-0.3, 0.7, -0.3], [0.0, 1.2, 1.2]]) {
    add(torso, G.box(0.09, 0.55, 0.06), lava, x, y, 0.9).rotation.z = rz;
  }
  seams.push(add(torso, G.oct(0.24), lava, 0, 0.85, 0.93));
  seams.push(add(torso, G.ico(0.3, 0), lava, 0, 1.6, 0.1));
  const head = grp(torso, 0, 1.78, 0.15);
  add(head, G.dodec(0.42), rockD, 0, 0.1, 0).scale.set(1.2, 0.85, 1);
  add(head, G.box(0.13, 0.06, 0.05), eyeM, -0.15, 0.12, 0.36);
  add(head, G.box(0.13, 0.06, 0.05), eyeM, 0.15, 0.12, 0.36);
  add(torso, G.dodec(0.5), rock, -1.15, 1.4, 0);
  add(torso, G.dodec(0.5), rock, 1.15, 1.4, 0);

  const arms = [];
  for (const side of [-1, 1]) {
    const arm = grp(torso, side * 1.3, 1.3, 0);
    add(arm, G.dodec(0.38), rockD, 0, -0.45, 0).scale.set(0.9, 1.4, 0.9);
    seams.push(add(arm, G.ico(0.2, 0), lava, 0, -0.85, 0));
    const elb = grp(arm, 0, -0.9, 0);
    add(elb, G.dodec(0.42), rock, 0, -0.35, 0).scale.set(1, 1.3, 1);
    add(elb, G.dodec(0.5), rockD, 0, -0.9, 0.05);
    arms.push({ arm, elb, side });
  }
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = grp(hips, side * 0.5, -0.1, 0);
    add(leg, G.dodec(0.45), rockD, 0, -0.4, 0).scale.set(1, 1.2, 1);
    add(leg, G.dodec(0.42), rock, 0, -0.78, 0.1).scale.set(1.2, 0.6, 1.4);
    legs.push(leg);
  }
  const orbit = grp(torso, 0, 1.95, 0.1);
  const bits = [];
  for (let i = 0; i < 3; i++) bits.push(add(orbit, G.dodec(0.16), rockD));
  const muzzle = grp(head, 0, 0.1, 0.5);

  return {
    designR: 1.8, muzzle,
    anim(t, mv, a) {
      const m = Math.min(mv, 1.3), p = t * (3.5 + 3 * m);
      const sw = Math.sin(p) * 0.4 * m;
      legs[0].rotation.x = sw;
      legs[1].rotation.x = -sw;
      hips.position.y = 1.0 + Math.abs(Math.cos(p)) * 0.1 * m;
      hips.rotation.z = Math.sin(p) * 0.1 * m;
      const w = windup(a), s = strike(a), act = Math.max(w, s);
      torso.rotation.set(0.08 - 0.3 * w + 0.45 * s, -sw * 0.3, 0);
      for (const A of arms) {
        A.arm.rotation.x = (A.side < 0 ? -sw : sw) * 0.8 * (1 - act) - 2.8 * w - 0.5 * s;
        A.arm.rotation.z = A.side * 0.12 * (1 - act);
        A.elb.rotation.x = -0.25 * (1 - act) - 0.3 * w;
      }
      const glow = 1 + 0.1 * Math.sin(t * 3);
      for (const sm of seams) sm.scale.setScalar(glow);
      orbit.rotation.y = t * 1.2;
      for (let i = 0; i < 3; i++) {
        const q = (i / 3) * TAU;
        bits[i].position.set(Math.cos(q) * 0.75, 0.15 * Math.sin(t * 2 + i * 2), Math.sin(q) * 0.75);
        bits[i].rotation.set(t * (1 + i * 0.3), t * 0.7, 0);
      }
    },
  };
}

// ---------------- 暗影法师 ----------------
function buildMage(c) {
  const robe = mat(c.color), trim = mat(0xd4a83a, { metalness: 0.5, roughness: 0.4 });
  const dark = mat(0x0a0612, { roughness: 1 }), eyeM = glowMat(0xe070ff, 3), skinM = mat(0x8a7a9a);
  const orbM = glowMat(0xb04aff, 2.5, { transparent: true, opacity: 0.9 }), wood = mat(0x3a2a3a);
  const runeM = glowMat(0xd080ff, 2);

  const body = grp(c.base, 0, 0.3, 0);
  add(body, G.cone(0.62, 1.4, 8), robe, 0, 0.55, 0);
  add(body, G.torus(0.6, 0.05, 4, 10), trim, 0, -0.12, 0).rotation.x = PI / 2;
  add(body, G.torus(0.33, 0.05, 4, 10), trim, 0, 0.72, 0).rotation.x = PI / 2;
  add(body, G.cyl(0.26, 0.34, 0.5, 8), robe, 0, 1.15, 0);
  add(body, G.sph(0.17, 7, 5), trim, -0.3, 1.38, 0);
  add(body, G.sph(0.17, 7, 5), trim, 0.3, 1.38, 0);
  const head = grp(body, 0, 1.6, 0);
  add(head, G.cone(0.34, 0.7, 7), robe, 0, 0.18, -0.04);
  add(head, G.sph(0.3, 8, 6), robe, 0, 0, -0.06);
  add(head, G.sph(0.22, 8, 6), dark, 0, -0.02, 0.1);
  add(head, G.sph(0.045, 6, 4), eyeM, -0.08, 0.02, 0.29);
  add(head, G.sph(0.045, 6, 4), eyeM, 0.08, 0.02, 0.29);

  const armL = grp(body, -0.36, 1.35, 0), armR = grp(body, 0.36, 1.35, 0);
  for (const A of [armL, armR]) {
    add(A, G.cone(0.14, 0.6, 6), robe, 0, -0.28, 0);
    add(A, G.sph(0.07, 6, 4), skinM, 0, -0.6, 0);
  }
  const staff = grp(armR, 0, -0.6, 0.05);
  add(staff, G.cyl(0.035, 0.035, 2.0, 6), wood, 0, 0.35, 0);
  add(staff, G.torus(0.14, 0.03, 4, 10, PI * 1.5), trim, 0, 1.4, 0).rotation.z = -PI * 0.25;
  const orb = add(staff, G.ico(0.13, 1), orbM, 0, 1.4, 0);
  const runes = grp(body, 0, 0.9, 0);
  const runeBits = [];
  for (let i = 0; i < 3; i++) runeBits.push(add(runes, G.oct(0.07), runeM));
  const muzzle = grp(staff, 0, 1.4, 0.1);

  return {
    designR: 0.8, customDeath: true, muzzle,
    anim(t, mv, a, hurt, d) {
      const m = Math.min(mv, 1.3);
      const w = windup(a), s = strike(a), act = Math.max(w, s);
      const e = ss(d);
      body.position.y = (0.3 + 0.1 * Math.sin(t * 1.6)) * (1 - e);
      body.rotation.set(0.12 * m + 0.2 * s, 0, 0.04 * Math.sin(t * 1.1));
      body.scale.set(1 + 0.3 * e, Math.max(0.05, 1 - 0.85 * e), 1 + 0.3 * e);
      const restA = -0.35 + 0.05 * Math.sin(t * 1.3);
      armR.rotation.x = restA * (1 - act) - 1.95 * w - 1.3 * s;
      armL.rotation.x = -0.2 * (1 - act) - 0.9 * w + 0.2 * s;
      staff.rotation.x = -armR.rotation.x + 0.9 * s;
      orb.scale.setScalar(1 + 0.1 * Math.sin(t * 4) + 0.8 * w);
      head.rotation.x = 0.05 * Math.sin(t * 0.9) + 0.1 * s;
      runes.rotation.y = t * 1.5;
      for (let i = 0; i < 3; i++) {
        const q = (i / 3) * TAU;
        runeBits[i].position.set(Math.cos(q) * 0.8, 0.12 * Math.sin(t * 2 + i) - 0.8 * e, Math.sin(q) * 0.8);
        runeBits[i].rotation.set(t * 2, t * 3, 0);
      }
    },
  };
}

// ---------------- 暗影骑士 ----------------
function buildDarkKnight(c) {
  const armor = mat(c.color, { metalness: 0.6, roughness: 0.35 }), trim = mat(0x6a1a24, { metalness: 0.4, roughness: 0.5 });
  const spike = mat(0x8a8a9a, { metalness: 0.7, roughness: 0.3 }), eyeM = glowMat(0xff2020, 3);
  const runeM = glowMat(0xff3030, 2), capeM = mat(0x3a0a14, { side: THREE.DoubleSide, roughness: 0.9 });
  const blade = mat(0x3a3a48, { metalness: 0.8, roughness: 0.25 });

  const hips = grp(c.base, 0, 1.15, 0);
  add(hips, G.cyl(0.42, 0.5, 0.35, 8), armor, 0, -0.05, 0);
  const torso = grp(hips, 0, 0.15, 0);
  add(torso, G.box(0.8, 0.75, 0.5), armor, 0, 0.45, 0);
  add(torso, G.box(0.1, 0.6, 0.1), trim, 0, 0.45, 0.27);
  for (const side of [-1, 1]) {
    add(torso, G.sph(0.3, 8, 6), armor, side * 0.55, 0.8, 0).scale.set(1.2, 0.9, 1.1);
    add(torso, G.cone(0.07, 0.35, 5), spike, side * 0.65, 1.05, 0).rotation.z = -side * 0.4;
  }
  const head = grp(torso, 0, 0.95, 0.02);
  add(head, G.box(0.42, 0.46, 0.44), armor, 0, 0.18, 0);
  add(head, G.box(0.3, 0.05, 0.02), eyeM, 0, 0.2, 0.225);
  add(head, G.cone(0.07, 0.45, 5), spike, -0.2, 0.45, -0.02).rotation.z = 0.5;
  add(head, G.cone(0.07, 0.45, 5), spike, 0.2, 0.45, -0.02).rotation.z = -0.5;
  add(head, G.box(0.05, 0.18, 0.4), trim, 0, 0.47, 0);

  function arm(side) {
    const A = grp(torso, side * 0.55, 0.72, 0);
    add(A, G.box(0.24, 0.45, 0.26), armor, 0, -0.22, 0);
    const E = grp(A, 0, -0.45, 0);
    add(E, G.box(0.22, 0.42, 0.24), armor, 0, -0.2, 0);
    add(E, G.box(0.26, 0.18, 0.28), trim, 0, -0.46, 0);
    return [A, E];
  }
  const [armL, elbL] = arm(-1);
  const [armR, elbR] = arm(1);
  const sword = grp(elbR, 0, -0.5, 0.05);
  sword.rotation.x = 2.3;
  add(sword, G.cyl(0.04, 0.04, 0.35, 6), trim);
  add(sword, G.box(0.5, 0.08, 0.1), trim, 0, 0.2, 0);
  add(sword, G.box(0.14, 1.5, 0.05), blade, 0, 1.0, 0);
  add(sword, G.box(0.03, 1.2, 0.06), runeM, 0, 0.95, 0);
  add(sword, G.cone(0.1, 0.22, 4), blade, 0, 1.86, 0).rotation.y = PI / 4;

  const capeRoot = grp(torso, 0, 0.82, -0.28);
  const cape = [];
  const lens = [1.3, 1.5, 1.2];
  for (let i = 0; i < 3; i++) {
    const p = grp(capeRoot, (i - 1) * 0.25, 0, 0);
    add(p, G.box(0.26, lens[i], 0.03), capeM, 0, -lens[i] / 2, 0);
    cape.push(p);
  }
  const legs = [];
  for (const side of [-1, 1]) {
    const L = grp(hips, side * 0.22, -0.15, 0);
    add(L, G.box(0.26, 0.5, 0.3), armor, 0, -0.25, 0);
    const K = grp(L, 0, -0.5, 0);
    add(K, G.box(0.24, 0.45, 0.28), armor, 0, -0.22, 0);
    add(K, G.box(0.28, 0.14, 0.42), trim, 0, -0.47, 0.06);
    legs.push({ L, K });
  }
  const muzzle = grp(head, 0, 0.2, 0.35);

  return {
    designR: 1.1, muzzle,
    anim(t, mv, a) {
      const m = Math.min(mv, 1.4), p = t * (5 + 4 * m);
      const sw = Math.sin(p) * 0.5 * m;
      legs[0].L.rotation.x = sw;
      legs[1].L.rotation.x = -sw;
      legs[0].K.rotation.x = Math.max(0, Math.sin(p + 1.2)) * 0.7 * m;
      legs[1].K.rotation.x = Math.max(0, Math.sin(p + PI + 1.2)) * 0.7 * m;
      hips.position.y = 1.15 + Math.abs(Math.cos(p)) * 0.05 * m;
      const w = windup(a), s = strike(a), act = Math.max(w, s);
      torso.rotation.set(0.05 * m - 0.2 * w + 0.35 * s, sw * 0.1 - 0.35 * w + 0.4 * s, 0);
      armR.rotation.x = (-0.5 + sw * 0.2) * (1 - act) - 3.3 * w - 0.6 * s;
      elbR.rotation.x = -1.0 * (1 - act);
      armL.rotation.x = -sw * 0.6 * (1 - act) - 1.0 * act;
      elbL.rotation.x = -0.3 - 0.5 * act;
      for (let i = 0; i < 3; i++) {
        cape[i].rotation.x = 0.12 + 0.3 * m + 0.08 * Math.sin(t * 3 + i * 1.3) + 0.2 * s;
      }
      head.rotation.x = 0.04 * Math.sin(t * 1.2);
    },
  };
}

// =====================================================================
//  通用封装
// =====================================================================
const BUILDERS = {
  slime: buildSlime,
  goblin: buildGoblin,
  bat: buildBat,
  scorpion: buildScorpion,
  skeleton: buildSkeleton,
  archer: buildArcher,
  wolf: buildWolf,
  yeti: buildYeti,
  mushroom: buildMushroom,
  wisp: buildWisp,
  imp: buildImp,
  golem: buildGolem,
  mage: buildMage,
  darkKnight: buildDarkKnight,
};

export const ENEMY_MODEL_TYPES = Object.keys(BUILDERS);

const REST = { t: 0, move: 0, attack: -1, hurt: 0, dead: 0 };
const topCache = new Map();
const _box = new THREE.Box3();

// 在单位缩放、静止姿态下测量模型顶部高度（按类型缓存）
function measureTop(type, root, base, spec) {
  if (topCache.has(type)) return topCache.get(type);
  base.scale.setScalar(1);
  base.position.set(0, 0, 0);
  base.rotation.set(0, 0, 0);
  spec.anim(0, 0, -1, 0, 0, 0);
  base.position.set(0, 0, 0);
  root.updateMatrixWorld(true);
  _box.setFromObject(root);
  const top = Number.isFinite(_box.max.y) ? _box.max.y : 1.5;
  topCache.set(type, top);
  return top;
}

export function createEnemyModel(type, def) {
  def = def || {};
  const build = BUILDERS[type] || BUILDERS.goblin;
  const root = new THREE.Group();
  root.name = `enemy:${type}`;
  const base = new THREE.Group();
  root.add(base);

  const c = { def, color: def.color ?? 0x888888, base };
  const spec = build(c);
  const hover = def.flying ? (def.hover ?? 2.5) : 0;
  const vary = 0.95 + Math.random() * 0.1;
  const k = ((def.radius || spec.designR) / spec.designR) * vary;
  const top = measureTop(type, root, base, spec);
  base.scale.setScalar(k);

  const ph = Math.random() * 100;
  const fallDir = Math.random() < 0.5 ? -1 : 1;
  const groundY = (spec.groundY || 0) * k;
  const size = { height: top * k + hover, radius: spec.designR * k };

  function update(dt, s) {
    s = s || REST;
    const t = (s.t || 0) + ph;
    const mv = Math.max(0, Math.min(2, s.move || 0));
    const a = s.attack == null ? -1 : s.attack;
    const hurt = clamp01(s.hurt || 0);
    const d = clamp01(s.dead || 0);

    base.position.set(0, hover, 0);
    base.rotation.set(0, 0, 0);
    spec.anim(t, mv, a, hurt, d, dt || 0);

    if (hurt > 0) {
      base.rotation.x -= 0.32 * hurt;
      base.position.z -= 0.15 * hurt;
    }
    if (d > 0 && !spec.customDeath) {
      const e = ss(d / 0.55);
      base.rotation.z += fallDir * e * 1.45;
      base.position.y = lerp(base.position.y, groundY, e);
      if (d > 0.65) base.position.y -= ((d - 0.65) / 0.35) * size.height * 0.35;
    }
  }

  update(0, REST);
  return { root, muzzle: spec.muzzle, size, update, type };
}

export { createBossModel } from './bosses.js';
