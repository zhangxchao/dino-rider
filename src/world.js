// =====================================================================
//  世界 / 地形模块：6 种生态竞技场（丛林 / 沙漠 / 雪原 / 沼泽 / 火山 / 暗影）
//  createWorld(biome, scene, opts) → { heightAt, arenaRadius, obstacles, sun, update, dispose }
//  全部程序化生成（带种子，布局稳定），低多边形 flatShading 风格。
// =====================================================================
import * as THREE from 'three';
import { attachBend } from './bend.js';

export const ARENA_RADIUS = 62;
const SIZE = 260;             // 地形边长
const HALF = SIZE / 2;
const TAU = Math.PI * 2;
const ORIGIN = new THREE.Vector3();

// ---------------------------------------------------------------------
//  数学 / 噪声
// ---------------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smooth(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hash3(x, y, z, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1440662683) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// 2D simplex noise（带种子）
function makeNoise(rand) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return function (xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0, tt, g;
    tt = 0.5 - x0 * x0 - y0 * y0;
    if (tt > 0) { g = perm[ii + perm[jj]] & 7; tt *= tt; n += tt * tt * (GX[g] * x0 + GY[g] * y0); }
    tt = 0.5 - x1 * x1 - y1 * y1;
    if (tt > 0) { g = perm[ii + i1 + perm[jj + j1]] & 7; tt *= tt; n += tt * tt * (GX[g] * x1 + GY[g] * y1); }
    tt = 0.5 - x2 * x2 - y2 * y2;
    if (tt > 0) { g = perm[ii + 1 + perm[jj + 1]] & 7; tt *= tt; n += tt * tt * (GX[g] * x2 + GY[g] * y2); }
    return 70 * n;
  };
}
function fbm(noise, x, z, oct = 4) {
  let s = 0, a = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, z * f); norm += a; a *= 0.5; f *= 2.03; }
  return s / norm;
}
function ridged(noise, x, z, oct = 4) {
  let s = 0, a = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { const v = 1 - Math.abs(noise(x * f, z * f)); s += a * v * v; norm += a; a *= 0.5; f *= 2.07; }
  return s / norm;
}

// ---------------------------------------------------------------------
//  几何工具：带顶点色的零件合并（每种装饰 = 1 个 InstancedMesh = 1 次绘制）
// ---------------------------------------------------------------------
const _col = new THREE.Color();
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(sx, sy, sz),
  );
}
function part(geo, color, m) {
  let g = geo;
  if (geo.index) { g = geo.toNonIndexed(); geo.dispose(); }
  if (m) g.applyMatrix4(m);
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g.computeVertexNormals();
  _col.set(color);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = _col.r; a[i * 3 + 1] = _col.g; a[i * 3 + 2] = _col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function merge(parts) {
  let n = 0;
  for (const p of parts) n += p.attributes.position.array.length;
  const pos = new Float32Array(n), nor = new Float32Array(n), col = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o);
    nor.set(p.attributes.normal.array, o);
    col.set(p.attributes.color.array, o);
    o += p.attributes.position.array.length;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
// 顶点抖动（按位置哈希，共享顶点保持一致，保证面片闭合）
function jitter(geo, amt, seed = 1, mode = 'radial') {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = hash3(Math.round(x * 1000), Math.round(y * 1000), Math.round(z * 1000), seed);
    const f = 1 + (h - 0.5) * 2 * amt;
    if (mode === 'xz') p.setXYZ(i, x * f, y, z * f);
    else if (mode === 'y') p.setXYZ(i, x, y + (h - 0.5) * 2 * amt, z);
    else p.setXYZ(i, x * f, y * f, z * f);
  }
  geo.computeVertexNormals();
  return geo;
}
// 顶点色按高度渐变
function gradientY(geo, c0, c1, y0, y1) {
  const p = geo.attributes.position, c = geo.attributes.color;
  const a = new THREE.Color(c0), b = new THREE.Color(c1);
  for (let i = 0; i < p.count; i++) {
    _col.copy(a).lerp(b, clamp((p.getY(i) - y0) / (y1 - y0), 0, 1));
    c.setXYZ(i, _col.r, _col.g, _col.b);
  }
  return geo;
}

function addInstanced(ctx, geo, mat, items, { cast = true, receive = true, name = '' } = {}) {
  if (!items.length) { geo.dispose(); return null; }
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  mesh.name = name;
  const tinted = items.some((it) => it.b !== undefined || it.tint !== undefined);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const s = it.s ?? 1;
    _e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0, 'YXZ');
    _q.setFromEuler(_e);
    _v1.set(it.x, it.y, it.z);
    _v2.set((it.sx ?? 1) * s, (it.sy ?? 1) * s, (it.sz ?? 1) * s);
    _m4.compose(_v1, _q, _v2);
    mesh.setMatrixAt(i, _m4);
    if (tinted) {
      if (it.tint !== undefined) _col.set(it.tint);
      else { const b = it.b ?? 1; _col.setRGB(b, b, b); }
      mesh.setColorAt(i, _col);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  ctx.root.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------
//  放置工具
// ---------------------------------------------------------------------
function nearSolid(ctx, x, z, pad) {
  for (const o of ctx.obstacles) if ((o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + pad) ** 2) return true;
  return false;
}
// 竞技场内部的实心障碍：中心 12m 内不放，外圈出生区（>50m）保持通畅
function placeSolids(ctx, n, { s = [1, 1], radius = (sc) => sc, rMin = 14, rMax = 50, gap = 4.5, avoid } = {}) {
  const out = [], rand = ctx.rand;
  for (let k = 0; k < n; k++) {
    const sc = lerp(s[0], s[1], rand());
    const rad = radius(sc);
    for (let t = 0; t < 80; t++) {
      const a = rand() * TAU, r = Math.sqrt(lerp(rMin * rMin, rMax * rMax, rand()));
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (r - rad < 12.5) continue;
      if (avoid && avoid(x, z)) continue;
      if (nearSolid(ctx, x, z, rad + gap)) continue;
      ctx.obstacles.push({ x, z, r: rad });
      out.push({ x, z, y: ctx.heightAt(x, z), s: sc, ry: rand() * TAU, b: 0.88 + rand() * 0.24 });
      break;
    }
  }
  return out;
}
// 纯装饰散布
function scatter(ctx, n, rMin, rMax, { minDist = 0, avoid, solidPad = -1, s = [1, 1] } = {}) {
  const out = [], rand = ctx.rand;
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < 25; t++) {
      const a = rand() * TAU, r = Math.sqrt(lerp(rMin * rMin, rMax * rMax, rand()));
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (avoid && avoid(x, z)) continue;
      if (solidPad >= 0 && nearSolid(ctx, x, z, solidPad)) continue;
      if (minDist > 0) {
        let bad = false;
        for (const p of out) if ((p.x - x) ** 2 + (p.z - z) ** 2 < minDist * minDist) { bad = true; break; }
        if (bad) continue;
      }
      out.push({ x, z, y: ctx.heightAt(x, z), r, a, ry: rand() * TAU, s: lerp(s[0], s[1], rand()), b: 0.85 + rand() * 0.3 });
      break;
    }
  }
  return out;
}
function sink(items, amount) {
  for (const it of items) it.y -= amount * (it.s ?? 1);
  return items;
}

// 贴地“裂纹 / 符文”条带：每个顶点都用 heightAt 贴合地形
function ribbonGeometry(ctx, paths, { width = 0.3, yOff = 0.06, fixedY = null, taper = true } = {}) {
  const pos = [];
  const yAt = (x, z) => (fixedY !== null ? fixedY : ctx.heightAt(x, z) + yOff);
  for (const path of paths) {
    const n = path.length;
    if (n < 2) continue;
    const w = path.width ?? width;
    for (let i = 0; i < n - 1; i++) {
      const [x0, z0] = path[i], [x1, z1] = path[i + 1];
      let dx = x1 - x0, dz = z1 - z0;
      const L = Math.hypot(dx, dz) || 1;
      dx /= L; dz /= L;
      const px = -dz, pz = dx;
      const w0 = taper ? w * (1 - i / (n - 1)) + 0.02 : w;
      const w1 = taper ? w * (1 - (i + 1) / (n - 1)) + 0.02 : w;
      const a = [x0 + px * w0, z0 + pz * w0], b = [x0 - px * w0, z0 - pz * w0];
      const c = [x1 + px * w1, z1 + pz * w1], d = [x1 - px * w1, z1 - pz * w1];
      pos.push(a[0], yAt(a[0], a[1]), a[1], c[0], yAt(c[0], c[1]), c[1], d[0], yAt(d[0], d[1]), d[1]);
      pos.push(a[0], yAt(a[0], a[1]), a[1], d[0], yAt(d[0], d[1]), d[1], b[0], yAt(b[0], b[1]), b[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
function crackPaths(rand, count, rMin, rMax, { segs = [6, 12], step = 0.9, width = [0.18, 0.4], branch = 0.35, avoid } = {}) {
  const paths = [];
  let guard = 0;
  while (paths.length < count && guard++ < count * 20) {
    const a0 = rand() * TAU, r0 = lerp(rMin, rMax, Math.sqrt(rand()));
    let x = Math.cos(a0) * r0, z = Math.sin(a0) * r0;
    if (avoid && avoid(x, z)) continue;
    let ang = rand() * TAU;
    const path = [[x, z]];
    const n = Math.floor(lerp(segs[0], segs[1], rand()));
    for (let i = 0; i < n; i++) {
      ang += (rand() - 0.5) * 1.1;
      x += Math.cos(ang) * step; z += Math.sin(ang) * step;
      path.push([x, z]);
      if (rand() < branch * 0.15 && i > 1) {
        const b = [[x, z]];
        let bx = x, bz = z, ba = ang + (rand() < 0.5 ? 1 : -1) * (0.6 + rand() * 0.6);
        const bn = 3 + Math.floor(rand() * 4);
        for (let k = 0; k < bn; k++) { ba += (rand() - 0.5) * 0.9; bx += Math.cos(ba) * step * 0.8; bz += Math.sin(ba) * step * 0.8; b.push([bx, bz]); }
        b.width = lerp(width[0], width[1], rand()) * 0.6;
        paths.push(b);
      }
    }
    path.width = lerp(width[0], width[1], rand());
    paths.push(path);
  }
  return paths;
}

// ---------------------------------------------------------------------
//  材质 / 着色器
// ---------------------------------------------------------------------
function decoMaterial(opts = {}) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88, metalness: 0, ...opts });
}
function makeSprite(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
      const d = Math.min(1, Math.hypot(dx, dy));
      const a = Math.pow(1 - d, 1.8) * 0.85 + Math.pow(Math.max(0, 1 - d * 2.2), 2) * 0.15;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
function waterMaterial(ctx, color, opacity, amp) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.14, metalness: 0.08, transparent: true, opacity, flatShading: true });
  const timeU = ctx.timeU;
  const A = amp.toFixed(3);
  m.onBeforeCompile = (sh) => {
    attachBend(sh);
    sh.uniforms.uTime = timeU;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec4 dwW = modelMatrix * vec4(position, 1.0);
      transformed.y += (sin(dwW.x * 0.33 + uTime * 1.3) + cos(dwW.z * 0.27 + uTime * 1.05) + sin((dwW.x + dwW.z) * 0.52 + uTime * 1.9) * 0.5) * ${A};`,
    );
  };
  m.customProgramCacheKey = () => 'dr-water-' + A;
  return m;
}
// 旗帜摆动（Instanced 布料，局部坐标顶端 y=0 向下垂）
function bannerMaterial(ctx, color) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide, flatShading: true });
  const timeU = ctx.timeU;
  m.onBeforeCompile = (sh) => {
    attachBend(sh);
    sh.uniforms.uTime = timeU;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float dPh = 0.0;
      #ifdef USE_INSTANCING
        dPh = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
      #endif
      float dK = clamp(-position.y / 3.6, 0.0, 1.0);
      transformed.z += sin(uTime * 2.2 + position.y * 1.3 + dPh) * 0.35 * dK * dK;
      transformed.x += sin(uTime * 1.6 + dPh) * 0.08 * dK;`,
    );
  };
  m.customProgramCacheKey = () => 'dr-banner';
  return m;
}
const NOISE_GLSL = /* glsl */`
  float dhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float dvnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(dhash(i), dhash(i + vec2(1.0, 0.0)), f.x), mix(dhash(i + vec2(0.0, 1.0)), dhash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float dfbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * dvnoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
    return s;
  }
`;
function lavaMaterial(ctx, { fog = true, hot = 0xffa21a, cool = 0x4a0a02, scale = 0.12 } = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uTime: { value: 0 }, uHot: { value: new THREE.Color(hot) }, uCool: { value: new THREE.Color(cool) }, uScale: { value: scale } },
    ]),
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      #include <bend_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        wp = bendWorld(wp);
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uHot; uniform vec3 uCool; uniform float uScale;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main() {
        vec2 p = vWorld.xz * uScale;
        float n1 = dfbm(p + vec2(uTime * 0.04, uTime * 0.025));
        float n2 = dfbm(p * 2.4 + vec2(-uTime * 0.07, uTime * 0.05) + n1 * 1.8);
        float heat = clamp((n2 - 0.28) * 2.2, 0.0, 1.0);
        float crust = smoothstep(0.52, 0.7, dfbm(p * 1.5 - vec2(uTime * 0.015)));
        heat = heat * (1.0 - crust * 0.85);
        float pulse = 0.85 + 0.15 * sin(uTime * 1.7 + vWorld.x * 0.05);
        vec3 col = mix(uCool, uHot, heat) * (0.55 + 3.2 * heat * heat * pulse);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog,
  });
  m.uniforms.uTime = ctx.timeU;
  return m;
}
function skyMaterial(ctx, s) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(s.top) },
      uHorizon: { value: new THREE.Color(s.horizon) },
      uBottom: { value: new THREE.Color(s.bottom ?? s.horizon) },
      uSunColor: { value: new THREE.Color(s.sunColor) },
      uSunDir: { value: new THREE.Vector3(...s.sunDir).normalize() },
      uSunSize: { value: s.sunSize },
      uSunIntensity: { value: s.sunI },
      uSunGlow: { value: s.glow ?? 1 },
      uClouds: { value: s.clouds ?? 0 },
      uCloudColor: { value: new THREE.Color(s.cloudColor ?? 0xffffff) },
      uStars: { value: s.stars ?? 0 },
      uMoon: { value: s.moon ?? 0 },
      uTime: ctx.timeU,
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uHorizon, uBottom, uSunColor, uSunDir, uCloudColor;
      uniform float uSunSize, uSunIntensity, uSunGlow, uClouds, uStars, uMoon, uTime;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(uHorizon, uBottom, clamp(-h * 5.0, 0.0, 1.0));
        vec3 sd = normalize(uSunDir);
        float cs = dot(d, sd);
        float sdp = max(cs, 0.0);
        col += uSunColor * (pow(sdp, 6.0) * 0.22 + pow(sdp, 48.0) * 0.45) * uSunGlow;
        // 星空
        if (uStars > 0.0 && h > 0.0) {
          vec2 uv = vec2(atan(d.z, d.x) * 90.0, asin(clamp(d.y, -1.0, 1.0)) * 90.0);
          vec2 ip = floor(uv);
          float r = dhash(ip);
          float star = step(0.986, r) * smoothstep(0.45, 0.0, length(fract(uv) - 0.5));
          star *= 0.6 + 0.4 * sin(uTime * (1.5 + r * 4.0) + r * 60.0);
          col += vec3(0.9, 0.9, 1.0) * star * uStars * 1.6 * smoothstep(0.02, 0.25, h);
        }
        // 云
        if (uClouds > 0.0 && h > 0.0) {
          vec2 cp = d.xz / (h + 0.18) * 1.1 + vec2(uTime * 0.008, uTime * 0.003);
          float c = dfbm(cp * 1.4);
          float cov = smoothstep(1.02 - uClouds, 1.22 - uClouds, c);
          vec3 cc = uCloudColor * (0.8 + 0.35 * dfbm(cp * 3.1 + 1.7)) + uSunColor * pow(sdp, 5.0) * 0.35;
          col = mix(col, cc, cov * smoothstep(0.0, 0.18, h) * 0.92);
        }
        // 太阳 / 月亮
        float disc = smoothstep(cos(uSunSize), cos(uSunSize * 0.9), cs);
        vec3 dc = uSunColor * uSunIntensity;
        if (uMoon > 0.5) {
          vec3 t1 = normalize(cross(sd, vec3(0.0, 1.0, 0.0)));
          vec3 t2 = cross(t1, sd);
          vec2 mp = vec2(dot(d, t1), dot(d, t2)) / uSunSize;
          float cr = dfbm(mp * 2.2 + 3.0);
          float cr2 = dfbm(mp * 6.0 - 1.0);
          dc *= 0.62 + 0.5 * smoothstep(0.35, 0.65, cr) - 0.18 * smoothstep(0.55, 0.7, cr2);
          col += uSunColor * pow(sdp, 220.0) * 0.8;
        }
        col = mix(col, dc, disc);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  return m;
}

