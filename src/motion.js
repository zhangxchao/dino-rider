// 体感控制（实验）：前置摄像头 + MediaPipe 姿态识别（全部在本机运行，画面不会上传）
//   · 身体 / 头左右倾斜 → 恐龙左右移动
//   · 举起一只手过头 → 释放技能
// MediaPipe 的脚本、wasm 和模型放在 public/mediapipe/，第一次打开体感时才加载。
import { input } from './input.js';
import { t } from './i18n.js';

const NOSE = 0, L_SH = 11, R_SH = 12, L_WR = 15, R_WR = 16;
const FULL_LEAN = 0.11;     // 偏离中心占画面宽度的这个比例 = 推满
const DEAD = 0.12;          // 死区（推满比例）
const RAISE_FRAMES = 3;     // 手举过头要连续这几帧才算
const SKILL_COOLDOWN = 700; // ms

const base = () => new URL('./mediapipe/', document.baseURI).href;

class Motion {
  constructor() {
    this.state = 'off';      // off | loading | run | error
    this.landmarker = null;
    this.stream = null;
    this.video = null;
    this.box = null;
    this.cvs = null;
    this.msgEl = null;
    this.token = 0;
    this.err = '';
    this.resetTracking();
  }

  resetTracking() {
    this.center = null;      // 校准的中心（画面宽度 0..1，已镜像）
    this.calib = [];
    this.x = 0;              // 平滑后的横向位置
    this.raiseN = 0;
    this.armed = true;
    this.lastSkill = 0;
    this.lastTs = -1;
    this.seen = 0;
    input.motionX = 0;
  }

