// 视觉特效：GPU 粒子、冲击波环、光柱、地面预警、护盾、伤害飘字
import * as THREE from 'three';

const _c = new THREE.Color();
const _v = new THREE.Vector3();

// ---------------------------------------------------------------------
//  粒子系统（Points + 自定义着色器，单次 draw call）
// ---------------------------------------------------------------------
const PARTICLE_VS = /* glsl */`
  attribute float size;
  attribute float alpha;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uScale;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, size * uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const PARTICLE_FS = /* glsl */`
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uSoft;
  uniform float uBoost;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float a = mix(1.0 - smoothstep(0.75, 1.0, d), pow(1.0 - d, 1.6), uSoft);
    gl_FragColor = vec4(vColor * uBoost, a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Particles {
  constructor(scene, max = 2500, additive = true) {
    this.max = max;
    this.count = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
      uniforms: { uScale: { value: 600 }, uSoft: { value: additive ? 1 : 0.25 }, uBoost: { value: additive ? 2.2 : 1 } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
    scene.add(this.points);
    // CPU 侧数据
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
  }

  setScale(viewportHeight, fovDeg) {
    this.mat.uniforms.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, color, color2, alpha = 1, grav = 0, drag = 0) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = alpha;
    this.grav[i] = grav; this.drag[i] = drag;
    _c.set(color);
    this.c0[i3] = _c.r; this.c0[i3 + 1] = _c.g; this.c0[i3 + 2] = _c.b;
    if (color2 !== undefined && color2 !== null) _c.set(color2);
    this.c1[i3] = _c.r; this.c1[i3 + 1] = _c.g; this.c1[i3 + 2] = _c.b;
  }

  /**
   * 爆发式发射
   * o: { count, speed, speedVar, dir(Vector3|null), spread(0..1 球面比例), up, life, lifeVar, size, sizeEnd,
   *      color, color2, alpha, gravity, drag, radius(起点随机半径) }
   */
  burst(p, o) {
    const n = o.count ?? 10;
    const sp = o.speed ?? 5;
    const spVar = o.speedVar ?? 0.5;
    const spread = o.spread ?? 1;
    const up = o.up ?? 0;
    const rad = o.radius ?? 0;
    for (let k = 0; k < n; k++) {
      // 随机方向
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      if (o.dir) {
        dx = o.dir.x + dx * spread; dy = o.dir.y + dy * spread; dz = o.dir.z + dz * spread;
        const l2 = Math.hypot(dx, dy, dz) || 1; dx /= l2; dy /= l2; dz /= l2;
      }
      if (o.flat) { dy = Math.abs(dy) * 0.25; }
      const s = sp * (1 - spVar + Math.random() * spVar * 2);
      const life = (o.life ?? 0.8) * (1 - (o.lifeVar ?? 0.3) + Math.random() * (o.lifeVar ?? 0.3) * 2);
      const ox = rad ? (Math.random() * 2 - 1) * rad : 0;
      const oy = rad ? (Math.random() * 2 - 1) * rad * 0.5 : 0;
      const oz = rad ? (Math.random() * 2 - 1) * rad : 0;
      this.spawn(p.x + ox, p.y + oy, p.z + oz, dx * s, dy * s + up, dz * s, life,
        o.size ?? 0.5, o.sizeEnd ?? 0, o.color ?? 0xffffff, o.color2 ?? o.color ?? 0xffffff,
        o.alpha ?? 1, o.gravity ?? 0, o.drag ?? 0);
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // 与末尾交换删除
        const last = --this.count;
        if (i !== last) this._copy(last, i);
        continue;
      }
      const i3 = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= dr; this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt; this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.alpha[i] = this.a0[i] * (t < 0.1 ? t * 10 : 1) * (1 - t * t);
      this.col[i3] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      this.col[i3 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      this.col[i3 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      i++;
    }
    const g = this.geo;
    g.setDrawRange(0, this.count);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
  }

  _copy(from, to) {
    const f3 = from * 3, t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[t3 + k] = this.pos[f3 + k]; this.vel[t3 + k] = this.vel[f3 + k];
      this.c0[t3 + k] = this.c0[f3 + k]; this.c1[t3 + k] = this.c1[f3 + k]; this.col[t3 + k] = this.col[f3 + k];
    }
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from]; this.a0[to] = this.a0[from];
    this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from];
    this.size[to] = this.size[from]; this.alpha[to] = this.alpha[from];
  }

  clear() { this.count = 0; this.geo.setDrawRange(0, 0); }

  dispose() {
    this.points.parent && this.points.parent.remove(this.points);
    this.geo.dispose(); this.mat.dispose();
  }
}