// ---------------------------------------------------------------------
//  地形：高度场 → 非索引网格（每个三角面单独顶点色）+ 与网格完全一致的 heightAt
// ---------------------------------------------------------------------
function buildTerrain(ctx, hfn, colorFn) {
  const seg = ctx.hi ? 170 : 90;
  const cell = SIZE / seg, N = seg + 1;
  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = hfn(-HALF + i * cell, -HALF + j * cell);

  const heightAt = (x, z) => {
    let gx = (x + HALF) / cell, gz = (z + HALF) / cell;
    if (!(gx > 0)) gx = 0; else if (gx > seg - 1e-6) gx = seg - 1e-6;
    if (!(gz > 0)) gz = 0; else if (gz > seg - 1e-6) gz = seg - 1e-6;
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const k = j * N + i;
    const h00 = H[k], h10 = H[k + 1], h01 = H[k + N], h11 = H[k + N + 1];
    // 与网格三角剖分一致：(p00,p01,p11) 与 (p00,p11,p10)
    if (fz >= fx) return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
    return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
  };

  const tri = seg * seg * 2;
  const pos = new Float32Array(tri * 9), col = new Float32Array(tri * 9);
  const c = new THREE.Color();
  const rand = mulberry32(ctx.seed ^ 0x51f15e);
  let o = 0;
  const put = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nyn = ny / Math.hypot(nx, ny, nz);
    colorFn(c, (ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3, nyn, rand());
    pos[o] = ax; pos[o + 1] = ay; pos[o + 2] = az;
    pos[o + 3] = bx; pos[o + 4] = by; pos[o + 5] = bz;
    pos[o + 6] = cx; pos[o + 7] = cy; pos[o + 8] = cz;
    for (let k = 0; k < 9; k += 3) { col[o + k] = c.r; col[o + k + 1] = c.g; col[o + k + 2] = c.b; }
    o += 9;
  };
  for (let j = 0; j < seg; j++) {
    const z0 = -HALF + j * cell, z1 = z0 + cell;
    for (let i = 0; i < seg; i++) {
      const x0 = -HALF + i * cell, x1 = x0 + cell;
      const k = j * N + i;
      const h00 = H[k], h10 = H[k + 1], h01 = H[k + N], h11 = H[k + N + 1];
      put(x0, h00, z0, x0, h01, z1, x1, h11, z1);
      put(x0, h00, z0, x1, h11, z1, x1, h10, z0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0 }));
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return { mesh, heightAt, H, seg, cell, N };
}

// ---------------------------------------------------------------------
//  粒子系统（天气）：在玩家周围盒子内循环
// ---------------------------------------------------------------------
function addParticles(ctx, o) {
  const n = Math.max(4, Math.round(o.count * (ctx.hi ? 1 : 0.5)));
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = new Float32Array(n * 3), ph = new Float32Array(n);
  const A = o.area ?? 45, y0 = o.yMin ?? 0, y1 = o.yMax ?? 25;
  const rand = ctx.rand;
  const gy = ctx.heightAt(0, 0);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rand() * 2 - 1) * A;
    pos[i * 3 + 1] = gy + y0 + rand() * (y1 - y0);
    pos[i * 3 + 2] = (rand() * 2 - 1) * A;
    ph[i] = rand() * 100;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 1;
    if (o.init) o.init(i, pos, vel, col, ph, rand);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(o.colorDynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage));
  const mat = new THREE.PointsMaterial({
    size: o.size, map: ctx.sprite, transparent: true, depthWrite: false, vertexColors: true,
    opacity: o.opacity ?? 1, sizeAttenuation: true, fog: o.fog ?? true,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'particles:' + (o.name || '');
  pts.frustumCulled = false;
  pts.renderOrder = o.renderOrder ?? 3;
  ctx.root.add(pts);
  const H = y1 - y0;
  ctx.updaters.push((dt, t, f) => {
    const fx = f.x, fy = f.y, fz = f.z;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      o.step(i, k, dt, t, pos, vel, col, ph);
      let dx = pos[k] - fx;
      if (dx < -A) pos[k] += 2 * A; else if (dx > A) pos[k] -= 2 * A;
      let dz = pos[k + 2] - fz;
      if (dz < -A) pos[k + 2] += 2 * A; else if (dz > A) pos[k + 2] -= 2 * A;
      const dy = pos[k + 1] - fy;
      if (dy < y0) pos[k + 1] += H; else if (dy > y1) pos[k + 1] -= H;
    }
    geo.attributes.position.needsUpdate = true;
    if (o.colorDynamic) geo.attributes.color.needsUpdate = true;
  });
  return pts;
}

// 常用天气
const W = {
  snow: (ctx, count = 1400) => addParticles(ctx, {
    name: 'snow', count, size: 0.3, area: 42, yMin: -2, yMax: 26, opacity: 0.95,
    init(i, p, v, c, ph, r) { v[i * 3] = 0.5 + r() * 0.6; v[i * 3 + 1] = -(1.1 + r() * 1.3); v[i * 3 + 2] = 0.2 + r() * 0.3; const b = 0.9 + r() * 0.1; c[i * 3] = b; c[i * 3 + 1] = b; c[i * 3 + 2] = b + 0.02; },
    step(i, k, dt, t, p, v, c, ph) {
      p[k] += (v[k] + Math.sin(t * 0.9 + ph[i]) * 0.6) * dt;
      p[k + 1] += v[k + 1] * dt;
      p[k + 2] += (v[k + 2] + Math.cos(t * 0.7 + ph[i]) * 0.6) * dt;
    },
  }),
  leaves: (ctx, count = 160) => addParticles(ctx, {
    name: 'leaves', count, size: 0.42, area: 40, yMin: 0, yMax: 18,
    init(i, p, v, c, ph, r) {
      v[i * 3 + 1] = -(0.5 + r() * 0.6);
      const pal = [[0.25, 0.55, 0.12], [0.45, 0.62, 0.15], [0.7, 0.55, 0.12], [0.55, 0.32, 0.08]][Math.floor(r() * 4)];
      c[i * 3] = pal[0]; c[i * 3 + 1] = pal[1]; c[i * 3 + 2] = pal[2];
    },
    step(i, k, dt, t, p, v, c, ph) {
      p[k] += Math.sin(t * 1.3 + ph[i]) * 1.4 * dt + 0.3 * dt;
      p[k + 1] += v[k + 1] * dt;
      p[k + 2] += Math.cos(t * 1.1 + ph[i] * 1.3) * 1.2 * dt;
    },
  }),
  pollen: (ctx, count = 260, rgb = [1.0, 0.92, 0.55]) => addParticles(ctx, {
    name: 'pollen', count, size: 0.16, area: 38, yMin: 0.3, yMax: 9, additive: true, colorDynamic: true,
    step(i, k, dt, t, p, v, c, ph) {
      p[k] += Math.sin(t * 0.4 + ph[i]) * 0.35 * dt;
      p[k + 1] += Math.sin(t * 0.6 + ph[i] * 2.1) * 0.25 * dt;
      p[k + 2] += Math.cos(t * 0.35 + ph[i] * 1.7) * 0.35 * dt;
      const b = 0.35 + 0.35 * Math.sin(t * 1.5 + ph[i]);
      c[k] = rgb[0] * b; c[k + 1] = rgb[1] * b; c[k + 2] = rgb[2] * b;
    },
  }),
  fireflies: (ctx, count = 220, rgb = [0.8, 1.0, 0.3]) => addParticles(ctx, {
    name: 'fireflies', count, size: 0.34, area: 40, yMin: 0.4, yMax: 5.5, additive: true, colorDynamic: true,
    init(i, p, v) { v[i * 3] = 0; v[i * 3 + 1] = 0; v[i * 3 + 2] = 0; },
    step(i, k, dt, t, p, v, c, ph) {
      const q = ph[i];
      p[k] += Math.sin(t * 0.7 + q) * 0.9 * dt;
      p[k + 1] += Math.sin(t * 1.1 + q * 1.9) * 0.45 * dt;
      p[k + 2] += Math.cos(t * 0.6 + q * 1.3) * 0.9 * dt;
      const s = Math.max(0, Math.sin(t * (1.2 + (q % 1.3)) + q));
      const b = s * s * s * 3.2 + 0.05;
      c[k] = rgb[0] * b; c[k + 1] = rgb[1] * b; c[k + 2] = rgb[2] * b;
    },
  }),
  mist: (ctx, count = 60, rgb = [0.78, 0.84, 0.72], opacity = 0.13) => addParticles(ctx, {
    name: 'mist', count, size: 11, area: 48, yMin: 0.2, yMax: 3.2, opacity, renderOrder: 4,
    init(i, p, v, c) { c[i * 3] = rgb[0]; c[i * 3 + 1] = rgb[1]; c[i * 3 + 2] = rgb[2]; },
    step(i, k, dt, t, p, v, c, ph) {
      p[k] += (0.45 + Math.sin(t * 0.1 + ph[i]) * 0.3) * dt;
      p[k + 2] += Math.cos(t * 0.08 + ph[i]) * 0.3 * dt;
    },
  }),
  sand: (ctx, count = 800) => addParticles(ctx, {
    name: 'sand', count, size: 0.2, area: 42, yMin: 0, yMax: 7, opacity: 0.75,
    init(i, p, v, c, ph, r) {
      v[i * 3] = 6 + r() * 6; v[i * 3 + 1] = 0; v[i * 3 + 2] = 1.5 + r() * 2;
      const b = 0.85 + r() * 0.15; c[i * 3] = 0.93 * b; c[i * 3 + 1] = 0.78 * b; c[i * 3 + 2] = 0.55 * b;
    },
    step(i, k, dt, t, p, v, c, ph) {
      const gust = 0.7 + 0.5 * Math.sin(t * 0.5 + p[k + 2] * 0.03);
      p[k] += v[k] * gust * dt;
      p[k + 1] += Math.sin(t * 2 + ph[i]) * 0.6 * dt;
      p[k + 2] += v[k + 2] * dt;
    },
  }),
  embers: (ctx, count = 520) => addParticles(ctx, {
    name: 'embers', count, size: 0.22, area: 40, yMin: -1, yMax: 22, additive: true, colorDynamic: true,
    init(i, p, v, c, ph, r) { v[i * 3 + 1] = 1.2 + r() * 2.8; },
    step(i, k, dt, t, p, v, c, ph) {
      p[k] += (Math.sin(t * 1.7 + ph[i]) * 0.8 + 0.4) * dt;
      p[k + 1] += v[k + 1] * dt;
      p[k + 2] += Math.cos(t * 1.3 + ph[i]) * 0.8 * dt;
      const b = 0.6 + 0.4 * Math.sin(t * 7 + ph[i] * 3);
      c[k] = 3.2 * b; c[k + 1] = 1.0 * b; c[k + 2] = 0.18 * b;
    },
  }),
  ash: (ctx, count = 420) => addParticles(ctx, {
    name: 'ash', count, size: 0.26, area: 40, yMin: 0, yMax: 22, opacity: 0.85,
    init(i, p, v, c, ph, r) { v[i * 3 + 1] = -(0.35 + r() * 0.6); const b = 0.2 + r() * 0.18; c[i * 3] = b; c[i * 3 + 1] = b * 0.95; c[i * 3 + 2] = b * 0.92; },
    step(i, k, dt, t, p, v, c, ph) {
      p[k] += (Math.sin(t * 0.6 + ph[i]) * 0.5 + 0.5) * dt;
      p[k + 1] += v[k + 1] * dt;
      p[k + 2] += Math.cos(t * 0.5 + ph[i]) * 0.5 * dt;
    },
  }),
  motes: (ctx, count = 480) => addParticles(ctx, {
    name: 'motes', count, size: 0.26, area: 44, yMin: -2, yMax: 20, additive: true, colorDynamic: true,
    init(i, p, v, c, ph, r) { v[i * 3 + 1] = 0.3 + r() * 0.9; },
    step(i, k, dt, t, p, v, c, ph) {
      p[k] += Math.sin(t * 0.5 + ph[i]) * 0.4 * dt;
      p[k + 1] += v[k + 1] * dt;
      p[k + 2] += Math.cos(t * 0.45 + ph[i]) * 0.4 * dt;
      const b = 0.45 + 0.55 * Math.max(0, Math.sin(t * 1.4 + ph[i]));
      c[k] = 1.5 * b; c[k + 1] = 0.45 * b; c[k + 2] = 2.6 * b;
    },
  }),
};

