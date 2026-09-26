// =====================================================================
//  跑道模块：沿 +Z 无限延伸的笔直道路（跑酷射击玩法）
//  createTrack(biome, scene, opts) → { roadHalf, heightAt, update, sun, root, dispose }
//  - 地形按 60m 分块流式生成（前方 300m / 后方 40m），块内容由 (生态, 块号) 种子决定
//  - 装饰物使用“环形槽位”InstancedMesh：每种装饰全局只有 1~2 次绘制
//  - 生态的天空 / 雾 / 灯光 / 天气与 world.js 竞技场完全一致
// =====================================================================
import * as THREE from 'three';
import {
  BIOMES, W, clamp, lerp, smooth, mulberry32, hashStr, hash3, makeNoise, fbm, ridged,
  T, part, merge, jitter, gradientY, decoMaterial, makeSprite, waterMaterial, bannerMaterial, lavaMaterial, skyMaterial,
  geoRock, geoCapRock, geoBroadleaf, geoPalm, geoFern, geoFlower, geoGrass, geoSaguaro, geoPricklyPear, geoMesa, geoRibcage,
  geoSkull, geoShrub, geoPine, geoIceCluster, geoIceSpire, geoDrift, geoDeadTree, geoMushStem, geoMushCap, geoReeds, geoLily,
  geoShardCluster, geoPillar, geoWall, geoSpire, geoBannerPole, buildDistantVolcano, buildCitadel,
} from './world.js';

export const ROAD_HALF = 9;
const FLAT = ROAD_HALF + 1;          // |x| ≤ 10 完全平整
const CHUNK = 60;                    // 块长度
const DZ = 2.5;                      // 地形行距
const ROWS = Math.round(CHUNK / DZ);
const BEHIND = 40;
const AHEAD = 300;
const SLOTS = 8;                     // 同时存在的块槽位（窗口最多 7 块）
const TAU = Math.PI * 2;
const HALF_XS = [0, 4.5, 9, 10, 11.5, 13, 15, 17.5, 20, 23, 27, 32, 38, 45, 53, 62, 72, 84, 98, 115, 135];
const XS = [...HALF_XS.slice(1).reverse().map((v) => -v), ...HALF_XS];
const NX = XS.length;
const XMAX = HALF_XS[HALF_XS.length - 1];
const LANDMARK_STEP = 150;
const BEND_PAD = 80;              // 弯道偏移的包围球余量（米）
const PROP_STEP = 24;

const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const col = (hex) => new THREE.Color(hex);