// ---------------------------------------------------------------------
//  冲击波环 / 光柱（对象池）
// ---------------------------------------------------------------------
const ringGeo = new THREE.RingGeometry(0.9, 1, 72, 1).rotateX(-Math.PI / 2);
const pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
const discGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);

export class Rings {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.pool = [];
  }
  _get(kind) {
    let m = this.pool.find((p) => p.userData.kind === kind);
    if (m) { this.pool.splice(this.pool.indexOf(m), 1); m.visible = true; return m; }
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    m = new THREE.Mesh(kind === 'ring' ? ringGeo : kind === 'disc' ? discGeo : pillarGeo, mat);
    m.userData.kind = kind;
    m.renderOrder = 15;
    this.scene.add(m);
    return m;
  }
  /** 水平扩散环 */
  ring(pos, { r0 = 0.5, r1 = 8, life = 0.6, color = 0xffffff, opacity = 0.75, y = 0.25, thick = 1 } = {}) {
    const m = this._get('ring');
    m.position.set(pos.x, pos.y + y, pos.z);
    m.material.color.set(color).multiplyScalar(r1 > 8 ? 1.1 : 1.6);
    m.scale.set(r0, thick, r0);
    this.items.push({ m, t: 0, life, r0, r1, opacity, kind: 'ring' });
    return m;
  }
  /** 地面闪光圆盘 */
  disc(pos, { r = 4, life = 0.4, color = 0xffffff, opacity = 0.7, y = 0.2 } = {}) {
    const m = this._get('disc');
    m.position.set(pos.x, pos.y + y, pos.z);
    m.material.color.set(color).multiplyScalar(1.6);
    m.scale.set(r, 1, r);
    this.items.push({ m, t: 0, life, r0: r * 0.6, r1: r, opacity, kind: 'disc' });
    return m;
  }
  /** 光柱 */
  pillar(pos, { r = 1.2, h = 12, life = 0.8, color = 0x88ccff, opacity = 0.7 } = {}) {
    const m = this._get('pillar');
    m.position.copy(pos);
    m.material.color.set(color).multiplyScalar(2);
    m.scale.set(r, h, r);
    this.items.push({ m, t: 0, life, r0: r, r1: r * 0.2, opacity, kind: 'pillar', h });
    return m;
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = Math.min(1, it.t / it.life);
      const e = 1 - Math.pow(1 - k, 3);
      const r = it.r0 + (it.r1 - it.r0) * e;
      if (it.kind === 'pillar') it.m.scale.set(r, it.h * (0.6 + 0.4 * e), r);
      else it.m.scale.set(r, 1, r);
      it.m.material.opacity = it.opacity * (1 - k);
      if (k >= 1) {
        it.m.visible = false;
        this.pool.push(it.m);
        this.items.splice(i, 1);
      }
    }
  }
  clear() {
    for (const it of this.items) { it.m.visible = false; this.pool.push(it.m); }
    this.items.length = 0;
  }
  dispose() {
    this.clear();
    for (const m of this.pool) { this.scene.remove(m); m.material.dispose(); }
    this.pool.length = 0;
  }
}