// ---------------------------------------------------------------------
//  装饰几何体
// ---------------------------------------------------------------------
function geoRock(color, { detail = 0, seed = 1, flat = 0.72, amt = 0.3 } = {}) {
  const g = jitter(new THREE.IcosahedronGeometry(1, detail), amt, seed);
  g.scale(1, flat, 1);
  return merge([part(g, color)]);
}
function geoCapRock(rock, cap, seed = 3) {
  const a = jitter(new THREE.IcosahedronGeometry(1, 0), 0.3, seed);
  a.scale(1, 0.72, 1);
  const b = jitter(new THREE.IcosahedronGeometry(1, 0), 0.25, seed + 7);
  b.scale(0.88, 0.32, 0.88);
  b.translate(0, 0.46, 0);
  return merge([part(a, rock), part(b, cap)]);
}
function geoBroadleaf() {
  const P = [];
  P.push(part(new THREE.CylinderGeometry(0.3, 0.55, 7.2, 6), 0x6b4a2e, T(0, 3.6, 0)));
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + 0.4;
    P.push(part(new THREE.ConeGeometry(0.32, 1.9, 4), 0x5c3f26, T(Math.cos(a) * 0.52, 0.6, Math.sin(a) * 0.52, 0, -a, 0.55)));
  }
  const blobs = [
    [0, 7.7, 0, 2.9, 0x3d8c33], [1.8, 7.0, 0.7, 2.2, 0x4d9e3c], [-1.7, 7.2, -0.8, 2.1, 0x2f7a2c],
    [0.3, 9.2, -0.3, 1.9, 0x58aa44], [-0.5, 7.0, 1.7, 2.0, 0x3f8f35], [0.9, 6.8, -1.6, 1.8, 0x357f30],
  ];
  blobs.forEach((b, i) => {
    const g = jitter(new THREE.IcosahedronGeometry(1, 0), 0.2, 11 + i);
    P.push(part(g, b[4], T(b[0], b[1], b[2], 0, i * 0.9, 0, b[3], b[3] * 0.78, b[3])));
  });
  // 藤蔓
  for (let k = 0; k < 5; k++) {
    const a = k * 1.3 + 0.2, r = 1.6 + (k % 2) * 0.6, len = 2.4 + (k % 3) * 0.9;
    P.push(part(new THREE.CylinderGeometry(0.045, 0.06, len, 3), 0x2f6a26, T(Math.cos(a) * r, 6.2 - len / 2, Math.sin(a) * r)));
  }
  return merge(P);
}
function leafPart(len, width, color, pitch, yaw, x, y, z) {
  const g = new THREE.ConeGeometry(width, len, 4, 1);
  g.translate(0, len / 2, 0);
  g.rotateX(Math.PI / 2);
  g.scale(1, 0.18, 1);
  g.rotateX(pitch);
  g.rotateY(yaw);
  g.translate(x, y, z);
  return part(g, color);
}
function geoPalm() {
  const P = [];
  let x = 0, y = 0;
  const segs = 7;
  for (let i = 0; i < segs; i++) {
    const r0 = 0.34 - i * 0.022, r1 = r0 - 0.022, len = 1.15, lean = 0.05 + i * 0.04;
    const dx = Math.sin(lean) * len, dy = Math.cos(lean) * len;
    P.push(part(new THREE.CylinderGeometry(r1, r0, len * 1.04, 6), i % 2 ? 0x8a6a44 : 0x7a5a38, T(x + dx / 2, y + dy / 2, 0, 0, 0, -lean)));
    x += dx; y += dy;
  }
  for (let k = 0; k < 8; k++) {
    const yaw = k * TAU / 8 + (k % 2) * 0.2;
    P.push(leafPart(3.6 - (k % 2) * 0.5, 0.55, k % 2 ? 0x3e8a30 : 0x4f9c3a, 0.45 + (k % 3) * 0.12, yaw, x, y + 0.1, 0));
  }
  for (let k = 0; k < 3; k++) {
    const a = k * TAU / 3;
    P.push(part(new THREE.IcosahedronGeometry(0.2, 0), 0x5a3a1c, T(x + Math.cos(a) * 0.3, y - 0.25, Math.sin(a) * 0.3)));
  }
  return merge(P);
}
function geoFern(color = 0x3f8a2e, color2 = 0x5aa23c) {
  const P = [];
  for (let k = 0; k < 7; k++) P.push(leafPart(1.7, 0.32, k % 2 ? color : color2, -0.75 + (k % 3) * 0.12, k * TAU / 7, 0, 0.05, 0));
  for (let k = 0; k < 5; k++) P.push(leafPart(1.1, 0.25, color2, -1.05, k * TAU / 5 + 0.3, 0, 0.05, 0));
  return merge(P);
}
function geoFlower(petal, center = 0xffd84a) {
  const P = [];
  P.push(part(new THREE.CylinderGeometry(0.07, 0.1, 1.5, 4), 0x3f7a2a, T(0, 0.75, 0)));
  P.push(leafPart(0.8, 0.2, 0x4f8f34, 0.1, 0.5, 0, 0.5, 0));
  P.push(leafPart(0.7, 0.2, 0x4f8f34, 0.1, 3.4, 0, 0.8, 0));
  for (let k = 0; k < 5; k++) {
    const a = k * TAU / 5;
    P.push(part(new THREE.SphereGeometry(0.42, 6, 4), petal, T(Math.cos(a) * 0.42, 1.55, Math.sin(a) * 0.42, 0, -a, 0.35, 1, 0.22, 0.6)));
  }
  P.push(part(new THREE.IcosahedronGeometry(0.2, 0), center, T(0, 1.62, 0)));
  return merge(P);
}
function geoGrass(c1 = 0x4f8f2e, c2 = 0x6aa83a) {
  const P = [];
  for (let k = 0; k < 5; k++) {
    const a = k * 1.7, r = 0.12 + (k % 2) * 0.1, h = 0.7 + (k % 3) * 0.25;
    P.push(part(new THREE.ConeGeometry(0.09, h, 3), k % 2 ? c1 : c2, T(Math.cos(a) * r, h / 2, Math.sin(a) * r, Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3)));
  }
  return merge(P);
}
function geoSaguaro() {
  const G = 0x4a8a3a, G2 = 0x3f7a32;
  const P = [];
  P.push(part(new THREE.CylinderGeometry(0.42, 0.5, 5.2, 8), G, T(0, 2.6, 0)));
  P.push(part(new THREE.SphereGeometry(0.42, 8, 4, 0, TAU, 0, Math.PI / 2), G, T(0, 5.2, 0)));
  // 右臂
  P.push(part(new THREE.CylinderGeometry(0.27, 0.27, 1.1, 7), G2, T(0.65, 2.2, 0, 0, 0, Math.PI / 2)));
  P.push(part(new THREE.CylinderGeometry(0.27, 0.3, 1.9, 7), G2, T(1.2, 3.05, 0)));
  P.push(part(new THREE.SphereGeometry(0.27, 7, 3, 0, TAU, 0, Math.PI / 2), G2, T(1.2, 4.0, 0)));
  // 左臂
  P.push(part(new THREE.CylinderGeometry(0.25, 0.25, 0.9, 7), G2, T(-0.55, 3.1, 0, 0, 0, Math.PI / 2)));
  P.push(part(new THREE.CylinderGeometry(0.25, 0.27, 1.4, 7), G2, T(-1.0, 3.75, 0)));
  P.push(part(new THREE.SphereGeometry(0.25, 7, 3, 0, TAU, 0, Math.PI / 2), G2, T(-1.0, 4.45, 0)));
  // 花
  P.push(part(new THREE.IcosahedronGeometry(0.16, 0), 0xff6a9a, T(0.15, 5.55, 0.1)));
  P.push(part(new THREE.IcosahedronGeometry(0.14, 0), 0xffd24a, T(1.25, 4.25, 0)));
  return merge(P);
}
function geoPricklyPear() {
  const P = [];
  const pads = [[0, 0.6, 0, 0, 0.7], [0.45, 1.3, 0.1, -0.4, 0.55], [-0.4, 1.25, -0.05, 0.5, 0.5], [0.1, 1.8, 0.2, 0.1, 0.45]];
  pads.forEach((p, i) => P.push(part(new THREE.SphereGeometry(1, 7, 5), i % 2 ? 0x5a9a44 : 0x4c8a3a, T(p[0], p[1], p[2], 0, i, p[3], p[4], p[4] * 1.1, p[4] * 0.3))));
  P.push(part(new THREE.IcosahedronGeometry(0.1, 0), 0xff4a6a, T(0.1, 2.3, 0.2)));
  P.push(part(new THREE.IcosahedronGeometry(0.1, 0), 0xffd24a, T(0.55, 1.85, 0.1)));
  return merge(P);
}
function geoMesa(seed) {
  const P = [];
  const layers = [[10.5, 11.2, 0, 5, 0xb4663a], [9.6, 10.3, 5, 4.2, 0xc67a46], [9.0, 9.6, 9.2, 3.4, 0xd48e56], [8.6, 9.0, 12.6, 0.8, 0xe2a86e]];
  layers.forEach((l, i) => {
    const g = new THREE.CylinderGeometry(l[0], l[1], l[3], 8, 1);
    g.translate(0, l[2] + l[3] / 2, 0);
    jitter(g, 0.12, seed + i, 'xz');
    P.push(part(g, l[4]));
  });
  return merge(P);
}
function geoArch() {
  const g = new THREE.TorusGeometry(7, 1.8, 5, 12, Math.PI);
  jitter(g, 0.12, 77);
  const legL = jitter(new THREE.CylinderGeometry(1.7, 2.3, 2.5, 6), 0.1, 78);
  legL.translate(-7, -1.0, 0);
  const legR = jitter(new THREE.CylinderGeometry(1.7, 2.3, 2.5, 6), 0.1, 79);
  legR.translate(7, -1.0, 0);
  const a = merge([part(g, 0xc47848), part(legL, 0xb46a3e), part(legR, 0xb46a3e)]);
  gradientY(a, 0xa85e36, 0xd89a60, -2, 9);
  return a;
}
function geoRibcage() {
  const B = 0xece2c8, B2 = 0xd8ccb0;
  const P = [];
  P.push(part(new THREE.CylinderGeometry(0.22, 0.18, 8, 5), B2, T(0, 2.2, 0, Math.PI / 2, 0, 0)));
  for (let k = 0; k < 6; k++) {
    const z = -2.6 + k * 1.05, R = 2.5 - Math.abs(k - 2) * 0.25;
    const g = new THREE.TorusGeometry(R, 0.16, 4, 9, Math.PI * 1.3);
    g.rotateZ(-0.15 * Math.PI);
    g.translate(0, 2.2 - R * 0.35, z);
    P.push(part(g, k % 2 ? B : B2));
  }
  // 头骨
  const skull = jitter(new THREE.BoxGeometry(1.3, 1.1, 2.0, 1, 1, 1), 0.12, 91);
  P.push(part(skull, B, T(0, 1.2, 5.2, -0.3, 0, 0.1)));
  P.push(part(new THREE.BoxGeometry(1.0, 0.3, 1.6), B2, T(0, 0.5, 5.4, 0.2, 0, 0)));
  P.push(part(new THREE.ConeGeometry(0.15, 0.8, 4), B, T(0.45, 1.9, 5.0, -0.6, 0, -0.4)));
  P.push(part(new THREE.ConeGeometry(0.15, 0.8, 4), B, T(-0.45, 1.9, 5.0, -0.6, 0, 0.4)));
  return merge(P);
}
function geoSkull() {
  const B = 0xece2c8;
  const P = [];
  P.push(part(jitter(new THREE.BoxGeometry(0.8, 0.6, 1.1), 0.15, 5), B, T(0, 0.3, 0)));
  P.push(part(new THREE.ConeGeometry(0.1, 0.6, 4), B, T(0.3, 0.7, -0.2, -0.4, 0, -0.5)));
  P.push(part(new THREE.ConeGeometry(0.1, 0.6, 4), B, T(-0.3, 0.7, -0.2, -0.4, 0, 0.5)));
  P.push(part(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 4), 0xd8ccb0, T(0.8, 0.08, 0.6, 0, 0.6, Math.PI / 2)));
  return merge(P);
}
function geoShrub(color) {
  const g = jitter(new THREE.IcosahedronGeometry(0.7, 1), 0.35, 33);
  g.scale(1, 0.7, 1);
  g.translate(0, 0.35, 0);
  return merge([part(g, color)]);
}
function geoPine() {
  const P = [];
  P.push(part(new THREE.CylinderGeometry(0.22, 0.34, 2.2, 5), 0x5a3e2a, T(0, 1.1, 0)));
  for (let k = 0; k < 4; k++) {
    const r = 2.35 - k * 0.5, h = 2.6 - k * 0.22, y = 1.3 + k * 1.38;
    P.push(part(new THREE.ConeGeometry(r, h, 7), k % 2 ? 0x2f5d45 : 0x28533e, T(0, y + h / 2, 0, 0, k * 0.4, 0)));
    const hs = h * 0.52;
    P.push(part(new THREE.ConeGeometry(r * 0.55 + 0.1, hs, 7), 0xf3f7fb, T(0, y + h - hs / 2 + 0.05, 0, 0, k * 0.4, 0)));
  }
  return merge(P);
}
function geoIceCluster() {
  const P = [];
  const shards = [
    [0, 1.2, 0, 0, 0, 0, 0.55, 2.6, 0xcff2ff], [0.65, 0.8, 0.3, 0.35, 0.5, -0.45, 0.4, 1.8, 0xa8e2ff],
    [-0.55, 0.7, -0.2, -0.3, 1.2, 0.5, 0.38, 1.6, 0xb8ecff], [0.1, 0.5, -0.65, -0.45, 2.1, -0.2, 0.3, 1.2, 0x9adcff],
    [-0.2, 0.4, 0.6, 0.5, 0.2, 0.3, 0.28, 1.0, 0xd8f6ff],
  ];
  for (const s of shards) P.push(part(new THREE.OctahedronGeometry(1, 0), s[8], T(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[6])));
  return merge(P);
}
function geoIceSpire(seed) {
  const g = new THREE.CylinderGeometry(0.35, 1.8, 1, 5, 3);
  g.translate(0, 0.5, 0);
  jitter(g, 0.22, seed, 'xz');
  const m = merge([part(g, 0xffffff)]);
  gradientY(m, 0x9ccbe6, 0xeaf6ff, 0, 1);
  return m;
}
function geoDrift() {
  const g = jitter(new THREE.IcosahedronGeometry(1, 1), 0.12, 41);
  g.scale(3, 0.8, 2);
  return merge([part(g, 0xf4f8fc)]);
}
function geoDeadTree(seed, bark = 0x4a3e30, moss = 0x7a8a5a, { mossy = true, branches = 4 } = {}) {
  const r = mulberry32(seed);
  const P = [];
  const start = new THREE.Vector3(0, -0.3, 0);
  let ax = 0, az = 0;
  const tops = [];
  for (let i = 0; i < 4; i++) {
    const len = 1.9 - i * 0.2, r0 = 0.45 - i * 0.09, r1 = r0 - 0.09;
    ax += (r() - 0.5) * 0.5; az += (r() - 0.5) * 0.5;
    const eul = new THREE.Euler(ax, 0, az, 'XYZ');
    const d = new THREE.Vector3(0, len, 0).applyEuler(eul);
    const mid = start.clone().addScaledVector(d, 0.5);
    const m = new THREE.Matrix4().makeRotationFromEuler(eul).setPosition(mid);
    P.push(part(new THREE.CylinderGeometry(Math.max(0.08, r1), r0, len * 1.05, 5), bark, m));
    start.add(d);
    tops.push(start.clone());
  }
  for (let b = 0; b < branches; b++) {
    const base = tops[Math.min(tops.length - 1, 1 + (b % 3))];
    const yaw = b * 2.1 + r() * 0.8, tilt = 0.6 + r() * 0.5, len = 1.3 + r() * 1.1;
    const eul = new THREE.Euler(0, yaw, tilt, 'YXZ');
    const d = new THREE.Vector3(0, len, 0).applyEuler(eul);
    const mid = base.clone().addScaledVector(d, 0.5);
    P.push(part(new THREE.CylinderGeometry(0.04, 0.12, len, 4), bark, new THREE.Matrix4().makeRotationFromEuler(eul).setPosition(mid)));
    const tip = base.clone().add(d);
    if (mossy) P.push(part(new THREE.ConeGeometry(0.16, 1.2 + r() * 0.8, 4), moss, T(tip.x, tip.y - 0.7, tip.z, Math.PI, 0, 0)));
    // 小枝
    const d2 = new THREE.Vector3(0, len * 0.5, 0).applyEuler(new THREE.Euler(0, yaw + 0.8, tilt - 0.5, 'YXZ'));
    const mid2 = tip.clone().addScaledVector(d2, 0.5);
    P.push(part(new THREE.CylinderGeometry(0.02, 0.05, len * 0.5, 3), bark, new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, yaw + 0.8, tilt - 0.5, 'YXZ')).setPosition(mid2)));
  }
  return merge(P);
}
function geoMushStem() {
  const P = [];
  const g = new THREE.CylinderGeometry(0.28, 0.45, 2.6, 7);
  P.push(part(g, 0xe6dcc2, T(0, 1.3, 0, 0, 0, 0.05)));
  const gills = new THREE.CylinderGeometry(1.5, 0.3, 0.3, 9, 1);
  P.push(part(gills, 0xbfae90, T(0, 2.45, 0)));
  return merge(P);
}
function geoMushCap(capColor, spotColor) {
  const P = [];
  const cap = new THREE.SphereGeometry(1.6, 9, 5, 0, TAU, 0, Math.PI / 2);
  cap.scale(1, 0.58, 1);
  P.push(part(cap, capColor, T(0, 2.55, 0)));
  const spots = [[0.5, 0.35], [-0.6, 0.4], [0.1, -0.7], [0.85, -0.5], [-0.3, 0.95], [-0.95, -0.35]];
  for (const [sx, sz] of spots) {
    const y = 2.55 + Math.sqrt(Math.max(0, 1 - (sx * sx + sz * sz) / 2.56)) * 0.93;
    P.push(part(new THREE.IcosahedronGeometry(0.2, 0), spotColor, T(sx, y, sz, 0, 0, 0, 1, 0.45, 1)));
  }
  return merge(P);
}
function geoReeds() {
  const P = [];
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9, r = 0.1 + (k % 3) * 0.12, h = 1.5 + (k % 4) * 0.3;
    P.push(part(new THREE.ConeGeometry(0.05, h, 3), k % 2 ? 0x6a7a3a : 0x5a6a30, T(Math.cos(a) * r, h / 2, Math.sin(a) * r, Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15)));
    if (k % 3 === 0) P.push(part(new THREE.CylinderGeometry(0.08, 0.08, 0.4, 5), 0x5a3a20, T(Math.cos(a) * r, h * 0.82, Math.sin(a) * r)));
  }
  return merge(P);
}
function geoLily(withFlower) {
  const P = [part(new THREE.CylinderGeometry(0.8, 0.8, 0.05, 9, 1, false, 0.35, TAU - 0.35), 0x4f8a36)];
  if (withFlower) {
    for (let k = 0; k < 5; k++) {
      const a = k * TAU / 5;
      P.push(part(new THREE.ConeGeometry(0.1, 0.35, 3), 0xf6a0c8, T(Math.cos(a) * 0.1, 0.15, Math.sin(a) * 0.1, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5)));
    }
    P.push(part(new THREE.IcosahedronGeometry(0.07, 0), 0xffe070, T(0, 0.18, 0)));
  }
  return merge(P);
}
function geoShardCluster(seed, color) {
  const r = mulberry32(seed);
  const P = [];
  for (let k = 0; k < 4; k++) {
    const g = jitter(new THREE.OctahedronGeometry(1, 0), 0.2, seed + k);
    P.push(part(g, color, T((r() - 0.5) * 1.4, 0.6 + r() * 0.5, (r() - 0.5) * 1.4, (r() - 0.5) * 0.7, r() * TAU, (r() - 0.5) * 0.7, 0.45 + r() * 0.3, 1.2 + r() * 1.3, 0.45 + r() * 0.3)));
  }
  const base = jitter(new THREE.IcosahedronGeometry(1.1, 0), 0.3, seed + 9);
  base.scale(1, 0.5, 1);
  P.push(part(base, color));
  return merge(P);
}
function geoPillar(broken, seed) {
  const S = 0x5c586c, S2 = 0x4a4658;
  const P = [];
  P.push(part(new THREE.BoxGeometry(2.3, 0.6, 2.3), S2, T(0, 0.3, 0)));
  P.push(part(new THREE.BoxGeometry(1.9, 0.3, 1.9), S, T(0, 0.75, 0)));
  const H = broken ? 3.2 : 7.2;
  const shaft = new THREE.CylinderGeometry(0.72, 0.82, H, 8, broken ? 1 : 3);
  shaft.translate(0, 0.9 + H / 2, 0);
  if (broken) {
    const p = shaft.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0.9 + H - 0.01) {
        const h = hash3(Math.round(p.getX(i) * 100), 0, Math.round(p.getZ(i) * 100), seed);
        p.setY(i, p.getY(i) + (h - 0.5) * 1.6);
      }
    }
  }
  P.push(part(shaft, S));
  if (!broken) {
    P.push(part(new THREE.BoxGeometry(2.0, 0.35, 2.0), S, T(0, 0.9 + H + 0.17, 0)));
    P.push(part(new THREE.BoxGeometry(2.3, 0.4, 2.3), S2, T(0, 0.9 + H + 0.52, 0)));
  }
  return merge(P);
}
function geoWall(seed) {
  const r = mulberry32(seed);
  const P = [];
  let x = -6;
  while (x < 6) {
    const w = 1.6 + r() * 1.4, h = 2 + r() * 4.5;
    P.push(part(jitter(new THREE.BoxGeometry(w, h, 1.4, 1, 2, 1), 0.06, seed + Math.round(x * 10)), r() < 0.5 ? 0x3a3648 : 0x2e2a3c, T(x + w / 2, h / 2 - 0.3, 0, 0, 0, (r() - 0.5) * 0.06)));
    x += w;
  }
  return merge(P);
}
function geoSpire(seed) {
  const g = new THREE.ConeGeometry(1, 1, 5, 3);
  g.translate(0, 0.5, 0);
  jitter(g, 0.25, seed, 'xz');
  const m = merge([part(g, 0xffffff)]);
  gradientY(m, 0x241c32, 0x0e0a16, 0, 1);
  return m;
}
function geoBannerPole() {
  const P = [];
  P.push(part(new THREE.CylinderGeometry(0.08, 0.1, 6.4, 5), 0x1a1620, T(0, 3.2, 0)));
  P.push(part(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 4), 0x1a1620, T(0, 6.0, 0, 0, 0, Math.PI / 2)));
  P.push(part(new THREE.OctahedronGeometry(0.22, 0), 0x8a7a4a, T(0, 6.6, 0)));
  return merge(P);
}

