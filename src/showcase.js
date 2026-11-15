// 菜单背景：在真实地形上展示当前坐骑与骑手，镜头缓慢环绕
import * as THREE from 'three';
import { DINOS, RIDERS, PET_RIDERS, PET_RULES, PETS, findDino, skinnedDef } from './data.js';
import { PetFeed } from './petfeed.js';
import { save } from './save.js';
import { createWorld } from './world.js';
import { createDinoModel } from './models/dinos.js';
import { createRiderModel } from './models/riders.js';
import { prepareModel, damp } from './util.js';

const _v = new THREE.Vector3();
const _look = new THREE.Vector3();
const _base = new THREE.Vector3();

export class Showcase {
  constructor(app, biome = 'jungle') {
    this.app = app;
    this.scene = app.scene;
    this.camera = app.camera;
    this.biome = biome;
    this.world = createWorld(biome, this.scene, { quality: app.quality });
    this.t = 0;
    this.orbit = 0.7;
    this.dragging = false;
    this.userSpin = 0;
    this.frame = 'right';
    this.frameK = -1;
    this.model = null;
    this.rider = null;
    this.actionT = 3;
    this.action = null;
    this.dist = 10;
    this.sc = 1;
    this.fx = [];
    this.feedScene = null;
    this.setSelection(app.saveRef.dino, app.saveRef.rider);

    const canvas = app.renderer.domElement;
    this._down = (e) => { if (app.mode !== 'menu') return; this.dragging = true; this.lastX = e.clientX; };
    this._move = (e) => {
      if (!this.dragging) return;
      this.orbit -= (e.clientX - this.lastX) * 0.008;
      this.lastX = e.clientX;
    };
    this._up = () => { this.dragging = false; };
    canvas.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
  }

