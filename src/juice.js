// =====================================================================
//  打击感 / 画面冲击：全屏闪光、色差、径向模糊、速度线、暗角、色调、FOV 冲击、泛光脉冲
//  高画质：一个 ShaderPass（插在泛光之后、OutputPass 之前）
//  流畅画质：没有后期，用 #fx-layer 上的 CSS 闪光 / 暗角代替
//  所有效果都是“冲量 + 指数衰减”，调用方只管触发：juice.flash(0xffffff, 0.6)
// =====================================================================
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FX } from './effects.js';

const JuiceShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uFlash: { value: new THREE.Color(1, 1, 1) },
    uFlashA: { value: 0 },
    uAberr: { value: 0 },
    uRadial: { value: 0 },
    uSpeed: { value: 0 },
    uTint: { value: new THREE.Color(1, 0.8, 0.4) },
    uTintA: { value: 0 },
    uDesat: { value: 0 },
    uVig: { value: 0 },
    uVigCol: { value: new THREE.Color(0, 0, 0) },
    // 常驻调色（高画质）：饱和度 / 对比度 / 高光与暗部色偏
    uGrade: { value: 0 },
    uSat: { value: 1 },
    uCon: { value: 1 },
    uGain: { value: new THREE.Color(1, 1, 1) },
    uLift: { value: new THREE.Color(0, 0, 0) },
    // 太阳光束（屏幕空间径向采样，太阳在画面外时自动淡出）
    uSunUv: { value: new THREE.Vector2(0.5, 0.8) },
    uRays: { value: 0 },
    uSunCol: { value: new THREE.Color(1, 0.95, 0.8) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uTime, uFlashA, uAberr, uRadial, uSpeed, uTintA, uDesat, uVig;
    uniform vec3 uFlash, uTint, uVigCol;
    uniform float uGrade, uSat, uCon, uRays;
    uniform vec3 uGain, uLift, uSunCol;
    uniform vec2 uSunUv;
    varying vec2 vUv;
    float h11(float p) { return fract(sin(p * 127.1) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      vec2 ca = c * vec2(uRes.x / uRes.y, 1.0);
      float r = length(ca);
      vec3 col;
      if (uRadial > 0.002) {
        // 径向模糊：越靠边拉得越长，中心保持清晰
        float k = uRadial * 0.075 * smoothstep(0.08, 0.75, r);
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 6; i++) acc += texture2D(tDiffuse, 0.5 + c * (1.0 - k * float(i) / 5.0)).rgb;
        col = acc / 6.0;
      } else col = texture2D(tDiffuse, vUv).rgb;
      if (uAberr > 0.002) {
        vec2 off = c * uAberr * 0.018 * (0.3 + r);
        col.r = mix(col.r, texture2D(tDiffuse, vUv + off).r, 0.85);
        col.b = mix(col.b, texture2D(tDiffuse, vUv - off).b, 0.85);
      }
      if (uSpeed > 0.002) {
        // 速度线：按角度分桶的放射状条纹，向外流动
        float a = atan(ca.y, ca.x) / 6.2831853 + 0.5;
        float bucket = floor(a * 90.0);
        float seed = h11(bucket + floor(uTime * 7.0) * 17.0);
        float on = step(0.78, seed);
        float flow = fract(r * 2.2 - uTime * 3.5 - seed * 5.0);
        float line = on * smoothstep(0.0, 0.25, flow) * (1.0 - smoothstep(0.25, 0.9, flow));
        line *= smoothstep(0.28, 0.72, r) * (1.0 - abs(fract(a * 90.0) - 0.5) * 2.0);
        col += vec3(1.0, 0.97, 0.9) * line * uSpeed * 0.55;
      }
      if (uRays > 0.002) {
        // 太阳光束：从像素朝太阳方向采样 8 次，只累积比天空还亮的部分（被树 / 建筑挡住的地方自然变暗）
        vec2 dir = (uSunUv - vUv) * 0.11;
        vec2 p = vUv;
        float acc = 0.0, w = 1.0;
        for (int i = 0; i < 8; i++) {
          p += dir;
          vec3 s = texture2D(tDiffuse, clamp(p, 0.0, 1.0)).rgb;
          acc += max(dot(s, vec3(0.3, 0.59, 0.11)) - 1.2, 0.0) * w;
          w *= 0.84;
        }
        vec2 sd = (vUv - uSunUv) * vec2(uRes.x / uRes.y, 1.0);
        col += uSunCol * acc * uRays * 0.09 * (1.0 - smoothstep(0.1, 1.1, length(sd)));
      }
      if (uGrade > 0.002) {
        // 调色在线性 HDR 空间里做（之后还有色调映射）：以 0.18 中灰为支点调对比，再调饱和与色偏
        vec3 g = max((col - 0.18) * uCon + 0.18, 0.0);
        float gl = dot(g, vec3(0.2126, 0.7152, 0.0722));
        g = mix(vec3(gl), g, uSat);
        g = g * uGain + uLift * (1.0 - clamp(gl * 2.0, 0.0, 1.0));
        col = mix(col, g, uGrade);
      }
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l), uDesat);
      col = mix(col, col * uTint * 1.25 + uTint * 0.04, uTintA);
      col += uFlash * uFlashA;
      float v = smoothstep(0.32, 0.92, r);
      col = mix(col, uVigCol, v * uVig);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const _c = new THREE.Color();