// ---------------------------------------------------------------------
//  生态配置
// ---------------------------------------------------------------------
const POND = { x: -30, z: 24, r: 10, water: -0.35 };
const LAKE = { x: 26, z: -21, r: 13, level: -0.4 };
const SWAMP_WATER = 0.0;
const LAVA_Y = -1.25;
const VOLCANO = { x: 150, z: -168 };

function lift(n, x, z, s = 1) {
  return fbm(n, x * 0.09 + 13.1, z * 0.09 - 7.7, 2) * 0.22 * s;
}

const BIOMES = {
  // ======================= 丛林 =======================
  jungle: {
    sky: { top: 0x2f7fd6, horizon: 0xb5d9c6, bottom: 0x9cc4ae, sunColor: 0xfff2d0, sunDir: [0.45, 0.62, 0.35], sunSize: 0.05, sunI: 10, glow: 0.8, clouds: 0.46, cloudColor: 0xffffff },
    fog: { near: 45, far: 220 },
    light: { hemiSky: 0xd0ecff, hemiGround: 0x3a5a2a, hemi: 1.1, sun: 0xfff0d4, sunI: 3.0, amb: 0xffffff, ambI: 0.08 },
    height(ctx) {
      const n = ctx.noise;
      return (x, z) => {
        const r = Math.hypot(x, z);
        const flat = 0.35 + 0.65 * smooth(4, 26, r);
        let h = fbm(n, x * 0.022, z * 0.022, 4) * 1.6 * flat + lift(n, x, z);
        const dp = Math.hypot(x - POND.x, z - POND.z);
        h += Math.max(0, 0.45 - h) * smooth(POND.r + 9, POND.r + 1, dp);
        const pw = smooth(POND.r + 5, POND.r - 2, dp);
        h = h * (1 - pw) + (-1.3 + (dp / POND.r) * 0.6) * pw;
        const e = smooth(ARENA_RADIUS + 1, ARENA_RADIUS + 34, r);
        if (e > 0) {
          const hill = 15 + fbm(n, x * 0.017 + 40, z * 0.017 - 20, 4) * 12 + ridged(n, x * 0.03 - 9, z * 0.03 + 5, 3) * 16 + smooth(100, 150, r) * 12;
          h = h * (1 - e) + hill * e;
        }
        return h;
      };
    },
    ground(ctx) {
      const n = ctx.noise;
      const C = { a: new THREE.Color(0x4a8a2a), b: new THREE.Color(0x6fa338), c: new THREE.Color(0x3c7424), mud: new THREE.Color(0x5c4a30), wet: new THREE.Color(0x46382a), rock: new THREE.Color(0x6d675a), moss: new THREE.Color(0x56663e) };
      return (c, x, y, z, ny, rnd) => {
        if (y < POND.water + 0.3 && Math.hypot(x - POND.x, z - POND.z) < POND.r + 7) c.copy(y < POND.water - 0.1 ? C.wet : C.mud);
        else if (ny < 0.74) c.copy(C.rock).lerp(C.moss, rnd * 0.6);
        else if (y > 11) c.copy(C.moss).lerp(C.c, rnd);
        else {
          const p = fbm(n, x * 0.05 + 3, z * 0.05 - 5, 2) * 0.5 + 0.5;
          c.copy(C.c).lerp(C.a, smooth(0.25, 0.5, p)).lerp(C.b, smooth(0.58, 0.85, p));
        }
        c.multiplyScalar(0.92 + rnd * 0.16);
      };
    },
    decorate(ctx) {
      const q = ctx.hi ? 1 : 0.5;
      const mat = ctx.decoMat;
      const avoidPond = (x, z) => Math.hypot(x - POND.x, z - POND.z) < POND.r + 4;
      // —— 实心障碍 ——
      const trees = placeSolids(ctx, 10, { s: [0.9, 1.25], radius: (s) => 0.6 * s + 0.35, avoid: avoidPond });
      const rocks = placeSolids(ctx, 7, { s: [1.5, 2.5], radius: (s) => s * 0.95, avoid: avoidPond });
      const palms = placeSolids(ctx, 6, { s: [0.9, 1.2], radius: (s) => 0.45 * s + 0.3, avoid: avoidPond });
      // —— 边缘树墙 / 岩石 ——
      trees.push(...scatter(ctx, Math.round(140 * q), ARENA_RADIUS + 2, 122, { minDist: 4.6, s: [1.0, 1.75] }));
      palms.push(...scatter(ctx, Math.round(40 * q), ARENA_RADIUS + 1, 105, { minDist: 5, s: [0.9, 1.4] }));
      rocks.push(...scatter(ctx, Math.round(34 * q), ARENA_RADIUS + 4, 110, { minDist: 7, s: [2.5, 6.5] }));
      addInstanced(ctx, geoBroadleaf(), mat, sink(trees, 0.25), { name: 'trees' });
      addInstanced(ctx, geoPalm(), mat, sink(palms, 0.2), { name: 'palms' });
      addInstanced(ctx, geoRock(0x6a6858, { seed: 5, detail: 0 }), mat, sink(rocks.map((r) => ({ ...r, tint: new THREE.Color().setRGB(0.8 + r.b * 0.2, 0.85 + r.b * 0.15, 0.75 + r.b * 0.2) })), 0.25), { name: 'rocks' });
      // —— 地面植被 ——
      const ferns = scatter(ctx, Math.round(110 * q), 6, 75, { avoid: avoidPond, solidPad: 0.6, s: [0.8, 1.5] });
      addInstanced(ctx, geoFern(), mat, ferns, { name: 'ferns' });
      const flowerCols = [[0xff5fa0, 0xffd84a], [0xff8a2a, 0xfff07a], [0xa06aff, 0xfff0a0]];
      flowerCols.forEach((fc, i) => {
        const fl = scatter(ctx, Math.round(16 * q), 8, 66, { avoid: avoidPond, solidPad: 0.8, s: [0.9, 1.6] });
        addInstanced(ctx, geoFlower(fc[0], fc[1]), mat, fl, { name: 'flowers' + i });
      });
      const grass = scatter(ctx, Math.round(650 * q), 2, 78, { s: [0.8, 1.5], avoid: (x, z) => Math.hypot(x - POND.x, z - POND.z) < POND.r - 1 });
      addInstanced(ctx, geoGrass(), mat, grass, { name: 'grass', cast: false });
      const pebbles = scatter(ctx, Math.round(40 * q), 8, 60, { s: [0.25, 0.6], solidPad: 0.5 });
      addInstanced(ctx, geoRock(0x7a7666, { seed: 8 }), mat, pebbles, { name: 'pebbles', cast: false });
      // —— 池塘 ——
      const wg = new THREE.RingGeometry(0.01, POND.r + 3, 40, 8);
      wg.rotateX(-Math.PI / 2);
      const water = new THREE.Mesh(wg, waterMaterial(ctx, 0x3a8a8a, 0.8, 0.05));
      water.position.set(POND.x, POND.water, POND.z);
      water.receiveShadow = true;
      water.name = 'pond';
      ctx.root.add(water);
      const lilies = [];
      for (let i = 0; i < 12; i++) {
        const a = ctx.rand() * TAU, r = Math.sqrt(ctx.rand()) * (POND.r - 2);
        lilies.push({ x: POND.x + Math.cos(a) * r, y: POND.water + 0.03, z: POND.z + Math.sin(a) * r, ry: ctx.rand() * TAU, s: 0.7 + ctx.rand() * 0.6 });
      }
      addInstanced(ctx, geoLily(false), mat, lilies.slice(0, 8), { name: 'lily', cast: false });
      addInstanced(ctx, geoLily(true), mat, lilies.slice(8), { name: 'lilyF', cast: false });
      const reeds = scatter(ctx, 18, 0, 200, { avoid: (x, z) => { const d = Math.hypot(x - POND.x, z - POND.z); return d < POND.r - 1.5 || d > POND.r + 2.5; } });
      addInstanced(ctx, geoReeds(), mat, reeds, { name: 'reeds', cast: false });
    },
    weather(ctx) {
      W.leaves(ctx, 170);
      W.pollen(ctx, 300);
    },
  },

  // ======================= 沙漠 =======================
  desert: {
    sky: { top: 0x2a7fd8, horizon: 0xf1d6a4, bottom: 0xe8c890, sunColor: 0xfff1d6, sunDir: [-0.5, 0.7, 0.4], sunSize: 0.06, sunI: 12, glow: 1.1, clouds: 0.18, cloudColor: 0xfff8ee },
    fog: { near: 55, far: 250 },
    light: { hemiSky: 0xfff2de, hemiGround: 0xc89a60, hemi: 1.15, sun: 0xfff0d8, sunI: 3.3, amb: 0xffffff, ambI: 0.08 },
    height(ctx) {
      const n = ctx.noise;
      return (x, z) => {
        const r = Math.hypot(x, z);
        const flat = 0.3 + 0.7 * smooth(5, 28, r);
        const u = x * 0.1 + z * 0.045 + fbm(n, x * 0.012, z * 0.012, 3) * 3.2;
        const dune = Math.pow(0.5 + 0.5 * Math.sin(u), 1.7);
        let h = (dune * 1.6 - 0.5) * flat * (0.6 + 0.4 * fbm(n, x * 0.02 + 7, z * 0.02, 2)) + fbm(n, x * 0.03, z * 0.03, 3) * 0.7 * flat;
        const e = smooth(ARENA_RADIUS + 1, ARENA_RADIUS + 38, r);
        if (e > 0) {
          const u2 = x * 0.035 - z * 0.02 + fbm(n, x * 0.008 + 5, z * 0.008, 3) * 4;
          const big = Math.pow(0.5 + 0.5 * Math.sin(u2), 1.5) * 12 + 8 + fbm(n, x * 0.02 - 30, z * 0.02 + 11, 4) * 8 + smooth(100, 150, r) * 10;
          h = h * (1 - e) + big * e;
        }
        return h;
      };
    },
    ground(ctx) {
      const n = ctx.noise;
      const C = { a: new THREE.Color(0xe2bb7c), b: new THREE.Color(0xd4a466), c: new THREE.Color(0xeccb92), stone: new THREE.Color(0xbf7a48), stone2: new THREE.Color(0xa8653c) };
      return (c, x, y, z, ny, rnd) => {
        if (ny < 0.7) c.copy(C.stone).lerp(C.stone2, rnd);
        else {
          const ripple = 0.5 + 0.5 * Math.sin(x * 0.9 + z * 0.35 + fbm(n, x * 0.04, z * 0.04, 2) * 6);
          const p = fbm(n, x * 0.03 - 9, z * 0.03 + 4, 2) * 0.5 + 0.5;
          c.copy(C.b).lerp(C.a, smooth(0.3, 0.6, p)).lerp(C.c, ripple * 0.45);
        }
        c.multiplyScalar(0.94 + rnd * 0.12);
      };
    },
    decorate(ctx) {
      const q = ctx.hi ? 1 : 0.5;
      const mat = ctx.decoMat;
      // —— 竞技场内拱门（两条腿为障碍）——
      const archIn = [];
      {
        const a = 2.4, r = 40, ry = a + Math.PI / 2 + 0.3;
        const x = Math.cos(a) * r, z = Math.sin(a) * r, s = 0.85;
        const cx = Math.cos(ry), sz = -Math.sin(ry);
        for (const sgn of [-1, 1]) ctx.obstacles.push({ x: x + cx * 7 * s * sgn, z: z + sz * 7 * s * sgn, r: 2.1 * s });
        archIn.push({ x, y: ctx.heightAt(x, z) + 0.6, z, ry, s });
      }
      const ribs = placeSolids(ctx, 1, { s: [1, 1], radius: () => 3.2, rMin: 20, rMax: 42 });
      const cacti = placeSolids(ctx, 10, { s: [0.85, 1.3], radius: (s) => 0.55 * s + 0.35 });
      const boulders = placeSolids(ctx, 7, { s: [1.4, 2.4], radius: (s) => s * 0.95 });
      // —— 边缘 ——
      const mesas = scatter(ctx, Math.round(16 * q + 4), 80, 125, { minDist: 22, s: [0.8, 2.0] });
      const arches = scatter(ctx, 3, 72, 95, { minDist: 30, s: [1.0, 1.5] });
      for (const a of arches) a.y += 1.2;
      archIn.push(...arches);
      cacti.push(...scatter(ctx, Math.round(40 * q), ARENA_RADIUS + 1, 115, { minDist: 6, s: [0.8, 1.5] }));
      boulders.push(...scatter(ctx, Math.round(30 * q), ARENA_RADIUS + 3, 115, { minDist: 7, s: [2.5, 6] }));
      const mesaGeos = [geoMesa(101), geoMesa(202)];
      addInstanced(ctx, mesaGeos[0], mat, sink(mesas.filter((_, i) => i % 2 === 0), 1.2), { name: 'mesaA' });
      addInstanced(ctx, mesaGeos[1], mat, sink(mesas.filter((_, i) => i % 2 === 1), 1.2), { name: 'mesaB' });
      addInstanced(ctx, geoArch(), mat, archIn, { name: 'arches' });
      addInstanced(ctx, geoRibcage(), mat, sink(ribs, 0.2), { name: 'ribcage' });
      addInstanced(ctx, geoSaguaro(), mat, sink(cacti, 0.15), { name: 'cacti' });
      addInstanced(ctx, geoRock(0xc88a58, { seed: 21 }), mat, sink(boulders, 0.25), { name: 'boulders' });
      // —— 小装饰 ——
      addInstanced(ctx, geoPricklyPear(), mat, scatter(ctx, Math.round(30 * q), 8, 70, { solidPad: 1, s: [0.7, 1.2] }), { name: 'pears' });
      addInstanced(ctx, geoShrub(0x9a7a4a), mat, scatter(ctx, Math.round(60 * q), 5, 80, { solidPad: 0.6, s: [0.5, 1.1] }), { name: 'shrubs' });
      addInstanced(ctx, geoSkull(), mat, scatter(ctx, Math.round(14 * q), 10, 70, { solidPad: 1, s: [0.8, 1.4] }), { name: 'skulls', cast: false });
      addInstanced(ctx, geoRock(0xd8a070, { seed: 23 }), mat, scatter(ctx, Math.round(50 * q), 6, 70, { s: [0.25, 0.7], solidPad: 0.4 }), { name: 'pebbles', cast: false });
    },
    weather(ctx) {
      W.sand(ctx, 850);
    },
  },

  // ======================= 雪原 =======================
  frost: {
    sky: { top: 0x6f9fd2, horizon: 0xe2ebf4, bottom: 0xd6e2ee, sunColor: 0xfff4e6, sunDir: [0.65, 0.33, -0.55], sunSize: 0.045, sunI: 7, glow: 0.9, clouds: 0.62, cloudColor: 0xf4f8ff },
    fog: { near: 26, far: 175 },
    light: { hemiSky: 0xe0ecff, hemiGround: 0x8898b0, hemi: 1.35, sun: 0xfff6ea, sunI: 2.3, amb: 0xdfe8ff, ambI: 0.1 },
    height(ctx) {
      const n = ctx.noise;
      return (x, z) => {
        const r = Math.hypot(x, z);
        const flat = 0.35 + 0.65 * smooth(4, 24, r);
        let h = fbm(n, x * 0.024, z * 0.024, 4) * 1.3 * flat + lift(n, x, z, 1.2);
        const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
        h += Math.max(0, 0.3 - h) * smooth(LAKE.r + 8, LAKE.r + 1, dl);
        const lw = smooth(LAKE.r + 4, LAKE.r - 0.5, dl);
        h = h * (1 - lw) + (LAKE.level - 0.06) * lw;
        const e = smooth(ARENA_RADIUS + 1, ARENA_RADIUS + 30, r);
        if (e > 0) {
          const mtn = 18 + ridged(n, x * 0.026 + 3, z * 0.026 - 8, 4) * 30 + fbm(n, x * 0.015, z * 0.015 + 50, 3) * 8 + smooth(95, 150, r) * 18;
          h = h * (1 - e) + mtn * e;
        }
        return h;
      };
    },
    ground(ctx) {
      const n = ctx.noise;
      const C = { snow: new THREE.Color(0xeef4fa), snow2: new THREE.Color(0xdce7f2), blue: new THREE.Color(0xc8dcee), rock: new THREE.Color(0x6a7480), rock2: new THREE.Color(0x8494a4), lake: new THREE.Color(0x9ccbe6) };
      return (c, x, y, z, ny, rnd) => {
        if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 0.5 && y < LAKE.level + 0.05) c.copy(C.lake);
        else if (ny < 0.66) c.copy(C.rock).lerp(C.rock2, rnd);
        else if (ny < 0.8 && y > 6) c.copy(C.rock2).lerp(C.snow2, 0.5);
        else {
          const p = fbm(n, x * 0.04, z * 0.04, 2) * 0.5 + 0.5;
          c.copy(C.snow2).lerp(C.snow, smooth(0.3, 0.6, p)).lerp(C.blue, (1 - ny) * 1.2);
        }
        c.multiplyScalar(0.95 + rnd * 0.08);
      };
    },
    decorate(ctx) {
      const q = ctx.hi ? 1 : 0.5;
      const mat = ctx.decoMat;
      const avoidLake = (x, z) => Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 4;
      const pines = placeSolids(ctx, 11, { s: [0.9, 1.3], radius: (s) => 1.25 * s, avoid: avoidLake });
      const crystals = placeSolids(ctx, 6, { s: [1.0, 1.6], radius: (s) => 1.0 * s + 0.3, avoid: avoidLake });
      const rocks = placeSolids(ctx, 5, { s: [1.4, 2.2], radius: (s) => s * 0.95, avoid: avoidLake });
      pines.push(...scatter(ctx, Math.round(150 * q), ARENA_RADIUS + 1, 122, { minDist: 4.4, s: [1.0, 1.9] }));
      rocks.push(...scatter(ctx, Math.round(28 * q), ARENA_RADIUS + 3, 110, { minDist: 7, s: [2.2, 5.5] }));
      addInstanced(ctx, geoPine(), mat, sink(pines, 0.25), { name: 'pines' });
      addInstanced(ctx, geoCapRock(0x6e7886, 0xf2f6fa), mat, sink(rocks, 0.25), { name: 'rocks' });
      const iceMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.12, metalness: 0.1, emissive: 0x3a8ad8, emissiveIntensity: 0.55 });
      crystals.push(...scatter(ctx, Math.round(24 * q), ARENA_RADIUS + 1.5, 100, { minDist: 8, s: [1.4, 3.2] }));
      addInstanced(ctx, geoIceCluster(), iceMat, sink(crystals, 0.2), { name: 'iceCrystals' });
      // 冰崖
      const spires = scatter(ctx, Math.round(80 * q), ARENA_RADIUS + 3, 92, { minDist: 4 });
      for (const sp of spires) { sp.sy = 7 + ctx.rand() * 16; sp.sx = sp.sz = 1.2 + ctx.rand() * 1.4; sp.s = 1; sp.y -= 1; }
      const spireMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.3, metalness: 0.05, emissive: 0x16304a, emissiveIntensity: 0.4 });
      addInstanced(ctx, geoIceSpire(61), spireMat, spires.filter((_, i) => i % 2 === 0), { name: 'iceSpiresA' });
      addInstanced(ctx, geoIceSpire(62), spireMat, spires.filter((_, i) => i % 2 === 1), { name: 'iceSpiresB' });
      // 雪堆 / 小冰晶
      addInstanced(ctx, geoDrift(), mat, sink(scatter(ctx, Math.round(40 * q), 8, 80, { solidPad: 1, avoid: avoidLake, s: [0.6, 1.4] }), 0.35), { name: 'drifts', cast: false });
      addInstanced(ctx, geoIceCluster(), iceMat, sink(scatter(ctx, Math.round(30 * q), 8, 60, { solidPad: 1, avoid: avoidLake, s: [0.3, 0.55] }), 0.2), { name: 'iceSmall', cast: false });
      addInstanced(ctx, geoCapRock(0x7a8490, 0xf2f6fa, 9), mat, scatter(ctx, Math.round(30 * q), 6, 70, { solidPad: 0.6, s: [0.3, 0.7] }), { name: 'pebbles', cast: false });
      // 冰湖
      const ig = new THREE.CircleGeometry(LAKE.r + 2.5, 48);
      ig.rotateX(-Math.PI / 2);
      const ice = new THREE.Mesh(ig, new THREE.MeshStandardMaterial({ color: 0xcdeeff, roughness: 0.05, metalness: 0.35, transparent: true, opacity: 0.82 }));
      ice.position.set(LAKE.x, LAKE.level + 0.02, LAKE.z);
      ice.receiveShadow = true;
      ice.name = 'frozenLake';
      ctx.root.add(ice);
      const cracks = crackPaths(ctx.rand, 9, 0, LAKE.r - 2, { segs: [5, 10], step: 1.2, width: [0.05, 0.1] }).map((p) => {
        const q2 = p.map(([x, z]) => [x + LAKE.x, z + LAKE.z]);
        q2.width = p.width;
        return q2;
      });
      const cg = ribbonGeometry(ctx, cracks, { fixedY: LAKE.level + 0.045, taper: true });
      const cm = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.5, 1.7), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      cm.name = 'iceCracks';
      ctx.root.add(cm);
    },
    weather(ctx) {
      W.snow(ctx, 1500);
    },
  },

  // ======================= 沼泽 =======================
  swamp: {
    sky: { top: 0x354638, horizon: 0x8c9a70, bottom: 0x7a8a60, sunColor: 0xe8e8b0, sunDir: [0.25, 0.5, 0.6], sunSize: 0.05, sunI: 4, glow: 0.6, clouds: 0.55, cloudColor: 0x9aa888 },
    fog: { density: 0.0135 },
    light: { hemiSky: 0xb8c89a, hemiGround: 0x2a331c, hemi: 0.95, sun: 0xe6e8b8, sunI: 1.8, amb: 0x5a7a4a, ambI: 0.15 },
    height(ctx) {
      const n = ctx.noise;
      return (x, z) => {
        const r = Math.hypot(x, z);
        let h = fbm(n, x * 0.03, z * 0.03, 4) * 1.25 + fbm(n, x * 0.09 + 3, z * 0.09 - 2, 2) * 0.3 + 0.12;
        h += 0.55 * smooth(20, 6, r);      // 中央干燥高地（首领战）
        h = h * (0.55 + 0.45 * smooth(0, 20, r)) + 0.2 * smooth(20, 0, r);
        const e = smooth(ARENA_RADIUS + 2, ARENA_RADIUS + 32, r);
        if (e > 0) {
          const hill = 7 + fbm(n, x * 0.02 + 20, z * 0.02 - 4, 4) * 6 + ridged(n, x * 0.035, z * 0.035, 3) * 6 + smooth(100, 150, r) * 10;
          h = h * (1 - e) + hill * e;
        }
        return h;
      };
    },
    ground(ctx) {
      const n = ctx.noise;
      const C = { mud: new THREE.Color(0x4a4028), wet: new THREE.Color(0x2e2c1c), moss: new THREE.Color(0x4f6a2a), moss2: new THREE.Color(0x3e5a24), rock: new THREE.Color(0x4a4a3e) };
      return (c, x, y, z, ny, rnd) => {
        if (y < SWAMP_WATER - 0.05) c.copy(C.wet);
        else if (y < SWAMP_WATER + 0.25) c.copy(C.mud).lerp(C.wet, rnd * 0.4);
        else if (ny < 0.72) c.copy(C.rock).lerp(C.moss2, rnd * 0.5);
        else {
          const p = fbm(n, x * 0.05 + 1, z * 0.05 + 8, 2) * 0.5 + 0.5;
          c.copy(C.moss2).lerp(C.moss, smooth(0.3, 0.65, p)).lerp(C.mud, smooth(0.7, 0.9, p) * 0.6);
        }
        c.multiplyScalar(0.9 + rnd * 0.18);
      };
    },
    decorate(ctx) {
      const q = ctx.hi ? 1 : 0.5;
      const mat = ctx.decoMat;
      const wet = (x, z) => ctx.heightAt(x, z) < SWAMP_WATER + 0.12;
      const trees = placeSolids(ctx, 10, { s: [1.0, 1.5], radius: (s) => 0.45 * s + 0.3, avoid: wet });
      const mushSolid = placeSolids(ctx, 8, { s: [0.9, 1.3], radius: (s) => 0.5 * s + 0.35, avoid: wet });
      const rocks = placeSolids(ctx, 3, { s: [1.4, 2.0], radius: (s) => s * 0.95, avoid: wet });
      trees.push(...scatter(ctx, Math.round(120 * q), ARENA_RADIUS + 1, 120, { minDist: 4.2, s: [1.1, 2.1] }));
      const treeA = trees.filter((_, i) => i % 2 === 0), treeB = trees.filter((_, i) => i % 2 === 1);
      addInstanced(ctx, geoDeadTree(7), mat, sink(treeA, 0.1), { name: 'deadTreesA' });
      addInstanced(ctx, geoDeadTree(19), mat, sink(treeB, 0.1), { name: 'deadTreesB' });
      rocks.push(...scatter(ctx, Math.round(20 * q), ARENA_RADIUS + 3, 110, { minDist: 7, s: [2, 4.5] }));
      addInstanced(ctx, geoRock(0x55574a, { seed: 31 }), mat, sink(rocks, 0.3), { name: 'rocks' });
      // 蘑菇：普通 + 发光
      const mushRim = scatter(ctx, Math.round(44 * q), ARENA_RADIUS + 1, 112, { minDist: 5, s: [1.0, 2.2] });
      const mushSmall = scatter(ctx, Math.round(36 * q), 8, 60, { solidPad: 1, avoid: wet, s: [0.3, 0.55] });
      const all = [...mushSolid, ...mushRim, ...mushSmall];
      const glowList = all.filter((_, i) => i % 3 === 1);
      const normList = all.filter((_, i) => i % 3 !== 1);
      addInstanced(ctx, geoMushStem(), mat, sink(all.map((m) => ({ ...m })), 0.1), { name: 'mushStems' });
      addInstanced(ctx, geoMushCap(0xa03a4a, 0xf4ead8), mat, sink(normList.map((m) => ({ ...m })), 0.1), { name: 'mushCaps' });
      const glowMat = new THREE.MeshStandardMaterial({ color: 0x3affd0, emissive: 0x20ffc8, emissiveIntensity: 1.7, roughness: 0.5, flatShading: true });
      ctx.pulse.push({ mat: glowMat, base: 1.7, amp: 0.5, speed: 1.3 });
      addInstanced(ctx, geoMushCap(0x3affd0, 0xc8fff0), glowMat, sink(glowList.map((m) => ({ ...m })), 0.1), { name: 'mushGlow' });
      // 水面装饰
      const pads = scatter(ctx, Math.round(80 * q), 4, 62, { avoid: (x, z) => ctx.heightAt(x, z) > SWAMP_WATER - 0.2, s: [0.7, 1.4] });
      for (const p of pads) p.y = SWAMP_WATER + 0.03;
      addInstanced(ctx, geoLily(false), mat, pads.filter((_, i) => i % 4 !== 0), { name: 'lily', cast: false });
      addInstanced(ctx, geoLily(true), mat, pads.filter((_, i) => i % 4 === 0), { name: 'lilyF', cast: false });
      const reeds = scatter(ctx, Math.round(150 * q), 4, 70, { avoid: (x, z) => { const h = ctx.heightAt(x, z); return h < SWAMP_WATER - 0.35 || h > SWAMP_WATER + 0.35; }, solidPad: 0.5, s: [0.8, 1.3] });
      addInstanced(ctx, geoReeds(), mat, reeds, { name: 'reeds', cast: false });
      addInstanced(ctx, geoGrass(0x4a5a2a, 0x5a6a30), mat, scatter(ctx, Math.round(300 * q), 3, 75, { avoid: wet, s: [0.8, 1.4] }), { name: 'grass', cast: false });
      // 沼泽水面
      const wg = new THREE.PlaneGeometry(SIZE, SIZE, ctx.hi ? 72 : 40, ctx.hi ? 72 : 40);
      wg.rotateX(-Math.PI / 2);
      const water = new THREE.Mesh(wg, waterMaterial(ctx, 0x3e5230, 0.86, 0.04));
      water.position.y = SWAMP_WATER;
      water.receiveShadow = true;
      water.name = 'swampWater';
      ctx.root.add(water);
    },
    weather(ctx) {
      W.fireflies(ctx, 240);
      W.mist(ctx, 70, [0.75, 0.82, 0.66], 0.14);
    },
  },

  // ======================= 火山 =======================
  volcano: {
    sky: { top: 0x160a0c, horizon: 0x8a3418, bottom: 0x5a2010, sunColor: 0xff8a50, sunDir: [-0.35, 0.3, -0.75], sunSize: 0.07, sunI: 5, glow: 1.2, clouds: 0.52, cloudColor: 0x3a2020, stars: 0.35 },
    fog: { near: 35, far: 230 },
    light: { hemiSky: 0xffa880, hemiGround: 0x3a1a14, hemi: 1.1, sun: 0xffa070, sunI: 2.6, amb: 0x5a2a1a, ambI: 0.28 },
    height(ctx) {
      const n = ctx.noise;
      return (x, z) => {
        const r = Math.hypot(x, z);
        const flat = 0.35 + 0.65 * smooth(4, 24, r);
        let h = fbm(n, x * 0.025, z * 0.025, 4) * 1.4 * flat + lift(n, x, z, 1.5) + 0.3;
        const e = smooth(ARENA_RADIUS + 10, ARENA_RADIUS + 28, r);
        if (e > 0) {
          const cliff = 18 + ridged(n, x * 0.03 + 5, z * 0.03 + 9, 4) * 24 + fbm(n, x * 0.02, z * 0.02 - 30, 3) * 6 + smooth(100, 150, r) * 14;
          h = h * (1 - e) + cliff * e;
        }
        // 熔岩护城河
        const m = smooth(ARENA_RADIUS + 1, ARENA_RADIUS + 4, r) * smooth(ARENA_RADIUS + 14, ARENA_RADIUS + 10, r);
        h = h * (1 - m) + (LAVA_Y - 1.4) * m;
        return h;
      };
    },
    ground(ctx) {
      const n = ctx.noise;
      const C = { ash: new THREE.Color(0x2e2926), ash2: new THREE.Color(0x3c3430), rock: new THREE.Color(0x1d1b20), red: new THREE.Color(0x4a2418), scorch: new THREE.Color(0x6a3018) };
      return (c, x, y, z, ny, rnd) => {
        const r = Math.hypot(x, z);
        if (y < LAVA_Y + 0.6 && r > ARENA_RADIUS) c.copy(C.scorch).lerp(C.red, rnd);
        else if (ny < 0.7) c.copy(C.rock).lerp(C.red, rnd * 0.35);
        else {
          const p = fbm(n, x * 0.05 - 3, z * 0.05 + 6, 2) * 0.5 + 0.5;
          c.copy(C.ash).lerp(C.ash2, smooth(0.35, 0.7, p)).lerp(C.red, smooth(0.75, 0.95, p) * 0.7);
          if (r > ARENA_RADIUS - 4 && r < ARENA_RADIUS + 2) c.lerp(C.scorch, 0.5);
        }
        c.multiplyScalar(0.9 + rnd * 0.2);
      };
    },
    decorate(ctx) {
      const q = ctx.hi ? 1 : 0.5;
      const mat = ctx.decoMat;
      const obsMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.22, metalness: 0.35 });
      const shards = placeSolids(ctx, 12, { s: [1.0, 1.6], radius: (s) => 1.25 * s + 0.2 });
      const trees = placeSolids(ctx, 8, { s: [1.0, 1.4], radius: (s) => 0.45 * s + 0.3 });
      shards.push(...scatter(ctx, Math.round(60 * q), ARENA_RADIUS + 12, 120, { minDist: 6, s: [2.0, 4.5] }));
      trees.push(...scatter(ctx, Math.round(50 * q), ARENA_RADIUS + 12, 118, { minDist: 6, s: [1.1, 1.8] }));
      addInstanced(ctx, geoShardCluster(301, 0x221c2a), obsMat, sink(shards.filter((_, i) => i % 2 === 0), 0.15), { name: 'obsidianA' });
      addInstanced(ctx, geoShardCluster(302, 0x1a1620), obsMat, sink(shards.filter((_, i) => i % 2 === 1), 0.15), { name: 'obsidianB' });
      addInstanced(ctx, geoDeadTree(41, 0x1c1816, 0, { mossy: false, branches: 3 }), mat, sink(trees, 0.1), { name: 'charredTrees' });
      addInstanced(ctx, geoRock(0x3a302c, { seed: 51 }), mat, scatter(ctx, Math.round(60 * q), 6, 60, { solidPad: 0.5, s: [0.3, 0.8] }), { name: 'pebbles', cast: false });
      addInstanced(ctx, geoRock(0x2a2426, { seed: 52 }), mat, sink(scatter(ctx, Math.round(24 * q), ARENA_RADIUS - 6, ARENA_RADIUS - 1, { s: [0.4, 0.9] }), 0.3), { name: 'rimRocks', cast: false });
      // 熔岩护城河
      const lg = new THREE.RingGeometry(ARENA_RADIUS - 2, ARENA_RADIUS + 24, 128, 3);
      lg.rotateX(-Math.PI / 2);
      const lava = new THREE.Mesh(lg, lavaMaterial(ctx));
      lava.position.y = LAVA_Y;
      lava.name = 'lavaMoat';
      ctx.root.add(lava);
      // 地面熔岩裂纹
      const paths = crackPaths(ctx.rand, Math.round(26 * (ctx.hi ? 1 : 0.7)), 8, ARENA_RADIUS - 2, { segs: [7, 14], step: 0.95, width: [0.16, 0.34], branch: 0.5, avoid: (x, z) => nearSolid(ctx, x, z, 1) });
      for (let k = 0; k < 16; k++) {  // 从护城河向内延伸的裂纹
        const a = (k / 16) * TAU + ctx.rand() * 0.3;
        let x = Math.cos(a) * (ARENA_RADIUS + 0.5), z = Math.sin(a) * (ARENA_RADIUS + 0.5), ang = a + Math.PI;
        const p = [[x, z]];
        for (let i = 0; i < 9; i++) { ang += (ctx.rand() - 0.5) * 0.8; x += Math.cos(ang) * 0.9; z += Math.sin(ang) * 0.9; p.push([x, z]); }
        p.width = 0.35;
        paths.push(p);
      }
      const crackMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.85, 0.15), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const cracks = new THREE.Mesh(ribbonGeometry(ctx, paths, { yOff: 0.05 }), crackMat);
      cracks.name = 'lavaCracks';
      ctx.root.add(cracks);
      ctx.updaters.push((dt, t) => {
        const k = 0.75 + 0.25 * Math.sin(t * 1.6) + 0.08 * Math.sin(t * 7.3);
        crackMat.color.setRGB(3.0 * k, 0.85 * k, 0.15 * k);
      });
      buildDistantVolcano(ctx);
    },
    weather(ctx) {
      W.embers(ctx, 560);
      W.ash(ctx, 420);
    },
  },

  // ======================= 暗影 =======================
  shadow: {
    sky: { top: 0x07041a, horizon: 0x35275a, bottom: 0x241a40, sunColor: 0xd8d0ff, sunDir: [0.3, 0.36, -0.82], sunSize: 0.17, sunI: 3.2, glow: 1.4, moon: 1, clouds: 0.24, cloudColor: 0x2a2045, stars: 1 },
    fog: { near: 30, far: 200 },
    light: { hemiSky: 0x8a7ad8, hemiGround: 0x2a1c40, hemi: 1.35, sun: 0xc8c0ff, sunI: 2.5, amb: 0x4a3a7a, ambI: 0.4 },
    height(ctx) {
      const n = ctx.noise;
      return (x, z) => {
        const r = Math.hypot(x, z);
        let h = fbm(n, x * 0.022, z * 0.022, 4) * 0.9 * smooth(8, 30, r) + lift(n, x, z, 0.6) * smooth(6, 16, r);
        const e = smooth(ARENA_RADIUS + 10, ARENA_RADIUS + 30, r);
        if (e > 0) {
          const cliff = 14 + ridged(n, x * 0.03 - 12, z * 0.03 + 3, 4) * 20 + fbm(n, x * 0.02 + 8, z * 0.02, 3) * 6 + smooth(100, 150, r) * 14;
          h = h * (1 - e) + cliff * e;
        }
        // 深渊裂谷
        const m = smooth(ARENA_RADIUS + 1.5, ARENA_RADIUS + 5, r) * smooth(ARENA_RADIUS + 15, ARENA_RADIUS + 11, r);
        h = h * (1 - m) - 14 * m;
        return h;
      };
    },
    ground(ctx) {
      const n = ctx.noise;
      const C = { a: new THREE.Color(0x2a2834), b: new THREE.Color(0x34303e), p: new THREE.Color(0x3a2a4a), dark: new THREE.Color(0x1a1822), vein: new THREE.Color(0x5a2a8a) };
      return (c, x, y, z, ny, rnd) => {
        const r = Math.hypot(x, z);
        if (y < -3) c.copy(C.dark).lerp(C.p, smooth(-14, -4, y) * 0.5);
        else if (ny < 0.7) c.copy(C.dark).lerp(C.a, rnd);
        else {
          // 石板广场感：棋盘格明暗
          const tile = ((Math.floor(x / 3.2) + Math.floor(z / 3.2)) & 1) ? 1 : 0.9;
          const p = fbm(n, x * 0.04, z * 0.04, 2) * 0.5 + 0.5;
          c.copy(C.a).lerp(C.b, smooth(0.3, 0.6, p)).lerp(C.p, smooth(0.65, 0.9, p) * 0.7);
          if (r < ARENA_RADIUS - 2) c.multiplyScalar(tile);
          if (rnd > 0.975) c.copy(C.vein);
        }
        c.multiplyScalar(0.92 + rnd * 0.16);
      };
    },
    decorate(ctx) {
      const q = ctx.hi ? 1 : 0.5;
      const mat = ctx.decoMat;
      const rand = ctx.rand;
      const pillarsTall = placeSolids(ctx, 6, { s: [0.9, 1.15], radius: (s) => 1.1 * s + 0.15 });
      const pillarsBroken = placeSolids(ctx, 6, { s: [0.9, 1.2], radius: (s) => 1.1 * s + 0.15 });
      const crystalRocks = placeSolids(ctx, 4, { s: [1.0, 1.4], radius: (s) => 1.3 * s + 0.2 });
      // 外圈柱子
      pillarsTall.push(...scatter(ctx, Math.round(18 * q), ARENA_RADIUS + 16, 100, { minDist: 9, s: [1.2, 2.2] }));
      pillarsBroken.push(...scatter(ctx, Math.round(18 * q), ARENA_RADIUS + 16, 100, { minDist: 9, s: [1.2, 2.2] }));
      addInstanced(ctx, geoPillar(false, 1), mat, sink(pillarsTall, 0.1), { name: 'pillars' });
      addInstanced(ctx, geoPillar(true, 2), mat, sink(pillarsBroken, 0.1), { name: 'pillarsBroken' });
      // 发光水晶簇（地面）
      const crystMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.2, metalness: 0.2, emissive: 0x9a3aff, emissiveIntensity: 1.6 });
      ctx.pulse.push({ mat: crystMat, base: 1.6, amp: 0.5, speed: 1.1 });
      crystalRocks.push(...scatter(ctx, Math.round(20 * q), ARENA_RADIUS + 14, 110, { minDist: 9, s: [1.5, 3] }));
      addInstanced(ctx, geoShardCluster(411, 0x6a3a9a), crystMat, sink(crystalRocks, 0.15), { name: 'crystalRocks' });
      // 断墙
      const walls = [];
      for (let k = 0; k < Math.round(14 * (ctx.hi ? 1 : 0.7)); k++) {
        const a = (k / 14) * TAU + rand() * 0.2, r = ARENA_RADIUS + 17 + rand() * 6;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        walls.push({ x, y: ctx.heightAt(x, z) - 0.2, z, ry: -a + Math.PI / 2, s: 1 + rand() * 0.4 });
      }
      addInstanced(ctx, geoWall(501), mat, walls.filter((_, i) => i % 2 === 0), { name: 'wallsA' });
      addInstanced(ctx, geoWall(502), mat, walls.filter((_, i) => i % 2 === 1), { name: 'wallsB' });
      // 尖塔
      const spires = scatter(ctx, Math.round(70 * q), ARENA_RADIUS + 20, 125, { minDist: 5 });
      for (const sp of spires) { sp.sy = 14 + rand() * 30; sp.sx = sp.sz = 2 + rand() * 2.5; sp.s = 1; sp.y -= 1; }
      addInstanced(ctx, geoSpire(601), mat, spires.filter((_, i) => i % 2 === 0), { name: 'spiresA' });
      addInstanced(ctx, geoSpire(602), mat, spires.filter((_, i) => i % 2 === 1), { name: 'spiresB' });
      // 旗帜（竞技场边缘一圈）
      const banners = [];
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * TAU + Math.PI / 16, r = ARENA_RADIUS + 0.8;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        banners.push({ x, y: ctx.heightAt(x, z) - 0.2, z, ry: -a + Math.PI / 2 });
      }
      addInstanced(ctx, geoBannerPole(), mat, banners, { name: 'bannerPoles' });
      const clothGeo = new THREE.PlaneGeometry(1.5, 3.6, 1, 8);
      clothGeo.translate(0, -1.8, 0);
      const cloth = banners.map((b) => ({ x: b.x, y: b.y + 5.9, z: b.z, ry: b.ry }));
      addInstanced(ctx, clothGeo.clone(), bannerMaterial(ctx, 0x5a1426), cloth.filter((_, i) => i % 2 === 0), { name: 'bannersRed' });
      addInstanced(ctx, clothGeo, bannerMaterial(ctx, 0x2e1450), cloth.filter((_, i) => i % 2 === 1), { name: 'bannersPurple' });
      // 小碎石
      addInstanced(ctx, geoRock(0x3a3646, { seed: 71 }), mat, scatter(ctx, Math.round(50 * q), 6, 60, { solidPad: 0.5, s: [0.25, 0.7] }), { name: 'rubble', cast: false });
      // 漂浮水晶（动画）
      const floatGeo = merge([part(new THREE.OctahedronGeometry(1, 0), 0xc080ff)]);
      const floatMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.15, metalness: 0.2, emissive: 0xb04aff, emissiveIntensity: 2.4 });
      const floats = [];
      const fl = [...scatter(ctx, Math.round(14 * q + 4), 18, 58, { solidPad: 2 }), ...scatter(ctx, Math.round(24 * q), ARENA_RADIUS + 4, 110, { minDist: 8 })];
      for (const f of fl) floats.push({ x: f.x, z: f.z, base: f.y + 4 + rand() * 8, s: 0.5 + rand() * 0.9, ph: rand() * TAU, spin: 0.3 + rand() * 0.8 });
      const fmesh = new THREE.InstancedMesh(floatGeo, floatMat, floats.length);
      fmesh.name = 'floatingCrystals';
      fmesh.castShadow = true;
      ctx.root.add(fmesh);
      const place = (t) => {
        for (let i = 0; i < floats.length; i++) {
          const f = floats[i];
          _e.set(0.25 * Math.sin(t * 0.5 + f.ph), t * f.spin + f.ph, 0.2 * Math.cos(t * 0.4 + f.ph), 'YXZ');
          _q.setFromEuler(_e);
          _v1.set(f.x, f.base + Math.sin(t * 0.9 + f.ph) * 0.8, f.z);
          _v2.set(0.7 * f.s, 2.0 * f.s, 0.7 * f.s);
          _m4.compose(_v1, _q, _v2);
          fmesh.setMatrixAt(i, _m4);
        }
        fmesh.instanceMatrix.needsUpdate = true;
      };
      place(0);
      fmesh.computeBoundingSphere();
      fmesh.boundingSphere.radius += 3;
      ctx.updaters.push((dt, t) => place(t));
      // 中央符文法阵
      buildRuneCircle(ctx);
      // 深渊辉光
      const ag = new THREE.RingGeometry(ARENA_RADIUS, ARENA_RADIUS + 17, 128, 1);
      ag.rotateX(-Math.PI / 2);
      const abyssMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.14, 1.1), transparent: true, opacity: 0.85 });
      const abyss = new THREE.Mesh(ag, abyssMat);
      abyss.position.y = -9;
      abyss.name = 'abyssGlow';
      ctx.root.add(abyss);
      ctx.updaters.push((dt, t) => { const k = 0.8 + 0.2 * Math.sin(t * 0.9); abyssMat.color.setRGB(0.55 * k, 0.14 * k, 1.1 * k); });
      buildCitadel(ctx);
    },
    weather(ctx) {
      W.motes(ctx, 500);
      W.mist(ctx, 40, [0.35, 0.25, 0.55], 0.12);
    },
  },
};

