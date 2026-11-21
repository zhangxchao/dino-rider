// =====================================================================
//  斗兽场：古罗马竞技场里 A 组对 B 组的对战（单挑 / 团战）
//  · 独立的小型战斗模拟，不用跑道玩法（Game / Player / Boss）的代码，只借用模型工厂
//  · 所有生物统一成 Fighter：普通恐龙、变异恐龙（宠物）、三大泰坦、大首领、黑化蜥蜴怪 / 飞龙
//  · A 组伤害数字红色，B 组绿色
//  · 普通恐龙 / 变异恐龙只有在「恐龙加强框」里打开了大招 / 远古觉醒，才能放出来
// =====================================================================
import * as THREE from 'three';
import { DINOS, PETS, ENEMIES, BOSSES, TITANS, GEM, PET_RULES } from './data.js';
import { createWorld, COLOSSEUM_R } from './world.js';
import { createDinoModel } from './models/dinos.js';
import { createEnemyModel, createBossModel } from './models/enemies.js';
import { FloatingText } from './effects.js';
import { input } from './input.js';
import { prepareModel, damp, clamp } from './util.js';
import { t } from './i18n.js';
import { updateBend } from './bend.js';

// ---------------------------------------------------------------------
//  名册
// ---------------------------------------------------------------------
export const BOSS_KEYS = ['spider', 'sandworm', 'frostGiant', 'hydra', 'magmaGolem', 'overlord', 'mantis'];
export const DARK_KEYS = ['darkLizard', 'darkWyvern'];
export const KINDS = ['dino', 'pet', 'titan', 'boss', 'dark'];
export const KIND_ICON = { dino: '🦖', pet: '🧬', titan: '🗿', boss: '👑', dark: '🕷️' };
/** 恐龙加强框里的数值：战力宝石 +800 血，黑心宝石 +2000 血（同宠物首领的黑化宝石） */
export const BOOST = { powerHp: 800, blackHp: PET_RULES.bossGemHp, gemMax: GEM.max };
export const TEAM_MAX = 5;
export const emptyBoost = () => ({ gem: 0, power: false, black: false, ult: false, awaken: false });

export function creatureIds(kind) {
  if (kind === 'dino') return DINOS.map((d) => d.id);
  if (kind === 'pet') return PETS.map((d) => d.id);
  if (kind === 'titan') return [...TITANS];
  if (kind === 'boss') return [...BOSS_KEYS];
  return [...DARK_KEYS];
}

/** 把各种来源的数值统一成：hp / atk（每下）/ def / speed / reach / atkCd（秒） */
export function creatureInfo(id) {
  const d = DINOS.find((x) => x.id === id) || PETS.find((x) => x.id === id);
  if (d) {
    const s = d.stats;
    const kind = PETS.includes(d) ? 'pet' : 'dino';
    return { id, kind, def: d, name: d.name, hp: s.hp, atk: s.atk, dfn: s.def, speed: s.speed, reach: s.reach, atkCd: 1 / s.atkRate, canBoost: true, skill: d.skill };
  }
  if (BOSS_KEYS.includes(id)) {
    const b = BOSSES[id];
    return { id, kind: 'boss', def: b, name: b.name, hp: b.hp, atk: b.dmg * 2, dfn: 0, speed: b.speed, reach: b.radius + 1.2, atkCd: 1.5, canBoost: false };
  }
  const e = ENEMIES[id];
  if (e) {
    const kind = TITANS.includes(id) ? 'titan' : 'dark';
    return { id, kind, def: e, name: e.name, hp: e.hp, atk: e.dmg, dfn: 0, speed: e.speed, reach: (e.atkRange || 2.5) * 0.6, atkCd: e.atkCd || 1.5, canBoost: false };
  }
  return null;
}

// ---------------------------------------------------------------------
//  特效：扩散圈 / 光柱 / 火花
// ---------------------------------------------------------------------
const ringGeo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
const pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true).translate(0, 0.5, 0);