const _sv = new THREE.Vector3();

// 每个生态的调色：sat 饱和度、con 对比度、gain 高光色偏（乘）、lift 暗部色偏（加）、rays 太阳光束强度
const GRADES = {
  jungle:  { sat: 1.12, con: 1.06, gain: 0xfff6e8, lift: 0x02080a, rays: 1.0 },
  desert:  { sat: 1.06, con: 1.08, gain: 0xfff0dc, lift: 0x0a0602, rays: 1.2 },
  frost:   { sat: 1.02, con: 1.05, gain: 0xf0f6ff, lift: 0x04080e, rays: 0.8 },
  swamp:   { sat: 1.04, con: 1.08, gain: 0xf4fff0, lift: 0x040a06, rays: 0.7 },
  volcano: { sat: 1.1,  con: 1.1,  gain: 0xfff0e4, lift: 0x0c0402, rays: 0.6 },
  shadow:  { sat: 1.08, con: 1.08, gain: 0xf6f0ff, lift: 0x06040e, rays: 0.5 },
  hive:    { sat: 1.1,  con: 1.1,  gain: 0xfff4f0, lift: 0x0a0204, rays: 0.5 },
  menu:    { sat: 1.08, con: 1.05, gain: 0xfff8f0, lift: 0x020406, rays: 0.8 },
};

export class Juice {
  constructor(app) {
    this.app = app;
    this.pass = new ShaderPass(JuiceShader);
    this.u = this.pass.uniforms;
    // 冲量（每帧指数衰减）
    this.k = { flash: 0, aberr: 0, radial: 0, fov: 0, bloom: 0 };
    // 持续状态（由游戏每帧设定，平滑过渡）
    this.hold = { speed: 0, tint: 0, desat: 0, vig: 0, fov: 0, radial: 0, aberr: 0 };
    this.cur = { speed: 0, tint: 0, desat: 0, vig: 0, fov: 0, radial: 0, aberr: 0 };
    this.fovNow = 0;
    this.fovVel = 0;
    this.flashCol = new THREE.Color(1, 1, 1);
    this.t = 0;
    this.css = null;
    this.grade = GRADES.menu;
    this.sunDir = null;      // 世界空间太阳方向（由关卡设置）
    this.sunVis = 0;
    // 镜头动感（视野冲击 / 径向模糊 / 速度线 / 过弯侧倾）容易让人头晕：跟随设置里的“镜头晃动”开关，默认关闭
    this.motion = false;
  }

  /** 由 main.js 插入 composer（泛光之后） */
  install(composer, index) { composer.insertPass(this.pass, index); }

  setSize(w, h) { this.u.uRes.value.set(w, h); }

  // —— 触发 ——
  flash(color = 0xffffff, a = 0.5) {
    a *= FX.screen;
    if (a >= this.k.flash) this.flashCol.set(color);
    this.k.flash = Math.min(0.8, Math.max(this.k.flash, a));
  }
  aberr(a) { a *= FX.screen; this.k.aberr = Math.min(2, this.k.aberr + a); }
  radial(a) { if (!this.motion) return; a *= FX.screen; this.k.radial = Math.min(2, this.k.radial + a); }
  /** 正值拉远（视野变宽，速度感），负值推近（冲击） */
  fovKick(deg) { if (!this.motion) return; deg *= 0.4 + 0.6 * FX.screen; this.fovVel = Math.max(-60, Math.min(60, this.fovVel + deg * 9)); }
  bloom(a) { a *= FX.screen; this.k.bloom = Math.min(0.9, this.k.bloom + a); }
  setTint(color) { this.u.uTint.value.set(color); }
  /** 切换生态调色；sunDir / sunColor 用于太阳光束 */
  setGrade(biome, sunDir = null, sunColor = 0xfff2d8) {
    const G = this.grade = GRADES[biome] || GRADES.menu;
    const u = this.u;
    u.uSat.value = G.sat; u.uCon.value = G.con;
    u.uGain.value.set(G.gain); u.uLift.value.set(G.lift);
    u.uSunCol.value.set(sunColor);
    this.sunDir = sunDir ? new THREE.Vector3(...sunDir).normalize() : null;
  }