// ---------------------------------------------------------------------
//  远景：火山（带烟柱 & 周期喷发）
// ---------------------------------------------------------------------
function buildDistantVolcano(ctx) {
  const top = 88, base = -8;
  const g = new THREE.CylinderGeometry(13, 105, top, 14, 6, true);
  g.translate(0, top / 2, 0);
  jitter(g, 0.1, 911, 'xz');
  const coneGeo = merge([part(g, 0xffffff)]);
  gradientY(coneGeo, 0x3a2622, 0x160f10, 0, top);
  const cone = new THREE.Mesh(coneGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, fog: false }));
  cone.position.set(VOLCANO.x, base, VOLCANO.z);
  cone.name = 'volcanoCone';
  ctx.root.add(cone);
  const crater = new THREE.Mesh(new THREE.CircleGeometry(12.5, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.1, 0.25), fog: false }));
  crater.position.set(VOLCANO.x, base + top - 2.5, VOLCANO.z);
  ctx.root.add(crater);
  // 熔岩流淌（沿锥面）
  const streams = [];
  const rr = mulberry32(912);
  for (let k = 0; k < 7; k++) {
    let a = rr() * TAU;
    const path = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const y = top * (1 - t * 0.72);
      const R = lerp(13, 105, 1 - y / top) + 0.8;
      a += (rr() - 0.5) * 0.05;
      path.push([Math.cos(a) * R, Math.sin(a) * R, y]);
    }
    streams.push(path);
  }
  const pos = [];
  for (const p of streams) {
    for (let i = 0; i < p.length - 1; i++) {
      const [x0, z0, y0] = p[i], [x1, z1, y1] = p[i + 1];
      const w0 = 1.6 + i * 0.25, w1 = 1.6 + (i + 1) * 0.25;
      const n0x = -z0 / Math.hypot(x0, z0), n0z = x0 / Math.hypot(x0, z0);
      const n1x = -z1 / Math.hypot(x1, z1), n1z = x1 / Math.hypot(x1, z1);
      const A = [x0 + n0x * w0, y0, z0 + n0z * w0], B = [x0 - n0x * w0, y0, z0 - n0z * w0];
      const C = [x1 + n1x * w1, y1, z1 + n1z * w1], D = [x1 - n1x * w1, y1, z1 - n1z * w1];
      pos.push(...A, ...C, ...D, ...A, ...D, ...B);
    }
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sg.computeVertexNormals();
  const streamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.7, 0.12), fog: false, side: THREE.DoubleSide });
  const stream = new THREE.Mesh(sg, streamMat);
  stream.position.set(VOLCANO.x, base, VOLCANO.z);
  stream.name = 'volcanoLava';
  ctx.root.add(stream);
  // 火山口辉光
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctx.sprite, color: new THREE.Color(2.2, 0.7, 0.2), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
  glow.scale.set(80, 60, 1);
  glow.position.set(VOLCANO.x, base + top + 6, VOLCANO.z);
  ctx.root.add(glow);
  const cx = VOLCANO.x, cy = base + top, cz = VOLCANO.z;
  // 烟柱
  const SN = ctx.hi ? 150 : 80;
  const sp = new Float32Array(SN * 3), sc = new Float32Array(SN * 3), sv = new Float32Array(SN * 3);
  const r = mulberry32(913);
  const resetSmoke = (i, spread) => {
    sp[i * 3] = cx + (r() - 0.5) * 10; sp[i * 3 + 1] = cy + (spread ? r() * 110 : 0); sp[i * 3 + 2] = cz + (r() - 0.5) * 10;
    sv[i * 3] = (r() - 0.5) * 2 - 2.5; sv[i * 3 + 1] = 5 + r() * 5; sv[i * 3 + 2] = (r() - 0.5) * 2 + 1.5;
    if (spread) { const k = (sp[i * 3 + 1] - cy) / 8; sp[i * 3] += sv[i * 3] * k; sp[i * 3 + 2] += sv[i * 3 + 2] * k; }
    const b = 0.1 + r() * 0.08;
    sc[i * 3] = b * 1.1; sc[i * 3 + 1] = b * 0.95; sc[i * 3 + 2] = b * 0.9;
  };
  for (let i = 0; i < SN; i++) resetSmoke(i, true);
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3).setUsage(THREE.DynamicDrawUsage));
  smokeGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const smoke = new THREE.Points(smokeGeo, new THREE.PointsMaterial({ size: 30, map: ctx.sprite, transparent: true, opacity: 0.6, depthWrite: false, vertexColors: true, fog: false }));
  smoke.frustumCulled = false;
  smoke.name = 'volcanoSmoke';
  ctx.root.add(smoke);
  // 喷发熔岩弹
  const EN = ctx.hi ? 90 : 50;
  const ep = new Float32Array(EN * 3).fill(-1000), ev = new Float32Array(EN * 3), ec = new Float32Array(EN * 3);
  for (let i = 0; i < EN; i++) { ec[i * 3] = 3.2; ec[i * 3 + 1] = 1.0; ec[i * 3 + 2] = 0.2; }
  const eGeo = new THREE.BufferGeometry();
  eGeo.setAttribute('position', new THREE.BufferAttribute(ep, 3).setUsage(THREE.DynamicDrawUsage));
  eGeo.setAttribute('color', new THREE.BufferAttribute(ec, 3));
  const erupt = new THREE.Points(eGeo, new THREE.PointsMaterial({ size: 4, map: ctx.sprite, transparent: true, depthWrite: false, vertexColors: true, blending: THREE.AdditiveBlending, fog: false }));
  erupt.frustumCulled = false;
  erupt.name = 'volcanoEruption';
  ctx.root.add(erupt);
  let next = 3;
  ctx.updaters.push((dt, t) => {
    for (let i = 0; i < SN; i++) {
      const k = i * 3;
      sp[k] += sv[k] * dt; sp[k + 1] += sv[k + 1] * dt; sp[k + 2] += sv[k + 2] * dt;
      if (sp[k + 1] > cy + 115) resetSmoke(i, false);
    }
    smokeGeo.attributes.position.needsUpdate = true;
    next -= dt;
    if (next <= 0) {
      next = 5 + r() * 5;
      for (let i = 0; i < EN; i++) {
        const k = i * 3, a = r() * TAU, s = 6 + r() * 14;
        ep[k] = cx; ep[k + 1] = cy; ep[k + 2] = cz;
        ev[k] = Math.cos(a) * s; ev[k + 1] = 22 + r() * 26; ev[k + 2] = Math.sin(a) * s;
      }
      glow.material.color.setRGB(4.5, 1.4, 0.4);
    }
    for (let i = 0; i < EN; i++) {
      const k = i * 3;
      if (ep[k + 1] < -500) continue;
      ev[k + 1] -= 16 * dt;
      ep[k] += ev[k] * dt; ep[k + 1] += ev[k + 1] * dt; ep[k + 2] += ev[k + 2] * dt;
      if (ep[k + 1] < cy - 70) ep[k + 1] = -1000;
    }
    eGeo.attributes.position.needsUpdate = true;
    const c = glow.material.color;
    c.r += (2.2 + 0.2 * Math.sin(t * 2) - c.r) * Math.min(1, dt * 1.5);
    c.g += (0.7 - c.g) * Math.min(1, dt * 1.5);
    c.b += (0.2 - c.b) * Math.min(1, dt * 1.5);
  });
}

