// 怪物 / 首领 / 路障（跑道模式）
import * as THREE from 'three';
import { ENEMIES, BOSSES, BALANCE } from './data.js';
import { createEnemyModel, createBossModel } from './models/enemies.js';
import { clamp, damp, turnToward, prepareModel, rand, pick, mergeStaticMeshes, rigidSkin } from './util.js';
import { t } from './i18n.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _col = new THREE.Color();
// 小蜘蛛垂下来的蛛丝（所有小蜘蛛共用几何与材质）
const threadGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 4, 1, true).translate(0, 0.5, 0);
const threadMat = new THREE.MeshBasicMaterial({ color: 0xe8f0e0, transparent: true, opacity: 0.55, depthWrite: false });
const SPIDER_DROP_T = 1.2;
const ICE_COL = new THREE.Color(0.5, 0.85, 1);

// 头顶血条由 game.bars 统一批量绘制；这里只记录计时与高度
function updateBar(e, dt, top) {
  e.barT -= dt;
  e.barTop = top;
}

// 动画采样状态：用于找出模型里不会动的零件并合并
const ENEMY_STATES = [
  { t: 0.3, move: 0, attack: -1, hurt: 0, dead: 0 }, { t: 1.1, move: 1, attack: 0.3, hurt: 1, dead: 0 },
  { t: 2.3, move: 1.5, attack: 0.7, hurt: 0.5, dead: 0 }, { t: 3.1, move: 0.4, attack: -1, hurt: 0, dead: 0.6 },
  { t: 4.2, move: 0, attack: -1, hurt: 0, dead: 0 },
];
const BOSS_STATES = (() => {
  const out = [];
  let t = 0;
  for (const p of ['slam', 'volley', 'barrage', 'summon', 'charge', 'burrow', 'breath', 'meteor', 'scythe', 'sweep', 'blink', null]) {
    for (const ph of [1, 2, 3]) for (const a of [0.2, 0.7]) out.push({ t: (t += 0.37), move: a, attack: a, pattern: p, hurt: a > 0.5 ? 1 : 0, dead: 0, phase: ph, burrow: p === 'burrow' ? a : 0 });
  }
  out.push({ t: t + 1, move: 0, attack: -1, pattern: null, hurt: 0, dead: 0.7, phase: 1, burrow: 0 });
  out.push({ t: t + 2, move: 0, attack: -1, pattern: null, hurt: 0, dead: 0, phase: 1, burrow: 0 });
  return out;
})();

/** 创建怪物模型：合并静态零件，再把会动的零件合成刚体蒙皮网格（同种怪共享合并结果） */
export function buildEnemyModel(type) {
  const model = createEnemyModel(type, ENEMIES[type]);
  const steps = ENEMY_STATES.map((st) => () => model.update(0.1, st));
  mergeStaticMeshes(model.root, () => steps.forEach((f) => f()), 'e:' + type);
  rigidSkin(model.root, steps, 'e:' + type, { atlas: true });
  return model;
}
export function buildBossModel(type) {
  const model = createBossModel(type, BOSSES[type]);
  const steps = BOSS_STATES.map((st) => () => model.update(0.1, st));
  mergeStaticMeshes(model.root, () => steps.forEach((f) => f()), 'b:' + type);
  rigidSkin(model.root, steps, 'b:' + type);
  return model;
}

function disposeModel(root) {
  root.traverse((o) => {
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    if (o.userData.mergedGeo && o.geometry) o.geometry.dispose();
    if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();
  });
}

const PROJ_KIND = { arrow: 'earrow', spore: 'spore', orb: 'orb', fireball: 'efire', ice: 'ice' };
const MARCH = { melee: 0.75, ranged: 0.3, flying: 0.85 };
const LATERAL = { wolf: 3.2, bat: 2.6, goblin: 1.6, slime: 1.2, skeleton: 1.4, scorpion: 1.4, yeti: 1.0, golem: 0.8, darkKnight: 1.4 };

// ---------------------------------------------------------------------
//  普通怪物
// ---------------------------------------------------------------------
export class Enemy {
  constructor(game, type, x, z, mul = { hp: 1, dmg: 1 }) {
    // 一次性：模型、材质、骨骼（怪物被移除后回收进对象池，下次出生直接 reset 复用）
    this.game = game;
    this.type = type;
    this.isBoss = false;
    this.isProp = false;
    this.model = buildEnemyModel(type);
    this.root = this.model.root;
    this.flash = prepareModel(this.root, { cast: false });  // 怪物用圆形投影代替实时阴影
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.kb = new THREE.Vector3();
    this.anim = { t: 0, move: 0, attack: -1, hurt: 0, dead: 0 };
    this.reset(x, z, mul);
  }

  /** 每次出生：把所有运行时状态恢复成新怪物的样子 */
  reset(x, z, mul = { hp: 1, dmg: 1 }) {
    const game = this.game;
    this.def = ENEMIES[this.type];
    game.scene.add(this.root);
    this.root.visible = true;
    this.radius = this.def.radius;
    this.height = this.model.size.height || 1.5;
    this.flying = !!this.def.flying;
    this.hoverY = this.def.hover || 0;
    this.halfHeight = this.flying ? 0.9 : Math.max(0.6, this.height * 0.5);
    this.maxHp = this.hp = Math.round(this.def.hp * mul.hp);
    this.dmg = this.def.dmg * mul.dmg;
    this.xp = Math.max(1, Math.round((this.def.score || 10) / 8));
    this.speed = this.def.speed * rand(0.9, 1.12);
    this.kind = this.flying ? 'flying' : this.def.ranged ? 'ranged' : 'melee';
    this.mass = Math.pow(this.radius, 1.5) * (this.type === 'golem' || this.type === 'yeti' || this.type === 'darkKnight' ? 1.8 : 1);
    this.pos.set(x, game.heightAt(x, z), z);
    this.homeX = x;
    this.vel.set(0, 0, 0);
    this.kb.set(0, 0, 0);
    this.lift = 0; this.vy = 0;
    this.heading = Math.PI;
    this.state = 'spawn';
    this.stateT = 0;
    this.atkCd = rand(0.4, 1.6);
    this.atkT = -1;
    this.atkHit = false;
    this.collideCd = 0;
    this.stun = 0;
    this.slowT = 0; this.slowMul = 1;
    this.burnT = 0; this.burnDps = 0;
    this.poisonT = 0; this.poisonDps = 0;
    this.dotTick = 0.5;
    this.hurt = 0;
    this.flashT = 0;
    this.alive = true;
    this.removed = false;
    this.deadT = 0;
    this.phase = Math.random() * 10;
    this.teleCd = rand(1, 3);
    const A = this.anim;
    A.t = Math.random() * 10; A.move = 0; A.attack = -1; A.hurt = 0; A.dead = 0;
    this.barW = Math.max(1, this.radius * 1.4);
    this.barT = 0;
    this.barTop = 2;
    this.stunFx = 0;
    this.animSkip = 0; this.animDt = 0;
    // 外部挂上的标记（精英、宝藏哥布林、完美闪避……）
    this.elite = false; this.treasure = false; this.flee = 0; this.fleeT = 0; this.dodged = false; this.noPool = false;
    this.mistT = 0; this.mistHit = false; this.mistNear = false;
    this.dropping = false;
    this.flash.setFlash(0);
    this.root.rotation.set(0, Math.PI, 0);
    this.root.position.copy(this.pos);
    this.root.scale.setScalar(0.01);
    if (this.def.drop) {
      // 从树上垂丝落下：出生即全尺寸，挂在高处慢慢降下来（下落途中就能被打）
      this.dropping = true;
      this.lift = this.def.drop;
      this.root.scale.setScalar(1);
      if (!this.thread) {
        this.thread = new THREE.Mesh(threadGeo, threadMat);
        this.thread.position.y = 0.45;
        this.thread.frustumCulled = false;
      }
      this.root.add(this.thread);
    }
    return this;
  }

  /** 回收进对象池：从场景里拿掉但保留模型 */
  release() {
    if (this.thread) this.root.remove(this.thread);
    this.game.scene.remove(this.root);
  }

  get targetable() { return this.alive && (this.state !== 'spawn' || this.dropping); }
  getCenter(out) { return out.set(this.pos.x, this.pos.y + (this.flying ? this.hoverY : this.height * 0.5) + this.lift, this.pos.z); }

  applyStatus(o, dotBase = 0) {
    if (o.stun) this.stun = Math.max(this.stun, o.stun);
    if (o.slow) { this.slowMul = Math.min(this.slowMul, 1 - o.slow); this.slowT = Math.max(this.slowT, o.slowTime || 2); }
    if (o.burn) { this.burnT = Math.max(this.burnT, o.burn); this.burnDps = Math.max(this.burnDps, dotBase * 0.35); }
    if (o.poison) { this.poisonT = Math.max(this.poisonT, o.poison); this.poisonDps = Math.max(this.poisonDps, dotBase * 0.3); }
    if (o.dir && o.knock) {
      const k = o.knock / this.mass;
      this.kb.x += o.dir.x * k; this.kb.z += o.dir.z * k;
    }
    if (o.up && !this.flying) this.vy = Math.max(this.vy, o.up / Math.sqrt(this.mass));
  }

  kill() {
    this.alive = false;
    this.state = 'dead';
    this.deadT = 0;
    this.atkT = -1;
    if (this.thread) { this.root.remove(this.thread); this.dropping = false; }
  }

  update(dt) {
    const g = this.game;
    const pl = g.player;
    this.anim.t += dt;
    this.hurt = Math.max(0, this.hurt - dt * 4);
    this.flashT = Math.max(0, this.flashT - dt);
    this.collideCd -= dt;
    const dz = this.pos.z - pl.pos.z;
    if (dz < -16 && this.state !== 'dead') { this.removed = true; return; } // 被甩在身后

    if (this.state === 'spawn' && this.dropping) {
      this.stateT += dt;
      const k = Math.min(1, this.stateT / SPIDER_DROP_T);
      const H = this.def.drop;
      this.lift = H * (1 - k * k * (3 - 2 * k));
      this.pos.y = g.heightAt(this.pos.x, this.pos.z);
      this.root.position.set(this.pos.x, this.pos.y + this.lift, this.pos.z);
      this.root.rotation.y = this.heading;
      this.thread.scale.y = H + 4 - this.lift;
      this.anim.move = 0.3;
      this.model.update(dt, this.anim);
      this.flash.setFlash(this.flashT > 0 ? this.flashT / 0.12 : 0);
      updateBar(this, dt, this.height + 0.5);
      if (k >= 1) {
        this.state = 'active'; this.dropping = false; this.lift = 0;
        this.root.remove(this.thread);
        this.atkCd = rand(0.05, 0.35);
        g.fx.dust.burst(this.pos, { count: 6, speed: 2.5, life: 0.5, size: 0.6, sizeEnd: 1.4, color: g.dustColor, alpha: 0.4, flat: true, up: 1 });
      }
      return;
    }
    if (this.state === 'spawn') {
      this.stateT += dt;
      const k = Math.min(1, this.stateT / 0.6);
      const s = k < 1 ? 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2) : 1;
      this.root.scale.setScalar(Math.max(0.01, s));
      this.pos.y = g.heightAt(this.pos.x, this.pos.z);
      this.root.position.copy(this.pos);
      this.root.rotation.y = this.heading;
      this.model.update(dt, this.anim);
      if (k >= 1) { this.state = 'active'; this.root.scale.setScalar(1); }
      return;
    }