  reset() {
    for (const k in this.k) this.k[k] = 0;
    for (const k in this.hold) this.hold[k] = 0;
    for (const k in this.cur) this.cur[k] = 0;
    this.fovNow = 0; this.fovVel = 0;
    this.apply(0);
  }

  update(dt) {
    this.t += dt;
    const K = this.k;
    K.flash *= Math.exp(-dt * 7);
    K.aberr *= Math.exp(-dt * 5);
    K.radial *= Math.exp(-dt * 4);
    K.bloom *= Math.exp(-dt * 3);
    for (const key in this.cur) {
      const rate = key === 'fov' ? 3 : 4;
      this.cur[key] += (this.hold[key] - this.cur[key]) * (1 - Math.exp(-dt * rate));
    }
    // FOV：弹簧（冲击会过冲再回弹）
    const target = this.cur.fov;
    this.fovVel += ((target - this.fovNow) * 60 - this.fovVel * 11) * dt;
    this.fovNow += this.fovVel * dt;
    this.apply(dt);
  }

  apply() {
    const u = this.u, c = this.cur, K = this.k;
    const flash = Math.min(1, K.flash), aberr = K.aberr + c.aberr, radial = K.radial + c.radial;
    // 没有任何效果时整个 Pass 关掉，省下一次整屏绘制；常驻暗角由 CSS 负责
    // 常驻调色与太阳光束只在高画质、特效不是“精简”时开（这时整个 Pass 常开）
    const grade = FX.level !== 'low' ? 1 : 0;
    let rays = 0;
    if (grade && this.sunDir && this.app.camera && !this.app.mobile) {   // 太阳光束每像素 8 次采样，手机上不开
      const cam = this.app.camera;
      _sv.copy(this.sunDir).multiplyScalar(1000).add(cam.position).project(cam);
      const front = _sv.z < 1 && _sv.z > -1;
      const edge = Math.max(Math.abs(_sv.x), Math.abs(_sv.y));
      const vis = front ? 1 - Math.min(1, Math.max(0, (edge - 1) / 0.6)) : 0;
      this.sunVis += (vis - this.sunVis) * 0.15;
      u.uSunUv.value.set(_sv.x * 0.5 + 0.5, _sv.y * 0.5 + 0.5);
      rays = this.sunVis * (this.grade.rays ?? 0.8);
    }
    const on = grade > 0 || flash > 0.01 || aberr > 0.01 || radial > 0.01 || c.speed * FX.screen > 0.01 || c.tint > 0.01 || c.desat > 0.01 || c.vig > 0.01;
    this.pass.enabled = on;
    if (on) {
      u.uGrade.value = grade;
      u.uRays.value = rays;
      u.uTime.value = this.t;
      u.uFlash.value.copy(this.flashCol);
      u.uFlashA.value = flash;
      u.uAberr.value = aberr;
      u.uRadial.value = radial;
      u.uSpeed.value = c.speed * (0.3 + 0.7 * FX.screen);
      u.uTintA.value = c.tint;
      u.uDesat.value = c.desat;
      u.uVig.value = c.vig;
    }
    if (this.app.bloom) this.app.bloom.strength = 0.5 + K.bloom;
    this._css();
  }

  /** CSS 层：常驻暗角（两种画质）；流畅画质下再加闪光与色调（没有后期时的替代） */
  _css() {
    const low = !this.app.useComposer;
    if (!this.css) {
      this.css = document.createElement('div');
      this.css.className = 'juice-css';
      this.css.innerHTML = '<div class="jf"></div><div class="jv"></div>';
      document.getElementById('fx-layer').appendChild(this.css);
      this.cssF = this.css.firstChild;
      this.cssV = this.css.lastChild;
      this.cssCache = {};
    }
    const C = this.cssCache;
    const set = (el, key, prop, val) => { if (C[key] !== val) { C[key] = val; if (prop.startsWith('--')) el.style.setProperty(prop, val); else el.style[prop] = val; } };
    const f = low ? Math.min(1, this.k.flash) : 0;
    set(this.cssF, 'fo', 'opacity', f.toFixed(2));
    if (f > 0.01) set(this.cssF, 'fb', 'background', '#' + _c.copy(this.flashCol).getHexString());
    const tint = low ? this.cur.tint : 0;
    set(this.cssV, 'vo', 'opacity', Math.min(1, 0.35 + (low ? this.cur.vig * 1.5 : 0) + tint * 0.6).toFixed(2));
    set(this.cssV, 'vt', '--jt', tint > 0.02 ? `rgba(255,170,40,${(tint * 0.5).toFixed(2)})` : 'transparent');
  }

  /** 当前 FOV 偏移（度），由游戏镜头叠加到基础 FOV 上 */
  get fov() { return this.fovNow; }
}