// ---------------------------------------------------------------------
//  远景：暗影城堡剪影
// ---------------------------------------------------------------------
function buildCitadel(ctx) {
  const r = mulberry32(777);
  const P = [], Wn = [];
  const cx = -150, cz = -175;
  const towers = [[0, 0, 16, 95], [-26, 8, 11, 70], [24, 6, 12, 76], [-46, 18, 9, 52], [44, 16, 9, 58], [-12, -12, 8, 62], [12, -14, 8, 66]];
  for (const [dx, dz, w, h] of towers) {
    P.push(part(new THREE.BoxGeometry(w, h, w), 0x0f0b18, T(dx, h / 2, dz)));
    P.push(part(new THREE.ConeGeometry(w * 0.78, h * 0.38, 4), 0x0b0812, T(dx, h + h * 0.19, dz, 0, Math.PI / 4, 0)));
    for (let k = 0; k < 6; k++) {
      const wy = h * (0.35 + r() * 0.55), side = Math.floor(r() * 4);
      const off = (r() - 0.5) * w * 0.6;
      const pos = [[off, wy, w / 2 + 0.1], [off, wy, -w / 2 - 0.1], [w / 2 + 0.1, wy, off], [-w / 2 - 0.1, wy, off]][side];
      Wn.push(part(new THREE.BoxGeometry(side < 2 ? 1.2 : 0.2, 2.0, side < 2 ? 0.2 : 1.2), 0xffffff, T(dx + pos[0], pos[1], dz + pos[2])));
    }
  }
  P.push(part(new THREE.BoxGeometry(110, 22, 10), 0x100c1a, T(0, 11, 14)));
  const m = new THREE.Mesh(merge(P), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, fog: false }));
  m.position.set(cx, -6, cz);
  m.rotation.y = 0.6;
  m.name = 'citadel';
  ctx.root.add(m);
  const wm = new THREE.Mesh(merge(Wn), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.9, 3.2), fog: false }));
  wm.position.copy(m.position);
  wm.rotation.copy(m.rotation);
  wm.name = 'citadelWindows';
  ctx.root.add(wm);
}

