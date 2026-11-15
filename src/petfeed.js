// 宠物乐园的喂食演出：食物出现在宠物身边。
//   活物（绵羊 / 水牛）：先在草地上溜达一会儿，然后宠物追上去把它捕食掉
//   雷霆棘龙的鱼：装在水桶里扑腾，棘龙把头伸过去从桶里叼走
//   树枝 / 灌木：堆在宠物脚边，宠物低头啃光
import * as THREE from 'three';

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...o });
const mesh = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; return o; };
const ico = (r, m, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), m); o.scale.set(sx, sy, sz); o.castShadow = true; return o; };

/** 四条腿的小动物：legs 里的腿会随走路摆动 */
function animal({ body, head, horn, size, wool }) {
  const g = new THREE.Group();
  const legs = [];
  const bm = mat(body), hm = mat(head);
  const torso = ico(0.5, wool ? mat(wool) : bm, 1, 0.85, 1.45);
  torso.position.y = 0.85;
  g.add(torso);
  if (size > 1.3) { const hump = ico(0.4, bm, 1, 0.8, 1); hump.position.set(0, 1.25, 0.35); g.add(hump); }
  const neck = mesh(new THREE.BoxGeometry(0.3, 0.4, 0.4), hm, 0, 1.0, 0.75);
  neck.rotation.x = 0.5;
  g.add(neck);
  g.add(mesh(new THREE.BoxGeometry(0.34, 0.34, 0.5), hm, 0, 1.05, 1.05));
  if (horn) for (const s of [-1, 1]) {
    const h = mesh(new THREE.ConeGeometry(0.07, 0.45, 5), mat(0xeadfc0), s * 0.22, 1.3, 1.0);
    h.rotation.z = -s * 1.1;
    g.add(h);
  }
  for (const [x, z] of [[-0.28, 0.55], [0.28, 0.55], [-0.28, -0.5], [0.28, -0.5]]) {
    const leg = new THREE.Group();
    leg.position.set(x, 0.6, z);
    leg.add(mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.6, 5), hm, 0, -0.3, 0));
    g.add(leg);
    legs.push(leg);
  }
  g.scale.setScalar(size);
  g.userData.legs = legs;
  return g;
}

function makeSheep() { return animal({ body: 0xf4f0e6, head: 0x3a3030, size: 1.1, wool: 0xf4f0e6 }); }
function makeBuffalo() { return animal({ body: 0x5a3a24, head: 0x2e2018, size: 1.7, horn: true }); }

function makeFish() {
  const g = new THREE.Group();
  const m = mat(0xf08a3a, { roughness: 0.5 });
  g.add(ico(0.32, m, 2.0, 0.8, 0.6));
  const tail = mesh(new THREE.ConeGeometry(0.25, 0.4, 4), m, -0.72, 0, 0);
  tail.rotation.z = Math.PI / 2;
  g.add(tail);
  g.add(mesh(new THREE.SphereGeometry(0.05, 6, 4), mat(0x101010), 0.45, 0.08, 0.15));
  g.scale.setScalar(1.5);
  return g;
}

function makeBucket() {
  const g = new THREE.Group();
  const wall = mesh(new THREE.CylinderGeometry(0.75, 0.55, 1.0, 12, 1, true), mat(0x8a96a4, { metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide }), 0, 0.5, 0);
  g.add(wall);
  g.add(mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 12), mat(0x6a7684), 0, 0.03, 0));
  const water = mesh(new THREE.CylinderGeometry(0.7, 0.66, 0.04, 12), mat(0x3a9ad8, { transparent: true, opacity: 0.8, roughness: 0.2 }), 0, 0.78, 0);
  water.castShadow = false;
  g.add(water);
  const rim = mesh(new THREE.TorusGeometry(0.75, 0.04, 5, 14), mat(0x5a6674), 0, 1.0, 0);
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  g.scale.setScalar(1.5);
  return g;
}

