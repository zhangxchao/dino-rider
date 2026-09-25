// 弹道系统：骑手武器 / 恐龙技能弹 / 怪物与首领弹幕
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();

// ---------------------------------------------------------------------
//  外观
// ---------------------------------------------------------------------
const geoCache = {};
const matCache = {};
const G = (k, f) => geoCache[k] || (geoCache[k] = f());

function glow(color, boost = 2.5, opts = {}) {
  const key = `g${color}_${boost}_${opts.additive ? 1 : 0}_${opts.opacity ?? 1}`;
  if (matCache[key]) return matCache[key];
  const m = new THREE.MeshBasicMaterial({
    color, transparent: !!opts.additive || (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !opts.additive, side: opts.side ?? THREE.FrontSide,
  });
  m.color.multiplyScalar(boost);
  return (matCache[key] = m);
}
function solid(color, rough = 0.8, metal = 0) {
  const key = `s${color}_${rough}_${metal}`;
  return matCache[key] || (matCache[key] = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true }));
}
const alongZ = (g) => g.rotateX(Math.PI / 2);

const MAKERS = {
  spear: () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(G('spearShaft', () => alongZ(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6))), glow(0xffe8a0, 1.6)));
    const tip = new THREE.Mesh(G('spearTip', () => alongZ(new THREE.ConeGeometry(0.16, 0.55, 6)).translate(0, 0, 1.35)), glow(0xffe27a, 3));
    g.add(tip);
    return g;
  },
  arrow: (c = 0x9cff7a) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(G('arrowShaft', () => alongZ(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 5))), glow(c, 1.8)));
    g.add(new THREE.Mesh(G('arrowTip', () => alongZ(new THREE.ConeGeometry(0.09, 0.28, 5)).translate(0, 0, 0.75)), glow(c, 3)));
    g.add(new THREE.Mesh(G('arrowFl', () => new THREE.BoxGeometry(0.02, 0.18, 0.3).translate(0, 0, -0.55)), glow(0xffffff, 1.2)));
    return g;
  },
  earrow: () => MAKERS.arrow(0xe8e0d0),
  fireball: () => new THREE.Mesh(G('fireball', () => new THREE.IcosahedronGeometry(0.5, 1)), glow(0xff8a3a, 3.5)),
  laser: () => new THREE.Mesh(G('laser', () => alongZ(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 6))), glow(0x46e0ff, 4.5)),
  bullet: () => new THREE.Mesh(G('bullet', () => new THREE.SphereGeometry(0.14, 8, 6).scale(1, 1, 2.8)), glow(0xffd070, 3.5)),
  shuriken: () => {
    const shape = new THREE.Shape();
    const pts = 8;
    for (let i = 0; i < pts; i++) {
      const r = i % 2 === 0 ? 0.55 : 0.14;
      const a = (i / pts) * Math.PI * 2;
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const geo = G('shuriken', () => new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false }).rotateX(Math.PI / 2));
    return new THREE.Mesh(geo, glow(0xd0d8ff, 1.8, { side: THREE.DoubleSide }));
  },
  missile: () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(G('msBody', () => alongZ(new THREE.CylinderGeometry(0.13, 0.13, 0.9, 8))), solid(0xf0f0f0, 0.4, 0.3)));
    g.add(new THREE.Mesh(G('msNose', () => alongZ(new THREE.ConeGeometry(0.13, 0.35, 8)).translate(0, 0, 0.62)), glow(0xff4a3a, 1.6)));
    g.add(new THREE.Mesh(G('msFin', () => new THREE.BoxGeometry(0.5, 0.04, 0.2).translate(0, 0, -0.35)), solid(0xe04a3a)));
    g.add(new THREE.Mesh(G('msFin2', () => new THREE.BoxGeometry(0.04, 0.5, 0.2).translate(0, 0, -0.35)), solid(0xe04a3a)));
    g.add(new THREE.Mesh(G('msFlame', () => new THREE.SphereGeometry(0.16, 8, 6).scale(1, 1, 2).translate(0, 0, -0.62)), glow(0xffa030, 4)));
    return g;
  },
  ice: () => new THREE.Mesh(G('ice', () => new THREE.OctahedronGeometry(0.38, 0).scale(0.6, 0.6, 1.7)), glow(0xaee6ff, 2.4)),
  rock: () => new THREE.Mesh(G('rock', () => new THREE.DodecahedronGeometry(0.6, 0)), solid(0x8a7a6a, 0.95)),
  cannon: () => new THREE.Mesh(G('cannon', () => new THREE.SphereGeometry(0.45, 12, 10)), solid(0x26262c, 0.3, 0.8)),
  venom: () => new THREE.Mesh(G('venom', () => new THREE.IcosahedronGeometry(0.38, 1)), glow(0x9cff3a, 2.8)),
  spike: () => new THREE.Mesh(G('spike', () => alongZ(new THREE.ConeGeometry(0.16, 1.4, 6))), glow(0xf6ecd0, 1.4)),
  wave: (c, w = 5) => new THREE.Mesh(
    G('wave' + w, () => new THREE.TorusGeometry(w / 2, 0.22, 6, 36, Math.PI).rotateX(Math.PI / 2).scale(1, 3, 0.55)),
    glow(0xcff4ff, 2.2, { additive: true, opacity: 0.85, side: THREE.DoubleSide })),
  spore: () => new THREE.Mesh(G('spore', () => new THREE.IcosahedronGeometry(0.36, 0)), glow(0xb070ff, 2.6)),
  orb: (c = 0x7affd0) => new THREE.Mesh(G('orb', () => new THREE.SphereGeometry(0.42, 12, 10)), glow(c, 3)),
  efire: () => new THREE.Mesh(G('efire', () => new THREE.IcosahedronGeometry(0.42, 1)), glow(0xff6a1a, 3.2)),
  borb: (c = 0xff4a4a) => new THREE.Mesh(G('borb', () => new THREE.IcosahedronGeometry(0.62, 1)), glow(c, 2.1)),
  meteor: () => new THREE.Mesh(G('meteor', () => new THREE.IcosahedronGeometry(1.4, 1)), glow(0xff7a2a, 3.2)),
};