class Fx {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    const N = 700;
    this.N = N;
    this.pos = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N);
    this.max = new Float32Array(N);
    this.alive = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.7, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.head = 0;
  }

  ring(p, r1, life, color, r0 = 0.6, y = 0.42) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(p.x, y, p.z);
    m.scale.setScalar(r0);
    this.scene.add(m);
    this.items.push({ m, t: 0, life, r0, r1, kind: 'ring' });
  }

  pillar(p, r, h, life, color) {
    const m = new THREE.Mesh(pillarGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.position.set(p.x, 0.3, p.z);
    m.scale.set(r, 0.1, r);
    this.scene.add(m);
    this.items.push({ m, t: 0, life, h, r, kind: 'pillar' });
  }

  burst(p, { n = 20, speed = 6, up = 4, life = 0.7, color = 0xffffff, y = 1 } = {}) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const k = this.head = (this.head + 1) % this.N;
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      this.pos[k * 3] = p.x; this.pos[k * 3 + 1] = p.y !== undefined && p.y > 0 ? p.y : y; this.pos[k * 3 + 2] = p.z;
      this.vel[k * 3] = Math.cos(a) * s; this.vel[k * 3 + 1] = Math.random() * up; this.vel[k * 3 + 2] = Math.sin(a) * s;
      this.col[k * 3] = c.r; this.col[k * 3 + 1] = c.g; this.col[k * 3 + 2] = c.b;
      this.life[k] = this.max[k] = life * (0.6 + Math.random() * 0.6);
    }
    this.alive = this.N;
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) { this.scene.remove(it.m); it.m.material.dispose(); this.items.splice(i, 1); continue; }
      if (it.kind === 'ring') {
        it.m.scale.setScalar(it.r0 + (it.r1 - it.r0) * (1 - (1 - k) * (1 - k)));
        it.m.material.opacity = 0.85 * (1 - k);
      } else {
        it.m.scale.set(it.r * (1 + 0.3 * k), it.h * Math.min(1, k * 4), it.r * (1 + 0.3 * k));
        it.m.material.opacity = 0.55 * (1 - k);
      }
    }
    let any = false;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; continue; }
      this.life[i] -= dt;
      any = true;
      this.vel[i * 3 + 1] -= 9 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.05) { this.pos[i * 3 + 1] = 0.05; this.vel[i * 3 + 1] *= -0.3; }
      const f = Math.max(0, this.life[i] / this.max[i]);
      this.col[i * 3] *= 0.97 + 0.03 * f; this.col[i * 3 + 1] *= 0.97 + 0.03 * f; this.col[i * 3 + 2] *= 0.97 + 0.03 * f;
    }
    if (any || this.alive) {
      this.points.geometry.setDrawRange(0, this.N);
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
      if (!any) this.alive = 0;
    }
  }

  dispose() {
    for (const it of this.items) { this.scene.remove(it.m); it.m.material.dispose(); }
    this.items.length = 0;
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

// ---------------------------------------------------------------------
//  战士
// ---------------------------------------------------------------------
const S = 0.55;                      // 技能距离缩放（跑道里的距离比竞技场大）
const TEAM_COL = { A: 0xff4a4a, B: 0x4dff6a };
const AWAKE_COL = { A: 0xffb020, B: 0xb04aff };   // 远古觉醒：A 组金色，B 组紫色（和对手一眼区分）
const R = COLOSSEUM_R;
const FLOOR = 0.3;                   // 沙地高度
const _a = new THREE.Vector3();
const _col = new THREE.Color();

class Fighter {
  constructor(arena, slot, team, index, count) {
    this.arena = arena;
    this.team = team;
    this.info = creatureInfo(slot.id);
    const info = this.info;
    const b = { ...emptyBoost(), ...(slot.boost || {}) };
    this.boost = info.canBoost ? b : { ...emptyBoost(), gem: Math.min(b.gem, BOOST.gemMax), power: b.power, black: b.black };
    this.name = info.name;
    this.kind = info.kind;
    // 模型
    if (info.kind === 'dino' || info.kind === 'pet') this.model = createDinoModel(info.def);
    else if (info.kind === 'boss') this.model = createBossModel(info.id, info.def);
    else this.model = createEnemyModel(info.id, info.def);
    this.root = this.model.root;
    this.baseScale = this.root.scale.x || 1;
    this.flash = prepareModel(this.root, { cast: true });
    this.radius = Math.max(0.9, (this.model.size.radius || 1.2) * (info.kind === 'dino' || info.kind === 'pet' ? 0.8 : 1));
    // 数值（加强框）
    const gem = this.boost.gem;
    this.maxHp = info.hp + gem * GEM.hp + (this.boost.power ? BOOST.powerHp : 0) + (this.boost.black ? BOOST.blackHp : 0);
    this.hp = this.maxHp;
    this.atk = info.atk + gem * GEM.atk;
    this.dfn = info.dfn;
    this.speed = clamp(info.speed * 0.62, 3.2, 10.5);
    this.reach = info.reach;
    this.atkCd0 = info.atkCd;
    this.hasSkill = !!info.skill;
    // 位置：A 在西、B 在东，纵向排开
    const sx = team === 'A' ? -1 : 1;
    this.pos = new THREE.Vector3(sx * (R * 0.62), 0, (index - (count - 1) / 2) * 7.5);
    this.heading = team === 'A' ? Math.PI / 2 : -Math.PI / 2;
    this.vel = new THREE.Vector3();
    this.t = Math.random() * 10;
    this.dead = false; this.deadT = 0;
    this.atkT = -1; this.atkHit = false; this.atkCd = 0.4 + Math.random() * 0.6;
    this.skillCd = 2 + Math.random() * 3;
    this.sk = null;                  // 正在释放的技能
    this.stun = 0; this.hurtT = 0; this.flashT = 0;
    this.buffs = {};                 // frenzy / sprint / fortress
    this.dot = null;                 // { t, dps, kind }
    this.dotTick = 0.5;
    this.awakeT = 0; this.awakeWas = false; this.awakeWave = 0; this.awakeScale = 1;
    this.fever = 0;
    this.slow = 0;
    this.target = null; this.retarget = 0;
    this.bossCd = 4 + Math.random() * 3; this.bossK = 0;
    this.controlled = false;
    this.anim = { t: 0, move: 0, air: false, attack: -1, skill: -1, hurt: 0, dead: 0, pattern: null, phase: 1, burrow: 0 };
    this.moveAmt = 0;
    this.root.position.set(this.pos.x, FLOOR, this.pos.z);
    this.root.rotation.y = this.heading;
    arena.scene.add(this.root);
  }

  get alive() { return !this.dead; }
  get canAwaken() { return this.info.canBoost && this.boost.awaken; }
  get canUlt() { return this.info.canBoost && this.boost.ult; }

  /** 受到伤害：def + 觉醒减伤 + 堡垒减伤；返回实际伤害 */
  takeHit(raw, from, o = {}) {
    if (this.dead || raw <= 0) return 0;
    const A = this.arena;
    let red = clamp(this.dfn + (this.awakeT > 0 ? 0.3 : 0) + (this.buffs.fortress ? this.buffs.fortress.v : 0), 0, 0.92);
    if (this.awakeT > 0 && this.awakeInvuln > 0) red = 1;
    const dmg = Math.max(1, Math.round(raw * (1 - red)));
    if (red >= 1) return 0;
    this.hp -= dmg;
    this.hurtT = 1; this.flashT = 0.12;
    this.fever = Math.min(100, this.fever + 3);
    if (from) {
      from.fever = Math.min(100, from.fever + 6);
      if (from.buffs.frenzy && from.buffs.frenzy.ls) from.hp = Math.min(from.maxHp, from.hp + dmg * from.buffs.frenzy.ls);
      if (this.buffs.fortress && this.buffs.fortress.thorns && !o.thorn) from.takeHit(dmg * this.buffs.fortress.thorns, this, { thorn: true });
    }
    A.floatDmg(this, dmg, from ? from.team : this.team === 'A' ? 'B' : 'A', o.big);
    if (o.stun) this.stun = Math.max(this.stun, o.stun);
    if (o.knock && from) {
      _a.subVectors(this.pos, from.pos).setY(0).normalize();
      this.vel.addScaledVector(_a, o.knock);
    }
    if (o.poison) this.dot = { t: o.poison, dps: Math.max(1, o.dps || dmg * 0.4), kind: 'poison', from };
    if (o.burn) this.dot = { t: o.burn, dps: Math.max(1, o.dps || dmg * 0.3), kind: 'burn', from };
    if (this.hp <= 0) this.die(from);
    return dmg;
  }

  die() {
    this.hp = 0; this.dead = true; this.deadT = 0; this.sk = null; this.atkT = -1;
    this.root.scale.setScalar(this.baseScale);
    this.arena.fx.burst(this.pos, { n: 26, speed: 7, up: 6, color: 0xffe0a0, life: 0.9 });
    this.arena.onDeath(this);
  }

  heal(v) { if (!this.dead) { this.hp = Math.min(this.maxHp, this.hp + v); this.arena.floatText(this, '+' + Math.round(v), 'heal'); } }

  // ------------------------------------------------------------------
  rate() { return (this.buffs.frenzy ? this.buffs.frenzy.rate : 1) * (this.awakeT > 0 ? 1.4 : 1); }
  spd() {
    return this.speed * (this.buffs.sprint ? this.buffs.sprint.v : 1) * (this.awakeT > 0 ? 1.2 : 1) * (this.slow > 0 ? 0.5 : 1);
  }
  atkPower() { return this.atk * (this.awakeT > 0 ? 1.5 : 1); }
  range(tg) { return this.radius * 0.7 + tg.radius * 0.7 + this.reach * 0.6; }

  pickTarget(foes) {
    let best = null, bd = 1e9;
    for (const f of foes) {
      if (f.dead) continue;
      const d = this.pos.distanceTo(f.pos) - f.radius;
      if (d < bd) { bd = d; best = f; }
    }
    this.target = best;
  }

  update(dt, foes, mates) {
    const A = this.arena;
    this.t += dt;
    this.anim.t = this.t;
    if (this.dead) {
      this.deadT = Math.min(1, this.deadT + dt / 1.6);
      this.anim.dead = this.deadT; this.anim.attack = -1; this.anim.skill = -1; this.anim.move = 0; this.anim.pattern = null;
      this.root.position.set(this.pos.x, FLOOR, this.pos.z);
      this.model.update(dt, this.anim);
      this.flash.setFlash(Math.min(0.5, this.deadT * 0.5), _col.set(0x300000));
      return;
    }
    // 计时
    this.atkCd -= dt * this.rate(); this.skillCd -= dt; this.stun -= dt; this.slow -= dt;
    this.hurtT = Math.max(0, this.hurtT - dt * 4);
    this.flashT = Math.max(0, this.flashT - dt);
    for (const k of Object.keys(this.buffs)) { this.buffs[k].t -= dt; if (this.buffs[k].t <= 0) delete this.buffs[k]; }
    if (this.dot) {
      this.dot.t -= dt; this.dotTick -= dt;
      if (this.dotTick <= 0) {
        this.dotTick = 0.5;
        const d = this.dot;
        this.hp -= d.dps * 0.5;
        A.floatDmg(this, Math.round(d.dps * 0.5), d.from ? d.from.team : 'A', false, d.kind);
        if (this.hp <= 0) { this.die(d.from); return; }
      }
      if (this.dot && this.dot.t <= 0) this.dot = null;
    }
    // 觉醒
    if (this.awakeT > 0) {
      this.awakeT -= dt;
      this.awakeInvuln = Math.max(0, (this.awakeInvuln || 0) - dt);
      this.awakeWave -= dt;
      if (this.awakeWave <= 0 && this.awakeT > 0) {
        this.awakeWave = 1.5;
        A.aoe(this, this.pos, 7.5, this.atk * 1.2, { stun: 0.4, knock: 6 }, 'wave');
      }
      if (Math.random() < 0.6) A.fx.burst({ x: this.pos.x + (Math.random() - 0.5) * this.radius * 2, y: 0.5, z: this.pos.z + (Math.random() - 0.5) * this.radius * 2 }, { n: 1, speed: 1, up: 5, life: 0.8, color: AWAKE_COL[this.team] });
    }
    const tgtScale = this.awakeT > 0 ? 1.35 : 1;
    this.awakeScale = damp(this.awakeScale, tgtScale, tgtScale > 1 ? 6 : 3, dt);
    this.root.scale.setScalar(this.baseScale * this.awakeScale);

    // 目标
    this.retarget -= dt;
    if (!this.target || this.target.dead || this.retarget <= 0) { this.pickTarget(foes); this.retarget = 0.5; }
    const tg = this.target;

    let moveDir = null, moving = 0;
    const stunned = this.stun > 0;
    const busy = !!this.sk || this.atkT >= 0;

    if (!stunned) {
      if (this.controlled) {
        const mv = input.move();
        // 屏幕上方 = -z，右 = +x（镜头固定从 +z 方向看）
        if (Math.hypot(mv.x, mv.y) > 0.1) moveDir = _a.set(mv.x, 0, -mv.y).normalize().clone();
        if (!busy && input.pressed('skill')) this.tryCastSkill(foes, true);
        if (input.pressed('ult')) this.tryAwaken();                    // 觉醒变身不受技能动画限制
        if (!busy && (input.keyPressed('KeyF') || input.pressed('jump'))) this.tryUlt(foes);
      } else if (tg && !this.sk) {
        const d = this.pos.distanceTo(tg.pos);
        const rng = this.range(tg);
        if (d > rng * 0.9) moveDir = _a.subVectors(tg.pos, this.pos).setY(0).normalize().clone();
        if (!busy) this.ai(foes, tg, d, rng);
      }
      // 自动攻击
      if (tg && this.atkT < 0 && !this.sk && this.atkCd <= 0) {
        const d = this.pos.distanceTo(tg.pos);
        if (d <= this.range(tg)) { this.atkT = 0; this.atkHit = false; this.atkCd = this.atkCd0; this.atkDur = clamp(this.atkCd0 * 0.55, 0.35, 0.75); }
      }
    }

    // 技能 / 攻击推进
    if (this.sk) this.updateSkill(dt, foes);
    if (this.atkT >= 0) {
      this.atkT += dt / (this.atkDur || 0.5);
      if (!this.atkHit && this.atkT >= 0.45) { this.atkHit = true; this.meleeHit(foes); }
      if (this.atkT >= 1) this.atkT = -1;
    }

    // 移动
    const dashing = this.sk && this.sk.dash;
    if (moveDir && !stunned && !this.sk && this.atkT < 0.3) {
      const sp = this.spd();
      this.pos.x += moveDir.x * sp * dt; this.pos.z += moveDir.z * sp * dt;
      moving = sp / 8;
      this.heading = turnTo(this.heading, Math.atan2(moveDir.x, moveDir.z), 9 * dt);
    } else if (tg && !dashing) {
      this.heading = turnTo(this.heading, Math.atan2(tg.pos.x - this.pos.x, tg.pos.z - this.pos.z), 7 * dt);
    }
    // 击退速度衰减
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    const kd = Math.exp(-5 * dt); this.vel.x *= kd; this.vel.z *= kd;
    // 互相挤开
    for (const o of A.fighters) {
      if (o === this || o.dead) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz), min = (this.radius + o.radius) * 0.85;
      if (d < min && d > 1e-4) {
        const push = (min - d) * 0.5 * (o.radius / (this.radius + o.radius)) * 2;
        this.pos.x += (dx / d) * push * Math.min(1, dt * 10); this.pos.z += (dz / d) * push * Math.min(1, dt * 10);
      }
    }
    const lim = R - 3 - this.radius * 0.4, rr = Math.hypot(this.pos.x, this.pos.z);
    if (rr > lim) { this.pos.x *= lim / rr; this.pos.z *= lim / rr; }

    // 模型
    this.moveAmt = damp(this.moveAmt, clamp(moving, 0, 1.6), 8, dt);
    this.root.position.set(this.pos.x, FLOOR, this.pos.z);
    this.root.rotation.y = this.heading;
    const a = this.anim;
    a.move = this.moveAmt; a.hurt = this.hurtT; a.dead = 0; a.air = !!(this.sk && this.sk.air && this.sk.t > 0.1 && this.sk.t < 0.9);
    a.attack = this.atkT; a.skill = -1; a.pattern = null;
    if (this.sk) a.skill = clamp(this.sk.t / this.sk.dur, 0, 1);
    if (this.kind === 'boss') {
      const pats = this.info.def.patterns || [];
      const animMap = this.info.def.anim || {};
      a.pattern = animMap[pats[0]] || pats[0] || null;       // 普通挥击借用第一个招式的动作
      if (this.bossAnim >= 0) { a.attack = this.bossAnim; a.pattern = this.bossPattern; }
    }
    if (this.kind === 'dino' || this.kind === 'pet') { if (this.sk) a.attack = -1; }
    this.model.update(dt, a);
    // 发光：受击白闪 > 觉醒 > 大招中
    if (this.flashT > 0) this.flash.setFlash(0.55 * this.flashT / 0.12, _col.set(0xffffff));
    else if (this.awakeT > 0) this.flash.setFlash(0.3 + 0.12 * Math.sin(this.t * 10), _col.set(AWAKE_COL[this.team]));
    else if (this.stun > 0) this.flash.setFlash(0.25, _col.set(0xffee60));
    else if (this.dot) this.flash.setFlash(0.2, _col.set(this.dot.kind === 'poison' ? 0x6aff3a : 0xff7a20));
    else this.flash.setFlash(0);
  }

  // ------------------------------------------------------------------
  //  AI：该放技能 / 觉醒 / 大招时放
  // ------------------------------------------------------------------
  ai(foes, tg, d) {
    const A = this.arena;
    if (this.kind === 'boss') return;           // 首领的招式在 bossThink 里
    if (this.canAwaken && this.fever >= 100 && this.awakeT <= 0) {
      // 两个都开了：优先觉醒；只有大招就放大招
      this.tryAwaken();
      return;
    }
    if (this.canUlt && this.fever >= 100 && (!this.canAwaken)) { this.tryUlt(foes); return; }
    if (this.canUlt && this.canAwaken && this.fever >= 100 && this.awakeT > 0) { this.tryUlt(foes); return; }
    if (this.hasSkill && this.skillCd <= 0) {
      const sk = this.info.skill;
      const ty = sk.type;
      let ok = false;
      if (['roar', 'stomp', 'spin', 'spikes'].includes(ty)) ok = d < (sk.radius || 9) * S * 0.9;
      else if (['pounce', 'dive', 'charge'].includes(ty)) ok = d > 5 && d < (sk.dist || 20) * S;
      else if (['venom', 'sonic', 'wave'].includes(ty)) ok = d > 3 && d < (sk.range || 22) * S;
      else ok = d < 10;
      if (ok) this.tryCastSkill(foes, false);
    }
    void A;
  }

  tryAwaken() {
    if (!this.canAwaken || this.fever < 100 || this.awakeT > 0 || this.dead) return false;
    this.fever = 0;
    this.awakeT = 10; this.awakeInvuln = 1.2; this.awakeWave = 0.4;
    const A = this.arena, c = AWAKE_COL[this.team];
    A.fx.ring(this.pos, 14, 0.9, c);
    A.fx.pillar(this.pos, this.radius * 1.4, 16, 1.2, c);
    A.fx.burst({ x: this.pos.x, y: 1.5, z: this.pos.z }, { n: 60, speed: 11, up: 8, life: 1, color: c });
    A.banner(this, t('arena.awakenCast', { name: this.name }));
    return true;
  }

  tryUlt(foes) {
    if (!this.canUlt || this.fever < 100 || this.dead || this.sk) return false;
    this.fever = 0;
    const A = this.arena;
    // 终极大招：场上每个敌人都吃一次大伤害并被点燃（烈火四溅）
    this.sk = { type: 'ult', t: 0, dur: 0.9, hit: false };
    A.banner(this, t('arena.ultCast', { name: this.name }));
    return true;
  }

  tryCastSkill(foes, manual) {
    const sk = this.info.skill;
    if (!sk || this.skillCd > 0 || this.sk || this.dead) return false;
    this.skillCd = sk.cd;
    const tg = this.target;
    const o = { type: sk.type, t: 0, dur: 0.9, hit: false, spec: sk, from: this.pos.clone(), to: null, air: false, dash: false };
    if (['pounce', 'dive', 'charge'].includes(sk.type)) {
      const dist = Math.min((sk.dist || 20) * S, tg ? Math.max(0, this.pos.distanceTo(tg.pos) - this.radius - tg.radius * 0.5) : 8);
      const dir = tg ? _a.subVectors(tg.pos, this.pos).setY(0).normalize() : _a.set(Math.sin(this.heading), 0, Math.cos(this.heading));
      o.to = this.pos.clone().addScaledVector(dir, dist);
      o.dash = true; o.air = sk.type !== 'charge'; o.dur = 0.8;
      this.heading = Math.atan2(dir.x, dir.z);
    }
    if (['frenzy', 'sprint', 'fortress'].includes(sk.type)) o.dur = 0.6;
    this.sk = o;
    void foes; void manual;
    return true;
  }

  updateSkill(dt, foes) {
    const A = this.arena, k = this.sk;
    k.t += dt;
    const sk = k.spec;
    const p = k.t / k.dur;
    if (k.type === 'ult') {
      if (!k.hit && p >= 0.5) {
        k.hit = true;
        A.fx.ring(this.pos, 22, 1, 0xff7a1a);
        for (const f of foes) {
          if (f.dead) continue;
          A.fx.pillar(f.pos, 3.2, 14, 1.1, 0xff6a1a);
          A.fx.ring(f.pos, 7, 0.7, 0xffd060);
          A.fx.burst(f.pos, { n: 22, speed: 6, up: 8, life: 0.9, color: 0xff8a20 });
          f.takeHit(160 + this.atk * 1.5, this, { burn: 3, dps: 12, big: true, stun: 0.4 });
        }
      }
      if (k.t >= k.dur) this.sk = null;
      return;
    }
    if (k.dash) {
      // 前 55%：飞扑 / 冲撞；到了就落地结算
      const m = Math.min(1, k.t / (k.dur * 0.55));
      const e = 1 - (1 - m) * (1 - m);
      this.pos.lerpVectors(k.from, k.to, e);
      if (!k.hit && m >= 1) {
        k.hit = true;
        const r = (sk.radius || 6) * S + 1.5;
        A.fx.ring(this.pos, r, 0.5, TEAM_COL[this.team]);
        A.fx.burst(this.pos, { n: 18, speed: 6, up: 4, color: 0xd8c090 });
        A.aoe(this, this.pos, r, this.atkPower() * sk.power, { stun: sk.stun || 0.5, knock: sk.type === 'charge' ? 10 : 6, big: true }, null);
      }
    } else if (!k.hit && p >= 0.45) {
      k.hit = true;
      this.skillEffect(foes);
    }
    // 持续型技能（stomp 多波 / spin 多段）
    if (k.waves && k.t >= k.nextWave && k.wavesLeft > 0) {
      k.wavesLeft--; k.nextWave += 0.3;
      const r = (sk.radius || 8) * S;
      A.fx.ring(this.pos, r, 0.45, 0xffe080);
      A.aoe(this, this.pos, r, this.atkPower() * sk.power * (k.type === 'spin' ? 0.55 : 0.8), { knock: 3, stun: k.type === 'stomp' ? 0.4 : 0 }, null);
    }
    if (k.t >= k.dur) this.sk = null;
  }

  skillEffect(foes) {
    const A = this.arena, k = this.sk, sk = k.spec, ty = k.type;
    const pw = this.atkPower() * sk.power;
    const fwd = _a.set(Math.sin(this.heading), 0, Math.cos(this.heading)).clone();
    switch (ty) {
      case 'roar': {
        const r = (sk.radius || 12) * S;
        A.fx.ring(this.pos, r, 0.7, 0xffd060); A.fx.ring(this.pos, r * 0.6, 0.5, 0xffffff);
        A.aoe(this, this.pos, r, pw, { stun: (sk.stun || 2) * 0.7, knock: 7, big: true }, null);
        break;
      }
      case 'stomp':
      case 'spin': {
        k.waves = true; k.wavesLeft = (sk.waves || sk.hits || 3); k.nextWave = k.t; k.dur = Math.max(k.dur, k.t + k.wavesLeft * 0.3 + 0.2);
        break;
      }
      case 'spikes': {
        const r = 8;
        A.fx.ring(this.pos, r, 0.6, 0xe0e8ff); A.fx.burst(this.pos, { n: 30, speed: 9, up: 3, color: 0xe0e8ff });
        A.aoe(this, this.pos, r, pw * 2.2, { knock: 5 }, null);
        break;
      }
      case 'frenzy': this.buffs.frenzy = { t: sk.duration || 6, rate: sk.rateMul || 2, ls: sk.lifesteal || 0 }; A.fx.ring(this.pos, 5, 0.5, 0xff5030); break;
      case 'sprint': this.buffs.sprint = { t: sk.duration || 4, v: sk.speedMul || 1.7 }; A.fx.ring(this.pos, 5, 0.5, 0x80d0ff); break;
      case 'fortress': this.buffs.fortress = { t: sk.duration || 5, v: sk.reduce || 0.7, thorns: sk.thorns || 0.5 }; A.fx.ring(this.pos, 5, 0.5, 0xb0b8c8); break;
      case 'venom':
      case 'sonic':
      case 'wave': {
        const len = (ty === 'wave' ? (sk.range || 30) : (sk.range || 24)) * S;
        const half = ty === 'wave' ? 3.2 : Math.tan(((sk.angle || sk.spread || 55) * Math.PI / 180) / 2) * len * 0.5 + 1.5;
        const col = ty === 'venom' ? 0x8aff3a : ty === 'sonic' ? 0x7ad4ff : 0xffd0a0;
        for (let i = 0; i < 16; i++) A.fx.burst({ x: this.pos.x + fwd.x * (i * len / 16 + 1), y: 1.2, z: this.pos.z + fwd.z * (i * len / 16 + 1) }, { n: 3, speed: 2, up: 2, life: 0.6, color: col });
        A.fx.ring({ x: this.pos.x + fwd.x * len * 0.6, z: this.pos.z + fwd.z * len * 0.6 }, half * 1.2, 0.5, col);
        for (const f of foes) {
          if (f.dead) continue;
          _a.subVectors(f.pos, this.pos).setY(0);
          const along = _a.dot(fwd), side = Math.abs(_a.x * fwd.z - _a.z * fwd.x);
          if (along > -f.radius && along < len + f.radius && side < half + f.radius) {
            f.takeHit(pw * (ty === 'venom' ? 1.6 : 1.1), this, ty === 'venom' ? { poison: (sk.poison || 3) + 1, dps: this.atk * 0.5, big: true } : { knock: 5, big: true });
            if (ty === 'sonic') this.heal(this.maxHp * 0.04);
          }
        }
        break;
      }
      default: {
        A.aoe(this, this.pos, 8, pw, { knock: 4 }, 'ring');
      }
    }
  }

  meleeHit(foes) {
    const A = this.arena;
    const tg = this.target;
    if (!tg || tg.dead) return;
    if (this.pos.distanceTo(tg.pos) > this.range(tg) * 1.35) return;
    const dmg = this.atkPower() * (0.9 + Math.random() * 0.2);
    tg.takeHit(dmg, this, { knock: this.kind === 'boss' ? 3 : 1.5 });
    A.fx.burst({ x: tg.pos.x, y: 1.4, z: tg.pos.z }, { n: 8, speed: 4, up: 3, life: 0.4, color: 0xffd8a0 });
    if (this.kind === 'boss') {
      // 大首领的挥击带溅射
      for (const f of foes) if (f !== tg && !f.dead && f.pos.distanceTo(tg.pos) < 4) f.takeHit(dmg * 0.6, this, { knock: 3 });
    }
  }

  /** 首领专属：每隔一阵放一个大招式（范围砸地 + 招式动画） */
  bossThink(dt, foes) {
    if (this.kind !== 'boss' || this.dead) return;
    this.bossAnim = this.bossAnim ?? -1;
    if (this.bossAnim >= 0) {
      this.bossAnim += dt / 1.0;
      if (!this.bossHit && this.bossAnim >= 0.55) {
        this.bossHit = true;
        const r = this.info.def.radius * 2.6;
        this.arena.fx.ring(this.pos, r, 0.7, 0xff6a30);
        this.arena.fx.burst(this.pos, { n: 40, speed: 9, up: 5, color: 0xff9a50 });
        this.arena.shake(0.5);
        this.arena.aoe(this, this.pos, r, this.atk * 1.6, { stun: 0.9, knock: 9, big: true }, null);
      }
      if (this.bossAnim >= 1) { this.bossAnim = -1; this.bossPattern = null; }
      return;
    }
    this.bossCd -= dt;
    if (this.bossCd <= 0 && this.stun <= 0 && foes.some((f) => !f.dead && f.pos.distanceTo(this.pos) < this.info.def.radius * 2.8 + f.radius)) {
      const pats = this.info.def.patterns || [];
      this.bossPattern = pats[this.bossK++ % Math.max(1, pats.length)] || null;
      const animMap = this.info.def.anim || {};
      this.bossPattern = animMap[this.bossPattern] || this.bossPattern;
      this.bossAnim = 0; this.bossHit = false;
      this.bossCd = 6 + Math.random() * 3;
      this.arena.fx.ring(this.pos, this.info.def.radius * 2.6, 0.55, 0xff3030, 1, 0.42);
    }
  }

  dispose() {
    this.arena.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry && o.geometry.userData && o.geometry.userData.mergedGeo) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose && m.dispose());
      if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();
    });
  }
}

