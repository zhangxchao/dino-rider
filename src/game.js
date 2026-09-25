// 一局游戏（跑道模式）：沿路线自动前进，怪物从前方涌来，终点首领战
import * as THREE from 'three';
import { DINOS, RIDERS, ENEMIES, BOSSES, LEVELS, GATES, WEAPON_LEVELS, WEAPON_MAX, XP_NEED, RUN_SPEED } from './data.js';
import { createTrack } from './track.js';
import { Particles, Rings, Telegraphs, FloatingText, Shake, applyCameraFade, BlobShadows, Bars, Debris, Scorch, LightFlashes, Streaks } from './effects.js';
import { Projectiles } from './projectiles.js';
import { Player, computeStats } from './player.js';
import { Enemy, Boss, Prop, buildEnemyModel, buildBossModel } from './enemy.js';
import { Hud } from './hud.js';
import { input } from './input.js';
import { save, persist } from './save.js';
import { clamp, damp, rand, randInt, pick, shuffle, lerp, easeInOut } from './util.js';
import { t } from './i18n.js';
import { Hazards } from './hazards.js';
import { setBendProfile, updateBend, resetBend, bendX, bendVec, curvature } from './bend.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _cinePos = new THREE.Vector3();
const _cineLook = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1);

const DUST = { jungle: 0x8f8a5a, desert: 0xe0c890, frost: 0xeef4ff, swamp: 0x6a7050, volcano: 0x4a403c, shadow: 0x6a5a7a, hive: 0x6a3a34 };
const ROCK = { jungle: 0x7a7a66, desert: 0xc0864a, frost: 0xb8c8d8, swamp: 0x5a6048, volcano: 0x3a3030, shadow: 0x4a4058, hive: 0x4a2a2a };
const ENDLESS_POOL = ['slime', 'goblin', 'bat', 'skeleton', 'wolf', 'scorpion', 'archer', 'mushroom', 'imp', 'wisp', 'yeti', 'mage', 'golem', 'darkKnight'];
const BIOMES = ['jungle', 'desert', 'frost', 'swamp', 'volcano', 'shadow', 'hive'];
const SPAWN_AHEAD = 115;
const ENDLESS_BOSS_EVERY = 1400;
const COMBO_TIERS = [10, 25, 50, 100];

// ---------------------------------------------------------------------
//  拾取物外观
// ---------------------------------------------------------------------
const PICKUP_MAKERS = (() => {
  let cache = null;
  return () => {
    if (cache) return cache;
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 0.85, roughness: 0.25, emissive: 0x7a5200, emissiveIntensity: 0.7 });
    const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 18).rotateX(Math.PI / 2);
    const meatMat = new THREE.MeshStandardMaterial({ color: 0xa8462a, roughness: 0.6, flatShading: true, emissive: 0x401000, emissiveIntensity: 0.3 });
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xf6ecd8, roughness: 0.6 });
    const meatGeo = new THREE.SphereGeometry(0.42, 10, 8).scale(1, 0.85, 1.25);
    const boneGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.6, 6).rotateX(Math.PI / 2).translate(0, 0, 0.6);
    const crystalMat = new THREE.MeshBasicMaterial({ color: 0x4fe0ff }); crystalMat.color.multiplyScalar(2.2);
    const crystalGeo = new THREE.OctahedronGeometry(0.42, 0).scale(0.8, 1.4, 0.8);
    const powerMat = new THREE.MeshBasicMaterial({ color: 0xff7a20 }); powerMat.color.multiplyScalar(2.4);
    const powerGeo = new THREE.IcosahedronGeometry(0.4, 0);
    // 恐龙蛋：奶白色蛋壳 + 绿色斑点
    const eggGeo = new THREE.SphereGeometry(0.5, 14, 10).scale(1, 1.3, 1);
    { const pos = eggGeo.attributes.position, col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const spot = Math.sin(x * 9.1 + y * 3.7) * Math.sin(z * 8.3 - y * 5.1) > 0.45;
        col[i * 3] = spot ? 0.45 : 1; col[i * 3 + 1] = spot ? 0.75 : 0.96; col[i * 3 + 2] = spot ? 0.35 : 0.86;
      }
      eggGeo.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
    const eggMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: 0x302818, emissiveIntensity: 0.6 });
    // 磁铁：红色 U 形 + 银色磁极
    const magGeo = new THREE.TorusGeometry(0.34, 0.12, 8, 16, Math.PI).rotateZ(Math.PI);
    const magMat = new THREE.MeshStandardMaterial({ color: 0xe03030, roughness: 0.4, emissive: 0x600000, emissiveIntensity: 0.6 });
    const tipGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.2, 8);
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xe8eef8, metalness: 0.9, roughness: 0.25 });
    // 炸弹：黑球 + 发光引信
    const bombGeo = new THREE.SphereGeometry(0.45, 12, 10);
    const bombMat = new THREE.MeshStandardMaterial({ color: 0x1e1e26, metalness: 0.3, roughness: 0.4 });
    const fuseMat = new THREE.MeshBasicMaterial({ color: 0xffa040 }); fuseMat.color.multiplyScalar(2.6);
    const fuseGeo = new THREE.SphereGeometry(0.12, 6, 5);
    cache = {
      coinGeo, gold,
      coin: () => new THREE.Mesh(coinGeo, gold),
      meat: () => { const g = new THREE.Group(); g.add(new THREE.Mesh(meatGeo, meatMat), new THREE.Mesh(boneGeo, boneMat)); return g; },
      crystal: () => new THREE.Mesh(crystalGeo, crystalMat),
      power: () => new THREE.Mesh(powerGeo, powerMat),
      egg: () => new THREE.Mesh(eggGeo, eggMat),
      magnet: () => {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(magGeo, magMat));
        for (const sx of [-0.34, 0.34]) { const tip = new THREE.Mesh(tipGeo, tipMat); tip.position.set(sx, -0.1, 0); g.add(tip); }
        return g;
      },
      bomb: () => {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(bombGeo, bombMat));
        const f = new THREE.Mesh(fuseGeo, fuseMat); f.position.set(0.2, 0.45, 0); g.add(f);
        return g;
      },
    };
    return cache;
  };
})();

// ---------------------------------------------------------------------
//  强化门：跑过左边或右边的门获得对应强化
// ---------------------------------------------------------------------
const gatePostGeo = new THREE.CylinderGeometry(0.2, 0.24, 4.8, 8);
const gateBarGeo = new THREE.BoxGeometry(1, 0.35, 0.35);
// 文字贴图与平面几何体按种类缓存复用（开局预生成，跑到强化门时不再临时绘制）
const gateLabelCache = new Map();
const gateGeoCache = new Map();
function gateGeo(w, h) {
  const k = w.toFixed(2) + 'x' + h.toFixed(2);
  if (!gateGeoCache.has(k)) gateGeoCache.set(k, new THREE.PlaneGeometry(w, h));
  return gateGeoCache.get(k);
}
function gateLabel(opt) {
  if (gateLabelCache.has(opt.name)) return gateLabelCache.get(opt.name);
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '104px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  ctx.fillText(opt.icon, 256, 82);
  const font = (px) => `bold ${px}px -apple-system,"PingFang SC","Hiragino Sans","Microsoft YaHei","Yu Gothic",sans-serif`;
  ctx.font = font(66);
  const w = ctx.measureText(opt.name).width;
  if (w > 480) ctx.font = font(Math.floor(66 * 480 / w));
  ctx.lineWidth = 12; ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.strokeText(opt.name, 256, 196);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(opt.name, 256, 196);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  gateLabelCache.set(opt.name, tex);
  return tex;
}

class Gate {
  constructor(game, z, kinds) {
    this.game = game;
    this.z = z;
    this.kinds = kinds;
    this.resolved = false;
    this.t = 0;
    this.removed = false;
    this.group = new THREE.Group();
    const rh = game.track.roadHalf;
    const w = rh - 0.5;
    this.panels = [];
    this.mats = [];
    for (let i = 0; i < 2; i++) {
      const opt = GATES[kinds[i]];
      const side = i === 0 ? 1 : -1; // 0 号门在 +x（屏幕左侧）
      const cx = side * rh / 2;
      const g = new THREE.Group();
      g.position.set(cx, 0, 0);
      const col = new THREE.Color(opt.color);
      const panelMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const panel = new THREE.Mesh(gateGeo(w, 4.2), panelMat);
      panel.position.y = 2.3;
      const labelMat = new THREE.MeshBasicMaterial({ map: gateLabel(opt), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const label = new THREE.Mesh(gateGeo(w * 0.9, w * 0.45), labelMat);
      label.position.set(0, 2.5, -0.06);
      label.rotation.y = Math.PI;
      const barMat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.2), fog: false });
      const bar = new THREE.Mesh(gateBarGeo, barMat);
      bar.scale.x = w + 0.4;
      bar.position.y = 4.6;
      const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3a44, metalness: 0.4, roughness: 0.5 });
      const p1 = new THREE.Mesh(gatePostGeo, postMat); p1.position.set(w / 2, 2.4, 0);
      const p2 = new THREE.Mesh(gatePostGeo, postMat); p2.position.set(-w / 2, 2.4, 0);
      g.add(panel, label, bar, p1, p2);
      this.group.add(g);
      this.panels.push(g);
      this.mats.push(panelMat, labelMat, barMat, postMat);
    }
    this.group.position.set(0, game.heightAt(0, z), z);
    game.scene.add(this.group);
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    this.t += dt;
    if (!this.resolved) {
      for (const pn of this.panels) pn.children[1].position.y = 2.5 + Math.sin(this.t * 3) * 0.12;
      if (p.alive && p.pos.z >= this.z) {
        this.resolved = true;
        this.chosen = p.pos.x >= 0 ? 0 : 1;
        this.t = 0;
        g.onGate(this.kinds[this.chosen], this.panels[this.chosen]);
      }
    } else {
      const k = Math.min(1, this.t / 0.6);
      this.panels.forEach((pn, i) => {
        if (i === this.chosen) pn.scale.setScalar(1 + k * 0.4);
        pn.children.forEach((c) => { if (c.material.transparent !== undefined) { c.material.transparent = true; c.material.opacity = (i === this.chosen ? 1 - k : 0.4 * (1 - k)); } });
      });
      if (k >= 1) this.removed = true;
    }
    if (this.z < p.pos.z - 25) this.removed = true;
  }

  dispose() {
    this.game.scene.remove(this.group);
    // 几何体与文字贴图是共享缓存，只释放材质
    for (const m of this.mats) m.dispose();
  }
}