function colIndex(x) {
  let lo = 0, hi = NX - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (XS[mid] <= x) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// 发光零件：顶点色直接写入 HDR 值（>1 会触发泛光）
function glowPart(geo, r, g, b, m) {
  const p = part(geo, 0xffffff, m);
  const c = p.attributes.color.array;
  for (let i = 0; i < c.length; i += 3) { c[i] = r; c[i + 1] = g; c[i + 2] = b; }
  return p;
}

// ---------------------------------------------------------------------
//  非索引三角形缓冲（道路 / 发光线条）
// ---------------------------------------------------------------------
class GeoBuf {
  constructor() { this.p = []; this.c = []; }
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, r, g, b) {
    this.p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.c.push(r, g, b, r, g, b, r, g, b);
  }
  // 朝上的平面四边形：x0..x1 × za..zb，y 沿 z 变化
  quad(x0, x1, za, zb, ya, yb, cc) {
    this.tri(x0, ya, za, x0, yb, zb, x1, yb, zb, cc.r, cc.g, cc.b);
    this.tri(x0, ya, za, x1, yb, zb, x1, ya, za, cc.r, cc.g, cc.b);
  }
  // 逐顶点着色的四边形（平滑过渡，无棋盘格）
  quadFn(x0, x1, za, zb, ya, yb, fn) {
    fn(x0, za); const r0 = _c2.r, g0 = _c2.g, b0 = _c2.b;
    fn(x0, zb); const r1 = _c2.r, g1 = _c2.g, b1 = _c2.b;
    fn(x1, zb); const r2 = _c2.r, g2 = _c2.g, b2 = _c2.b;
    fn(x1, za); const r3 = _c2.r, g3 = _c2.g, b3 = _c2.b;
    this.p.push(x0, ya, za, x0, yb, zb, x1, yb, zb, x0, ya, za, x1, yb, zb, x1, ya, za);
    this.c.push(r0, g0, b0, r1, g1, b1, r2, g2, b2, r0, g0, b0, r2, g2, b2, r3, g3, b3);
  }
  // 垂直面：朝 -z（front=true）或 +z
  faceZ(x0, x1, z, yTop, yBot, cc, front) {
    if (front) {
      this.tri(x0, yTop, z, x1, yTop, z, x1, yBot, z, cc.r, cc.g, cc.b);
      this.tri(x0, yTop, z, x1, yBot, z, x0, yBot, z, cc.r, cc.g, cc.b);
    } else {
      this.tri(x1, yTop, z, x0, yTop, z, x0, yBot, z, cc.r, cc.g, cc.b);
      this.tri(x1, yTop, z, x0, yBot, z, x1, yBot, z, cc.r, cc.g, cc.b);
    }
  }
  // 垂直面：朝 ±x
  faceX(x, za, zb, yTopA, yTopB, yBotA, yBotB, cc, outward) {
    if (outward > 0) {
      this.tri(x, yTopA, za, x, yBotA, za, x, yBotB, zb, cc.r, cc.g, cc.b);
      this.tri(x, yTopA, za, x, yBotB, zb, x, yTopB, zb, cc.r, cc.g, cc.b);
    } else {
      this.tri(x, yTopA, za, x, yTopB, zb, x, yBotB, zb, cc.r, cc.g, cc.b);
      this.tri(x, yTopA, za, x, yBotB, zb, x, yBotA, za, cc.r, cc.g, cc.b);
    }
  }
  // 任意方向的贴地条带（y 由 yFn(x,z) 给出）
  ribbon(xa, za, xb, zb, w, yFn, r, g, b) {
    let dx = xb - xa, dz = zb - za;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    const px = -dz * w, pz = dx * w;
    const A = [xa + px, za + pz], B = [xa - px, za - pz], C = [xb + px, zb + pz], D = [xb - px, zb - pz];
    const yA = yFn(A[0], A[1]), yB = yFn(B[0], B[1]), yC = yFn(C[0], C[1]), yD = yFn(D[0], D[1]);
    // 发光材质为双面，写一个朝向即可
    this.tri(A[0], yA, A[1], C[0], yC, C[1], D[0], yD, D[1], r, g, b);
    this.tri(A[0], yA, A[1], D[0], yD, D[1], B[0], yB, B[1], r, g, b);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
  get empty() { return this.p.length === 0; }
}

// ---------------------------------------------------------------------
//  环形槽位装饰：每种装饰 = 近处(投影) + 远处(不投影) 两个 InstancedMesh
// ---------------------------------------------------------------------
class Deco {
  constructor(ctx, name, geo, mat, capNear, capFar, { split = 30, receive = true } = {}) {
    this.name = name;
    this.cap = [capNear | 0, capFar | 0];
    this.split = split;
    this.meshes = this.cap.map((cap, k) => {
      if (!cap) return null;
      const n = cap * SLOTS;
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.name = name + (k ? ':far' : ':near');
      m.castShadow = k === 0;
      m.receiveShadow = receive;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) m.setMatrixAt(i, ZERO);
      ctx.root.add(m);
      return m;
    });
  }
  write(slot, items) {
    const fill = [0, 0];
    if (items) {
      for (const it of items) {
        let k = Math.abs(it.x) < this.split ? 0 : 1;
        if (!this.meshes[k] || fill[k] >= this.cap[k]) {
          k = 1 - k;
          if (!this.meshes[k] || fill[k] >= this.cap[k]) continue;
        }
        const mesh = this.meshes[k];
        const idx = slot * this.cap[k] + fill[k]++;
        const s = it.s ?? 1;
        _e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0, 'YXZ');
        _q.setFromEuler(_e);
        _p.set(it.x, it.y, it.z);
        _s.set((it.sx ?? 1) * s, (it.sy ?? 1) * s, (it.sz ?? 1) * s);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(idx, _m);
        if (it.tint !== undefined) _c.set(it.tint); else { const b = it.b ?? 1; _c.setRGB(b, b, b); }
        mesh.setColorAt(idx, _c);
      }
    }
    for (let k = 0; k < 2; k++) {
      const mesh = this.meshes[k];
      if (!mesh) continue;
      const cap = this.cap[k];
      for (let i = fill[k]; i < cap; i++) mesh.setMatrixAt(slot * cap + i, ZERO);
      mesh.instanceMatrix.addUpdateRange(slot * cap * 16, cap * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.addUpdateRange(slot * cap * 3, cap * 3);
      mesh.instanceColor.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------
//  每块的放置工具
// ---------------------------------------------------------------------
function makePlacer(ctx, rand, z0, z1) {
  return {
    rand, z0, z1,
    // 两侧随机散布：|x| ∈ [xMin, xMax]，bias>1 则更靠近道路
    band(n, xMin, xMax, { s = [1, 1], sink = 0, bias = 1, minGap = 0, y = null, tilt = 0, side = 0, sx, sy, sz } = {}) {
      const out = [];
      for (let k = 0; k < n; k++) {
        for (let t = 0; t < (minGap ? 6 : 1); t++) {
          const sg = side || (rand() < 0.5 ? -1 : 1);
          const x = sg * (xMin + (xMax - xMin) * Math.pow(rand(), bias));
          const z = z0 + rand() * (z1 - z0);
          if (minGap) {
            let bad = false;
            for (const o of out) if ((o.x - x) ** 2 + (o.z - z) ** 2 < minGap * minGap) { bad = true; break; }
            if (bad) continue;
          }
          const sc = s[0] + (s[1] - s[0]) * rand();
          const it = { x, z, y: (y ?? ctx.heightAt(x, z)) - sink * sc, s: sc, ry: rand() * TAU, b: 0.85 + rand() * 0.3 };
          if (tilt) { it.rx = (rand() - 0.5) * tilt; it.rz = (rand() - 0.5) * tilt; }
          if (sx) { it.sx = sx; it.sy = sy ?? 1; it.sz = sz ?? sx; }
          out.push(it);
          break;
        }
      }
      return out;
    },
    // 固定间隔（全局 z = k*step + offset），两侧对称
    lattice(step, offset, x, { s = [1, 1], jz = 0, jx = 0, yOff = 0, face = true, both = true, useBase = false } = {}) {
      const out = [];
      const k0 = Math.ceil((z0 - offset) / step), k1 = Math.floor((z1 - offset - 1e-6) / step);
      for (let k = k0; k <= k1; k++) {
        for (const sg of both ? [-1, 1] : [1]) {
          const h = hash3(k, sg + 3, 17, ctx.seed);
          const h2 = hash3(k, sg + 5, 29, ctx.seed);
          const z = k * step + offset + (h - 0.5) * jz;
          const xx = sg * (x + (h2 - 0.5) * jx);
          out.push({
            x: xx, z, y: (useBase ? ctx.base(z) : ctx.heightAt(xx, z)) + yOff,
            s: lerp(s[0], s[1], h2), ry: face ? (sg < 0 ? 0 : Math.PI) : h * TAU, b: 0.9 + h * 0.2,
          });
        }
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------
//  地标 / 道具几何
// ---------------------------------------------------------------------
const G = {
  torchJungle() {
    return merge([
      part(new THREE.CylinderGeometry(0.09, 0.12, 3.2, 5), 0xa89450, T(0, 1.6, 0)),
      part(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 5), 0x6a5a2a, T(0, 1.0, 0)),
      part(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 5), 0x6a5a2a, T(0, 2.1, 0)),
      part(new THREE.ConeGeometry(0.42, 0.5, 6), 0x5a4028, T(0, 3.3, 0, Math.PI, 0, 0)),
    ]);
  },
  flame(y = 3.55, sc = 1, r = 3.4, g = 1.3, b = 0.28) {
    return merge([
      glowPart(new THREE.ConeGeometry(0.24 * sc, 0.8 * sc, 5), r, g, b, T(0, y + 0.35 * sc, 0)),
      glowPart(new THREE.IcosahedronGeometry(0.26 * sc, 0), r * 1.1, g * 1.2, b * 1.4, T(0, y, 0)),
    ]);
  },
  brazier() {
    return merge([
      part(jitter(new THREE.BoxGeometry(0.8, 1.7, 0.8), 0.05, 3), 0xc8945a, T(0, 0.85, 0)),
      part(new THREE.BoxGeometry(1.1, 0.25, 1.1), 0xb98450, T(0, 1.82, 0)),
      part(new THREE.CylinderGeometry(0.55, 0.32, 0.4, 7), 0x5a3a24, T(0, 2.12, 0)),
    ]);
  },
  markerPole() {
    const P = [];
    for (let k = 0; k < 8; k++) P.push(part(new THREE.CylinderGeometry(0.09, 0.09, 0.4, 6), k % 2 ? 0xf4f4f4 : 0xd8323a, T(0, 0.2 + k * 0.4, 0)));
    P.push(part(new THREE.BoxGeometry(0.34, 0.08, 0.34), 0x2a2a30, T(0, 3.24, 0)));
    P.push(part(new THREE.BoxGeometry(0.34, 0.08, 0.34), 0x2a2a30, T(0, 3.66, 0)));
    for (const [dx, dz] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) P.push(part(new THREE.BoxGeometry(0.04, 0.42, 0.04), 0x2a2a30, T(dx, 3.45, dz)));
    return merge(P);
  },
  swampPost() {
    return merge([
      part(new THREE.CylinderGeometry(0.12, 0.16, 5.4, 5), 0x4a3a28, T(0, 0.9, 0)),
      part(new THREE.BoxGeometry(1.1, 0.1, 0.1), 0x3a2e20, T(0.5, 3.45, 0)),
      part(new THREE.BoxGeometry(0.34, 0.08, 0.34), 0x2a2218, T(0.95, 3.3, 0)),
      part(new THREE.BoxGeometry(0.34, 0.08, 0.34), 0x2a2218, T(0.95, 2.82, 0)),
      part(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 3), 0x2a2218, T(0.95, 3.4, 0)),
    ]);
  },
  swampLantern() {
    return merge([glowPart(new THREE.BoxGeometry(0.24, 0.4, 0.24), 2.4, 2.9, 1.1, T(0.95, 3.06, 0))]);
  },
  pilings() {
    return merge([
      part(new THREE.CylinderGeometry(0.14, 0.18, 3.2, 5), 0x4a3a2a, T(0, -0.8, 0)),
      part(new THREE.CylinderGeometry(0.19, 0.19, 0.12, 5), 0x3a2e22, T(0, 0.3, 0)),
    ]);
  },
  obsidianSpike() {
    const g = jitter(new THREE.ConeGeometry(0.55, 3.4, 5, 2), 0.12, 44);
    g.translate(0, 1.6, 0);
    return merge([part(g, 0x1c1618), part(jitter(new THREE.IcosahedronGeometry(0.8, 0), 0.3, 45), 0x2a2224, T(0, 0.1, 0, 0, 0, 0, 1, 0.5, 1))]);
  },
  spikeGlow() {
    return merge([
      glowPart(new THREE.OctahedronGeometry(0.22, 0), 3.4, 1.0, 0.18, T(0, 3.35, 0, 0, 0, 0, 1, 1.6, 1)),
      glowPart(new THREE.BoxGeometry(0.06, 1.8, 0.06), 2.6, 0.7, 0.12, T(0.12, 1.9, 0.2, 0, 0, 0.18)),
    ]);
  },
  bannerCloth() {
    const g = new THREE.PlaneGeometry(1.3, 3.2, 1, 6);
    g.translate(0.45, -1.6, 0);
    return g;
  },
  crystalLamp() { return merge([glowPart(new THREE.OctahedronGeometry(0.3, 0), 1.9, 0.6, 3.4, T(0, 6.75, 0, 0, 0, 0, 1, 1.5, 1))]); },
  sandDrift() {
    const g = jitter(new THREE.IcosahedronGeometry(1, 1), 0.14, 51);
    g.scale(2.6, 0.45, 1.6);
    const m = merge([part(g, 0xffffff)]);
    gradientY(m, 0xc0925c, 0xd8b07a, -0.3, 0.45);
    return m;
  },
  edgeStone(color) { return geoRock(color, { seed: 12, flat: 0.6, amt: 0.25 }); },
  log() {
    return merge([
      part(new THREE.CylinderGeometry(0.28, 0.3, 3.6, 6), 0x6a4a2e, T(0, 0.22, 0, Math.PI / 2, 0, 0)),
      part(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 6), 0xb89868, T(0, 0.22, 1.81, Math.PI / 2, 0, 0)),
      part(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 6), 0xb89868, T(0, 0.22, -1.81, Math.PI / 2, 0, 0)),
    ]);
  },
  // —— 横跨道路的地标拱门 ——
  archJungle() {
    const S = 0xa49c88, S2 = 0x958d7a, MOSS = 0x5a8a3a;
    const P = [];
    for (const sx of [-1, 1]) {
      P.push(part(jitter(new THREE.BoxGeometry(2.8, 15, 2.8, 1, 4, 1), 0.05, 11 + sx), S, T(sx * 12.8, 3.5, 0)));
      P.push(part(jitter(new THREE.BoxGeometry(3.5, 1.1, 3.5), 0.05, 13 + sx), S2, T(sx * 12.8, 11.4, 0)));
      P.push(part(new THREE.BoxGeometry(0.5, 0.5, 0.9), 0x3a3228, T(sx * 11.3, 6.2, 0)));
    }
    P.push(part(jitter(new THREE.BoxGeometry(31, 2.3, 3.1, 8, 1, 1), 0.035, 21), S2, T(0, 13.0, 0)));
    P.push(part(new THREE.BoxGeometry(3.2, 2.8, 3.4), S, T(0, 13.2, 0)));
    for (let k = 0; k < 8; k++) {
      P.push(part(jitter(new THREE.IcosahedronGeometry(1, 0), 0.25, 30 + k), k % 2 ? MOSS : 0x5a8a3a, T(-13.5 + k * 3.9, 14.2, ((k % 2) - 0.5) * 1.4, 0, k, 0, 1.7, 0.6, 1.4)));
    }
    for (let k = 0; k < 14; k++) {
      const x = -13.5 + k * 2.08 + ((k * 37) % 5) * 0.12;
      const len = 1.2 + ((k * 53) % 7) * 0.26;
      P.push(part(new THREE.CylinderGeometry(0.06, 0.09, len, 3), k % 3 ? 0x3f7a2c : 0x2f6a26, T(x, 11.85 - len / 2, k % 2 ? 1.1 : -1.1)));
      P.push(part(new THREE.IcosahedronGeometry(0.22, 0), 0x4f9a3a, T(x, 11.85 - len, k % 2 ? 1.1 : -1.1)));
    }
    return merge(P);
  },
  archJungleGlow() { return merge([G.flame(6.9, 1.2).translate(-11.3, 0, 0), G.flame(6.9, 1.2).translate(11.3, 0, 0)]); },
  archDesert() {
    const g = new THREE.TorusGeometry(13.2, 1.9, 5, 16, Math.PI);
    g.scale(1, 0.62, 1.1);
    g.translate(0, 5, 0);
    jitter(g, 0.07, 77);
    const P = [part(g, 0xc47848)];
    for (const sx of [-1, 1]) {
      const leg = jitter(new THREE.CylinderGeometry(2.0, 2.7, 10, 7, 2), 0.08, 78 + sx);
      P.push(part(leg, 0xb46a3e, T(sx * 13.2, 0, 0)));
    }
    const a = merge(P);
    gradientY(a, 0x9a5430, 0xe0a468, -5, 13);
    return a;
  },
  archFrost() {
    const P = [];
    const N = 13;
    for (let k = 0; k <= N; k++) {
      const a = Math.PI * k / N;
      const x = Math.cos(a) * 13, y = Math.sin(a) * 9.5 + 3.5;
      const g = jitter(new THREE.OctahedronGeometry(1, 0), 0.2, 60 + k);
      P.push(part(g, k % 3 ? 0xbfe6ff : 0xe4f6ff, T(x, y, (k % 2 - 0.5) * 0.6, 0, k * 0.7, a - Math.PI / 2, 1.5, 2.6, 1.5)));
    }
    for (const sx of [-1, 1]) {
      P.push(part(jitter(new THREE.OctahedronGeometry(1, 0), 0.2, 70 + sx), 0xa8dcff, T(sx * 13, 0.5, 0, 0, 0.4, 0, 2.2, 5, 2.2)));
      P.push(part(jitter(new THREE.OctahedronGeometry(1, 0), 0.2, 72 + sx), 0xd0f0ff, T(sx * 14.5, 0, 1.2, 0.2, 1, 0.3, 1.3, 3, 1.3)));
    }
    for (let k = 0; k < 9; k++) {
      const x = -8 + k * 2, len = 1 + ((k * 29) % 5) * 0.3;
      const top = Math.sqrt(Math.max(0, 1 - (x / 13) ** 2)) * 9.5 + 3.5 - 1.2;
      P.push(part(new THREE.ConeGeometry(0.22, len, 4), 0xeaf8ff, T(x, top - len / 2, 0, Math.PI, 0, 0)));
    }
    return merge(P);
  },
  archSwamp() {
    const WD = 0x4a3a28, WD2 = 0x3a2e20;
    const P = [];
    for (const sx of [-1, 1]) {
      P.push(part(new THREE.CylinderGeometry(0.6, 0.75, 15, 6), WD, T(sx * 11, 3, 0)));
      P.push(part(new THREE.ConeGeometry(0.25, 2.2, 4), 0x5a6a3a, T(sx * 11.5, 8.4, 0.5, Math.PI, 0, 0)));
    }
    P.push(part(new THREE.BoxGeometry(25, 0.9, 0.9), WD2, T(0, 10.2, 0)));
    P.push(part(jitter(new THREE.BoxGeometry(29, 0.8, 1.2, 6, 1, 1), 0.04, 5), WD, T(0, 11.5, 0)));
    P.push(part(new THREE.BoxGeometry(4.2, 1.6, 0.25), 0x6a5236, T(0, 11.0, 0.55)));
    P.push(part(new THREE.BoxGeometry(0.2, 1.4, 0.2), WD2, T(-1.6, 10.8, 0.5)));
    P.push(part(new THREE.BoxGeometry(0.2, 1.4, 0.2), WD2, T(1.6, 10.8, 0.5)));
    for (let k = 0; k < 10; k++) {
      const x = -12 + k * 2.6, len = 1.0 + ((k * 31) % 5) * 0.35;
      P.push(part(new THREE.ConeGeometry(0.2, len, 4), 0x5a6a3a, T(x, 9.75 - len / 2, 0.5, Math.PI, 0, 0)));
    }
    for (const sx of [-1, 1]) {
      P.push(part(new THREE.CylinderGeometry(0.015, 0.015, 1.1, 3), 0x2a2218, T(sx * 7, 9.2, 0)));
      P.push(part(new THREE.BoxGeometry(0.62, 0.1, 0.62), 0x2a2218, T(sx * 7, 8.62, 0)));
      P.push(part(new THREE.BoxGeometry(0.62, 0.1, 0.62), 0x2a2218, T(sx * 7, 7.72, 0)));
    }
    return merge(P);
  },
  archSwampGlow() {
    return merge([
      glowPart(new THREE.BoxGeometry(0.44, 0.8, 0.44), 2.6, 3.0, 1.1, T(-7, 8.17, 0)),
      glowPart(new THREE.BoxGeometry(0.44, 0.8, 0.44), 2.6, 3.0, 1.1, T(7, 8.17, 0)),
    ]);
  },
  archVolcano() {
    const g = new THREE.TorusGeometry(12.6, 1.6, 5, 16, Math.PI);
    g.scale(1, 0.6, 1.1);
    g.translate(0, 5.5, 0);
    jitter(g, 0.12, 88);
    const P = [part(g, 0x1e1618)];
    for (const sx of [-1, 1]) {
      P.push(part(jitter(new THREE.CylinderGeometry(1.6, 2.6, 11, 5, 3), 0.14, 89 + sx), 0x241c1e, T(sx * 12.6, 0, 0)));
      for (let k = 0; k < 3; k++) {
        P.push(part(new THREE.ConeGeometry(0.5, 2.8 + k * 0.6, 4), 0x16100f, T(sx * (12.6 + (k - 1) * 1.1), 11.2 + k * 0.3, (k - 1) * 0.6, 0, k, sx * 0.25)));
      }
    }
    return merge(P);
  },
  archVolcanoGlow() {
    const g = new THREE.TorusGeometry(12.6, 0.22, 3, 24, Math.PI);
    g.scale(1, 0.6, 1);
    g.translate(0, 5.5, 1.62);
    const g2 = g.clone().translate(0, 0, -3.24);
    return merge([
      glowPart(g, 3.2, 0.9, 0.15), glowPart(g2, 3.2, 0.9, 0.15),
      glowPart(new THREE.BoxGeometry(0.2, 8, 0.2), 3.0, 0.8, 0.12, T(-11.3, 1.5, 1.4, 0, 0, 0.08)),
      glowPart(new THREE.BoxGeometry(0.2, 8, 0.2), 3.0, 0.8, 0.12, T(11.3, 1.5, 1.4, 0, 0, -0.08)),
    ]);
  },
  archShadow() {
    const S = 0x4a4658, S2 = 0x3a3648;
    const P = [];
    for (const sx of [-1, 1]) {
      P.push(part(new THREE.BoxGeometry(2.8, 1.0, 2.8), S2, T(sx * 12.6, -0.5, 0)));
      P.push(part(new THREE.BoxGeometry(2.2, 15, 2.2, 1, 3, 1), S, T(sx * 12.6, 5.5, 0)));
      P.push(part(new THREE.BoxGeometry(2.8, 0.7, 2.8), S2, T(sx * 12.6, 13.2, 0)));
      P.push(part(new THREE.ConeGeometry(0.9, 3.2, 4), S2, T(sx * 12.6, 15.2, 0, 0, Math.PI / 4, 0)));
      P.push(part(new THREE.BoxGeometry(14.2, 1.5, 1.9), S, T(sx * 6.3, 16.2, 0, 0, 0, -sx * 0.45)));
    }
    P.push(part(new THREE.BoxGeometry(2.4, 2.4, 2.0), S2, T(0, 19.0, 0, 0, 0, Math.PI / 4)));
    return merge(P);
  },
  archShadowGlow() {
    return merge([
      glowPart(new THREE.OctahedronGeometry(1.1, 0), 1.9, 0.6, 3.6, T(0, 21.6, 0, 0, 0, 0, 1, 1.8, 1)),
      glowPart(new THREE.OctahedronGeometry(0.5, 0), 1.9, 0.6, 3.6, T(-12.6, 17.5, 0, 0, 0, 0, 1, 1.7, 1)),
      glowPart(new THREE.OctahedronGeometry(0.5, 0), 1.9, 0.6, 3.6, T(12.6, 17.5, 0, 0, 0, 0, 1, 1.7, 1)),
      glowPart(new THREE.BoxGeometry(0.16, 9, 0.12), 1.4, 0.45, 3.0, T(-11.45, 6, 0)),
      glowPart(new THREE.BoxGeometry(0.16, 9, 0.12), 1.4, 0.45, 3.0, T(11.45, 6, 0)),
    ]);
  },
};

// ---------------------------------------------------------------------
//  各生态的跑道配置
// ---------------------------------------------------------------------
const TB = {
  // ============================== 丛林 ==============================
  jungle: {
    amp: [1.9, 0.45, 1.8],
    side: (n) => (x, z, ax) => {
      let h = smooth(10, 15, ax) * (fbm(n, x * 0.06, z * 0.06, 3) * 0.7 + 0.35);
      const e = smooth(22, 70, ax);
      if (e > 0) h += e * (5 + fbm(n, x * 0.02 + 40, z * 0.02, 4) * 6 + ridged(n, x * 0.035 - 9, z * 0.035 + 5, 3) * 9);
      return h + smooth(70, 130, ax) * 14;
    },
    ground: (n) => {
      const A = col(0x4a8a2a), B = col(0x6fa338), Cc = col(0x3c7424), R = col(0x6d675a), M = col(0x56663e), D = col(0x6a5234);
      return (c, x, yr, z, ny, rnd, ax) => {
        if (ax <= FLAT + 0.01) c.copy(D);
        else if (ny < 0.74) c.copy(R).lerp(M, rnd * 0.6);
        else if (yr > 11) c.copy(M).lerp(Cc, rnd);
        else {
          const p = fbm(n, x * 0.05 + 3, z * 0.05 - 5, 2) * 0.5 + 0.5;
          c.copy(Cc).lerp(A, smooth(0.25, 0.5, p)).lerp(B, smooth(0.58, 0.85, p));
        }
        c.multiplyScalar(0.92 + rnd * 0.16);
      };
    },
    road(ctx, gb, gl, z0, z1) {
      const n = ctx.noise;
      const dA = col(0x7a5a38), dB = col(0x9c7a52), grassy = col(0x5d7a32);
      const fn = (x, z) => {
        const ax = Math.abs(x);
        const v = fbm(n, x * 0.12, z * 0.09, 2) * 0.5 + 0.5;
        _c2.copy(dA).lerp(dB, v);
        _c2.multiplyScalar(1 - 0.16 * Math.exp(-(((ax - 3.6) / 0.7) ** 2)) * (0.7 + 0.3 * fbm(n, x * 0.5, z * 0.3, 1)));
        _c2.lerp(grassy, smooth(7.2, 9, ax) * (0.45 + 0.35 * (fbm(n, x * 0.4 + 5, z * 0.4, 1) * 0.5 + 0.5)));
      };
      const XS_R = [-9, -8.2, -7.2, -6, -4.6, -3.6, -2.6, -1.3, 0, 1.3, 2.6, 3.6, 4.6, 6, 7.2, 8.2, 9];
      for (let z = z0; z < z1 - 1e-6; z += 1.5) {
        const zb = Math.min(z1, z + 1.5), ya = ctx.base(z) + 0.03, yb = ctx.base(zb) + 0.03;
        for (let i = 0; i < XS_R.length - 1; i++) gb.quadFn(XS_R[i], XS_R[i + 1], z, zb, ya, yb, fn);
      }
    },
    decos(ctx) {
      const m = ctx.decoMat;
      const flowers = [[0xff5fa0, 0xffd84a], [0xff8a2a, 0xfff07a], [0xa06aff, 0xfff0a0]];
      return [
        { d: new Deco(ctx, 'trees', geoBroadleaf(), m, 10, 18), place: (P) => P.band(22, 11.5, 75, { s: [1.0, 1.7], sink: 0.25, bias: 1.4, minGap: 4.5 }) },
        { d: new Deco(ctx, 'palms', geoPalm(), m, 6, 6), place: (P) => P.band(9, 11, 45, { s: [0.9, 1.4], sink: 0.2, bias: 1.2 }) },
        { d: new Deco(ctx, 'ferns', geoFern(), m, 0, 36, { split: 0 }), place: (P) => P.band(34, 10.2, 40, { s: [0.8, 1.6], bias: 1.6 }) },
        ...flowers.map((f, i) => ({ d: new Deco(ctx, 'flowers' + i, geoFlower(f[0], f[1]), m, 0, 8, { split: 0 }), place: (P) => P.band(7, 10.4, 30, { s: [0.9, 1.6], bias: 1.4 }) })),
        { d: new Deco(ctx, 'grass', geoGrass(), m, 0, 110, { split: 0 }), place: (P) => P.band(110, 10.1, 45, { s: [0.8, 1.5], bias: 1.5 }) },
        { d: new Deco(ctx, 'rocks', geoRock(0x6a6858, { seed: 5 }), m, 4, 6), place: (P) => P.band(9, 12, 80, { s: [1.2, 3.6], sink: 0.3 }) },
        { d: new Deco(ctx, 'edgeStones', G.edgeStone(0x8a8474), m, 0, 76, { split: 0 }), place: (P) => P.lattice(1.6, 0.3, 9.75, { s: [0.28, 0.5], jz: 0.6, jx: 0.35, face: false, yOff: -0.05 }) },
        { d: new Deco(ctx, 'logs', G.log(), m, 3, 0, { split: 99 }), place: (P) => P.band(2, 10.9, 12.5, { s: [0.8, 1.2] }).map((it) => ({ ...it, ry: (it.b - 1) * 0.8 })) },
        { d: new Deco(ctx, 'torches', G.torchJungle(), m, 6, 0, { split: 99 }), place: (P) => P.lattice(PROP_STEP, 12, 10.9) },
        { d: new Deco(ctx, 'flames', G.flame(), ctx.glowMat, 0, 6, { split: 0 }), place: (P) => P.lattice(PROP_STEP, 12, 10.9) },
      ];
    },
    landmark: () => G.archJungle(),
    landmarkGlow: () => G.archJungleGlow(),
    landmarkMat: (ctx) => { const m = decoMaterial({ emissive: 0x302c22 }); ctx.extraMats.push(m); return m; },
  },

  // ============================== 沙漠 ==============================
  desert: {
    amp: [1.8, 0.45, 1.8],
    side: (n) => (x, z, ax) => {
      let h = smooth(10, 18, ax) * (0.5 + (fbm(n, x * 0.035, z * 0.02, 3) * 0.5 + 0.5) * 3.4);
      const e = smooth(38, 100, ax);
      if (e > 0) h += e * (8 + ridged(n, x * 0.025, z * 0.025, 3) * 14 + fbm(n, x * 0.015, z * 0.015, 3) * 6);
      return h + smooth(90, 130, ax) * 10;
    },
    ground: (n) => {
      const A = col(0xe0bc84), B = col(0xd2a468), R = col(0xb87a48), Cc = col(0xeccb94), D = col(0xcfa56c);
      return (c, x, yr, z, ny, rnd, ax) => {
        if (ax <= FLAT + 0.01) c.copy(D);
        else if (ny < 0.72) c.copy(R).lerp(B, rnd * 0.4);
        else {
          const p = fbm(n, x * 0.06, z * 0.03, 2) * 0.5 + 0.5;
          c.copy(B).lerp(A, p).lerp(Cc, smooth(0.7, 0.9, p));
        }
        c.multiplyScalar(0.93 + rnd * 0.12);
      };
    },
    road(ctx, gb, gl, z0, z1) {
      const tiles = [col(0xd9a86a), col(0xcf9a5c), col(0xe3b67a), col(0xc48c52)];
      const sz = 2, gap = 0.07;
      let row = 0;
      for (let z = z0; z < z1 - 1e-6; z += sz, row++) {
        const zb = Math.min(z1, z + sz);
        const off = (row % 2) * 1.0;
        for (let x = -ROAD_HALF - off; x < ROAD_HALF - 1e-6; x += sz) {
          const xa = Math.max(-ROAD_HALF, x), xb = Math.min(ROAD_HALF, x + sz);
          if (xb - xa < 0.3) continue;
          const h = hash3(Math.round(x * 10), Math.round(z * 10), 7, ctx.seed);
          const ax = Math.abs((xa + xb) / 2);
          if (ax > 7.6 && h < 0.35) continue; // 边缘缺砖，露出沙子
          _c2.copy(tiles[Math.floor(h * 4) % 4]).multiplyScalar(0.92 + hash3(Math.round(x * 10), Math.round(z * 10), 8, ctx.seed) * 0.14);
          const za = z + gap, zz = zb - gap;
          gb.quad(xa + gap, xb - gap, za, zz, ctx.base(za) + 0.04, ctx.base(zz) + 0.04, _c2);
        }
      }
    },
    decos(ctx) {
      const m = ctx.decoMat;
      return [
        { d: new Deco(ctx, 'saguaro', geoSaguaro(), m, 6, 10), place: (P) => P.band(13, 11.5, 70, { s: [0.9, 1.6], sink: 0.2, bias: 1.3, minGap: 4 }) },
        { d: new Deco(ctx, 'pear', geoPricklyPear(), m, 0, 10, { split: 0 }), place: (P) => P.band(9, 10.5, 40, { s: [0.8, 1.4], bias: 1.4 }) },
        { d: new Deco(ctx, 'shrubs', geoShrub(0x9a8a4a), m, 0, 14, { split: 0 }), place: (P) => P.band(14, 10.5, 60, { s: [0.7, 1.4], bias: 1.3 }) },
        { d: new Deco(ctx, 'dryGrass', geoGrass(0xb8a060, 0xc8b070), m, 0, 40, { split: 0 }), place: (P) => P.band(40, 10.2, 40, { s: [0.8, 1.4], bias: 1.5 }) },
        { d: new Deco(ctx, 'rocks', geoRock(0xb07a4c, { seed: 6 }), m, 3, 6), place: (P) => P.band(8, 12, 80, { s: [1.2, 3.6], sink: 0.3 }) },
        { d: new Deco(ctx, 'mesas', geoMesa(301), m, 0, 2, { split: 0 }), place: (P) => (P.rand() < 0.7 ? P.band(1, 80, 125, { s: [0.7, 1.2], sink: 1.5 }) : []) },
        { d: new Deco(ctx, 'ribcage', geoRibcage(), m, 1, 0, { split: 99 }), place: (P) => (P.rand() < 0.35 ? P.band(1, 15, 28, { s: [1, 1.3], sink: 0.4 }) : []) },
        { d: new Deco(ctx, 'skulls', geoSkull(), m, 0, 3, { split: 0 }), place: (P) => P.band(2, 10.5, 25, { s: [0.9, 1.3] }) },
        { d: new Deco(ctx, 'drifts', G.sandDrift(), m, 0, 26, { split: 0 }), place: (P) => P.lattice(5, 1.5, 9.9, { s: [0.45, 0.9], jz: 3, jx: 0.6, face: false, yOff: -0.12 }) },
        { d: new Deco(ctx, 'braziers', G.brazier(), m, 6, 0, { split: 99 }), place: (P) => P.lattice(PROP_STEP, 12, 10.9) },
        { d: new Deco(ctx, 'fires', G.flame(2.45, 1.3), ctx.glowMat, 0, 6, { split: 0 }), place: (P) => P.lattice(PROP_STEP, 12, 10.9) },
      ];
    },
    landmark: () => G.archDesert(),
  },

  // ============================== 雪原 ==============================
  frost: {
    amp: [1.9, 0.45, 1.8],
    side: (n) => (x, z, ax) => {
      const bank = Math.exp(-(((ax - 12.3) / 1.5) ** 2)) * 1.3;
      let h = bank + smooth(10, 20, ax) * (fbm(n, x * 0.05, z * 0.05, 3) * 0.9 + 0.5);
      const e = smooth(22, 58, ax);
      if (e > 0) h += e * (12 + ridged(n, x * 0.03 + 7, z * 0.03, 3) * 16 + fbm(n, x * 0.02, z * 0.02, 3) * 6);
      return h + smooth(60, 130, ax) * 14;
    },
    ground: (n) => {
      const S = col(0xf2f6fb), S2 = col(0xdde8f2), R = col(0x7a8698), R2 = col(0x94a4b8), D = col(0xe4edf6);
      return (c, x, yr, z, ny, rnd, ax) => {
        if (ax <= FLAT + 0.01) c.copy(D);
        else if (ny < 0.7) c.copy(R).lerp(R2, rnd);
        else c.copy(S2).lerp(S, fbm(n, x * 0.08, z * 0.08, 2) * 0.5 + 0.5);
        c.multiplyScalar(0.95 + rnd * 0.08);
      };
    },
    road(ctx, gb, gl, z0, z1) {
      const n = ctx.noise;
      const edge = col(0x8a9cb2), packed = col(0xbfcfe0), ice = col(0x8fb8dc);
      const fn = (x, z) => {
        const ax = Math.abs(x);
        const v = fbm(n, x * 0.12, z * 0.07, 2) * 0.5 + 0.5;
        _c2.copy(packed).lerp(ice, smooth(0.45, 0.78, v) * 0.85);
        _c2.lerp(ice, 0.35 * Math.exp(-(((ax - 3.6) / 0.6) ** 2)));
        _c2.lerp(edge, smooth(7.8, 9, ax) * 0.75);
      };
      const XS_R = [-9, -8.2, -7.2, -6, -4.6, -3.6, -2.6, -1.3, 0, 1.3, 2.6, 3.6, 4.6, 6, 7.2, 8.2, 9];
      for (let z = z0; z < z1 - 1e-6; z += 1.5) {
        const zb = Math.min(z1, z + 1.5), ya = ctx.base(z) + 0.03, yb = ctx.base(zb) + 0.03;
        for (let i = 0; i < XS_R.length - 1; i++) gb.quadFn(XS_R[i], XS_R[i + 1], z, zb, ya, yb, fn);
      }
    },
    decos(ctx) {
      const m = ctx.decoMat;
      const iceMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.12, metalness: 0.1, emissive: 0x3a8ad8, emissiveIntensity: 0.5 });
      const spireMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.3, metalness: 0.05, emissive: 0x16304a, emissiveIntensity: 0.4 });
      ctx.extraMats.push(iceMat, spireMat);
      return [
        { d: new Deco(ctx, 'pines', geoPine(), m, 10, 16), place: (P) => P.band(24, 11.8, 70, { s: [1.0, 1.9], sink: 0.2, bias: 1.3, minGap: 4 }) },
        { d: new Deco(ctx, 'ice', geoIceCluster(), iceMat, 4, 6), place: (P) => P.band(8, 11, 40, { s: [0.8, 1.9], sink: 0.2, bias: 1.3 }) },
        { d: new Deco(ctx, 'spires', geoIceSpire(9), spireMat, 0, 3, { split: 0 }), place: (P) => P.band(2, 48, 110, { s: [1, 1], sx: 3.5, sy: 18, sz: 3.5, sink: 1 }).map((it) => ({ ...it, sy: 12 + it.b * 14 })) },
        { d: new Deco(ctx, 'drifts', geoDrift(), m, 0, 10, { split: 0 }), place: (P) => P.band(9, 10.8, 32, { s: [0.5, 1.1], sink: 0.2 }) },
        { d: new Deco(ctx, 'rocks', geoCapRock(0x7a8494, 0xf2f6fb, 5), m, 3, 6), place: (P) => P.band(8, 12, 70, { s: [1.0, 3.2], sink: 0.3 }) },
        { d: new Deco(ctx, 'poles', G.markerPole(), m, 8, 0, { split: 99 }), place: (P) => P.lattice(18, 9, 10.3) },
        { d: new Deco(ctx, 'lamps', merge([glowPart(new THREE.OctahedronGeometry(0.16, 0), 3.0, 2.2, 1.0, T(0, 3.45, 0, 0, 0, 0, 1, 1.4, 1))]), ctx.glowMat, 0, 8, { split: 0 }), place: (P) => P.lattice(18, 9, 10.3) },
      ];
    },
    landmark: () => G.archFrost(),
    landmarkMat: (ctx) => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.15, metalness: 0.1, emissive: 0x2a6ab0, emissiveIntensity: 0.45 }); ctx.extraMats.push(m); return m; },
  },

  // ============================== 沼泽 ==============================
  swamp: {
    amp: [1.2, 0.3, 1.2],
    hill: [2.4, 2.2, 2.6, 0.35],
    deck: true,
    roadDip: -1.9,
    waterY: -0.8,
    side: (n) => (x, z, ax) => {
      let h = -1.9 + smooth(10, 32, ax) * (fbm(n, x * 0.045, z * 0.045, 3) * 0.5 + 0.5) * 2.4;
      h += smooth(12, 40, ax) * Math.max(0, fbm(n, x * 0.07 + 9, z * 0.07, 2)) * 1.6;
      const e = smooth(45, 110, ax);
      if (e > 0) h += e * (9 + fbm(n, x * 0.02, z * 0.02, 4) * 6 + ridged(n, x * 0.03, z * 0.03, 3) * 6);
      return h;
    },
    ground: (n) => {
      const MUD = col(0x3e3424), MOSS = col(0x4e6230), GR = col(0x5a6e36), R = col(0x4a4a3a);
      return (c, x, yr, z, ny, rnd, ax) => {
        if (yr < -0.9) c.copy(MUD).lerp(MOSS, rnd * 0.2);
        else if (ny < 0.72) c.copy(R).lerp(MOSS, rnd * 0.5);
        else c.copy(MOSS).lerp(GR, fbm(n, x * 0.07, z * 0.07, 2) * 0.5 + 0.5);
        c.multiplyScalar(0.9 + rnd * 0.16);
      };
    },
    road(ctx, gb, gl, z0, z1) {
      const wood = [col(0x7a5a3a), col(0x6a4c30), col(0x86643e), col(0x5c4430)];
      const beam = col(0x3a2c1e);
      const pitch = 1.1, len = 0.96, th = 0.14, X = ROAD_HALF + 0.35;
      const k0 = Math.ceil(z0 / pitch), k1 = Math.floor((z1 - 1e-6) / pitch);
      for (let k = k0; k <= k1; k++) {
        const za = k * pitch, zb = Math.min(za + len, z1 + 0.5);
        const h = hash3(k, 0, 9, ctx.seed);
        _c2.copy(wood[Math.floor(h * 4) % 4]).multiplyScalar(0.9 + hash3(k, 1, 9, ctx.seed) * 0.18);
        const ya = ctx.base(za), yb = ctx.base(zb);
        const sh = (hash3(k, 2, 9, ctx.seed) - 0.5) * 0.5; // 板材参差
        gb.quad(-X + sh, X + sh, za, zb, ya, yb, _c2);
        _c.copy(_c2).multiplyScalar(0.6);
        gb.faceZ(-X + sh, X + sh, za, ya, ya - th, _c, true);
        gb.faceZ(-X + sh, X + sh, zb, yb, yb - th, _c, false);
      }
      // 纵向托梁
      for (const bx of [-8.6, -3.2, 3.2, 8.6]) {
        const step = 5;
        for (let z = z0; z < z1 - 1e-6; z += step) {
          const zb = Math.min(z1, z + step);
          const ya = ctx.base(z) - th, yb = ctx.base(zb) - th;
          gb.faceX(bx - 0.18, z, zb, ya, yb, ya - 0.35, yb - 0.35, beam, -1);
          gb.faceX(bx + 0.18, z, zb, ya, yb, ya - 0.35, yb - 0.35, beam, 1);
        }
      }
    },
    decos(ctx) {
      const m = ctx.decoMat;
      const glowCap = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.5, emissive: 0x18c89a, emissiveIntensity: 0.55 });
      ctx.extraMats.push(glowCap);
      ctx.pulse.push({ mat: glowCap, base: 0.55, amp: 0.18, speed: 1.3 });
      return [
        { d: new Deco(ctx, 'deadTrees', geoDeadTree(21, 0x3a3228, 0x5a6a3a), m, 6, 10), place: (P) => P.band(16, 11, 70, { s: [1.0, 1.7], sink: 0.1, bias: 1.3, minGap: 4 }) },
        { d: new Deco(ctx, 'deadTrees2', geoDeadTree(22, 0x40362a, 0x6a7a4a), m, 3, 6), place: (P) => P.band(8, 11, 70, { s: [1.0, 1.6], sink: 0.1, bias: 1.2 }) },
        { d: new Deco(ctx, 'mushStem', geoMushStem(), m, 4, 8), place: (P) => { const it = P.band(11, 10.8, 45, { s: [0.7, 1.7], bias: 1.4 }); P.mush = it; return it; } },
        { d: new Deco(ctx, 'mushRed', geoMushCap(0xc8402a, 0xf4ead0), m, 3, 5), place: (P) => P.mush.filter((_, i) => i % 2 === 0) },
        { d: new Deco(ctx, 'mushGlow', geoMushCap(0x2ad8b0, 0xd0fff0), glowCap, 2, 5), place: (P) => P.mush.filter((_, i) => i % 2 === 1) },
        { d: new Deco(ctx, 'reeds', geoReeds(), m, 0, 30, { split: 0 }), place: (P) => P.band(30, 10.3, 36, { s: [0.9, 1.5], bias: 1.4 }).map((it) => ({ ...it, y: Math.max(it.y, ctx.base(it.z) + ctx.cfg.waterY - 0.45) })) },
        { d: new Deco(ctx, 'lily', geoLily(false), m, 0, 14, { split: 0 }), place: (P) => P.band(12, 10.8, 40, { s: [0.7, 1.3], bias: 1.3 }).filter((it) => it.y < ctx.base(it.z) + ctx.cfg.waterY - 0.05).map((it) => ({ ...it, y: ctx.base(it.z) + ctx.cfg.waterY + 0.03 })) },
        { d: new Deco(ctx, 'lilyF', geoLily(true), m, 0, 5, { split: 0 }), place: (P) => P.band(5, 10.8, 30, { s: [0.8, 1.3] }).filter((it) => it.y < ctx.base(it.z) + ctx.cfg.waterY - 0.05).map((it) => ({ ...it, y: ctx.base(it.z) + ctx.cfg.waterY + 0.03 })) },
        { d: new Deco(ctx, 'grass', geoGrass(0x4a5a2a, 0x5e6e34), m, 0, 30, { split: 0 }), place: (P) => P.band(40, 12, 45, { s: [0.8, 1.4] }).filter((it) => it.y > ctx.base(it.z) + ctx.cfg.waterY) },
        { d: new Deco(ctx, 'pilings', G.pilings(), m, 0, 32, { split: 0 }), place: (P) => P.lattice(4.4, 0.5, 9.75, { useBase: true, face: false }) },
        { d: new Deco(ctx, 'posts', G.swampPost(), m, 6, 0, { split: 99 }), place: (P) => P.lattice(PROP_STEP, 12, 10.6, { useBase: true, yOff: -0.3 }) },
        { d: new Deco(ctx, 'lanterns', G.swampLantern(), ctx.glowMat, 0, 6, { split: 0 }), place: (P) => P.lattice(PROP_STEP, 12, 10.6, { useBase: true, yOff: -0.3 }) },
      ];
    },
    landmark: () => G.archSwamp(),
    landmarkGlow: () => G.archSwampGlow(),
    water: true,
  },

  // ============================== 火山 ==============================
  volcano: {
    amp: [1.9, 0.45, 1.8],
    lavaY: -0.75,
    side: (n) => (x, z, ax) => {
      const ch = smooth(10.2, 11.6, ax) * (1 - smooth(16.8, 19, ax));
      let h = -1.6 * ch;
      h += smooth(18, 26, ax) * (0.4 + (fbm(n, x * 0.06, z * 0.06, 3) * 0.5 + 0.5) * 1.6);
      const e = smooth(26, 72, ax);
      if (e > 0) h += e * (10 + ridged(n, x * 0.03, z * 0.03, 4) * 16 + fbm(n, x * 0.02, z * 0.02, 3) * 5);
      return h + smooth(72, 130, ax) * 16;
    },
    ground: (n) => {
      const A = col(0x2c2424), B = col(0x3a302c), R = col(0x1e1818), ASH = col(0x4a4240), D = col(0x1a1414);
      return (c, x, yr, z, ny, rnd, ax) => {
        if (ax <= FLAT + 0.01) c.copy(D);
        else if (yr < -0.6 && ax < 20) c.copy(R);
        else if (ny < 0.7) c.copy(R).lerp(A, rnd);
        else c.copy(A).lerp(B, fbm(n, x * 0.06, z * 0.06, 2) * 0.5 + 0.5).lerp(ASH, smooth(0.8, 1, rnd) * 0.5);
        c.multiplyScalar(0.9 + rnd * 0.16);
      };
    },
    road(ctx, gb, gl, z0, z1) {
      const tiles = [col(0x2a2424), col(0x352e2c), col(0x221e1e), col(0x3a3230)];
      const sz = 2.25, gap = 0.08;
      const yF = (x, z) => ctx.base(z) + 0.09;
      for (let z = z0; z < z1 - 1e-6; z += sz) {
        const zb = Math.min(z1, z + sz);
        for (let x = -ROAD_HALF; x < ROAD_HALF - 1e-6; x += sz) {
          const xb = Math.min(ROAD_HALF, x + sz);
          const h = hash3(Math.round(x * 10), Math.round(z * 10), 5, ctx.seed);
          _c2.copy(tiles[Math.floor(h * 4) % 4]).multiplyScalar(0.9 + hash3(Math.round(x * 10), Math.round(z * 10), 6, ctx.seed) * 0.2);
          const za = z + gap, zz = zb - gap;
          gb.quad(x + gap, xb - gap, za, zz, ctx.base(za) + 0.04, ctx.base(zz) + 0.04, _c2);
          // 砖缝里的岩浆
          if (h > 0.95) gl.ribbon(x, z, xb, z, 0.05, yF, 1.8, 0.42, 0.06);
          if (h < 0.04 && Math.abs(x) > 3) gl.ribbon(x, z, x, zb, 0.05, yF, 1.8, 0.42, 0.06);
        }
      }
      // 路缘熔岩裂缝
      for (const sg of [-1, 1]) {
        let px = sg * 9.2, pz = z0;
        while (pz < z1 - 1e-6) {
          const nz = Math.min(z1, pz + 1.5);
          const nx = sg * (9.2 + (hash3(Math.round(nz * 10), sg, 4, ctx.seed) - 0.5) * 0.5);
          gl.ribbon(px, pz, nx, nz, 0.11, (x, z) => ctx.base(z) + 0.1, 3.2, 0.85, 0.12);
          px = nx; pz = nz;
        }
      }
    },
    decos(ctx) {
      const m = ctx.decoMat;
      const obsMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.18, metalness: 0.35 });
      ctx.extraMats.push(obsMat);
      return [
        { d: new Deco(ctx, 'charred', geoDeadTree(31, 0x201a18, 0x201a18, { mossy: false, branches: 5 }), m, 4, 8), place: (P) => P.band(12, 19.5, 70, { s: [1.0, 1.6], sink: 0.1, bias: 1.2, minGap: 5 }) },
        { d: new Deco(ctx, 'obsidian', geoShardCluster(301, 0x221c2a), obsMat, 4, 8), place: (P) => P.band(11, 19.5, 80, { s: [1.0, 2.8], sink: 0.2, bias: 1.2 }) },
        { d: new Deco(ctx, 'basalt', geoRock(0x2e2826, { seed: 7 }), m, 3, 8), place: (P) => P.band(10, 19.5, 90, { s: [1.5, 4.5], sink: 0.4 }) },
        { d: new Deco(ctx, 'spires', geoSpire(33), m, 0, 3, { split: 0 }), place: (P) => P.band(2, 60, 120, { s: [1, 1], sx: 5, sy: 20, sz: 5, sink: 1 }).map((it) => ({ ...it, sy: 14 + it.b * 20 })) },
        { d: new Deco(ctx, 'spikes', G.obsidianSpike(), m, 6, 0, { split: 99 }), place: (P) => P.lattice(PROP_STEP, 12, 10.4) },
        { d: new Deco(ctx, 'spikeGlow', G.spikeGlow(), ctx.glowMat, 0, 6, { split: 0 }), place: (P) => P.lattice(PROP_STEP, 12, 10.4) },
      ];
    },
    landmark: () => G.archVolcano(),
    landmarkGlow: () => G.archVolcanoGlow(),
    lava: true,
    far: (ctx) => buildDistantVolcano(ctx),
    farRot: -2.8,
    farScale: 1.0,
    farOffset: 110,
  },

  // ============================== 暗影 ==============================
  shadow: {
    amp: [1.8, 0.45, 1.8],
    side: (n) => (x, z, ax) => {
      let h = smooth(10, 16, ax) * (0.2 + (fbm(n, x * 0.05, z * 0.05, 3) * 0.5 + 0.5) * 0.8);
      const e = smooth(28, 72, ax);
      if (e > 0) h += e * (9 + ridged(n, x * 0.03, z * 0.03, 3) * 12 + fbm(n, x * 0.02, z * 0.02, 3) * 5);
      return h + smooth(72, 130, ax) * 16;
    },
    ground: (n) => {
      const A = col(0x2e2a3c), B = col(0x3c364c), R = col(0x221e2c), MOSS = col(0x3a3050), D = col(0x1e1a28);
      return (c, x, yr, z, ny, rnd, ax) => {
        if (ax <= FLAT + 0.01) c.copy(D);
        else if (ny < 0.72) c.copy(R).lerp(A, rnd * 0.5);
        else c.copy(A).lerp(B, fbm(n, x * 0.06, z * 0.06, 2) * 0.5 + 0.5).lerp(MOSS, rnd * 0.25);
        c.multiplyScalar(0.9 + rnd * 0.16);
      };
    },
    road(ctx, gb, gl, z0, z1) {
      const tiles = [col(0x3a3548), col(0x443e54), col(0x322d40), col(0x4a4458)];
      const sz = 3, gap = 0.1;
      for (let z = z0; z < z1 - 1e-6; z += sz) {
        const zb = Math.min(z1, z + sz);
        for (let x = -ROAD_HALF; x < ROAD_HALF - 1e-6; x += sz) {
          const xb = Math.min(ROAD_HALF, x + sz);
          const h = hash3(Math.round(x * 10), Math.round(z * 10), 5, ctx.seed);
          _c2.copy(tiles[Math.floor(h * 4) % 4]).multiplyScalar(0.9 + hash3(Math.round(x * 10), Math.round(z * 10), 6, ctx.seed) * 0.2);
          const za = z + gap, zz = zb - gap;
          gb.quad(x + gap, xb - gap, za, zz, ctx.base(za) + 0.04, ctx.base(zz) + 0.04, _c2);
        }
      }
      const yF = (x, z) => ctx.base(z) + 0.08;
      // 两侧连续符文线
      for (const sg of [-1, 1]) {
        for (let z = z0; z < z1 - 1e-6; z += 4) gl.ribbon(sg * 8.4, z, sg * 8.4, Math.min(z1, z + 4), 0.07, yF, 1.5, 0.48, 3.0);
      }
      // 每 12m 一个符文图案
      const k0 = Math.ceil((z0 - 6) / 12), k1 = Math.floor((z1 - 6 - 1e-6) / 12);
      for (let k = k0; k <= k1; k++) {
        const cz = k * 12 + 6, r = 1.4;
        const pts = [[0, cz - r], [r, cz], [0, cz + r], [-r, cz], [0, cz - r]];
        for (let i = 0; i < 4; i++) gl.ribbon(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 0.06, yF, 1.5, 0.48, 3.0);
        gl.ribbon(-2.6, cz, -1.8, cz, 0.06, yF, 1.5, 0.48, 3.0);
        gl.ribbon(1.8, cz, 2.6, cz, 0.06, yF, 1.5, 0.48, 3.0);
        if (hash3(k, 1, 1, ctx.seed) < 0.5) for (const sx of [-5.5, 5.5]) gl.ribbon(sx, cz - 0.7, sx, cz + 0.7, 0.06, yF, 1.5, 0.48, 3.0);
      }
    },
    decos(ctx) {
      const m = ctx.decoMat;
      const crystMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.2, metalness: 0.2, emissive: 0x9a3aff, emissiveIntensity: 1.4 });
      ctx.extraMats.push(crystMat);
      ctx.pulse.push({ mat: crystMat, base: 1.4, amp: 0.4, speed: 1.1 });
      const banner = bannerMaterial(ctx, 0x5a1a8a);
      ctx.extraMats.push(banner);
      return [
        { d: new Deco(ctx, 'pillars', geoPillar(false, 3), m, 3, 3), place: (P) => P.band(4, 11.8, 40, { s: [0.9, 1.2], sink: 0.2, bias: 1.2, minGap: 6 }) },
        { d: new Deco(ctx, 'pillarsBroken', geoPillar(true, 4), m, 3, 4), place: (P) => P.band(5, 11.5, 45, { s: [0.9, 1.3], sink: 0.2, bias: 1.2 }) },
        { d: new Deco(ctx, 'crystals', geoShardCluster(411, 0x6a3a9a), crystMat, 3, 6), place: (P) => P.band(9, 11, 60, { s: [0.8, 2.2], sink: 0.15, bias: 1.3 }) },
        { d: new Deco(ctx, 'walls', geoWall(55), m, 2, 3), place: (P) => P.band(3, 20, 60, { s: [0.9, 1.2], sink: 0.3 }).map((it) => ({ ...it, ry: Math.PI / 2 + (it.b - 1) * 0.6 })) },
        { d: new Deco(ctx, 'spires', geoSpire(71), m, 0, 4, { split: 0 }), place: (P) => P.band(3, 55, 125, { s: [1, 1], sx: 4, sy: 20, sz: 4, sink: 1 }).map((it) => ({ ...it, sy: 16 + it.b * 22 })) },
        { d: new Deco(ctx, 'darkTrees', geoDeadTree(41, 0x2a2232, 0x2a2232, { mossy: false, branches: 5 }), m, 3, 6), place: (P) => P.band(8, 12, 60, { s: [1.0, 1.6], sink: 0.1, bias: 1.2 }) },
        { d: new Deco(ctx, 'grass', geoGrass(0x3a3050, 0x4a4060), m, 0, 40, { split: 0 }), place: (P) => P.band(40, 10.2, 40, { s: [0.8, 1.4], bias: 1.5 }) },
        { d: new Deco(ctx, 'bannerPoles', geoBannerPole(), m, 6, 0, { split: 99 }), place: (P) => P.lattice(PROP_STEP, 12, 11) },
        { d: new Deco(ctx, 'banners', G.bannerCloth(), banner, 0, 6, { split: 0, receive: false }), place: (P) => P.lattice(PROP_STEP, 12, 11, { yOff: 5.95 }) },
        { d: new Deco(ctx, 'crystalLamps', G.crystalLamp(), ctx.glowMat, 0, 6, { split: 0 }), place: (P) => P.lattice(PROP_STEP, 12, 11) },
      ];
    },
    landmark: () => G.archShadow(),
    landmarkGlow: () => G.archShadowGlow(),
    far: (ctx) => buildCitadel(ctx),
  },
};