    if (this.state === 'dead') {
      this.deadT += dt / 0.55;
      this.anim.dead = Math.min(1, this.deadT);
      this.anim.move = 0; this.anim.attack = -1;
      // 被撞飞时继续飞行
      this.pos.x += this.kb.x * dt; this.pos.z += this.kb.z * dt;
      this.kb.multiplyScalar(Math.exp(-2 * dt));
      if (this.vy !== 0 || this.lift > 0) { this.vy -= 30 * dt; this.lift = Math.max(0, this.lift + this.vy * dt); if (this.lift === 0) this.vy = 0; }
      this.pos.y = g.heightAt(this.pos.x, this.pos.z);
      this.root.position.set(this.pos.x, this.pos.y + this.lift, this.pos.z);
      this.model.update(dt, this.anim);
      this.flash.setFlash(Math.max(0, 0.6 - this.deadT));
      if (this.deadT >= 0.9) {
        const s = Math.max(0.01, 1 - (this.deadT - 0.9) * 4);
        this.root.scale.setScalar(s);
        if (s <= 0.02) this.removed = true;
      }
      return;
    }

    // 持续伤害
    this.dotTick -= dt;
    if (this.burnT > 0) this.burnT -= dt;
    if (this.poisonT > 0) this.poisonT -= dt;
    if (this.dotTick <= 0) {
      this.dotTick = 0.5;
      if (this.burnT > 0) g.damageEnemy(this, this.burnDps * 0.5, { source: 'dot', dotColor: 'burn' });
      if (this.poisonT > 0 && this.alive) g.damageEnemy(this, this.poisonDps * 0.5, { source: 'dot', dotColor: 'poison' });
      if (!this.alive) return;
    }
    if (this.burnT > 0 && Math.random() < 0.4) { this.getCenter(_v); g.fx.sparks.burst(_v, { count: 1, speed: 1, life: 0.5, size: 0.7, color: 0xffa040, color2: 0xff2000, up: 2, radius: this.radius * 0.6 }); }
    if (this.poisonT > 0 && Math.random() < 0.3) { this.getCenter(_v); g.fx.sparks.burst(_v, { count: 1, speed: 0.6, life: 0.6, size: 0.5, color: 0x9cff3a, up: 1.5, radius: this.radius * 0.6 }); }
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.slowMul = 1; }

    let vx = 0, vz = 0;
    const active = dz < 70 && pl.alive && g.state !== 'win';
    if (this.stun > 0) {
      this.stun -= dt;
      this.atkT = -1;
      this.stunFx -= dt;
      if (this.stunFx <= 0) {
        this.stunFx = 0.15;
        const a = this.anim.t * 6;
        const top = this.pos.y + (this.flying ? this.hoverY + 0.8 : this.height + 0.3) + this.lift;
        g.fx.sparks.spawn(this.pos.x + Math.cos(a) * 0.6, top, this.pos.z + Math.sin(a) * 0.6, 0, 0.3, 0, 0.35, 0.45, 0.2, 0xffee60, 0xffffff, 1, 0, 0);
      }
    } else if (this.flee) {
      // 宝藏哥布林：往前逃、左右乱窜，时间到了就溜走
      vz = this.flee * this.slowMul;
      vx = Math.sin(this.anim.t * 2.1 + this.phase) * 5;
      this.fleeT -= dt;
      if (this.fleeT <= 0 || dz > 90) { g.onGoblinEscape(this); return; }
      if (Math.random() < 0.35) { this.getCenter(_v); g.fx.sparks.burst(_v, { count: 1, speed: 1, life: 0.5, size: 0.6, color: 0xffe070, color2: 0xffa000, up: 1, radius: 0.5 }); }
    } else if (active && this.def.mist) {
      // 剧毒小蛛：原地不动，地上亮出毒雾预警圈，蓄力后喷出一大团毒雾
      const M = this.def.mist;
      if (this.mistT > 0) { this.mistT -= dt; if (!this.mistHit) this.mistCheck(); }
      if (this.atkT >= 0) {
        this.atkT += dt / (M.windup / 0.55);
        if (!this.atkHit && this.atkT >= 0.55) { this.atkHit = true; this.spewMist(); }
        if (this.atkT >= 1) this.atkT = -1;
      } else {
        this.atkCd -= dt;
        // 等玩家冲到约一次蓄力的距离才亮圈，毒雾正好喷在玩家将要经过的地方
        if (this.atkCd <= 0 && dz < 16 && dz > -2) {
          this.atkT = 0; this.atkHit = false;
          this.atkCd = this.def.atkCd * rand(0.9, 1.2) * g.diff.rest;
          g.tele.add({ shape: 'circle', x: this.pos.x, z: this.pos.z, radius: M.radius, duration: M.windup, color: 0x80ff30 });
        }
      }
    } else if (active) {
      const sp = this.speed * this.slowMul;
      vz = -sp * MARCH[this.kind];
      if (this.kind === 'flying') {
        const tx = this.homeX + Math.sin(this.anim.t * 1.3 + this.phase) * 2.8;
        vx = clamp((tx - this.pos.x) * 2, -4, 4);
        if (dz < 18) vx = clamp((pl.pos.x - this.pos.x) * 1.5, -3, 3);
      } else if (this.kind === 'ranged') {
        const tx = this.homeX + Math.sin(this.anim.t * 0.8 + this.phase) * 2.5;
        vx = clamp((tx - this.pos.x) * 2, -2.5, 2.5);
        // 射击
        const R = Math.min(55, this.def.ranged.range * 2.2);
        if (this.atkT >= 0) {
          this.atkT += dt / 0.7;
          if (!this.atkHit && this.atkT >= 0.5) { this.atkHit = true; this.shoot(); }
          if (this.atkT >= 1) this.atkT = -1;
        } else {
          this.atkCd -= dt;
          if (this.atkCd <= 0 && dz > 9 && dz < R) { this.atkT = 0; this.atkHit = false; this.atkCd = this.def.atkCd * rand(1.1, 1.6) * this.game.diff.rest; }
        }
        if (this.def.teleport) {
          this.teleCd -= dt;
          if (this.teleCd <= 0 && dz < 16 && dz > 2) this.teleport();
        }
      } else {
        const lat = (LATERAL[this.type] || 1.3) * this.slowMul;
        if (dz < 32) vx = clamp((pl.pos.x - this.pos.x) * 1.2, -lat, lat);
        // 扑击动作（伤害由碰撞结算）
        if (this.atkT < 0 && dz < 5 + this.radius && dz > 0) { this.atkT = 0; }
      }
      if (this.atkT >= 0 && this.kind !== 'ranged') { this.atkT += dt / 0.6; if (this.atkT >= 1) this.atkT = -1; }
    }

    this.vel.x = damp(this.vel.x, vx, 5, dt);
    this.vel.z = damp(this.vel.z, vz, 5, dt);
    this.pos.x += (this.vel.x + this.kb.x) * dt;
    this.pos.z += (this.vel.z + this.kb.z) * dt;
    const kbd = Math.exp(-4 * dt);
    this.kb.x *= kbd; this.kb.z *= kbd;
    if (this.vy !== 0 || this.lift > 0) {
      this.vy -= 30 * dt;
      this.lift += this.vy * dt;
      if (this.lift <= 0) { this.lift = 0; this.vy = 0; }
    }
    const lim = g.track.roadHalf - this.radius * 0.6;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.y = g.heightAt(this.pos.x, this.pos.z);

    const face = this.flee ? 0 : dz > 1 ? Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z) : Math.PI;
    this.heading = turnToward(this.heading, face, 5 * dt);
    this.root.position.set(this.pos.x, this.pos.y + this.lift, this.pos.z);
    this.root.rotation.y = this.heading;
    this.anim.move = clamp(Math.hypot(this.vel.x, this.vel.z) / Math.max(1, this.def.speed * 0.6), 0, 1.5);
    this.anim.attack = this.atkT;
    this.anim.hurt = this.hurt;
    // 远处（雾里）或已被甩到身后的怪物：动画每 3 帧才更新一次姿势，看不出区别，省下骨骼计算
    this.animDt += dt;
    if ((dz < 60 && dz > -3) || ++this.animSkip % 3 === 0) { this.model.update(this.animDt, this.anim); this.animDt = 0; }

    if (this.flashT > 0) this.flash.setFlash(0.7 * this.flashT / 0.12);
    else if (this.slowT > 0) this.flash.setFlash(0.35, ICE_COL);
    else this.flash.setFlash(0);
    updateBar(this, dt, this.flying ? this.hoverY + 1.1 : this.height + 0.5);
  }

  shoot() {
    const g = this.game;
    const r = this.def.ranged;
    const pl = g.player;
    this.model.muzzle.getWorldPosition(_v);
    pl.getCenter(_v2);
    const t = _v.distanceTo(_v2) / r.speed;
    _v2.x += pl.vel.x * t * 0.5; _v2.z += pl.vel.z * t;
    _dir.subVectors(_v2, _v).normalize();
    g.projectiles.spawn({
      kind: PROJ_KIND[r.kind] || 'orb', owner: 'enemy', pos: _v, dir: _dir, speed: r.speed, dmg: this.dmg * 0.65,
      radius: 0.55, life: 3.5, homing: (r.homing || 0) * 0.5, poison: r.poison || 0, color: r.color, knock: 3,
    });
    g.audio.play('enemyShoot', { volume: 0.35, pitch: rand(0.9, 1.2) });
  }

  /** 毒雾：伤害按天灾算（跳得够高能躲，翼龙除外），圈边擦过算完美闪避 */
  spewMist() {
    const g = this.game, pl = g.player, M = this.def.mist;
    _v.copy(this.pos);
    g.fx.dust.burst(_v, { count: 20, speed: 3.2, life: 1.4, size: 1.5, sizeEnd: 3.6, color: 0x7ad040, alpha: 0.45, flat: true, drag: 2, up: 1.5 });
    g.fx.sparks.burst(_v, { count: 14, speed: 5, life: 0.7, size: 0.6, color: 0xc8ff60, color2: 0x306010, up: 4 });
    g.fx.rings.ring(_v, { r0: 0.5, r1: M.radius * 1.2, life: 0.5, color: 0x9cff3a, opacity: 0.6 });
    g.audio.play('poison', { volume: 0.5, pitch: 1.3 });
    // 毒雾在原地滞留一小会儿，这期间冲进去同样中招（每团雾只伤一次）
    this.mistT = 1.0; this.mistHit = false; this.mistNear = false;
    this.mistCheck();
  }
  mistCheck() {
    const g = this.game, pl = g.player, M = this.def.mist;
    if (!pl.alive) return;
    const d = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
    const air = pl.pos.y - g.heightAt(pl.pos.x, pl.pos.z);
    if (d < M.radius + pl.radius * 0.35 && (pl.alwaysHittable || air < 2.5)) {
      this.mistHit = true;
      _dir.set(pl.pos.x - this.pos.x, 0, pl.pos.z - this.pos.z).normalize();
      pl.takeDamage(this.dmg, { dir: _dir, knock: 6, poison: M.poison, kind: 'melee' });
    } else if (d < M.radius + 2.2) this.mistNear = true;
    if (this.mistT <= 0 && this.mistNear && !this.mistHit) { this.mistHit = true; g.onPerfect(pl.pos); }
  }

  teleport() {
    const g = this.game;
    this.teleCd = rand(4, 7);
    this.getCenter(_v);
    g.fx.sparks.burst(_v, { count: 26, speed: 6, life: 0.5, size: 0.7, color: 0xb04aff, color2: 0x300060 });
    const nx = rand(-g.track.roadHalf + 2, g.track.roadHalf - 2);
    const nz = g.player.pos.z + rand(28, 40);
    this.pos.set(nx, g.heightAt(nx, nz), nz);
    this.homeX = nx;
    this.getCenter(_v);
    g.fx.sparks.burst(_v, { count: 26, speed: 6, life: 0.5, size: 0.7, color: 0xb04aff, color2: 0x300060 });
    g.audio.play('portal', { volume: 0.35, pitch: 1.5 });
  }

  dispose() {
    if (this.thread) { this.root.remove(this.thread); this.thread = null; }
    this.root.visible = true;
    this.game.scene.remove(this.root);
    disposeModel(this.root);
  }
}

