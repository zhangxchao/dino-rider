// 入口：渲染器 / 后期 / 场景状态机（加载 → 菜单 → 游戏）
import * as THREE from 'three';
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

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

class App {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1500);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.45, 0.85);
    this.composer.addPass(this.bloom);
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
    this.dyn = { t: 0, frames: 0, good: 0, lock: 0, pr: null, fps: 60 };
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
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.game && this.game.controlsActive) this.onPause();
    });

    this.applySettings();
    this.resize();
  }

  get quality() { return save.settings.quality; }

  applySettings() {
    const s = save.settings;
    audio.setMusicVolume(s.music);
    audio.setSfxVolume(s.sfx);
    const dpr = window.devicePixelRatio || 1;
    this.maxPR = s.quality === 'high' ? Math.min(dpr, 2) : Math.min(dpr, 1);
    this.minPR = s.quality === 'high' ? 0.75 : 0.6;
    this.dyn.pr = Math.min(this.maxPR, s.quality === 'high' ? 1.5 : 1);
    this.dyn.good = 0;
    this.setPixelRatio(this.dyn.pr);
    this.useComposer = s.quality === 'high';
    if (this.game) this.game.shake.enabled = s.shake;
    this.fpsEl.style.display = s.showFps ? 'block' : 'none';
  }

  setPixelRatio(pr) {
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.resize();
  }

  // 每秒根据帧率调整渲染分辨率：卡了就降，稳定流畅再慢慢升回去
  adaptResolution(rawDt) {
    const d = this.dyn;
    if (document.hidden || rawDt > 0.5) return;
    d.t += rawDt; d.frames++;
    d.lock -= rawDt;
    if (d.t < 1) return;
    d.fps = d.frames / d.t;
    d.t = 0; d.frames = 0;
    if (save.settings.autoRes !== false) {
      if (d.fps < 50 && d.pr > this.minPR + 0.01) {
        d.pr = Math.max(this.minPR, Math.round((d.pr - 0.25) * 100) / 100);
        d.lock = 8; d.good = 0;
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
      if (this.useComposer) this.composer.render(dt);
      else this.renderer.render(this.scene, this.camera);
      this.lastCalls = this.renderer.info.render.calls;
    } catch (e) {
      this.showError(e);
    }
    input.endFrame();
    requestAnimationFrame((t) => this.loop(t));
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
