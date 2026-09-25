// 玩家（跑道模式）：恐龙自动前进，左右走位；骑手自动射击；武器随击杀升级
import * as THREE from 'three';
import { createDinoModel } from './models/dinos.js';
import { createRiderModel } from './models/riders.js';
import { WEAPON_LEVELS, WEAPON_MAX, XP_NEED, RUN_SPEED } from './data.js';
import { clamp, damp, prepareModel, mergeStaticMeshes } from './util.js';
import { createShield } from './effects.js';
import { t } from './i18n.js';
import { curvature } from './bend.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _inherit = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, 1);
const GRAVITY = 32;

export function computeStats(dino, rider, up) {
  const s = dino.stats;
  const b = rider.bonus || {};
  const atk = s.atk * (1 + 0.1 * up.atk) * (1 + (b.atk || 0));
  const speed = s.speed * (1 + 0.05 * up.speed) * (1 + (b.speed || 0));
  return {
    maxHp: Math.round(s.hp * (1 + 0.1 * up.hp) * (1 + (b.hp || 0))),
    atk,
    ram: atk * 2.5 + 20,                  // 冲撞伤害：血量低于它的怪物直接撞飞
    def: Math.min(0.8, 1 - (1 - s.def) * (1 - 0.04 * up.def) * (1 - (b.def || 0))),
    lateral: 8.5 + speed * 0.6,           // 左右移动速度
    riderMul: 1 + 0.12 * up.rider,
    cdMul: (1 - 0.06 * up.cdr) * (1 - (b.cdr || 0)),
    crit: 0.05 + (b.crit || 0),
    regen: b.regen || 0,
    coinMul: 1 + (b.coins || 0),
    magnet: 5 * (1 + 0.25 * up.magnet),
    reach: s.reach,
    atkRate: s.atkRate,
  };
}

const MELEE_KNOCK = { bite: 6, peck: 5, horn: 10, headbutt: 10, claw: 6, tail: 9, stomp: 8 };
const RADII = { spear: 0.7, arrow: 0.55, fireball: 0.8, laser: 0.6, bullet: 0.5, shuriken: 0.7, missile: 0.7, ice: 0.6, rock: 0.9, cannon: 0.8 };
const FRENZY_COL = new THREE.Color(1, 0.15, 0.05);
const SPRINT_COL = new THREE.Color(0.4, 0.85, 1);
const POISON_COL = new THREE.Color(0.4, 1, 0.2);
const SHIELD_COL = new THREE.Color(1, 0.85, 0.3);

export class Player {
  constructor(game, dinoDef, riderDef, stats) {
    this.game = game;
    this.def = dinoDef;
    this.riderDef = riderDef;
    this.stats = stats;

    this.model = createDinoModel(dinoDef);
    this.riderModel = createRiderModel(riderDef);
    this.riderModel.root.scale.setScalar(dinoDef.riderScale || 1);
    this.model.saddle.add(this.riderModel.root);
    this.root = this.model.root;
    // 合并不会动的零件，减少 draw call
    mergeStaticMeshes(this.root, () => {
      let t = 0;
      for (const a of [-1, 0.2, 0.5, 0.9]) for (const sk of [-1, 0.3, 0.7]) for (const mv of [0, 1, 1.7]) {
        t += 0.23;
        this.model.update(0.1, { t, move: mv, air: sk > 0.5, attack: a, skill: sk, hurt: a > 0.4 ? 1 : 0, dead: 0 });
        this.riderModel.update(0.1, { t, bounce: mv, shoot: a, cheer: sk > 0.5, lean: mv - 0.8 });
      }
      this.model.update(0.1, { t: t + 1, move: 0, air: false, attack: -1, skill: -1, hurt: 0, dead: 0.8 });
      this.model.update(0.1, { t: t + 2, move: 0, air: false, attack: -1, skill: -1, hurt: 0, dead: 0 });
      this.riderModel.update(0.1, { t: t + 2, bounce: 0, shoot: -1, cheer: false, lean: 0 });
    });
    game.scene.add(this.root);
    this.flash = prepareModel(this.root, { cast: true });

    this.size = this.model.size;
    this.top = this.size.top || this.size.height;
    this.radius = Math.max(0.9, (this.size.width ? this.size.width * 0.5 : this.size.radius * 0.6) + 0.35);
    this.frontReach = Math.max(1.5, (this.size.length || 5) * 0.45);
    this.pos = new THREE.Vector3(0, game.heightAt(0, 0), 0);
    this.vel = new THREE.Vector3();
    this.fwd = 0;
    this.vy = 0;
    this.onGround = true;
    this.heading = 0;
    this.spinAngle = 0;

    this.hp = stats.maxHp;
    this.weapon = { level: 1, xp: 0, count: 0, rate: 1, dmg: 1, pierce: 0, gates: [] };
    this.fireCd = 0.5;
    this.shootT = -1;
    this.biteCd = 0;
    this.atkT = -1;
    this.atkDur = 0.4;
    this.atkHit = false;
    this.skillCd = 2;
    this.skill = null;
    this.skillAnim = -1;
    this.buffs = { frenzy: 0, fortress: 0, sprint: 0, power: 0, shield: 0 };
    this.slowT = 0; this.slowMul = 1;
    this.poisonT = 0; this.poisonDps = 0; this.poisonTick = 0;
    this.invuln = 0;
    this.sinceHit = 0;
    this.hurt = 0;
    this.flashT = 0;
    this.alive = true;
    this.deadT = 0;
    this.lean = 0;
    this.slope = 0;
    this.cheer = false;
    this.stepAcc = 0;
    this.auraAcc = 0;
    this.anim = { t: 0, move: 0, air: false, attack: -1, skill: -1, hurt: 0, dead: 0 };
    this.riderAnim = { t: 0, bounce: 0, shoot: -1, cheer: false, lean: 0 };
    this.sprintTouched = new Map();

    this.shield = createShield(0xffd060);
    this.shield.visible = false;
    game.scene.add(this.shield);
    this.muzzle = new THREE.Vector3();
    this.mouth = new THREE.Vector3();
  }

