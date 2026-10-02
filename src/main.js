// 入口：渲染器 / 后期 / 场景状态机（加载 → 菜单 → 游戏）
import * as THREE from 'three';
import { enterFullscreen, isFullscreen, canFullscreen } from './fullscreen.js';
import { FX } from './effects.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { audio } from './audio.js';
import { input } from './input.js';
import { save, persist } from './save.js';
import { LEVELS } from './data.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { Showcase } from './showcase.js';
import { renderThumbnails } from './thumbs.js';
import { t } from './i18n.js';
import { Juice } from './juice.js';
import { setFxLevel } from './effects.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const _groupOf = new WeakMap();
const _groupIds = new Map();
function programGroup(item) {
  const m = item.material, o = item.object;
  let k = _groupOf.get(m);
  if (k === undefined) {
    const sig = [m.type, m.vertexColors, m.flatShading, m.side, !!m.map, !!m.emissiveMap, m.fog, m.onBeforeCompile && m.onBeforeCompile.name].join('|');
    k = _groupIds.get(sig);
    if (k === undefined) { k = _groupIds.size + 1; _groupIds.set(sig, k); }
    _groupOf.set(m, k);
  }
  return k * 4 + (o.isSkinnedMesh ? 1 : 0) + (o.isInstancedMesh ? 2 : 0);
}

class App {
  constructor() {
    this.canvas = document.getElementById('game');
    // 高画质经过后期处理：场景画在离屏缓冲里，屏幕缓冲的多重采样只会白白消耗显存带宽；
    // 流畅画质直接画到屏幕上，才需要开抗锯齿（切换画质后下次打开生效）
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: save.settings.quality !== 'high', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    // 流畅画质用普通 PCF 阴影（软阴影每个像素要多采样好几次）
    this.renderer.shadowMap.type = save.settings.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    // 不透明物体先按“着色器程序”分组再排序：默认按材质编号排，每只怪物各有一套材质，
    // 画的时候着色器会来回切换（每次切换还要重新上传一遍矩阵等 uniform）
    this.renderer.setOpaqueSort((a, b) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder
      || programGroup(a) - programGroup(b) || a.material.id - b.material.id || a.z - b.z || a.id - b.id);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1500);