  get supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.WebAssembly);
  }

  get running() { return this.state === 'run' || this.state === 'loading'; }

  /** 重新校准：站好后在中间位置调用，之后以此为「正中」 */
  recalibrate() { this.center = null; this.calib = []; }

  buildBox() {
    if (this.box) return;
    const box = document.createElement('div');
    box.id = 'motion-cam';
    box.innerHTML = '<video playsinline muted autoplay></video><canvas></canvas><div class="mmsg"></div>';
    document.body.appendChild(box);
    this.box = box;
    this.video = box.querySelector('video');
    this.cvs = box.querySelector('canvas');
    this.msgEl = box.querySelector('.mmsg');
    box.addEventListener('pointerdown', () => this.recalibrate());   // 点一下小窗 = 以当前站位重新校准
  }

  msg(text, tone = '') {
    if (!this.msgEl) return;
    this.msgEl.textContent = text;
    this.msgEl.dataset.tone = tone;
  }

  async start() {
    if (this.running) return;
    const my = ++this.token;
    if (!this.supported) { this.fail('motion.unsupported'); return; }
    this.state = 'loading';
    this.err = '';
    this.resetTracking();
    this.buildBox();
    this.box.classList.add('on');
    this.msg(t('motion.loading'));
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      if (my !== this.token) { this.releaseStream(); return; }
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
      if (!this.landmarker) this.landmarker = await this.loadModel();
      if (my !== this.token) return;
    } catch (e) {
      if (my !== this.token) return;
      console.warn('[motion]', e);
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      this.fail(denied ? 'motion.denied' : (e && e.name === 'NotFoundError' ? 'motion.nocam' : 'motion.fail'));
      return;
    }
    this.state = 'run';
    this.msg(t('motion.find'), 'warn');
    this.loop(my);
  }

  async loadModel() {
    const mod = await import(/* @vite-ignore */ base() + 'vision_bundle.mjs');
    const fileset = {
      wasmLoaderPath: base() + 'wasm/vision_wasm_internal.js',
      wasmBinaryPath: base() + 'wasm/vision_wasm_internal.wasm',
    };
    const mk = (delegate) => mod.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: base() + 'pose_landmarker_lite.task', delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    try { return await mk('GPU'); } catch (e) { console.warn('[motion] GPU delegate failed, use CPU', e); return mk('CPU'); }
  }

  fail(key) {
    this.err = key;
    this.state = 'error';
    this.releaseStream();
    this.buildBox();
    this.box.classList.add('on');
    this.msg(t(key), 'bad');
  }

  releaseStream() {
    if (this.stream) { for (const tr of this.stream.getTracks()) tr.stop(); this.stream = null; }
    if (this.video) this.video.srcObject = null;
  }

  stop() {
    this.token++;
    this.releaseStream();
    this.state = 'off';
    this.err = '';
    if (this.box) this.box.classList.remove('on');
    input.motionX = 0;
  }

  loop(my) {
    if (my !== this.token || this.state !== 'run') return;
    const v = this.video;
    const next = () => {
      if (my !== this.token || this.state !== 'run') return;
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => this.step(my));
      else setTimeout(() => this.step(my), 33);
    };
    this._next = next;
    next();
  }

  step(my) {
    if (my !== this.token || this.state !== 'run') return;
    const v = this.video;
    if (v.readyState >= 2 && v.videoWidth) {
      const ts = performance.now();
      if (ts > this.lastTs) {
        this.lastTs = ts;
        let res = null;
        try { res = this.landmarker.detectForVideo(v, ts); } catch (e) { console.warn('[motion] detect', e); }
        this.process(res && res.landmarks && res.landmarks[0], ts);
      }
    }
    this._next();
  }

  process(lm, ts) {
    const ok = (p) => p && (p.visibility === undefined || p.visibility > 0.5);
    const ready = lm && ok(lm[L_SH]) && ok(lm[R_SH]) && ok(lm[NOSE]);
    this.draw(lm, ready);
    if (!ready) {
      this.seen = 0;
      input.motionX = 0;
      this.x *= 0.8;
      if (this.center !== null || this.calib.length === 0) this.msg(t('motion.find'), 'warn');
      return;
    }
    // 画面是镜像的：x 取 1 - x，这样你往右倾，屏幕上的恐龙也往右
    const sx = 1 - (lm[L_SH].x + lm[R_SH].x) / 2;
    const nx = 1 - lm[NOSE].x;
    const raw = nx * 0.6 + sx * 0.4;
    this.seen++;
    if (this.center === null) {
      // 校准：站稳大约 0.8 秒，取平均作为正中
      this.calib.push(raw);
      if (this.calib.length > 24) this.calib.shift();
      const n = this.calib.length;
      this.msg(t('motion.calib'), 'warn');
      if (n >= 24) {
        const mean = this.calib.reduce((a, b) => a + b, 0) / n;
        const spread = Math.max(...this.calib) - Math.min(...this.calib);
        if (spread < 0.05) { this.center = mean; this.x = mean; this.msg(t('motion.ok'), 'ok'); }
        else this.calib.length = 0;
      }
      input.motionX = 0;
      return;
    }
    this.x += (raw - this.x) * 0.5;
    let v = (this.x - this.center) / FULL_LEAN;
    v = Math.max(-1, Math.min(1, v));
    input.motionX = Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD);

    // 举手：任意一只手腕高过鼻子；放下（低于肩膀）后才能再次触发
    const noseY = lm[NOSE].y;
    const shY = (lm[L_SH].y + lm[R_SH].y) / 2;
    const up = (w) => ok(w) && w.y < noseY - 0.02;
    const down = (w) => !ok(w) || w.y > shY;
    const handUp = up(lm[L_WR]) || up(lm[R_WR]);
    const handsDown = down(lm[L_WR]) && down(lm[R_WR]);
    if (handUp) this.raiseN++; else this.raiseN = 0;
    if (handsDown) this.armed = true;
    if (this.raiseN >= RAISE_FRAMES && this.armed && ts - this.lastSkill > SKILL_COOLDOWN) {
      this.armed = false;
      this.lastSkill = ts;
      input.motionSkill = ts;
    }
  }

  draw(lm, ready) {
    const c = this.cvs;
    if (!c) return;
    const w = 160, h = 120;
    if (c.width !== w) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    // 中心线
    if (this.center !== null) {
      g.strokeStyle = 'rgba(255,255,255,.35)';
      g.beginPath(); g.moveTo(this.center * w, 0); g.lineTo(this.center * w, h); g.stroke();
    }
    if (!lm) return;
    g.fillStyle = ready ? '#7dff8a' : '#ffb04a';
    for (const i of [NOSE, L_SH, R_SH, L_WR, R_WR]) {
      const p = lm[i];
      if (!p) continue;
      g.beginPath(); g.arc((1 - p.x) * w, p.y * h, 3.5, 0, Math.PI * 2); g.fill();
    }
  }
}

export const motion = new Motion();