// ---------------------------------------------------------------------
export class Game {
  /**
   * app: { renderer, scene, camera, audio, fxLayer, hudRoot, bannerEl, toastEl, thumbs, onResult, onPause }
   * opts: { levelIdx, endless, dinoId, riderId }
   */
  constructor(app, opts) {
    this.app = app;
    this.scene = app.scene;
    this.camera = app.camera;
    this.audio = app.audio;
    this.opts = opts;
    this.endless = !!opts.endless;
    this.levelIdx = opts.levelIdx ?? 0;
    this.level = this.endless ? null : LEVELS[this.levelIdx];
    this.biome = this.endless ? pick(BIOMES) : this.level.biome;
    this.length = this.endless ? Infinity : this.level.length;
    this.quality = save.settings.quality;
    // 首领战场压平：普通关卡在终点，无尽模式在每只首领出现处（后续由 addFlat 追加）
    const bossZ = this.endless ? ENDLESS_BOSS_EVERY : this.length;
    this.track = createTrack(this.biome, this.scene, { quality: this.quality, flat: [[bossZ - 40, bossZ + 140]] });
    setBendProfile(this.biome);
    updateBend(0, 1);
    this.world = this.track;
    this.heightAt = (x, z) => this.track.heightAt(x, z);
    this.dustColor = DUST[this.biome] ?? 0xa09070;
    this.rockColor = ROCK[this.biome];
    this.camFade = { value: 0 };
    applyCameraFade(this.track.root || this.scene, this.camFade);

    this.fx = {
      sparks: new Particles(this.scene, 3500, true),
      dust: new Particles(this.scene, 2200, false),
      rings: new Rings(this.scene),
      debris: new Debris(this.scene, this.heightAt, this.quality === 'high' ? 220 : 60),
      scorch: new Scorch(this.scene, this.heightAt),
      lights: null,
      streaks: new Streaks(this.scene),
    };
    this.fx.lights = this.quality === 'high' ? new LightFlashes(this.fx.rings) : null;
    this.fx.scorch.enabled = this.quality === 'high';
    this.juice = app.juice;
    this.juice.reset();
    this.killTimes = [];
    this.multiCd = 0;
    this.hazards = null;      // 跑图事件 / 路面机关（在玩家创建后初始化）
    this.fever = 0;           // 狂热槽 0..100，满了按 R 释放“远古觉醒”
    this.feverReady = false;
    this.comboTier = 0;
    this.perfectCd = 0;
    this.tele = new Telegraphs(this.scene, this.heightAt);
    this.text = new FloatingText(app.fxLayer);
    this.shake = new Shake();
    this.shake.enabled = save.settings.shake;
    this.projectiles = new Projectiles(this);
    this.enemies = [];
    this.pickups = [];
    this.gates = [];
    this.boss = null;
    this.shadows = new BlobShadows(this.scene);
    this.bars = new Bars(this.scene);
    const pm = PICKUP_MAKERS();
    this.coinMesh = new THREE.InstancedMesh(pm.coinGeo, pm.gold, 400);
    this.coinMesh.frustumCulled = false;
    this.coinMesh.count = 0;
    this.scene.add(this.coinMesh);

    this.dino = DINOS.find((d) => d.id === opts.dinoId) || DINOS[0];
    this.rider = RIDERS.find((r) => r.id === opts.riderId) || RIDERS[0];
    this.stats = { kills: 0, spawned: 0, coins: 0, dmgDealt: 0, dmgTaken: 0, maxCombo: 0, score: 0, skills: 0, bosses: 0, gates: 0 };
    this.player = new Player(this, this.dino, this.rider, computeStats(this.dino, this.rider, save.upgrades));
    this.hazards = new Hazards(this);
    this.player.pos.set(0, this.heightAt(0, 0), 0);

    this.cam = { x: 0, gy: this.heightAt(0, 0), gl: this.heightAt(0, 20), boss: 0, roll: 0 };
    this.camera.fov = 60;
    this.camera.updateProjectionMatrix();
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;

    this.hud = new Hud(app.hudRoot, app.fxLayer, { dino: this.dino, rider: this.rider, thumb: app.thumbs?.dino[this.dino.id], touch: input.isTouch, endless: this.endless });

    this.state = 'intro';
    this.stateT = 0;
    this.time = 0;
    this.hitstopT = 0;
    this.slowmoT = 0;
    this.combo = 0;
    this.comboT = 0;
    this.aimTarget = null;
    this.paused = false;
    this.finished = false;
    this.bannerTimer = null;
    this.timers = [];
    this.route = [];
    this.routeEvents = { ramp: -999, hazard: 0, goblin: 0, ambush: 0, egg: 0 };
    this.routeGen = 50;
    this.nextGate = 160;
    this.nextBossAt = this.endless ? ENDLESS_BOSS_EVERY : Infinity;
    this.bossCount = 0;
    this.countdown = -1;
    this.extendRoute(this.endless ? 600 : this.length - 45);

    this.audio.startMusic(this.biome);
    if (this.endless) this.showBanner(t('banner.endless'), t('banner.endlessSub', { biome: this.biomeName() }));
    else this.showBanner(this.level.name, t('banner.levelSub', { n: this.levelIdx + 1, len: this.length, boss: BOSSES[this.level.boss].name }));
    this.resize(this.viewW, this.viewH);
    this.updateCamera(1);
    this.warmup(app.renderer);
  }

  biomeName() { return LEVELS.find((l) => l.biome === this.biome)?.name ?? this.biome; }

  resize(w, h) {
    this.viewW = w; this.viewH = h;
    this.fx.sparks.setScale(h, this.camera.fov);
    this.fx.dust.setScale(h, this.camera.fov);
  }

  get controlsActive() { return !this.paused && this.player.alive && (this.state === 'run' || this.state === 'bossIntro' || this.state === 'boss'); }
  inputNeedsLock() { return false; }
  get progress() { return this.endless ? 0 : clamp(this.player.pos.z / this.length, 0, 1); }

  after(sec, fn) { this.timers.push({ t: sec, fn }); }

  // ------------------------------------------------------------------
  //  路线生成
  // ------------------------------------------------------------------
  difficultyAt(z) { return this.endless ? Math.min(1, z / 3000) : clamp(z / this.length, 0, 1); }

  mulAt(z) {
    if (this.endless) return { hp: (1 + z / 420 + Math.pow(z / 2500, 2)) * 0.72, dmg: 1 + z / 1600 };
    const p = this.difficultyAt(z);
    return { hp: this.level.mul * (1 + 1.6 * p) * 0.72, dmg: 1 + (this.level.mul - 1) * 0.5 + 0.3 * p };
  }

  poolAt(z) {
    if (!this.endless) return this.level.pool;
    const n = Math.min(ENDLESS_POOL.length, 3 + Math.floor(z / 350));
    const pool = {};
    for (let i = Math.max(0, n - 6); i < n; i++) pool[ENDLESS_POOL[i]] = 1 + (i === n - 1 ? 0 : 1);
    return pool;
  }

  pickWeighted(pool) {
    const entries = Object.entries(pool);
    let r = Math.random() * entries.reduce((a, [, w]) => a + w, 0);
    for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
    return entries[0][0];
  }

