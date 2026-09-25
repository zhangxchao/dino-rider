// =====================================================================
//  跑图事件与路面机关
//  - 跳台：把恐龙弹上天（空中前空翻），飞行路线上有一道金币弧线，落地震地
//  - 地形天灾：一段路上不断出现红圈预警，落石 / 流星 / 冰锥 / 毒泡 / 熔岩弹 / 紫雷砸下
//  - 宝藏哥布林：背着钱袋往前逃，逃掉之前打死它会喷出一大堆金币
//  - 精英伏击：两只精英带一队小怪从两侧杀出，全部击退后奖励宝箱
//  - 恐龙宝宝：捡到恐龙蛋孵出一只小恐龙，跟在身边 20 秒帮忙撕咬
//  由 game.spawnEvent 分派，game.update 每帧调用 update(dt)
// =====================================================================
import * as THREE from 'three';
import { DINOS, RUN_SPEED } from './data.js';
import { createDinoModel } from './models/dinos.js';
import { clamp, damp, rand, pick, mergeStaticMeshes } from './util.js';
import { t } from './i18n.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// —— 跳台 ——
export const LAUNCH_VY = 15.5;      // 起跳竖直速度（player.launch 使用）
export const RAMP_GRAV = 15;        // 跳台飞行时的重力（比平时小，滞空约 2 秒）
export const RAMP_W = 5.6, RAMP_L = 7, RAMP_H = 1.8;
const rampGeo = (() => {
  const sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.lineTo(RAMP_L, 0); sh.lineTo(RAMP_L, RAMP_H); sh.lineTo(0, 0.05);
  const g = new THREE.ExtrudeGeometry(sh, { depth: RAMP_W, bevelEnabled: false });
  g.rotateY(-Math.PI / 2);          // 形状的 x → 世界 z，挤出方向 → 世界 -x
  g.translate(RAMP_W / 2, 0, 0);
  return g;
})();
const slopeLen = Math.hypot(RAMP_L, RAMP_H);
const chevronGeo = new THREE.PlaneGeometry(RAMP_W * 0.82, slopeLen * 0.92).rotateX(-Math.PI / 2);
function chevronTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 16;
  ctx.lineJoin = 'round';
  for (let i = 0; i < 3; i++) {
    const y = 200 - i * 70;
    ctx.globalAlpha = 0.55 + i * 0.2;
    ctx.beginPath(); ctx.moveTo(18, y + 26); ctx.lineTo(64, y - 18); ctx.lineTo(110, y + 26); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const RAMP_COL = { jungle: 0x8a5a30, desert: 0xb07a40, frost: 0x8aa8c0, swamp: 0x6a5a3a, volcano: 0x4a3a34, shadow: 0x4a3a6a, hive: 0x3a1a1a };
const RAMP_GLOW = { jungle: 0xffe070, desert: 0xffc040, frost: 0x80e8ff, swamp: 0xa0ff60, volcano: 0xff8030, shadow: 0xc080ff, hive: 0x9cff3a };

// —— 天灾 ——
const HAZ = {
  jungle: { type: 'fall', color: 0xff5030, obj: 0x7a6a50, glow: false, debris: 0x6a5a40, geo: 'rock' },
  desert: { type: 'fall', color: 0xff6020, obj: 0xffa040, glow: true, debris: 0x8a5a30, geo: 'rock', fire: true },
  frost: { type: 'fall', color: 0x40c0ff, obj: 0xbfe8ff, glow: false, debris: 0xd8f0ff, geo: 'spike' },
  swamp: { type: 'erupt', color: 0x80ff40, obj: 0x70ff40, debris: 0x4a5a30, poison: 3 },
  volcano: { type: 'fall', color: 0xff4010, obj: 0xff7020, glow: true, debris: 0x3a2a24, geo: 'rock', fire: true },
  shadow: { type: 'bolt', color: 0xb050ff, obj: 0xd090ff, debris: 0x3a2a5a },
  hive: { type: 'erupt', color: 0xa0ff30, obj: 0xc060ff, debris: 0x3a1a1a, poison: 3 },
};
const hazRockGeo = new THREE.IcosahedronGeometry(1.1, 0);
const hazSpikeGeo = new THREE.ConeGeometry(0.7, 3.4, 6).rotateX(Math.PI);
const STRIKE_R = 2.6;
const STRIKE_T = 0.95;

// —— 恐龙宝宝 ——
const BABY_LIFE = 20;
const BABY_SCALE = 0.42;

export class Hazards {
  constructor(game) {
    this.game = game;
    this.ramps = [];
    this.zones = [];
    this.strikes = [];
    this.ambushes = [];
    this.babies = [];
    this.biome = game.biome;
    this.chevTex = chevronTexture();
    this.rampMat = new THREE.MeshStandardMaterial({ color: RAMP_COL[this.biome] ?? 0x8a5a30, roughness: 0.85, flatShading: true });
    this.chevMat = new THREE.MeshBasicMaterial({ map: this.chevTex, transparent: true, depthWrite: false, fog: false, color: new THREE.Color(RAMP_GLOW[this.biome] ?? 0xffe070).multiplyScalar(2) });
    const H = HAZ[this.biome] || HAZ.jungle;
    this.haz = H;
    this.hazMat = H.glow
      ? new THREE.MeshBasicMaterial({ color: new THREE.Color(H.obj).multiplyScalar(2.2) })
      : new THREE.MeshStandardMaterial({ color: H.obj, roughness: 0.6, flatShading: true, emissive: H.geo === 'spike' ? 0x2060a0 : 0x000000, emissiveIntensity: 0.4 });
    this.hazGeo = H.geo === 'spike' ? hazSpikeGeo : hazRockGeo;
    this.pool = [];
  }

  /** 开局预热：让跳台 / 天灾物体的材质提前编译 */
  warm(group) {
    const r = new THREE.Mesh(rampGeo, this.rampMat);
    const c = new THREE.Mesh(chevronGeo, this.chevMat);
    const h = new THREE.Mesh(this.hazGeo, this.hazMat);
    h.position.x = 3;
    group.add(r, c, h);
  }

  /** 路线事件分派：处理了返回 true */
  spawn(ev) {
    switch (ev.kind) {
      case 'ramp': this.addRamp(ev.z, ev.x); return true;
      case 'hazard': this.addZone(ev.z, ev.len || 70); return true;
      case 'goblin': this.addGoblin(ev.z); return true;
      case 'ambush': this.addAmbush(ev.z); return true;
      case 'egg': this.game.spawnPickup('egg', _v.set(ev.x ?? rand(-5, 5), 0, ev.z), 1, true); return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  //  跳台
  // ------------------------------------------------------------------
  addRamp(z, x = rand(-3, 3)) {
    const g = this.game;
    const grp = new THREE.Group();
    const body = new THREE.Mesh(rampGeo, this.rampMat);
    body.castShadow = true;
    body.receiveShadow = true;
    const chev = new THREE.Mesh(chevronGeo, this.chevMat);
    chev.position.set(0, RAMP_H / 2 + 0.04, RAMP_L / 2);
    chev.rotation.x = -Math.atan2(RAMP_H, RAMP_L);
    chev.renderOrder = 3;
    grp.add(body, chev);
    const y0 = g.heightAt(x, z), y1 = g.heightAt(x, z + RAMP_L);
    grp.position.set(x, y0 - 0.05, z);
    grp.rotation.x = -Math.atan2(y1 - y0, RAMP_L);
    g.scene.add(grp);
    this.ramps.push({ x, z, grp, used: false });
    // 飞行路线上的金币弧线（按起跳速度和空中重力推算）
    const vy = LAUNCH_VY, grav = RAMP_GRAV;
    const top = y1 + RAMP_H;
    for (let i = 1; i <= 10; i++) {
      const tt = i * 0.18;
      const cz = z + RAMP_L + RUN_SPEED * 1.02 * tt;
      const cy = top + vy * tt - 0.5 * grav * tt * tt;
      if (cy < g.heightAt(x, cz) + 1.2) break;
      g.spawnPickup('coin', _v.set(x, 0, cz), 2, true, cy + 0.6);
    }
  }

  // ------------------------------------------------------------------
  //  天灾区
  // ------------------------------------------------------------------
  addZone(z, len) { this.zones.push({ z0: z, z1: z + len, next: 0, announced: false }); }

  strike(x, z) {
    const g = this.game, H = this.haz;
    const tele = g.tele.add({ shape: 'circle', x, z, radius: STRIKE_R, duration: STRIKE_T, color: H.color });
    let mesh = null;
    if (H.type === 'fall') {
      mesh = this.pool.pop() || new THREE.Mesh(this.hazGeo, this.hazMat);
      mesh.visible = true;
      mesh.scale.setScalar(rand(0.8, 1.2));
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, 0);
      if (H.geo === 'spike') mesh.rotation.set(0, Math.random() * 6, 0);
      g.scene.add(mesh);
    }
    this.strikes.push({ x, z, t: 0, tele, mesh, spin: rand(-6, 6) });
  }

  impact(s) {
    const g = this.game, H = this.haz, p = g.player;
    const gy = g.heightAt(s.x, s.z);
    _v.set(s.x, gy, s.z);
    const mul = g.mulAt(s.z);
    // 伤害：玩家（跳起来能躲）+ 路上的怪物
    const d = Math.hypot(p.pos.x - s.x, p.pos.z - s.z);
    const air = p.pos.y - g.heightAt(p.pos.x, p.pos.z);
    if (p.alive) {
      if (d < STRIKE_R + p.radius * 0.35 && air < 2.2) {
        _v2.set(p.pos.x - s.x, 0, p.pos.z - s.z).normalize();
        p.takeDamage(15 * mul.dmg, { dir: _v2, knock: 8, poison: H.poison || 0, kind: 'melee' });
      } else if (d < STRIKE_R + 2.2) g.onPerfect(p.pos);
    }
    g.aoe(_v, STRIKE_R + 0.6, 45 * mul.hp, { knock: 8, up: 6, stun: 0.5, source: 'skill' });
    // 画面
    g.fx.rings.ring(_v, { r0: 0.6, r1: STRIKE_R * 1.6, life: 0.45, color: H.color });
    g.fx.rings.disc(_v, { r: STRIKE_R, life: 0.22, color: H.obj, opacity: 0.7 });
    g.fx.dust.burst(_v, { count: 10, speed: 5, life: 0.7, size: 0.9, sizeEnd: 2, color: H.type === 'erupt' ? 0x5a8a30 : g.dustColor, alpha: 0.45, flat: true, drag: 2.5, up: 2 });
    if (H.type === 'bolt') {
      g.fx.rings.pillar(_v, { r: 0.9, h: 40, life: 0.35, color: H.obj, opacity: 0.95 });
      g.fx.sparks.burst(_v, { count: 36, speed: 12, life: 0.45, size: 0.9, color: 0xffffff, color2: H.color, up: 5 });
      g.juice.flash(H.color, 0.12);
      g.audio.play('laser', { volume: 0.6, pitch: 0.5 });
    } else if (H.type === 'erupt') {
      g.fx.rings.pillar(_v, { r: 1.6, h: 7, life: 0.6, color: H.obj, opacity: 0.6 });
      g.fx.sparks.burst(_v, { count: 30, speed: 7, life: 0.9, size: 1.1, color: 0xb0ff60, color2: 0x306010, up: 9, gravity: 10 });
      g.audio.play('poison', { volume: 0.7 });
    } else {
      g.fx.sparks.burst(_v, { count: H.fire ? 30 : 12, speed: 9, life: 0.45, size: 0.75, color: H.fire ? 0xffd060 : H.obj, color2: H.color, up: 4 });
      g.fx.debris.burst(_v, { count: 9, speed: 8, up: 8, size: 0.35, color: H.debris });
      if (H.fire) g.fx.lights?.flash(_v, 0xff7020, 45, 16, 0.4);
      g.audio.play(H.geo === 'spike' ? 'ice' : 'explosion', { volume: 0.55, pitch: H.geo === 'spike' ? 0.7 : 1.1 });
    }
    g.fx.scorch.add(_v, STRIKE_R * 0.8, 3.5);
    g.shakeAt(_v, 0.22);
  }

  // ------------------------------------------------------------------
  //  宝藏哥布林
  // ------------------------------------------------------------------
  addGoblin(z) {
    const g = this.game;
    const mul = g.mulAt(z);
    const e = g.spawnEnemy('goblin', rand(-4, 4), g.player.pos.z + 42, mul);
    e.treasure = true;
    e.flee = 13.2;
    e.fleeT = 9.5;
    e.maxHp = e.hp = Math.round(e.hp * 5);
    e.dmg = 0;
    e.def = { ...e.def, name: t('enemy.treasureGoblin'), coins: 0, score: 80 };
    e.xp *= 3;
    const sack = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 0.8, roughness: 0.3, emissive: 0x8a5a00, emissiveIntensity: 0.9 }));
    sack.position.set(0, e.height * 0.7, -0.45);
    e.root.add(sack);
    e.sack = sack;
    g.toast(t('toast.goblin'));
    g.audio.play('coin', { volume: 0.7, pitch: 0.6 });
  }

  // ------------------------------------------------------------------
  //  精英伏击
  // ------------------------------------------------------------------
  addAmbush(z) {
    const g = this.game, p = g.player;
    const rh = g.track.roadHalf - 1.2;
    const mul = g.mulAt(z);
    const eliteType = g.endless ? pick(['yeti', 'golem', 'darkKnight']) : g.level.elite;
    const pool = g.poolAt(z);
    const list = [];
    const zz = p.pos.z + 55;
    for (const side of [1, -1]) {
      const e = g.spawnEnemy(eliteType, side * (rh - 1), zz + rand(-2, 2), mul, true);
      e.elite = true; e.maxHp = e.hp = Math.round(e.hp * 1.6); e.xp *= 2;
      list.push(e);
      for (let i = 0; i < 4; i++) list.push(g.spawnEnemy(g.pickWeighted(pool), side * rand(rh * 0.5, rh), zz - 4 - i * 2.5, mul, true));
    }
    this.ambushes.push({ list, done: false });
    g.showBanner(t('banner.ambush'), t('banner.ambushSub'), true, 1400);
    g.audio.play('warning', { volume: 0.8 });
  }

  // ------------------------------------------------------------------
  //  恐龙宝宝
  // ------------------------------------------------------------------
  hatch(n = 1) {
    const g = this.game, p = g.player;
    for (let k = 0; k < n; k++) {
      if (this.babies.length >= 2) { this.babies[0].life = BABY_LIFE; continue; }
      const side = this.babies.length && this.babies[0].side > 0 ? -1 : 1;
      const def = pick(DINOS.filter((d) => d.id !== p.def.id && d.body !== 'pterosaur'));
      const model = createDinoModel(def);
      model.root.scale.multiplyScalar(BABY_SCALE);
      // 合并不会动的零件（同一种恐龙缓存复用），不投射实时阴影，改用圆形投影
      mergeStaticMeshes(model.root, () => {
        let tt = 0;
        for (const a of [-1, 0.5]) for (const mv of [0, 1, 1.7]) { tt += 0.23; model.update(0.1, { t: tt, move: mv, air: false, attack: a, skill: -1, hurt: 0, dead: 0 }); }
        model.update(0.1, { t: tt + 1, move: 0, air: false, attack: -1, skill: -1, hurt: 0, dead: 0 });
      }, 'baby:' + def.id);
      model.root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      g.scene.add(model.root);
      const b = {
        def, model, side, life: BABY_LIFE, t: 0, atkT: -1, atkCd: 0.6, hit: false, target: null,
        pos: new THREE.Vector3(p.pos.x + side * 3, p.pos.y, p.pos.z - 1), heading: 0,
        anim: { t: 0, move: 1, air: false, attack: -1, skill: -1, hurt: 0, dead: 0 },
      };
      this.babies.push(b);
      g.fx.sparks.burst(b.pos, { count: 30, speed: 5, life: 0.7, size: 0.8, color: 0xfff0c0, color2: 0xff80c0, up: 4 });
      g.fx.rings.ring(b.pos, { r0: 0.3, r1: 3, life: 0.4, color: 0xffd0f0 });
      g.floatText(b.pos, t('float.hatch', { name: def.name }), 'info', 2.5);
      g.audio.roar(0.5, { volume: 0.6 });
    }
  }

  updateBabies(dt) {
    const g = this.game, p = g.player;
    for (let i = this.babies.length - 1; i >= 0; i--) {
      const b = this.babies[i];
      b.t += dt; b.life -= dt;
      b.anim.t += dt;
      if (b.life <= 0 || !p.alive) {
        g.fx.sparks.burst(b.pos, { count: 24, speed: 4, life: 0.6, size: 0.8, color: 0xffffff, color2: 0xffd0f0, up: 3 });
        g.scene.remove(b.model.root);
        this.babies.splice(i, 1);
        continue;
      }
      // 找目标：前方 9 米内最近的怪物
      if (!b.target || !b.target.alive) b.target = null;
      b.atkCd -= dt;
      if (!b.target && b.atkCd <= 0) {
        let best = null, bd = 9;
        for (const e of g.enemies) {
          if (!e.targetable || e.isBoss || e.flying) continue;
          const dd = Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z);
          if (dd < bd && e.pos.z > b.pos.z - 2) { bd = dd; best = e; }
        }
        b.target = best;
      }
      let tx = clamp(p.pos.x + b.side * 3.2, -g.track.roadHalf + 1, g.track.roadHalf - 1), tz = p.pos.z - 1.2;
      if (b.target) { tx = b.target.pos.x; tz = b.target.pos.z - b.target.radius - 0.8; }
      const sp = 24;
      const dx = tx - b.pos.x, dz = tz - b.pos.z;
      const l = Math.hypot(dx, dz);
      const step = Math.min(l, (b.target ? sp : sp * 0.8) * dt + Math.max(0, p.fwd * dt * (b.target ? 0 : 1)));
      if (l > 0.01) { b.pos.x += dx / l * step; b.pos.z += dz / l * step; }
      b.pos.y = g.heightAt(b.pos.x, b.pos.z);
      const face = l > 0.3 ? Math.atan2(dx, dz) : 0;
      b.heading = damp(b.heading, clamp(face, -1.2, 1.2), 8, dt);
      // 咬
      if (b.target && l < 1.6 && b.atkT < 0 && b.atkCd <= 0) { b.atkT = 0; b.hit = false; }
      if (b.atkT >= 0) {
        b.atkT += dt / 0.4;
        if (!b.hit && b.atkT >= 0.45 && b.target && b.target.alive) {
          b.hit = true;
          _v2.set(b.target.pos.x - b.pos.x, 0, 1).normalize();
          g.damageEnemy(b.target, p.stats.atk * 0.7, { dir: _v2, knock: 7, source: 'melee' });
          b.target.getCenter(_v);
          g.fx.sparks.burst(_v, { count: 8, speed: 5, life: 0.25, size: 0.5, color: 0xfff0c0, color2: 0xff8040 });
        }
        if (b.atkT >= 1) { b.atkT = -1; b.atkCd = 0.55; b.target = null; }
      }
      b.anim.move = clamp(1 + (b.target ? 0.5 : 0), 0, 1.8);
      b.anim.attack = b.atkT;
      const fade = b.life < 1 ? b.life : 1;
      b.model.root.position.copy(b.pos);
      b.model.root.rotation.y = b.heading;
      b.model.root.visible = fade > 0.5 || Math.sin(b.t * 30) > 0;
      b.model.update(dt, b.anim);
    }
  }

  // ------------------------------------------------------------------
  update(dt) {
    const g = this.game, p = g.player;
    // 跳台
    for (let i = this.ramps.length - 1; i >= 0; i--) {
      const r = this.ramps[i];
      if (!r.used && p.alive && p.onGround && Math.abs(p.pos.x - r.x) < RAMP_W / 2 + 0.2 && p.pos.z > r.z - 0.3 && p.pos.z < r.z + RAMP_L + 0.5) {
        r.used = true;
        p.launch();
      }
      if (r.z < p.pos.z - 30) { g.scene.remove(r.grp); this.ramps.splice(i, 1); }
    }
    // 天灾区：玩家在区域内时持续落下
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const zn = this.zones[i];
      if (!zn.announced && p.pos.z > zn.z0 - 60) {
        zn.announced = true;
        g.showBanner(t('hazard.' + this.biome), t('hazard.sub'), true, 1200);
        g.audio.play('warning', { volume: 0.7 });
      }
      if (p.pos.z > zn.z1) { this.zones.splice(i, 1); continue; }
      if (p.pos.z < zn.z0 - 25 || g.state !== 'run') continue;
      zn.next -= dt;
      if (zn.next <= 0) {
        zn.next = rand(0.38, 0.6);
        const aim = Math.random() < 0.45;
        const rh = g.track.roadHalf - 1.5;
        const x = aim ? clamp(p.pos.x + rand(-1.2, 1.2), -rh, rh) : rand(-rh, rh);
        this.strike(x, p.pos.z + (p.fwd || 17) * STRIKE_T + rand(-2, 12));
      }
    }
    // 落物
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.t += dt;
      const k = Math.min(1, s.t / STRIKE_T);
      const gy = g.heightAt(s.x, s.z);
      if (s.mesh) {
        const h = 28 * (1 - k * k);
        s.mesh.position.set(s.x + (1 - k) * 4, gy + h + (this.haz.geo === 'spike' ? 1.7 : 1), s.z + (1 - k) * 6);
        if (this.haz.geo !== 'spike') { s.mesh.rotation.x += s.spin * dt; s.mesh.rotation.z += s.spin * 0.7 * dt; }
        if (this.haz.fire && Math.random() < 0.8) g.fx.sparks.spawn(s.mesh.position.x, s.mesh.position.y, s.mesh.position.z, rand(-1, 1), 3, rand(-1, 1), 0.4, 1.4, 0.2, 0xffd060, 0xff2000, 0.9, 0, 1);
      }
      if (this.haz.type === 'bolt' && k > 0.6 && Math.random() < 0.3) {
        _v.set(s.x, gy, s.z);
        g.fx.sparks.burst(_v, { count: 2, speed: 3, life: 0.2, size: 0.5, color: 0xd090ff, up: 6 });
      }
      if (k >= 1) {
        this.impact(s);
        if (s.mesh) { s.mesh.visible = false; g.scene.remove(s.mesh); this.pool.push(s.mesh); }
        this.strikes.splice(i, 1);
      }
    }
    // 伏击：全部击退 → 宝箱
    for (let i = this.ambushes.length - 1; i >= 0; i--) {
      const a = this.ambushes[i];
      if (a.list.every((e) => !e.alive || e.removed)) {
        if (a.list.some((e) => !e.alive && e.hp <= 0)) {
          const killed = a.list.filter((e) => e.hp <= 0).length;
          if (killed >= Math.ceil(a.list.length * 0.6) && g.state === 'run') {
            g.spawnProp('chest', rand(-3, 3), p.pos.z + 32);
            g.toast(t('toast.ambushClear'));
          }
        }
        this.ambushes.splice(i, 1);
      }
    }
    this.updateBabies(dt);
  }

  /** 首领战开始时清掉天灾（预警圈由 tele.clear 统一清除） */
  clearZones() {
    for (const s of this.strikes) if (s.mesh) { s.mesh.visible = false; this.game.scene.remove(s.mesh); this.pool.push(s.mesh); }
    this.strikes.length = 0;
    this.zones.length = 0;
  }

  dispose() {
    const g = this.game;
    for (const r of this.ramps) g.scene.remove(r.grp);
    for (const s of this.strikes) if (s.mesh) g.scene.remove(s.mesh);
    for (const b of this.babies) g.scene.remove(b.model.root);
    this.ramps.length = 0; this.strikes.length = 0; this.babies.length = 0;
    this.rampMat.dispose(); this.chevMat.dispose(); this.chevTex.dispose(); this.hazMat.dispose();
  }
}
