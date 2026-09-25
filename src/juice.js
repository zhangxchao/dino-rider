// =====================================================================
//  打击感 / 画面冲击：全屏闪光、色差、径向模糊、速度线、暗角、色调、FOV 冲击、泛光脉冲
//  高画质：一个 ShaderPass（插在泛光之后、OutputPass 之前）
//  流畅画质：没有后期，用 #fx-layer 上的 CSS 闪光 / 暗角代替
//  所有效果都是“冲量 + 指数衰减”，调用方只管触发：juice.flash(0xffffff, 0.6)
// =====================================================================
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

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
    uVig: { value: 0.28 },
    uVigCol: { value: new THREE.Color(0, 0, 0) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uTime, uFlashA, uAberr, uRadial, uSpeed, uTintA, uDesat, uVig;
    uniform vec3 uFlash, uTint, uVigCol;
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
        for (int i = 0; i < 8; i++) acc += texture2D(tDiffuse, 0.5 + c * (1.0 - k * float(i) / 7.0)).rgb;
        col = acc / 8.0;
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
  }

  /** 由 main.js 插入 composer（泛光之后） */
  install(composer, index) { composer.insertPass(this.pass, index); }

  setSize(w, h) { this.u.uRes.value.set(w, h); }

  // —— 触发 ——
  flash(color = 0xffffff, a = 0.5) {
    if (a >= this.k.flash) this.flashCol.set(color);
    this.k.flash = Math.min(0.8, Math.max(this.k.flash, a));
  }
  aberr(a) { this.k.aberr = Math.min(2, this.k.aberr + a); }
  radial(a) { this.k.radial = Math.min(2, this.k.radial + a); }
  /** 正值拉远（视野变宽，速度感），负值推近（冲击） */
  fovKick(deg) { this.fovVel = Math.max(-60, Math.min(60, this.fovVel + deg * 9)); }
  bloom(a) { this.k.bloom = Math.min(0.9, this.k.bloom + a); }
  setTint(color) { this.u.uTint.value.set(color); }

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
    u.uTime.value = this.t;
    u.uFlash.value.copy(this.flashCol);
    u.uFlashA.value = Math.min(1, K.flash);
    u.uAberr.value = K.aberr + c.aberr;
    u.uRadial.value = K.radial + c.radial;
    u.uSpeed.value = c.speed;
    u.uTintA.value = c.tint;
    u.uDesat.value = c.desat;
    u.uVig.value = 0.28 + c.vig;
    if (this.app.bloom) this.app.bloom.strength = 0.5 + K.bloom;
    this._css();
  }

  /** 流畅画质（没有后期）时的 CSS 替代：只做闪光和暗角 */
  _css() {
    const low = !this.app.useComposer;
    if (!low) { if (this.css) this.css.style.display = 'none'; return; }
    if (!this.css) {
      this.css = document.createElement('div');
      this.css.className = 'juice-css';
      this.css.innerHTML = '<div class="jf"></div><div class="jv"></div>';
      document.getElementById('fx-layer').appendChild(this.css);
      this.cssF = this.css.firstChild;
      this.cssV = this.css.lastChild;
    }
    this.css.style.display = '';
    const f = Math.min(1, this.k.flash);
    this.cssF.style.opacity = f.toFixed(3);
    if (f > 0.01) this.cssF.style.background = '#' + _c.copy(this.flashCol).getHexString();
    const tint = this.cur.tint;
    this.cssV.style.opacity = Math.min(1, 0.35 + this.cur.vig * 1.5 + tint * 0.6).toFixed(3);
    this.cssV.style.setProperty('--jt', tint > 0.02 ? `rgba(255,170,40,${(tint * 0.5).toFixed(3)})` : 'transparent');
  }

  /** 当前 FOV 偏移（度），由游戏镜头叠加到基础 FOV 上 */
  get fov() { return this.fovNow; }
}