    // 手机 / 平板（粗指针 + 触屏）：像素多、显卡弱，后期效果按手机档位走
    this.mobile = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
    // 后期合成的离屏缓冲在桌面上开 4 倍多重采样。多重采样的半浮点缓冲需要 EXT_color_buffer_float，
    // iOS Safari 上不一定支持——不支持时帧缓冲不完整，整个画面是黑的；手机像素密度高，本来也不太需要
    const msaa = !this.mobile && this.renderer.capabilities.isWebGL2 !== false && this.renderer.extensions.has('EXT_color_buffer_float');
    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: msaa ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.fbChecked = false;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.45, 0.85);
    {
      // 泛光的模糊链降一半分辨率（泛光本来就是糊的，看不出区别，显存带宽省下一大截）
      const setSize = this.bloom.setSize.bind(this.bloom);
      this.bloom.setSize = (w, h) => setSize(Math.max(2, w * 0.5), Math.max(2, h * 0.5));
    }
    this.composer.addPass(this.bloom);
    this.juice = new Juice(this);
    this.juice.install(this.composer, 2);
    this.composer.addPass(new OutputPass());

    this.audio = audio;
    this.saveRef = save;
    this.hudRoot = document.getElementById('hud');
    this.fxLayer = document.getElementById('fx-layer');
    this.bannerEl = document.getElementById('banner');
    this.toastEl = document.getElementById('toast');
    this.mode = 'loading';
    this.game = null;
    this.showcase = null;
    this.thumbs = { dino: {}, rider: {} };
    this.ui = new UI(this);
    this.lastOpts = null;
    this.errorShown = false;
    // 动态分辨率 + 帧率统计
    this.dyn = { t: 0, frames: 0, good: 0, bad: 0, lock: 0, pr: null, fps: 60, ft: [] };
    this.renderer.info.autoReset = false;
    this.fpsEl = document.createElement('div');
    this.fpsEl.id = 'fps-meter';
    document.body.appendChild(this.fpsEl);

    input.attach(this.canvas);
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (coarse && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
      input.buildTouch(document.getElementById('touch'));
    }

    const unlock = () => { audio.unlock(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
    window.addEventListener('resize', () => this.resize());
    // 手机上任意一次点按就进入全屏并锁定横屏（全屏 API 只能在用户手势里调用；iPhone Safari 不支持，会静默跳过）
    this.lastFsTry = 0;
    window.addEventListener('pointerup', () => {
      if (!input.isTouch || save.settings.autoFs === false || isFullscreen() || !canFullscreen()) return;
      const now = performance.now();
      if (now - this.lastFsTry < 1500) return;
      this.lastFsTry = now;
      enterFullscreen();
    });
    document.addEventListener('fullscreenchange', () => this.resize());
    document.addEventListener('webkitfullscreenchange', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.game && this.game.controlsActive) this.onPause();
    });

    this.applySettings();
    this.resize();
  }

  get quality() { return save.settings.quality; }
  get isTouch() { return input.isTouch; }

  applySettings() {
    const s = save.settings;
    audio.setMusicVolume(s.mute ? 0 : s.music);
    audio.setSfxVolume(s.mute ? 0 : s.sfx);
    // 减少动效：跟随系统设置或手动开启（关掉界面上的循环 / 弹跳动画，镜头动感也一起关）
    const rm = s.reduceMotion || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.documentElement.classList.toggle('reduce-motion', !!rm);
    const dpr = window.devicePixelRatio || 1;
    const hiQ = s.quality === 'high';
    // 手机屏幕像素密度高（iPhone 为 3）：高画质最高 1.5 倍、从 1 倍起步，掉帧时可以一路降到 0.6
    this.maxPR = hiQ ? Math.min(dpr, this.mobile ? 1.5 : 2) : Math.min(dpr, 1);
    this.minPR = hiQ && !this.mobile ? 0.75 : 0.6;
    this.dyn.pr = Math.min(this.maxPR, hiQ ? (this.mobile ? 1 : 1.25) : 1);
    this.dyn.good = 0; this.dyn.bad = 0;
    this.setPixelRatio(this.dyn.pr);
    this.useComposer = s.quality === 'high';
    setFxLevel(s.fx || 'medium');
    FX.dmgNum = s.dmgNum || (this.mobile ? 'crit' : 'all');
    this.juice.motion = !!s.shake && !rm;
    input.vibrate = s.vibrate !== false;
    if (this.game) this.game.shake.enabled = s.shake;
    this.fpsEl.style.display = s.showFps ? 'block' : 'none';
  }

  // renderer / composer 的 setPixelRatio 内部已经按新分辨率重建缓冲，不要再 resize() 一遍（那会再重建一次）
  setPixelRatio(pr) {
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.juice.setSize(window.innerWidth, window.innerHeight);
    if (this.game) this.game.resize(window.innerWidth, window.innerHeight);
  }

  // 每秒根据帧率调整渲染分辨率：卡了就降，稳定流畅再慢慢升回去
  adaptResolution(rawDt) {
    const d = this.dyn;
    if (document.hidden || rawDt > 0.5) return;
    d.t += rawDt; d.frames++;
    d.lock -= rawDt;
    // 单帧长卡顿（刷怪、加载、切后台回来）不算进分辨率判断：看帧时间中位数，而不是平均帧率
    if (rawDt < 0.1) d.ft.push(rawDt);
    if (d.t < 1) return;
    d.fps = d.frames / d.t;
    d.t = 0; d.frames = 0;
    const ft = d.ft.sort((a, b) => a - b);
    const medFps = ft.length ? 1 / ft[ft.length >> 1] : d.fps;
    d.ft.length = 0;
    if (save.settings.autoRes !== false) {
      // 连续两秒都明显掉帧才降一档；降完冷却 6 秒，避免一路连降（每次改分辨率本身也会顿一下）
      if (medFps < 50) d.bad++; else d.bad = 0;
      if (d.bad >= 2 && d.lock <= 0 && d.pr > this.minPR + 0.01) {
        d.pr = Math.max(this.minPR, Math.round((d.pr - 0.25) * 100) / 100);
        d.lock = 6; d.good = 0; d.bad = 0;
        this.setPixelRatio(d.pr);
      } else if (d.fps >= 58 && d.pr < this.maxPR - 0.01 && d.lock <= 0 && !(this.game && !this.game.paused)) {
        // 提高分辨率需要重建后期缓冲（会顿一下），所以只在菜单 / 暂停时往上调
        if (++d.good >= 3) { d.good = 0; d.pr = Math.min(this.maxPR, d.pr + 0.125); this.setPixelRatio(d.pr); }
      } else d.good = 0;
    }
    if (save.settings.showFps) {
      const info = this.renderer.info.render;
      this.fpsEl.textContent = `${d.fps.toFixed(0)} FPS · ${this.lastCalls} draw · ${d.pr.toFixed(2)}x`;
      this.fpsEl.style.color = d.fps >= 55 ? '#8f8' : d.fps >= 40 ? '#fd6' : '#f77';
      void info;
    }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.juice.setSize(w, h);
    if (this.game) this.game.resize(w, h);
  }

  async init() {
    const fill = document.getElementById('loading-fill');
    const text = document.getElementById('loading-text');
    document.querySelector('#loading .logo-big').textContent = t('game.logo');
    document.querySelector('#loading .logo-sub').textContent = t('game.sub');
    text.textContent = t('loading.wake');
    await nextFrame();
    this.thumbs = await renderThumbnails((p, name) => {
      fill.style.width = (p * 85).toFixed(0) + '%';
      text.textContent = t('loading.hatch', { name });
    });
    text.textContent = t('loading.world');
    fill.style.width = '92%';
    await nextFrame();
    this.showcase = new Showcase(this, this.menuBiome());
    this.renderer.compile(this.scene, this.camera);
    fill.style.width = '100%';
    await nextFrame();
    document.getElementById('loading').classList.remove('show');
    this.mode = 'menu';
    this.ui.show('title');
    audio.startMusic('menu');
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  menuBiome() {
    const i = Math.max(0, Math.min(LEVELS.length - 1, save.unlocked - 1));
    return LEVELS[i].biome;
  }

  onScreen(name) {
    if (this.showcase) this.showcase.setFrame(name === 'select' ? 'center' : 'right');
  }

  startGame(opts) {
    this.lastOpts = opts;
    this.ui.hide();
    if (this.game) { this.game.dispose(); this.game = null; }
    if (this.showcase) { this.showcase.dispose(); this.showcase = null; }
    this.hudRoot.classList.remove('hidden');
    document.getElementById('touch').classList.toggle('hidden', !input.isTouch);
    this.game = new Game(this, opts);
    this.mode = 'game';
    input.gameActive = true;
    input.releaseAll();
    save.stats.plays++;
    persist();
  }

  restart() {
    if (this.lastOpts) this.startGame(this.lastOpts);
  }

  exitToMenu(screen = 'title') {
    if (this.game) { this.game.dispose(); this.game = null; }
    this.juice.reset();
    input.gameActive = false;
    input.exitLock();
    input.releaseAll();
    this.hudRoot.classList.add('hidden');
    document.getElementById('touch').classList.add('hidden');
    if (!this.showcase) this.showcase = new Showcase(this, this.menuBiome());
    this.mode = 'menu';
    this.ui.show(screen);
    if (screen !== 'ending') audio.startMusic('menu');
  }

  onPause() {
    if (!this.game || this.game.paused || this.game.finished) return;
    this.game.paused = true;
    input.releaseAll();
    this.ui.show('pause');
  }

  resume() {
    if (!this.game) return;
    this.ui.hide();
    this.game.paused = false;
    input.releaseAll();
  }

  onResult(r) {
    input.gameActive = false;
    input.exitLock();
    this.ui.show('result', r);
  }

  loop(now) {
    const rawDt = Math.max(0, (now - this.last) / 1000);
    const dt = Math.min(0.05, rawDt);
    this.last = now;
    this.adaptResolution(rawDt);
    this.renderer.info.reset();
    try {
      if (this.mode === 'game' && this.game) {
        if (this.game.paused && this.ui.current === 'pause' && input.keyPressed('KeyP')) this.resume();
        this.game.update(dt);
      } else if (this.showcase) {
        this.showcase.update(dt);
      }
      this.juice.update(this.game && this.game.paused ? 0 : dt);
      if (this.useComposer) {
        this.composer.render(dt);
        if (!this.fbChecked) this.checkComposer();
      } else this.renderer.render(this.scene, this.camera);
      this.lastCalls = this.renderer.info.render.calls;
    } catch (e) {
      this.showError(e);
    }
    input.endFrame();
    requestAnimationFrame((t) => this.loop(t));
  }

  /** 第一次走后期合成后检查离屏缓冲是否可用：不完整就关掉多重采样重建；还不行就直接画到屏幕 */
  checkComposer() {
    this.fbChecked = true;
    const r = this.renderer, gl = r.getContext(), c = this.composer;
    try {
      const prev = r.getRenderTarget();
      r.setRenderTarget(c.renderTarget1);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      r.setRenderTarget(prev);
      if (ok) return;
      if (c.renderTarget1.samples > 0) {
        for (const t of [c.renderTarget1, c.renderTarget2]) { t.samples = 0; t.dispose(); }
        c.setSize(window.innerWidth, window.innerHeight);
        this.fbChecked = false; // 重建后再检查一次
      } else {
        this.useComposer = false;   // 连普通半浮点缓冲都不行：放弃后期，直接画到屏幕
      }
    } catch { /* ignore */ }
  }

  showError(e) {
    console.error(e);
    if (this.errorShown) return;
    this.errorShown = true;
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:12px;bottom:12px;max-width:60vw;padding:10px 14px;background:rgba(120,0,0,.85);color:#fff;font:12px/1.5 monospace;border-radius:8px;z-index:99;white-space:pre-wrap;pointer-events:auto';
    d.textContent = t('error.runtime') + '\n' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
    d.onclick = () => d.remove();
    document.body.appendChild(d);
  }
}

const app = new App();
window.__app = app;
app.init().catch((e) => {
  app.showError(e);
  const el = document.getElementById('loading-text');
  if (el) el.textContent = t('error.load', { msg: e.message });
});