// ---------------------------------------------------------------------
//  地面预警（贴合地形的网格 + 着色器：圆形 / 矩形 / 扇形）
// ---------------------------------------------------------------------
const TELE_VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const TELE_FS = /* glsl */`
  uniform vec3 uColor;
  uniform float uProgress;
  uniform float uShape;
  uniform float uTime;
  uniform float uHalf;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float a = 0.0;
    if (uShape < 0.5) {             // 圆
      float d = length(p);
      if (d > 1.0) discard;
      float edge = smoothstep(0.86, 0.95, d);
      float fill = step(d, uProgress) * 0.38;
      float ring = smoothstep(0.03, 0.0, abs(d - uProgress)) * 0.8;
      a = max(max(edge, fill), ring) + 0.1;
    } else if (uShape < 1.5) {      // 矩形（沿 +v 方向填充）
      float ex = smoothstep(0.88, 0.98, abs(p.x));
      float ey = smoothstep(0.96, 1.0, abs(p.y));
      float fill = step(vUv.y, uProgress) * 0.38;
      a = max(max(ex, ey), fill) + 0.1;
    } else {                        // 扇形（以中心为原点，朝 +v）
      float d = length(p);
      float ang = abs(atan(p.x, p.y));
      if (d > 1.0 || ang > uHalf) discard;
      float edge = max(smoothstep(0.9, 0.98, d), smoothstep(uHalf - 0.06, uHalf, ang));
      float fill = step(d, uProgress) * 0.38;
      a = max(edge, fill) + 0.1;
    }
    a *= 0.8 + 0.2 * sin(uTime * 16.0);
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

const TELE_SEG = 20;

export class Telegraphs {
  constructor(scene, heightAt) {
    this.scene = scene;
    this.heightAt = heightAt;
    this.items = [];
    this.time = 0;
  }
  /**
   * shape: 'circle' { x, z, radius } | 'rect' { x, z, angle, length, width }（x,z 为起点）| 'sector' { x, z, angle, radius, half }
   */
  add(o) {
    const geo = new THREE.PlaneGeometry(1, 1, TELE_SEG, TELE_SEG);
    const mat = new THREE.ShaderMaterial({
      vertexShader: TELE_VS, fragmentShader: TELE_FS, transparent: true, depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(o.color ?? 0xff3030) },
        uProgress: { value: 0 },
        uShape: { value: o.shape === 'rect' ? 1 : o.shape === 'sector' ? 2 : 0 },
        uTime: { value: 0 },
        uHalf: { value: o.half ?? 0.6 },
      },
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 5;
    m.frustumCulled = false;
    this.scene.add(m);
    const it = { m, geo, o: { ...o }, t: 0, duration: o.duration ?? 1, done: false };
    this._conform(it);
    this.items.push(it);
    return it;
  }
  move(it, x, z) { it.o.x = x; it.o.z = z; this._conform(it); }
  _conform(it) {
    const o = it.o;
    const pos = it.geo.attributes.position;
    const n = TELE_SEG + 1;
    const ang = o.angle ?? 0;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        // PlaneGeometry 顶点顺序：行从上(v=1)到下(v=0)
        const u = i / TELE_SEG, v = 1 - j / TELE_SEG;
        let lx, lz;
        if (o.shape === 'rect') { lx = (u - 0.5) * o.width; lz = v * o.length; }
        else { const r = o.radius; lx = (u * 2 - 1) * r; lz = (v * 2 - 1) * r; }
        // 局部 → 世界（朝向 angle，+z 为前）
        const wx = o.x + lx * ca + lz * sa;
        const wz = o.z - lx * sa + lz * ca;
        pos.setXYZ(idx, wx, this.heightAt(wx, wz) + 0.12, wz);
      }
    }
    pos.needsUpdate = true;
    it.geo.computeBoundingSphere();
  }
  remove(it) {
    it.done = true;
  }
  update(dt) {
    this.time += dt;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      it.m.material.uniforms.uTime.value = this.time;
      it.m.material.uniforms.uProgress.value = Math.min(1, it.t / it.duration);
      if (it.done || it.t > it.duration + (it.o.linger ?? 0.05)) {
        this.scene.remove(it.m); it.geo.dispose(); it.m.material.dispose();
        it.done = true;
        this.items.splice(i, 1);
      }
    }
  }
  clear() { for (const it of this.items) it.done = true; this.update(0); }
}

// ---------------------------------------------------------------------
//  能量护盾（菲涅尔球）
// ---------------------------------------------------------------------
export function createShield(color = 0xffd060) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        vP = position;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uTime; uniform float uAlpha;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        float f = pow(1.0 - abs(dot(vN, vV)), 2.5);
        float hex = 0.5 + 0.5 * sin(vP.y * 9.0 + uTime * 4.0) * sin(vP.x * 9.0) * sin(vP.z * 9.0 + uTime * 2.0);
        float a = (f * 0.9 + hex * 0.12) * uAlpha;
        gl_FragColor = vec4(uColor * (1.2 + f), a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), mat);
  m.renderOrder = 25;
  return m;
}

// ---------------------------------------------------------------------
//  伤害飘字（DOM 对象池）
// ---------------------------------------------------------------------
export class FloatingText {
  constructor(layer) {
    this.layer = layer;
    this.items = [];
    this.pool = [];
  }
  add(worldPos, text, cls = '', life = 0.9) {
    if (this.items.length > 28 && (cls === '' || cls === 'burn' || cls === 'poison')) return;
    let el = this.pool.pop();
    if (!el) { el = document.createElement('div'); this.layer.appendChild(el); }
    el.className = 'dmg ' + cls;
    el.textContent = text;
    el.style.display = '';
    this.items.push({
      el, x: worldPos.x, y: worldPos.y, z: worldPos.z, t: 0, life,
      vx: (Math.random() - 0.5) * 30, rise: cls.includes('crit') ? 90 : 60,
    });
    if (this.items.length > 48) this._kill(0);
  }
  _kill(i) {
    const it = this.items[i];
    it.el.style.display = 'none';
    this.pool.push(it.el);
    this.items.splice(i, 1);
  }
  update(dt, camera, w, h) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) { this._kill(i); continue; }
      _v.set(it.x, it.y, it.z).project(camera);
      if (_v.z > 1) { it.el.style.opacity = 0; continue; }
      const sx = (_v.x * 0.5 + 0.5) * w + it.vx * k;
      const sy = (-_v.y * 0.5 + 0.5) * h - it.rise * (1 - (1 - k) * (1 - k));
      const sc = k < 0.15 ? 0.6 + k / 0.15 * 0.8 : 1.4 - Math.min(0.4, (k - 0.15) * 2);
      it.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%) scale(${sc.toFixed(2)})`;
      it.el.style.opacity = k > 0.7 ? (1 - (k - 0.7) / 0.3).toFixed(2) : '1';
    }
  }
  clear() { while (this.items.length) this._kill(0); }
}