// ---------------------------------------------------------------------
//  路障：岩石（挡路，可打碎）/ 宝箱（打碎掉金币与经验）
// ---------------------------------------------------------------------
const rockGeo = new THREE.DodecahedronGeometry(1, 0);
const chestBodyGeo = new THREE.BoxGeometry(1.6, 1.0, 1.1);
const chestLidGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.6, 8, 1, false, 0, Math.PI).rotateZ(Math.PI / 2);
const bandGeo = new THREE.BoxGeometry(0.16, 1.05, 1.16);
const lockGeo = new THREE.BoxGeometry(0.3, 0.36, 0.12);

export class Prop {
  constructor(game, kind, x, z, mul = 1) {
    this.game = game;
    this.type = kind;
    this.isProp = true;
    this.isBoss = false;
    this.flying = false;
    this.hoverY = 0;
    this.lift = 0;
    this.root = new THREE.Group();
    if (kind === 'chest') {
      this.def = { name: t('enemy.chest'), score: 20, coins: 14, color: 0xffc040 };
      const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.8, flatShading: true });
      const gold = new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 0.8, roughness: 0.3, emissive: 0x6a4400, emissiveIntensity: 0.6 });
      const body = new THREE.Mesh(chestBodyGeo, wood); body.position.y = 0.5;
      const lid = new THREE.Mesh(chestLidGeo, wood); lid.position.y = 1.0;
      const b1 = new THREE.Mesh(bandGeo, gold); b1.position.set(-0.5, 0.52, 0);
      const b2 = new THREE.Mesh(bandGeo, gold); b2.position.set(0.5, 0.52, 0);
      const lock = new THREE.Mesh(lockGeo, gold); lock.position.set(0, 0.8, -0.58);
      this.root.add(body, lid, b1, b2, lock);
      this.radius = 1.0; this.height = 1.6;
      this.maxHp = this.hp = Math.round(40 * mul);
      this.dmg = 0; this.xp = 8;
    } else {
      this.def = { name: t('enemy.rock'), score: 5, coins: 2, color: 0x8a8070 };
      const mat = new THREE.MeshStandardMaterial({ color: game.rockColor || 0x7a7266, roughness: 0.95, flatShading: true });
      const sizes = [[0, 0.9, 0, 1.25], [0.9, 0.6, 0.3, 0.8], [-0.8, 0.55, -0.2, 0.75]];
      for (const [px, py, pz, s] of sizes) {
        const m = new THREE.Mesh(rockGeo, mat);
        m.position.set(px, py, pz); m.scale.setScalar(s);
        m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        this.root.add(m);
      }
      this.radius = 1.7; this.height = 2.2;
      this.maxHp = this.hp = Math.round(90 * mul);
      this.dmg = 14 * Math.sqrt(mul); this.xp = 3;
    }
    this.halfHeight = this.height * 0.5;
    this.pos = new THREE.Vector3(x, game.heightAt(x, z), z);
    this.vel = new THREE.Vector3();
    this.root.position.copy(this.pos);
    this.root.rotation.y = Math.random() * Math.PI * 2;
    game.scene.add(this.root);
    this.flash = prepareModel(this.root, { cast: false, receive: true, rim: false });
    this.alive = true; this.removed = false; this.deadT = 0; this.state = 'active';
    this.hurt = 0; this.flashT = 0; this.collideCd = 0; this.stun = 0;
    this.barW = 1.6;
    this.barT = 0;
    this.barTop = this.height + 0.6;
    this.anim = { burrow: 0 };
  }

  get targetable() { return this.alive; }
  getCenter(out) { return out.set(this.pos.x, this.pos.y + this.halfHeight, this.pos.z); }
  applyStatus() {}
  kill() { this.alive = false; this.state = 'dead'; this.deadT = 0; }

  update(dt) {
    const g = this.game;
    this.flashT = Math.max(0, this.flashT - dt);
    this.collideCd -= dt;
    if (this.pos.z - g.player.pos.z < -16) { this.removed = true; return; }
    if (!this.alive) {
      this.deadT += dt * 4;
      this.root.scale.setScalar(Math.max(0.01, 1 - this.deadT));
      if (this.deadT >= 1) this.removed = true;
      return;
    }
    this.flash.setFlash(this.flashT > 0 ? this.flashT / 0.12 : 0);
    updateBar(this, dt, this.height + 0.6);
  }

  dispose() {
    this.game.scene.remove(this.root);
    this.root.traverse((o) => { if (o.material) o.material.dispose(); });
  }
}

// ---------------------------------------------------------------------
//  首领：停在玩家前方，横向游走并释放招式
// ---------------------------------------------------------------------
export class Boss {
  constructor(game, type, x, z, mul = { hp: 1, dmg: 1 }) {
    this.game = game;
    this.type = type;
    this.def = BOSSES[type];
    this.isBoss = true;
    this.isProp = false;
    this.model = buildBossModel(type);
    this.root = this.model.root;
    game.scene.add(this.root);
    this.flash = prepareModel(this.root, { cast: true });
    this.radius = this.def.radius;
    this.height = this.model.size.height || this.def.height;
    this.halfHeight = this.height * 0.5;
    this.flying = false;
    this.hoverY = 0;
    this.lift = 0;
    this.maxHp = this.hp = Math.round(this.def.hp * mul.hp);
    this.dmg = this.def.dmg * mul.dmg;
    this.xp = 0;
    this.mass = 40;
    this.anchorD = 22 + this.radius * 1.3;
    this.pos = new THREE.Vector3(x, game.heightAt(x, z), z);
    this.vel = new THREE.Vector3();
    this.heading = Math.PI;
    this.state = 'intro';
    this.stateT = 0;
    this.phase = 1;
    this.phases = this.def.phases || 2;
    this.pattern = null;
    this.patternCd = 1.8;
    this.lastPattern = null;
    this.invulnT = 0;
    this.stun = 0;
    this.slowT = 0; this.slowMul = 1;
    this.burnT = 0; this.burnDps = 0; this.poisonT = 0; this.poisonDps = 0; this.dotTick = 0.5;
    this.hurt = 0; this.flashT = 0;
    this.alive = true; this.removed = false; this.deadT = 0; this.deathFx = 0;
    this.anim = { t: 0, move: 0, attack: -1, pattern: null, hurt: 0, dead: 0, phase: 1, burrow: type === 'sandworm' ? 1 : 0 };
    this.introY = type === 'sandworm' ? 0 : -this.height - 1;
    this.bar = new THREE.Group();
    this.barT = 0;
    this.collideCd = 0;
    this.zones = []; // 蛛网 / 毒沼 / 流沙 / 灼地等持续地面区域
  }

  get targetable() { return this.alive && this.state === 'fight' && this.anim.burrow < 0.5; }
  getCenter(out) { return out.set(this.pos.x, this.pos.y + this.height * 0.45, this.pos.z); }

  applyStatus(o, dotBase = 0) {
    if (o.stun) this.stun = Math.max(this.stun, o.stun * 0.2);
    if (o.slow) { this.slowMul = Math.min(this.slowMul, 1 - o.slow * 0.5); this.slowT = Math.max(this.slowT, (o.slowTime || 2) * 0.6); }
    if (o.burn) { this.burnT = Math.max(this.burnT, o.burn); this.burnDps = Math.max(this.burnDps, dotBase * 0.35); }
    if (o.poison) { this.poisonT = Math.max(this.poisonT, o.poison); this.poisonDps = Math.max(this.poisonDps, dotBase * 0.3); }
  }

  kill() { this.alive = false; this.state = 'dead'; this.deadT = 0; this.endPattern(); this.clearZones(); }

  checkPhase() {
    const th = this.phases === 3 ? [0.66, 0.33] : [0.5];
    if (this.phase - 1 < th.length && this.hp / this.maxHp < th[this.phase - 1]) {
      this.phase++;
      this.anim.phase = this.phase;
      this.endPattern();
      this.invulnT = 1.6;
      this.patternCd = 2;
      const g = this.game;
      g.audio.play('bossRoar');
      g.shake.add(0.4);
      g.fx.rings.ring(this.pos, { r0: 2, r1: 16, life: 0.8, color: this.def.projColor });
      g.fx.rings.pillar(this.pos, { r: this.radius * 1.4, h: 20, life: 1.2, color: this.def.projColor });
      g.fx.sparks.burst(this.getCenter(_v), { count: 80, speed: 14, life: 1, size: 1.2, color: this.def.projColor, color2: 0xffffff });
      g.juice.flash(this.def.projColor, 0.45);
      g.juice.aberr(1.8);
      g.juice.radial(1.2);
      g.juice.bloom(0.9);
      g.fx.debris.burst(this.pos, { count: 24, speed: 12, up: 12, size: 0.5, color: g.rockColor ?? 0x7a6a5a });
      g.showBanner(t('banner.enrage'), t('banner.phase', { name: this.def.name, n: this.phase }), true);
      this.pattern = { name: 'roar', t: 0, dur: 1.4, fired: true, teles: [] };
    }
  }

  update(dt) {
    const g = this.game;
    const pl = g.player;
    this.anim.t += dt;
    this.hurt = Math.max(0, this.hurt - dt * 4);
    this.flashT = Math.max(0, this.flashT - dt);
    this.invulnT -= dt;

    if (this.state === 'intro') {
      this.stateT += dt;
      const k = Math.min(1, this.stateT / 2.2);
      this.pos.z = damp(this.pos.z, pl.pos.z + this.anchorD, 2, dt);
      this.pos.y = g.heightAt(this.pos.x, this.pos.z);
      if (this.type === 'sandworm') this.anim.burrow = 1 - k;
      else this.introY = -(this.height + 1) * (1 - (1 - Math.pow(1 - k, 3)));
      if (k < 1 && Math.random() < 0.7) g.fx.dust.burst(this.pos, { count: 3, speed: 5, life: 1, size: 2, sizeEnd: 4, color: g.dustColor, alpha: 0.6, radius: this.radius, up: 3 });
      if (this.stateT > 2.3 && !this.introRoar) {
        this.introRoar = true;
        this.anim.pattern = 'volley'; this.anim.attack = 0.5;
        g.audio.play('bossRoar');
        g.shake.add(0.3);
        g.fx.rings.ring(this.pos, { r0: 2, r1: 18, life: 0.9, color: this.def.projColor });
      }
      if (this.stateT > 3.2) { this.state = 'fight'; this.anim.pattern = null; this.anim.attack = -1; this.introY = 0; }
      this.root.position.set(this.pos.x, this.pos.y + this.introY, this.pos.z);
      this.root.rotation.y = this.heading;
      this.model.update(dt, this.anim);
      return;
    }

    if (this.state === 'dead') {
      this.deadT += dt / 2.6;
      this.anim.dead = Math.min(1, this.deadT);
      this.anim.attack = -1; this.anim.pattern = null; this.anim.move = 0;
      this.deathFx -= dt;
      if (this.deathFx <= 0 && this.deadT < 1) {
        this.deathFx = 0.18;
        this.getCenter(_v);
        _v.x += rand(-1, 1) * this.radius; _v.y += rand(-0.5, 0.8) * this.height * 0.5; _v.z += rand(-1, 1) * this.radius;
        g.fx.sparks.burst(_v, { count: 30, speed: 9, life: 0.6, size: 1.3, color: 0xffe080, color2: this.def.projColor });
        g.audio.play('explosion', { volume: 0.6, pitch: rand(0.7, 1.1) });
      }
      this.root.position.set(this.pos.x, this.pos.y, this.pos.z);
      this.model.update(dt, this.anim);
      this.flash.setFlash(Math.min(0.8, this.deadT));
      if (this.deadT > 1.3) this.removed = true;
      return;
    }

    this.dotTick -= dt;
    if (this.burnT > 0) this.burnT -= dt;
    if (this.poisonT > 0) this.poisonT -= dt;
    if (this.dotTick <= 0) {
      this.dotTick = 0.5;
      if (this.burnT > 0) g.damageEnemy(this, this.burnDps * 0.5, { source: 'dot', dotColor: 'burn' });
      if (this.poisonT > 0 && this.alive) g.damageEnemy(this, this.poisonDps * 0.5, { source: 'dot', dotColor: 'poison' });
      if (!this.alive) return;
    }
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.slowMul = 1; }

