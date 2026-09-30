// 输入：键盘 / 鼠标（指针锁定）/ 触屏虚拟摇杆
import { t } from './i18n.js';

const ACTIONS = {
  jump: ['Space', 'KeyW', 'ArrowUp', 'T_jump'],
  skill: ['KeyQ', 'KeyE', 'KeyK', 'KeyL', 'ShiftLeft', 'ShiftRight', 'Mouse2', 'T_skill'],
  pause: ['Escape', 'KeyP', 'T_pause'],
  ult: ['KeyR', 'T_ult'],
};

class Input {
  constructor() {
    this.down = new Set();
    this.edge = new Set();
    this.mdx = 0;
    this.mdy = 0;
    this.wheel = 0;
    this.locked = false;
    this.canvas = null;
    this.gameActive = false;      // 只有在游戏中才抢占指针
    this.onUnlock = null;         // 游戏中意外失去指针锁定时回调（用于暂停）
    this.joy = { x: 0, y: 0 };
    this.isTouch = false;
    this.lastLockAttempt = 0;
  }

  attach(canvas) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.edge.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => { this.down.clear(); });

    canvas.addEventListener('mousedown', (e) => {
      const code = 'Mouse' + e.button;
      if (!this.down.has(code)) this.edge.add(code);
      this.down.add(code);
    });
    window.addEventListener('mouseup', (e) => this.down.delete('Mouse' + e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      // 游戏中按住鼠标左右拖动 = 左右移动恐龙
      if (this.gameActive && (e.buttons & 1)) {
        // 过滤个别浏览器在锁定瞬间产生的超大位移
        if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
        this.mdx += e.movementX;
        this.mdy += e.movementY;
      }
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was && !this.locked && this.gameActive && this.onUnlock) this.onUnlock();
    });
  }

  requestLock() {
    if (!this.canvas || this.isTouch) return;
    const now = performance.now();
    if (now - this.lastLockAttempt < 250) return;
    this.lastLockAttempt = now;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => {
        try { const p2 = this.canvas.requestPointerLock(); if (p2 && p2.catch) p2.catch(() => {}); } catch { /* ignore */ }
      });
    } catch { /* ignore */ }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  held(action) { return ACTIONS[action].some((c) => this.down.has(c)); }
  pressed(action) { return ACTIONS[action].some((c) => this.edge.has(c)); }
  key(code) { return this.down.has(code); }
  keyPressed(code) { return this.edge.has(code); }

  move() {
    let x = 0, y = 0;
    if (this.down.has('KeyW') || this.down.has('ArrowUp')) y += 1;
    if (this.down.has('KeyS') || this.down.has('ArrowDown')) y -= 1;
    if (this.down.has('KeyA') || this.down.has('ArrowLeft')) x -= 1;
    if (this.down.has('KeyD') || this.down.has('ArrowRight')) x += 1;
    x += this.joy.x; y += this.joy.y;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  // 跑道模式：只取左右方向（-1 左 … 1 右）
  steer() {
    let x = 0;
    if (this.down.has('KeyA') || this.down.has('ArrowLeft')) x -= 1;
    if (this.down.has('KeyD') || this.down.has('ArrowRight')) x += 1;
    x += this.joy.x;                 // 触屏虚拟摇杆
    return Math.max(-1, Math.min(1, x));
  }

  consumeMouse() {
    const r = { dx: this.mdx, dy: this.mdy, wheel: this.wheel };
    this.mdx = 0; this.mdy = 0; this.wheel = 0;
    return r;
  }

  endFrame() { this.edge.clear(); }

  releaseAll() { this.down.clear(); this.edge.clear(); this.joy.x = 0; this.joy.y = 0; if (this.joyReset) this.joyReset(); }

  // ---------------- 触屏 ----------------
  buildTouch(root) {
    this.isTouch = true;
    root.innerHTML = `
      <div class="look" style="left:0;width:100%;height:100%"></div>
      <div class="joy"><div class="knob"></div></div>
      <div class="tbtn skill" data-a="skill"><div class="tcd"></div><span class="ico">✨</span><b>${t('touch.skill')}</b><div class="tct"></div></div>
      <div class="tbtn jump" data-a="jump"><span class="ico">⤴️</span><b>${t('touch.jump')}</b></div>
      <div class="tbtn ult" data-a="ult"><div class="tfill"></div><span class="ico">🦖</span><b>${t('touch.ult')}</b></div>
      <button class="btn small ghost tpause" data-a="pause">${t('touch.pause')}</button>
      <div class="rotate-hint"><div class="ph">📱</div><div>${t('touch.rotate')}</div></div>`;
    const look = root.querySelector('.look');
    const lastPos = new Map();
    look.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) lastPos.set(t.identifier, t.clientX); e.preventDefault(); }, { passive: false });
    look.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        const p = lastPos.get(t.identifier); if (p === undefined) continue;
        this.mdx += (t.clientX - p) * 1.3;
        lastPos.set(t.identifier, t.clientX);
      }
      e.preventDefault();
    }, { passive: false });
    const lookEnd = (e) => { for (const t of e.changedTouches) lastPos.delete(t.identifier); };
    look.addEventListener('touchend', lookEnd); look.addEventListener('touchcancel', lookEnd);

    // 左下角虚拟摇杆：按住往左 / 往右推，恐龙持续横移（推一半 = 半速）
    const joy = root.querySelector('.joy'), knob = joy.querySelector('.knob');
    let joyId = null, cx = 0, cy = 0;
    const setKnob = (x, y) => { knob.style.transform = `translate(${x}px, ${y}px)`; };
    this.joyReset = () => { joyId = null; this.joy.x = 0; joy.classList.remove('on'); setKnob(0, 0); };
    const joyMove = (tc) => {
      const R = joy.clientWidth * 0.42;
      const dx = Math.max(-R, Math.min(R, tc.clientX - cx));
      const dy = Math.max(-20, Math.min(20, (tc.clientY - cy) * 0.35));
      const v = dx / R;
      this.joy.x = Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88;
      setKnob(dx, dy);
    };
    joy.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (joyId !== null) return;
      const tc = e.changedTouches[0];
      const r = joy.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      joyId = tc.identifier;
      joy.classList.add('on');
      joyMove(tc);
    }, { passive: false });
    joy.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const tc of e.changedTouches) if (tc.identifier === joyId) joyMove(tc);
    }, { passive: false });
    const joyEnd = (e) => { for (const tc of e.changedTouches) if (tc.identifier === joyId) this.joyReset(); };
    joy.addEventListener('touchend', joyEnd); joy.addEventListener('touchcancel', joyEnd);

    root.querySelectorAll('[data-a]').forEach((el) => {
      const code = 'T_' + el.dataset.a;
      el.addEventListener('touchstart', (e) => { if (!this.down.has(code)) this.edge.add(code); this.down.add(code); el.classList.add('on'); e.preventDefault(); }, { passive: false });
      const end = () => { this.down.delete(code); el.classList.remove('on'); };
      el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
    });
  }
}

export const input = new Input();