// ============================== 虫巢（克隆丛林：暗红甲壳地面 + 染色植被） ==============================
{
  const J = TB.jungle;
  const HIVE = col(0x4a1420), CARA = col(0x2a1418), VEIN = col(0x7a2a1a);
  const tintOf = (b) => new THREE.Color().setRGB(0.55 + b * 0.25, 0.25 + b * 0.12, 0.28 + b * 0.12);
  TB.hive = {
    ...J,
    amp: [2.1, 0.55, 2.0],
    hill: [3.8, 3.6, 4.4, 1.0],
    ground: (n) => {
      const g0 = J.ground(n);
      return (c, x, yr, z, ny, rnd, ax) => {
        g0(c, x, yr, z, ny, rnd, ax);
        c.lerp(HIVE, ax <= FLAT + 0.01 ? 0.7 : 0.55);
      };
    },
    road(ctx, gb, gl, z0, z1) {
      // 深色甲壳路面：丛林泥路的纹理 + 暗红叠色 + 发光血管纹
      const n = ctx.noise;
      const fn = (x, z) => {
        const v = fbm(n, x * 0.14, z * 0.1, 2) * 0.5 + 0.5;
        _c2.copy(CARA).lerp(HIVE, v);
        const vein = Math.exp(-(((fbm(n, x * 0.25 + 7, z * 0.08, 2)) / 0.06) ** 2));
        _c2.lerp(VEIN, vein * 0.6);
        _c2.multiplyScalar(1 - 0.18 * Math.exp(-(((Math.abs(x) - 3.6) / 0.7) ** 2)));
      };
      const XS_R = [-9, -8.2, -7.2, -6, -4.6, -3.6, -2.6, -1.3, 0, 1.3, 2.6, 3.6, 4.6, 6, 7.2, 8.2, 9];
      for (let z = z0; z < z1 - 1e-6; z += 1.5) {
        const zb = Math.min(z1, z + 1.5), ya = ctx.base(z) + 0.03, yb = ctx.base(zb) + 0.03;
        for (let i = 0; i < XS_R.length - 1; i++) gb.quadFn(XS_R[i], XS_R[i + 1], z, zb, ya, yb, fn);
      }
    },
    decos(ctx) {
      return J.decos(ctx).map((e) => {
        const glow = e.d.name === 'flames';
        return { d: e.d, place: (P) => e.place(P).map((it) => ({ ...it, tint: glow ? new THREE.Color(1.0, 0.35, 0.6) : tintOf(it.b ?? 1) })) };
      });
    },
    landmarkMat: (ctx) => { const m = decoMaterial({ emissive: 0x3a0a14 }); m.color.setRGB(0.6, 0.3, 0.32); ctx.extraMats.push(m); return m; },
  };
}