  get center() { return _v.set(this.pos.x, this.pos.y + this.size.height * 0.75, this.pos.z); }
  getCenter(out) { return out.set(this.pos.x, this.pos.y + this.size.height * 0.75, this.pos.z); }
  get invulnerable() { return this.buffs.sprint > 0 || !!(this.skill && this.skill.invuln); }

  // ------------------------------------------------------------------
  //  武器
  // ------------------------------------------------------------------
  weaponStats() {
    const w = this.riderDef.weapon;
    const L = WEAPON_LEVELS[this.weapon.level];
    const W = this.weapon;
    const count = Math.min(9, (w.count || 1) + L.count + W.count);
    const rate = L.rate * W.rate * (this.buffs.frenzy > 0 ? 1.8 : 1) * (this.buffs.sprint > 0 ? 1.4 : 1);
    return {
      count,
      dmg: w.dmg * this.stats.riderMul * L.dmg * W.dmg * (this.buffs.power > 0 ? 1.5 : 1),
      cd: w.cd / rate,
      pierce: (w.pierce || 0) + L.pierce + W.pierce,
      homing: w.homing || L.homing || 0,
      spread: count > 1 ? Math.min(w.spread || 9, 44 / (count - 1)) : 0,
    };
  }

  addXp(n) {
    const W = this.weapon;
    if (W.level >= WEAPON_MAX) return;
    W.xp += n;
    while (W.level < WEAPON_MAX && W.xp >= XP_NEED[W.level]) {
      W.xp -= XP_NEED[W.level];
      W.level++;
      this.game.onWeaponLevel(W.level);
    }
    if (W.level >= WEAPON_MAX) W.xp = 0;
  }

  applyGate(kind) {
    const W = this.weapon;
    W.gates.push(kind);
    switch (kind) {
      case 'count': W.count++; break;
      case 'rate': W.rate += 0.25; break;
      case 'dmg': W.dmg += 0.3; break;
      case 'pierce': W.pierce++; break;
      case 'heal': this.heal(this.stats.maxHp * 0.4); break;
      case 'shield': this.buffs.shield = 8; break;
      case 'skill': this.skillCd = 0; break;
      case 'xp': this.addXp(25); break;
    }
  }

  // ------------------------------------------------------------------
  /** ctl: { enabled, run, steer(-1..1), drag(px), dragScale, jump, skill } */
  update(dt, ctl) {
    const g = this.game;
    const st = this.stats;
    this.anim.t += dt;
    this.riderAnim.t += dt;

    this.fireCd -= dt; this.biteCd -= dt; this.skillCd -= dt; this.invuln -= dt;
    this.hurt = Math.max(0, this.hurt - dt * 3);
    this.flashT = Math.max(0, this.flashT - dt);
    for (const k in this.buffs) if (this.buffs[k] > 0) this.buffs[k] = Math.max(0, this.buffs[k] - dt);
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.slowMul = 1; }
    if (this.poisonT > 0) {
      this.poisonT -= dt; this.poisonTick -= dt;
      if (this.poisonTick <= 0) { this.poisonTick = 0.5; this.takeDamage(this.poisonDps * 0.5, { kind: 'dot' }); }
    }

    if (!this.alive) {
      this.deadT = Math.min(1, this.deadT + dt * 0.9);
      this.fwd = damp(this.fwd, 0, 3, dt);
      this.pos.z += this.fwd * dt;
      this.pos.y = g.heightAt(this.pos.x, this.pos.z);
      this.root.position.copy(this.pos);
      Object.assign(this.anim, { dead: this.deadT, move: 0, attack: -1, skill: -1 });
      this.model.update(dt, this.anim);
      this.riderAnim.bounce = 0; this.riderAnim.shoot = -1;
      this.riderModel.update(dt, this.riderAnim);
      this.flash.setFlash(0);
      this.shield.visible = false;
      return;
    }

    if (st.regen > 0) this.hp = Math.min(st.maxHp, this.hp + st.regen * dt);
    this.sinceHit += dt;
    if (this.sinceHit > 6 && this.hp < st.maxHp) this.hp = Math.min(st.maxHp, this.hp + st.maxHp * 0.02 * dt);

    const sk = this.skill;
    // --- 前进 ---
    let fwdT = ctl.run ? RUN_SPEED : 0;
    // 上坡减速、下坡加速
    const base = g.track.baseAt;
    this.slope = damp(this.slope, (base(this.pos.z + 3) - base(this.pos.z - 3)) / 6, 6, dt);
    fwdT *= clamp(1 - this.slope * 1.3, 0.86, 1.14);
    if (ctl.run && this.buffs.sprint > 0) fwdT *= 1.6;
    if (ctl.run && sk && sk.type === 'charge') fwdT *= 2;
    this.fwd = damp(this.fwd, fwdT * (ctl.run ? this.slowMul : 1), ctl.run ? 2.5 : 2, dt);
    this.pos.z += this.fwd * dt;

