// 怪物 / 首领 / 路障（跑道模式）
import * as THREE from 'three';
import { ENEMIES, BOSSES } from './data.js';
import { createEnemyModel, createBossModel } from './models/enemies.js';
import { clamp, damp, turnToward, prepareModel, rand, pick, mergeStaticMeshes } from './util.js';
import { t } from './i18n.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _col = new THREE.Color();
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
  for (const p of ['slam', 'volley', 'barrage', 'summon', 'charge', 'burrow', 'breath', 'meteor', null]) {
    for (const ph of [1, 2, 3]) for (const a of [0.2, 0.7]) out.push({ t: (t += 0.37), move: a, attack: a, pattern: p, hurt: a > 0.5 ? 1 : 0, dead: 0, phase: ph, burrow: p === 'burrow' ? a : 0 });
  }
  out.push({ t: t + 1, move: 0, attack: -1, pattern: null, hurt: 0, dead: 0.7, phase: 1, burrow: 0 });
  out.push({ t: t + 2, move: 0, attack: -1, pattern: null, hurt: 0, dead: 0, phase: 1, burrow: 0 });
  return out;
})();

/** 创建怪物模型并合并静态零件（同种怪共享合并结果） */
export function buildEnemyModel(type) {
  const model = createEnemyModel(type, ENEMIES[type]);
  mergeStaticMeshes(model.root, () => { for (const st of ENEMY_STATES) model.update(0.1, st); }, 'e:' + type);
  return model;
}
export function buildBossModel(type) {
  const model = createBossModel(type, BOSSES[type]);
  mergeStaticMeshes(model.root, () => { for (const st of BOSS_STATES) model.update(0.1, st); }, 'b:' + type);
  return model;
}

