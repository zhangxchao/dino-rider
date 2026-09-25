// =====================================================================
//  骑手模型：10 位 Q 版骑手（程序化低多边形）
//  createRiderModel(def) → { root, muzzle, update(dt, s) }
//  root 原点 = 臀部坐点（挂在恐龙 saddle 上），面朝 +Z；坐点到头顶约 1.1
//  s = { t, bounce 0..1, shoot -1|0..1, cheer bool, lean -1..1（+1 = 向右转）}
// =====================================================================
import * as THREE from 'three';

const PI = Math.PI;
const TAU = PI * 2;

// ---------------------------------------------------------------------
//  几何体缓存（跨实例共享）
// ---------------------------------------------------------------------
const _geo = new Map();
function G(key, make) {
  let g = _geo.get(key);
  if (!g) { g = make(); _geo.set(key, g); }
  return g;
}
const k3 = (...a) => a.map((v) => (typeof v === 'number' ? v.toFixed(4) : String(v))).join(',');
const sphere = (r, w = 10, h = 8) => G('sp' + k3(r, w, h), () => new THREE.SphereGeometry(r, w, h));
const partSphere = (r, w, h, ps, pl, ts, tl) =>
  G('ps' + k3(r, w, h, ps, pl, ts, tl), () => new THREE.SphereGeometry(r, w, h, ps, pl, ts, tl));
const box = (x, y, z) => G('bx' + k3(x, y, z), () => new THREE.BoxGeometry(x, y, z));
const cyl = (rt, rb, h, s = 8, open = false, ts = 0, tl = TAU) =>
  G('cy' + k3(rt, rb, h, s, open, ts, tl), () => new THREE.CylinderGeometry(rt, rb, h, s, 1, open, ts, tl));
const cone = (r, h, s = 8) => G('co' + k3(r, h, s), () => new THREE.ConeGeometry(r, h, s));
const torus = (r, t, rs = 5, ts = 14, arc = TAU) => G('to' + k3(r, t, rs, ts, arc), () => new THREE.TorusGeometry(r, t, rs, ts, arc));
const capsule = (r, l) => G('ca' + k3(r, l), () => new THREE.CapsuleGeometry(r, l, 2, 7));
const ico = (r) => G('ic' + k3(r), () => new THREE.IcosahedronGeometry(r, 0));
const dode = (r) => G('do' + k3(r), () => new THREE.DodecahedronGeometry(r, 0));
const octa = (r) => G('oc' + k3(r), () => new THREE.OctahedronGeometry(r, 0));
// 梯形板（披风 / 长发 / 燕尾）：上宽 wt，下宽 wb，高 h，厚 d，中心在原点
const trap = (wt, wb, h, d) => G('tp' + k3(wt, wb, h, d), () => {
  const g = new THREE.BoxGeometry(1, h, d, 1, 2, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const w = wb + (wt - wb) * (y / h + 0.5);
    p.setX(i, p.getX(i) * w);
  }
  g.computeVertexNormals();
  return g;
});

function shade(hex, f) {
  return new THREE.Color(hex).multiplyScalar(f).getHex();
}

// ---------------------------------------------------------------------
//  构建上下文
// ---------------------------------------------------------------------
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vd = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function makeCtx(def) {
  const mats = new Map();
  return {
    def,
    meshes: 0,
    flutters: [],
    spins: [],
    pulses: [],
    cfg: {},
    // 每个骑手实例新建材质（同一骑手内部按颜色+参数复用）
    mat(color, o = {}) {
      const key = color + '|' + JSON.stringify(o);
      let m = mats.get(key);
      if (!m) {
        const transparent = o.opacity !== undefined && o.opacity < 1;
        m = new THREE.MeshStandardMaterial({
          color,
          flatShading: true,
          roughness: o.roughness ?? 0.72,
          metalness: o.metalness ?? 0.05,
          emissive: o.emissive ?? 0x000000,
          emissiveIntensity: o.ei ?? 1,
          transparent,
          opacity: o.opacity ?? 1,
          depthWrite: !transparent,
          side: o.double ? THREE.DoubleSide : THREE.FrontSide,
        });
        mats.set(key, m);
      }
      return m;
    },
    glow(color, ei = 1.6) {
      return this.mat(color, { emissive: color, ei, roughness: 0.35 });
    },
    add(parent, geo, mat, p, r, s) {
      const m = new THREE.Mesh(geo, mat);
      if (p) m.position.set(p[0], p[1], p[2]);
      if (r) m.rotation.set(r[0], r[1], r[2]);
      if (s !== undefined) {
        if (typeof s === 'number') m.scale.setScalar(s);
        else m.scale.set(s[0], s[1], s[2]);
      }
      parent.add(m);
      this.meshes++;
      return m;
    },
    grp(parent, p, r) {
      const g = new THREE.Group();
      if (p) g.position.set(p[0], p[1], p[2]);
      if (r) g.rotation.set(r[0], r[1], r[2]);
      parent.add(g);
      return g;
    },
    // 两点之间的胶囊肢体（静态姿势）
    limb(parent, a, b, r, mat) {
      _va.fromArray(a);
      _vb.fromArray(b);
      _vd.subVectors(_vb, _va);
      const len = _vd.length();
      const m = this.add(parent, capsule(r, Math.max(0.001, len)), mat);
      m.position.addVectors(_va, _vb).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(_up, _vd.normalize());
      return m;
    },
    // 头盔 / 兜帽 / 头发壳：顶盖 + 露脸的侧后壳
    shell(parent, mat, r, top = 0.3 * PI, bottom = 0.62 * PI, gap = 1.8, p) {
      this.add(parent, partSphere(r, 12, 4, 0, TAU, 0, top), mat, p);
      this.add(parent, partSphere(r, 12, 4, PI / 2 + gap / 2, TAU - gap, top, bottom - top), mat, p);
    },
    // 飘动部件：obj.rotation[axis] = base + run*奔跑 + sin 摆动
    flutter(obj, axis, base, run, amp, freq, phase = 0) {
      this.flutters.push({ obj, axis, base, run, amp, freq, phase });
      obj.rotation[axis] = base;
    },
    spin(obj, axis, speed) { this.spins.push({ obj, axis, speed }); },
    pulse(mat, base, amp, freq, cast = 0) {
      this.pulses.push({ mat, base, amp, freq, cast, phase: Math.random() * TAU });
    },
  };
}