function makeBranch() {
  const g = new THREE.Group();
  const wood = mat(0x7a5230), leaf = mat(0x5aa83a);
  for (let i = 0; i < 4; i++) {
    const b = mesh(new THREE.CylinderGeometry(0.05, 0.08, 2.2, 5), wood, 0, 0.18 + i * 0.06, 0);
    b.rotation.set(Math.PI / 2 - 0.08 * i, (i - 1.5) * 0.45, 0.1 * i);
    g.add(b);
    const lf = ico(0.35, leaf, 1.3, 0.6, 1.3);
    lf.position.set((i - 1.5) * 0.5, 0.35 + i * 0.05, 0.8 - i * 0.3);
    g.add(lf);
  }
  return g;
}

function makeShrub() {
  const g = new THREE.Group();
  const cols = [0x2f7a34, 0x3d8f3a, 0x4aa044];
  [[0, 0.7, 0, 0.8], [0.6, 0.5, 0.3, 0.55], [-0.55, 0.5, -0.2, 0.6], [0.1, 0.5, -0.6, 0.5]].forEach(([x, y, z, r], i) => {
    const o = ico(r, mat(cols[i % 3]));
    o.position.set(x, y, z);
    g.add(o);
  });
  return g;
}

const MAKERS = { sheep: makeSheep, buffalo: makeBuffalo, fish: makeFish, branch: makeBranch, shrub: makeShrub };
const SPEED = { sheep: 2.6, buffalo: 1.8 };
const rnd = (a, b) => a + Math.random() * (b - a);
const turnTo = (cur, target, k) => {
  let d = ((target - cur + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return cur + d * Math.min(1, k);
};

export class PetFeed {
  /** sc = Showcase；feedId = 'sheep' | 'fish' | 'buffalo' | 'branch' | 'shrub' */
  constructor(sc, feedId, live) {
    this.sc = sc;
    this.feedId = feedId;
    this.live = live;
    this.done = false;
    this.t = 0;
    this.phase = 'start';
    this.objs = [];
    const root = sc.model.root;
    this.home = root.position.clone();
    this.homeYaw = root.rotation.y;
    const sz = sc.model.size;
    this.len = sz.length * sc.sc;
    this.rad = Math.max(1.2, sz.radius * sc.sc);
    // 宠物朝向 / 右手边（正对着镜头方向的左右两侧都行）
    const yaw = this.homeYaw;
    this.fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    if (live && feedId !== 'fish') this.setupPrey();
    else if (feedId === 'fish') this.setupBucket();
    else this.setupPile();
  }

  place(o, x, z) { o.position.set(x, this.sc.world.heightAt(x, z), z); }
  add(o) { this.sc.scene.add(o); this.objs.push(o); return o; }

  setupPrey() {
    const o = this.add(MAKERS[this.feedId]());
    this.prey = o;
    const p = this.home.clone().addScaledVector(this.side, this.rad + 2.5).addScaledVector(this.fwd, this.len * 0.3);
    this.place(o, p.x, p.z);
    o.userData.yaw = Math.atan2(-this.side.x, -this.side.z);
    o.userData.goal = null;
    o.userData.wait = 0;
    o.userData.speed = SPEED[this.feedId];
    this.phase = 'wander';
    this.phaseT = 0;
  }

  setupBucket() {
    const b = this.add(makeBucket());
    const p = this.home.clone().addScaledVector(this.fwd, this.len * 0.5 + 1.8).addScaledVector(this.side, 0.6);
    this.place(b, p.x, p.z);
    this.bucket = b;
    const f = makeFish();
    f.position.set(0, 0.9, 0);
    b.add(f);
    this.fish = f;
    this.phase = 'wiggle';
    this.phaseT = 0;
  }

  setupPile() {
    const o = this.add(MAKERS[this.feedId]());
    const p = this.home.clone().addScaledVector(this.fwd, this.len * 0.5 + 1.2).addScaledVector(this.side, 0.8);
    this.place(o, p.x, p.z);
    o.rotation.y = rnd(0, 6);
    this.pile = o;
    this.phase = 'graze';
    this.phaseT = 0;
  }

  walkLegs(o, dt, moving) {
    const legs = o.userData.legs;
    if (!legs) return;
    o.userData.ph = (o.userData.ph || 0) + dt * 9 * (moving ? 1 : 0);
    legs.forEach((l, i) => { l.rotation.x = Math.sin(o.userData.ph + (i % 2 ? Math.PI : 0) + (i > 1 ? 1.5 : 0)) * 0.5 * (moving ? 1 : 0); });
  }

  setPhase(p) { this.phase = p; this.phaseT = 0; }

  puff(pos) {
    this.sc.ring(pos.x, pos.y, pos.z, 0xfff0b0, 2.4, 0.4);
  }

  update(dt) {
    const sc = this.sc;
    const root = sc.model.root;
    const a = sc.anim;
    this.t += dt;
    this.phaseT += dt;
    a.move = 0; a.attack = -1;
    const mouthAt = () => sc.model.mouth.getWorldPosition(new THREE.Vector3());
    const faceTo = (x, z, k = 6) => { root.rotation.y = turnTo(root.rotation.y, Math.atan2(x - root.position.x, z - root.position.z), k * dt); };

    if (this.phase === 'wander' || this.phase === 'hunt' || this.phase === 'strike') {
      const o = this.prey;
      const u = o.userData;
      if (!u.eaten) {
        // 活物在草地上乱走（猎杀阶段慢一点，像是被吓得发愣）
        const sp = this.phase === 'wander' ? u.speed : u.speed * 0.45;
        u.wait -= dt;
        if (!u.goal || Math.hypot(u.goal.x - o.position.x, u.goal.z - o.position.z) < 0.5) {
          if (u.wait <= 0 && u.goal) { u.goal = null; u.wait = rnd(0.2, 0.7); }
          if (!u.goal && u.wait <= 0) {
            const ang = rnd(0, Math.PI * 2), r = rnd(2.5, 6.5);
            u.goal = { x: this.home.x + Math.cos(ang) * r, z: this.home.z + Math.sin(ang) * r };
          }
        }
        let moving = false;
        if (u.goal && this.phase !== 'strike') {
          const dx = u.goal.x - o.position.x, dz = u.goal.z - o.position.z;
          u.yaw = turnTo(u.yaw, Math.atan2(dx, dz), 5 * dt);
          const nx = o.position.x + Math.sin(u.yaw) * sp * dt, nz = o.position.z + Math.cos(u.yaw) * sp * dt;
          this.place(o, nx, nz);
          moving = true;
        }
        o.rotation.y = u.yaw;
        this.walkLegs(o, dt, moving);
        o.position.y += moving ? Math.abs(Math.sin(u.ph || 0)) * 0.08 : 0;
      }
    }

    switch (this.phase) {
      case 'wander':
        if (this.phaseT > 4) this.setPhase('hunt');
        break;
      case 'hunt': {
        const o = this.prey;
        const dx = o.position.x - root.position.x, dz = o.position.z - root.position.z;
        const d = Math.hypot(dx, dz);
        faceTo(o.position.x, o.position.z, 8);
        const reach = this.rad + 1.3;
        if (d > reach) {
          const sp = Math.min(8.5 * dt, d - reach + 0.01);
          root.position.x += dx / d * sp; root.position.z += dz / d * sp;
          root.position.y = sc.world.heightAt(root.position.x, root.position.z);
          a.move = 1;
        } else this.setPhase('strike');
        if (this.phaseT > 6) this.setPhase('strike');
        break;
      }
      case 'strike': {
        const o = this.prey;
        faceTo(o.position.x, o.position.z, 10);
        const k = Math.min(1, this.phaseT / 0.85);
        a.attack = k;
        if (k > 0.5 && !o.userData.eaten) {
          o.userData.eaten = true;
          const p = o.position.clone(); p.y += 0.8;
          this.puff(p);
          sc.app.audio.play(this.feedId === 'buffalo' ? 'bite' : 'enemyHurt', { volume: 0.4 });
          o.visible = false;
        }
        if (this.phaseT > 1.5) this.setPhase('return');
        break;
      }
      case 'return': {
        const dx = this.home.x - root.position.x, dz = this.home.z - root.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.15) {
          faceTo(this.home.x, this.home.z, 6);
          const sp = Math.min(6 * dt, d);
          root.position.x += dx / d * sp; root.position.z += dz / d * sp;
          root.position.y = sc.world.heightAt(root.position.x, root.position.z);
          a.move = 0.8;
        } else {
          root.position.copy(this.home);
          root.rotation.y = turnTo(root.rotation.y, this.homeYaw, 6 * dt);
          if (Math.abs(root.rotation.y - this.homeYaw) < 0.03) this.finish();
        }
        break;
      }
      case 'wiggle': {
        // 鱼在桶里蹦跳
        const f = this.fish;
        const k = this.t * 7;
        f.position.set(Math.sin(k * 0.6) * 0.25, 0.95 + Math.abs(Math.sin(k)) * 0.45, Math.cos(k * 0.5) * 0.2);
        f.rotation.set(0, k * 0.4, Math.sin(k) * 0.8);
        faceTo(this.bucket.position.x, this.bucket.position.z, 4);
        if (this.phaseT > 2.4) this.setPhase('grab');
        break;
      }
      case 'grab': {
        // 棘龙把头探向水桶，在咬合的瞬间把鱼从桶里叼走
        const f = this.fish;
        faceTo(this.bucket.position.x, this.bucket.position.z, 10);
        const k = Math.min(1, this.phaseT / 0.9);
        a.attack = k;
        if (k < 0.5) {
          f.position.set(Math.sin(this.t * 9) * 0.2, 0.95 + Math.abs(Math.sin(this.t * 9)) * 0.5, 0);
        } else if (!this.grabbed) {
          this.grabbed = true;
          this.bucket.remove(f);
          this.add(f);
          f.userData.from = new THREE.Vector3();
          this.bucket.getWorldPosition(f.userData.from); f.userData.from.y += 1.2;
          f.rotation.set(0, 0, 0);
          sc.app.audio.play('bite', { volume: 0.4 });
        }
        if (this.grabbed) {
          const kk = Math.min(1, (k - 0.5) / 0.5);
          f.position.lerpVectors(f.userData.from, mouthAt(), kk);
          f.position.y += Math.sin(kk * Math.PI) * 0.8;
          f.rotation.z = kk * 2.5;
          if (kk >= 1) f.visible = false;
        }
        if (this.phaseT > 1.5) this.setPhase('chew');
        break;
      }
      case 'chew': {
        // 水桶留一会儿，再收走
        if (this.phaseT > 1.4) this.finish();
        break;
      }
      case 'graze': {
        // 低头啃：连续几口，食物一点点变小
        const p = this.pile;
        faceTo(p.position.x, p.position.z, 6);
        a.attack = (this.phaseT * 1.25) % 1;
        const s = Math.max(0.02, 1 - this.phaseT / 3.6);
        p.scale.setScalar(s);
        if (this.phaseT > 3.6) { p.visible = false; this.finish(); }
        break;
      }
      default: break;
    }
  }

  finish() {
    this.done = true;
    this.dispose();
    const root = this.sc.model.root;
    root.position.copy(this.home);
    root.rotation.y = this.homeYaw;
    this.sc.anim.move = 0; this.sc.anim.attack = -1;
  }

  dispose() {
    for (const o of this.objs) {
      this.sc.scene.remove(o);
      o.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
    }
    this.objs = [];
  }
}