// 拖尾粒子
const TRAILS = {
  spear: { color: 0xffe27a, size: 0.35, life: 0.25, rate: 70 },
  arrow: { color: 0x9cff7a, size: 0.22, life: 0.2, rate: 45 },
  earrow: { color: 0xffffff, size: 0.15, life: 0.15, rate: 25 },
  fireball: { color: 0xffb040, color2: 0xff2000, size: 1.0, life: 0.35, rate: 90, spread: 0.6 },
  bullet: { color: 0xffd070, size: 0.18, life: 0.12, rate: 50 },
  shuriken: { color: 0xc0c8ff, size: 0.25, life: 0.15, rate: 35 },
  missile: { color: 0xdddddd, color2: 0x888888, size: 0.5, sizeEnd: 1.4, life: 0.7, rate: 50, smoke: true },
  ice: { color: 0xaaddff, size: 0.35, life: 0.35, rate: 45 },
  cannon: { color: 0xffa040, size: 0.3, life: 0.25, rate: 35 },
  venom: { color: 0x9cff3a, size: 0.45, life: 0.3, rate: 55, drop: 6 },
  wave: { color: 0xcff4ff, size: 1.4, life: 0.35, rate: 70, spread: 2 },
  spore: { color: 0xb070ff, size: 0.4, life: 0.4, rate: 30 },
  orb: { size: 0.5, life: 0.3, rate: 40 },
  efire: { color: 0xffa040, color2: 0xff2000, size: 0.7, life: 0.3, rate: 60 },
  borb: { size: 0.55, life: 0.25, rate: 30 },
  meteor: { color: 0xffc040, color2: 0xff2000, size: 2.2, life: 0.5, rate: 120, spread: 1.2 },
  spike: { color: 0xf6ecd0, size: 0.2, life: 0.15, rate: 20 },
};

// ---------------------------------------------------------------------
//  系统
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
//  实例化批次：同一种弹体的每个零件共用一个 InstancedMesh（一次 draw call）
// ---------------------------------------------------------------------
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _sc = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