  extendRoute(toZ) {
    let z = this.routeGen;
    const L = this.endless ? Infinity : this.length;
    while (z < toZ && z < L - 45) {
      const p = this.difficultyAt(z);
      if (z >= this.nextBossAt - 60) break; // 首领前留出空地
      if (z >= this.nextGate) {
        this.route.push({ z, kind: 'gate' });
        this.nextGate += 200 + rand(0, 50);
        z += 30;
        continue;
      }
      const ev = this.routeEvents;
      const nearGate = Math.abs(z - this.nextGate) < 45;
      // 跑图事件：跳台 / 天灾区 / 宝藏哥布林 / 精英伏击 / 恐龙蛋（各自有最小间隔）
      if (p > 0.12 && !nearGate && z - ev.ambush > 380 && Math.random() < 0.07 + p * 0.05) {
        ev.ambush = z;
        this.route.push({ z, kind: 'ambush' });
        z += 45;
        continue;
      }
      if (p > 0.18 && !nearGate && z - ev.hazard > 300 && Math.random() < 0.09) {
        ev.hazard = z;
        this.route.push({ z, kind: 'hazard', len: 60 + p * 30 });
      }
      this.route.push({ z, kind: 'formation', p });
      if (!nearGate && z - ev.ramp > 150 && Math.random() < 0.16) {
        ev.ramp = z;
        this.route.push({ z: z + rand(16, 22), kind: 'ramp', x: rand(-4, 4) });
      } else if (Math.random() < 0.55) this.route.push({ z: z + rand(14, 20), kind: 'coins' });
      if (p > 0.08 && z - ev.goblin > 340 && Math.random() < 0.06) { ev.goblin = z; this.route.push({ z: z + 10, kind: 'goblin' }); }
      if (z - ev.egg > 420 && Math.random() < 0.05) { ev.egg = z; this.route.push({ z: z + rand(10, 20), kind: 'egg', x: rand(-5, 5) }); }
      if (p > 0.1 && Math.random() < 0.26) this.route.push({ z: z + rand(18, 26), kind: 'prop', prop: Math.random() < 0.35 ? 'chest' : 'rock' });
      z += lerp(38, 25, p) * rand(0.85, 1.15);
    }
    this.routeGen = z;
    this.route.sort((a, b) => a.z - b.z);
  }

  spawnEvent(ev) {
    if (this.hazards.spawn(ev)) return;
    const rh = this.track.roadHalf;
    const mul = this.mulAt(ev.z);
    if (ev.kind === 'gate') {
      const OFF = ['count', 'rate', 'dmg', 'pierce'];
      const UTIL = ['heal', 'shield', 'skill', 'xp', 'magnet'];
      const a = pick(OFF);
      let b;
      if (this.player.hp / this.player.stats.maxHp < 0.5) b = 'heal';
      else if (Math.random() < 0.2) b = 'gamble';
      else b = Math.random() < 0.5 ? pick(OFF.filter((k) => k !== a)) : pick(UTIL);
      this.gates.push(new Gate(this, ev.z, shuffle([a, b])));
      return;
    }
    if (ev.kind === 'coins') {
      const n = randInt(6, 9);
      const x0 = rand(-rh + 2, rh - 2);
      const zig = Math.random() < 0.5;
      for (let i = 0; i < n; i++) {
        const x = zig ? clamp(x0 + Math.sin(i * 0.8) * 3.5, -rh + 1.5, rh - 1.5) : x0;
        this.spawnPickup('coin', _v.set(x, 0, ev.z + i * 2.4), 1, true);
      }
      return;
    }
    if (ev.kind === 'prop') {
      const x = rand(-rh + 2.5, rh - 2.5);
      this.enemies.push(new Prop(this, ev.prop, x, ev.z, mul.hp));
      return;
    }
    // 阵型
    const p = ev.p;
    const pool = this.poolAt(ev.z);
    const type = this.pickWeighted(pool);
    const lvl = this.endless ? Math.min(6, ev.z / 500) : this.levelIdx;
    let n = Math.round(5 + p * 6 + lvl * 0.6 + rand(0, 2));
    const big = ENEMIES[type].radius > 1.3;
    const ranged = !!ENEMIES[type].ranged;
    if (big) n = Math.max(3, Math.round(n * 0.5));
    if (ranged) n = Math.max(3, Math.round(n * 0.6)); // 远程怪数量少一些
    const shapes = ['row', 'row', 'column', 'v', 'cluster', 'cluster', 'flank', 'swarm', 'swarm'];
    let shape = pick(shapes);
    const eliteType = this.endless ? pick(['yeti', 'golem', 'darkKnight']) : this.level.elite;
    const elite = p > 0.15 && Math.random() < 0.08 + p * 0.15;
    const spots = [];
    const W = rh - 1.5;
    if (elite) {
      spots.push({ x: rand(-3, 3), z: ev.z, t: eliteType, elite: true });
      for (let i = 0; i < 3; i++) spots.push({ x: rand(-W, W), z: ev.z - rand(3, 6), t: type });
    } else if (shape === 'row') {
      for (let i = 0; i < n; i++) spots.push({ x: n === 1 ? 0 : -W + (2 * W) * i / (n - 1), z: ev.z + rand(-0.5, 0.5), t: type });
    } else if (shape === 'column') {
      const x = rand(-W + 1, W - 1);
      for (let i = 0; i < n; i++) spots.push({ x: x + rand(-0.4, 0.4), z: ev.z + i * 3, t: type });
    } else if (shape === 'v') {
      for (let i = 0; i < n; i++) { const o = i - (n - 1) / 2; spots.push({ x: clamp(o * 2.4, -W, W), z: ev.z + Math.abs(o) * 2.6, t: type }); }
    } else if (shape === 'swarm' && !big && !ranged) {
      // 怪物潮：一大群小怪挤在一起冲过来
      const m = Math.round(n * 1.8);
      for (let i = 0; i < m; i++) spots.push({ x: rand(-W, W), z: ev.z + rand(0, 10), t: type });
    } else if (shape === 'flank') {
      for (let i = 0; i < n; i++) spots.push({ x: (i % 2 ? 1 : -1) * (W - 0.5), z: ev.z + Math.floor(i / 2) * 3, t: type });
    } else {
      for (let i = 0; i < n; i++) spots.push({ x: rand(-W, W), z: ev.z + rand(-4, 5), t: type });
    }
    for (const s of spots) {
      const e = this.spawnEnemy(s.t, s.x, s.z, mul, true);
      if (s.elite) { e.elite = true; e.maxHp = e.hp = Math.round(e.hp * 1.6); e.xp *= 2; }
    }
  }