// ---------------------------------------------------------------------
//  通用身体骨架（Q 版坐姿）
// ---------------------------------------------------------------------
function base(c, o) {
  const skin = o.skin;
  const root = new THREE.Group();
  root.name = 'rider:' + c.def.id;
  const rig = c.grp(root);                 // 整体颠簸
  const upper = c.grp(rig, [0, 0.1, 0]);   // 上半身枢轴（腰）

  // 骨盆 + 跨骑双腿（静态，夹住恐龙背部）
  c.add(rig, cyl(0.19, 0.2, 0.16, 8), o.pelvis, [0, 0.06, 0]);
  for (const sg of [1, -1]) {
    const hip = [0.1 * sg, 0.05, 0.03];
    const knee = [0.29 * sg, -0.06, 0.2];
    const ankle = [0.31 * sg, -0.39, 0.07];
    c.limb(rig, hip, knee, 0.075, o.thigh);
    c.limb(rig, knee, ankle, 0.066, o.shin);
    c.add(rig, box(0.12, 0.08, 0.2), o.foot, [ankle[0], ankle[1] - 0.04, ankle[2] + 0.05]);
  }

  // 躯干（上半身坐标 0..0.4）
  const torso = c.add(upper, cyl(0.16, 0.19, 0.4, 8), o.torso, [0, 0.2, 0]);

  // 头
  const neck = c.grp(upper, [0, 0.42, 0]);
  const head = c.grp(neck, [0, 0.25, 0]);
  c.add(head, sphere(0.28, 12, 10), o.headMat ?? skin);
  if (o.eyes !== false) {
    const eyeMat = c.mat(0x1a1420, { roughness: 0.25 });
    const er = o.eyeR ?? 0.28;
    const ez = Math.sqrt(er * er - 0.1 * 0.1);
    for (const sg of [1, -1]) c.add(head, sphere(0.045, 6, 5), eyeMat, [0.1 * sg, 0.0, ez], null, [1, 1.15, 0.5]);
  }
  if (o.blush) {
    const bm = c.mat(0xff8a9a, { roughness: 0.9 });
    for (const sg of [1, -1]) c.add(head, sphere(0.045, 6, 4), bm, [0.17 * sg, -0.08, 0.215], null, [1.2, 0.6, 0.4]);
  }

  // 手臂：肩(俯仰 x / 外展 z) → 肘 → 手
  const arms = {};
  const hs = o.handScale ?? 1;
  for (const [side, sg] of [['R', -1], ['L', 1]]) {
    const shoulder = c.grp(upper, [0.2 * sg, 0.37, 0]);
    c.add(shoulder, capsule(0.06, 0.14), o.upperArm, [0, -0.1, 0]);
    const elbow = c.grp(shoulder, [0, -0.2, 0]);
    c.add(elbow, capsule(0.055, 0.12), o.foreArm, [0, -0.09, 0]);
    const hand = c.grp(elbow, [0, -0.19, 0]);
    c.add(hand, sphere(0.07 * hs, 8, 6), o.hand);
    arms[side] = { shoulder, elbow, hand };
  }

  // 武器坐标系：挂在右手，每帧修正使其在“水平”时与世界朝向一致（+Z 前 +Y 上）
  const weapon = c.grp(arms.R.hand, [0, -0.02, 0]);
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  weapon.add(muzzle);

  Object.assign(c, { root, rig, upper, torso, neck, head, arms, weapon, muzzle });
}