    // --- 左右 ---
    const lat = st.lateral * this.slowMul;
    const vxT = ctl.enabled ? -ctl.steer * lat : 0; // 屏幕右侧 = 世界 -x
    this.vel.x = damp(this.vel.x, vxT, 12, dt);
    let dx = this.vel.x * dt;
    if (ctl.enabled && ctl.drag) dx -= ctl.drag * ctl.dragScale;
    // 弯道离心力：把恐龙往弯道外侧推，需要主动往内侧打方向
    const kap = curvature();
    if (ctl.run && this.onGround) dx -= kap * this.fwd * this.fwd * 0.55 * dt;
    this.pos.x += dx;
    const lim = g.track.roadHalf - Math.min(1.2, this.radius * 0.5);
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.vel.z = this.fwd;
    const vxEff = dt > 0 ? dx / dt : 0;

    // --- 跳跃 ---
    if (ctl.enabled && ctl.jump && this.onGround && !(sk && sk.air)) {
      this.vy = this.def.body === 'pterosaur' ? 13 : 11.5;
      this.onGround = false;
      g.audio.play('jump', { pitch: 1.2 - this.size.height * 0.08 });
      g.fx.dust.burst(this.pos, { count: 10, speed: 3, life: 0.6, size: 0.8, sizeEnd: 2, color: g.dustColor, alpha: 0.5, flat: true, up: 1 });
    }
    this.vy -= (sk && sk.air ? GRAVITY * 0.8 : GRAVITY) * dt;
    this.pos.y += this.vy * dt;
    const gy = g.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= gy) {
      if (!this.onGround && this.vy < -8) {
        g.audio.play('land', { volume: 0.5 });
        g.fx.dust.burst(this.pos, { count: 12, speed: 4, life: 0.6, size: 1, sizeEnd: 2.2, color: g.dustColor, alpha: 0.45, flat: true, up: 1 });
        if (sk && sk.air) this.landSkill();
        else if (!sk) this.landStomp(-this.vy);
      }
      this.pos.y = gy; this.vy = 0; this.onGround = true;
    } else if (this.pos.y > gy + 0.05) this.onGround = false;

    // 朝向：随左右移动微微转头
    const hT = clamp(Math.atan2(vxEff, Math.max(7, this.fwd)), -0.55, 0.55);
    this.heading = damp(this.heading, hT, 8, dt);
    this.lean = damp(this.lean, clamp(-vxEff / Math.max(1, lat) + kap * this.fwd * this.fwd * 0.12, -1, 1), 8, dt);

    // 脚步
    if (this.onGround && this.fwd > 2) {
      this.stepAcc += dt * (1.3 + this.fwd / RUN_SPEED * 1.4);
      if (this.stepAcc > 1) {
        this.stepAcc = 0;
        g.audio.play('step', { volume: 0.18 + this.size.height * 0.05, pitch: 1.3 - this.size.height * 0.1 });
      }
    }

    // --- 自动射击 / 自动撕咬 / 技能 ---
    if (ctl.enabled) {
      if (this.fireCd <= 0) this.fire();
      if (this.biteCd <= 0 && this.atkT < 0 && !(sk && sk.noBite)) this.tryBite();
      if (ctl.skill) {
        if (this.skillCd <= 0 && !this.skill) this.startSkill(ctl.run);
        else if (this.skillCd > 0) g.audio.play('error', { volume: 0.35 });
      }
    }
    if (this.atkT >= 0) {
      this.atkT += dt / this.atkDur;
      if (!this.atkHit && this.atkT >= 0.45) { this.atkHit = true; this.meleeHit(); }
      if (this.atkT >= 1) this.atkT = -1;
    }
    if (this.shootT >= 0) { this.shootT += dt / 0.25; if (this.shootT >= 1) this.shootT = -1; }
    if (this.skill) this.updateSkill(dt);
    this.updateBuffFx(dt);

    // --- 模型 ---
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading + this.spinAngle;
    this.root.rotation.x = this.onGround ? damp(this.root.rotation.x, -Math.atan(this.slope) * 0.9, 8, dt) : damp(this.root.rotation.x, 0, 3, dt);
    const runAmt = this.fwd > 1 ? clamp(this.fwd / RUN_SPEED, 0, 1.8) : clamp(Math.abs(vxEff) / lat, 0, 1) * 0.8;
    this.anim.move = runAmt;
    this.anim.air = !this.onGround;
    this.anim.attack = this.atkT;
    this.anim.skill = this.skillAnim;
    this.anim.hurt = this.hurt;
    this.anim.dead = 0;
    this.model.update(dt, this.anim);
    this.riderAnim.bounce = clamp(runAmt, 0, 1.3);
    this.riderAnim.shoot = this.shootT;
    this.riderAnim.cheer = this.cheer;
    this.riderAnim.lean = this.lean;
    this.riderModel.update(dt, this.riderAnim);

    if (this.flashT > 0) this.flash.setFlash(this.flashT / 0.15);
    else if (this.buffs.frenzy > 0) this.flash.setFlash(0.22 + 0.12 * Math.sin(this.anim.t * 12), FRENZY_COL);
    else if (this.buffs.sprint > 0 || (sk && sk.type === 'charge')) this.flash.setFlash(0.3, SPRINT_COL);
    else if (this.poisonT > 0) this.flash.setFlash(0.2 + 0.1 * Math.sin(this.anim.t * 8), POISON_COL);
    else this.flash.setFlash(0);

    const shielded = this.buffs.fortress > 0 || this.buffs.shield > 0;
    if (shielded) {
      this.shield.visible = true;
      const r = Math.max(this.size.radius, this.top * 0.8) + 0.8;
      this.shield.position.set(this.pos.x, this.pos.y + this.top * 0.5, this.pos.z);
      this.shield.scale.setScalar(r * (1 + 0.03 * Math.sin(this.anim.t * 6)));
      this.shield.material.uniforms.uTime.value = this.anim.t;
      this.shield.material.uniforms.uAlpha.value = Math.min(1, Math.max(this.buffs.fortress, this.buffs.shield) * 2);
      this.shield.material.uniforms.uColor.value.copy(this.buffs.fortress > 0 ? SHIELD_COL : SPRINT_COL);
    } else this.shield.visible = false;
  }

  // ------------------------------------------------------------------
  //  自动射击
  // ------------------------------------------------------------------
  fire() {
    const g = this.game;
    const w = this.riderDef.weapon;
    const ws = this.weaponStats();
    this.fireCd = ws.cd;
    this.shootT = 0;
    this.riderModel.muzzle.getWorldPosition(this.muzzle);
    const from = this.muzzle;
    const target = g.findTarget();
    const aim = _v2;
    _inherit.set(0, 0, this.fwd);
    if (target) {
      target.getCenter(aim);
      const t = aim.distanceTo(from) / w.speed;
      // 在玩家参考系中预判（弹体继承玩家前进速度）
      aim.x += target.vel.x * t;
      aim.z += (target.vel.z - this.fwd) * t;
    } else {
      aim.set(this.pos.x, g.heightAt(this.pos.x, this.pos.z + 40) + 1.3, this.pos.z + 40);
    }
    let gravity = 0;
    const baseDir = new THREE.Vector3().subVectors(aim, from);
    let speed = w.speed;
    if (w.arc || w.type === 'cannon') {
      gravity = w.arc ? 24 : 7;
      const hd = Math.max(3, Math.hypot(baseDir.x, baseDir.z));
      const T = hd / w.speed;
      const vy = (baseDir.y + 0.5 * gravity * T * T) / T;
      baseDir.set(baseDir.x / hd * w.speed, vy, baseDir.z / hd * w.speed);
      speed = baseDir.length();
    }
    baseDir.normalize();
    const n = ws.count;
    for (let i = 0; i < n; i++) {
      const off = n > 1 ? (i - (n - 1) / 2) * THREE.MathUtils.degToRad(ws.spread) : 0;
      _dir.copy(baseDir).applyAxisAngle(_up, off);
      const crit = Math.random() < this.stats.crit;
      g.projectiles.spawn({
        kind: w.type, owner: 'player', source: 'rider', pos: from, dir: _dir, speed, inherit: _inherit,
        dmg: ws.dmg * (crit ? 1.8 : 1), crit,
        radius: (RADII[w.type] ?? 0.6) * (this.weapon.level >= 9 ? 1.25 : 1), life: w.type === 'missile' ? 3.5 : 2.4,
        pierce: ws.pierce, bounce: w.bounce || 0, homing: ws.homing, target: ws.homing ? target : null,
        aoe: w.aoe || 0, slow: w.slow || 0, slowTime: w.slowTime || 0, burn: w.burn || 0,
        knock: w.knock ?? 2, gravity, color: w.color, explodeOnExpire: !!w.aoe,
        scale: this.weapon.level >= 9 ? 1.3 : 1,
      });
    }
    g.audio.play(w.type, { volume: (w.type === 'laser' || w.type === 'bullet' ? 0.3 : 0.5) / Math.sqrt(Math.max(1, n * 0.6)) });
    g.fx.sparks.burst(from, { count: 4, speed: 3, life: 0.16, size: 0.5, color: w.color, color2: 0xffffff });
  }

  // ------------------------------------------------------------------
  //  自动撕咬：前方近身的敌人
  // ------------------------------------------------------------------
  inBiteZone(e) {
    const dz = e.pos.z - this.pos.z;
    const dx = Math.abs(e.pos.x - this.pos.x);
    if (dz < -this.radius || dz > this.frontReach + this.stats.reach + e.radius) return false;
    if (dx > this.radius + e.radius + 0.8) return false;
    if (e.flying && e.hoverY > this.top + 2.5) return false;
    return true;
  }

  tryBite() {
    const g = this.game;
    for (const e of g.enemies) {
      if (!e.targetable || !this.inBiteZone(e)) continue;
      const rate = this.stats.atkRate * (this.buffs.frenzy > 0 ? (this.def.skill.rateMul || 2) : 1);
      this.biteCd = 1 / rate;
      this.atkDur = clamp(0.8 / rate, 0.25, 0.55);
      this.atkT = 0;
      this.atkHit = false;
      g.audio.play('whoosh', { volume: 0.35, pitch: 1.2 - this.size.height * 0.08 });
      return true;
    }
    return false;
  }

  meleeHit() {
    const g = this.game;
    const style = this.def.attack;
    let hits = 0;
    const powerMul = this.buffs.power > 0 ? 1.5 : 1;
    for (const e of g.enemies) {
      if (!e.targetable || !this.inBiteZone(e)) continue;
      const crit = Math.random() < this.stats.crit;
      const dmg = this.stats.atk * 1.3 * powerMul * (crit ? 1.8 : 1) * (0.9 + Math.random() * 0.2);
      _dir.set((e.pos.x - this.pos.x) * 0.3, 0, 1).normalize();
      g.damageEnemy(e, dmg, { crit, dir: _dir, knock: MELEE_KNOCK[style] ?? 6, source: 'melee', up: style === 'stomp' || style === 'headbutt' ? 5 : 0 });
      hits++;
    }
    if (hits > 0) {
      this.model.mouth.getWorldPosition(this.mouth);
      g.audio.play(style, { volume: 0.8, pitch: 1.15 - this.size.height * 0.07 });
      g.hitstop(0.03);
      g.fx.sparks.burst(this.mouth, { count: 12, speed: 6, life: 0.3, size: 0.6, color: 0xfff0c0, color2: 0xff8040 });
    }
  }

  /** 与怪物相撞（由 game 检测） */
  collide(e) {
    const g = this.game;
    const charging = (this.skill && this.skill.type === 'charge') || this.buffs.sprint > 0;
    const dxs = Math.sign(e.pos.x - this.pos.x) || (Math.random() < 0.5 ? -1 : 1);
    if (charging || (!e.isBoss && (!e.isProp || e.type === 'chest') && e.hp <= this.stats.ram * (this.buffs.power > 0 ? 1.5 : 1))) {
      // 撞飞！
      _dir.set(dxs * 0.8, 0, 1).normalize();
      g.damageEnemy(e, charging ? this.stats.ram * 2 : e.hp + 1, { dir: _dir, knock: 14, up: 9, source: 'ram' });
      if (!charging && !this.invulnerable) this.takeDamage(e.dmg * 0.2, { kind: 'chip', attacker: e });
      g.audio.play('hitHeavy', { volume: 0.6, pitch: 1.2 });
      g.hitstop(0.025);
      return;
    }
    // 撞上硬目标：互相伤害，恐龙被顶回
    g.damageEnemy(e, this.stats.ram, { dir: FWD, knock: 10, source: 'ram' });
    _dir.set(-dxs, 0, -1).normalize();
    this.takeDamage(e.dmg, { dir: _dir, knock: 5, attacker: e, kind: 'melee' });
    this.fwd *= 0.35;
    this.vel.x += -dxs * 6;
    g.audio.play('hitHeavy', { volume: 0.8, pitch: 0.8 });
  }

  // ------------------------------------------------------------------
  //  技能（跑道版）
  // ------------------------------------------------------------------
  startSkill(running) {
    const g = this.game;
    const d = this.def.skill;
    const s = { type: d.type, t: 0, dur: 1, fired: false, hit: new Set(), count: 0, running };
    switch (d.type) {
      case 'roar': s.dur = 1.2; break;
      case 'charge':
        s.dur = 1.5; s.invuln = true; s.noBite = true;
        g.audio.play('charge');
        if (!running) this.launchWave(this.stats.atk * d.power * 2.2, 6, 1.6);
        break;
      case 'pounce':
      case 'dive':
        s.dur = 3; s.air = true; s.invuln = true; s.noBite = true;
        this.vy = d.type === 'dive' ? 17 : 14; this.onGround = false;
        g.audio.play(d.type === 'dive' ? 'dive' : 'pounce');
        g.fx.dust.burst(this.pos, { count: 16, speed: 5, life: 0.7, size: 1, sizeEnd: 2.5, color: g.dustColor, alpha: 0.5, flat: true, up: 1 });
        break;
      case 'spin': s.dur = 0.3 * (d.hits || 3) + 0.15; g.audio.play('spin'); break;
      case 'stomp': s.dur = 0.5 + 0.2 * 6; s.noBite = true; break;
      case 'sonic': s.dur = 1.0; break;
      case 'venom': s.dur = 0.6; break;
      case 'wave': s.dur = 0.7; break;
      case 'spikes': s.dur = 0.6; break;
      case 'frenzy':
        s.dur = 0.9;
        this.buffs.frenzy = d.duration;
        g.audio.play('frenzy'); g.audio.roar(0.8 + this.size.height * 0.15);
        g.fx.sparks.burst(this.center, { count: 40, speed: 8, life: 0.6, size: 0.8, color: 0xff4020, color2: 0xff0000 });
        g.floatText(this.pos, t('float.frenzy'), 'crit', this.top + 2);
        break;
      case 'fortress':
        s.dur = 0.8;
        this.buffs.fortress = d.duration;
        g.audio.play('fortress');
        g.floatText(this.pos, t('float.fortress'), 'info', this.top + 2);
        break;
      case 'sprint':
        s.dur = 0.6;
        this.buffs.sprint = d.duration;
        this.sprintTouched.clear();
        g.audio.play('sprint');
        g.floatText(this.pos, t('float.sprint'), 'info', this.top + 2);
        break;
    }
    this.skill = s;
    this.skillCd = d.cd * this.stats.cdMul;
    this.atkT = -1;
    g.stats.skills++;
  }

  launchWave(dmg, width, scale = 1) {
    const g = this.game;
    _v.set(this.pos.x, this.pos.y + 1.2, this.pos.z + this.frontReach);
    g.projectiles.spawn({ kind: 'wave', owner: 'player', source: 'skill', pos: _v, dir: FWD, speed: 36, inherit: _inherit.set(0, 0, this.fwd), dmg, radius: width / 2 + 0.6, life: 1.5, pierce: 999, knock: 12, stun: 0.8, width, hover: 1.3, scale });
    g.audio.play('wave');
  }

  /** 普通跳跃落地：踩踏震地，伤害并击飞脚边的怪物（体型越大范围越大） */
  landStomp(fall) {
    const g = this.game;
    const k = clamp((fall - 8) / 6, 0, 1);
    const R = 2.4 + this.radius * 0.9 + this.size.height * 0.35;
    const dmg = this.stats.atk * (0.7 + 0.4 * k) * (this.buffs.power > 0 ? 1.5 : 1);
    const hits = g.aoe(this.pos, R, dmg, { knock: 8, up: 6, stun: 0.35, source: 'melee' });
    g.fx.rings.ring(this.pos, { r0: 0.8, r1: R * 1.25, life: 0.45, color: 0xfff0c8, opacity: 0.55 });
    g.fx.dust.burst(this.pos, { count: 26, speed: 6 + R, life: 0.7, size: 1.1, sizeEnd: 2.8, color: g.dustColor, alpha: 0.5, flat: true, drag: 2.5, up: 1.5 });
    g.audio.play('stomp', { volume: 0.55 + 0.25 * k, pitch: 1.2 - this.size.height * 0.08 });
    g.shake.add(0.12 + 0.1 * k);
    if (hits > 0) {
      g.hitstop(0.035);
      if (hits >= 3) g.floatText(this.pos, t('float.stomp', { n: hits }), 'crit', this.top + 2);
    }
  }

  landSkill() {
    const g = this.game;
    const s = this.skill;
    const d = this.def.skill;
    if (!s || s.fired) return;
    s.fired = true;
    s.t = s.dur; // 结束
    const atk = this.stats.atk * (this.buffs.power > 0 ? 1.5 : 1);
    const R = d.radius + 2;
    g.aoe(this.pos, R, atk * d.power * 1.5, { knock: 12, up: 8, stun: 0.6, source: 'skill' });
    g.fx.rings.ring(this.pos, { r0: 1, r1: R * 1.2, life: 0.5, color: s.type === 'dive' ? 0xff9040 : 0xffe0a0 });
    g.fx.dust.burst(this.pos, { count: 40, speed: 9, life: 0.9, size: 1.4, sizeEnd: 3.5, color: g.dustColor, alpha: 0.55, flat: true, drag: 2.5, up: 2 });
    if (s.type === 'dive') g.fx.sparks.burst(this.pos, { count: 50, speed: 13, life: 0.7, size: 1, color: 0xffd060, color2: 0xff2000, up: 4 });
    g.audio.play('quake', { volume: 0.8 });
    g.shake.add(0.35);
    g.hitstop(0.06);
    this.launchWave(atk * d.power, 7);
  }

  updateSkill(dt) {
    const g = this.game;
    const s = this.skill;
    const d = this.def.skill;
    s.t += dt;
    const k = Math.min(1, s.t / s.dur);
    this.skillAnim = s.air ? Math.min(0.95, s.t / 0.9) : k;
    const atk = this.stats.atk * (this.buffs.power > 0 ? 1.5 : 1);

    switch (s.type) {
      case 'roar':
        if (!s.fired && k > 0.28) {
          s.fired = true;
          g.audio.roar(0.9 + this.size.height * 0.18);
          g.shake.add(0.3);
          g.aoeBox(this.pos.z - 4, this.pos.z + d.radius * 2.4, g.track.roadHalf + 2, atk * d.power, { knock: 12, stun: d.stun, source: 'skill' });
          for (let i = 0; i < 4; i++) {
            _v.set(this.pos.x, this.pos.y, this.pos.z + 6 + i * 7);
            g.fx.rings.ring(_v, { r0: 2, r1: 9 + i * 2, life: 0.5 + i * 0.1, color: 0xffc070, opacity: 0.7 });
          }
          this.model.mouth.getWorldPosition(this.mouth);
          g.fx.sparks.burst(this.mouth, { count: 40, speed: 22, life: 0.6, size: 0.9, color: 0xfff0d0, color2: 0xffa040, dir: FWD, spread: 0.5 });
          g.hitstop(0.06);
        }
        break;

      case 'charge':
        for (const e of g.enemies) {
          if (!e.targetable || s.hit.has(e) || e.isBoss) continue;
          if (Math.abs(e.pos.z - this.pos.z) > this.frontReach + e.radius + 1 || Math.abs(e.pos.x - this.pos.x) > this.radius + e.radius + 0.5) continue;
          s.hit.add(e);
          _dir.set(Math.sign(e.pos.x - this.pos.x) || 1, 0, 0.6).normalize();
          g.damageEnemy(e, atk * d.power * 2, { dir: _dir, knock: 18, up: 8, stun: d.stun || 0.6, source: 'skill' });
          g.audio.play('hitHeavy', { volume: 0.7 });
        }
        if (Math.random() < 0.7) g.fx.dust.burst(this.pos, { count: 3, speed: 2, life: 0.6, size: 1, sizeEnd: 2.5, color: g.dustColor, alpha: 0.5, up: 1 });
        break;

      case 'pounce':
      case 'dive':
        if (s.type === 'dive' && !s.bombed && s.t > 0.45) {
          // 空中投弹：锁定前方最多 5 个目标
          s.bombed = true;
          const targets = g.enemies.filter((e) => e.targetable && e.pos.z > this.pos.z).sort((a, b) => a.pos.z - b.pos.z).slice(0, 5);
          if (!targets.length) targets.push(null);
          for (const tg of targets) {
            _v2.set(tg ? tg.pos.x : this.pos.x, 0, tg ? tg.pos.z : this.pos.z + 22);
            _v2.y = g.heightAt(_v2.x, _v2.z);
            this.getCenter(_v).y += 2;
            _dir.subVectors(_v2, _v).normalize();
            g.projectiles.spawn({ kind: 'meteor', owner: 'player', source: 'skill', pos: _v, dir: _dir, speed: 40, dmg: atk * d.power, radius: 1.4, life: 2, aoe: d.radius * 0.7, knock: 10, color: 0xff7a2a, scale: 0.6 });
          }
          g.audio.play('missile');
        }
        if (s.air && s.t > 0.2 && this.onGround) this.landSkill();
        break;

      case 'spin': {
        this.spinAngle = k * Math.PI * 2 * (d.hits || 3);
        const hits = d.hits || 3;
        const due = Math.floor((s.t / (s.dur - 0.1)) * hits + 0.2);
        while (s.count < Math.min(hits, due)) {
          s.count++;
          g.aoe(this.pos, d.radius + 1.5, atk * d.power, { knock: 9, source: 'skill' });
          g.audio.play('tail', { pitch: 0.9 + s.count * 0.08 });
          g.fx.rings.ring(this.pos, { r0: d.radius * 0.5, r1: d.radius + 1.5, life: 0.3, color: 0xffffff, opacity: 0.5 });
        }
        // 旋风还能打散来袭的子弹
        for (const p of g.projectiles.list) {
          if (p.owner === 'enemy' && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < d.radius + 2) p.life = 0;
        }
        if (k >= 1) this.spinAngle = 0;
        break;
      }

      case 'stomp': {
        const n = 6;
        while (s.count < n && s.t >= 0.45 + s.count * 0.2) {
          const i = s.count++;
          _v.set(this.pos.x, 0, this.pos.z + 5 + i * 6);
          _v.y = g.heightAt(_v.x, _v.z);
          g.aoe(_v, 6.5, atk * d.power * 0.8, { knock: 8, up: 8, stun: 0.5, source: 'skill' });
          g.fx.rings.ring(_v, { r0: 1, r1: 7, life: 0.45, color: 0xffe0a0, opacity: 0.8 });
          g.fx.dust.burst(_v, { count: 22, speed: 6, life: 0.8, size: 1.3, sizeEnd: 3, color: g.dustColor, alpha: 0.5, flat: true, drag: 1.8, up: 2 });
          g.audio.play('quake', { volume: 0.8 - i * 0.08 });
          if (i === 0) g.shake.add(0.3);
        }
        break;
      }

      case 'sonic':
        if (!s.fired && k > 0.25) {
          s.fired = true;
          g.audio.play('sonic');
          const half = THREE.MathUtils.degToRad(d.angle / 2);
          for (const e of g.enemies) {
            if (!e.targetable) continue;
            const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
            const dist = Math.hypot(dx, dz) - e.radius;
            if (dist > d.range + 14 || dz < 0) continue;
            if (Math.abs(Math.atan2(dx, dz)) > half + 0.15) continue;
            _dir.set(dx, 0, dz).normalize();
            g.damageEnemy(e, atk * d.power, { dir: _dir, knock: 14, stun: 0.8, source: 'skill' });
          }
          this.heal(this.stats.maxHp * d.heal);
          this.model.mouth.getWorldPosition(this.mouth);
          for (let i = 0; i < 5; i++) g.fx.sparks.burst(this.mouth, { count: 24, speed: 22 + i * 5, life: 0.6, size: 1.1, sizeEnd: 2.2, color: 0x9fe8ff, color2: 0x4080ff, dir: FWD, spread: 0.45, alpha: 0.7 });
          g.fx.sparks.burst(this.center, { count: 30, speed: 3, life: 1, size: 0.6, color: 0x80ff90, color2: 0x20c040, up: 3 });
        }
        break;

      case 'venom':
        if (!s.fired && k > 0.35) {
          s.fired = true;
          g.audio.play('venom');
          this.model.mouth.getWorldPosition(this.mouth);
          const n = d.count || 7;
          const spread = THREE.MathUtils.degToRad(d.spread || 50);
          for (let i = 0; i < n; i++) {
            const a = (i / (n - 1) - 0.5) * spread;
            _dir.set(Math.sin(a), 0.08, Math.cos(a));
            g.projectiles.spawn({ kind: 'venom', owner: 'player', source: 'skill', pos: this.mouth, dir: _dir, speed: 32, inherit: _inherit.set(0, 0, this.fwd), dmg: atk * d.power, radius: 0.9, life: 1.3, poison: d.poison || 3, knock: 3, gravity: 4, pierce: 1, color: 0x9cff3a });
          }
        }
        break;

      case 'wave':
        if (!s.fired && k > 0.4) { s.fired = true; this.launchWave(atk * d.power, d.width || 5); g.shake.add(0.2); }
        break;

      case 'spikes':
        if (!s.fired && k > 0.35) {
          s.fired = true;
          g.audio.play('spikes');
          const n = d.count || 16;
          _v.set(this.pos.x, this.pos.y + this.size.height * 0.7, this.pos.z);
          for (let i = 0; i < n; i++) {
            const a = (i / (n - 1) - 0.5) * Math.PI * 1.1;
            _dir.set(Math.sin(a), 0, Math.cos(a));
            g.projectiles.spawn({ kind: 'spike', owner: 'player', source: 'skill', pos: _v, dir: _dir, speed: 36, inherit: _inherit.set(0, 0, this.fwd), dmg: atk * d.power, radius: 0.8, life: 1.1, pierce: 3, knock: 6, hover: 1.1 });
          }
          g.fx.rings.ring(this.pos, { r0: 1, r1: 6, life: 0.35, color: 0xf6ecd0 });
        }
        break;
    }

    if (s.t >= s.dur && !(s.air && !s.fired)) {
      this.skill = null;
      this.skillAnim = -1;
      this.spinAngle = 0;
    }
  }

  updateBuffFx(dt) {
    const g = this.game;
    this.auraAcc += dt;
    if (this.auraAcc < 0.05) return;
    this.auraAcc = 0;
    const c = this.center;
    if (this.buffs.frenzy > 0) g.fx.sparks.burst(c, { count: 2, speed: 1.5, life: 0.6, size: 0.8, color: 0xff3020, color2: 0x600000, radius: this.radius, up: 2 });
    if (this.buffs.power > 0) g.fx.sparks.burst(c, { count: 2, speed: 1, life: 0.6, size: 0.7, color: 0xffd040, color2: 0xff6000, radius: this.radius, up: 2 });
    if (this.buffs.sprint > 0) {
      g.fx.sparks.burst(c, { count: 3, speed: 0.5, life: 0.35, size: this.size.height * 0.9, color: this.def.colors.main, color2: 0x80e0ff, radius: this.radius * 0.6, alpha: 0.35 });
      const now = this.anim.t;
      for (const e of g.enemies) {
        if (!e.targetable || e.isBoss) continue;
        if (Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) > this.radius + e.radius + 2) continue;
        const last = this.sprintTouched.get(e) || -9;
        if (now - last < 0.45) continue;
        this.sprintTouched.set(e, now);
        _dir.set(e.pos.x - this.pos.x, 0, 1).normalize();
        g.damageEnemy(e, this.stats.atk * (this.def.skill.power || 0.6) * 2, { dir: _dir, knock: 12, source: 'skill' });
      }
    }
  }

  // ------------------------------------------------------------------
  heal(n) {
    if (!this.alive || n <= 0) return;
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
    const got = Math.round(this.hp - before);
    if (got > 0) this.game.floatText(this.pos, '+' + got, 'heal', this.top + 1.5);
  }

  takeDamage(amount, o = {}) {
    const g = this.game;
    if (!this.alive || g.state === 'win' || g.state === 'bossDown') return;
    const dot = o.kind === 'dot';
    if (!dot && o.kind !== 'chip' && (this.invuln > 0 || this.invulnerable)) return;
    if (o.kind === 'chip' && this.invulnerable) return;
    let red = this.stats.def;
    if (this.buffs.fortress > 0) red = 1 - (1 - red) * (1 - (this.def.skill.reduce || 0.8));
    if (this.buffs.shield > 0) red = 1 - (1 - red) * 0.25;
    const dmg = Math.max(1, amount * (1 - red));
    this.hp -= dmg;
    g.stats.dmgTaken += dmg;
    if (!dot) this.sinceHit = 0;
    if (!dot && o.kind !== 'chip') {
      this.invuln = 0.35;
      this.hurt = 1;
      this.flashT = 0.15;
      g.audio.play(this.buffs.fortress > 0 || this.buffs.shield > 0 ? 'shieldHit' : 'playerHurt', { volume: 0.7 });
      g.shake.add(Math.min(0.3, 0.1 + dmg / this.stats.maxHp * 1.2));
      g.hud && g.hud.damageFlash();
      if (this.buffs.fortress > 0 && o.attacker && o.attacker.targetable) {
        _dir.set(o.attacker.pos.x - this.pos.x, 0, o.attacker.pos.z - this.pos.z).normalize();
        g.damageEnemy(o.attacker, amount * (this.def.skill.thorns || 0.5) + this.stats.atk * 0.5, { dir: _dir, knock: 6, source: 'thorns' });
      }
    }
    if (o.poison) { this.poisonT = Math.max(this.poisonT, o.poison); this.poisonDps = Math.max(this.poisonDps, amount * 0.2); }
    if (o.slow) { this.slowMul = 1 - o.slow * 0.5; this.slowT = o.slowTime || 1.5; }
    if (o.kind !== 'chip' || dmg >= 2) g.floatText(this.pos, '-' + Math.round(dmg), 'player', this.top + 1.2);
    if (this.hp <= 0) { this.hp = 0; this.die(); }
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.deadT = 0;
    this.skill = null;
    this.skillAnim = -1;
    this.spinAngle = 0;
    for (const k in this.buffs) this.buffs[k] = 0;
    this.game.onPlayerDeath();
  }

  dispose() {
    this.game.scene.remove(this.root);
    this.game.scene.remove(this.shield);
    this.shield.geometry.dispose();
    this.shield.material.dispose();
  }
}