  // ------------------------------------------------------------------
  //  主循环
  // ------------------------------------------------------------------
  update(realDt) {
    if (this.paused) return;
    if (!this.finished && input.pressed('pause')) { this.app.onPause(); return; }

    let ts = 1;
    if (this.hitstopT > 0) { this.hitstopT -= realDt; ts = 0.08; }
    if (this.slowmoT > 0) { this.slowmoT -= realDt; ts = Math.min(ts, 0.3); }
    const dt = realDt * ts;
    this.stateT += dt;
    if (this.state !== 'intro' && this.state !== 'win' && this.state !== 'lose') this.time += dt;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= realDt;
      if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); }
    }

    const m = input.consumeMouse();
    const p = this.player;
    this.aimTarget = p.alive ? this.findTarget() : null;
    p.update(dt, {
      enabled: this.controlsActive,
      run: this.state === 'run',
      steer: input.steer(),
      drag: m.dx,
      dragScale: (this.track.roadHalf * 2) / Math.max(400, this.viewW * 0.55),
      jump: input.pressed('jump'),
      skill: input.pressed('skill'),
      ult: input.pressed('ult'),
    });

    // 路线事件
    if (this.state === 'run') {
      if (this.endless && this.routeGen < p.pos.z + 400) this.extendRoute(p.pos.z + 700);
      while (this.route.length && this.route[0].z <= p.pos.z + SPAWN_AHEAD) this.spawnEvent(this.route.shift());
    }

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(dt);
      if (e.removed) {
        e.dispose();
        this.enemies.splice(i, 1);
        if (e === this.boss && this.state !== 'bossDown' && this.state !== 'win') this.boss = null;
      }
    }
    this.hazards.update(dt);
    this.separate();
    this.collisions();
    for (let i = this.gates.length - 1; i >= 0; i--) {
      const gt = this.gates[i];
      gt.update(dt);
      if (gt.removed) { gt.dispose(); this.gates.splice(i, 1); }
    }
    this.projectiles.update(dt);
    this.updatePickups(dt);
    this.updateFlow(dt);

    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) { this.combo = 0; this.comboTier = 0; } }
    if (this.perfectCd > 0) this.perfectCd -= realDt;
    this.fx.sparks.update(dt);
    this.fx.dust.update(dt);
    this.fx.rings.update(dt);
    this.fx.debris.update(dt);
    this.fx.scorch.update(dt);
    this.fx.lights?.update(dt);
    if (this.multiCd > 0) this.multiCd -= realDt;
    this.tele.update(dt);
    this.track.update(dt, this.time + this.stateT, p.pos);

    updateBend(p.pos.z, 1);
    this.updateCamera(realDt);
    this.shake.apply(this.camera, realDt);
    this.renderBatches();
    this.text.update(realDt, this.camera, this.viewW, this.viewH);
    this.hud.update(this, realDt);
  }

  updateFlow() {
    const p = this.player;
    switch (this.state) {
      case 'intro': {
        const st = this.stateT;
        const c = st < 1.6 ? -1 : st < 2.1 ? 3 : st < 2.6 ? 2 : st < 3.1 ? 1 : 0;
        if (c !== this.countdown && c >= 0) {
          this.countdown = c;
          if (c > 0) { this.showBanner(String(c), '', false, 450); this.audio.play('countdown'); }
          else { this.showBanner(t('banner.go'), t('banner.goSub'), false, 1400); this.audio.play('waveStart'); this.state = 'run'; this.stateT = 0; }
        }
        break;
      }
      case 'run':
        if (!this.endless && p.pos.z >= this.length) this.startBoss(this.level.boss, { hp: 1, dmg: 1 });
        else if (this.endless && p.pos.z >= this.nextBossAt) {
          const keys = Object.keys(BOSSES);
          const z = p.pos.z;
          this.startBoss(keys[this.bossCount % keys.length], { hp: 0.5 + z / 800 + Math.pow(z / 3000, 2), dmg: 0.8 + z / 3000 });
        }
        break;
      case 'bossIntro':
        if (this.boss && this.boss.state === 'fight') { this.state = 'boss'; this.stateT = 0; }
        break;
      case 'bossDown':
        if (this.stateT > 2.4 && !this.finished) this.victory();
        break;
    }
  }

  startBoss(type, mul) {
    const p = this.player;
    this.state = 'bossIntro';
    this.stateT = 0;
    // 清掉残余小怪
    for (const e of this.enemies) if (e.alive && !e.isBoss) this.killEnemy(e, true);
    this.projectiles.list.filter((pr) => pr.owner === 'enemy').forEach((pr) => { pr.life = 0; });
    this.route.length = 0;
    this.hazards.clearZones();
    this.tele.clear();
    this.boss = new Boss(this, type, 0, p.pos.z + 30, mul);
    this.enemies.push(this.boss);
    this.hud.showBoss(this.boss);
    this.audio.startMusic('boss');
    this.audio.play('bossAppear');
    p.heal(p.stats.maxHp * 0.25);
    this.after(0.3, () => this.showBanner(this.boss.def.name, t('banner.bossSub', { title: this.boss.def.title }), true));
  }

  onBossDeath(boss) {
    this.slowmoT = 2;
    this.shake.add(0.5);
    this.juice.flash(0xffffff, 0.8);
    this.juice.radial(2.2);
    this.juice.aberr(2);
    this.juice.bloom(1.2);
    this.juice.fovKick(-6);
    this.fx.debris.burst(boss.pos, { count: 40, speed: 14, up: 14, size: 0.6, color: boss.def.color ?? 0x5a4a4a, color2: this.rockColor });
    this.fx.rings.pillar(boss.pos, { r: boss.radius * 1.5, h: 40, life: 1.6, color: boss.def.projColor, opacity: 0.8 });
    this.fx.lights?.flash(boss.pos, boss.def.projColor, 120, 40, 1.2);
    this.audio.play('bossDie');
    this.stats.bosses++;
    this.bossCount++;
    this.hitstopT = 0;
    for (let i = 0; i < 16; i++) this.spawnPickup('coin', boss.pos, Math.round(boss.maxHp / 600) + 1);
    for (const e of this.enemies) if (e !== boss && e.alive) this.killEnemy(e, true);
    this.projectiles.list.filter((pr) => pr.owner === 'enemy').forEach((pr) => { pr.life = 0; });
    this.tele.clear();
    if (this.endless) {
      this.showBanner(t('banner.bossDown'), t('banner.bossDownSub'));
      this.after(2.6, () => {
        this.hud.hideBoss();
        this.boss = null;
        this.audio.startMusic(this.biome);
        this.nextBossAt = this.player.pos.z + ENDLESS_BOSS_EVERY;
        this.track.addFlat(this.nextBossAt - 40, this.nextBossAt + 140);
        this.routeGen = this.player.pos.z + 60;
        this.nextGate = this.routeGen + 40;
        this.extendRoute(this.player.pos.z + 700);
        this.state = 'run'; this.stateT = 0;
      });
      return;
    }
    this.state = 'bossDown';
    this.stateT = 0;
  }

  victory() {
    this.finished = true;
    this.state = 'win';
    this.stateT = 0;
    this.player.cheer = true;
    this.hud.hideBoss();
    this.audio.startMusic('victory');
    this.audio.play('victory');
    this.showBanner(t('banner.win'), t('banner.winSub', { name: this.level.name }));
    for (const pk of this.pickups) pk.magnet = true;
    input.releaseAll();
    const hpR = this.player.hp / this.player.stats.maxHp;
    const killRate = this.stats.spawned ? this.stats.kills / this.stats.spawned : 1;
    const stars = 1 + (hpR >= 0.5 ? 1 : 0) + (killRate >= 0.7 ? 1 : 0);
    this.after(3, () => {
      const coinsGained = this.stats.coins;
      const reward = Math.round(this.level.reward * (0.6 + 0.2 * stars));
      const firstClear = !save.cleared && this.levelIdx === LEVELS.length - 1;
      save.coins += coinsGained + reward;
      save.stars[this.levelIdx] = Math.max(save.stars[this.levelIdx] || 0, stars);
      save.unlocked = Math.min(LEVELS.length, Math.max(save.unlocked, this.levelIdx + 2));
      if (!save.bestTime[this.levelIdx] || this.time < save.bestTime[this.levelIdx]) save.bestTime[this.levelIdx] = Math.round(this.time);
      save.stats.kills += this.stats.kills;
      save.stats.bosses += this.stats.bosses;
      save.stats.wins++;
      save.dinoWins[this.dino.id] = (save.dinoWins[this.dino.id] || 0) + 1;
      if (this.levelIdx === LEVELS.length - 1) save.cleared = true;
      persist();
      this.app.onResult({
        win: true, stars, hpR, killRate, time: this.time, coins: coinsGained, reward, kills: this.stats.kills,
        maxCombo: this.stats.maxCombo, score: Math.round(this.stats.score), dmg: Math.round(this.stats.dmgDealt),
        weaponLv: this.player.weapon.level, levelIdx: this.levelIdx, firstClear, final: this.levelIdx === LEVELS.length - 1,
      });
    });
  }

  onPlayerDeath() {
    this.audio.setMusicRate(1);
    if (this.finished) return;
    this.finished = true;
    this.state = 'lose';
    this.stateT = 0;
    this.slowmoT = 1.4;
    this.audio.play('defeat');
    this.audio.stopMusic(2);
    const dist = Math.round(this.player.pos.z);
    this.showBanner(this.endless ? t('banner.endlessOver') : t('banner.lose'), this.endless ? t('banner.distSub', { n: dist }) : t('banner.loseSub'), true);
    input.releaseAll();
    this.after(3, () => {
      save.coins += this.stats.coins;
      save.stats.kills += this.stats.kills;
      save.stats.bosses += this.stats.bosses;
      let newBest = false;
      if (this.endless && dist > save.endlessBest) { save.endlessBest = dist; newBest = true; }
      persist();
      this.app.onResult({
        win: false, endless: this.endless, dist, newBest, time: this.time, coins: this.stats.coins,
        kills: this.stats.kills, maxCombo: this.stats.maxCombo, score: Math.round(this.stats.score), dmg: Math.round(this.stats.dmgDealt),
        weaponLv: this.player.weapon.level, levelIdx: this.levelIdx, progress: this.progress, bossReached: !!this.boss,
      });
    });
  }

  onWeaponLevel(lv) {
    const L = WEAPON_LEVELS[lv];
    this.audio.play('levelUp');
    this.hud.levelUp(lv, L.name);
    this.fx.sparks.burst(this.player.center, { count: 40, speed: 6, life: 0.8, size: 0.8, color: 0x7fe8ff, color2: 0xffffff, up: 3, radius: this.player.radius });
    this.fx.rings.ring(this.player.pos, { r0: 1, r1: 6, life: 0.5, color: 0x7fe8ff });
    // 螺旋上升的能量喷泉 + 光柱
    const pp = this.player.pos, R = this.player.radius + 0.8;
    for (let i = 0; i < 48; i++) {
      const a = i * 0.52, k = i / 48;
      this.fx.sparks.spawn(pp.x + Math.cos(a) * R, pp.y + 0.3 + k * 1.5, pp.z + Math.sin(a) * R,
        -Math.sin(a) * 3.5, 5 + k * 6, Math.cos(a) * 3.5, 0.9 + k * 0.4, 0.9, 0.1, 0x7fe8ff, k > 0.5 ? 0xffffff : 0x46a0ff, 1, -2, 1.5);
    }
    this.fx.rings.pillar(pp, { r: R, h: 10, life: 0.7, color: 0x7fe8ff, opacity: 0.5 });
    this.juice.flash(0x7fe8ff, 0.18);
    this.juice.bloom(0.35);
  }

  onGate(kind, panel) {
    const opt = GATES[kind];
    this.player.applyGate(kind);
    if (kind === 'gamble') this.after(0.35, () => this.rollGamble());
    this.stats.gates++;
    this.audio.play('powerup');
    this.toast(`${opt.icon} ${opt.name}`);
    panel.getWorldPosition(_v);
    _v.y += 2.4;
    this.fx.sparks.burst(_v, { count: 50, speed: 8, life: 0.8, size: 0.9, color: opt.color, color2: 0xffffff });
    this.juice.flash(opt.color, 0.22);
    this.juice.fovKick(3);
  }

  // ------------------------------------------------------------------
  //  战斗接口
  // ------------------------------------------------------------------
  spawnEnemy(type, x, z, mul, counted = false) {
    const rh = this.track.roadHalf - 1;
    x = clamp(x, -rh, rh);
    const e = new Enemy(this, type, x, z, mul || this.mulAt(z));
    this.enemies.push(e);
    if (counted) this.stats.spawned++;
    return e;
  }

  damageEnemy(e, dmg, o = {}) {
    if (!e.alive) return 0;
    if (e.isBoss && (e.invulnT > 0 || e.state !== 'fight' || e.anim.burrow > 0.5)) {
      if (o.source !== 'dot' && Math.random() < 0.2) { e.getCenter(_v); _v.y += e.halfHeight; this.text.add(_v, t('float.immune'), 'info', 0.6); }
      return 0;
    }
    const d = Math.max(1, dmg);
    e.hp -= d;
    this.stats.dmgDealt += d;
    const isDot = o.source === 'dot';
    if (!isDot) {
      e.hurt = 1;
      e.flashT = 0.12;
      e.barT = 3;
      if (!e.isProp) {
        this.combo++;
        this.comboT = 2.6;
        if (this.combo > this.stats.maxCombo) this.stats.maxCombo = this.combo;
        this.checkComboTier();
      }
      if (e.isBoss) this.addFever(d / e.maxHp * 70);
      e.applyStatus({ ...o, dotBase: d });
    }
    if (o.source !== 'ram' || e.hp > 0) {
      e.getCenter(_v);
      _v.y += e.halfHeight * 0.8 + 0.3;
      const cls = o.crit ? 'crit' : isDot ? (o.dotColor === 'poison' ? 'poison' : 'burn') : '';
      this.text.add(_v, Math.round(d) + (o.crit ? '!' : ''), cls, isDot ? 0.6 : 0.8);
    }
    if (o.crit) {
      this.audio.play('crit', { volume: 0.45 });
      // 暴击：星形火花 + 小冲击环
      e.getCenter(_v2);
      this.fx.sparks.burst(_v2, { count: 14, speed: 9, life: 0.28, size: 0.7, sizeEnd: 0, color: 0xffffff, color2: 0xffd040, drag: 3 });
      if (!isDot) this.fx.rings.ring(_v2, { r0: 0.3, r1: 2.2 + e.radius, life: 0.22, color: 0xffe070, opacity: 0.8, y: 0 });
    }
    else if (!isDot) this.audio.play('enemyHurt', { volume: 0.22, pitch: rand(0.9, 1.25) });
    if (!isDot && this.player.buffs.frenzy > 0 && o.source === 'melee') this.player.heal(d * (this.dino.skill.lifesteal || 0.2));
    if (e.isBoss) e.checkPhase();
    if (e.treasure && !isDot && Math.random() < 0.45) this.spawnPickup('coin', e.pos, 1);
    if (e.hp <= 0) this.killEnemy(e);
    return d;
  }

  // ------------------------------------------------------------------
  //  狂热槽 / 远古觉醒 / 连击档位 / 完美闪避
  // ------------------------------------------------------------------
  addFever(n) {
    if (this.player.buffs.rage > 0 || !this.player.alive) return;
    this.fever = Math.min(100, this.fever + n);
    if (this.fever >= 100 && !this.feverReady) {
      this.feverReady = true;
      this.toast(t('toast.feverReady'));
      this.audio.play('powerup', { volume: 0.7, pitch: 1.25 });
      this.juice.flash(0xffc040, 0.15);
    }
  }

  /** 连击射速加成（最多 +30%） */
  comboBonus() { return Math.min(this.combo, 100) * 0.003; }

  checkComboTier() {
    let tier = 0;
    for (let i = 0; i < COMBO_TIERS.length; i++) if (this.combo >= COMBO_TIERS[i]) tier = i + 1;
    if (tier <= this.comboTier) return;
    this.comboTier = tier;
    this.hud.comboTier(tier, t('combo.tier' + tier));
    this.addFever(2 + tier * 2);
    this.audio.play('star', { volume: 0.55, pitch: 0.9 + tier * 0.12 });
    this.juice.aberr(0.4 + tier * 0.2);
    if (tier >= 3) this.juice.bloom(0.3);
  }

  onRageStart() {
    const p = this.player;
    this.feverReady = false;
    this.slowmoT = Math.max(this.slowmoT, 0.45);
    this.showBanner(t('banner.rage'), t('banner.rageSub'), false, 1300);
    this.audio.roar(1.6, { volume: 1 });
    this.audio.play('frenzy', { volume: 0.8 });
    this.audio.setMusicRate(1.25);
    this.juice.flash(0xffc040, 0.55);
    this.juice.radial(1.8);
    this.juice.aberr(1.4);
    this.juice.bloom(0.9);
    this.juice.fovKick(-6);
    this.juice.setTint(0xffb040);
    this.fx.rings.ring(p.pos, { r0: 1, r1: 18, life: 0.7, color: 0xffc040 });
    this.fx.rings.pillar(p.pos, { r: p.radius * 1.6, h: 30, life: 1, color: 0xffb020, opacity: 0.8 });
    this.fx.sparks.burst(p.center, { count: 90, speed: 14, life: 0.9, size: 1.1, color: 0xffe070, color2: 0xff3000, up: 5 });
    this.fx.lights?.flash(p.pos, 0xffb040, 90, 30, 0.8);
  }

  onRageEnd() {
    const p = this.player;
    this.audio.setMusicRate(1);
    // 觉醒结束：全屏冲击波清场
    const n = this.aoe(p.pos, 16, p.stats.atk * 2, { knock: 16, up: 10, stun: 1, source: 'skill' });
    this.fx.rings.ring(p.pos, { r0: 2, r1: 18, life: 0.8, color: 0xffe0a0, opacity: 0.9 });
    this.fx.rings.disc(p.pos, { r: 14, life: 0.35, color: 0xffd080, opacity: 0.6 });
    this.fx.debris.burst(p.pos, { count: 30, speed: 14, up: 12, size: 0.45, color: this.rockColor ?? 0x7a6a5a });
    this.fx.scorch.add(p.pos, 7, 6);
    this.audio.play('quake', { volume: 1 });
    this.audio.play('explosion', { volume: 0.8, pitch: 0.7 });
    this.shake.add(0.5);
    this.juice.flash(0xfff0c0, 0.5);
    this.juice.radial(1.5);
    this.juice.fovKick(-5);
    this.hitstop(n > 0 ? 0.08 : 0.04);
  }

  /** 完美闪避：跳过怪物 / 首领攻击擦身而过 */
  onPerfect(pos, big = true) {
    if (this.perfectCd > 0 || !this.player.alive) return;
    this.perfectCd = big ? 0.6 : 0.25;
    if (!big) {
      // 擦弹：小奖励
      this.addFever(1.5);
      this.fx.sparks.burst(pos, { count: 8, speed: 5, life: 0.25, size: 0.5, color: 0x9ff0ff, color2: 0xffffff });
      return;
    }
    this.addFever(7);
    this.slowmoT = Math.max(this.slowmoT, 0.18);
    this.juice.flash(0x60e0ff, 0.18);
    this.juice.aberr(0.6);
    this.floatText(this.player.pos, t('float.perfect'), 'info', this.player.top + 2.5);
    this.fx.rings.ring(this.player.pos, { r0: 0.5, r1: 5, life: 0.35, color: 0x60e0ff });
    for (let i = 0; i < 3; i++) this.spawnPickup('coin', this.player.pos, 1);
    this.audio.play('star', { volume: 0.6, pitch: 1.5 });
  }

  // ------------------------------------------------------------------
  //  宝藏哥布林 / 炸弹 / 命运骰子
  // ------------------------------------------------------------------
  onGoblinCaught(e) {
    for (let i = 0; i < 22; i++) this.spawnPickup('coin', e.pos, 2);
    this.spawnPickup('crystal', e.pos);
    e.getCenter(_v2);
    this.fx.sparks.burst(_v2, { count: 80, speed: 12, life: 1, size: 1, color: 0xffe070, color2: 0xffa000, up: 8, gravity: 8 });
    this.fx.rings.pillar(e.pos, { r: 1.2, h: 14, life: 0.8, color: 0xffd040 });
    this.floatText(e.pos, t('float.goblinCaught'), 'crit', 3);
    this.addFever(6);
    this.juice.flash(0xffd040, 0.25);
    this.hitstop(0.06);
    this.audio.play('victory', { volume: 0.4, pitch: 1.4 });
  }

  onGoblinEscape(e) {
    e.getCenter(_v2);
    this.fx.sparks.burst(_v2, { count: 30, speed: 5, life: 0.6, size: 0.9, color: 0xffffff, color2: 0xffd040, up: 3 });
    this.fx.dust.burst(_v2, { count: 14, speed: 3, life: 0.8, size: 1.4, sizeEnd: 3, color: 0xd0c8b0, alpha: 0.6, up: 2 });
    this.floatText(e.pos, t('float.goblinEscaped'), 'info', 2.5);
    e.alive = false;
    e.removed = true;
  }

  bombBlast() {
    const p = this.player;
    const n = this.aoe(p.pos, 30, p.stats.atk * 4 + 60 * this.mulAt(p.pos.z).hp, { knock: 16, up: 10, stun: 1, source: 'skill' });
    _v2.set(p.pos.x, p.pos.y, p.pos.z + 8);
    this.fx.rings.ring(_v2, { r0: 2, r1: 30, life: 0.7, color: 0xffa040 });
    this.fx.rings.disc(_v2, { r: 12, life: 0.25, color: 0xffa040, opacity: 0.35 });
    this.fx.sparks.burst(_v2, { count: 60, speed: 22, life: 0.6, size: 0.8, color: 0xffd060, color2: 0xff3000, up: 6 });
    this.fx.debris.burst(_v2, { count: 30, speed: 16, up: 14, size: 0.5, color: this.rockColor ?? 0x7a6a5a, color2: 0x2a2420 });
    this.fx.scorch.add(_v2, 9, 6);
    this.fx.lights?.flash(_v2, 0xff9040, 140, 40, 0.6);
    this.juice.flash(0xfff0c0, 0.4);
    this.juice.radial(1.6);
    this.juice.bloom(0.6);
    this.juice.fovKick(-5);
    this.shake.add(0.5);
    this.hitstop(n > 0 ? 0.08 : 0.04);
    this.audio.play('explosion', { volume: 1, pitch: 0.6 });
    this.floatText(p.pos, t('float.bomb'), 'crit', p.top + 3);
  }

  rollGamble() {
    const p = this.player;
    if (!p.alive) return;
    const r = Math.random();
    let key;
    if (r < 0.2) {
      key = 'wlv';
      let need = 0;
      for (let lv = p.weapon.level; lv < Math.min(WEAPON_MAX, p.weapon.level + 2); lv++) need += XP_NEED[lv];
      p.addXp(Math.max(1, need - p.weapon.xp));
    } else if (r < 0.38) { key = 'fever'; this.addFever(100); p.buffs.shield = 8; }
    else if (r < 0.54) { key = 'egg'; this.hazards.hatch(2); }
    else if (r < 0.7) { key = 'coins'; for (let i = 0; i < 24; i++) this.spawnPickup('coin', p.pos, 2); }
    else if (r < 0.85) { key = 'slow'; p.slowMul = 0.6; p.slowT = 3; }
    else { key = 'hurt'; p.takeDamage(p.stats.maxHp * 0.12, { kind: 'chip' }); }
    const good = r < 0.7;
    this.showBanner(t('gamble.' + key), '', !good, 1200);
    this.audio.play(good ? 'star' : 'error', { volume: 0.7, pitch: good ? 1.2 : 0.8 });
    if (good) { this.juice.flash(0xff60c0, 0.2); this.fx.sparks.burst(p.center, { count: 50, speed: 9, life: 0.8, size: 0.9, color: 0xff80e0, color2: 0xffffff, up: 4 }); }
  }

  /** 击杀演出：精英击破 / 多重击杀 */
  onKillFx(e) {
    const now = this.time;
    this.killTimes.push(now);
    while (this.killTimes.length && now - this.killTimes[0] > 0.45) this.killTimes.shift();
    if (e.elite) {
      e.getCenter(_v2);
      const busy = this.killTimes.length > 6;
      this.fx.rings.pillar(e.pos, { r: e.radius + 0.6, h: 16, life: 0.9, color: 0xffd040, opacity: busy ? 0.35 : 0.75 });
      this.fx.rings.ring(e.pos, { r0: 1, r1: 10, life: 0.6, color: 0xffd040 });
      this.fx.sparks.burst(_v2, { count: busy ? 20 : 70, speed: 12, life: 0.9, size: 1, color: 0xffe080, color2: 0xff8000, up: 6 });
      for (let i = 0; i < 8; i++) this.spawnPickup('coin', e.pos, 2);
      this.floatText(e.pos, t('float.eliteDown'), 'crit', e.halfHeight * 2 + 2);
      this.juice.flash(0xffd040, 0.3);
      this.juice.bloom(0.5);
      this.hitstop(0.07);
      this.audio.play('powerup', { volume: 0.6, pitch: 0.8 });
    }
    const n = this.killTimes.length;
    if (n >= 5 && this.multiCd <= 0) {
      this.multiCd = 1.2;
      this.slowmoT = Math.max(this.slowmoT, 0.22);
      this.juice.radial(1.1);
      this.juice.aberr(0.6);
      this.floatText(this.player.pos, t('float.multi', { n }), 'crit', this.player.top + 3);
      this.audio.play('levelUp', { volume: 0.45, pitch: 1.4 });
    }
  }

  killEnemy(e, silent = false) {
    if (!e.alive) return;
    e.hp = 0;
    e.kill();
    e.getCenter(_v);
    const col = e.def.color ?? 0xffffff;
    // 同一瞬间死很多只时（炸弹 / 大招）减少每只的粒子，避免满屏发白
    const crowd = e.isBoss ? 1 : this.killTimes.length > 6 ? 0.35 : 1;
    this.fx.sparks.burst(_v, { count: e.isBoss ? 80 : Math.round(16 * crowd), speed: e.isBoss ? 14 : 6, life: 0.6, size: 0.8, color: 0xfff0c0, color2: col });
    this.fx.dust.burst(_v, { count: e.isBoss ? 40 : Math.round(8 * crowd), speed: 3, life: 0.8, size: 1.2, sizeEnd: 2.5, color: col, alpha: 0.5, up: 1.5 });
    if (e.isBoss) { this.onBossDeath(e); return; }
    if (silent) return;
    if (!e.isProp) {
      this.stats.kills++;
      this.onKillFx(e);
      this.addFever(e.elite ? 5 : 0.7);
      this.stats.score += (e.def.score || 10) * (1 + Math.min(this.combo, 50) * 0.02);
      this.audio.play('enemyDie', { volume: 0.4, pitch: rand(0.85, 1.15) });
    } else {
      this.audio.play(e.type === 'chest' ? 'coin' : 'explosion', { volume: 0.6, pitch: e.type === 'chest' ? 0.8 : 1.4 });
      this.fx.dust.burst(_v, { count: 20, speed: 5, life: 0.8, size: 1, sizeEnd: 2, color: e.type === 'chest' ? 0x8a5a2a : this.rockColor, alpha: 0.7, up: 4, gravity: 10 });
    }
    this.player.addXp(e.xp || 1);
    const coins = e.def.coins || 1;
    const total = e.isProp ? coins : Math.max(1, Math.round(coins * 0.45));
    const n = Math.min(e.isProp ? 8 : 2, total);
    for (let i = 0; i < n; i++) this.spawnPickup('coin', e.pos, Math.max(1, Math.round(total / n)));
    const r = Math.random();
    if (e.type === 'chest') { this.spawnPickup(r < 0.35 ? 'power' : r < 0.6 ? 'meat' : r < 0.8 ? 'egg' : 'bomb', e.pos); return; }
    if (e.treasure) { this.onGoblinCaught(e); return; }
    if (r < 0.06) this.spawnPickup('meat', e.pos);
    else if (r < 0.1) this.spawnPickup('crystal', e.pos);
    else if (r < 0.12) this.spawnPickup('power', e.pos);
    else if (r < 0.132) this.spawnPickup('magnet', e.pos);
    else if (r < 0.142) this.spawnPickup('bomb', e.pos);
  }

  aoe(center, radius, dmg, o = {}) {
    let n = 0;
    for (const e of this.enemies) {
      if (!e.targetable) continue;
      const dx = e.pos.x - center.x, dz = e.pos.z - center.z;
      const d = Math.hypot(dx, dz) - e.radius;
      if (d > radius) continue;
      if (e.flying && e.hoverY > 6) continue;
      _dir.set(dx, 0, dz);
      if (_dir.lengthSq() < 1e-4) _dir.set(0, 0, 1);
      _dir.normalize();
      const crit = Math.random() < this.player.stats.crit;
      this.damageEnemy(e, dmg * (crit ? 1.8 : 1), { ...o, crit, dir: _dir.clone() });
      n++;
    }
    return n;
  }

  aoeBox(z0, z1, halfW, dmg, o = {}) {
    let n = 0;
    for (const e of this.enemies) {
      if (!e.targetable || e.pos.z < z0 || e.pos.z > z1 + e.radius || Math.abs(e.pos.x) > halfW) continue;
      const crit = Math.random() < this.player.stats.crit;
      this.damageEnemy(e, dmg * (crit ? 1.8 : 1), { ...o, crit, dir: new THREE.Vector3(0, 0, 1) });
      n++;
    }
    return n;
  }

  nearestEnemy(pos, maxDist, exclude) {
    let best = null, bd = maxDist;
    for (const e of this.enemies) {
      if (!e.targetable || e.isProp || (exclude && exclude.has(e))) continue;
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** 骑手自动瞄准：前方视野里最靠近的目标 */
  findTarget() {
    const p = this.player;
    let best = null, bs = Infinity;
    for (const e of this.enemies) {
      if (!e.targetable) continue;
      const dz = e.pos.z - p.pos.z;
      if (dz < 1.5 || dz > 75) continue;
      const dx = Math.abs(e.pos.x - p.pos.x);
      if (dx > 5 + dz * 0.45) continue;
      const s = dz + dx * 2.2 + (e.isProp ? (e.type === 'chest' ? 6 : 14) : 0) - (e.isBoss ? 10 : 0);
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }

  hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); }
  shakeAt(pos, amount) {
    const d = Math.hypot(pos.x - this.player.pos.x, pos.z - this.player.pos.z);
    this.shake.add(amount * clamp(1.2 - d / 40, 0.15, 1) * 0.6);
  }
  floatText(pos, text, cls = '', yOff = 2) { this.text.add(_v.set(pos.x, pos.y + yOff, pos.z), text, cls, 1.2); }

  separate() {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive || a.state === 'spawn' || a.isProp) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive || b.flying !== a.flying || b.state === 'spawn') continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = min - d;
        const wa = a.isBoss ? 0 : (b.isBoss || b.isProp) ? 1 : 0.5;
        const wb = 1 - wa;
        a.pos.x -= dx / d * push * wa; a.pos.z -= dz / d * push * wa;
        b.pos.x += dx / d * push * wb; b.pos.z += dz / d * push * wb;
      }
    }
  }

  /** 玩家与怪物 / 路障的碰撞 */
  collisions() {
    const p = this.player;
    if (!p.alive) return;
    const ground = this.heightAt(p.pos.x, p.pos.z);
    const air = p.pos.y - ground;
    for (const e of this.enemies) {
      if (!e.targetable || e.isBoss || e.treasure || e.collideCd > 0) continue;
      const dz = e.pos.z - p.pos.z;
      if (dz > p.frontReach * 0.7 + e.radius || dz < -p.radius - e.radius) continue;
      if (Math.abs(e.pos.x - p.pos.x) > p.radius * 0.85 + e.radius * 0.8) continue;
      if (e.flying) { if (e.hoverY > p.top + 2.5) continue; }
      else if (air > (e.height || 2) * 0.8) { // 跳过去了
        if (!e.dodged && !e.isProp) { e.dodged = true; this.onPerfect(e.pos); }
        continue;
      }
      e.collideCd = 0.7;
      p.collide(e);
    }
  }

  // ------------------------------------------------------------------
  //  拾取物
  // ------------------------------------------------------------------
  spawnProp(kind, x, z) {
    const e = new Prop(this, kind, x, z, this.mulAt(z).hp);
    this.enemies.push(e);
    return e;
  }

  spawnPickup(kind, pos, value = 1, placed = false, fixedY = null) {
    const mesh = kind === 'coin' ? null : PICKUP_MAKERS()[kind]();
    if (mesh) this.scene.add(mesh);
    const a = Math.random() * Math.PI * 2;
    const s = rand(2, 4);
    const pk = {
      kind, mesh, value, t: 0, magnet: false, placed, phase: Math.random() * 6, fixedY,
      pos: new THREE.Vector3(pos.x, fixedY ?? (placed ? this.heightAt(pos.x, pos.z) + 1.1 : pos.y + 1.2), pos.z),
      vel: placed ? new THREE.Vector3() : new THREE.Vector3(Math.cos(a) * s, rand(5, 8), Math.sin(a) * s + 4),
    };
    this.pickups.push(pk);
    return pk;
  }

  updatePickups(dt) {
    const p = this.player;
    const magBuff = p.buffs.magnet > 0;
    const mag = magBuff ? 60 : p.stats.magnet;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += dt;
      const dx = p.pos.x - pk.pos.x, dz = p.pos.z - pk.pos.z;
      const dy = (p.pos.y + p.size.height * 0.6) - pk.pos.y;
      if (!pk.placed && pk.t > 0.35) pk.magnet = true; // 击杀掉落：弹出后自动飞向玩家
      if (p.alive && (pk.magnet || (Math.hypot(dx, dz) < mag && (magBuff || pk.fixedY === null || Math.abs(dy) < 3.5)))) {
        pk.magnet = true;
        const sp = 20 + pk.t * 10 + p.fwd;
        const l = Math.hypot(dx, dy, dz) || 1;
        pk.pos.x += dx / l * sp * dt; pk.pos.y += dy / l * sp * dt; pk.pos.z += dz / l * sp * dt;
        if (l < p.radius * 0.6 + 1.2) { this.collect(pk); if (pk.mesh) this.scene.remove(pk.mesh); this.pickups.splice(i, 1); continue; }
      } else if (!pk.placed) {
        pk.vel.y -= 24 * dt;
        pk.pos.addScaledVector(pk.vel, dt);
        const gy = this.heightAt(pk.pos.x, pk.pos.z) + 0.5;
        if (pk.pos.y < gy) { pk.pos.y = gy; pk.vel.set(0, 0, 0); }
      } else {
        pk.pos.y = (pk.fixedY ?? this.heightAt(pk.pos.x, pk.pos.z) + 1.1) + Math.sin(pk.t * 3 + pk.phase) * 0.15;
      }
      if (pk.mesh) { pk.mesh.position.copy(pk.pos); pk.mesh.rotation.y = pk.t * 4 + pk.phase; }
      if (pk.pos.z < p.pos.z - 12) { if (pk.mesh) this.scene.remove(pk.mesh); this.pickups.splice(i, 1); }
    }
  }

  collect(pk) {
    const p = this.player;
    switch (pk.kind) {
      case 'coin': {
        // 无尽模式金币收益打折，避免刷金币让升级失去意义
        this.coinFrac = (this.coinFrac || 0) + pk.value * p.stats.coinMul * (this.endless ? 0.35 : 1) * (1 + Math.min(this.combo, 100) / 200);
        const v = Math.floor(this.coinFrac);
        this.coinFrac -= v;
        this.stats.coins += v;
        this.audio.play('coin', { volume: 0.3, pitch: rand(0.95, 1.15) });
        break;
      }
      case 'meat':
        p.heal(p.stats.maxHp * 0.18);
        this.audio.play('heal');
        break;
      case 'crystal': {
        const cd = p.def.skill.cd * p.stats.cdMul;
        p.skillCd = Math.max(0, p.skillCd - cd * 0.6);
        this.audio.play('powerup');
        this.floatText(p.pos, t('float.skillCharge'), 'info', p.top + 2);
        break;
      }
      case 'power':
        p.buffs.power = 10;
        this.audio.play('powerup', { pitch: 0.8 });
        this.floatText(p.pos, t('float.power'), 'crit', p.top + 2);
        break;
      case 'egg':
        this.hazards.hatch(1);
        break;
      case 'magnet':
        p.buffs.magnet = 10;
        this.audio.play('powerup', { pitch: 1.3 });
        this.floatText(p.pos, t('float.magnet'), 'info', p.top + 2);
        break;
      case 'bomb':
        this.bombBlast();
        break;
    }
  }

  // ------------------------------------------------------------------
  //  镜头：固定在身后上方，平稳跟随，不旋转
  // ------------------------------------------------------------------
  updateCamera(dt) {
    const p = this.player;
    const cam = this.cam;
    const top = p.top;
    const bossPhase = this.state === 'bossIntro' || this.state === 'boss' || this.state === 'bossDown';
    cam.boss = damp(cam.boss, bossPhase ? 1 : 0, 1.5, dt);
    const camH = top * 0.75 + 4.4 + cam.boss * 2.5;
    const camD = 9.5 + top * 1.05 + cam.boss * 3;
    const ahead = 20 + cam.boss * 8;
    cam.x = damp(cam.x, p.pos.x * 0.55, 4, dt);
    cam.gy = damp(cam.gy, this.heightAt(0, p.pos.z), 3, dt);
    // 上下坡：视线跟随前方路面高度（看向坡顶 / 坡底），镜头不会钻进身后的坡里
    cam.gl = damp(cam.gl, this.heightAt(0, p.pos.z + ahead), 2.5, dt);
    const jumpY = Math.max(0, p.pos.y - this.heightAt(p.pos.x, p.pos.z)) * 0.3;
    const camY = Math.max(cam.gy + camH, this.heightAt(0, p.pos.z - camD) + 2.5);
    const pos = _v.set(cam.x, camY + jumpY, p.pos.z - camD);
    const look = _v2.set(cam.x * 0.8 + p.pos.x * 0.2, lerp(cam.gy, cam.gl, 0.6) + 1.3 + cam.boss * 2, p.pos.z + ahead);

    let blend = 0;
    const t = this.stateT;
    if (this.state === 'intro') {
      _cinePos.set(0, p.pos.y + top + 16, p.pos.z - 22);
      _cineLook.set(0, p.pos.y + top * 0.5, p.pos.z + 6);
      blend = 1 - easeInOut(clamp(t / 2.6, 0, 1));
    } else if (this.state === 'win') {
      _cinePos.set(p.pos.x + 7, p.pos.y + top * 0.8 + 2, p.pos.z + 9);
      _cineLook.set(p.pos.x, p.pos.y + top * 0.6, p.pos.z);
      blend = easeInOut(clamp(t / 1.8, 0, 1));
    }
    if (blend > 0) { pos.lerp(_cinePos, blend); look.lerp(_cineLook, blend); }
    // 弯道：镜头与视点按同一弯曲函数平移，并提前看向弯道内侧、轻微侧倾
    bendVec(pos);
    bendVec(look);
    look.x += (bendX(p.pos.z + 55) - bendX(p.pos.z + ahead)) * 0.35 * (1 - blend);
    cam.roll = damp(cam.roll, clamp(curvature() * 14, -0.07, 0.07) * (1 - blend), 2, dt);
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    this.camera.rotateZ(cam.roll);
    this.updateJuice();
    this.camFade.value = Math.max(0, pos.distanceTo(p.pos) - 3);
  }

  /** 持续画面状态：速度感（FOV / 速度线 / 径向模糊）、低血量去饱和 */
  updateJuice() {
    const pl = this.player, sk = pl.skill, J = this.juice.hold;
    let spd = clamp((pl.fwd - RUN_SPEED * 1.2) / (RUN_SPEED * 0.7), 0, 1); // 下坡的小幅加速不算，冲刺 / 冲锋才出速度线
    if (sk && (sk.type === 'pounce' || sk.type === 'dive') && !pl.onGround) spd = Math.max(spd, 0.75);
    if (pl.rampAir) spd = Math.max(spd, 0.8);
    if (this.state === 'win' || this.state === 'intro') spd = 0;
    const rage = pl.buffs.rage > 0;
    if (rage) spd = Math.max(spd, 0.5);
    J.speed = spd;
    J.fov = spd * 12 + (rage ? 4 : 0);
    J.radial = spd * 0.4;
    J.tint = rage ? 0.4 : 0;
    const low = pl.alive ? clamp(1 - pl.hp / (pl.stats.maxHp * 0.3), 0, 1) : 1;
    J.desat = pl.alive ? low * 0.35 : 0.75;
    J.vig = low * 0.3;
    const fov = 60 + this.juice.fov;
    if (Math.abs(this.camera.fov - fov) > 0.02) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.fx.sparks.setScale(this.viewH, fov);
      this.fx.dust.setScale(this.viewH, fov);
    }
  }

  // ------------------------------------------------------------------
  //  批量绘制：怪物投影、血条、金币（各只需 1~2 次 draw call）
  // ------------------------------------------------------------------
  renderBatches() {
    const sh = this.shadows, bars = this.bars;
    sh.begin();
    bars.begin(this.camera);
    for (const e of this.enemies) {
      if (e.isBoss) continue;
      const sc = e.root.scale.x;
      if (sc < 0.05) continue;
      const r = e.radius * 2.4 * sc * (e.flying ? 0.7 : 1);
      sh.add(e.pos.x, this.heightAt(e.pos.x, e.pos.z), e.pos.z, r);
      if (e.alive && e.barT > 0 && e.hp < e.maxHp) {
        bars.add(e.pos.x, e.pos.y + e.barTop + (e.lift || 0), e.pos.z, e.barW, e.hp / e.maxHp, e.isProp ? 0xffb020 : 0xff3a3a);
      }
    }
    for (const b of this.hazards.babies) sh.add(b.pos.x, b.pos.y, b.pos.z, 1.8);
    sh.end();
    bars.end();
    let n = 0;
    const cm = this.coinMesh;
    for (const pk of this.pickups) {
      if (pk.kind !== 'coin' || n >= 400) continue;
      _q.setFromEuler(_e.set(0, pk.t * 4 + pk.phase, 0));
      _m.compose(pk.pos, _q, _one);
      cm.setMatrixAt(n++, _m);
    }
    cm.count = n;
    cm.instanceMatrix.needsUpdate = true;
  }

  /** 开局前预编译本关会出现的怪物 / 首领 / 弹体的着色器，避免第一次出现时卡顿 */
  warmup(renderer) {
    if (!renderer || !renderer.compile) return;
    const tmp = new THREE.Group();
    tmp.position.set(0, this.heightAt(0, 25), 25);
    const types = new Set(this.endless ? ENDLESS_POOL : [...Object.keys(this.level.pool), this.level.elite, ...BOSSES[this.level.boss].summon]);
    // 同时预热"合并静态零件"的缓存，首次刷怪不再需要合并
    for (const t of types) { try { tmp.add(buildEnemyModel(t).root); } catch { /* ignore */ } }
    const bossTypes = this.endless ? Object.keys(BOSSES) : [this.level.boss];
    for (const b of bossTypes) { try { tmp.add(buildBossModel(b).root); } catch { /* ignore */ } }
    for (const side of [THREE.FrontSide, THREE.DoubleSide]) tmp.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, side })));
    // 强化门文字（贴图 + 双面透明）
    const tex = new THREE.CanvasTexture(document.createElement('canvas'));
    tex.colorSpace = THREE.SRGBColorSpace;
    tmp.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false })));
    tmp.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, fog: false })));
    tmp.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ fog: false })));
    tmp.add(new THREE.Mesh(new THREE.CylinderGeometry(), new THREE.MeshStandardMaterial({ color: 0x3a3a44, metalness: 0.4, roughness: 0.5 })));
    const kinds = [[this.rider.weapon.type], ['wave', undefined, 5], ['wave', undefined, 7], ['meteor'], ['venom'], ['spike']];
    for (const t of types) { const r = ENEMIES[t].ranged; if (r) kinds.push([{ arrow: 'earrow', spore: 'spore', orb: 'orb', fireball: 'efire', ice: 'ice' }[r.kind] || 'orb', r.kind === 'orb' ? r.color : undefined]); }
    for (const b of bossTypes) {
      kinds.push(['borb', BOSSES[b].projColor]);
      if (BOSSES[b].patterns.includes('sweep')) kinds.push(['scythewave', undefined, this.track.roadHalf * 2 + 2]);
    }
    this.projectiles.warm(kinds);
    for (const k of Object.keys(GATES)) { const t = gateLabel(GATES[k]); try { renderer.initTexture(t); } catch { /* ignore */ } }
    const models = [...tmp.children];
    for (const k of ['meat', 'crystal', 'power', 'egg', 'magnet', 'bomb']) tmp.add(PICKUP_MAKERS()[k]()); // 共享材质，编译后保留
    this.hazards.warm(tmp);
    this.scene.add(tmp);
    // 冲击波环 / 光柱 / 地面预警 / 护盾（平时隐藏的对象也要编译）
    _v.set(0, this.heightAt(0, 30), 30);
    this.fx.rings.ring(_v, { life: 0.01 }); this.fx.rings.disc(_v, { life: 0.01 }); this.fx.rings.pillar(_v, { life: 0.01 });
    const tele = this.tele.add({ shape: 'circle', x: 0, z: 30, radius: 2, duration: 0.01 });
    this.player.shield.visible = true;
    // 与实际渲染相同的目标（后期处理的离屏缓冲），否则编译出的着色器变体用不上
    const composer = this.app.useComposer ? this.app.composer : null;
    const prevRT = renderer.getRenderTarget();
    // 实例化批次各放一个实例到镜头前，保证真的被画到
    this.camera.getWorldDirection(_v2);
    const at = _v.copy(this.camera.position).addScaledVector(_v2, 14);
    _m.makeTranslation(at.x, at.y, at.z);
    const inst = [this.shadows.mesh, this.bars.bg, this.bars.fg, this.coinMesh, this.fx.debris.mesh, this.fx.scorch.mesh, this.fx.streaks.mesh];
    this.player.afterimages?.spawn(0xffffff, 0.01, 0.05);
    for (const b of this.projectiles.batches.values()) inst.push(...b.layers);
    for (const im of inst) { im.setMatrixAt(0, _m); im.count = 1; im.instanceMatrix.needsUpdate = true; }
    tmp.position.copy(at).addScaledVector(_v2, 6);
    tmp.updateMatrixWorld(true);
    this.fx.sparks.burst(at, { count: 4, life: 0.05 });
    this.fx.dust.burst(at, { count: 4, life: 0.05 });
    this.fx.sparks.update(0); this.fx.dust.update(0);
    try {
      if (composer) renderer.setRenderTarget(composer.readBuffer);
      renderer.compile(this.scene, this.camera);
      // Metal 等驱动要到第一次真正绘制时才创建渲染管线：离屏实际画一帧
      renderer.render(this.scene, this.camera);
      if (composer) { renderer.setRenderTarget(null); renderer.compile(this.scene, this.camera); }
    } catch { /* ignore */ }
    renderer.setRenderTarget(prevRT);
    for (const im of inst) im.count = 0;
    this.player.shield.visible = false;
    this.tele.remove(tele);
    this.scene.remove(tmp);
    // 注意：不要 dispose 这些材质——three.js 会随材质一起删除着色器程序，预编译就白做了
    void models;
  }

  // ------------------------------------------------------------------
  //  界面辅助
  // ------------------------------------------------------------------
  showBanner(main, sub = '', red = false, hold = 2200) {
    const el = this.app.bannerEl;
    clearTimeout(this.bannerTimer);
    el.classList.remove('out');
    el.innerHTML = `<div class="b-main${red ? ' red' : ''}">${main}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`;
    this.bannerTimer = setTimeout(() => {
      el.classList.add('out');
      this.bannerTimer = setTimeout(() => { el.innerHTML = ''; el.classList.remove('out'); }, 450);
    }, hold);
  }

  toast(msg) {
    const box = this.app.toastEl;
    const d = document.createElement('div');
    d.className = 'toast-item';
    d.textContent = msg;
    box.appendChild(d);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => d.remove(), 2700);
  }

  dispose() {
    clearTimeout(this.bannerTimer);
    this.app.bannerEl.innerHTML = '';
    this.app.toastEl.innerHTML = '';
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
    for (const gt of this.gates) gt.dispose();
    this.gates.length = 0;
    for (const pk of this.pickups) if (pk.mesh) this.scene.remove(pk.mesh);
    this.pickups.length = 0;
    this.scene.remove(this.coinMesh);
    this.coinMesh.dispose();
    this.shadows.dispose();
    this.bars.dispose();
    this.projectiles.dispose();
    this.player.dispose();
    this.fx.sparks.dispose();
    this.fx.dust.dispose();
    this.fx.rings.dispose();
    this.fx.debris.dispose();
    this.fx.scorch.dispose();
    this.fx.lights?.dispose();
    this.fx.streaks.dispose();
    this.hazards.dispose();
    this.juice.reset();
    this.audio.setMusicRate(1);
    this.tele.clear();
    this.text.clear();
    this.hud.dispose();
    this.track.dispose();
    resetBend();
  }
}