// ---------------------------------------------------------------------
//  各骑手
// ---------------------------------------------------------------------
const BUILDERS = {
  knight(c, d) {
    const C = d.colors;
    const armor = c.mat(C.main, { metalness: 0.65, roughness: 0.32 });
    const armorD = c.mat(shade(C.main, 0.72), { metalness: 0.6, roughness: 0.4 });
    const helm = c.mat(C.main, { metalness: 0.65, roughness: 0.32, double: true });
    const blue = c.mat(C.accent);
    const gold = c.mat(C.extra, { metalness: 0.75, roughness: 0.3 });
    const wood = c.mat(0x7a5230);
    base(c, {
      skin: c.mat(C.skin), torso: armor, pelvis: blue, upperArm: armorD, foreArm: armor, hand: armorD,
      thigh: armorD, shin: armor, foot: c.mat(0x4a4d5a, { metalness: 0.5, roughness: 0.4 }),
    });
    // 罩袍 + 腰带
    c.add(c.upper, cyl(0.2, 0.215, 0.22, 8), blue, [0, 0.11, 0]);
    c.add(c.upper, torus(0.195, 0.028, 4, 12), gold, [0, 0.22, 0], [PI / 2, 0, 0]);
    // 头盔 + 顶脊 + 护鼻
    c.shell(c.head, helm, 0.305, 0.3 * PI, 0.64 * PI, 1.7);
    c.add(c.head, box(0.05, 0.06, 0.44), gold, [0, 0.3, -0.03]);
    c.add(c.head, box(0.04, 0.15, 0.03), armor, [0, 0.04, 0.3]);
    // 羽饰
    const plume = c.grp(c.head, [0, 0.33, -0.1]);
    c.add(plume, box(0.07, 0.15, 0.12), blue, [0, 0.05, 0.02]);
    c.add(plume, box(0.07, 0.12, 0.14), blue, [0, 0.07, -0.1], [-0.3, 0, 0]);
    c.add(plume, box(0.06, 0.1, 0.16), gold, [0, 0.03, -0.23], [-0.6, 0, 0]);
    c.flutter(plume, 'x', 0, -0.35, 0.12, 7);
    // 护肩
    for (const [side, sg] of [['R', -1], ['L', 1]]) {
      c.add(c.arms[side].shoulder, partSphere(0.12, 8, 4, 0, TAU, 0, PI / 2), armor, [0.02 * sg, 0.02, 0], [0, 0, -0.4 * sg]);
    }
    // 背后的盾牌
    c.add(c.upper, cyl(0.21, 0.21, 0.05, 10), blue, [0, 0.22, -0.23], [PI / 2, 0, 0]);
    c.add(c.upper, torus(0.21, 0.025, 4, 16), gold, [0, 0.22, -0.25]);
    c.add(c.upper, box(0.06, 0.3, 0.02), gold, [0, 0.22, -0.265]);
    c.add(c.upper, box(0.26, 0.06, 0.02), gold, [0, 0.26, -0.265]);
    // 长枪（平端向前）
    const spear = c.grp(c.weapon);
    c.add(spear, cyl(0.025, 0.025, 1.5, 6), wood, [0, 0, 0.35], [PI / 2, 0, 0]);
    c.add(spear, cone(0.055, 0.22, 6), gold, [0, 0, 1.2], [PI / 2, 0, 0]);
    c.add(spear, box(0.14, 0.03, 0.04), gold, [0, 0, 1.07]);
    const pennant = c.grp(spear, [0, 0.02, 0.98]);
    c.add(pennant, trap(0.16, 0.04, 0.2, 0.012), blue, [0, -0.02, -0.09], [PI / 2, 0, 0]);
    c.flutter(pennant, 'y', 0, 0, 0.35, 8);
    c.muzzle.position.set(0, 0, 1.32);
    c.cfg.held = spear;
  },

  elf(c, d) {
    const C = d.colors;
    const green = c.mat(C.main);
    const greenD = c.mat(shade(C.main, 0.75), { double: true });
    const brown = c.mat(C.accent);
    const hair = c.mat(C.extra);
    const skin = c.mat(C.skin);
    base(c, {
      skin, torso: green, pelvis: brown, upperArm: green, foreArm: brown, hand: skin,
      thigh: c.mat(0x5a4632), shin: brown, foot: brown, blush: true,
    });
    // 刘海 + 兜帽 + 帽尖
    c.add(c.head, box(0.3, 0.08, 0.1), hair, [0, 0.15, 0.2], [-0.35, 0, 0]);
    c.shell(c.head, greenD, 0.31, 0.3 * PI, 0.66 * PI, 1.9);
    const tip = c.grp(c.head, [0, 0.08, -0.27]);
    c.add(tip, cone(0.11, 0.32, 6), greenD, [0, -0.07, -0.145], [-2.04, 0, 0]);
    c.flutter(tip, 'x', 0, 0.6, 0.15, 6);
    // 尖耳朵
    for (const sg of [1, -1]) {
      const a = PI / 2 - 0.35;
      c.add(c.head, cone(0.05, 0.2, 5), skin, [sg * (0.27 + 0.094), 0.054, -0.02], [0, 0, -sg * a]);
    }
    // 短披肩 + 腰带
    c.add(c.upper, cyl(0.2, 0.3, 0.2, 10, true), greenD, [0, 0.33, 0]);
    c.add(c.upper, torus(0.195, 0.025, 4, 12), brown, [0, 0.08, 0], [PI / 2, 0, 0]);
    // 箭袋
    const quiver = c.grp(c.upper, [0.08, 0.26, -0.25], [0.15, 0, -0.45]);
    c.add(quiver, cyl(0.07, 0.06, 0.42, 7), brown, [0, 0, 0]);
    const fl = c.mat(d.weapon.color, { emissive: d.weapon.color, ei: 0.35 });
    for (let i = -1; i <= 1; i++) c.add(quiver, box(0.02, 0.1, 0.06), fl, [i * 0.035, 0.25, 0], [0, i * 0.6, 0]);
    // 弓（右手握持）+ 搭好的箭
    const bow = c.grp(c.weapon);
    c.add(bow, box(0.035, 0.34, 0.04), brown, [0, 0.16, -0.03], [-0.32, 0, 0]);
    c.add(bow, box(0.035, 0.34, 0.04), brown, [0, -0.16, -0.03], [0.32, 0, 0]);
    c.add(bow, cyl(0.006, 0.006, 0.64, 3), c.mat(0xf2f2e8), [0, 0, -0.085]);
    const arrow = c.grp(bow);
    c.add(arrow, cyl(0.012, 0.012, 0.5, 4), c.mat(0xd8c090), [0, 0, 0.16], [PI / 2, 0, 0]);
    c.add(arrow, cone(0.03, 0.08, 4), c.glow(d.weapon.color, 1.4), [0, 0, 0.44], [PI / 2, 0, 0]);
    c.muzzle.position.set(0, 0, 0.48);
    c.cfg.arrow = arrow;
  },

  wizard(c, d) {
    const C = d.colors;
    const purple = c.mat(C.main);
    const purpleD = c.mat(shade(C.main, 0.7), { double: true });
    const gold = c.mat(C.accent, { metalness: 0.6, roughness: 0.35 });
    const white = c.mat(C.extra);
    const skin = c.mat(C.skin);
    base(c, {
      skin, torso: purple, pelvis: purple, upperArm: purple, foreArm: purple, hand: skin,
      thigh: purpleD, shin: purpleD, foot: c.mat(0x3a2a5a),
    });
    // 长袍下摆（前开）+ 金腰带
    c.add(c.rig, cyl(0.2, 0.34, 0.34, 10, true, 0.9, TAU - 1.8), purpleD, [0, -0.05, 0]);
    c.add(c.upper, torus(0.195, 0.03, 4, 12), gold, [0, 0.08, 0], [PI / 2, 0, 0]);
    // 星星尖帽
    c.add(c.head, cyl(0.44, 0.44, 0.03, 14), purple, [0, 0.2, 0], [-0.08, 0, 0]);
    c.add(c.head, torus(0.25, 0.03, 4, 14), gold, [0, 0.24, -0.01], [PI / 2 - 0.08, 0, 0]);
    c.add(c.head, cyl(0.1, 0.26, 0.42, 10), purple, [0, 0.42, -0.02]);
    const hatTip = c.grp(c.head, [0, 0.62, -0.04]);
    c.add(hatTip, cone(0.1, 0.3, 8), purple, [0, 0.13, -0.03], [-0.35, 0, 0]);
    c.flutter(hatTip, 'x', -0.2, -0.3, 0.14, 5);
    const star = c.glow(C.accent, 0.8);
    c.add(c.head, octa(0.055), star, [0.1, 0.38, -0.21], null, [1, 1, 0.5]);
    c.add(c.head, octa(0.05), star, [-0.08, 0.47, 0.16], null, [1, 1, 0.5]);
    // 白胡子 + 八字胡 + 眉毛
    c.add(c.head, cone(0.17, 0.4, 7), white, [0, -0.3, 0.17], [PI + 0.25, 0, 0]);
    for (const sg of [1, -1]) c.add(c.head, sphere(0.06, 6, 4), white, [0.07 * sg, -0.08, 0.255], [0, 0, 0.3 * sg], [1.5, 0.6, 0.8]);
    c.add(c.head, box(0.26, 0.045, 0.05), white, [0, 0.1, 0.25]);
    // 披风
    const cape = c.grp(c.upper, [0, 0.4, -0.17]);
    c.add(cape, trap(0.34, 0.46, 0.5, 0.025), purpleD, [0, -0.25, 0]);
    c.flutter(cape, 'x', 0.22, 0.8, 0.12, 7);
    // 法杖（竖直）+ 发光法球
    const staff = c.grp(c.weapon);
    c.add(staff, cyl(0.025, 0.03, 1.15, 6), c.mat(0x6a4424), [0, 0.1, 0]);
    c.add(staff, torus(0.085, 0.016, 4, 10), gold, [0, 0.74, 0]);
    const orbMat = c.glow(d.weapon.color, 2);
    c.add(staff, sphere(0.09, 10, 8), orbMat, [0, 0.74, 0]);
    c.pulse(orbMat, 2, 0.5, 4, 3);
    c.muzzle.position.set(0, 0.74, 0.05);
  },

  astronaut(c, d) {
    const C = d.colors;
    const white = c.mat(C.main, { roughness: 0.55 });
    const orange = c.mat(C.accent);
    const blue = c.mat(C.extra);
    const grey = c.mat(0xb8bcc8, { metalness: 0.3, roughness: 0.5 });
    const dark = c.mat(0x5a6070, { metalness: 0.5, roughness: 0.4 });
    base(c, {
      skin: c.mat(C.skin), torso: white, pelvis: white, upperArm: white, foreArm: white, hand: grey,
      thigh: white, shin: white, foot: grey, blush: true,
    });
    // 玻璃头盔 + 橙色遮阳面罩 + 蓝色颈环
    c.add(c.head, sphere(0.37, 14, 10), c.mat(0xcfe8ff, { opacity: 0.26, roughness: 0.05, metalness: 0.2 }), [0, 0.02, 0]);
    c.add(c.head, partSphere(0.375, 12, 3, PI / 2 - 0.95, 1.9, 0.14 * PI, 0.22 * PI),
      c.mat(C.accent, { metalness: 0.85, roughness: 0.2, double: true }), [0, 0.02, 0]);
    c.add(c.head, torus(0.27, 0.05, 6, 16), blue, [0, -0.28, 0], [PI / 2, 0, 0]);
    // 背包 + 氧气瓶 + 天线
    c.add(c.upper, box(0.36, 0.42, 0.18), white, [0, 0.24, -0.26]);
    c.add(c.upper, box(0.37, 0.06, 0.19), orange, [0, 0.32, -0.26]);
    for (const sg of [1, -1]) c.add(c.upper, cyl(0.06, 0.06, 0.36, 8), grey, [0.12 * sg, 0.22, -0.37]);
    c.add(c.upper, cyl(0.01, 0.01, 0.3, 4), grey, [0.12, 0.58, -0.3]);
    const light = c.glow(C.extra, 2);
    c.add(c.upper, sphere(0.035, 6, 5), light, [0.12, 0.74, -0.3]);
    c.pulse(light, 1.4, 1.4, 6);
    // 胸前控制面板 + 袖章条纹
    const panel = c.mat(C.extra, { emissive: C.extra, ei: 0.5 });
    c.add(c.upper, box(0.16, 0.1, 0.05), panel, [0, 0.26, 0.18]);
    c.pulse(panel, 0.5, 0.3, 3);
    for (const side of ['R', 'L']) c.add(c.arms[side].shoulder, torus(0.065, 0.018, 4, 10), orange, [0, -0.12, 0], [PI / 2, 0, 0]);
    // 激光枪
    const gun = c.grp(c.weapon);
    c.add(gun, box(0.08, 0.1, 0.24), dark, [0, 0.05, 0.08]);
    c.add(gun, cyl(0.03, 0.035, 0.18, 8), white, [0, 0.06, 0.28], [PI / 2, 0, 0]);
    const em = c.glow(d.weapon.color, 2);
    c.add(gun, torus(0.035, 0.012, 4, 10), em, [0, 0.06, 0.37]);
    c.add(gun, box(0.05, 0.1, 0.06), dark, [0, -0.02, 0.0], [0.3, 0, 0]);
    c.pulse(em, 1.6, 0.4, 8, 2);
    c.muzzle.position.set(0, 0.06, 0.4);
  },

  cowboy(c, d) {
    const C = d.colors;
    const brown = c.mat(C.main, { double: true });
    const blue = c.mat(C.accent);
    const tan = c.mat(C.extra);
    const skin = c.mat(C.skin);
    const leather = c.mat(0x4a2e18);
    const metal = c.mat(0x6a6e78, { metalness: 0.8, roughness: 0.3 });
    const goldM = c.mat(0xffd24a, { metalness: 0.85, roughness: 0.25 });
    const red = c.mat(0xc0302a);
    base(c, {
      skin, torso: blue, pelvis: c.mat(0x34466a), upperArm: blue, foreArm: blue, hand: skin,
      thigh: c.mat(0x34466a), shin: c.mat(0x6a4424), foot: c.mat(0x5a3a1e),
    });
    // 马甲（前开）+ 警长星 + 皮带
    c.add(c.upper, cyl(0.17, 0.205, 0.34, 8, true, 0.5, TAU - 1.0), brown, [0, 0.22, 0]);
    c.add(c.upper, octa(0.05), goldM, [0.125, 0.3, 0.145], [0, 0.7, 0], [1, 1, 0.35]);
    c.add(c.upper, torus(0.198, 0.03, 4, 12), leather, [0, 0.04, 0], [PI / 2, 0, 0]);
    c.add(c.upper, box(0.08, 0.06, 0.03), goldM, [0, 0.04, 0.205]);
    // 红色领巾（前三角 + 后结）
    c.add(c.upper, cone(0.19, 0.2, 3), red, [0, 0.35, 0.1], [PI, 0, 0], [1, 1, 0.55]);
    c.add(c.upper, sphere(0.05, 6, 5), red, [0, 0.42, -0.15]);
    // 宽檐牛仔帽
    c.add(c.head, cyl(0.47, 0.47, 0.035, 14), tan, [0, 0.17, -0.01], [-0.1, 0, 0], [1, 1, 0.92]);
    c.add(c.head, cyl(0.2, 0.25, 0.24, 10), tan, [0, 0.3, -0.03], [-0.1, 0, 0], [1, 1, 0.9]);
    c.add(c.head, torus(0.235, 0.025, 4, 14), leather, [0, 0.21, -0.02], [PI / 2 - 0.1, 0, 0], [1, 0.9, 1]);
    // 八字胡
    c.add(c.head, box(0.18, 0.04, 0.04), c.mat(0x6a4424), [0, -0.09, 0.262]);
    // 腰间套索
    c.add(c.upper, torus(0.1, 0.022, 4, 12), c.mat(0xc8a060), [0.21, 0.05, -0.08], [0, PI / 2, 0]);
    // 左轮手枪
    const gun = c.grp(c.weapon);
    c.add(gun, box(0.045, 0.12, 0.06), c.mat(0x7a4a24), [0, -0.02, -0.02], [0.35, 0, 0]);
    c.add(gun, cyl(0.045, 0.045, 0.08, 6), metal, [0, 0.06, 0.05], [PI / 2, 0, 0]);
    c.add(gun, cyl(0.018, 0.018, 0.22, 6), metal, [0, 0.075, 0.17], [PI / 2, 0, 0]);
    c.muzzle.position.set(0, 0.075, 0.29);
  },

  ninja(c, d) {
    const C = d.colors;
    const black = c.mat(C.main);
    const red = c.mat(C.accent);
    const steel = c.mat(C.extra, { metalness: 0.8, roughness: 0.25, emissive: C.extra, ei: 0.15 });
    const skin = c.mat(C.skin, { double: true });
    base(c, {
      skin, headMat: black, eyeR: 0.292, torso: black, pelvis: black, upperArm: black, foreArm: black,
      hand: c.mat(0x2e303c), thigh: black, shin: c.mat(0x3a3c48), foot: black,
    });
    // 面罩露出的眼部
    c.add(c.head, partSphere(0.285, 12, 2, PI / 2 - 0.85, 1.7, 0.43 * PI, 0.12 * PI), skin);
    // 红色头带 + 护额 + 结 + 飘带
    c.add(c.head, torus(0.29, 0.035, 5, 16), red, [0, 0.12, 0], [PI / 2 - 0.12, 0, 0]);
    c.add(c.head, box(0.14, 0.07, 0.02), steel, [0, 0.155, 0.285], [-0.12, 0, 0]);
    c.add(c.head, sphere(0.05, 6, 5), red, [0, 0.09, -0.3]);
    for (const sg of [1, -1]) {
      const tail = c.grp(c.head, [0.03 * sg, 0.09, -0.31], [0, 0.15 * sg, 0]);
      c.add(tail, trap(0.06, 0.04, 0.02, 0.44), red, [0, 0, -0.22]);
      c.flutter(tail, 'x', -0.9, 0.85, 0.25, 9, sg);
      c.flutters.push({ obj: tail, axis: 'y', base: 0.15 * sg, run: 0.1 * sg, amp: 0.18, freq: 6.5, phase: sg * 2 });
    }
    // 背后武士刀
    const katana = c.grp(c.upper, [0, 0.24, -0.22], [0, 0, 0.75]);
    c.add(katana, cyl(0.03, 0.03, 0.6, 6), c.mat(0x3a1016), [0, -0.05, 0]);
    c.add(katana, cyl(0.025, 0.025, 0.18, 6), red, [0, 0.34, 0]);
    c.add(katana, cyl(0.065, 0.065, 0.02, 8), steel, [0, 0.25, 0]);
    // 红腰带 + 垂带
    c.add(c.upper, torus(0.198, 0.035, 4, 12), red, [0, 0.06, 0], [PI / 2, 0, 0]);
    const sash = c.grp(c.upper, [0.1, 0.05, -0.16]);
    c.add(sash, box(0.06, 0.24, 0.02), red, [0, -0.12, 0]);
    c.flutter(sash, 'x', 0.3, 0.7, 0.2, 8);
    // 手里剑（旋转）
    const star = c.grp(c.weapon, [0, 0.03, 0.1]);
    c.add(star, box(0.3, 0.015, 0.06), steel);
    c.add(star, box(0.06, 0.015, 0.3), steel);
    c.add(star, cyl(0.035, 0.035, 0.03, 8), c.mat(0x22242e));
    c.spin(star, 'y', 14);
    c.muzzle.position.set(0, 0.03, 0.12);
    c.cfg.held = star;
  },

  mecha(c, d) {
    const C = d.colors;
    const red = c.mat(C.main, { metalness: 0.45, roughness: 0.35 });
    const redH = c.mat(C.main, { metalness: 0.45, roughness: 0.35, double: true });
    const white = c.mat(C.accent, { metalness: 0.2, roughness: 0.45 });
    const cyanMat = c.glow(C.extra, 1.8);
    const grey = c.mat(0x8a90a0, { metalness: 0.5, roughness: 0.4 });
    const dark = c.mat(0x3a3e4a, { metalness: 0.5, roughness: 0.45 });
    base(c, {
      skin: c.mat(C.skin), torso: white, pelvis: dark, upperArm: white, foreArm: red, hand: grey,
      thigh: white, shin: red, foot: dark,
    });
    // 头盔 + 发光护目镜 + 耳部天线 + 顶鳍
    c.shell(c.head, redH, 0.305, 0.3 * PI, 0.62 * PI, 1.8);
    const visor = c.mat(C.extra, { emissive: C.extra, ei: 1.6, double: true });
    c.add(c.head, partSphere(0.31, 12, 2, PI / 2 - 0.8, 1.6, 0.41 * PI, 0.1 * PI), visor);
    c.pulse(visor, 1.5, 0.35, 2.5);
    for (const sg of [1, -1]) {
      const a = PI / 2 - 0.6;
      c.add(c.head, cone(0.045, 0.16, 5), white, [sg * 0.37, 0.1, 0], [0, 0, -sg * a]);
    }
    c.add(c.head, box(0.03, 0.12, 0.26), white, [0, 0.32, -0.02]);
    // 胸甲 + 能量核心
    c.add(c.upper, box(0.34, 0.2, 0.08), red, [0, 0.28, 0.14]);
    c.add(c.upper, cyl(0.05, 0.05, 0.03, 8), cyanMat, [0, 0.28, 0.185], [PI / 2, 0, 0]);
    c.pulse(cyanMat, 1.8, 0.6, 3);
    // 肩甲 + 导弹舱
    const tipMat = c.mat(0xff3a2a, { emissive: 0xff3a2a, ei: 0.4 });
    for (const sg of [1, -1]) {
      c.add(c.upper, box(0.16, 0.1, 0.2), red, [0.26 * sg, 0.47, 0]);
      c.add(c.upper, box(0.13, 0.1, 0.22), white, [0.26 * sg, 0.57, -0.02]);
      for (const dx of [-0.03, 0.03]) c.add(c.upper, cone(0.028, 0.08, 6), tipMat, [0.26 * sg + dx, 0.57, 0.12], [PI / 2, 0, 0]);
    }
    // 背部喷射背包
    const flame = c.glow(C.extra, 2);
    for (const sg of [1, -1]) {
      c.add(c.upper, cyl(0.07, 0.07, 0.3, 8), white, [0.09 * sg, 0.24, -0.25]);
      c.add(c.upper, cone(0.06, 0.16, 8), flame, [0.09 * sg, 0.01, -0.25], [PI, 0, 0]);
    }
    c.pulse(flame, 1.6, 0.8, 11);
    // 右臂炮
    const cannon = c.grp(c.weapon);
    c.add(cannon, cyl(0.075, 0.085, 0.3, 8), red, [0, 0, 0.04], [PI / 2, 0, 0]);
    const ring = c.glow(d.weapon.color, 1.8);
    c.add(cannon, torus(0.07, 0.018, 4, 10), ring, [0, 0, 0.2]);
    c.add(cannon, cyl(0.035, 0.035, 0.08, 8), dark, [0, 0, 0.22], [PI / 2, 0, 0]);
    c.pulse(ring, 1.5, 0.4, 5, 2);
    c.muzzle.position.set(0, 0, 0.28);
  },

  princess(c, d) {
    const C = d.colors;
    const ice = c.mat(C.main);
    const iceD = c.mat(shade(C.main, 0.85), { double: true });
    const white = c.mat(C.accent);
    const hair = c.mat(C.extra, { double: true });
    const skin = c.mat(C.skin);
    const gold = c.mat(0xffe070, { metalness: 0.8, roughness: 0.25 });
    base(c, {
      skin, torso: ice, pelvis: ice, upperArm: white, foreArm: skin, hand: skin,
      thigh: white, shin: white, foot: c.mat(0xa8d8ff), blush: true,
    });
    // 头发：发壳 + 刘海 + 侧发 + 飘逸长发
    c.shell(c.head, hair, 0.3, 0.3 * PI, 0.6 * PI, 1.5);
    c.add(c.head, box(0.36, 0.1, 0.1), hair, [0, 0.16, 0.2], [-0.4, 0, 0]);
    for (const sg of [1, -1]) c.add(c.head, box(0.07, 0.34, 0.07), hair, [0.25 * sg, -0.14, 0.06], [0, 0, 0.1 * sg]);
    const longHair = c.grp(c.head, [0, 0.08, -0.22]);
    c.add(longHair, trap(0.4, 0.46, 0.62, 0.08), hair, [0, -0.3, -0.03]);
    c.flutter(longHair, 'x', 0.18, 0.55, 0.1, 5);
    // 王冠 + 冰晶
    c.add(c.head, torus(0.22, 0.018, 4, 14), gold, [0, 0.2, 0.02], [PI / 2 - 0.35, 0, 0]);
    const gem = c.glow(d.weapon.color, 1.4);
    c.add(c.head, octa(0.055), gem, [0, 0.3, 0.2], null, [1, 1.4, 1]);
    for (const sg of [1, -1]) c.add(c.head, cone(0.025, 0.08, 4), gold, [0.09 * sg, 0.29, 0.17]);
    // 礼服裙摆 + 冰晶披风
    c.add(c.rig, cyl(0.2, 0.4, 0.36, 12, true, 0.8, TAU - 1.6), iceD, [0, -0.06, 0]);
    const cape = c.grp(c.upper, [0, 0.4, -0.16]);
    c.add(cape, trap(0.32, 0.5, 0.52, 0.02), c.mat(d.weapon.color, { opacity: 0.75, double: true, roughness: 0.3 }), [0, -0.26, 0]);
    c.flutter(cape, 'x', 0.15, 0.7, 0.12, 6);
    // 冰晶魔杖
    const wand = c.grp(c.weapon);
    c.add(wand, cyl(0.016, 0.02, 0.42, 5), white, [0, 0.12, 0.02]);
    const crystal = c.glow(d.weapon.color, 1.8);
    const cr = c.add(wand, octa(0.065), crystal, [0, 0.37, 0.02], null, [1, 1.6, 1]);
    c.spin(cr, 'y', 2.5);
    c.pulse(crystal, 1.7, 0.4, 3, 2.5);
    c.muzzle.position.set(0, 0.37, 0.06);
  },

  caveman(c, d) {
    const C = d.colors;
    const fur = c.mat(C.main);
    const furD = c.mat(shade(C.main, 0.8), { double: true });
    const bone = c.mat(C.accent);
    const skin = c.mat(C.skin);
    const hair = c.mat(C.extra);
    base(c, {
      skin, torso: skin, pelvis: fur, upperArm: skin, foreArm: skin, hand: skin,
      thigh: skin, shin: fur, foot: skin, handScale: 1.25,
    });
    // 兽皮衣 + 斜肩带 + 斑点 + 兽皮裙
    c.add(c.upper, cyl(0.2, 0.215, 0.26, 7), fur, [0, 0.13, 0]);
    c.add(c.upper, box(0.09, 0.5, 0.05), fur, [0.05, 0.3, 0.16], [0, 0, -0.5]);
    c.add(c.upper, box(0.09, 0.5, 0.05), fur, [0.05, 0.3, -0.16], [0, 0, -0.5]);
    for (const p of [[0.1, 0.18, 0.18], [-0.12, 0.08, 0.18], [0.05, 0.1, -0.2]]) c.add(c.upper, sphere(0.04, 6, 4), bone, p, null, [1, 0.6, 0.45]);
    c.add(c.rig, cyl(0.2, 0.3, 0.2, 7, true), furD, [0, 0.0, 0]);
    // 爆炸头 + 大胡子 + 一字眉 + 骨头发饰
    for (const [p, r] of [[[0, 0.2, -0.05], 0.17], [[-0.17, 0.12, -0.1], 0.14], [[0.17, 0.12, -0.1], 0.14], [[0, 0.06, -0.22], 0.16], [[0.08, 0.26, 0.09], 0.12]]) {
      c.add(c.head, ico(r), hair, p);
    }
    c.add(c.head, ico(0.16), hair, [0, -0.17, 0.15], null, [1.2, 1, 0.8]);
    for (const sg of [1, -1]) c.add(c.head, ico(0.1), hair, [0.17 * sg, -0.1, 0.12]);
    c.add(c.head, box(0.26, 0.05, 0.05), hair, [0, 0.09, 0.255]);
    c.add(c.head, cyl(0.02, 0.02, 0.26, 5), bone, [0, 0.36, -0.02], [0, 0, PI / 2]);
    for (const sg of [1, -1]) c.add(c.head, sphere(0.035, 5, 4), bone, [0.13 * sg, 0.36, -0.02]);
    // 背后木棒
    c.add(c.upper, cyl(0.1, 0.045, 0.6, 7), c.mat(0x6a4424), [0, 0.2, -0.24], [0, 0, -0.6]);
    // 手中巨石
    const rock = c.grp(c.weapon);
    c.add(rock, dode(0.15), c.mat(d.weapon.color, { roughness: 0.95 }), [0, 0.06, 0.07]);
    c.muzzle.position.set(0, 0.06, 0.12);
    c.cfg.held = rock;
  },

  pirate(c, d) {
    const C = d.colors;
    const red = c.mat(C.main);
    const redD = c.mat(shade(C.main, 0.85), { double: true });
    const black = c.mat(C.accent);
    const gold = c.mat(C.extra, { metalness: 0.8, roughness: 0.3 });
    const skin = c.mat(C.skin);
    const pants = c.mat(0x2a2a3a);
    const beardM = c.mat(0x2a1a14);
    base(c, {
      skin, torso: red, pelvis: pants, upperArm: red, foreArm: red, hand: skin,
      thigh: pants, shin: black, foot: black,
    });
    // 长大衣：下摆 + 燕尾 + 金纽扣 + 领巾 + 皮带
    c.add(c.rig, cyl(0.2, 0.3, 0.3, 10, true, 0.7, TAU - 1.4), redD, [0, -0.02, -0.01]);
    for (const sg of [1, -1]) {
      const tail = c.grp(c.rig, [0.1 * sg, 0.04, -0.2]);
      c.add(tail, trap(0.12, 0.16, 0.4, 0.03), redD, [0, -0.2, 0]);
      c.flutter(tail, 'x', 0.25, 0.8, 0.15, 7, sg);
    }
    for (const y of [0.12, 0.22, 0.32]) c.add(c.upper, sphere(0.026, 5, 4), gold, [0, y, 0.19 - 0.03 * y / 0.4 + 0.005]);
    c.add(c.upper, box(0.12, 0.1, 0.05), c.mat(0xf2efe6), [0, 0.37, 0.15]);
    c.add(c.upper, torus(0.198, 0.03, 4, 12), black, [0, 0.04, 0], [PI / 2, 0, 0]);
    c.add(c.upper, box(0.07, 0.06, 0.03), gold, [0, 0.04, 0.205]);
    // 三角帽 + 骷髅徽记
    c.add(c.head, cyl(0.47, 0.47, 0.03, 3), gold, [0, 0.19, 0]);
    c.add(c.head, cyl(0.45, 0.45, 0.06, 3), black, [0, 0.215, 0]);
    c.add(c.head, cyl(0.2, 0.25, 0.2, 10), black, [0, 0.32, -0.02]);
    c.add(c.head, sphere(0.05, 6, 5), c.mat(0xf2efe6), [0, 0.31, 0.225]);
    // 眼罩 + 系带 + 胡子
    c.add(c.head, cyl(0.06, 0.06, 0.02, 8), black, [0.1, 0.01, 0.285], [PI / 2, 0, 0]);
    c.add(c.head, torus(0.284, 0.009, 3, 20), black, [0, 0.05, 0], [PI / 2 - 0.3, 0, 0]);
    c.add(c.head, cone(0.15, 0.22, 6), beardM, [0, -0.24, 0.17], [PI + 0.3, 0, 0]);
    c.add(c.head, box(0.2, 0.04, 0.04), beardM, [0, -0.09, 0.265]);
    // 肩上的鹦鹉
    const parrot = c.grp(c.upper, [0.25, 0.5, -0.02]);
    c.add(parrot, sphere(0.07, 7, 6), c.mat(0x2ab04a), [0, 0.06, 0], null, [0.9, 1.2, 0.9]);
    const pHead = c.grp(parrot, [0, 0.16, 0.02]);
    c.add(pHead, sphere(0.055, 7, 6), c.mat(0x2ab04a));
    c.add(pHead, cone(0.025, 0.06, 5), c.mat(0xffc400), [0, -0.01, 0.06], [PI / 2 + 0.4, 0, 0]);
    c.add(parrot, box(0.05, 0.14, 0.02), c.mat(0xd8303a), [0, -0.02, -0.08], [-0.8, 0, 0]);
    c.add(parrot, box(0.03, 0.1, 0.1), c.mat(0x2a6ad8), [0.06, 0.06, -0.01]);
    c.flutter(parrot, 'x', 0, -0.1, 0.07, 3);
    c.flutter(pHead, 'y', 0, 0, 0.5, 1.3);
    // 手炮
    const gun = c.grp(c.weapon);
    c.add(gun, box(0.06, 0.08, 0.22), c.mat(0x6a4424), [0, -0.01, -0.04]);
    c.add(gun, cyl(0.085, 0.05, 0.34, 8), c.mat(0x2a2a30, { metalness: 0.7, roughness: 0.35 }), [0, 0.04, 0.16], [PI / 2, 0, 0]);
    c.add(gun, torus(0.058, 0.014, 4, 10), gold, [0, 0.04, 0.06]);
    c.muzzle.position.set(0, 0.04, 0.34);
  },
};