  /** juvenile：宠物还是幼年体时缩小显示；noRider：宠物乐园里不带骑手 */
  setSelection(dinoId, riderId, celebrate = false, opts = {}) {
    const dDef = findDino(dinoId) || DINOS[0];
    const rDef = RIDERS.find((r) => r.id === riderId) || PET_RIDERS.find((r) => r.id === riderId) || RIDERS[0];
    this.clearFeed();
    this.clearFx();
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.root.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); });
    }
    this.def = dDef;
    this.isPet = PETS.some((p) => p.id === dDef.id);
    this.model = createDinoModel(skinnedDef(dDef, save.dinoSkin && save.dinoSkin[dDef.id]));
    this.rider = createRiderModel(rDef);
    this.rider.root.scale.setScalar(dDef.riderScale || 1);
    if (!opts.noRider) this.model.saddle.add(this.rider.root);
    if (opts.juvenile) this.model.root.scale.multiplyScalar(PET_RULES.juvenileScale);
    prepareModel(this.model.root, { cast: true });
    const y = this.world.heightAt(0, 0);
    this.model.root.position.set(0, y, 0);
    this.model.root.rotation.y = 0.5;
    this.scene.add(this.model.root);
    this.anim = { t: 0, move: 0, air: false, attack: -1, skill: -1, hurt: 0, dead: 0 };
    this.ranim = { t: 0, bounce: 0, shoot: -1, cheer: false, lean: 0 };
    const sc = opts.juvenile ? PET_RULES.juvenileScale : 1;
    this.sc = sc;
    this.targetDist = 6 + (this.model.size.height * 2.3 + this.model.size.length * 0.35) * sc;
    if (celebrate) { this.action = { kind: 'skill', t: 0, dur: 1.4 }; this.actionT = 5; }
  }

  setFrame(f) { this.frame = f; }

  /** 宠物乐园喂食：食物出现在宠物身边（活物会跑动，宠物去捕食） */
  feed(feedId, live) {
    this.clearFeed();
    this.action = null;
    this.feedScene = new PetFeed(this, feedId, live);
  }
  clearFeed() {
    if (!this.feedScene) return;
    this.feedScene.dispose();
    this.feedScene = null;
  }

  /** 地面上扩散的光环（大招 / 吃到猎物的小特效） */
  ring(x, y, z, color, r1, life = 0.8) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, this.world.heightAt(x, z) + 0.35, z);
    this.scene.add(m);
    this.fx.push({ m, t: 0, life, r1 });
  }
  clearFx() {
    for (const f of this.fx) { this.scene.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); }
    this.fx = [];
  }
  updateFx(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) { this.scene.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); this.fx.splice(i, 1); continue; }
      f.m.scale.setScalar(0.5 + (f.r1 - 0.5) * (1 - (1 - k) * (1 - k)));
      f.m.material.opacity = 0.8 * (1 - k);
    }
  }

  /** 宠物平时的「炫耀」：放出自己专属的大招（动作 + 光环 + 位移） */
  showoff(dt) {
    const a = this.action;
    const type = this.def.skill ? this.def.skill.type : '';
    const root = this.model.root;
    const k = Math.min(1, a.t / a.dur);
    const col = this.def.colors.extra || 0xffffff;
    const p = root.position;
    this.anim.skill = k;
    const gy = this.world.heightAt(p.x, p.z);
    if (!a.init) {
      a.init = true; a.yaw = root.rotation.y;
      if (type === 'roar') this.app.audio.roar(this.def.scale);
    }
    if (type === 'pounce') {
      const j = Math.min(1, Math.max(0, (k - 0.15) / 0.55));
      p.y = gy + Math.sin(j * Math.PI) * 3.4;
      this.anim.air = j > 0 && j < 1;
      if (j >= 1 && !a.landed) { a.landed = true; this.ring(p.x, 0, p.z, col, 9, 0.7); this.app.audio.play('stomp', { volume: 0.5 }); }
    } else if (type === 'spin') {
      const e = Math.min(1, Math.max(0, (k - 0.1) / 0.8));
      root.rotation.y = a.yaw + (e * e * (3 - 2 * e)) * Math.PI * 4;
      if (a.ringN === undefined) a.ringN = 0;
      if (k > 0.25 + a.ringN * 0.2 && a.ringN < 3) { a.ringN++; this.ring(p.x, 0, p.z, col, 8, 0.6); }
    } else if (type === 'roar') {
      if (a.ringN === undefined) a.ringN = 0;
      if (k > 0.2 + a.ringN * 0.18 && a.ringN < 3) { a.ringN++; this.ring(p.x, 0, p.z, col, 12, 0.9); }
    } else if (type === 'frenzy') {
      this.anim.attack = (k * 5) % 1;
      if (a.ringN === undefined) a.ringN = 0;
      if (k > 0.1 + a.ringN * 0.3 && a.ringN < 3) { a.ringN++; this.ring(p.x, 0, p.z, col, 6, 0.7); }
    } else if (k > 0.3 && !a.ringN) { a.ringN = 1; this.ring(p.x, 0, p.z, col, 8, 0.8); }
    if (k >= 1) { root.rotation.y = a.yaw; p.y = gy; this.anim.air = false; }
  }

  update(dt) {
    this.t += dt;
    if (!this.dragging) this.orbit += dt * 0.12;
    this.anim.t += dt; this.ranim.t += dt;

    // 周期性小动作：攻击 / 技能 / 骑手射击 / 欢呼
    this.updateFx(dt);
    if (this.feedScene) {
      this.feedScene.update(dt);
      if (this.feedScene.done) this.feedScene = null;
      this.actionT = 2.5;
    }
    this.actionT -= dt;
    if (this.actionT <= 0 && !this.action && !this.feedScene) {
      const r = Math.random();
      if (this.isPet && r < 0.6) this.action = { kind: 'skill', t: 0, dur: this.def.skill && this.def.skill.type === 'frenzy' ? 2.2 : 1.6, show: true };
      else this.action = r < 0.35 ? { kind: 'attack', t: 0, dur: 0.7 } : r < 0.6 ? { kind: 'shoot', t: 0, dur: 0.4 } : r < 0.8 ? { kind: 'cheer', t: 0, dur: 1.6 } : { kind: 'skill', t: 0, dur: 1.4 };
      this.actionT = 3 + Math.random() * 3;
    }
    if (!this.feedScene) { this.anim.attack = -1; this.anim.move = 0; }
    this.anim.skill = -1; this.ranim.shoot = -1; this.ranim.cheer = false;
    if (this.action) {
      const a = this.action;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      if (a.kind === 'attack') this.anim.attack = k;
      else if (a.kind === 'skill') { if (a.show) this.showoff(dt); else this.anim.skill = k; }
      else if (a.kind === 'shoot') this.ranim.shoot = k;
      else if (a.kind === 'cheer') this.ranim.cheer = true;
      if (k >= 1) this.action = null;
    }
    this.model.update(dt, this.anim);
    this.rider.update(dt, this.ranim);

    // 镜头
    const size = this.model.size;
    this.dist = damp(this.dist, this.targetDist, 3, dt);
    // 视线中心向反方向偏移，模型就出现在画面指定一侧
    const fk = this.frame === 'right' ? -1 : this.frame === 'left' ? 1 : 0;
    this.frameK = damp(this.frameK, fk, 3, dt);
    const rp = this.model.root.position;
    const base = _base.set(rp.x, this.world.heightAt(rp.x, rp.z), rp.z);
    const a = this.orbit;
    const h = size.height;
    const d = this.dist;
    _v.set(base.x + Math.sin(a) * d, base.y + h * 0.9 + 1.6, base.z + Math.cos(a) * d);
    const gy = this.world.heightAt(_v.x, _v.z) + 1;
    if (_v.y < gy) _v.y = gy;
    // 横向偏移让模型出现在画面一侧
    const rx = Math.cos(a), rz = -Math.sin(a);
    const off = this.frameK * d * 0.3;
    _look.set(base.x + rx * off, base.y + h * 0.65, base.z + rz * off);
    this.camera.position.copy(_v).addScaledVector(_v.set(rx, 0, rz), off);
    this.camera.lookAt(_look);
    if (Math.abs(this.camera.fov - 50) > 0.01) { this.camera.fov = 50; this.camera.updateProjectionMatrix(); }
    this.world.update(dt, this.t, base);
  }

  dispose() {
    const canvas = this.app.renderer.domElement;
    canvas.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    this.clearFeed();
    this.clearFx();
    if (this.model) this.scene.remove(this.model.root);
    this.world.dispose();
  }
}