    this.updateZones(dt);
    const rh = g.track.roadHalf;
    let tx = clamp(Math.sin(this.anim.t * 0.45) * rh * 0.55 + pl.pos.x * 0.35, -rh + 2, rh - 2);
    let tz = pl.pos.z + this.anchorD;
    let drive = false;
    if (this.stun > 0) this.stun -= dt;
    else if (this.pattern) {
      const r = this.runPattern(dt);
      if (r) { drive = !!r.drive; if (r.tx !== undefined) tx = r.tx; if (r.tz !== undefined) tz = r.tz; }
    } else if (pl.alive && g.state !== 'win') {
      this.patternCd -= dt;
      if (this.patternCd <= 0) this.choosePattern();
    }
    if (!drive) {
      const sp = this.def.speed * this.slowMul * (1 + 0.15 * (this.phase - 1));
      const nx = damp(this.pos.x, tx, 1.6, dt), nz = damp(this.pos.z, tz, 2, dt);
      this.vel.set((nx - this.pos.x) / Math.max(dt, 1e-4), 0, (nz - this.pos.z) / Math.max(dt, 1e-4));
      const vl = Math.hypot(this.vel.x, this.vel.z);
      if (vl > sp * 1.5) this.vel.multiplyScalar(sp * 1.5 / vl);
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    }
    this.pos.x = clamp(this.pos.x, -rh + 1, rh - 1);
    this.pos.y = g.heightAt(this.pos.x, this.pos.z);
    const face = Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
    this.heading = turnToward(this.heading, face, 2 * dt);

    this.root.position.set(this.pos.x, this.pos.y + this.lift, this.pos.z);
    this.root.rotation.y = this.heading;
    this.anim.move = clamp(Math.hypot(this.vel.x, this.vel.z) / this.def.speed, 0, 2);
    this.anim.hurt = this.hurt;
    this.anim.attack = this.pattern ? Math.min(1, this.pattern.t / this.pattern.dur) : -1;
    // 新招式借用模型已有的动作（def.anim），换阶段的怒吼用召唤动作
    this.anim.pattern = this.pattern ? (this.pattern.name === 'roar' ? 'summon' : (this.def.anim && this.def.anim[this.pattern.name]) || this.pattern.name) : null;
    this.model.update(dt, this.anim);