// ---------------------------------------------------------------------
//  镜头震动（trauma 模型）
// ---------------------------------------------------------------------
export class Shake {
  constructor() { this.trauma = 0; this.t = 0; this.enabled = true; }
  add(a) { if (this.enabled) this.trauma = Math.min(1, this.trauma + a); }
  apply(camera, dt) {
    this.t += dt;
    if (this.trauma <= 0) return;
    const s = this.trauma * this.trauma;
    camera.position.x += (Math.sin(this.t * 47.3) + Math.sin(this.t * 31.1)) * 0.5 * s * 0.9;
    camera.position.y += (Math.sin(this.t * 53.7) + Math.sin(this.t * 23.9)) * 0.5 * s * 0.7;
    camera.position.z += (Math.sin(this.t * 41.9) + Math.sin(this.t * 37.3)) * 0.5 * s * 0.9;
    camera.rotation.z += Math.sin(this.t * 29.3) * s * 0.035;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
  }
}

// ---------------------------------------------------------------------
//  镜头遮挡渐隐：比玩家更靠近镜头的植被/岩石以 Bayer 网点镂空，避免挡住视线
// ---------------------------------------------------------------------
const CAMFADE_GLSL = /* glsl */`
  {
    float cd = length(vViewPosition);
    if (cd < uCamFade) {
      float k = clamp((uCamFade - cd) / 3.0, 0.0, 0.88);
      ivec2 bp = ivec2(mod(gl_FragCoord.xy, 4.0));
      int bi = bp.x + bp.y * 4;
      float bm[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
      if ((bm[bi] + 0.5) / 16.0 < k) discard;
    }
  }`;