function disposeModel(root) {
  root.traverse((o) => {
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    if (o.userData.mergedGeo && o.geometry) o.geometry.dispose();
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
    this.game = game;
    this.type = type;
    this.def = ENEMIES[type];
    this.isBoss = false;
    this.isProp = false;
    this.model = buildEnemyModel(type);
    this.root = this.model.root;
    game.scene.add(this.root);
    this.flash = prepareModel(this.root, { cast: false });  // 怪物用圆形投影代替实时阴影
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
    this.pos = new THREE.Vector3(x, game.heightAt(x, z), z);
    this.homeX = x;
    this.vel = new THREE.Vector3();
    this.kb = new THREE.Vector3();
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
    this.anim = { t: Math.random() * 10, move: 0, attack: -1, hurt: 0, dead: 0 };
    this.barW = Math.max(1, this.radius * 1.4);
    this.barT = 0;
    this.barTop = 2;
    this.stunFx = 0;
    this.root.scale.setScalar(0.01);
  }

  get targetable() { return this.alive && this.state !== 'spawn'; }
  getCenter(out) { return out.set(this.pos.x, this.pos.y + (this.flying ? this.hoverY : this.height * 0.5) + this.lift, this.pos.z); }

  applyStatus(o) {
    if (o.stun) this.stun = Math.max(this.stun, o.stun);
    if (o.slow) { this.slowMul = Math.min(this.slowMul, 1 - o.slow); this.slowT = Math.max(this.slowT, o.slowTime || 2); }
    if (o.burn) { this.burnT = Math.max(this.burnT, o.burn); this.burnDps = Math.max(this.burnDps, o.dotBase * 0.35); }
    if (o.poison) { this.poisonT = Math.max(this.poisonT, o.poison); this.poisonDps = Math.max(this.poisonDps, o.dotBase * 0.3); }
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
          if (this.atkCd <= 0 && dz > 9 && dz < R) { this.atkT = 0; this.atkHit = false; this.atkCd = this.def.atkCd * rand(1.1, 1.6); }
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

    const face = dz > 1 ? Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z) : Math.PI;
    this.heading = turnToward(this.heading, face, 5 * dt);
    this.root.position.set(this.pos.x, this.pos.y + this.lift, this.pos.z);
    this.root.rotation.y = this.heading;
    this.anim.move = clamp(Math.hypot(this.vel.x, this.vel.z) / Math.max(1, this.def.speed * 0.6), 0, 1.5);
    this.anim.attack = this.atkT;
    this.anim.hurt = this.hurt;
    this.model.update(dt, this.anim);

    if (this.flashT > 0) this.flash.setFlash(this.flashT / 0.12);
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
    this.flash = prepareModel(this.root, { cast: false, receive: true });
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
  }

  get targetable() { return this.alive && this.state === 'fight' && this.anim.burrow < 0.5; }
  getCenter(out) { return out.set(this.pos.x, this.pos.y + this.height * 0.45, this.pos.z); }

  applyStatus(o) {
    if (o.stun) this.stun = Math.max(this.stun, o.stun * 0.2);
    if (o.slow) { this.slowMul = Math.min(this.slowMul, 1 - o.slow * 0.5); this.slowT = Math.max(this.slowT, (o.slowTime || 2) * 0.6); }
    if (o.burn) { this.burnT = Math.max(this.burnT, o.burn); this.burnDps = Math.max(this.burnDps, o.dotBase * 0.35); }
    if (o.poison) { this.poisonT = Math.max(this.poisonT, o.poison); this.poisonDps = Math.max(this.poisonDps, o.dotBase * 0.3); }
  }

  kill() { this.alive = false; this.state = 'dead'; this.deadT = 0; this.endPattern(); }

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
      this.pattern = { name: 'summon', t: 0, dur: 1.6, fired: true, teles: [] };
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

    this.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.root.rotation.y = this.heading;
    this.anim.move = clamp(Math.hypot(this.vel.x, this.vel.z) / this.def.speed, 0, 2);
    this.anim.hurt = this.hurt;
    this.anim.attack = this.pattern ? Math.min(1, this.pattern.t / this.pattern.dur) : -1;
    this.anim.pattern = this.pattern ? this.pattern.name : null;
    this.model.update(dt, this.anim);

    if (this.flashT > 0) this.flash.setFlash(this.flashT / 0.12);
    else if (this.invulnT > 0) this.flash.setFlash(0.3 + 0.2 * Math.sin(this.anim.t * 20), _col.set(this.def.projColor));
    else this.flash.setFlash(0);
  }

  choosePattern() {
    const g = this.game;
    const opts = this.def.patterns.filter((p) => p !== this.lastPattern);
    const w = opts.map((p) => (p === 'summon' ? (g.enemies.length > 8 ? 0 : 0.8) : p === 'charge' ? 1.3 : 1));
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
    switch (name) {
      case 'slam': {
        P.windup = 1.15 * fast;
        P.dur = P.windup + 0.7;
        P.spots = [];
        const n = 1 + ph;
        for (let i = 0; i < n; i++) {
          const x = i === 0 ? pl.pos.x : rand(-rh + 3, rh - 3);
          const z = pl.pos.z + (i === 0 ? 0 : rand(-3, 7));
          P.spots.push({ x, z });
          P.teles.push(g.tele.add({ shape: 'circle', x, z, radius: 4.3, duration: P.windup, color: 0xff3030 }));
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
        g.audio.play('warning', { volume: 0.6 });
        break;
      }
      default: P.dur = 0.5;
    }
    this.pattern = P;
  }

  endPattern() {
    if (!this.pattern) return;
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
      case 'slam':
        out = { tx: this.pos.x };
        if (!P.fired && P.t >= P.windup) {
          P.fired = true;
          for (const s of P.spots) {
            _v.set(s.x, g.heightAt(s.x, s.z), s.z);
            if (Math.hypot(pl.pos.x - s.x, pl.pos.z - s.z) < 4.3 + pl.radius * 0.4 && pl.pos.y - _v.y < 2.5) {
              _dir.set(pl.pos.x - s.x, 0, pl.pos.z - s.z).normalize();
              pl.takeDamage(this.dmg * 1.2, { dir: _dir, knock: 10, attacker: this, kind: 'melee' });
            }
            g.fx.rings.ring(_v, { r0: 1, r1: 5, life: 0.45, color: 0xffd0a0 });
            g.fx.dust.burst(_v, { count: 24, speed: 6, life: 0.9, size: 1.4, sizeEnd: 3.5, color: g.dustColor, alpha: 0.6, flat: true, drag: 2, up: 3 });
            g.fx.sparks.burst(_v, { count: 14, speed: 7, life: 0.4, size: 0.8, color: 0xffe0a0, color2: color, up: 3 });
            g.fx.debris.burst(_v, { count: 7, speed: 7, up: 8, size: 0.4, color: g.rockColor ?? 0x7a6a5a });
            g.fx.scorch.add(_v, 3.2, 3.5);
            if (ph >= 2) {
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
          if (!P.hit && Math.abs(pl.pos.z - this.pos.z) < this.radius + pl.radius && Math.abs(pl.pos.x - this.pos.x) < this.radius + pl.radius * 0.6 && pl.pos.y - this.pos.y < 3) {
            P.hit = true;
            _dir.set(Math.sign(pl.pos.x - this.pos.x) || 1, 0, -0.5).normalize();
            pl.takeDamage(this.dmg * 1.3, { dir: _dir, knock: 16, attacker: this, kind: 'melee' });
            pl.vel.x += _dir.x * 14;
          }
          g.fx.dust.burst(this.pos, { count: 3, speed: 4, life: 0.7, size: 1.6, sizeEnd: 3.5, color: g.dustColor, alpha: 0.55, up: 1.5, radius: this.radius * 0.5 });
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
        }
        break;
    }

    if (P.t >= P.dur) {
      this.endPattern();
      this.anim.burrow = 0;
      this.patternCd = rand(1.2, 2.2) * (1 - 0.18 * (ph - 1));
    }
    return out;
  }

  dispose() {
    this.endPattern();
    this.game.scene.remove(this.root);
    disposeModel(this.root);
  }
}