// 未知骑手的兜底外观
BUILDERS.generic = (c, d) => {
  const C = d.colors || { main: 0x8888aa, accent: 0x444466, skin: 0xf2c9a0, extra: 0xffd24a };
  const m = c.mat(C.main);
  base(c, { skin: c.mat(C.skin), torso: m, pelvis: c.mat(C.accent), upperArm: m, foreArm: m, hand: c.mat(C.skin), thigh: c.mat(C.accent), shin: c.mat(C.accent), foot: c.mat(0x333333) });
  c.add(c.weapon, sphere(0.08, 8, 6), c.glow(C.extra, 1.5), [0, 0, 0.1]);
  c.muzzle.position.set(0, 0, 0.15);
};

// ---------------------------------------------------------------------
//  动作风格
// ---------------------------------------------------------------------
const STYLE = {
  spear: 'throw', rock: 'throw', shuriken: 'throw',
  arrow: 'bow',
  fireball: 'cast', ice: 'cast',
  laser: 'gun', bullet: 'gun', missile: 'gun', cannon: 'gun',
};
const RECOIL = { laser: 0.4, bullet: 0.9, missile: 0.7, cannon: 1.8 };
// 静止持械姿势：肩俯仰 sx、外展 sz、肘 ex、武器俯仰 tilt(+ 向下/向前)
const REST = {
  throw: { sx: -0.5, sz: -0.12, ex: -0.95, tilt: 0.08 },
  bow: { sx: -0.6, sz: -0.12, ex: -0.8, tilt: 0.0 },
  cast: { sx: -0.45, sz: -0.15, ex: -0.95, tilt: 0.12 },
  gun: { sx: -0.45, sz: -0.1, ex: -0.95, tilt: 0.3 },
};
const CHEER_TILT = { throw: -1.2, bow: 0, cast: 0, gun: -1.1 };
const L_REST = { sx: -0.55, sz: 0.15, ex: -0.9 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// ---------------------------------------------------------------------
//  入口
// ---------------------------------------------------------------------
export function createRiderModel(def) {
  const c = makeCtx(def);
  (BUILDERS[def.id] || BUILDERS.generic)(c, def);

  const wType = def.weapon?.type;
  const style = STYLE[wType] || 'gun';
  const R = REST[style];
  const recoilK = RECOIL[wType] ?? 0.8;
  const cheerTilt = CHEER_TILT[style];
  const { rig, upper, torso, head, arms, weapon, flutters, spins, pulses } = c;
  const held = c.cfg.held || null;
  const arrow = c.cfg.arrow || null;

  // 姿势暂存（避免每帧分配）
  const P = { rsx: 0, rsz: 0, rex: 0, rez: 0, lsx: 0, lsz: 0, lex: 0, lez: 0, tilt: 0, twist: 0, leanX: 0, wVis: true, aVis: true, castK: 0 };
  const st = { clock: 0, phase: 0, bounce: 0, cheer: 0 };

  function computePose(p) {
    P.rsx = R.sx; P.rsz = R.sz; P.rex = R.ex; P.rez = 0; P.tilt = R.tilt;
    P.lsx = L_REST.sx; P.lsz = L_REST.sz; P.lex = L_REST.ex; P.lez = 0;
    P.twist = 0; P.leanX = 0; P.wVis = true; P.aVis = true; P.castK = 0;
    if (!(p >= 0 && p <= 1)) return;
    let k;
    switch (style) {
      case 'throw': {
        // 蓄力后摆 → 前掷 → 收回
        if (p < 0.35) {
          k = ease(p / 0.35);
          P.rsx = lerp(R.sx, -3.0, k); P.rex = lerp(R.ex, -0.5, k); P.rsz = lerp(R.sz, -0.25, k);
          P.twist = -0.35 * k; P.tilt = lerp(R.tilt, -0.15, k); P.leanX = -0.08 * k;
        } else if (p < 0.55) {
          k = ease((p - 0.35) / 0.2);
          P.rsx = lerp(-3.0, -1.1, k); P.rex = lerp(-0.5, -0.05, k); P.rsz = lerp(-0.25, -0.1, k);
          P.twist = lerp(-0.35, 0.3, k); P.tilt = lerp(-0.15, 0.4, k); P.leanX = lerp(-0.08, 0.18, k);
        } else {
          k = ease((p - 0.55) / 0.45);
          P.rsx = lerp(-1.1, R.sx, k); P.rex = lerp(-0.05, R.ex, k); P.rsz = lerp(-0.1, R.sz, k);
          P.twist = lerp(0.3, 0, k); P.tilt = lerp(0.4, R.tilt, k); P.leanX = lerp(0.18, 0, k);
        }
        P.lsx = lerp(L_REST.sx, -1.3, Math.sin(p * PI));
        P.lsz = lerp(L_REST.sz, 0.45, Math.sin(p * PI));
        P.wVis = !(p > 0.5 && p < 0.85);
        break;
      }
      case 'gun': {
        // 抬枪瞄准 → 后坐力上跳 → 放下
        const aim = p < 0.12 ? ease(p / 0.12) : p < 0.55 ? 1 : 1 - ease((p - 0.55) / 0.45);
        const rec = p > 0.12 ? Math.exp(-(p - 0.12) * 12) * recoilK : 0;
        P.rsx = lerp(R.sx, -1.5, aim) - rec * 0.35;
        P.rex = lerp(R.ex, -0.06, aim);
        P.rsz = lerp(R.sz, 0.05, aim);
        P.tilt = lerp(R.tilt, 0, aim) - rec * 0.7;
        P.leanX = -rec * 0.12;
        P.twist = -0.15 * aim;
        P.castK = aim;
        break;
      }
      case 'bow': {
        // 右手推弓，左手拉弦 → 松弦
        const aim = p < 0.15 ? ease(p / 0.15) : p < 0.6 ? 1 : 1 - ease((p - 0.6) / 0.4);
        const draw = p < 0.4 ? ease(p / 0.4) : p < 0.48 ? 1 - (p - 0.4) / 0.08 : 0;
        P.rsx = lerp(R.sx, -1.5, aim); P.rex = lerp(R.ex, -0.05, aim); P.rsz = lerp(R.sz, 0.1, aim);
        P.tilt = lerp(R.tilt, 0, aim); P.twist = -0.3 * aim;
        P.lsx = lerp(L_REST.sx, -1.45, aim); P.lsz = lerp(L_REST.sz, -0.45, aim);
        P.lex = lerp(L_REST.ex, -0.1, aim); P.lez = 2.3 * draw;
        P.aVis = p < 0.45 || p > 0.8;
        break;
      }
      case 'cast': {
        // 举杖蓄能 → 前指释放 → 收回
        if (p < 0.4) {
          k = ease(p / 0.4);
          P.rsx = lerp(R.sx, -2.7, k); P.rex = lerp(R.ex, -0.3, k); P.tilt = lerp(R.tilt, -0.4, k); P.leanX = -0.1 * k;
          P.lsx = lerp(L_REST.sx, -2.2, k); P.lsz = lerp(L_REST.sz, 0.5, k);
        } else if (p < 0.6) {
          k = ease((p - 0.4) / 0.2);
          P.rsx = lerp(-2.7, -1.35, k); P.rex = lerp(-0.3, -0.15, k); P.tilt = lerp(-0.4, 0.9, k); P.leanX = lerp(-0.1, 0.2, k);
          P.lsx = lerp(-2.2, -1.3, k); P.lsz = lerp(0.5, 0.2, k);
        } else {
          k = ease((p - 0.6) / 0.4);
          P.rsx = lerp(-1.35, R.sx, k); P.rex = lerp(-0.15, R.ex, k); P.tilt = lerp(0.9, R.tilt, k); P.leanX = lerp(0.2, 0, k);
          P.lsx = lerp(-1.3, L_REST.sx, k); P.lsz = lerp(0.2, L_REST.sz, k);
        }
        P.castK = Math.sin(p * PI);
        break;
      }
    }
  }

  function update(dt, s = {}) {
    dt = clamp(dt || 0, 0, 0.1);
    st.clock += dt;
    const t = s.t ?? st.clock;
    const lean = clamp(s.lean || 0, -1, 1);
    st.bounce += (clamp(s.bounce || 0, 0, 1.8) - st.bounce) * Math.min(1, dt * 8);
    st.cheer += ((s.cheer ? 1 : 0) - st.cheer) * Math.min(1, dt * 6);
    const B = st.bounce;
    const cw = st.cheer;
    st.phase += dt * (8 + 4 * B);

    computePose(s.shoot ?? -1);

    // 欢呼：双臂高举挥舞
    if (cw > 0.001) {
      const w1 = Math.sin(t * 9) * 0.22;
      const w2 = Math.sin(t * 9 + 1.3) * 0.22;
      P.rsx = lerp(P.rsx, -2.85 + w1, cw); P.rsz = lerp(P.rsz, -0.4, cw); P.rex = lerp(P.rex, -0.25, cw); P.rez = lerp(P.rez, 0, cw);
      P.lsx = lerp(P.lsx, -2.85 + w2, cw); P.lsz = lerp(P.lsz, 0.4, cw); P.lex = lerp(P.lex, -0.25, cw); P.lez = lerp(P.lez, 0, cw);
      P.tilt = lerp(P.tilt, cheerTilt, cw); P.twist *= 1 - cw; P.leanX = lerp(P.leanX, -0.08, cw);
    }

    // 身体：颠簸 / 前倾 / 侧倾 / 呼吸
    rig.position.y = Math.abs(Math.sin(st.phase)) * 0.06 * B + cw * Math.abs(Math.sin(t * 7)) * 0.05;
    upper.rotation.x = 0.1 * B + Math.sin(st.phase * 2) * 0.035 * B + Math.sin(t * 1.7) * 0.015 + P.leanX;
    upper.rotation.z = lean * 0.22 + Math.sin(st.phase) * 0.03 * B;
    upper.rotation.y = P.twist + Math.sin(t * 0.5) * 0.04;
    const br = Math.sin(t * 2.2) * 0.02;
    torso.scale.set(1 + br * 0.6, 1 + br, 1 + br * 0.6);
    head.rotation.x = -0.1 * B - P.leanX * 0.5 + Math.sin(t * 1.3) * 0.04;
    head.rotation.y = -lean * 0.3 + Math.sin(t * 0.45) * 0.18 * Math.max(0, 1 - B);
    head.rotation.z = Math.sin(t * 0.9) * 0.03 + lean * 0.05;

    // 手臂
    arms.R.shoulder.rotation.set(P.rsx, 0, P.rsz);
    arms.R.elbow.rotation.set(P.rex, 0, P.rez);
    arms.L.shoulder.rotation.set(P.lsx + Math.sin(st.phase) * 0.08 * B, 0, P.lsz);
    arms.L.elbow.rotation.set(P.lex, 0, P.lez);
    // 武器保持“水平”（抵消手臂与上身俯仰）+ 姿势俯仰
    weapon.rotation.x = -(upper.rotation.x + P.rsx + P.rex) + P.tilt;
    if (held) held.visible = P.wVis;
    if (arrow) arrow.visible = P.aVis;

    // 飘动 / 旋转 / 发光脉动
    const fAmp = 0.35 + B;
    const fSpd = 1 + 0.5 * B;
    for (let i = 0; i < flutters.length; i++) {
      const f = flutters[i];
      f.obj.rotation[f.axis] = f.base + f.run * B + Math.sin(t * f.freq * fSpd + f.phase) * f.amp * fAmp;
    }
    for (let i = 0; i < spins.length; i++) {
      const f = spins[i];
      f.obj.rotation[f.axis] += dt * f.speed * (1 + (s.shoot >= 0 ? 1.5 : 0));
    }
    for (let i = 0; i < pulses.length; i++) {
      const f = pulses[i];
      f.mat.emissiveIntensity = Math.max(0, f.base + Math.sin(t * f.freq + f.phase) * f.amp + P.castK * f.cast);
    }
  }

  // 让 muzzle 在初始姿势下即处于正确位置
  update(0, { t: 0 });

  return {
    root: c.root,
    muzzle: c.muzzle,
    update,
    meshCount: c.meshes,
  };
}