// ---------------------------------------------------------------------
//  中央符文法阵（贴合地形）
// ---------------------------------------------------------------------
function buildRuneCircle(ctx) {
  const paths = [];
  const ring = (R, n) => { const p = []; for (let i = 0; i <= n; i++) { const a = (i / n) * TAU; p.push([Math.cos(a) * R, Math.sin(a) * R]); } return p; };
  const r1 = ring(10.6, 96); r1.width = 0.28; paths.push(r1);
  const r2 = ring(9.4, 96); r2.width = 0.12; paths.push(r2);
  const r3 = ring(5.2, 64); r3.width = 0.18; paths.push(r3);
  // 六芒星
  for (let s = 0; s < 2; s++) {
    const pts = [];
    for (let i = 0; i <= 3; i++) { const a = s * Math.PI / 3 + (i / 3) * TAU + Math.PI / 2; pts.push([Math.cos(a) * 9.4, Math.sin(a) * 9.4]); }
    for (let i = 0; i < 3; i++) {
      const seg = [];
      for (let k = 0; k <= 12; k++) seg.push([lerp(pts[i][0], pts[i + 1][0], k / 12), lerp(pts[i][1], pts[i + 1][1], k / 12)]);
      seg.width = 0.12;
      paths.push(seg);
    }
  }
  // 符文刻度
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    const seg = [[Math.cos(a) * 9.6, Math.sin(a) * 9.6], [Math.cos(a) * 10.4, Math.sin(a) * 10.4]];
    seg.width = 0.16;
    paths.push(seg);
  }
  const g = ribbonGeometry(ctx, paths, { yOff: 0.07, taper: false });
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.5, 3.0), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'runeCircle';
  mesh.renderOrder = 1;
  ctx.root.add(mesh);
  ctx.updaters.push((dt, t) => { mat.opacity = 0.45 + 0.2 * Math.sin(t * 1.5); });
}