function turnTo(cur, target, step) {
  let d = ((target - cur + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return cur + clamp(d, -Math.abs(step), Math.abs(step));
}

// ---------------------------------------------------------------------
//  竞技场
// ---------------------------------------------------------------------
export class Arena {
  /** cfg = { mode: 'duel'|'team', control: null|'A'|'B', A: [{id, boost}], B: [...] } */
  constructor(app, cfg) {
    this.app = app;
    this.cfg = cfg;
    this.scene = app.scene;
    this.camera = app.camera;
    // 弯道着色器的全局参数默认不是 0（Vector4 的 w 默认 1），竞技场很宽，必须显式关掉弯曲，否则整个场景会被扭歪
    updateBend(0, 0);
    this.world = createWorld('colosseum', this.scene, { quality: app.quality });
    this.fx = new Fx(this.scene);
    this.floats = new FloatingText(app.fxLayer);
    this.fighters = [];
    this.teams = { A: [], B: [] };
    for (const team of ['A', 'B']) {
      const list = cfg[team].slice(0, cfg.mode === 'duel' ? 1 : TEAM_MAX);
      list.forEach((slot, i) => {
        const f = new Fighter(this, slot, team, i, list.length);
        this.fighters.push(f);
        this.teams[team].push(f);
      });
    }
    if (cfg.mode === 'duel' && cfg.control) this.teams[cfg.control][0].controlled = true;
    this.t = 0;
    this.time = 0;
    this.over = false; this.overT = 0;
    this.paused = false;
    this.shakeT = 0;
    this.camPos = new THREE.Vector3(0, 30, 44);
    this.camLook = new THREE.Vector3(0, 1.5, 0);
    this.oldFov = this.camera.fov;
    this.oldNear = this.camera.near; this.oldFar = this.camera.far;
    this.camera.fov = 50; this.camera.near = 0.5; this.camera.far = 700; this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.camPos);
    this.buildHud();
    input.releaseAll();
    this.touchLabels(true);
    this.banner(null, t('arena.fight'), 1400);
  }

  // ------------------------------------------------------------------
  buildHud() {
    const hud = document.createElement('div');
    hud.id = 'arena-hud';
    const card = (f) => `<div class="ar-card" data-f="${f.team}${this.fighters.indexOf(f)}">
        <div class="nm">${f.controlled ? '🎮 ' : ''}${f.name}</div>
        <div class="hp"><i></i></div>
        ${f.canAwaken || f.canUlt ? '<div class="fv"><i></i></div>' : ''}
      </div>`;
    hud.innerHTML = `
      <div class="ar-top">
        <div class="ar-team a"><b>${t('arena.teamA')}</b><div class="ar-cards">${this.teams.A.map(card).join('')}</div></div>
        <div class="ar-mid"><div class="ar-time">0:00</div><button class="btn ghost small ar-exit">${t('arena.exit')}</button></div>
        <div class="ar-team b"><b>${t('arena.teamB')}</b><div class="ar-cards">${this.teams.B.map(card).join('')}</div></div>
      </div>
      <div class="ar-msg"></div>
      <div class="ar-help">${this.cfg.mode === 'duel' && this.cfg.control ? t('arena.help') : t('arena.helpAi')}</div>
      <div class="ar-overlay"></div>`;
    document.body.appendChild(hud);
    this.hud = hud;
    this.elCards = {};
    hud.querySelectorAll('.ar-card').forEach((c) => { this.elCards[c.dataset.f] = { hp: c.querySelector('.hp i'), fv: c.querySelector('.fv i'), root: c }; });
    this.elTime = hud.querySelector('.ar-time');
    this.elMsg = hud.querySelector('.ar-msg');
    this.elOver = hud.querySelector('.ar-overlay');
    hud.querySelector('.ar-exit').addEventListener('click', () => this.togglePause(true));
  }

  touchLabels(on) {
    const root = document.getElementById('touch');
    if (!root) return;
    const set = (sel, text) => { const b = root.querySelector(sel + ' b'); if (b) b.textContent = text; };
    if (on) { set('.jump', t('arena.ultBtn')); set('.ult', t('arena.awakenBtn')); }
    else { set('.jump', t('touch.jump')); set('.ult', t('touch.ult')); }
  }

  togglePause(force) {
    if (this.over) return;
    this.paused = force === undefined ? !this.paused : force;
    this.elOver.innerHTML = this.paused ? `<div class="ar-box"><h2>${t('arena.paused')}</h2>
      <button class="btn" data-a="resume">${t('arena.resume')}</button>
      <button class="btn ghost" data-a="again">${t('arena.again')}</button>
      <button class="btn ghost" data-a="exit">${t('arena.back')}</button></div>` : '';
    this.bindOverlay();
  }

  bindOverlay() {
    this.elOver.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'resume') this.togglePause(false);
      else if (a === 'again') this.app.startArena(this.cfg);
      else this.app.exitArena();
    }));
  }

  banner(f, text, ms = 1600) {
    this.elMsg.textContent = text;
    this.elMsg.className = 'ar-msg show' + (f ? ' ' + f.team.toLowerCase() : '');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { this.elMsg.className = 'ar-msg'; }, ms);
  }

  shake(v) { this.shakeT = Math.max(this.shakeT, v); }

  // ------------------------------------------------------------------
  floatDmg(target, n, attackerTeam, big, kind) {
    const cls = (attackerTeam === 'A' ? 'arenaA' : 'arenaB') + (big ? ' big' : '') + (kind ? ' ' + kind : '');
    this.floats.add({ x: target.pos.x + (Math.random() - 0.5) * 1.2, y: (target.model.size.height || 2) * 0.9 * target.awakeScale, z: target.pos.z }, String(n), cls, big ? 1.1 : 0.85);
  }
  floatText(target, text, cls) {
    this.floats.add({ x: target.pos.x, y: (target.model.size.height || 2) + 0.5, z: target.pos.z }, text, cls, 1);
  }

  /** 圆形范围伤害：伤害 = 攻击方的敌人；返回命中数 */
  aoe(from, center, r, dmg, o = {}, ringKind) {
    let n = 0;
    const foes = this.teams[from.team === 'A' ? 'B' : 'A'];
    for (const f of foes) {
      if (f.dead) continue;
      const d = Math.hypot(f.pos.x - center.x, f.pos.z - center.z) - f.radius * 0.6;
      if (d <= r) { f.takeHit(dmg, from, o); n++; }
    }
    if (ringKind) this.fx.ring(center, r, 0.5, AWAKE_COL[from.team]);
    return n;
  }

  onDeath(f) {
    const alive = (team) => this.teams[team].some((x) => !x.dead);
    this.shake(0.4);
    if (!this.over && (!alive('A') || !alive('B'))) {
      this.over = true;
      this.winner = alive('A') ? 'A' : alive('B') ? 'B' : null;
      this.overT = 0;
    }
    void f;
  }

  finish() {
    const w = this.winner;
    this.elOver.innerHTML = `<div class="ar-box ${w ? w.toLowerCase() : ''}">
      <h2>${w ? t('arena.win', { team: t('arena.team' + w) }) : t('arena.draw')}</h2>
      <button class="btn" data-a="again">${t('arena.again')}</button>
      <button class="btn ghost" data-a="exit">${t('arena.back')}</button></div>`;
    this.bindOverlay();
    for (const f of this.fighters) if (!f.dead) f.root.rotation.y += 0;
  }

  // ------------------------------------------------------------------
  update(dt) {
    if (input.pressed('pause') && !this.over) this.togglePause();
    this.floats.update(this.paused ? 0 : dt, this.camera, window.innerWidth, window.innerHeight);
    if (!this.paused) {
      this.t += dt;
      if (!this.over) this.time += dt;
      for (const f of this.fighters) {
        const foes = this.teams[f.team === 'A' ? 'B' : 'A'];
        f.bossThink(dt, foes);
        f.update(dt, foes, this.teams[f.team]);
      }
      this.fx.update(dt);
      // 时间到：按剩余血量比例判胜负
      if (!this.over && this.time > 240) {
        const ratio = (team) => this.teams[team].reduce((s, x) => s + x.hp, 0) / this.teams[team].reduce((s, x) => s + x.maxHp, 0);
        const a = ratio('A'), b = ratio('B');
        this.over = true; this.winner = Math.abs(a - b) < 0.01 ? null : a > b ? 'A' : 'B';
      }
      if (this.over) { this.overT += dt; if (this.overT > 1.6 && !this.finished) { this.finished = true; this.finish(); } }
    }
    this.world.update(dt, this.t, this.camLook);
    this.updateCamera(dt);
    this.updateHud();
  }

  updateCamera(dt) {
    // 以所有活着的战士为中心，镜头固定从 +z 方向看向竞技场（A 在左、B 在右）
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, n = 0;
    const ctl = this.fighters.find((f) => f.controlled && !f.dead);
    for (const f of this.fighters) {
      if (f.dead) continue;
      minX = Math.min(minX, f.pos.x - f.radius); maxX = Math.max(maxX, f.pos.x + f.radius);
      minZ = Math.min(minZ, f.pos.z - f.radius); maxZ = Math.max(maxZ, f.pos.z + f.radius); n++;
    }
    if (!n) { minX = maxX = minZ = maxZ = 0; }
    let cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    if (ctl) { cx = cx * 0.5 + ctl.pos.x * 0.5; cz = cz * 0.5 + ctl.pos.z * 0.5; }
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const ext = Math.max((maxX - minX) / Math.max(0.7, aspect * 0.9), (maxZ - minZ) * 1.3);
    const dist = clamp(ext * 0.95 + 21, 28, 64) * (aspect < 1 ? 1.35 : 1);
    const want = _a.set(cx * 0.7, dist * 0.62, cz + dist * 0.92);
    this.camPos.x = damp(this.camPos.x, want.x, 2.2, dt);
    this.camPos.y = damp(this.camPos.y, want.y, 2.2, dt);
    this.camPos.z = damp(this.camPos.z, want.z, 2.2, dt);
    this.camLook.x = damp(this.camLook.x, cx, 3, dt);
    this.camLook.z = damp(this.camLook.z, cz, 3, dt);
    this.camLook.y = 1.5;
    this.camera.position.copy(this.camPos);
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt * 2);
      this.camera.position.x += (Math.random() - 0.5) * this.shakeT * 1.2;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeT * 1.2;
    }
    this.camera.lookAt(this.camLook);
  }

  updateHud() {
    this.elTime.textContent = `${Math.floor(this.time / 60)}:${String(Math.floor(this.time % 60)).padStart(2, '0')}`;
    this.fighters.forEach((f, i) => {
      const e = this.elCards[f.team + i];
      if (!e) return;
      const r = Math.max(0, f.hp / f.maxHp);
      e.hp.style.width = (r * 100).toFixed(1) + '%';
      if (e.fv) { e.fv.style.width = f.fever.toFixed(0) + '%'; e.fv.parentElement.classList.toggle('full', f.fever >= 100); }
      e.root.classList.toggle('dead', f.dead);
    });
  }

  dispose() {
    clearTimeout(this._bt);
    this.touchLabels(false);
    for (const f of this.fighters) f.dispose();
    this.fighters.length = 0;
    this.floats.clear();
    this.fx.dispose();
    this.world.dispose();
    this.hud.remove();
    this.camera.fov = this.oldFov || 60; this.camera.near = this.oldNear || 0.1; this.camera.far = this.oldFar || 1500; this.camera.updateProjectionMatrix();
    input.releaseAll();
  }
}
