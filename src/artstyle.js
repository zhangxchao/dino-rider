// =====================================================================
//  画风滤镜：整屏换成油画 / 彩铅 / 漫画风格
//  一个 ShaderPass 放在 OutputPass 之后（这时颜色已经是屏幕上的 sRGB 0~1），由它画到屏幕
//  none 时整个 Pass 关掉，没有任何开销
// =====================================================================
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const ART_STYLES = ['none', 'oil', 'pencil', 'comic'];
const MODE = { none: 0, oil: 1, pencil: 2, comic: 3 };

const ArtShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uMode: { value: 0 },
    uScale: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform int uMode;
    uniform float uScale;      // 1 = 约 540 像素高的画面；分辨率越高笔触按比例放大
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    vec3 tex(vec2 o) { return texture2D(tDiffuse, vUv + o / uRes).rgb; }

    // Sobel 边缘强度（亮度）
    float edge(float s) {
      float tl = luma(tex(vec2(-s,  s))), t = luma(tex(vec2(0,  s))), tr = luma(tex(vec2(s,  s)));
      float l  = luma(tex(vec2(-s, 0))),                               r  = luma(tex(vec2(s, 0)));
      float bl = luma(tex(vec2(-s, -s))), b = luma(tex(vec2(0, -s))), br = luma(tex(vec2(s, -s)));
      float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
      float gy = -bl - 2.0 * b - br + tl + 2.0 * t + tr;
      return length(vec2(gx, gy));
    }

    // —— 油画：Kuwahara 滤波（四个象限里挑颜色最平的那块取平均），抹掉细节变成一块块笔触 ——
    vec3 oil() {
      float st = uScale * 1.25;
      vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0);
      vec3 s0 = vec3(0.0), s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0);
      for (int j = -3; j <= 3; j++) {
        for (int i = -3; i <= 3; i++) {
          vec3 c = tex(vec2(float(i), float(j)) * st);
          vec3 c2 = c * c;
          if (i <= 0 && j <= 0) { m0 += c; s0 += c2; }
          if (i >= 0 && j <= 0) { m1 += c; s1 += c2; }
          if (i <= 0 && j >= 0) { m2 += c; s2 += c2; }
          if (i >= 0 && j >= 0) { m3 += c; s3 += c2; }
        }
      }
      const float n = 16.0;
      m0 /= n; m1 /= n; m2 /= n; m3 /= n;
      vec3 v0 = abs(s0 / n - m0 * m0), v1 = abs(s1 / n - m1 * m1), v2 = abs(s2 / n - m2 * m2), v3 = abs(s3 / n - m3 * m3);
      float d0 = v0.r + v0.g + v0.b, d1 = v1.r + v1.g + v1.b, d2 = v2.r + v2.g + v2.b, d3 = v3.r + v3.g + v3.b;
      vec3 col = m0; float best = d0;
      if (d1 < best) { best = d1; col = m1; }
      if (d2 < best) { best = d2; col = m2; }
      if (d3 < best) { best = d3; col = m3; }
      // 颜料更浓一点
      float l = luma(col);
      col = clamp(mix(vec3(l), col, 1.18), 0.0, 1.0);
      // 画布纹理：经纬交织 + 斜向笔刷条纹
      vec2 px = gl_FragCoord.xy / uScale;
      float weave = (sin(px.x * 1.9) * sin(px.y * 1.9)) * 0.025;
      float brush = (noise(vec2(px.x * 0.08 + px.y * 0.05, px.y * 0.6 - px.x * 0.3)) - 0.5) * 0.09;
      col *= 1.0 + weave + brush;
      return col;
    }

    // —— 彩铅：纸张底色 + 铅笔轮廓 + 按明暗加斜向排线 ——
    vec3 pencil() {
      vec3 c = tex(vec2(0.0));
      vec2 px = gl_FragCoord.xy / uScale;
      vec3 paper = vec3(0.98, 0.96, 0.9) * (0.96 + 0.04 * noise(px * 0.9));
      float l = luma(c);
      // 颜色变淡（彩铅涂不满），保留色相
      vec3 col = mix(paper, c * 1.08 + 0.06, 0.72);
      // 排线：两组斜线，越暗越密
      float j = noise(px * 0.15) * 2.0;
      float h1 = abs(fract((px.x + px.y + j) / 4.0) - 0.5) * 2.0;
      float h2 = abs(fract((px.x - px.y + j * 1.3) / 4.5) - 0.5) * 2.0;
      float dark = 1.0 - l;
      float hatch = smoothstep(0.62, 0.95, h1) * smoothstep(0.25, 0.65, dark)
                  + smoothstep(0.62, 0.95, h2) * smoothstep(0.5, 0.85, dark);
      col *= 1.0 - hatch * 0.28;
      // 铅笔轮廓（加一点抖动，像手画的）
      float e = edge(uScale * (0.9 + 0.3 * noise(px * 0.3)));
      float line = smoothstep(0.18, 0.55, e) * (0.75 + 0.25 * noise(px * 1.7));
      col = mix(col, vec3(0.22, 0.2, 0.24), line * 0.85);
      return col;
    }

    // —— 漫画：色块分层 + 粗墨线 + 暗部网点 ——
    vec3 comic() {
      vec3 c = tex(vec2(0.0));
      float l = luma(c);
      // 按亮度分 4 层，保留原来的颜色倾向
      // 暗部往上提一点：昏暗的关卡（丛林、暗影）分层后不能一片死黑
      float q = max(floor(pow(l, 0.8) * 4.0 + 0.4) / 4.0, 0.16);
      vec3 col = c / max(l, 0.04) * q;
      float lq = luma(col);
      col = clamp(mix(vec3(lq), col, 1.3), 0.0, 1.0);
      // 暗部网点（45° 旋转的圆点阵）
      vec2 p = gl_FragCoord.xy / (uScale * 5.0);
      p = vec2(p.x + p.y, p.x - p.y) * 0.7071;
      float d = length(fract(p) - 0.5);
      float rad = clamp((0.55 - l) * 0.9, 0.0, 0.5);
      col *= 1.0 - (1.0 - smoothstep(rad - 0.08, rad, d)) * 0.25;
      // 墨线
      float e = edge(uScale * 1.3);
      col = mix(col, vec3(0.05, 0.04, 0.07), smoothstep(0.22, 0.45, e));
      return col;
    }

    void main() {
      vec3 col;
      if (uMode == 1) col = oil();
      else if (uMode == 2) col = pencil();
      else if (uMode == 3) col = comic();
      else col = tex(vec2(0.0));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class ArtStyle {
  constructor() {
    this.pass = new ShaderPass(ArtShader);
    this.u = this.pass.uniforms;
    this.pass.enabled = false;
    this.style = 'none';
    // composer 改尺寸 / 像素比时会用实际像素尺寸调用各 Pass 的 setSize
    this.pass.setSize = (w, h) => this.setSize(w, h);
  }

  set(style) {
    this.style = MODE[style] ? style : 'none';
    this.u.uMode.value = MODE[this.style];
    this.pass.enabled = this.style !== 'none';
  }

  get on() { return this.style !== 'none'; }

  /** w/h 为实际缓冲像素尺寸（已乘像素比） */
  setSize(w, h) {
    this.u.uRes.value.set(w, h);
    this.u.uScale.value = Math.max(1, h / 540);
  }
}