// ---------------------------------------------------------------------
//  入口
// ---------------------------------------------------------------------
export const BIOME_IDS = Object.keys(BIOMES);

export function createWorld(biome = 'jungle', scene, opts = {}) {
  if (!BIOMES[biome]) biome = 'jungle';
  const cfg = BIOMES[biome];
  const hi = opts.quality !== 'low';
  const seed = hashStr('dino-rider:' + biome);
  const root = new THREE.Group();
  root.name = 'World:' + biome;
  const prevFog = scene.fog, prevBg = scene.background;

  const ctx = {
    biome, hi, seed, root,
    rand: mulberry32(seed),
    noise: makeNoise(mulberry32(seed ^ 0x9e3779b9)),
    obstacles: [],
    updaters: [],
    pulse: [],
    timeU: { value: 0 },
    sprite: makeSprite(64),
    decoMat: decoMaterial(),
    heightAt: null,
  };

  // —— 地形 ——
  const terrain = buildTerrain(ctx, cfg.height(ctx), cfg.ground(ctx));
  ctx.heightAt = terrain.heightAt;
  root.add(terrain.mesh);

  // —— 天空 / 雾 ——
  const s = cfg.sky;
  const horizon = new THREE.Color(s.horizon);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 20), skyMaterial(ctx, s));
  sky.name = 'sky';
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  root.add(sky);
  scene.fog = cfg.fog.density ? new THREE.FogExp2(horizon.getHex(), cfg.fog.density) : new THREE.Fog(horizon.getHex(), cfg.fog.near, cfg.fog.far);
  scene.background = horizon.clone();

  // —— 灯光 ——
  const L = cfg.light;
  const hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemi);
  root.add(hemi);
  if (L.ambI) root.add(new THREE.AmbientLight(L.amb, L.ambI));
  const sunDir = new THREE.Vector3(...s.sunDir).normalize();
  const sun = new THREE.DirectionalLight(L.sun, L.sunI);
  sun.name = 'sun';
  sun.castShadow = true;
  const ms = hi ? 2048 : 1024;
  sun.shadow.mapSize.set(ms, ms);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45;
  sc.near = 1; sc.far = 260;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  root.add(sun);
  root.add(sun.target);
  // 阴影相机按纹素对齐，减少移动时的阴影抖动
  const lRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize();
  const lUp = new THREE.Vector3().crossVectors(sunDir, lRight).normalize();
  const texel = 90 / ms;
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
  followSun(new THREE.Vector3(0, ctx.heightAt(0, 0), 0));

  // —— 装饰 / 天气 ——
  cfg.decorate(ctx);
  cfg.weather(ctx);

  scene.add(root);

  let disposed = false;
  const _focus = new THREE.Vector3();
  const world = {
    biome,
    root,
    heightAt: ctx.heightAt,
    arenaRadius: ARENA_RADIUS,
    obstacles: ctx.obstacles,
    sun,
    fogColor: horizon.clone(),
    // 水面 / 岩浆高度（玩法层可选用：如判断涉水）
    waterLevel: biome === 'jungle' ? POND.water : biome === 'swamp' ? SWAMP_WATER : biome === 'frost' ? LAKE.level : null,
    update(dt, t, focus) {
      if (disposed) return;
      const f = focus ? _focus.set(focus.x, focus.y, focus.z) : ORIGIN;
      ctx.timeU.value = t;
      sky.position.set(f.x, 0, f.z);
      followSun(f);
      for (const p of ctx.pulse) p.mat.emissiveIntensity = p.base + p.amp * Math.sin(t * p.speed);
      for (const u of ctx.updaters) u(dt, t, f);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(root);
      const geos = new Set(), mats = new Set(), texs = new Set([ctx.sprite]);
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
  return world;
}

// ---------------------------------------------------------------------
//  供跑道模块（track.js）复用的内部工具
// ---------------------------------------------------------------------
export {
  BIOMES, W, clamp, lerp, smooth, mulberry32, hashStr, hash3, makeNoise, fbm, ridged,
  T, part, merge, jitter, gradientY, ribbonGeometry, decoMaterial, makeSprite, waterMaterial, bannerMaterial, lavaMaterial, skyMaterial,
  geoRock, geoCapRock, geoBroadleaf, geoPalm, geoFern, geoFlower, geoGrass, geoSaguaro, geoPricklyPear, geoMesa, geoArch, geoRibcage,
  geoSkull, geoShrub, geoPine, geoIceCluster, geoIceSpire, geoDrift, geoDeadTree, geoMushStem, geoMushCap, geoReeds, geoLily,
  geoShardCluster, geoPillar, geoWall, geoSpire, geoBannerPole, buildDistantVolcano, buildCitadel,
};
