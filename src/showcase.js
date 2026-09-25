// 菜单背景：在真实地形上展示当前坐骑与骑手，镜头缓慢环绕
import * as THREE from 'three';
import { DINOS, RIDERS } from './data.js';
import { createWorld } from './world.js';
import { createDinoModel } from './models/dinos.js';
import { createRiderModel } from './models/riders.js';
import { prepareModel, damp } from './util.js';

const _v = new THREE.Vector3();
const _look = new THREE.Vector3();

export class Showcase {
  constructor(app, biome = 'jungle') {
    this.app = app;
    this.scene = app.scene;
    this.camera = app.camera;
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

  setSelection(dinoId, riderId, celebrate = false) {
    const dDef = DINOS.find((d) => d.id === dinoId) || DINOS[0];
    const rDef = RIDERS.find((r) => r.id === riderId) || RIDERS[0];
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.root.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); });
    }
    this.def = dDef;
    this.model = createDinoModel(dDef);
    this.rider = createRiderModel(rDef);
    this.rider.root.scale.setScalar(dDef.riderScale || 1);
    this.model.saddle.add(this.rider.root);
    prepareModel(this.model.root, { cast: true });
    const y = this.world.heightAt(0, 0);
    this.model.root.position.set(0, y, 0);
    this.model.root.rotation.y = 0.5;
    this.scene.add(this.model.root);
    this.anim = { t: 0, move: 0, air: false, attack: -1, skill: -1, hurt: 0, dead: 0 };
    this.ranim = { t: 0, bounce: 0, shoot: -1, cheer: false, lean: 0 };
    this.targetDist = 6 + this.model.size.height * 2.3 + this.model.size.length * 0.35;
    if (celebrate) { this.action = { kind: 'skill', t: 0, dur: 1.4 }; this.actionT = 5; }
  }

  setFrame(f) { this.frame = f; }

  update(dt) {
    this.t += dt;
    if (!this.dragging) this.orbit += dt * 0.12;
    this.anim.t += dt; this.ranim.t += dt;

    // 周期性小动作：攻击 / 技能 / 骑手射击 / 欢呼
    this.actionT -= dt;
    if (this.actionT <= 0 && !this.action) {
      const r = Math.random();
      this.action = r < 0.35 ? { kind: 'attack', t: 0, dur: 0.7 } : r < 0.6 ? { kind: 'shoot', t: 0, dur: 0.4 } : r < 0.8 ? { kind: 'cheer', t: 0, dur: 1.6 } : { kind: 'skill', t: 0, dur: 1.4 };
      this.actionT = 3 + Math.random() * 3;
    }
    this.anim.attack = -1; this.anim.skill = -1; this.ranim.shoot = -1; this.ranim.cheer = false;
    if (this.action) {
      const a = this.action;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      if (a.kind === 'attack') this.anim.attack = k;
      else if (a.kind === 'skill') this.anim.skill = k;
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
    const base = this.model.root.position;
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
    if (this.model) this.scene.remove(this.model.root);
    this.world.dispose();
  }
}