export function applyCameraFade(root, uniform) {
  const done = new Set();
  root.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      if (!m || done.has(m)) continue;
      if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) continue;
      done.add(m);
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (shader, renderer) => {
        if (prev) prev(shader, renderer);
        shader.uniforms.uCamFade = uniform;
        shader.fragmentShader = 'uniform float uCamFade;\n' + shader.fragmentShader.replace(
          '#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + CAMFADE_GLSL);
      };
      const prevKey = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
      m.customProgramCacheKey = () => prevKey() + '|camfade';
      m.needsUpdate = true;
    }
  });
}

// ---------------------------------------------------------------------
//  圆形投影（所有怪物共用一次 draw call，代替实时阴影）
// ---------------------------------------------------------------------
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _right = new THREE.Vector3();
const _col2 = new THREE.Color();

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export class BlobShadows {
  constructor(scene, max = 160) {
    this.max = max;
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, map: blobTexture(), transparent: true, opacity: 0.42, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.n = 0;
  }
  begin() { this.n = 0; }
  add(x, y, z, r) {
    if (this.n >= this.max) return;
    _m4.makeScale(r, 1, r);
    _m4.setPosition(x, y + 0.07, z);
    this.mesh.setMatrixAt(this.n++, _m4);
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    this.mesh.parent && this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.map.dispose();
    this.mesh.material.dispose();
  }
}

// ---------------------------------------------------------------------
//  头顶血条（实例化，全部怪物共用 2 次 draw call）
// ---------------------------------------------------------------------
export class Bars {
  constructor(scene, max = 120) {
    this.max = max;
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthTest: false, fog: false });
    const fgMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, fog: false });
    this.bg = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), bgMat, max);
    this.fg = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0), fgMat, max);
    this.fg.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    for (const m of [this.bg, this.fg]) { m.frustumCulled = false; m.count = 0; scene.add(m); }
    this.bg.renderOrder = 30; this.fg.renderOrder = 31;
    this.n = 0;
    this.q = new THREE.Quaternion();
  }
  begin(camera) {
    this.n = 0;
    this.q.copy(camera.quaternion);
    _right.set(1, 0, 0).applyQuaternion(this.q);
  }
  add(x, y, z, w, ratio, color) {
    if (this.n >= this.max) return;
    const i = this.n++;
    _p.set(x, y, z);
    _s.set(w + 0.08, 0.2, 1);
    _m4.compose(_p, this.q, _s);
    this.bg.setMatrixAt(i, _m4);
    _p.addScaledVector(_right, -w / 2);
    _s.set(Math.max(0.001, w * ratio), 0.12, 1);
    _m4.compose(_p, this.q, _s);
    this.fg.setMatrixAt(i, _m4);
    this.fg.setColorAt(i, _col2.set(color).multiplyScalar(1.3));
  }
  end() {
    this.bg.count = this.fg.count = this.n;
    this.bg.instanceMatrix.needsUpdate = true;
    this.fg.instanceMatrix.needsUpdate = true;
    this.fg.instanceColor.needsUpdate = true;
  }
  dispose() {
    for (const m of [this.bg, this.fg]) { m.parent && m.parent.remove(m); m.geometry.dispose(); m.material.dispose(); }
  }
}