    if (this.flashT > 0) this.flash.setFlash(0.7 * this.flashT / 0.12);
    else if (this.invulnT > 0) this.flash.setFlash(0.3 + 0.2 * Math.sin(this.anim.t * 20), _col.set(this.def.projColor));
    else this.flash.setFlash(0);
  }

  choosePattern() {
    const g = this.game;
    const opts = this.def.patterns.filter((p) => p !== this.lastPattern);
    const w = opts.map((p) => (p === 'summon' || p === 'brood' ? (g.enemies.length > 8 ? 0.15 : 0.9)
      : (p === 'sweep' || p === 'blink') && this.phase >= 3 ? 1.6 : p === 'scythe' ? 1.3 : 1));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    let name = opts[0];
    for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) { name = opts[i]; break; } }
    this.lastPattern = name;
    this.startPattern(name);
  }

  startPattern(name) {
    const g = this.game;
    const pl = g.player;
    const ph = this.phase;
    const fast = 1 - 0.12 * (ph - 1);
    const rh = g.track.roadHalf;
    const P = { name, t: 0, dur: 1.5, fired: false, teles: [], count: 0 };
    const skill = this.def.skills && this.def.skills[name];
    if (skill && g.hud) g.hud.notice(`${this.def.name} · ${skill}`, 'boss');
    switch (name) {
      case 'frostSlam':
      case 'slam': {
        P.windup = 1.15 * fast;
        P.dur = P.windup + 0.7;
        P.spots = [];
        const n = 1 + ph;
        for (let i = 0; i < n; i++) {
          const x = i === 0 ? pl.pos.x : rand(-rh + 3, rh - 3);
          const z = pl.pos.z + (i === 0 ? 0 : rand(-3, 7));
          P.spots.push({ x, z });
          P.teles.push(g.tele.add({ shape: 'circle', x, z, radius: 4.3, duration: P.windup, color: name === 'frostSlam' ? 0x60c8ff : 0xff3030 }));
        }
        g.audio.play('warning', { volume: 0.5 });
        break;
      }
      case 'volley': P.dur = 2.3; P.shots = 2 + (ph >= 2 ? 1 : 0) + (ph >= 3 ? 1 : 0); g.audio.play('warning', { volume: 0.4 }); break;
      case 'barrage': P.shots = 6 + ph * 3; P.dur = 0.6 + P.shots * 0.16 + 0.4; break;
      case 'summon':
        P.dur = 1.8;
        g.audio.play('portal', { volume: 0.7 });
        g.fx.rings.pillar(this.pos, { r: this.radius, h: 16, life: 1.5, color: this.def.projColor, opacity: 0.5 });
        break;
      case 'lavaCharge':
      case 'charge':
        P.aim = 0.55 * fast; P.windup = 1.05 * fast;
        P.speed = 32 * (1 + 0.1 * (ph - 1));
        P.dur = 6;
        g.audio.play('warning', { volume: 0.6 });
        break;
      case 'burrow': P.dur = 5.2; g.audio.play('quake', { volume: 0.6 }); break;
      case 'breath': {
        P.windup = 0.8 * fast;
        P.dur = P.windup + 1.7;
        P.half = 0.16;
        P.angle = Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
        P.len = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z) + 8;
        P.teles.push(g.tele.add({ shape: 'sector', x: this.pos.x, z: this.pos.z, angle: P.angle, radius: P.len, half: P.half, duration: P.dur, color: 0xff5020 }));
        P.acc = 0;
        break;
      }
      case 'meteor': {
        P.dur = 3.2;
        P.queue = [];
        const n = 5 + ph * 2;
        for (let i = 0; i < n; i++) {
          const x = i === 0 ? pl.pos.x : rand(-rh + 2, rh - 2);
          const z = pl.pos.z + (i === 0 ? 0 : rand(-4, 9));
          P.queue.push({ t: 0.3 + i * 0.14, x, z });
        }
        P.dur = 0.3 + n * 0.14 + 1.5; // 等最后一颗落地（灼烧地面在落地时生成）
        g.audio.play('warning', { volume: 0.6 });
        break;
      }
      // —— 螳螂王 ——
      case 'scythe': {
        // 十字斩：以玩家为中心的 X 形两道（第 3 阶段再加一道横斩）
        P.windup = 0.95 * fast;
        P.dur = P.windup + 0.6;
        P.cx = pl.pos.x; P.cz = pl.pos.z;
        P.len = 17; P.w = 2.8;
        P.angles = ph >= 3 ? [Math.PI / 4, -Math.PI / 4, Math.PI / 2] : [Math.PI / 4, -Math.PI / 4];
        for (const a of P.angles) {
          const dx = Math.sin(a), dz = Math.cos(a);
          P.teles.push(g.tele.add({ shape: 'rect', x: P.cx - dx * P.len / 2, z: P.cz - dz * P.len / 2, angle: a, length: P.len, width: P.w, duration: P.windup, color: 0xff3030 }));
        }
        g.audio.play('warning', { volume: 0.55 });
        break;
      }
      case 'sweep':
        // 镰刃波：横扫整条路，必须跳过去（第 3 阶段连发两道）
        P.windup = 0.75 * fast;
        P.waves = ph >= 3 ? 2 : 1;
        P.dur = P.windup + 0.5 * P.waves + 0.6;
        g.audio.play('warning', { volume: 0.5 });
        break;
      case 'blink':
        // 瞬移突袭：隐身 → 出现在玩家身侧 → 下劈
        P.vanish = 0.35; P.windup = P.vanish + 0.75 * fast;
        P.dur = P.windup + 0.9;
        g.audio.play('portal', { volume: 0.6, pitch: 1.4 });
        g.fx.sparks.burst(this.getCenter(_v), { count: 40, speed: 8, life: 0.5, size: 1, color: 0xc8ff80, color2: 0x206010 });
        break;
      default:
        if (!this.startSkill(name, P, ph, fast)) P.dur = 0.5;
    }
    this.pattern = P;
  }

  endPattern() {
    if (!this.pattern) return;
    this.root.visible = true;
    this.lift = 0;
    for (const t of this.pattern.teles || []) this.game.tele.remove(t);
    this.pattern = null;
  }

  /** 返回 { drive, tx, tz } 用于控制移动 */
  runPattern(dt) {
    const g = this.game;
    const P = this.pattern;
    const pl = g.player;
    P.t += dt;
    const ph = this.phase;
    const color = this.def.projColor;
    let out = null;

    switch (P.name) {
      case 'frostSlam':
      case 'slam':
        out = { tx: this.pos.x };
        if (!P.fired && P.t >= P.windup) {
          P.fired = true;
          for (const s of P.spots) {
            _v.set(s.x, g.heightAt(s.x, s.z), s.z);
            const dd = Math.hypot(pl.pos.x - s.x, pl.pos.z - s.z), hitR = 4.3 + pl.radius * 0.4;
            const frost = P.name === 'frostSlam';
            if (dd < hitR && (pl.alwaysHittable || pl.pos.y - _v.y < 2.5)) {
              _dir.set(pl.pos.x - s.x, 0, pl.pos.z - s.z).normalize();
              pl.takeDamage(this.dmg * (frost ? 1.25 : 1.2), { dir: _dir, knock: 10, attacker: this, kind: 'melee', slow: frost ? 0.8 : 0, slowTime: 2.5 });
            } else if (dd < hitR + 2.4) g.onPerfect(pl.pos); // 擦身躲过 / 跳过砸地
            if (frost) {
              // 冰刺向四周炸开，被打中会冻慢
              const n = 6 + ph * 2;
              for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2 + rand(0, 0.4);
                _dir.set(Math.sin(a), 0, Math.cos(a));
                g.projectiles.spawn({ kind: 'borb', owner: 'enemy', pos: _v, dir: _dir, speed: 12, dmg: this.dmg * 0.4, radius: 0.7, life: 2.2, color: 0xbfeaff, hover: 1.3, scale: 0.85, slow: 0.6, slowTime: 1.5 });
              }
              g.fx.sparks.burst(_v, { count: 22, speed: 9, life: 0.6, size: 1, color: 0xffffff, color2: 0x7ad0ff, up: 5 });
            }
            g.fx.rings.ring(_v, { r0: 1, r1: 5, life: 0.45, color: 0xffd0a0 });
            g.fx.dust.burst(_v, { count: 24, speed: 6, life: 0.9, size: 1.4, sizeEnd: 3.5, color: g.dustColor, alpha: 0.6, flat: true, drag: 2, up: 3 });
            g.fx.sparks.burst(_v, { count: 14, speed: 7, life: 0.4, size: 0.8, color: 0xffe0a0, color2: color, up: 3 });
            g.fx.debris.burst(_v, { count: 7, speed: 7, up: 8, size: 0.4, color: g.rockColor ?? 0x7a6a5a });
            g.fx.scorch.add(_v, 3.2, 3.5);
            if (ph >= 2 && !frost) {
              for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                _dir.set(Math.sin(a), 0, Math.cos(a));
                g.projectiles.spawn({ kind: 'borb', owner: 'enemy', pos: _v, dir: _dir, speed: 11, dmg: this.dmg * 0.45, radius: 0.7, life: 2, color, hover: 1.4, scale: 0.8 });
              }
            }
          }
          g.audio.play('stomp', { volume: 1, pitch: 0.7 });
          g.audio.play('quake', { volume: 0.6 });
          g.juice.fovKick(-2.5);
          g.juice.aberr(0.6);
          g.shake.add(0.3);
        }
        break;

      case 'volley': {
        const due = Math.floor((P.t - 0.6) / 0.45) + 1;
        while (P.count < P.shots && P.count < due && P.t >= 0.6) {
          const n = 9 + ph * 3;
          const base = Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
          const spread = THREE.MathUtils.degToRad(120);
          const off = (P.count % 2) * 0.5;
          _v.set(this.pos.x, 0, this.pos.z - this.radius * 0.8);
          for (let i = 0; i < n; i++) {
            const a = base + ((i + off) / n - 0.5) * spread;
            _dir.set(Math.sin(a), 0, Math.cos(a));
            g.projectiles.spawn({ kind: 'borb', owner: 'enemy', pos: _v, dir: _dir, speed: 14 + ph * 1.5, dmg: this.dmg * 0.5, radius: 0.7, life: 4.5, color, hover: 1.5 });
          }
          P.count++;
          g.audio.play('enemyShoot', { volume: 0.7, pitch: 0.6 });
          g.fx.rings.ring(this.pos, { r0: this.radius, r1: this.radius + 4, life: 0.3, color });
        }
        break;
      }

      case 'barrage': {
        const due = Math.floor((P.t - 0.6) / 0.16) + 1;
        while (P.count < P.shots && P.count < due && P.t >= 0.6) {
          P.count++;
          this.model.muzzle.getWorldPosition(_v);
          pl.getCenter(_v2);
          const t = _v.distanceTo(_v2) / 26;
          _v2.x += pl.vel.x * t * 0.8;
          _dir.subVectors(_v2, _v).normalize();
          _dir.applyAxisAngle(UP, rand(-0.05, 0.05));
          g.projectiles.spawn({ kind: 'borb', owner: 'enemy', pos: _v, dir: _dir, speed: 26, dmg: this.dmg * 0.45, radius: 0.6, life: 3, color, scale: 0.75 });
          g.audio.play('enemyShoot', { volume: 0.45, pitch: 1.1 });
        }
        break;
      }

      case 'summon':
        if (!P.fired && P.t > 0.8) {
          P.fired = true;
          const n = 2 + ph;
          const rh = g.track.roadHalf;
          for (let i = 0; i < n; i++) {
            if (g.enemies.length > 18) break;
            const x = clamp(this.pos.x + (i - (n - 1) / 2) * 3, -rh + 1.5, rh - 1.5);
            g.spawnEnemy(pick(this.def.summon), x, this.pos.z - this.radius - 2);
          }
        }
        break;

      case 'lavaCharge':
      case 'charge':
        if (P.t < P.aim) {
          out = { tx: pl.pos.x }; // 对准玩家所在的列
        } else if (P.t < P.windup) {
          if (!P.tele) {
            P.lane = this.pos.x;
            P.len = this.pos.z - pl.pos.z + 12;
            P.tele = g.tele.add({ shape: 'rect', x: P.lane, z: this.pos.z, angle: Math.PI, length: P.len, width: this.radius * 2.1, duration: P.windup - P.aim, color: 0xff3030 });
            P.teles.push(P.tele);
          }
          out = { tx: P.lane };
          if (Math.random() < 0.5) g.fx.dust.burst(this.pos, { count: 2, speed: 3, life: 0.6, size: 1.2, sizeEnd: 2.5, color: g.dustColor, alpha: 0.5, up: 1.5 });
        } else if (!P.back) {
          if (!P.started) { P.started = true; g.audio.play('charge', { pitch: 0.6 }); }
          this.pos.z -= P.speed * dt;
          this.pos.x = P.lane;
          this.vel.set(0, 0, -P.speed);
          if (!P.hit && Math.abs(pl.pos.z - this.pos.z) < this.radius + pl.radius && Math.abs(pl.pos.x - this.pos.x) < this.radius + pl.radius * 0.6 && (pl.alwaysHittable || pl.pos.y - this.pos.y < 3)) {
            P.hit = true;
            _dir.set(Math.sign(pl.pos.x - this.pos.x) || 1, 0, -0.5).normalize();
            pl.takeDamage(this.dmg * 1.3, { dir: _dir, knock: 16, attacker: this, kind: 'melee' });
            pl.vel.x += _dir.x * 14;
          }
          g.fx.dust.burst(this.pos, { count: 3, speed: 4, life: 0.7, size: 1.6, sizeEnd: 3.5, color: g.dustColor, alpha: 0.55, up: 1.5, radius: this.radius * 0.5 });
          if (P.name === 'lavaCharge' && (P.lastZ === undefined || P.lastZ - this.pos.z > 3.2)) {
            P.lastZ = this.pos.z;
            this.addZone({ x: this.pos.x, z: this.pos.z, r: 2.3, life: 3 + ph * 0.5, dps: 0.16, color: 0xff5a1a, fx: 'fire' });
          }
          if (this.pos.z < pl.pos.z - 10) P.back = true;
          out = { drive: true };
        } else {
          // 返回原位
          const tz = pl.pos.z + this.anchorD;
          this.pos.z = Math.min(tz, this.pos.z + 18 * dt);
          this.vel.set(0, 0, 18);
          out = { drive: true };
          if (this.pos.z >= tz - 0.5) P.t = P.dur;
        }
        break;

      case 'scythe':
        out = { tx: this.pos.x };
        if (!P.fired && P.t >= P.windup) {
          P.fired = true;
          const hitW = P.w / 2 + pl.radius * 0.4;
          let hit = false, near = false;
          for (const a of P.angles) {
            const dx = Math.sin(a), dz = Math.cos(a);
            const rx = pl.pos.x - P.cx, rz = pl.pos.z - P.cz;
            const along = rx * dx + rz * dz, perp = Math.abs(rx * dz - rz * dx);
            if (Math.abs(along) < P.len / 2 + 0.5) { if (perp < hitW) hit = true; else if (perp < hitW + 2) near = true; }
            // 沿斩线喷出刀光
            for (let k = -3; k <= 3; k++) {
              _v.set(P.cx + dx * k * P.len / 7, 0, P.cz + dz * k * P.len / 7);
              _v.y = g.heightAt(_v.x, _v.z);
              g.fx.sparks.burst(_v, { count: 6, speed: 6, life: 0.35, size: 0.8, color: 0xf0ffd0, color2: color, up: 2 });
              if (k % 2 === 0) g.fx.scorch.add(_v, 1.3, 3);
            }
          }
          if (hit && (pl.alwaysHittable || pl.pos.y - g.heightAt(pl.pos.x, pl.pos.z) < 3)) {
            _dir.set(Math.sign(pl.pos.x - P.cx) || 1, 0, -0.4).normalize();
            pl.takeDamage(this.dmg * 1.3, { dir: _dir, knock: 12, attacker: this, kind: 'melee' });
          } else if (near) g.onPerfect(pl.pos);
          _v.set(P.cx, g.heightAt(P.cx, P.cz), P.cz);
          g.fx.rings.ring(_v, { r0: 1, r1: 9, life: 0.4, color: 0xd8ff80 });
          g.fx.debris.burst(_v, { count: 8, speed: 8, up: 7, size: 0.35, color: g.rockColor ?? 0x4a2a2a });
          g.audio.play('claw', { volume: 1, pitch: 0.6 });
          g.audio.play('hitHeavy', { volume: 0.8, pitch: 0.7 });
          g.shakeAt(_v, 0.35);
          g.juice.aberr(0.8);
          g.juice.fovKick(-2.5);
        }
        break;

      case 'sweep': {
        out = { tx: this.pos.x };
        const rh = g.track.roadHalf;
        while (P.count < P.waves && P.t >= P.windup + P.count * 0.5) {
          P.count++;
          _v.set(0, g.heightAt(0, this.pos.z - 3) + 0.9, this.pos.z - 3);
          _dir.set(0, 0, -1);
          g.projectiles.spawn({ kind: 'scythewave', owner: 'enemy', pos: _v, dir: _dir, speed: 24, dmg: this.dmg * 1.1, radius: 1, life: 3, knock: 10, width: rh * 2 + 2, sweepW: rh * 2 + 2, hover: 0.9, color });
          g.audio.play('whoosh', { volume: 1, pitch: 0.6 });
          g.audio.play('wave', { volume: 0.6, pitch: 0.8 });
          g.juice.aberr(0.5);
        }
        break;
      }

      case 'blink': {
        const k = P.t;
        if (k < P.vanish) {
          this.root.visible = Math.sin(k * 60) > 0;
          out = { tx: this.pos.x };
        } else if (!P.appeared) {
          // 出现在玩家侧前方，地面圆形预警
          P.appeared = true;
          this.root.visible = true;
          const side = pl.pos.x > 0 ? -1 : 1;
          const rh = g.track.roadHalf;
          P.bx = clamp(pl.pos.x + side * 5, -rh + 2, rh - 2);
          P.bz = pl.pos.z + 7;
          P.sx = pl.pos.x; P.sz = pl.pos.z + 1.5;
          this.pos.x = P.bx; this.pos.z = P.bz;
          P.teles.push(g.tele.add({ shape: 'circle', x: P.sx, z: P.sz, radius: 4.2, duration: P.windup - P.vanish, color: 0xff3030 }));
          g.fx.sparks.burst(this.getCenter(_v), { count: 50, speed: 10, life: 0.5, size: 1, color: 0xe0ff90, color2: 0x206010 });
          g.audio.play('portal', { volume: 0.7, pitch: 0.8 });
          out = { drive: true };
        } else if (!P.fired && k >= P.windup) {
          P.fired = true;
          const d = Math.hypot(pl.pos.x - P.sx, pl.pos.z - P.sz);
          if (d < 4.2 + pl.radius * 0.4 && (pl.alwaysHittable || pl.pos.y - g.heightAt(pl.pos.x, pl.pos.z) < 2.5)) {
            _dir.set(pl.pos.x - P.sx, 0, pl.pos.z - P.sz).normalize();
            pl.takeDamage(this.dmg * 1.4, { dir: _dir, knock: 14, attacker: this, kind: 'melee' });
          } else if (d < 6.6) g.onPerfect(pl.pos);
          _v.set(P.sx, g.heightAt(P.sx, P.sz), P.sz);
          g.fx.rings.ring(_v, { r0: 1, r1: 6, life: 0.4, color: 0xd8ff80 });
          g.fx.debris.burst(_v, { count: 10, speed: 8, up: 9, size: 0.4, color: g.rockColor ?? 0x4a2a2a });
          g.fx.scorch.add(_v, 3.4, 4);
          g.audio.play('stomp', { volume: 1, pitch: 0.7 });
          g.shakeAt(_v, 0.4);
          g.juice.fovKick(-3);
          out = { drive: true };
        } else {
          // 劈完后退回原本的跟随位置
          out = k > P.windup + 0.25 ? { tx: this.pos.x } : { drive: true };
        }
        break;
      }

      case 'burrow': {
        const t = P.t;
        if (t < 0.8) {
          this.anim.burrow = t / 0.8;
          out = { tx: this.pos.x };
        } else if (t < 3.4) {
          this.anim.burrow = 1;
          if (!P.tele) { P.tele = g.tele.add({ shape: 'circle', x: pl.pos.x, z: pl.pos.z, radius: 5.5, duration: 2.6, color: 0xff3030 }); P.teles.push(P.tele); }
          if (t < 2.8) {
            this.pos.x = damp(this.pos.x, pl.pos.x, 3, dt); this.pos.z = damp(this.pos.z, pl.pos.z, 3, dt);
            g.tele.move(P.tele, this.pos.x, this.pos.z);
          }
          if (Math.random() < 0.6) g.fx.dust.burst(this.pos, { count: 2, speed: 3, life: 0.6, size: 1.2, sizeEnd: 2.5, color: g.dustColor, alpha: 0.6, radius: 2, up: 2 });
          out = { drive: true };
        } else if (t < 3.8) {
          if (!P.fired) {
            P.fired = true;
            if (Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z) < 5.5 + pl.radius * 0.4) {
              _dir.set(pl.pos.x - this.pos.x, 0, 0.3).normalize();
              pl.takeDamage(this.dmg * 1.4, { dir: _dir, knock: 12, attacker: this, kind: 'melee' });
              pl.vy = 10; pl.onGround = false;
            }
            g.fx.dust.burst(this.pos, { count: 50, speed: 13, life: 1.2, size: 1.8, sizeEnd: 4, color: g.dustColor, alpha: 0.7, up: 8, gravity: 10 });
            g.fx.rings.ring(this.pos, { r0: 1, r1: 8, life: 0.5, color: 0xffd080 });
            g.audio.play('quake', { volume: 1 }); g.audio.play('bossRoar', { volume: 0.6 });
            g.shake.add(0.4);
          }
          this.anim.burrow = Math.max(0, 1 - (t - 3.4) / 0.3);
          out = { drive: true };
        } else if (t < 4.4) {
          this.anim.burrow = Math.min(1, (t - 3.8) / 0.4);
          out = { drive: true };
        } else {
          // 地下返回原位后冒出
          this.pos.z = pl.pos.z + this.anchorD;
          this.anim.burrow = Math.max(0, 1 - (t - 4.4) / 0.6);
          out = { drive: true };
        }
        break;
      }

      case 'breath':
        out = { tx: this.pos.x };
        if (P.t >= P.windup) {
          if (!P.started) { P.started = true; g.audio.play('burn', { volume: 0.8 }); g.audio.play('bossRoar', { volume: 0.4 }); }
          P.acc += dt;
          this.model.muzzle.getWorldPosition(_v);
          while (P.acc > 0.05) {
            P.acc -= 0.05;
            const a = P.angle + rand(-P.half, P.half) * 0.8;
            const dd = rand(P.len * 0.5, P.len);
            _v2.set(this.pos.x + Math.sin(a) * dd, 0, this.pos.z + Math.cos(a) * dd);
            _v2.y = g.heightAt(_v2.x, _v2.z) + 1.2;
            _dir.subVectors(_v2, _v).normalize();
            g.projectiles.spawn({ kind: 'borb', owner: 'enemy', pos: _v, dir: _dir, speed: 28, dmg: this.dmg * 0.22, radius: 0.9, life: 1.6, color, scale: 0.7, poison: this.type === 'hydra' ? 2 : 0 });
          }
          g.fx.sparks.burst(_v, { count: 4, speed: 14, life: 0.5, size: 1.4, sizeEnd: 2.5, color: 0xffe0a0, color2: color, dir: _dir.set(Math.sin(P.angle), -0.2, Math.cos(P.angle)), spread: 0.25 });
        }
        break;

      case 'meteor':
        out = { tx: this.pos.x };
        for (const q of P.queue) {
          if (q.done || P.t < q.t) continue;
          q.done = true;
          const gy = g.heightAt(q.x, q.z);
          P.teles.push(g.tele.add({ shape: 'circle', x: q.x, z: q.z, radius: 3.4, duration: 1.3, color: 0xff6020 }));
          _v.set(q.x + rand(-8, 8), gy + 36, q.z + rand(4, 14));
          _v2.set(q.x, gy, q.z);
          const d = _v.distanceTo(_v2);
          _dir.subVectors(_v2, _v).normalize();
          g.projectiles.spawn({ kind: 'meteor', owner: 'enemy', pos: _v, dir: _dir, speed: d / 1.3, dmg: this.dmg * 1.0, radius: 1.2, life: 2, aoe: 3.6, knock: 8, color: 0xff6020 });
          if (this.type === 'magmaGolem') { P.burns = P.burns || []; P.burns.push({ t: q.t + 1.3, x: q.x, z: q.z }); }
        }
        if (P.burns) for (const b of P.burns) {
          if (b.done || P.t < b.t) continue;
          b.done = true;
          this.addZone({ x: b.x, z: b.z, r: 2.6, life: 2.5, dps: 0.14, color: 0xff6a1a, fx: 'fire' });
        }
        break;

      default: {
        const r = this.runSkill(P, dt, ph, color);
        if (r) out = r;
      }
    }

    if (P.t >= P.dur) {
      this.endPattern();
      this.anim.burrow = 0;
      this.patternCd = rand(1.2, 2.2) * (1 - 0.18 * (ph - 1)) * this.game.diff.rest * BALANCE.bossRest;
    }
    return out;
  }

  // ===================================================================
  //  各首领的专属招式（每个首领 3 招，贴合所在关卡）
  // ===================================================================

  /** 落点抛射：从首领嘴部抛出一团，落地时回调 */
  lob(P, spots, flight, color, scale = 1) {
    const g = this.game;
    this.model.muzzle.getWorldPosition(_v);
    for (const sp of spots) {
      _v2.set(sp.x, g.heightAt(sp.x, sp.z) + 0.5, sp.z);
      const d = _v.distanceTo(_v2);
      _dir.subVectors(_v2, _v).normalize();
      g.projectiles.spawn({ kind: 'borb', owner: 'enemy', pos: _v, dir: _dir, speed: d / flight, dmg: 0, radius: 0.5, life: flight, color, scale: 1.3 * scale, groundHit: false, fake: true });
    }
  }

  /** 随机落点：第一个总在玩家脚下，其余散在路面上 */
  spots(n, zMin = -3, zMax = 8, margin = 3) {
    const g = this.game, pl = g.player, rh = g.track.roadHalf;
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(i === 0 ? { x: pl.pos.x, z: pl.pos.z } : { x: rand(-rh + margin, rh - margin), z: pl.pos.z + rand(zMin, zMax) });
    }
    return out;
  }

  /** 把路面切成若干竖列（宽 w），返回每列中心 x */
  laneSlots(w) {
    const rh = this.game.track.roadHalf;
    const n = Math.max(3, Math.floor((rh * 2) / w));
    const step = (rh * 2) / n;
    const out = [];
    for (let i = 0; i < n; i++) out.push(-rh + step * (i + 0.5));
    return { xs: out, w: step };
  }

  startSkill(name, P, ph, fast) {
    const g = this.game, pl = g.player, rh = g.track.roadHalf;
    switch (name) {
      // —— 剧毒蛛后：控制 + 毒 ——
      case 'web': {
        // 蛛网陷阱：抛出几团蛛网，落地变成减速 + 中毒的蛛网区
        P.flight = 1.0 * fast; P.lobT = 0.35;
        P.list = this.spots(1 + ph * 2, -2, 9);
        P.dur = P.lobT + P.flight + 0.4;
        for (const sp of P.list) P.teles.push(g.tele.add({ shape: 'circle', x: sp.x, z: sp.z, radius: 3.2, duration: P.lobT + P.flight, color: 0xe8f0e0 }));
        g.audio.play('warning', { volume: 0.4 });
        return true;
      }
      case 'pounce': {
        // 毒牙扑杀：跃起扑向玩家，落地重击并留下毒液
        P.windup = 0.75 * fast;
        P.dur = P.windup + 1.1;
        P.sx = this.pos.x; P.sz = this.pos.z;
        P.tx = pl.pos.x; P.tz = pl.pos.z + 2;
        P.r = 6.8;
        P.teles.push(g.tele.add({ shape: 'circle', x: P.tx, z: P.tz, radius: P.r, duration: P.windup, color: 0xff3030 }));
        g.audio.play('warning', { volume: 0.55 });
        return true;
      }
      case 'brood':
        // 蛛卵孵化：在路面产下蛛卵，孵出会喷毒雾的小蜘蛛
        P.dur = 1.8;
        g.audio.play('portal', { volume: 0.6, pitch: 1.3 });
        return true;

      // —— 沙海巨蠕：地下突袭 + 牵制 ——
      case 'quicksand':
        // 流沙漩涡：玩家脚下出现大漩涡，把人往中心吸，中心持续掉血
        P.dur = 1.2;
        this.addZone({ x: pl.pos.x, z: pl.pos.z + 1, r: 7.5, life: 4 + ph * 0.5, pull: 4.5 + ph * 1.5, core: 2.6, dps: 0.3, color: 0xe0b060, fx: 'sand' });
        g.audio.play('quake', { volume: 0.7 });
        return true;
      case 'sandstorm':
        // 沙暴吐息：三波扇形沙弹，每波留一条安全缝
        P.waves = 3; P.gap = 0.55; P.dur = 0.6 + P.waves * P.gap + 0.5;
        g.audio.play('warning', { volume: 0.45 });
        return true;

      // —— 冰霜巨人：冰冻减速 + 重击 ——
      case 'icicles': {
        // 冰锥坠落：若干整列路面预警，冰锥沿整列砸下（总留出可躲的列）
        const L = this.laneSlots(3.2);
        const pick2 = L.xs.map((x, i) => i).sort(() => Math.random() - 0.5);
        const n = Math.min(L.xs.length - 2, 1 + ph);
        let pi = L.xs.reduce((b, x, i) => (Math.abs(x - pl.pos.x) < Math.abs(L.xs[b] - pl.pos.x) ? i : b), 0);
        const chosen = new Set([pi]);
        for (const i of pick2) { if (chosen.size >= n) break; chosen.add(i); }
        P.waves = [{ t: 1.15 * fast, lanes: [...chosen].map((i) => L.xs[i]), w: L.w, fired: false }];
        P.laneColor = 0x9ae0ff; P.laneDmg = 1.1; P.laneSlow = 0.8;
        P.dur = P.waves[0].t + 0.6;
        this.teleLanes(P, P.waves[0], P.waves[0].t);
        g.audio.play('warning', { volume: 0.5 });
        return true;
      }
      case 'iceWall':
        // 冰墙推进：整排冰墙压过来，只留一个缺口（也可以跳过去）
        P.walls = ph; P.wallGap = 1.1; P.dur = 0.7 + P.walls * P.wallGap + 0.4;
        g.audio.play('warning', { volume: 0.45 });
        return true;

      // —— 沼泽三头蛇：多头齐攻 + 持续毒 ——
      case 'tripleBreath': {
        // 三首吐息：三个头朝左中右同时喷毒
        P.windup = 0.85 * fast;
        P.dur = P.windup + 1.8;
        P.half = 0.13;
        const base = Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
        P.len = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z) + 8;
        P.angles = [base - 0.5, base, base + 0.5];
        P.swing = ph >= 2 ? 0.16 : 0;
        for (const a of P.angles) P.teles.push(g.tele.add({ shape: 'sector', x: this.pos.x, z: this.pos.z, angle: a, radius: P.len, half: P.half + P.swing * 0.6, duration: P.dur, color: 0x7aff4a }));
        P.acc = 0;
        return true;
      }
      case 'bog':
        // 毒沼泥潭：抛出毒泥，留下踩上去会中毒变慢的毒沼
        P.flight = 1.05 * fast; P.lobT = 0.4;
        P.list = this.spots(2 + ph, -2, 9);
        P.dur = P.lobT + P.flight + 0.4;
        for (const sp of P.list) P.teles.push(g.tele.add({ shape: 'circle', x: sp.x, z: sp.z, radius: 3.4, duration: P.lobT + P.flight, color: 0x7aff4a }));
        g.audio.play('warning', { volume: 0.4 });
        return true;
      case 'mistOrbs':
        // 迷雾毒弹：一串预判走位的毒弹
        P.shots = 7 + ph * 3; P.dur = 0.6 + P.shots * 0.2 + 0.4;
        return true;

      // —— 熔岩巨魔：火焰 + 灼地 ——
      case 'eruption': {
        // 火山喷发：从脚下向玩家一排一排喷出岩浆柱
        const rows = 4 + ph;
        P.rows = [];
        const zs = this.pos.z - this.radius - 2, ze = pl.pos.z - 6;
        for (let i = 0; i < rows; i++) {
          const z = zs + (ze - zs) * (i / (rows - 1));
          const off = i % 2 ? 0.5 : 0;
          const xs = [];
          for (let k = 0; k < 3; k++) xs.push(-rh + (rh * 2) * ((k + off + 0.25) / 3.25));
          if (i === rows - 2 || i === rows - 3) xs.push(clamp(pl.pos.x, -rh + 2, rh - 2));
          P.rows.push({ t: 0.6 + i * 0.3, z, xs, fired: false });
          for (const x of xs) P.teles.push(g.tele.add({ shape: 'circle', x, z, radius: 2.9, duration: 0.6 + i * 0.3, color: 0xff6a1a }));
        }
        P.dur = 0.6 + rows * 0.3 + 0.6;
        g.audio.play('quake', { volume: 0.7 });
        return true;
      }

      // —— 暗影魔王：暗影法术 + 亡灵军团 ——
      case 'spiral':
        // 暗影螺旋：旋转弹幕，第 3 阶段变成三臂
        P.arms = ph >= 3 ? 3 : 2; P.dur = 2.9; P.acc = 0; P.rot = rand(0, Math.PI * 2);
        g.audio.play('portal', { volume: 0.5, pitch: 0.7 });
        return true;
      case 'voidLance': {
        // 虚空裂隙：整列路面依次亮起后引爆（隔列交替）
        const L = this.laneSlots(3.4);
        const k0 = Math.random() < 0.5 ? 0 : 1;
        const nW = ph;
        P.waves = [];
        for (let k = 0; k < nW; k++) {
          const lanes = L.xs.filter((x, i) => (i + k0 + k) % 2 === 0);
          P.waves.push({ t: 1.0 * fast + k * 1.0, lanes, w: L.w, fired: false });
        }
        P.laneColor = 0xb04aff; P.laneDmg = 1.15; P.laneSlow = 0;
        P.dur = P.waves[P.waves.length - 1].t + 0.6;
        for (const W of P.waves) this.teleLanes(P, W, W.t);
        g.audio.play('warning', { volume: 0.55 });
        return true;
      }
    }
    return false;
  }

  teleLanes(P, W, duration) {
    const g = this.game, pl = g.player;
    W.z0 = pl.pos.z - 10; W.len = this.pos.z - W.z0 + 2;
    for (const x of W.lanes) P.teles.push(g.tele.add({ shape: 'rect', x, z: W.z0, angle: 0, length: W.len, width: W.w - 0.4, duration, color: P.laneColor }));
  }

  runSkill(P, dt, ph, color) {
    const g = this.game, pl = g.player;
    const grounded = () => pl.alwaysHittable || pl.pos.y - g.heightAt(pl.pos.x, pl.pos.z) < 2.5;
    switch (P.name) {
      case 'web':
      case 'bog': {
        const web = P.name === 'web';
        if (!P.lobbed && P.t >= P.lobT) { P.lobbed = true; this.lob(P, P.list, P.flight, web ? 0xf0f8e8 : 0x6aa83a, 1); g.audio.play('enemyShoot', { volume: 0.6, pitch: web ? 1.3 : 0.7 }); }
        if (!P.fired && P.t >= P.lobT + P.flight) {
          P.fired = true;
          for (const sp of P.list) {
            const r = web ? 3.2 : 3.4;
            _v.set(sp.x, g.heightAt(sp.x, sp.z), sp.z);
            const d = Math.hypot(pl.pos.x - sp.x, pl.pos.z - sp.z);
            if (d < r + pl.radius * 0.4 && grounded()) {
              _dir.set(pl.pos.x - sp.x, 0, pl.pos.z - sp.z).normalize();
              pl.takeDamage(this.dmg * (web ? 1.1 : 0.5), { dir: _dir, knock: 3, attacker: this, kind: 'aoe', poison: web ? 2 : 3, slow: web ? 0.9 : 0, slowTime: 2 });
            } else if (d < r + 2) g.onPerfect(pl.pos);
            this.addZone(web
              ? { x: sp.x, z: sp.z, r, life: 4, dps: 0.2, slow: 0.9, color: 0xe8f0e0, fx: 'web' }
              : { x: sp.x, z: sp.z, r, life: 5, dps: 0.12, poison: 2, slow: 0.4, color: 0x5aa02a, fx: 'bog' });
            g.fx.sparks.burst(_v, { count: 16, speed: 6, life: 0.5, size: 0.9, color: web ? 0xffffff : 0x9cff3a, color2: web ? 0xc0c8b0 : 0x2a5a1a, up: 3 });
            g.fx.rings.ring(_v, { r0: 0.6, r1: r, life: 0.4, color: web ? 0xf0f8e8 : 0x7aff4a });
          }
          g.audio.play(web ? 'whoosh' : 'venom', { volume: 0.7, pitch: 0.8 });
        }
        return { tx: this.pos.x };
      }

      case 'pounce': {
        if (P.t < P.windup) {
          // 腾空：抛物线飞向落点
          const k = P.t / P.windup;
          const e = k * k * (3 - 2 * k);
          this.pos.x = P.sx + (P.tx - P.sx) * e;
          this.pos.z = P.sz + (P.tz + 3 - P.sz) * e;
          this.lift = Math.sin(Math.PI * k) * 9;
          this.vel.set(0, 0, 0);
          return { drive: true };
        }
        if (!P.fired) {
          P.fired = true;
          this.lift = 0;
          _v.set(P.tx, g.heightAt(P.tx, P.tz), P.tz);
          const d = Math.hypot(pl.pos.x - P.tx, pl.pos.z - P.tz);
          if (d < P.r + pl.radius * 0.4 && grounded()) {
            _dir.set(pl.pos.x - P.tx, 0, pl.pos.z - P.tz).normalize();
            pl.takeDamage(this.dmg * 1.35, { dir: _dir, knock: 12, attacker: this, kind: 'melee', poison: 3 });
          } else if (d < P.r + 2.4) g.onPerfect(pl.pos);
          this.addZone({ x: P.tx, z: P.tz, r: 5, life: 3.5, dps: 0.14, poison: 2, color: 0x9cff3a, fx: 'bog' });
          // 落地震出一圈毒液弹，躲开大圈后还要再躲一次
          const n = 10 + ph * 4;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            _dir.set(Math.sin(a), 0, Math.cos(a));
            g.projectiles.spawn({ kind: 'borb', owner: 'enemy', pos: _v, dir: _dir, speed: 11, dmg: this.dmg * 0.45, radius: 0.7, life: 2.4, color: 0x9cff3a, hover: 1.3, scale: 0.85, poison: 2 });
          }
          g.fx.rings.ring(_v, { r0: 1, r1: P.r + 2, life: 0.5, color: 0x9cff3a });
          g.fx.dust.burst(_v, { count: 30, speed: 8, life: 1, size: 1.5, sizeEnd: 3.5, color: g.dustColor, alpha: 0.6, flat: true, drag: 2, up: 3 });
          g.fx.debris.burst(_v, { count: 10, speed: 8, up: 9, size: 0.4, color: g.rockColor ?? 0x4a3a2a });
          g.audio.play('stomp', { volume: 1, pitch: 0.75 });
          g.shakeAt(_v, 0.45);
          g.juice.fovKick(-3);
        }
        return P.t < P.windup + 0.35 ? { drive: true } : null; // 落地后爬回原位
      }

      case 'brood':
        if (!P.fired && P.t > 0.8) {
          P.fired = true;
          const n = 2 + ph;
          const rh = g.track.roadHalf;
          for (let i = 0; i < n; i++) {
            if (g.enemies.length > 18) break;
            const x = clamp(this.pos.x + (i - (n - 1) / 2) * 3.4 + rand(-0.8, 0.8), -rh + 1.5, rh - 1.5);
            const e = g.spawnEnemy('spiderling', x, this.pos.z - this.radius - rand(3, 9));
            _v.set(e.pos.x, e.pos.y, e.pos.z);
            g.fx.sparks.burst(_v, { count: 12, speed: 5, life: 0.5, size: 0.8, color: 0xf0f0d0, color2: 0x9cff3a, up: 3 });
          }
          g.audio.play('poison', { volume: 0.6, pitch: 1.4 });
        }
        return { tx: this.pos.x };

      case 'quicksand':
        return { tx: this.pos.x };

      case 'sandstorm': {
        while (P.count < P.waves && P.t >= 0.6 + P.count * P.gap) {
          const n = 12 + ph * 2;
          const base = Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
          const spread = THREE.MathUtils.degToRad(110);
          const gapI = Math.floor(rand(2, n - 3));
          this.model.muzzle.getWorldPosition(_v);
          _v.y = g.heightAt(_v.x, _v.z);
          for (let i = 0; i < n; i++) {
            if (i === gapI || i === gapI + 1) continue; // 安全缝
            const a = base + (i / (n - 1) - 0.5) * spread;
            _dir.set(Math.sin(a), 0, Math.cos(a));
            g.projectiles.spawn({ kind: 'borb', owner: 'enemy', pos: _v, dir: _dir, speed: 17, dmg: this.dmg * 0.45, radius: 0.85, life: 3.5, color: 0xe8c070, hover: 1.4, knock: 9 });
          }
          P.count++;
          g.fx.dust.burst(_v, { count: 16, speed: 10, life: 0.8, size: 1.6, sizeEnd: 3.5, color: 0xe0c080, alpha: 0.6, dir: _dir.set(Math.sin(base), 0.1, Math.cos(base)), spread: 0.6 });
          g.audio.play('whoosh', { volume: 0.7, pitch: 0.6 });
        }
        return { tx: this.pos.x };
      }

      case 'icicles':
      case 'voidLance':
        for (const W of P.waves) {
          if (W.fired || P.t < W.t) continue;
          W.fired = true;
          const hitW = W.w / 2 - 0.2 + pl.radius * 0.35;
          let hit = false, near = false;
          for (const x of W.lanes) {
            const dx = Math.abs(pl.pos.x - x);
            if (dx < hitW) hit = true; else if (dx < hitW + 1.6) near = true;
            for (let k = 0; k < 6; k++) {
              const z = W.z0 + (k + 0.5) * (W.len / 6);
              _v.set(x + rand(-0.6, 0.6), 0, z);
              _v.y = g.heightAt(_v.x, _v.z);
              g.fx.sparks.burst(_v, { count: 7, speed: 7, life: 0.45, size: 0.9, color: 0xffffff, color2: P.laneColor, up: 7 });
              if (k % 2 === 0) g.fx.debris.burst(_v, { count: 3, speed: 5, up: 7, size: 0.35, color: P.name === 'icicles' ? 0xd8f4ff : 0x3a1a5a });
            }
          }
          if (hit && grounded()) {
            _dir.set(0, 0, -1);
            pl.takeDamage(this.dmg * P.laneDmg, { dir: _dir, knock: 6, attacker: this, kind: 'aoe', slow: P.laneSlow, slowTime: 2.5 });
          } else if (near) g.onPerfect(pl.pos);
          g.audio.play(P.name === 'icicles' ? 'hitHeavy' : 'explosion', { volume: 0.8, pitch: P.name === 'icicles' ? 1.3 : 0.6 });
          g.shake.add(0.25);
          g.juice.aberr(0.6);
        }
        return { tx: this.pos.x };

      case 'iceWall': {
        const rh = g.track.roadHalf;
        while (P.count < P.walls && P.t >= 0.7 + P.count * P.wallGap) {
          P.count++;
          const gapW = 4.6;
          const gx = rand(-rh + gapW / 2 + 1, rh - gapW / 2 - 1);
          const segs = [[-rh - 1, gx - gapW / 2], [gx + gapW / 2, rh + 1]];
          for (const [a, b] of segs) {
            const w = Math.round(b - a);
            if (w < 1) continue;
            _v.set((a + b) / 2, 0, this.pos.z - this.radius - 1);
            _v.y = g.heightAt(_v.x, _v.z) + 0.9;
            _dir.set(0, 0, -1);
            g.projectiles.spawn({ kind: 'scythewave', owner: 'enemy', pos: _v, dir: _dir, speed: 17, dmg: this.dmg * 1.0, radius: 1, life: 3.5, knock: 10, width: w, sweepW: w, hover: 0.9, color: 0xbfeaff });
          }
          g.audio.play('whoosh', { volume: 1, pitch: 0.5 });
          g.audio.play('wave', { volume: 0.6, pitch: 1.1 });
        }
        return { tx: this.pos.x };
      }

      case 'tripleBreath':
        if (P.t >= P.windup) {
          if (!P.started) { P.started = true; g.audio.play('burn', { volume: 0.8, pitch: 0.8 }); g.audio.play('bossRoar', { volume: 0.4 }); }
          P.acc += dt;
          this.model.muzzle.getWorldPosition(_v);
          const sw = P.swing * Math.sin((P.t - P.windup) * 2.4);
          while (P.acc > 0.06) {
            P.acc -= 0.06;
            for (const a0 of P.angles) {
              const a = a0 + sw + rand(-P.half, P.half) * 0.8;
              const dd = rand(P.len * 0.45, P.len);
              _v2.set(this.pos.x + Math.sin(a) * dd, 0, this.pos.z + Math.cos(a) * dd);
              _v2.y = g.heightAt(_v2.x, _v2.z) + 1.2;
              _dir.subVectors(_v2, _v).normalize();
              g.projectiles.spawn({ kind: 'borb', owner: 'enemy', pos: _v, dir: _dir, speed: 26, dmg: this.dmg * 0.2, radius: 0.85, life: 1.6, color, scale: 0.7, poison: 2 });
            }
          }
        }
        return { tx: this.pos.x };

      case 'mistOrbs': {
        const due = Math.floor((P.t - 0.6) / 0.2) + 1;
        while (P.count < P.shots && P.count < due && P.t >= 0.6) {
          P.count++;
          this.model.muzzle.getWorldPosition(_v);
          pl.getCenter(_v2);
          const t = _v.distanceTo(_v2) / 18;
          _v2.x += pl.vel.x * t * 0.9;
          _dir.subVectors(_v2, _v).normalize();
          _dir.applyAxisAngle(UP, rand(-0.08, 0.08));
          g.projectiles.spawn({ kind: 'borb', owner: 'enemy', pos: _v, dir: _dir, speed: 18, dmg: this.dmg * 0.4, radius: 0.75, life: 3.5, color: 0x9aff7a, poison: 2.5 });
          g.fx.dust.burst(_v, { count: 4, speed: 2, life: 1, size: 1.6, sizeEnd: 3.5, color: 0xb0e0b0, alpha: 0.35, up: 1 });
          g.audio.play('enemyShoot', { volume: 0.45, pitch: 0.8 });
        }
        return { tx: this.pos.x };
      }

      case 'eruption':
        for (const R of P.rows) {
          if (R.fired || P.t < R.t) continue;
          R.fired = true;
          for (const x of R.xs) {
            _v.set(x, g.heightAt(x, R.z), R.z);
            const d = Math.hypot(pl.pos.x - x, pl.pos.z - R.z);
            if (d < 2.9 + pl.radius * 0.4 && grounded()) {
              _dir.set(pl.pos.x - x, 0, pl.pos.z - R.z).normalize();
              pl.takeDamage(this.dmg * 1.1, { dir: _dir, knock: 8, attacker: this, kind: 'aoe' });
              pl.vy = 9; pl.onGround = false;
            } else if (d < 5) g.onPerfect(pl.pos);
            g.fx.rings.pillar(_v, { r: 2.2, h: 9, life: 0.6, color: 0xff6a1a });
            g.fx.sparks.burst(_v, { count: 18, speed: 10, life: 0.7, size: 1.1, color: 0xffd060, color2: 0xff3a0a, up: 12 });
            g.fx.scorch.add(_v, 2.6, 4);
          }
          g.audio.play('explosion', { volume: 0.6, pitch: 0.8 });
          g.shake.add(0.15);
        }
        return { tx: this.pos.x };

      case 'spiral': {
        P.acc += dt;
        _v.set(this.pos.x, 0, this.pos.z - this.radius * 0.6);
        while (P.acc > 0.09 && P.t > 0.35 && P.t < P.dur - 0.3) {
          P.acc -= 0.09;
          P.rot += 0.42;
          for (let k = 0; k < P.arms; k++) {
            const a = P.rot + (k / P.arms) * Math.PI * 2;
            _dir.set(Math.sin(a), 0, Math.cos(a));
            if (_dir.z > 0.35) continue; // 朝背后飞的不发
            g.projectiles.spawn({ kind: 'borb', owner: 'enemy', pos: _v, dir: _dir, speed: 12 + ph, dmg: this.dmg * 0.4, radius: 0.7, life: 4.5, color, hover: 1.5 });
          }
          g.audio.play('enemyShoot', { volume: 0.3, pitch: 0.9 });
        }
        return { tx: this.pos.x };
      }
    }
    return null;
  }

  // —— 地面区域：蛛网、毒沼、流沙、灼地、熔岩带 ——
  addZone(o) {
    const g = this.game;
    const z = { t: 0, acc: 0, fxT: 0, dps: 0, poison: 0, slow: 0, pull: 0, core: 0, ...o };
    z.tele = g.tele.add({ shape: 'circle', x: z.x, z: z.z, radius: z.r, duration: z.life, color: z.color, linger: 0 });
    this.zones.push(z);
    return z;
  }

  updateZones(dt) {
    if (!this.zones.length) return;
    const g = this.game, pl = g.player;
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.t += dt;
      if (z.t >= z.life) { g.tele.remove(z.tele); this.zones.splice(i, 1); continue; }
      const dx = z.x - pl.pos.x, dz = z.z - pl.pos.z;
      const d = Math.hypot(dx, dz);
      const onGround = pl.alwaysHittable || pl.pos.y - g.heightAt(pl.pos.x, pl.pos.z) < 1.2;
      const inside = d < z.r + pl.radius * 0.3 && onGround && pl.alive;
      if (inside && z.pull && d > 0.3) {
        // 流沙：越靠近中心吸得越猛
        const k = z.pull * (0.6 + 0.4 * (1 - d / z.r)) * dt;
        pl.pos.x += (dx / d) * k;
        pl.pos.z += (dz / d) * k * 0.6;
      }
      z.acc += dt;
      if (z.acc >= 0.5) {
        z.acc -= 0.5;
        const hurt = inside && (!z.core || d < z.core + pl.radius * 0.3);
        if (hurt) pl.takeDamage(this.dmg * z.dps, { kind: 'dot', poison: z.poison, slow: z.slow, slowTime: 0.8 });
        else if (inside && z.slow) { pl.slowMul = Math.min(pl.slowMul, 1 - z.slow * 0.5); pl.slowT = Math.max(pl.slowT, 0.8); }
      }
      z.fxT -= dt;
      if (z.fxT <= 0) {
        z.fxT = 0.12;
        const a = rand(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * z.r;
        _v.set(z.x + Math.sin(a) * rr, 0, z.z + Math.cos(a) * rr);
        _v.y = g.heightAt(_v.x, _v.z) + 0.2;
        if (z.fx === 'fire') g.fx.sparks.burst(_v, { count: 2, speed: 3, life: 0.6, size: 0.8, color: 0xffd060, color2: 0xff3a0a, up: 4 });
        else if (z.fx === 'sand') g.fx.dust.burst(_v, { count: 2, speed: 3, life: 0.8, size: 1.2, sizeEnd: 2.5, color: 0xe0c080, alpha: 0.5, flat: true, drag: 1, up: 0.5 });
        else if (z.fx === 'bog') g.fx.dust.burst(_v, { count: 1, speed: 1, life: 1.2, size: 1, sizeEnd: 2.4, color: 0x8ad050, alpha: 0.4, up: 1.2 });
        else g.fx.sparks.burst(_v, { count: 1, speed: 1, life: 0.6, size: 0.6, color: 0xffffff, color2: 0xd0d8c0, up: 0.5 });
      }
    }
  }

  clearZones() {
    for (const z of this.zones) this.game.tele.remove(z.tele);
    this.zones.length = 0;
  }

  dispose() {
    this.endPattern();
    this.clearZones();
    this.game.scene.remove(this.root);
    disposeModel(this.root);
  }
}