class Batch {
  constructor(scene, template, cap = 400) {
    this.cap = cap;
    this.n = 0;
    this.layers = [];
    template.updateMatrixWorld(true);
    template.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const im = new THREE.InstancedMesh(g, o.material, cap);
      im.frustumCulled = false;
      im.count = 0;
      im.renderOrder = o.renderOrder;
      scene.add(im);
      this.layers.push(im);
    });
  }
  begin() { this.n = 0; }
  add(m) {
    if (this.n >= this.cap) return;
    for (const im of this.layers) im.setMatrixAt(this.n, m);
    this.n++;
  }
  end() {
    for (const im of this.layers) { im.count = this.n; im.instanceMatrix.needsUpdate = true; }
  }
  dispose() {
    for (const im of this.layers) { im.parent && im.parent.remove(im); im.geometry.dispose(); }
  }
}

export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.batches = new Map();
  }

  _batch(kind, color, extra) {
    const key = kind + (color ?? '') + '|' + (extra ?? '');
    let b = this.batches.get(key);
    if (!b) {
      b = new Batch(this.game.scene, MAKERS[kind](color, extra));
      this.batches.set(key, b);
    }
    return b;
  }

  /** 预先创建常用批次（配合着色器预编译，避免第一次开火卡顿） */
  warm(kinds) {
    for (const [k, c, e] of kinds) this._batch(k, c, e);
  }

  _render() {
    for (const b of this.batches.values()) b.begin();
    for (const p of this.list) {
      _sc.setScalar(p.scale);
      if (p.kind === 'shuriken') _q.setFromEuler(_e.set(0, p.spinT, 0));
      else if (p.kind === 'rock' || p.kind === 'cannon') _q.setFromEuler(_e.set(p.spinT, p.spinT * 0.7, 0));
      else {
        _v.copy(p.pos).add(p.vel);
        _m.lookAt(_v, p.pos, UP);
        _q.setFromRotationMatrix(_m);
      }
      _m.compose(p.pos, _q, _sc);
      p.batch.add(_m);
    }
    for (const b of this.batches.values()) b.end();
  }

  /**
   * o: { kind, owner:'player'|'enemy', pos, dir, speed, dmg, radius, life, pierce, bounce, homing, target,
   *      aoe, slow, slowTime, burn, poison, knock, stun, gravity, crit, color, width, source }
   */
  spawn(o) {
    const p = {
      kind: o.kind, owner: o.owner || 'player', source: o.source || 'rider',
      pos: o.pos.clone(), vel: o.dir.clone().normalize().multiplyScalar(o.speed), speed: o.speed,
      dmg: o.dmg, radius: o.radius ?? 0.5, life: o.life ?? 2.5, pierce: o.pierce ?? 0, bounce: o.bounce ?? 0,
      homing: o.homing ?? 0, target: o.target || null, aoe: o.aoe ?? 0, slow: o.slow ?? 0, slowTime: o.slowTime ?? 0,
      burn: o.burn ?? 0, poison: o.poison ?? 0, knock: o.knock ?? 2, stun: o.stun ?? 0, gravity: o.gravity ?? 0,
      crit: !!o.crit, color: o.color, hit: new Set(), trailAcc: 0, spinT: 0, dead: false,
      trail: TRAILS[o.kind], explodeOnExpire: !!o.explodeOnExpire, groundHit: o.groundHit !== false,
      hover: o.hover ?? null,
    };
    if (o.inherit) p.vel.add(o.inherit);
    p.batch = this._batch(o.kind, o.kind === 'orb' || o.kind === 'borb' ? o.color : undefined, o.kind === 'wave' ? (o.width || 5) : undefined);
    p.scale = o.scale || 1;
    this.list.push(p);
    return p;
  }

  update(dt) {
    const game = this.game;
    const fx = game.fx;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        if (p.aoe && p.explodeOnExpire) this.explode(p, p.pos, null);
        this._kill(i);
        continue;
      }
      // 追踪
      if (p.homing > 0) {
        if (p.target && !p.target.alive) p.target = null;
        if (!p.target && p.owner === 'player') p.target = game.nearestEnemy(p.pos, 30, p.hit);
        if (p.target || p.owner === 'enemy') {
          if (p.owner === 'enemy') _v.copy(game.player.pos).setY(game.player.pos.y + game.player.size.height * 0.6);
          else p.target.getCenter(_v);
          _v.sub(p.pos).normalize().multiplyScalar(p.speed);
          p.vel.lerp(_v, Math.min(1, p.homing * dt));
          p.vel.setLength(p.speed);
        }
      }
      if (p.gravity) p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.hover !== null) p.pos.y = game.heightAt(p.pos.x, p.pos.z) + p.hover; // 贴地飞行
      if (p.kind === 'shuriken') p.spinT += dt * 22;
      else if (p.kind === 'rock' || p.kind === 'cannon') p.spinT += dt * 8;

      // 拖尾
      const tr = p.trail;
      if (tr) {
        p.trailAcc += tr.rate * dt;
        const sys = tr.smoke ? fx.dust : fx.sparks;
        const col = tr.color ?? p.color ?? 0xffffff;
        while (p.trailAcc >= 1) {
          p.trailAcc -= 1;
          const s = tr.spread ?? 0.15;
          sys.spawn(p.pos.x + (Math.random() - 0.5) * s, p.pos.y + (Math.random() - 0.5) * s, p.pos.z + (Math.random() - 0.5) * s,
            (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2 - (tr.drop ?? 0), (Math.random() - 0.5) * 1.2,
            tr.life, tr.size, tr.sizeEnd ?? 0, col, tr.color2 ?? col, tr.smoke ? 0.5 : 0.9, 0, 1);
        }
      }

      // 地面
      if (p.groundHit && p.hover === null) {
        const h = game.heightAt(p.pos.x, p.pos.z);
        // 玩家的直射弹体贴着坡顶飞过去，不会被上坡路面挡掉
        if (p.owner === 'player' && !p.gravity && p.pos.y < h + 0.6) {
          p.pos.y = h + 0.6;
          if (p.vel.y < 0) { p.vel.y = 0; p.vel.setLength(p.speed); }
        }
        if (p.pos.y < h + 0.05) {
          if (p.aoe) this.explode(p, p.pos, null);
          else fx.dust.burst(p.pos, { count: 5, speed: 3, life: 0.4, size: 0.5, sizeEnd: 1.2, color: 0xb0a080, alpha: 0.6, up: 2 });
          this._kill(i);
          continue;
        }
      }

      // 命中判定
      if (p.owner === 'player') {
        const enemies = game.enemies;
        for (let k = 0; k < enemies.length; k++) {
          const e = enemies[k];
          if (!e.targetable || p.hit.has(e)) continue;
          e.getCenter(_v2);
          const dx = p.pos.x - _v2.x, dz = p.pos.z - _v2.z;
          const rr = e.radius + p.radius;
          if (dx * dx + dz * dz > rr * rr) continue;
          if (Math.abs(p.pos.y - _v2.y) > e.halfHeight + p.radius + 0.4) continue;
          if (this._hitEnemy(p, e)) { this._kill(i); break; }
        }
      } else {
        const pl = game.player;
        if (pl.alive) {
          const dx = p.pos.x - pl.pos.x, dz = p.pos.z - pl.pos.z;
          const rr = pl.radius * 0.8 + p.radius;
          const top = pl.pos.y + pl.size.height * 1.35 + 0.6;
          if (dx * dx + dz * dz < rr * rr && p.pos.y > pl.pos.y - 0.6 && p.pos.y < top) {
            if (p.aoe) this.explode(p, p.pos, null);
            else {
              _dir.copy(p.vel).setY(0).normalize();
              pl.takeDamage(p.dmg, { dir: _dir, knock: p.knock, poison: p.poison, slow: p.slow, slowTime: p.slowTime, kind: 'proj' });
              fx.sparks.burst(p.pos, { count: 10, speed: 5, life: 0.35, size: 0.5, color: p.color ?? 0xffffff, color2: 0xff4020 });
            }
            this._kill(i);
          }
        }
      }
    }
    this._render();
  }

  // 返回 true 表示弹体销毁
  _hitEnemy(p, e) {
    const game = this.game;
    p.hit.add(e);
    _dir.copy(p.vel).setY(0).normalize();
    if (p.aoe) {
      this.explode(p, p.pos, e);
    } else {
      game.damageEnemy(e, p.dmg, {
        crit: p.crit, dir: _dir, knock: p.knock, slow: p.slow, slowTime: p.slowTime, burn: p.burn, poison: p.poison,
        stun: p.stun, source: p.source, hitPos: p.pos,
      });
      const col = p.kind === 'ice' ? 0xaaddff : p.kind === 'venom' ? 0x9cff3a : (p.color ?? 0xffe0a0);
      game.fx.sparks.burst(p.pos, { count: 8, speed: 6, life: 0.3, size: 0.45, color: col, color2: 0xffffff });
    }
    if (p.bounce > 0) {
      const next = game.nearestEnemy(p.pos, 18, p.hit);
      if (next) {
        p.bounce--;
        next.getCenter(_v);
        p.vel.copy(_v.sub(p.pos).normalize().multiplyScalar(p.speed));
        p.life = Math.max(p.life, 1);
        return false;
      }
    }
    if (p.pierce > 0) { p.pierce--; return false; }
    return true;
  }

  explode(p, at, direct) {
    const game = this.game;
    const r = p.aoe;
    const fx = game.fx;
    const isFire = p.kind === 'fireball' || p.kind === 'meteor' || p.kind === 'efire' || p.kind === 'missile' || p.kind === 'cannon';
    const c1 = isFire ? 0xffc040 : p.kind === 'rock' ? 0xd8c8a8 : (p.color ?? 0xffffff);
    const c2 = isFire ? 0xff3000 : (p.color ?? 0xffffff);
    fx.sparks.burst(at, { count: 20 + r * 6, speed: r * 3, life: 0.5, size: 0.9, sizeEnd: 0.2, color: c1, color2: c2, up: 2 });
    fx.dust.burst(at, { count: 10 + r * 3, speed: r * 1.2, life: 0.9, size: 1.2, sizeEnd: 3, color: isFire ? 0x3a3a3a : 0xb8a888, alpha: 0.55, up: 2.5, drag: 2 });
    game.fx.rings.ring(at, { r0: 0.5, r1: r * 1.1, life: 0.45, color: c1, opacity: 0.9 });
    game.audio.play('explosion', { volume: Math.min(1, 0.35 + r * 0.08), pitch: 1.3 - Math.min(0.5, r * 0.05) });
    game.shakeAt(at, Math.min(0.5, r * 0.06));
    if (p.owner === 'player') {
      for (const e of game.enemies) {
        if (!e.targetable) continue;
        const d = Math.hypot(e.pos.x - at.x, e.pos.z - at.z) - e.radius;
        if (d > r) continue;
        _dir.set(e.pos.x - at.x, 0, e.pos.z - at.z).normalize();
        game.damageEnemy(e, p.dmg * (e === direct ? 1 : 0.75), {
          crit: p.crit, dir: _dir, knock: p.knock + 3, slow: p.slow, slowTime: p.slowTime, burn: p.burn, poison: p.poison,
          source: p.source, hitPos: e === direct ? at : null,
        });
      }
    } else {
      const pl = game.player;
      const d = Math.hypot(pl.pos.x - at.x, pl.pos.z - at.z) - pl.radius * 0.6;
      if (d < r && Math.abs(pl.pos.y - at.y) < r + pl.size.height) {
        _dir.set(pl.pos.x - at.x, 0, pl.pos.z - at.z).normalize();
        pl.takeDamage(p.dmg, { dir: _dir, knock: p.knock + 4, poison: p.poison, kind: 'aoe' });
      }
    }
  }

  _kill(i) {
    const p = this.list[i];
    p.dead = true;
    this.list.splice(i, 1);
  }

  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this._kill(i);
    this._render();
  }

  dispose() {
    this.list.length = 0;
    for (const b of this.batches.values()) b.dispose();
    this.batches.clear();
  }
}
