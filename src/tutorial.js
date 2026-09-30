// =====================================================================
//  新手引导：第一次玩第 1 关时，按情境依次弹出提示，并短暂放慢时间
//   1 左右移动 → 2 跳过怪物 → 3 穿过强化门 → 4 放技能；第一次狂热满时另提示觉醒
//  只靠轮询游戏状态判断完成，不需要在各处埋钩子
// =====================================================================
import { save, persist } from './save.js';
import { t } from './i18n.js';

export class Tutorial {
  constructor(game, touch) {
    this.game = game;
    this.touch = touch;
    this.active = !save.tutorialDone && !game.endless && game.levelIdx === 0;
    this.ultPending = !save.tutUlt;
    this.step = 0;
    this.shown = null;     // 当前显示的步骤
    this.t = 0;
    this.x0 = 0;
    this.el = document.createElement('div');
    this.el.className = 'tut hidden';
    game.app.hudRoot.appendChild(this.el);
  }

  /** 引导期间不刷剧毒小蛛（先学会基本操作） */
  get calm() { return this.active && this.step < 4; }

  show(key, icon) {
    const dev = this.touch ? 'touch' : 'key';
    this.el.innerHTML = `<div class="ic">${icon}</div><div class="tx">${t(`tut.${key}.${dev}`)}</div>`;
    this.el.classList.remove('hidden', 'done');
    this.shown = key;
    this.t = 0;
    const g = this.game;
    g.slowmoT = Math.max(g.slowmoT, 0.9);
    g.audio.play('powerup', { volume: 0.35, pitch: 1.3 });
  }

  done() {
    if (!this.shown) return;
    this.shown = null;
    this.el.classList.add('done');
    this.game.audio.play('coin', { volume: 0.35, pitch: 1.5 });
    setTimeout(() => { if (!this.shown) this.el.classList.add('hidden'); }, 450);
  }

  update(dt) {
    const g = this.game, p = g.player;
    if (g.state !== 'run' && g.state !== 'boss') return;
    this.t += dt;
    if (this.active) this.updateSteps(dt, g, p);
    // 第一次狂热槽满：提示觉醒（老玩家也提示一次）
    if (this.ultPending && !this.shown && g.fever >= 100 && !(p.buffs.rage > 0)) { this.show('ult', '🦖'); this.shownUlt = true; }
    if (this.shown === 'ult' && (p.buffs.rage > 0 || this.t > 7)) {
      this.done(); this.ultPending = false; save.tutUlt = true; persist();
    }
  }

  updateSteps(dt, g, p) {
    switch (this.step) {
      case 0:
        if (p.pos.z > 12) { this.show('move', '↔️'); this.x0 = p.pos.x; this.step = 1; }
        break;
      case 1:
        if (Math.abs(p.pos.x - this.x0) > 3 || this.t > 6) { this.done(); this.step = 2; }
        break;
      case 2: {
        const near = g.enemies.some((e) => e.targetable && !e.isBoss && !e.flying && e.pos.z - p.pos.z > 8 && e.pos.z - p.pos.z < 24);
        if (!this.shown && near) this.show('jump', '⤴️');
        if (this.shown === 'jump' && (!p.onGround || this.t > 5)) { this.done(); this.step = 3; }
        break;
      }
      case 3: {
        const gate = g.gates.find((gt) => !gt.resolved && gt.z - p.pos.z < 45 && gt.z > p.pos.z);
        if (!this.shown && gate) this.show('gate', '🚪');
        if (this.shown === 'gate' && (g.gates.some((gt) => gt.resolved) || this.t > 8)) { this.done(); this.step = 4; this.wait = 1.2; }
        break;
      }
      case 4:
        this.wait -= dt;
        if (!this.shown && this.wait <= 0 && p.skillCd <= 0) this.show('skill', '✨');
        if (this.shown === 'skill' && (p.skill || this.t > 7)) {
          this.done(); this.step = 5; this.active = false;
          save.tutorialDone = true; persist();
        }
        break;
    }
  }

  dispose() { this.el.remove(); }
}