// ---------------------------------------------------------------------
//  入口
// ---------------------------------------------------------------------
export function createTrack(biome = 'jungle', scene, opts = {}) {
  if (!BIOMES[biome] || !TB[biome]) biome = 'jungle';
  const cfg = BIOMES[biome];
  const tb = TB[biome];
  const hi = opts.quality !== 'low';
  const seed = hashStr('dino-track:' + biome);
  const root = new THREE.Group();
  root.name = 'Track:' + biome;
  const prevFog = scene.fog, prevBg = scene.background;
  const prand = mulberry32(seed);
  const noise = makeNoise(mulberry32(seed ^ 0x9e3779b9));

  // —— 道路纵断面：只在 z 方向起伏，上坡 / 下坡最陡约 12%（弯道由 bend.js 在渲染时弯曲） ——
  //    起点与首领战场（opts.flat / addFlat）处压平，保证开场和首领战在平地上进行
  const HILL = tb.hill || [3.4, 3.2, 4.2, 0.8];
  const AMP = [tb.amp[0] * HILL[0], tb.amp[1] * HILL[1], tb.amp[2] * HILL[2], HILL[3]];
  const PH = [prand() * TAU, prand() * TAU, prand() * TAU, prand() * TAU];
  const K = [TAU / 820, TAU / 310, TAU / 1700, TAU / 190];
  const rawBase = (z) => AMP[0] * Math.sin(z * K[0] + PH[0]) + AMP[1] * Math.sin(z * K[1] + PH[1])
    + AMP[2] * Math.sin(z * K[2] + PH[2]) + AMP[3] * Math.sin(z * K[3] + PH[3]);
  const B0 = rawBase(0);
  const FLAT_RAMP = 150;
  const flats = [];                   // { a, b, h }：[a, b] 内高度固定为 h，两侧 FLAT_RAMP 米平滑过渡
  const addFlat = (a, b) => { flats.push({ a, b, h: rawBase((a + b) / 2) - B0 }); };
  for (const [a0, b0] of opts.flat || []) addFlat(a0, b0);
  const base = (z) => {
    let h = (rawBase(z) - B0) * smooth(40, 300, z);
    for (const f of flats) {
      const d = z < f.a ? f.a - z : z > f.b ? z - f.b : 0;
      if (d < FLAT_RAMP) h = lerp(f.h, h, smooth(0, FLAT_RAMP, d));
    }
    return h;
  };
  const sideFn = tb.side(noise);
  const roadDip = tb.roadDip || 0;
  const tH = (x, z) => {
    const ax = Math.abs(x);
    return base(z) + (ax <= FLAT ? roadDip : sideFn(x, z, ax));
  };
  // 与地形网格三角剖分完全一致的高度查询
  const heightAt = (x, z) => {
    if (x >= -FLAT && x <= FLAT) return base(z);
    if (!(x > -XMAX)) x = -XMAX + 1e-6; else if (x >= XMAX) x = XMAX - 1e-6;
    const i = colIndex(x);
    const j = Math.floor(z / DZ);
    const xa = XS[i], xb = XS[i + 1], za = j * DZ, zb = za + DZ;
    const fx = (x - xa) / (xb - xa), fz = (z - za) / DZ;
    const h00 = tH(xa, za), h10 = tH(xb, za), h01 = tH(xa, zb), h11 = tH(xb, zb);
    if (fz >= fx) return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
    return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
  };

  const ctx = {
    biome, hi, seed, root, cfg: tb,
    rand: prand, noise, base, heightAt,
    updaters: [], pulse: [], extraMats: [],
    timeU: { value: 0 },
    sprite: makeSprite(64),
    decoMat: decoMaterial(),
    glowMat: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0 });
  const roadMat = biome === 'frost'
    ? new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.35, metalness: 0.05 })
    : decoMaterial({ roughness: 0.92 });
  const roadGlowMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const groundColor = tb.ground(noise);

  // —— 天空 / 雾 / 灯光（与竞技场一致） ——
  const s = cfg.sky;
  const horizon = new THREE.Color(s.horizon);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 20), skyMaterial(ctx, s));
  sky.name = 'sky';
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  root.add(sky);
  scene.fog = cfg.fog.density ? new THREE.FogExp2(horizon.getHex(), cfg.fog.density) : new THREE.Fog(horizon.getHex(), cfg.fog.near, Math.min(cfg.fog.far, 250));
  scene.background = horizon.clone();
  const L = cfg.light;
  root.add(new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemi));
  if (L.ambI) root.add(new THREE.AmbientLight(L.amb, L.ambI));
  const sunDir = new THREE.Vector3(...s.sunDir).normalize();
  const sun = new THREE.DirectionalLight(L.sun, L.sunI);
  sun.name = 'sun';
  sun.castShadow = true;
  const ms = hi ? 2048 : 1024;
  sun.shadow.mapSize.set(ms, ms);
  const sc = sun.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40;
  sc.near = 1; sc.far = 260;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  root.add(sun);
  root.add(sun.target);
  const lRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize();
  const lUp = new THREE.Vector3().crossVectors(sunDir, lRight).normalize();
  const texel = 80 / ms;
  const _f = new THREE.Vector3();
  const followSun = (f) => {
    const u = Math.round(f.dot(lRight) / texel) * texel;
    const v = Math.round(f.dot(lUp) / texel) * texel;
    const w = f.dot(sunDir);
    _f.copy(lRight).multiplyScalar(u).addScaledVector(lUp, v).addScaledVector(sunDir, w);
    sun.target.position.copy(_f);
    sun.position.copy(_f).addScaledVector(sunDir, 120);
    sun.target.updateMatrixWorld();
  };

  // —— 远景（跟随玩家，永远在前方地平线） ——
  let farGroup = null;
  if (tb.far) {
    farGroup = new THREE.Group();
    farGroup.name = 'far';
    farGroup.rotation.y = tb.farRot ?? Math.PI;
    farGroup.scale.setScalar(tb.farScale ?? 1);
    root.add(farGroup);
    tb.far({ ...ctx, root: farGroup });
  }

  // —— 装饰（环形槽位） ——
  const decos = tb.decos(ctx);
  const lmMat = tb.landmarkMat ? tb.landmarkMat(ctx) : ctx.decoMat;
  decos.push({ d: new Deco(ctx, 'landmark', tb.landmark(), lmMat, 1, 0, { split: 999 }), place: (P) => P.landmarks });
  if (tb.landmarkGlow) decos.push({ d: new Deco(ctx, 'landmarkGlow', tb.landmarkGlow(), ctx.glowMat, 0, 1, { split: 0 }), place: (P) => P.landmarks });

  // —— 每个槽位的块网格 ——
  const surfaceMat = tb.water ? waterMaterial(ctx, 0x3e5230, 0.86, 0.04) : tb.lava ? lavaMaterial(ctx) : null;
  const slotMeshes = [];
  for (let i = 0; i < SLOTS; i++) {
    const terrain = new THREE.Mesh(new THREE.BufferGeometry(), terrainMat);
    terrain.name = 'terrain' + i;
    terrain.receiveShadow = true;
    const road = new THREE.Mesh(new THREE.BufferGeometry(), roadMat);
    road.name = 'road' + i;
    road.receiveShadow = true;
    const glow = new THREE.Mesh(new THREE.BufferGeometry(), roadGlowMat);
    glow.name = 'roadGlow' + i;
    const extra = { terrain, road, glow, water: null, chunk: null };
    for (const m of [terrain, road, glow]) { m.visible = false; root.add(m); }
    if (surfaceMat) {
      extra.water = new THREE.Mesh(new THREE.BufferGeometry(), surfaceMat);
      extra.water.name = (tb.water ? 'water' : 'lava') + i;
      extra.water.receiveShadow = !!tb.water;
      extra.water.visible = false;
      root.add(extra.water);
    }
    slotMeshes.push(extra);
  }

  // —— 地形块 ——
  function buildTerrain(c) {
    const j0 = c * ROWS;
    const H = new Float32Array((ROWS + 1) * NX);
    for (let r = 0; r <= ROWS; r++) {
      const z = (j0 + r) * DZ;
      for (let i = 0; i < NX; i++) H[r * NX + i] = tH(XS[i], z);
    }
    const tris = ROWS * (NX - 1) * 2;
    const pos = new Float32Array(tris * 9), cols = new Float32Array(tris * 9);
    let o = 0;
    const put = (ax, ay, az, bx, by, bz, cx, cy, cz, rnd) => {
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nyn = ny / Math.hypot(nx, ny, nz);
      const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
      groundColor(_c, mx, (ay + by + cy) / 3 - base(mz), mz, nyn, rnd, Math.abs(mx));
      pos[o] = ax; pos[o + 1] = ay; pos[o + 2] = az;
      pos[o + 3] = bx; pos[o + 4] = by; pos[o + 5] = bz;
      pos[o + 6] = cx; pos[o + 7] = cy; pos[o + 8] = cz;
      for (let k = 0; k < 9; k += 3) { cols[o + k] = _c.r; cols[o + k + 1] = _c.g; cols[o + k + 2] = _c.b; }
      o += 9;
    };
    for (let r = 0; r < ROWS; r++) {
      const z0 = (j0 + r) * DZ, z1 = z0 + DZ;
      for (let i = 0; i < NX - 1; i++) {
        const x0 = XS[i], x1 = XS[i + 1];
        const k = r * NX + i;
        const h00 = H[k], h10 = H[k + 1], h01 = H[k + NX], h11 = H[k + NX + 1];
        put(x0, h00, z0, x0, h01, z1, x1, h11, z1, hash3(i, j0 + r, 1, seed));
        put(x0, h00, z0, x1, h11, z1, x1, h10, z0, hash3(i, j0 + r, 2, seed));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  // 水面 / 岩浆条带（沿 z 跟随道路起伏）
  function buildSurface(c) {
    const z0 = c * CHUNK, z1 = z0 + CHUNK;
    const rows = 12;
    const pos = [];
    const idx = [];
    const strips = tb.water ? [[-75, 75, 24]] : [[-18.6, -10.6, 3], [10.6, 18.6, 3]];
    const yOff = tb.water ? tb.waterY : tb.lavaY;
    for (const [xa, xb, nxs] of strips) {
      const startV = pos.length / 3;
      for (let r = 0; r <= rows; r++) {
        const z = z0 + (z1 - z0) * r / rows;
        const y = base(z) + yOff;
        for (let i = 0; i <= nxs; i++) pos.push(xa + (xb - xa) * i / nxs, y, z);
      }
      for (let r = 0; r < rows; r++) {
        for (let i = 0; i < nxs; i++) {
          const a = startV + r * (nxs + 1) + i, b = a + 1, cc = a + nxs + 1, d = cc + 1;
          idx.push(a, cc, d, a, d, b);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  function landmarksIn(z0, z1) {
    const out = [];
    const k0 = Math.floor(z0 / LANDMARK_STEP) - 1, k1 = Math.floor(z1 / LANDMARK_STEP) + 1;
    for (let k = Math.max(0, k0); k <= k1; k++) {
      const z = k * LANDMARK_STEP + 75 + (hash3(k, 11, 5, seed) - 0.5) * 50;
      if (z >= z0 && z < z1) out.push({ x: 0, z, y: base(z), s: 1, ry: 0, b: 1 });
    }
    return out;
  }

  const chunks = new Map();
  const genTimes = [];
  function gen(c) {
    const t0 = performance.now();
    const slot = ((c % SLOTS) + SLOTS) % SLOTS;
    const sm = slotMeshes[slot];
    if (sm.chunk !== null && sm.chunk !== c) chunks.delete(sm.chunk);
    const z0 = c * CHUNK, z1 = z0 + CHUNK;
    const rand = mulberry32((seed ^ Math.imul(c + 7919, 2654435761)) >>> 0);

    sm.terrain.geometry.dispose();
    sm.terrain.geometry = buildTerrain(c);
    const gb = new GeoBuf(), gl = new GeoBuf();
    tb.road(ctx, gb, gl, z0, z1);
    sm.road.geometry.dispose();
    sm.road.geometry = gb.build();
    sm.glow.geometry.dispose();
    sm.glow.geometry = gl.empty ? new THREE.BufferGeometry() : gl.build();
    sm.glow.visible = !gl.empty;
    if (sm.water) {
      sm.water.geometry.dispose();
      sm.water.geometry = buildSurface(c);
      sm.water.visible = true;
    }
    sm.terrain.visible = true;
    sm.road.visible = true;
    // 弯道在顶点着色器里横向平移，包围球加大一圈留出余量（身后 / 视野外的块仍能正常剔除）
    for (const m of [sm.terrain, sm.road, sm.glow, sm.water]) {
      const bs = m && m.geometry.boundingSphere;
      if (bs && !m.geometry.userData.bendPad) { bs.radius += BEND_PAD; m.geometry.userData.bendPad = true; }
    }

    const P = makePlacer(ctx, rand, z0, z1);
    P.landmarks = landmarksIn(z0, z1);
    for (const dd of decos) dd.d.write(slot, dd.place(P));

    sm.chunk = c;
    chunks.set(c, slot);
    genTimes.push(performance.now() - t0);
    if (genTimes.length > 400) genTimes.shift();
  }

  function release(c) {
    const slot = chunks.get(c);
    chunks.delete(c);
    const sm = slotMeshes[slot];
    if (sm.chunk !== c) return;
    sm.chunk = null;
    sm.terrain.visible = sm.road.visible = sm.glow.visible = false;
    if (sm.water) sm.water.visible = false;
    for (const dd of decos) dd.d.write(slot, null);
  }

  const range = (fz) => [Math.floor((fz - BEHIND) / CHUNK), Math.floor((fz + AHEAD) / CHUNK)];

  // —— 天气（沿用竞技场的天气系统） ——
  const startZ = opts.startZ ?? 0;
  cfg.weather(ctx);

  // 初始窗口同步生成
  {
    const [a, b] = range(startZ);
    for (let c = a; c <= b; c++) gen(c);
    followSun(new THREE.Vector3(0, base(startZ), startZ));
  }

  scene.add(root);

  // 发光呼吸
  ctx.updaters.push((dt, t) => {
    const k = 0.9 + 0.1 * Math.sin(t * 7.1) * Math.sin(t * 2.3 + 1);
    ctx.glowMat.color.setScalar(k);
    roadGlowMat.color.setScalar(0.85 + 0.15 * Math.sin(t * 1.7));
  });

  let disposed = false;
  const _focus = new THREE.Vector3();
  const track = {
    biome,
    root,
    roadHalf: ROAD_HALF,
    heightAt,
    baseAt: base,
    addFlat,           // 首领战场压平（只影响尚未生成的地形块）
    sun,
    fogColor: horizon.clone(),
    update(dt, t, focus) {
      if (disposed) return;
      const f = _focus.set(focus ? focus.x : 0, focus ? focus.y : 0, focus ? focus.z : 0);
      ctx.timeU.value = t;
      sky.position.set(f.x, 0, f.z);
      followSun(f);
      if (farGroup) farGroup.position.set(0, 0, f.z + (tb.farOffset || 0));
      for (const p of ctx.pulse) p.mat.emissiveIntensity = p.base + p.amp * Math.sin(t * p.speed);
      for (const u of ctx.updaters) u(dt, t, f);
      // 流式生成：每次最多 1 块
      const [a, b] = range(f.z);
      for (const c of [...chunks.keys()]) if (c < a || c > b) release(c);
      for (let c = a; c <= b; c++) if (!chunks.has(c)) { gen(c); break; }
    },
    debug() {
      let draws = 0;
      root.traverse((o) => { if ((o.isMesh || o.isPoints || o.isSprite) && o.visible) draws++; });
      return { chunks: chunks.size, objects: root.children.length, draws, genMax: Math.max(...genTimes), genAvg: genTimes.reduce((a, b) => a + b, 0) / genTimes.length, keys: [...chunks.keys()] };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(root);
      const geos = new Set(), mats = new Set([terrainMat, roadMat, roadGlowMat, ctx.glowMat, ctx.decoMat, ...ctx.extraMats]), texs = new Set([ctx.sprite]);
      root.traverse((o) => {
        if (o.geometry && !o.isSprite) geos.add(o.geometry);
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
        if (o.isInstancedMesh) o.dispose();
        if (o.isLight && o.shadow && o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
      });
      for (const m of mats) { if (m.map) texs.add(m.map); m.dispose(); }
      for (const g of geos) g.dispose();
      for (const tx of texs) tx.dispose();
      root.clear();
      scene.fog = prevFog ?? null;
      scene.background = prevBg ?? null;
    },
  };
  return track;
}
