// =====================================================================
//  程序化音频系统 —— 纯 Web Audio 合成，无任何音频文件
//
//  audio.unlock()                        首次用户手势时调用（创建/恢复 AudioContext）
//  audio.play(name, { volume, pitch, pan })
//  audio.roar(size)                      恐龙吼叫 size 0.6(小) ~ 1.6(巨)，首领可到 2.4
//  audio.startMusic(theme) / audio.stopMusic(fade)
//  audio.setMusicVolume(v) / audio.setSfxVolume(v) / audio.setMuted(bool)
//
//  音效名（play）：
//   界面   click hover select buy error
//   近战   bite claw horn tail stomp peck headbutt
//          whoosh hit hitHeavy crit playerHurt enemyHurt enemyDie bossDie explosion shieldHit
//   骑手   spear arrow fireball laser bullet shuriken missile ice rock cannon
//   技能   charge pounce spin quake frenzy fortress dive sonic venom wave spikes sprint
//          （roar 请用 roar(size)；play('roar') 也可，pitch 越低体型越大）
//   其它   jump land step coin heal powerup levelUp portal waveStart warning bossAppear bossRoar
//          enemyShoot freeze burn poison victory defeat countdown star
//   别名   skill→powerup  shield→fortress  dash→sprint  spit→venom  hurt→playerHurt
//          pickup→coin  roarSkill→roar  explode→explosion
//  未知名字：静默忽略。
//
//  音乐主题：menu jungle desert frost swamp volcano shadow boss victory
// =====================================================================

const SFX_LEVEL = 0.9;
const MUSIC_LEVEL = 0.55;
const MAX_VOICES = 80;

const ALIASES = {
  skill: 'powerup', shield: 'fortress', dash: 'sprint', spit: 'venom', hurt: 'playerHurt',
  pickup: 'coin', roarSkill: 'roar', explode: 'explosion',
};

// 每 50ms 窗口内同名音效的最大数量（默认 6）
const LIMIT = { step: 2, hover: 2, roar: 2, bossRoar: 1, bossDie: 1, bossAppear: 1, victory: 1, defeat: 1, countdown: 1, waveStart: 1 };

// ---------------------------------------------------------------------
//  小工具
// ---------------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const nowMs = () => (globalThis.performance && performance.now ? performance.now() : Date.now());

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =====================================================================
//  音效定义  d = 持续时长(用于回收)  r = 混响发送量  v = 基础音量
//  f(a, out, t)：a = AudioSystem，out = 该音效的输出节点，t = 开始时间
// =====================================================================
const SFX = {
  // ---------------- 界面 ----------------
  click: { d: 0.12, r: 0.05, v: 0.55, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 1400, f2: 700, dur: 0.06, v: 0.35 });
    a._noise(o, t, { ft: 'highpass', ff: 4000, dur: 0.02, v: 0.12 });
  } },
  hover: { d: 0.06, r: 0.03, v: 0.35, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 2200, f2: 2000, dur: 0.04, v: 0.12, a: 0.003 });
  } },
  select: { d: 0.35, r: 0.15, v: 0.6, f(a, o, t) {
    a._tone(o, t, { type: 'triangle', f: 660, dur: 0.08, v: 0.3 });
    a._tone(o, t, { at: 0.07, type: 'triangle', f: 990, dur: 0.16, v: 0.3 });
    a._tone(o, t, { at: 0.07, type: 'sine', f: 1980, dur: 0.22, v: 0.06 });
  } },
  buy: { d: 0.5, r: 0.2, v: 0.6, f(a, o, t) {
    a._tone(o, t, { type: 'square', f: 988, dur: 0.08, v: 0.16, ft: 'lowpass', ff: 3500 });
    a._tone(o, t, { at: 0.07, type: 'square', f: 1319, dur: 0.32, v: 0.16, ft: 'lowpass', ff: 3500 });
    a._tone(o, t, { at: 0.07, type: 'sine', f: 2637, dur: 0.25, v: 0.05 });
    a._tone(o, t, { at: 0.14, type: 'triangle', f: 1760, dur: 0.3, v: 0.08 });
    a._noise(o, t, { at: 0.07, ft: 'highpass', ff: 6500, dur: 0.18, v: 0.05 });
  } },
  error: { d: 0.4, r: 0.05, v: 0.55, f(a, o, t) {
    a._tone(o, t, { type: 'square', f: 220, dur: 0.12, v: 0.22, ft: 'lowpass', ff: 1200 });
    a._tone(o, t, { at: 0.13, type: 'square', f: 165, dur: 0.22, v: 0.22, ft: 'lowpass', ff: 1000 });
  } },

  // ---------------- 近战 ----------------
  bite: { d: 0.3, r: 0.1, v: 0.9, f(a, o, t) {
    a._noise(o, t, { ft: 'bandpass', ff: 1800, q: 1.2, dur: 0.09, v: 0.7, a: 0.002 });
    a._noise(o, t, { at: 0.05, ft: 'bandpass', ff: 900, q: 2, dur: 0.08, v: 0.5, a: 0.002 });
    a._tone(o, t, { type: 'sine', f: 140, f2: 45, dur: 0.16, v: 0.8 });
    a._tone(o, t, { type: 'square', f: 2400, f2: 600, dur: 0.025, v: 0.12, a: 0.001 });
  } },
  claw: { d: 0.3, r: 0.1, v: 0.8, f(a, o, t) {
    for (let i = 0; i < 3; i++) {
      a._noise(o, t, { at: i * 0.045, ft: 'bandpass', ff: 4200, ff2: 1400, q: 1.5, dur: 0.09, v: 0.45, a: 0.004, pan: (i - 1) * 0.3 });
    }
    a._tone(o, t, { at: 0.1, type: 'sine', f: 300, f2: 120, dur: 0.08, v: 0.25 });
  } },
  horn: { d: 0.35, r: 0.1, v: 0.9, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 110, f2: 40, dur: 0.25, v: 0.9 });
    a._noise(o, t, { color: 'brown', ft: 'lowpass', ff: 900, dur: 0.18, v: 0.8 });
    a._noise(o, t, { ft: 'bandpass', ff: 1400, q: 3, dur: 0.07, v: 0.35, a: 0.001 });
  } },
  tail: { d: 0.5, r: 0.12, v: 0.85, f(a, o, t) {
    a._noise(o, t, { color: 'pink', ft: 'bandpass', ff: 300, ff2: 1800, fsweep: 0.16, q: 1.2, dur: 0.26, v: 0.5, a: 0.08 });
    a._tone(o, t, { at: 0.2, type: 'sine', f: 120, f2: 40, dur: 0.2, v: 0.8 });
    a._noise(o, t, { at: 0.2, ft: 'lowpass', ff: 2500, dur: 0.08, v: 0.4 });
  } },
  stomp: { d: 0.6, r: 0.2, v: 1, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 80, f2: 28, dur: 0.5, v: 1 });
    a._noise(o, t, { color: 'brown', ft: 'lowpass', ff: 300, dur: 0.45, v: 0.9 });
    a._noise(o, t, { ft: 'lowpass', ff: 1500, dur: 0.08, v: 0.3 });
  } },
  peck: { d: 0.15, r: 0.08, v: 0.8, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 1100, f2: 500, dur: 0.05, v: 0.4, a: 0.001 });
    a._noise(o, t, { ft: 'bandpass', ff: 2500, q: 4, dur: 0.03, v: 0.3, a: 0.001 });
    a._tone(o, t, { at: 0.02, type: 'triangle', f: 400, f2: 200, dur: 0.06, v: 0.3 });
  } },
  headbutt: { d: 0.35, r: 0.12, v: 0.9, f(a, o, t) {
    a._tone(o, t, { type: 'triangle', f: 320, f2: 110, dur: 0.15, v: 0.6, a: 0.001 });
    a._tone(o, t, { type: 'sine', f: 90, f2: 40, dur: 0.22, v: 0.9 });
    a._noise(o, t, { color: 'brown', ft: 'lowpass', ff: 700, dur: 0.14, v: 0.6 });
  } },
  whoosh: { d: 0.35, r: 0.1, v: 0.7, f(a, o, t) {
    a._noise(o, t, { color: 'pink', ft: 'bandpass', ff: 350, ff2: 2200, q: 1, dur: 0.28, v: 0.45, a: 0.07 });
  } },
  hit: { d: 0.2, r: 0.08, v: 0.8, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 170, f2: 55, dur: 0.13, v: 0.8, a: 0.001 });
    a._noise(o, t, { ft: 'lowpass', ff: 2200, ff2: 600, dur: 0.08, v: 0.45, a: 0.001 });
  } },
  hitHeavy: { d: 0.45, r: 0.15, v: 1, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 120, f2: 32, dur: 0.32, v: 1, a: 0.001 });
    a._noise(o, t, { color: 'brown', ft: 'lowpass', ff: 1200, dur: 0.25, v: 0.9, a: 0.001 });
    a._noise(o, t, { ft: 'bandpass', ff: 1000, q: 1, dur: 0.1, v: 0.5, a: 0.001 });
    a._tone(o, t, { type: 'square', f: 90, f2: 45, dur: 0.12, v: 0.2, shape: 3, ft: 'lowpass', ff: 800 });
  } },
  crit: { d: 0.5, r: 0.25, v: 0.9, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 180, f2: 50, dur: 0.18, v: 0.9, a: 0.001 });
    a._noise(o, t, { ft: 'lowpass', ff: 3000, ff2: 700, dur: 0.1, v: 0.5, a: 0.001 });
    a._fm(o, t, { f: 1800, ratio: 2.76, index: 3, dur: 0.4, v: 0.22 });
    a._tone(o, t, { at: 0.02, type: 'sine', f: 3000, f2: 4200, dur: 0.15, v: 0.08 });
  } },
  playerHurt: { d: 0.35, r: 0.1, v: 0.85, f(a, o, t) {
    a._tone(o, t, { type: 'sawtooth', f: 210, f2: 120, dur: 0.22, v: 0.35, ft: 'lowpass', ff: 900 });
    a._tone(o, t, { type: 'sine', f: 130, f2: 50, dur: 0.2, v: 0.7 });
    a._noise(o, t, { ft: 'bandpass', ff: 1200, dur: 0.1, v: 0.3 });
  } },
  enemyHurt: { d: 0.15, r: 0.05, v: 0.55, f(a, o, t) {
    a._tone(o, t, { type: 'square', f: 520, f2: 240, dur: 0.08, v: 0.25, ft: 'bandpass', ff: 1200, q: 2 });
    a._noise(o, t, { ft: 'highpass', ff: 2000, dur: 0.04, v: 0.12 });
  } },
  enemyDie: { d: 0.45, r: 0.15, v: 0.75, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 600, f2: 70, dur: 0.28, v: 0.5 });
    a._noise(o, t, { color: 'pink', ft: 'lowpass', ff: 3000, ff2: 300, dur: 0.3, v: 0.4, a: 0.01 });
    a._tone(o, t, { at: 0.12, type: 'triangle', f: 800, f2: 1600, dur: 0.12, v: 0.08 });
  } },
  bossDie: { d: 3.8, r: 0.45, v: 1, f(a, o, t) {
    a._noise(o, t, { color: 'brown', ft: 'lowpass', ff: 1800, ff2: 80, dur: 3.0, v: 1, a: 0.02 });
    a._tone(o, t, { type: 'sine', f: 70, f2: 18, dur: 2.5, v: 1 });
    a._noise(o, t, { ft: 'lowpass', ff: 5000, ff2: 300, dur: 1.2, v: 0.5, a: 0.002 });
    a._tone(o, t, { type: 'sawtooth', f: 300, f2: 40, dur: 2, v: 0.25, ft: 'lowpass', ff: 800 });
    a._roar(o, t + 0.1, 2.0, 0.5);
    for (let i = 0; i < 4; i++) {
      a._tone(o, t, { at: 0.5 + i * 0.35, type: 'sine', f: 60, f2: 25, dur: 0.5, v: 0.7 });
      a._noise(o, t, { at: 0.5 + i * 0.35, ft: 'lowpass', ff: 2500, ff2: 200, dur: 0.5, v: 0.4, pan: rand(-0.7, 0.7) });
    }
    a._fm(o, t, { at: 1.8, f: 196, ratio: 1.4, index: 2, dur: 2.0, v: 0.15 });
  } },
  explosion: { d: 1.2, r: 0.35, v: 1, f(a, o, t) {
    a._noise(o, t, { ft: 'lowpass', ff: 4000, ff2: 150, dur: 0.9, v: 0.9, a: 0.003 });
    a._tone(o, t, { type: 'sine', f: 90, f2: 28, dur: 0.6, v: 1, a: 0.002 });
    a._noise(o, t, { color: 'brown', ft: 'lowpass', ff: 400, dur: 1.0, v: 0.8 });
    for (let i = 0; i < 5; i++) {
      a._noise(o, t, { at: rand(0.08, 0.5), ft: 'highpass', ff: 3000, dur: 0.02, v: 0.15, a: 0.001, pan: rand(-0.6, 0.6) });
    }
  } },
  shieldHit: { d: 0.6, r: 0.3, v: 0.8, f(a, o, t) {
    a._fm(o, t, { f: 900, ratio: 1.414, index: 4, idur: 0.3, dur: 0.5, v: 0.32 });
    a._noise(o, t, { ft: 'highpass', ff: 3000, dur: 0.04, v: 0.25, a: 0.001 });
    a._tone(o, t, { type: 'sine', f: 1800, dur: 0.35, v: 0.08 });
  } },

  // ---------------- 骑手武器 ----------------
  spear: { d: 0.45, r: 0.2, v: 0.75, f(a, o, t) {
    a._noise(o, t, { color: 'pink', ft: 'bandpass', ff: 800, ff2: 2600, q: 1.5, dur: 0.2, v: 0.4, a: 0.02 });
    a._tone(o, t, { type: 'sine', f: 1500, f2: 900, dur: 0.2, v: 0.08 });
    a._fm(o, t, { f: 1320, ratio: 2, index: 1, dur: 0.35, v: 0.07 });
  } },
  arrow: { d: 0.3, r: 0.1, v: 0.7, f(a, o, t) {
    a._tone(o, t, { type: 'triangle', f: 190, f2: 170, dur: 0.18, v: 0.35, ft: 'lowpass', ff: 1500, a: 0.001 });
    a._tone(o, t, { type: 'sawtooth', f: 380, dur: 0.08, v: 0.12, ft: 'lowpass', ff: 2000, a: 0.001 });
    a._noise(o, t, { at: 0.02, ft: 'bandpass', ff: 5000, ff2: 2500, q: 3, dur: 0.15, v: 0.2 });
  } },
  fireball: { d: 0.55, r: 0.2, v: 0.8, f(a, o, t) {
    a._noise(o, t, { color: 'brown', ft: 'bandpass', ff: 300, ff2: 900, q: 0.8, dur: 0.45, v: 0.8, a: 0.03 });
    a._tone(o, t, { type: 'sawtooth', f: 160, f2: 90, dur: 0.35, v: 0.22, ft: 'lowpass', ff: 600 });
    a._noise(o, t, { ft: 'highpass', ff: 3000, dur: 0.25, v: 0.1, trem: 23, tremd: 0.9 });
    a._tone(o, t, { type: 'sine', f: 400, f2: 150, dur: 0.25, v: 0.2 });
  } },
  laser: { d: 0.25, r: 0.15, v: 0.6, f(a, o, t) {
    a._tone(o, t, { type: 'square', f: 1800, f2: 240, sweep: 0.14, dur: 0.16, v: 0.2, ft: 'lowpass', ff: 5000, a: 0.001 });
    a._tone(o, t, { type: 'sawtooth', f: 1200, f2: 200, dur: 0.12, v: 0.09, detune: 15, a: 0.001 });
  } },
  bullet: { d: 0.35, r: 0.3, v: 0.75, f(a, o, t) {
    a._noise(o, t, { ft: 'highpass', ff: 1200, dur: 0.05, v: 0.8, a: 0.001 });
    a._noise(o, t, { ft: 'lowpass', ff: 3000, ff2: 600, dur: 0.18, v: 0.5, a: 0.001 });
    a._tone(o, t, { type: 'sine', f: 180, f2: 50, dur: 0.09, v: 0.7, a: 0.001 });
  } },
  shuriken: { d: 0.3, r: 0.12, v: 0.7, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 2600, dur: 0.22, v: 0.1, vib: 35, vibd: 300 });
    a._noise(o, t, { ft: 'bandpass', ff: 6000, ff2: 3000, q: 2, dur: 0.2, v: 0.25 });
    a._tone(o, t, { type: 'triangle', f: 3600, f2: 3000, dur: 0.08, v: 0.08 });
  } },
  missile: { d: 0.75, r: 0.2, v: 0.75, f(a, o, t) {
    a._noise(o, t, { ft: 'bandpass', ff: 600, ff2: 3200, fsweep: 0.5, q: 1, dur: 0.6, v: 0.45, a: 0.05 });
    a._tone(o, t, { type: 'sawtooth', f: 90, f2: 260, dur: 0.5, v: 0.22, ft: 'lowpass', ff: 800 });
    a._tone(o, t, { type: 'sine', f: 150, f2: 60, dur: 0.12, v: 0.5 });
  } },
  ice: { d: 0.5, r: 0.35, v: 0.7, f(a, o, t) {
    const fs = [2093, 2637, 3136, 3951, 4699];
    for (let i = 0; i < fs.length; i++) a._tone(o, t, { at: i * 0.025, type: 'sine', f: fs[i], dur: 0.35, v: 0.08, a: 0.002 });
    a._noise(o, t, { ft: 'highpass', ff: 5000, dur: 0.25, v: 0.12 });
    a._tone(o, t, { type: 'triangle', f: 1200, f2: 1800, dur: 0.12, v: 0.1 });
  } },
  rock: { d: 0.35, r: 0.08, v: 0.8, f(a, o, t) {
    a._noise(o, t, { color: 'pink', ft: 'bandpass', ff: 200, ff2: 700, q: 1, dur: 0.25, v: 0.5, a: 0.05 });
    a._tone(o, t, { type: 'sawtooth', f: 140, f2: 100, dur: 0.15, v: 0.18, ft: 'lowpass', ff: 500 });
  } },
  cannon: { d: 1.3, r: 0.35, v: 1, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 95, f2: 28, dur: 0.6, v: 1, a: 0.001 });
    a._noise(o, t, { ft: 'lowpass', ff: 2500, ff2: 120, dur: 0.8, v: 0.9, a: 0.001 });
    a._noise(o, t, { ft: 'highpass', ff: 1500, dur: 0.05, v: 0.6, a: 0.001 });
    a._noise(o, t, { color: 'brown', ft: 'lowpass', ff: 300, dur: 1.1, v: 0.7 });
  } },

  // ---------------- 技能 ----------------
  roar: { d: 2.4, r: 0.35, v: 1, f(a, o, t) {
    a._roar(o, t, clamp(1 / a._pm, 0.4, 2.6), 1);
  } },
  charge: { d: 1.2, r: 0.15, v: 0.9, f(a, o, t) {
    a._noise(o, t, { color: 'brown', ft: 'lowpass', ff: 150, ff2: 600, dur: 1.0, v: 0.7, a: 0.3 });
    for (let i = 0; i < 6; i++) a._tone(o, t, { at: i * 0.14, type: 'sine', f: 90, f2: 40, dur: 0.12, v: 0.6, a: 0.002 });
    a._tone(o, t, { type: 'sawtooth', f: 110, f2: 220, dur: 0.6, v: 0.2, ft: 'lowpass', ff: 700, a: 0.1 });
  } },
  pounce: { d: 0.5, r: 0.15, v: 0.85, f(a, o, t) {
    a._noise(o, t, { color: 'pink', ft: 'bandpass', ff: 300, ff2: 2400, dur: 0.4, v: 0.5, a: 0.1 });
    a._tone(o, t, { type: 'sawtooth', f: 200, f2: 340, dur: 0.25, v: 0.22, ft: 'lowpass', ff: 1200, shape: 2, trem: 30, tremd: 0.6 });
  } },
  spin: { d: 0.9, r: 0.15, v: 0.8, f(a, o, t) {
    const pans = [-0.6, 0.6, 0];
    for (let i = 0; i < 3; i++) {
      a._noise(o, t, { at: i * 0.22, color: 'pink', ft: 'bandpass', ff: 400, ff2: 2000, dur: 0.24, v: 0.45, a: 0.06, pan: pans[i] });
    }
  } },
  quake: { d: 1.9, r: 0.3, v: 1, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 70, f2: 25, dur: 0.4, v: 1, a: 0.001 });
    a._noise(o, t, { color: 'brown', ft: 'lowpass', ff: 200, dur: 1.6, v: 1, a: 0.05, trem: 12, tremd: 0.7 });
    a._tone(o, t, { type: 'sine', f: 45, f2: 30, dur: 1.4, v: 0.9 });
    for (let i = 0; i < 6; i++) {
      a._noise(o, t, { at: rand(0.05, 1.0), ft: 'bandpass', ff: 800, q: 2, dur: 0.05, v: 0.3, a: 0.001, pan: rand(-0.8, 0.8) });
    }
  } },
  frenzy: { d: 1.0, r: 0.2, v: 0.85, f(a, o, t) {
    a._tone(o, t, { type: 'sawtooth', f: 90, f2: 360, dur: 0.6, v: 0.28, ft: 'lowpass', ff: 400, ff2: 2400, shape: 3 });
    for (const at of [0, 0.18, 0.6, 0.78]) a._tone(o, t, { at, type: 'sine', f: 60, f2: 40, dur: 0.12, v: 0.8, a: 0.002 });
    a._noise(o, t, { ft: 'bandpass', ff: 1500, q: 2, dur: 0.5, v: 0.15, a: 0.3 });
  } },
  fortress: { d: 1.2, r: 0.35, v: 0.85, f(a, o, t) {
    a._fm(o, t, { f: 220, ratio: 1.414, index: 5, idur: 0.5, dur: 1.0, v: 0.32 });
    a._fm(o, t, { at: 0.08, f: 330, ratio: 1.414, index: 3, dur: 0.9, v: 0.18 });
    a._tone(o, t, { type: 'sine', f: 110, a: 0.25, dur: 1.0, v: 0.3 });
    a._tone(o, t, { type: 'sine', f: 165, a: 0.25, dur: 1.0, v: 0.2 });
    a._noise(o, t, { ft: 'highpass', ff: 2500, dur: 0.06, v: 0.3, a: 0.001 });
  } },
  dive: { d: 1.1, r: 0.2, v: 0.85, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 2200, f2: 350, sweep: 0.9, dur: 0.95, v: 0.16 });
    a._noise(o, t, { color: 'pink', ft: 'bandpass', ff: 500, ff2: 2500, dur: 0.9, v: 0.35, a: 0.5 });
  } },
  sonic: { d: 1.4, r: 0.4, v: 0.9, f(a, o, t) {
    const hornO = { type: 'sawtooth', a: 0.12, hold: 0.6, dur: 1.2, ft: 'lowpass', ff: 400, ff2: 1800, fsweep: 0.3, vib: 5, vibd: 15 };
    a._tone(o, t, { ...hornO, f: 116, v: 0.24 });
    a._tone(o, t, { ...hornO, f: 174, v: 0.17 });
    a._tone(o, t, { ...hornO, f: 58, v: 0.2 });
    a._noise(o, t, { color: 'pink', ft: 'bandpass', ff: 350, q: 2, dur: 1.1, v: 0.15, a: 0.1 });
  } },
  venom: { d: 0.5, r: 0.12, v: 0.8, f(a, o, t) {
    a._noise(o, t, { ft: 'bandpass', ff: 1400, q: 1.5, dur: 0.2, v: 0.5, a: 0.005, trem: 40, tremd: 0.5 });
    a._tone(o, t, { type: 'sine', f: 700, f2: 200, dur: 0.12, v: 0.3 });
    for (let i = 0; i < 4; i++) {
      const f = rand(300, 600);
      a._tone(o, t, { at: 0.1 + i * 0.05, type: 'sine', f, f2: f * 1.8, dur: 0.05, v: 0.12 });
    }
  } },
  wave: { d: 1.0, r: 0.3, v: 0.95, f(a, o, t) {
    a._noise(o, t, { ft: 'highpass', ff: 2000, dur: 0.04, v: 0.9, a: 0.001 });
    a._tone(o, t, { type: 'square', f: 600, f2: 80, dur: 0.12, v: 0.2, ft: 'lowpass', ff: 3000, a: 0.001 });
    a._noise(o, t, { color: 'pink', ft: 'bandpass', ff: 1500, ff2: 300, dur: 0.8, v: 0.5, a: 0.02 });
    a._tone(o, t, { type: 'sine', f: 80, f2: 35, dur: 0.35, v: 0.8 });
  } },
  spikes: { d: 0.5, r: 0.15, v: 0.8, f(a, o, t) {
    for (let i = 0; i < 10; i++) {
      a._noise(o, t, { at: i * 0.018, ft: 'bandpass', ff: rand(3000, 6000), q: 6, dur: 0.05, v: 0.22, a: 0.001, pan: rand(-0.9, 0.9) });
    }
    a._noise(o, t, { color: 'pink', ft: 'bandpass', ff: 600, ff2: 2400, dur: 0.3, v: 0.35, a: 0.03 });
    a._tone(o, t, { type: 'triangle', f: 1800, f2: 2600, dur: 0.12, v: 0.08 });
  } },
  sprint: { d: 1.0, r: 0.15, v: 0.8, f(a, o, t) {
    a._noise(o, t, { color: 'pink', ft: 'bandpass', ff: 400, ff2: 3000, dur: 0.8, v: 0.45, a: 0.3 });
    a._tone(o, t, { type: 'sine', f: 300, f2: 900, dur: 0.6, v: 0.08, a: 0.2 });
    for (let i = 0; i < 4; i++) a._tone(o, t, { at: i * 0.08, type: 'sine', f: 120, f2: 50, dur: 0.06, v: 0.4, a: 0.002 });
  } },

  // ---------------- 其它 ----------------
  jump: { d: 0.3, r: 0.08, v: 0.7, f(a, o, t) {
    a._noise(o, t, { color: 'pink', ft: 'bandpass', ff: 300, ff2: 1400, dur: 0.2, v: 0.3, a: 0.02 });
    a._tone(o, t, { type: 'sine', f: 180, f2: 320, dur: 0.12, v: 0.2 });
  } },
  land: { d: 0.3, r: 0.1, v: 0.8, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 100, f2: 38, dur: 0.2, v: 0.8, a: 0.001 });
    a._noise(o, t, { color: 'brown', ft: 'lowpass', ff: 500, dur: 0.18, v: 0.6 });
  } },
  step: { d: 0.15, r: 0.03, v: 0.5, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 75, f2: 40, dur: 0.1, v: 0.5, a: 0.002 });
    a._noise(o, t, { color: 'brown', ft: 'lowpass', ff: 250, dur: 0.08, v: 0.35 });
  } },
  coin: { d: 0.4, r: 0.15, v: 0.55, f(a, o, t) {
    a._tone(o, t, { type: 'square', f: 988, dur: 0.07, v: 0.16, ft: 'lowpass', ff: 4000, a: 0.001 });
    a._tone(o, t, { at: 0.07, type: 'square', f: 1319, dur: 0.28, v: 0.16, ft: 'lowpass', ff: 4000, a: 0.001 });
    a._tone(o, t, { at: 0.07, type: 'sine', f: 2637, dur: 0.2, v: 0.05 });
  } },
  heal: { d: 0.9, r: 0.4, v: 0.7, f(a, o, t) {
    const fs = [523, 659, 784, 1047];
    for (let i = 0; i < fs.length; i++) a._tone(o, t, { at: i * 0.07, type: 'triangle', f: fs[i], dur: 0.5, v: 0.16 });
    a._noise(o, t, { ft: 'highpass', ff: 6000, dur: 0.6, v: 0.06, a: 0.15 });
    a._fm(o, t, { at: 0.28, f: 1568, ratio: 2, index: 0.5, dur: 0.6, v: 0.08 });
  } },
  powerup: { d: 0.6, r: 0.25, v: 0.7, f(a, o, t) {
    a._tone(o, t, { type: 'square', f: 300, f2: 1200, dur: 0.4, v: 0.1, ft: 'lowpass', ff: 3000, vib: 12, vibd: 60 });
    const fs = [784, 988, 1175, 1568];
    for (let i = 0; i < fs.length; i++) a._tone(o, t, { at: 0.1 + i * 0.06, type: 'triangle', f: fs[i], dur: 0.25, v: 0.12 });
  } },
  levelUp: { d: 1.8, r: 0.4, v: 0.75, f(a, o, t) {
    const fs = [523, 659, 784, 1047];
    for (let i = 0; i < fs.length; i++) a._tone(o, t, { at: i * 0.09, type: 'sawtooth', f: fs[i], dur: 0.3, v: 0.14, ft: 'lowpass', ff: 2500 });
    for (const f of fs) a._tone(o, t, { at: 0.38, type: 'sawtooth', f, dur: 1.0, v: 0.07, a: 0.02, hold: 0.4, ft: 'lowpass', ff: 2200 });
    a._fm(o, t, { at: 0.38, f: 2093, ratio: 3.5, index: 1.5, dur: 1.2, v: 0.07 });
  } },
  portal: { d: 1.2, r: 0.4, v: 0.7, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 220, f2: 880, dur: 1.0, v: 0.14, a: 0.3, vib: 8, vibd: 80 });
    a._tone(o, t, { type: 'sine', f: 330, f2: 1320, dur: 1.0, v: 0.09, a: 0.3, vib: 6, vibd: 60 });
    a._noise(o, t, { ft: 'bandpass', ff: 400, ff2: 3000, q: 4, dur: 1.0, v: 0.2, a: 0.3 });
    a._tone(o, t, { type: 'sine', f: 60, dur: 1.0, v: 0.3, a: 0.3 });
  } },
  waveStart: { d: 1.4, r: 0.45, v: 0.9, f(a, o, t) {
    const hornO = { type: 'sawtooth', a: 0.15, hold: 0.6, dur: 1.1, ft: 'lowpass', ff: 300, ff2: 1400, fsweep: 0.35, vib: 4, vibd: 10 };
    a._tone(o, t, { ...hornO, f: 110, v: 0.26 });
    a._tone(o, t, { ...hornO, f: 165, v: 0.18 });
    a._tone(o, t, { ...hornO, f: 55, v: 0.15 });
    a._tone(o, t, { type: 'sine', f: 110, f2: 45, dur: 0.4, v: 0.9, a: 0.002 });
    a._noise(o, t, { color: 'brown', ft: 'lowpass', ff: 600, dur: 0.3, v: 0.5 });
  } },
  warning: { d: 0.7, r: 0.15, v: 0.6, f(a, o, t) {
    const fs = [880, 660, 880, 660];
    for (let i = 0; i < 4; i++) a._tone(o, t, { at: i * 0.15, type: 'square', f: fs[i], dur: 0.12, v: 0.14, ft: 'lowpass', ff: 2500, a: 0.003 });
  } },
  bossAppear: { d: 4.4, r: 0.5, v: 1, f(a, o, t) {
    for (const f of [55, 55.6, 27.5]) a._tone(o, t, { type: 'sawtooth', f, a: 1.2, hold: 0.8, dur: 2.8, v: 0.22, ft: 'lowpass', ff: 200, ff2: 900, fsweep: 2.0 });
    a._noise(o, t, { color: 'brown', ft: 'lowpass', ff: 300, a: 1.0, dur: 2.8, v: 0.6 });
    a._tone(o, t, { at: 2.0, type: 'sine', f: 80, f2: 25, dur: 0.8, v: 1, a: 0.002 });
    a._noise(o, t, { at: 2.0, ft: 'lowpass', ff: 3000, ff2: 200, dur: 0.7, v: 0.6, a: 0.002 });
    a._fm(o, t, { at: 2.0, f: 110, ratio: 1.4, index: 3, idur: 1.2, dur: 2.2, v: 0.25 });
  } },
  bossRoar: { d: 2.8, r: 0.45, v: 1, f(a, o, t) {
    a._roar(o, t, 2.2, 1);
  } },
  enemyShoot: { d: 0.22, r: 0.1, v: 0.5, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 760, f2: 300, dur: 0.16, v: 0.2 });
    a._noise(o, t, { ft: 'bandpass', ff: 1500, dur: 0.06, v: 0.1 });
  } },
  freeze: { d: 0.7, r: 0.4, v: 0.7, f(a, o, t) {
    for (let i = 0; i < 6; i++) a._tone(o, t, { at: i * 0.04, type: 'sine', f: rand(2500, 5000), dur: 0.3, v: 0.07, a: 0.002 });
    a._noise(o, t, { ft: 'highpass', ff: 4000, ff2: 8000, dur: 0.5, v: 0.15, a: 0.1 });
    a._tone(o, t, { type: 'triangle', f: 800, f2: 1600, dur: 0.3, v: 0.06 });
  } },
  burn: { d: 0.75, r: 0.15, v: 0.7, f(a, o, t) {
    a._noise(o, t, { color: 'pink', ft: 'bandpass', ff: 800, q: 0.7, dur: 0.6, v: 0.35, a: 0.05 });
    for (let i = 0; i < 6; i++) a._noise(o, t, { at: rand(0, 0.5), ft: 'highpass', ff: 2500, dur: 0.015, v: 0.2, a: 0.001 });
  } },
  poison: { d: 0.6, r: 0.15, v: 0.65, f(a, o, t) {
    for (let i = 0; i < 5; i++) {
      const f = rand(200, 500);
      a._tone(o, t, { at: i * 0.08, type: 'sine', f, f2: f * 2, dur: 0.06, v: 0.15 });
    }
    a._noise(o, t, { ft: 'bandpass', ff: 900, q: 3, dur: 0.4, v: 0.08 });
  } },
  victory: { d: 2.4, r: 0.45, v: 0.85, f(a, o, t) {
    const seq = [[392, 0, 0.12], [523, 0.13, 0.12], [659, 0.26, 0.12], [784, 0.39, 0.35], [659, 0.76, 0.12], [784, 0.89, 0.9]];
    for (const [f, at, dur] of seq) {
      a._tone(o, t, { at, type: 'sawtooth', f, dur: dur + 0.08, v: 0.15, a: 0.02, hold: dur * 0.7, ft: 'lowpass', ff: 600, ff2: 2600, fsweep: 0.06 });
      a._tone(o, t, { at, type: 'sawtooth', f, detune: 8, dur: dur + 0.08, v: 0.1, a: 0.02, hold: dur * 0.7, ft: 'lowpass', ff: 2400 });
    }
    for (const f of [262, 330, 392, 523]) a._tone(o, t, { at: 0.89, type: 'triangle', f, dur: 1.3, v: 0.09, a: 0.03, hold: 0.5 });
    a._noise(o, t, { at: 0.89, ft: 'highpass', ff: 5000, dur: 1.2, v: 0.15, a: 0.002 });
    a._tone(o, t, { at: 0.89, type: 'sine', f: 150, f2: 45, dur: 0.35, v: 0.8, a: 0.002 });
    a._fm(o, t, { at: 0.89, f: 1568, ratio: 3.5, index: 1.5, dur: 1.4, v: 0.06 });
  } },
  defeat: { d: 2.8, r: 0.45, v: 0.8, f(a, o, t) {
    const fs = [392, 370, 349, 330];
    for (let i = 0; i < fs.length; i++) {
      a._tone(o, t, { at: i * 0.35, type: 'triangle', f: fs[i], dur: i === 3 ? 1.4 : 0.4, v: 0.25, hold: i === 3 ? 0.6 : 0.1, ft: 'lowpass', ff: 1500, vib: i === 3 ? 5 : 0, vibd: 20 });
    }
    a._tone(o, t, { at: 1.05, type: 'sine', f: 98, dur: 1.5, v: 0.3, a: 0.05, hold: 0.4 });
  } },
  countdown: { d: 0.3, r: 0.15, v: 0.6, f(a, o, t) {
    a._tone(o, t, { type: 'sine', f: 880, dur: 0.18, v: 0.3, a: 0.002, hold: 0.05 });
    a._tone(o, t, { type: 'sine', f: 1760, dur: 0.1, v: 0.05 });
  } },
  star: { d: 0.8, r: 0.4, v: 0.7, f(a, o, t) {
    a._fm(o, t, { f: 1760, ratio: 3, index: 1.5, dur: 0.6, v: 0.18 });
    a._tone(o, t, { at: 0.05, type: 'sine', f: 2637, dur: 0.4, v: 0.08 });
    a._noise(o, t, { ft: 'highpass', ff: 7000, dur: 0.3, v: 0.06 });
  } },
};

// =====================================================================
//  音乐：调式 / 节奏模板 / 主题
// =====================================================================
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const PHRYG_DOM = [0, 1, 4, 5, 7, 8, 10];
const HARM_MINOR = [0, 2, 3, 5, 7, 8, 11];

// 一小节 16 个十六分音符，旋律起音位置模板
const RHYTHMS = {
  sparse: [[0, 8], [0, 6, 8], [0, 4, 8], [0, 8, 12], [0, 6, 12], [0, 10]],
  medium: [[0, 4, 6, 8, 12], [0, 3, 6, 8, 12], [0, 2, 4, 8, 12, 14], [0, 4, 8, 10, 12], [0, 6, 8, 10, 12], [0, 3, 6, 10, 12]],
  dense: [[0, 2, 4, 6, 8, 10, 12, 14], [0, 3, 6, 8, 10, 12, 14], [0, 2, 3, 4, 6, 8, 12, 14], [0, 2, 4, 7, 8, 10, 12, 13, 14], [0, 3, 4, 6, 8, 11, 12, 14]],
};

// 鼓谱字符：x 正常  X 重音  o 轻  . 无
// bassPat：R 根音 F 五度 O 八度 T 三度 . 休止      arpPat：0/1/2 和弦音，3/4/5 高八度和弦音
const THEMES = {
  menu: {
    bpm: 112, root: 50, scale: MAJOR, prog: [0, 4, 5, 3, 0, 4, 3, 4], density: 'medium', melOct: 1, intro: 2,
    lead: 'brass', leadVol: 0.9, lead2: 'bell', lead2Vol: 0.45,
    pad: 'strings', padOct: 0, padEvery: 16, padVol: 0.8,
    bass: 'bassPluck', bassOct: -1, bassPat: 'R..R..R.R..R..FO', bassVol: 0.9, bassHold: 3,
    arp: 'pluck', arpOct: 1, arpPat: '0.2.1.2.0.2.1.3.', arpVol: 0.3,
    drums: { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.' },
    fill: { kick: 'x.....x.x.......', snare: '....x...x.x.xxxX', hat: 'x.o.x.o.........', tom: '..........x.x...' },
    crash: true, rev: 0.25, vol: 0.9,
  },
  jungle: {
    bpm: 100, root: 43, scale: MAJOR, pent: [0, 2, 4, 7, 9], prog: [0, 0, 3, 4, 0, 5, 3, 4], density: 'medium', melOct: 2, intro: 2,
    lead: 'marimba', leadVol: 1, lead2: 'flute', lead2Vol: 0.4,
    pad: 'warmPad', padOct: 1, padEvery: 16, padVol: 0.6,
    bass: 'bassSub', bassOct: 0, bassPat: 'R.....R...R.....', bassVol: 0.9, bassHold: 4,
    arp: 'marimba', arpOct: 2, arpPat: '0..2..1.3..2..1.', arpVol: 0.35,
    drums: { kick: 'x.......x.......', tom: 'x..x..x...x.x...', tomHi: '...x.....x....x.', shaker: 'oooooooooooooooo' },
    fill: { kick: 'x.......x.......', tom: 'x..x..x.x.x.xxxx', tomHi: '...x.....x.x.x..', shaker: 'oooooooooooooooo' },
    swing: 0.12, rev: 0.3, vol: 1,
  },
  desert: {
    bpm: 94, root: 50, scale: PHRYG_DOM, prog: [0, 1, 0, 6, 0, 1, 3, 0], density: 'medium', melOct: 1, intro: 2,
    lead: 'reed', leadVol: 0.85, lead2: 'pluck', lead2Vol: 0.55,
    pad: 'darkPad', padOct: 0, padEvery: 16, padVol: 0.5,
    bass: 'bassSub', bassOct: -1, bassPat: 'R.......R...F...', bassVol: 0.9, bassHold: 8,
    arp: 'pluck', arpOct: 1, arpPat: '0.1..2.1.0..2.1.', arpVol: 0.3,
    drums: { dum: 'x.....x.x.......', tek: '..x.x.....x.x.xo', shaker: 'o.o.o.o.o.o.o.o.' },
    fill: { dum: 'x.....x.x..x.x..', tek: '..x.x.....xxxxxx', shaker: 'o.o.o.o.o.o.o.o.' },
    swing: 0.08, rev: 0.3, vol: 1,
  },
  frost: {
    bpm: 70, root: 52, scale: LYDIAN, prog: [0, 1, 5, 1, 0, 1, 3, 4], density: 'sparse', melOct: 1, intro: 1,
    lead: 'bell', leadVol: 1, lead2: 'bell', lead2Vol: 0.35,
    pad: 'airPad', padOct: 0, padEvery: 16, padVol: 0.9,
    bass: 'bassSub', bassOct: -1, bassPat: 'R...............', bassVol: 0.7, bassHold: 16,
    arp: 'bell', arpOct: 2, arpPat: '0...1...2...1...', arpVol: 0.22,
    drums: { shaker: '....o.......o...', kick: 'o...............' },
    rev: 0.55, vol: 1,
  },
  swamp: {
    bpm: 82, root: 45, scale: DORIAN, prog: [0, 3, 0, 6, 0, 3, 4, 6], density: 'sparse', melOct: 1, intro: 2,
    lead: 'lowPluck', leadVol: 1, lead2: 'flute', lead2Vol: 0.3,
    pad: 'darkPad', padOct: 0, padEvery: 16, padVol: 0.8,
    bass: 'bassSub', bassOct: -1, bassPat: 'R.....R...R.....', bassVol: 0.9, bassHold: 6,
    arp: 'lowPluck', arpOct: 0, arpPat: '0..1..2..1..0...', arpVol: 0.4,
    drums: { kick: 'x.........x.....', rim: '....x.......x..o', shaker: '..o...o...o...o.' },
    fill: { kick: 'x.........x.....', rim: '....x...x.x.x.xx', shaker: '..o...o...o...o.' },
    rev: 0.45, vol: 1,
  },
  volcano: {
    bpm: 138, root: 40, scale: MINOR, prog: [0, 0, 5, 6, 0, 0, 3, 6], density: 'medium', melOct: 2, intro: 2,
    lead: 'lead', leadVol: 0.9, lead2: 'brass', lead2Vol: 0.45,
    pad: 'distPad', padOct: 1, padEvery: 8, padVol: 0.7,
    bass: 'bassDist', bassOct: 0, bassPat: 'R.R.R.R.R.R.F.O.', bassVol: 0.9, bassHold: 2,
    drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xoxoxoxoxoxoxoxo' },
    fill: { kick: 'x...x...x.x.x.x.', snare: '....x...xxxxxxxX', hat: 'xoxoxoxo........' },
    crash: true, rev: 0.2, vol: 0.85,
  },
  shadow: {
    bpm: 80, root: 48, scale: HARM_MINOR, prog: [0, 5, 3, 4, 0, 5, 3, 4], density: 'sparse', melOct: 1, intro: 2,
    lead: 'bell', leadVol: 0.9, lead2: 'lead', lead2Vol: 0.25,
    pad: 'choir', padOct: 0, padEvery: 16, padVol: 1,
    bass: 'bassSub', bassOct: -1, bassPat: 'R.......R.......', bassVol: 0.9, bassHold: 8,
    arp: 'lowPluck', arpOct: 0, arpPat: '0..2..1..2..0...', arpVol: 0.32,
    drums: { toll: 'x...............', kick: 'x.......x.....o.', snare: '............o...' },
    rev: 0.5, vol: 1,
  },
  boss: {
    bpm: 150, root: 42, scale: HARM_MINOR, prog: [0, 0, 5, 4, 0, 0, 3, 4], density: 'dense', melOct: 2, intro: 0,
    lead: 'brass', leadVol: 0.75, lead2: 'lead', lead2Vol: 0.4,
    pad: 'choir', padOct: 1, padEvery: 16, padVol: 0.55,
    bass: 'bassDist', bassOct: 0, bassPat: 'RR.RR.RRRR.RR.FO', bassVol: 0.8, bassHold: 1,
    arp: 'pluck', arpOct: 2, arpPat: '0120312031203120', arpVol: 0.16, arpLen: 1,
    drums: { kick: 'x.x...x.x.x...x.', snare: '....x.......x...', hat: 'xoxoxoxoxoxoxoxo' },
    fill: { kick: 'x.x...x.x.x.x.x.', snare: '....x...x.xxxxxX', tom: '........x.x.x...', hat: 'xoxoxoxo........' },
    crash: true, rev: 0.22, vol: 0.85,
  },
  victory: {
    bpm: 100, root: 48, scale: MAJOR, prog: [0, 3, 4, 0, 5, 3, 4, 4], density: 'medium', melOct: 1, intro: 0,
    lead: 'brass', leadVol: 1, lead2: 'bell', lead2Vol: 0.5,
    pad: 'strings', padOct: 0, padEvery: 16, padVol: 0.8,
    bass: 'bassPluck', bassOct: -1, bassPat: 'R...R...R...F...', bassVol: 0.8, bassHold: 4,
    arp: 'bell', arpOct: 2, arpPat: '0.1.2.3.2.1.0...', arpVol: 0.18,
    drums: { kick: 'x.......x.......', snare: '....o.......o...', hat: '..o...o...o...o.' },
    crash: true, rev: 0.35, vol: 0.9,
  },
};

function degMidi(T, deg) {
  const sc = T.scale, n = sc.length;
  const o = Math.floor(deg / n);
  return T.root + sc[deg - o * n] + 12 * o;
}
function nearestChordTone(deg, root) {
  let best = root, bd = 1e9;
  for (const k of [-5, -3, 0, 2, 4, 7, 9, 11]) {
    const d = Math.abs(root + k - deg);
    if (d < bd) { bd = d; best = root + k; }
  }
  return best;
}
function snapPent(m, T) {
  const pc = (((m - T.root) % 12) + 12) % 12;
  if (T.pent.includes(pc)) return m;
  for (let d = 1; d < 3; d++) {
    if (T.pent.includes((pc - d + 12) % 12)) return m - d;
    if (T.pent.includes((pc + d) % 12)) return m + d;
  }
  return m;
}

// =====================================================================
//  AudioSystem
// =====================================================================
export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.musicVol = 0.6;
    this.sfxVol = 0.85;
    this.muted = false;
    this.debug = false;
    this._pm = 1;              // 当前音效的音高倍率
    this._recent = new Map();  // 同名限流
    this._voices = 0;
    this._track = null;
    this._timer = null;
    this._wantTheme = null;
    this._curves = new Map();
  }

  get unlocked() { return !!this.ctx && this.ctx.state === 'running'; }

  // running，或刚在用户手势中请求了 resume（避免解锁那一下的点击音被吞掉）
  _ready() {
    const c = this.ctx;
    if (!c) return false;
    if (c.state === 'running') return true;
    return c.state === 'suspended' && nowMs() - (this._unlockAt || -1e9) < 400;
  }

  // ---------------------------------------------------------------
  unlock() {
    try {
      this._unlockAt = nowMs();
      if (!this.ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return false;
        try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { this.ctx = new AC(); }
        this._build();
        // iOS：播放一个极短的静音缓冲以彻底解锁
        try {
          const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
          const s = this.ctx.createBufferSource();
          s.buffer = b; s.connect(this.ctx.destination); s.start(0);
        } catch (e) { /* ignore */ }
      }
      if (this.ctx.state !== 'running' && this.ctx.resume) {
        const p = this.ctx.resume();
        if (p && p.then) p.then(() => this._resumeMusic()).catch(() => {});
      }
      this._resumeMusic();
      return true;
    } catch (e) {
      if (this.debug) console.warn('[audio] unlock failed', e);
      return false;
    }
  }

  _resumeMusic() {
    if (this._wantTheme && (!this._track || this._track.theme !== this._wantTheme)) this.startMusic(this._wantTheme);
  }

  _build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.2;
    this.master.connect(this.comp);
    this.comp.connect(c.destination);

    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = this.sfxVol * SFX_LEVEL;
    this.sfxBus.connect(this.master);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = this.musicVol * MUSIC_LEVEL;
    this.musicBus.connect(this.master);

    // 共享混响：音效与音乐各有一条随音量变化的发送母线
    this.reverb = c.createConvolver();
    this.reverb.buffer = this._impulse(2.6, 2.8);
    this.revOut = c.createGain();
    this.revOut.gain.value = 0.55;
    this.reverb.connect(this.revOut);
    this.revOut.connect(this.master);
    this.sfxRev = c.createGain();
    this.sfxRev.gain.value = this.sfxVol * SFX_LEVEL;
    this.sfxRev.connect(this.reverb);
    this.musicRev = c.createGain();
    this.musicRev.gain.value = this.musicVol * MUSIC_LEVEL;
    this.musicRev.connect(this.reverb);

    this._nb = { white: this._noiseBuf('white'), pink: this._noiseBuf('pink'), brown: this._noiseBuf('brown') };
  }

  _noiseBuf(kind) {
    const c = this.ctx, len = Math.floor(c.sampleRate * 2);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  _impulse(sec, decay) {
    const c = this.ctx, sr = c.sampleRate, len = Math.floor(sr * sec);
    const b = c.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < len; i++) {
        const x = i / len;
        const k = 0.9 - 0.8 * x; // 越往后越暗
        y += k * ((Math.random() * 2 - 1) - y);
        const fadeIn = i < sr * 0.008 ? i / (sr * 0.008) : 1;
        d[i] = y * Math.pow(1 - x, decay) * fadeIn;
      }
    }
    return b;
  }

  _curve(amount) {
    let cv = this._curves.get(amount);
    if (!cv) {
      const n = 1024;
      cv = new Float32Array(n);
      const norm = Math.tanh(amount);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        cv[i] = Math.tanh(amount * x) / norm;
      }
      this._curves.set(amount, cv);
    }
    return cv;
  }

  // ---------------------------------------------------------------
  //  公共 API
  // ---------------------------------------------------------------
  play(name, opts = {}) {
    if (!this._ready()) return;
    const c = this.ctx;
    name = ALIASES[name] || name;
    const def = SFX[name];
    if (!def) return;
    if (this._voices > MAX_VOICES) return;
    if (!this._allow(name)) return;
    const vol = (opts.volume ?? 1) * def.v;
    if (!(vol > 0.0005)) return;
    try {
      this._pm = clamp(opts.pitch ?? 1, 0.25, 4);
      const out = this._voice(def.d, vol, opts.pan ?? 0, def.r);
      def.f(this, out, c.currentTime + 0.005);
    } catch (e) {
      if (this.debug) console.warn('[audio] play', name, e);
    } finally {
      this._pm = 1;
    }
  }

  roar(size = 1, opts = {}) {
    if (!this._ready()) return;
    const c = this.ctx;
    if (this._voices > MAX_VOICES || !this._allow('roar')) return;
    try {
      this._pm = 1;
      const s = clamp(size, 0.4, 2.6);
      const out = this._voice(0.65 + 0.75 * s + 0.3, opts.volume ?? 1, opts.pan ?? 0, 0.35);
      this._roar(out, c.currentTime + 0.005, s, 1);
    } catch (e) {
      if (this.debug) console.warn('[audio] roar', e);
    }
  }

  startMusic(theme) {
    this._wantTheme = theme;
    const c = this.ctx;
    if (!c) return; // 等待 unlock()
    const T = THEMES[theme];
    if (!T) return;
    if (this._track && this._track.theme === theme) return;
    try {
      this._fadeOutTrack(this._track, 1.2);
      const now = c.currentTime;
      const g = c.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(T.vol ?? 1, now + 1.2);
      g.connect(this.musicBus);
      const send = c.createGain();
      send.gain.value = T.rev ?? 0.25;
      g.connect(send);
      send.connect(this.musicRev);
      this._track = { theme, T, g, send, step: 0, nextTime: now + 0.08, song: this._compose(theme, T) };
      if (!this._timer) this._timer = setInterval(() => this._tick(), 25);
      this._tick();
    } catch (e) {
      if (this.debug) console.warn('[audio] startMusic', e);
    }
  }

  stopMusic(fade = 1) {
    this._wantTheme = null;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (!this.ctx) return;
    this._fadeOutTrack(this._track, fade);
    this._track = null;
  }

  setMusicVolume(v) {
    this.musicVol = clamp(+v || 0, 0, 1);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(this.musicVol * MUSIC_LEVEL, t, 0.05);
    this.musicRev.gain.setTargetAtTime(this.musicVol * MUSIC_LEVEL, t, 0.05);
  }

  setSfxVolume(v) {
    this.sfxVol = clamp(+v || 0, 0, 1);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(this.sfxVol * SFX_LEVEL, t, 0.05);
    this.sfxRev.gain.setTargetAtTime(this.sfxVol * SFX_LEVEL, t, 0.05);
  }

  setMuted(m) {
    this.muted = !!m;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  // ---------------------------------------------------------------
  //  内部：限流 / 声部
  // ---------------------------------------------------------------
  _allow(name) {
    const now = nowMs();
    let arr = this._recent.get(name);
    if (!arr) { arr = []; this._recent.set(name, arr); }
    while (arr.length && now - arr[0] > 50) arr.shift();
    if (arr.length >= (LIMIT[name] ?? 6)) return false;
    arr.push(now);
    return true;
  }

  _voice(dur, vol, pan, rev) {
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = vol;
    const nodes = [out];
    let tail = out;
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      out.connect(p);
      tail = p;
      nodes.push(p);
    }
    tail.connect(this.sfxBus);
    if (rev > 0) {
      const s = c.createGain();
      s.gain.value = rev;
      tail.connect(s);
      s.connect(this.sfxRev);
      nodes.push(s);
    }
    this._voices++;
    const h = setTimeout(() => {
      this._voices--;
      this._disc(nodes);
    }, (dur + 0.6) * 1000);
    if (h && h.unref) h.unref();
    return out;
  }

  _disc(nodes) {
    for (const n of nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
  }

  _env(param, t0, a, v, dur, hold) {
    const end = t0 + Math.max(dur, a + hold + 0.02);
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(Math.max(0.0002, v), t0 + a);
    if (hold > 0) param.setValueAtTime(Math.max(0.0002, v), t0 + a + hold);
    param.exponentialRampToValueAtTime(0.0001, end);
    return end;
  }

  // 公共后级：失真 → 滤波 → 颤音 → 包络 → 声像 → dest，返回结束时间
  _post(src, t0, o, dest, nodes) {
    const c = this.ctx;
    const dur = o.dur;
    const p = o.nop ? 1 : this._pm;
    let head = src;
    if (o.shape) {
      const sh = c.createWaveShaper();
      sh.curve = this._curve(o.shape);
      sh.oversample = '2x';
      head.connect(sh); head = sh; nodes.push(sh);
    }
    if (o.ft) {
      const fl = c.createBiquadFilter();
      fl.type = o.ft;
      fl.frequency.setValueAtTime(clamp(o.ff * p, 20, 20000), t0);
      if (o.ff2) fl.frequency.exponentialRampToValueAtTime(clamp(o.ff2 * p, 20, 20000), t0 + (o.fsweep || dur));
      fl.Q.value = o.q ?? (o.ft === 'bandpass' ? 1 : 0.7);
      head.connect(fl); head = fl; nodes.push(fl);
    }
    if (o.trem) {
      const tg = c.createGain();
      const d = o.tremd ?? 0.5;
      tg.gain.value = 1 - d / 2;
      const lfo = c.createOscillator();
      lfo.frequency.value = o.trem;
      const lg = c.createGain();
      lg.gain.value = d / 2;
      lfo.connect(lg); lg.connect(tg.gain);
      lfo.start(t0); lfo.stop(t0 + dur + 0.1);
      head.connect(tg); head = tg; nodes.push(tg, lfo, lg);
    }
    const g = c.createGain();
    const end = this._env(g.gain, t0, o.a ?? 0.004, o.v ?? 0.5, dur, o.hold || 0);
    head.connect(g); head = g; nodes.push(g);
    if (o.pan != null && c.createStereoPanner) {
      const pn = c.createStereoPanner();
      pn.pan.value = clamp(o.pan, -1, 1);
      head.connect(pn); head = pn; nodes.push(pn);
    }
    head.connect(dest);
    return end;
  }

  // 振荡器音：type f f2 sweep dur a hold v detune vib vibd shape ft ff ff2 fsweep q trem tremd pan at
  _tone(dest, t, o) {
    const c = this.ctx;
    const t0 = t + (o.at || 0);
    const p = o.nop ? 1 : this._pm;
    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(clamp(o.f * p, 1, 20000), t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(clamp(o.f2 * p, 1, 20000), t0 + (o.sweep || o.dur));
    if (o.detune) osc.detune.setValueAtTime(o.detune, t0);
    const nodes = [osc];
    if (o.vib) {
      const lfo = c.createOscillator();
      lfo.frequency.value = o.vib;
      const lg = c.createGain();
      lg.gain.value = o.vibd || 10;
      lfo.connect(lg); lg.connect(osc.detune);
      lfo.start(t0); lfo.stop(t0 + o.dur + 0.1);
      nodes.push(lfo, lg);
    }
    const end = this._post(osc, t0, o, dest, nodes);
    osc.start(t0);
    osc.stop(end + 0.02);
    osc.onended = () => this._disc(nodes);
    return osc;
  }

  // 噪声：color(white|pink|brown) rate + 与 _tone 相同的后级参数
  _noise(dest, t, o) {
    const c = this.ctx;
    const t0 = t + (o.at || 0);
    const src = c.createBufferSource();
    src.buffer = this._nb[o.color || 'white'];
    src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    const nodes = [src];
    const end = this._post(src, t0, o, dest, nodes);
    src.start(t0, Math.random() * 1.5);
    src.stop(end + 0.02);
    src.onended = () => this._disc(nodes);
    return src;
  }

  // FM 音：f ratio index idur（调制深度衰减时间）+ 后级参数
  _fm(dest, t, o) {
    const c = this.ctx;
    const t0 = t + (o.at || 0);
    const p = o.nop ? 1 : this._pm;
    const f = clamp(o.f * p, 1, 20000);
    const car = c.createOscillator();
    car.type = 'sine';
    car.frequency.setValueAtTime(f, t0);
    const mod = c.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(f * (o.ratio || 2), t0);
    const mg = c.createGain();
    const depth = f * (o.ratio || 2) * (o.index ?? 2);
    mg.gain.setValueAtTime(depth, t0);
    mg.gain.exponentialRampToValueAtTime(Math.max(0.01, depth * 0.08), t0 + (o.idur || o.dur));
    mod.connect(mg); mg.connect(car.frequency);
    const nodes = [car, mod, mg];
    const end = this._post(car, t0, o, dest, nodes);
    car.start(t0); mod.start(t0);
    car.stop(end + 0.02); mod.stop(end + 0.02);
    car.onended = () => this._disc(nodes);
    return car;
  }

  // 恐龙吼叫：失真锯齿声带 + 共振峰 + 呼吸噪声 + 次低频；size 越大越低越长
  _roar(dest, t, size, vol = 1) {
    const c = this.ctx;
    const s = clamp(size, 0.4, 2.6);
    const rs = Math.sqrt(s);
    const dur = 0.65 + 0.75 * s;
    const base = (105 / s) * rand(0.92, 1.08);
    const nodes = [];

    const bus = c.createGain();
    bus.gain.value = vol;
    bus.connect(dest);
    nodes.push(bus);

    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(1, t + 0.1 * rs);
    env.gain.linearRampToValueAtTime(0.85, t + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    env.connect(bus);
    nodes.push(env);

    // 声带：三只失谐锯齿 → 颤动 AM → 失真 → 低通 / 共振峰
    const am = c.createGain();
    am.gain.value = 0.65;
    const lfo = c.createOscillator();
    lfo.frequency.value = (26 / Math.pow(s, 0.4)) * rand(0.9, 1.1);
    const lg = c.createGain();
    lg.gain.value = 0.35;
    lfo.connect(lg); lg.connect(am.gain);
    const sh = c.createWaveShaper();
    sh.curve = this._curve(3);
    sh.oversample = '2x';
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(500 / rs, t);
    lp.frequency.exponentialRampToValueAtTime(2200 / rs, t + dur * 0.2);
    lp.frequency.exponentialRampToValueAtTime(450 / rs, t + dur);
    const form = c.createBiquadFilter();
    form.type = 'bandpass';
    form.frequency.value = 620 / rs;
    form.Q.value = 1.2;
    const formG = c.createGain();
    formG.gain.value = 0.6;
    am.connect(sh); sh.connect(lp); lp.connect(env);
    sh.connect(form); form.connect(formG); formG.connect(env);
    nodes.push(am, lg, sh, lp, form, formG);

    const oscs = [lfo];
    for (const det of [-14, 0, 11]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = det + rand(-4, 4);
      o.frequency.setValueAtTime(base * 1.2, t);
      o.frequency.exponentialRampToValueAtTime(base * 1.55, t + dur * 0.2);
      o.frequency.exponentialRampToValueAtTime(base * 1.3, t + dur * 0.65);
      o.frequency.exponentialRampToValueAtTime(base * 0.7, t + dur);
      const og = c.createGain();
      og.gain.value = 0.28;
      o.connect(og); og.connect(am);
      oscs.push(o);
      nodes.push(og);
    }

    // 呼吸噪声
    const nz = c.createBufferSource();
    nz.buffer = this._nb.pink;
    nz.loop = true;
    const nbp = c.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.Q.value = 0.8;
    nbp.frequency.setValueAtTime(900 / rs, t);
    nbp.frequency.exponentialRampToValueAtTime(1400 / rs, t + dur * 0.25);
    nbp.frequency.exponentialRampToValueAtTime(600 / rs, t + dur);
    const ng = c.createGain();
    ng.gain.value = 0.9;
    nz.connect(nbp); nbp.connect(ng); ng.connect(env);
    nodes.push(nbp, ng);

    // 次低频
    const sub = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(base * 0.5, t);
    sub.frequency.exponentialRampToValueAtTime(base * 0.3, t + dur);
    const sg = c.createGain();
    sg.gain.value = 0.55;
    sub.connect(sg); sg.connect(env);
    nodes.push(sg);
    oscs.push(sub);

    const stopAt = t + dur + 0.05;
    for (const o of oscs) { o.start(t); o.stop(stopAt); nodes.push(o); }
    nz.start(t, Math.random()); nz.stop(stopAt);
    nodes.push(nz);
    sub.onended = () => this._disc(nodes);
  }

  // ---------------------------------------------------------------
  //  音乐
  // ---------------------------------------------------------------
  _fadeOutTrack(tr, fade) {
    if (!tr || !this.ctx) return;
    const t = this.ctx.currentTime;
    const f = Math.max(0.05, fade);
    try {
      tr.g.gain.cancelScheduledValues(t);
      tr.g.gain.setValueAtTime(tr.g.gain.value, t);
      tr.g.gain.linearRampToValueAtTime(0, t + f);
    } catch (e) { /* ignore */ }
    const h = setTimeout(() => this._disc([tr.g, tr.send]), (f + 3) * 1000);
    if (h && h.unref) h.unref();
  }

  // 根据主题名生成确定性的 8 小节旋律（AA'BB'AA'C + 终止式）
  _compose(name, T) {
    const rng = mulberry32(hashStr(name) ^ 0x9e3779b9);
    const pick = (a) => a[Math.floor(rng() * a.length)];
    const R = RHYTHMS[T.density || 'medium'];
    const lim = (d) => clamp(d, -2, 7);
    const mkContour = (r) => {
      let d = pick([0, 2, 4, 2]);
      const out = [];
      for (let i = 0; i < r.length; i++) {
        if (i) d = lim(d + pick([-2, -1, -1, 1, 1, 2, 0, 3, -3]));
        out.push(d);
      }
      return out;
    };
    const vary = (cn) => cn.map((d, i) => (i >= cn.length - 2 && rng() < 0.7 ? lim(d + pick([-2, -1, 1, 2])) : d));
    const rA = pick(R), rB = pick(R), rC = pick(R);
    const cA = mkContour(rA), cB = mkContour(rB), cC = mkContour(rC);
    const plan = [[rA, cA], [rA, vary(cA)], [rB, cB], [rB, vary(cB)], [rA, cA], [rA, vary(cA)], [rC, cC], null];
    const bars = [];
    for (let b = 0; b < 8; b++) {
      const bar = new Array(16).fill(null);
      const cd = T.prog[b % T.prog.length];
      let r, cn;
      if (plan[b]) [r, cn] = plan[b];
      else { r = [0, 4, 8]; cn = [4, 2, 0]; } // 终止：五度 → 三度 → 根音（长音）
      for (let i = 0; i < r.length; i++) {
        const s = r[i];
        let deg = cd + cn[i];
        if (s % 8 === 0) deg = nearestChordTone(deg, cd);
        let m = degMidi(T, deg) + 12 * (T.melOct ?? 1);
        if (T.pent) m = snapPent(m, T);
        const next = i + 1 < r.length ? r[i + 1] : 16;
        bar[s] = { m, d: Math.min(next - s, T.maxLen || 8) };
      }
      bars.push(bar);
    }
    return { bars };
  }

  _tick() {
    const tr = this._track, c = this.ctx;
    if (!tr || !c) return;
    const now = c.currentTime;
    if (tr.nextTime < now - 0.25) tr.nextTime = now + 0.05; // 标签页休眠后重新对齐
    const sd = 60 / tr.T.bpm / 4;
    let guard = 0;
    while (tr.nextTime < now + 0.12 && guard++ < 24) {
      try { this._scheduleStep(tr, tr.step, tr.nextTime); } catch (e) { if (this.debug) console.warn('[audio] music', e); }
      tr.nextTime += sd;
      tr.step++;
    }
  }

  _scheduleStep(tr, step, t) {
    const T = tr.T, out = tr.g;
    const s = step % 16;
    const barAbs = Math.floor(step / 16);
    const bar = barAbs % 8;
    const phrase = Math.floor(barAbs / 8);
    const sd = 60 / T.bpm / 4;
    const tt = T.swing && (s & 1) ? t + T.swing * sd : t;
    const cd = T.prog[bar % T.prog.length];
    const chord = [0, 2, 4].map((k) => degMidi(T, cd + k));
    this._pm = 1;

    // 鼓
    const dr = bar === 7 && s >= 8 && T.fill ? T.fill : T.drums;
    if (dr) {
      for (const k in dr) {
        const ch = dr[k][s];
        if (ch && ch !== '.') this._drum(k, tt, ch === 'x' ? 1 : ch === 'X' ? 1.3 : 0.5, out);
      }
    }
    if (T.crash && s === 0 && bar === 0 && phrase > 0) this._drum('crash', t, 0.8, out);

    // 贝斯
    if (T.bass && T.bassPat) {
      const ch = T.bassPat[s];
      if (ch && ch !== '.') {
        let len = 1;
        while (s + len < 16 && T.bassPat[s + len] === '.') len++;
        len = Math.min(len, T.bassHold || 4);
        const bo = 12 * (T.bassOct || 0);
        const r = degMidi(T, cd) + bo;
        const m = ch === 'F' ? r + 7 : ch === 'O' ? r + 12 : ch === 'T' ? chord[1] + bo : r;
        this._mNote(T.bass, m, tt, len * sd, T.bassVol ?? 1, out);
      }
    }

    // 铺底和弦
    const pe = T.padEvery || 16;
    if (T.pad && s % pe === 0) {
      const notes = T.pad === 'distPad' ? [chord[0], chord[0] + 7] : chord;
      for (const m of notes) this._mNote(T.pad, m + 12 * (T.padOct || 0), t, pe * sd, T.padVol ?? 1, out);
    }

    // 琶音
    if (T.arp && T.arpPat) {
      const ch = T.arpPat[s];
      if (ch && ch !== '.') {
        const i = +ch;
        const m = (i < 3 ? chord[i] : chord[i - 3] + 12) + 12 * (T.arpOct || 0);
        this._mNote(T.arp, m, tt, sd * (T.arpLen || 2), T.arpVol ?? 0.5, out);
      }
    }

    // 旋律（奇数乐句加入高八度和声）
    if (!(phrase === 0 && bar < (T.intro || 0))) {
      const n = tr.song.bars[bar][s];
      if (n) {
        this._mNote(T.lead, n.m, tt, n.d * sd * 0.92, T.leadVol ?? 1, out);
        if (T.lead2 && phrase % 2 === 1) this._mNote(T.lead2, n.m + 12, tt, n.d * sd * 0.9, T.lead2Vol ?? 0.5, out);
      }
    }
  }

  // 乐器
  _mNote(inst, midi, t, dur, vel, out) {
    const f = mtof(midi);
    switch (inst) {
      case 'pluck':
        this._tone(out, t, { type: 'triangle', f, dur: Math.min(dur + 0.3, 1.2), v: 0.3 * vel, a: 0.004 });
        this._tone(out, t, { type: 'sawtooth', f: f * 1.003, dur: Math.min(dur + 0.2, 0.8), v: 0.1 * vel, a: 0.004, ft: 'lowpass', ff: 2800, ff2: 300, fsweep: 0.4 });
        break;
      case 'marimba':
        this._tone(out, t, { type: 'sine', f, dur: 0.6, v: 0.42 * vel, a: 0.002 });
        this._tone(out, t, { type: 'sine', f: f * 3.99, dur: 0.12, v: 0.1 * vel, a: 0.001 });
        break;
      case 'bell':
        this._fm(out, t, { f, ratio: 3.5, index: 2.2, idur: 0.6, dur: Math.max(1.4, dur), v: 0.18 * vel, a: 0.002 });
        break;
      case 'brass': {
        const b = { type: 'sawtooth', f, dur: dur + 0.12, a: 0.03, hold: dur * 0.7, ft: 'lowpass', ff: 500, ff2: 2600, fsweep: 0.08, q: 1.5 };
        this._tone(out, t, { ...b, v: 0.13 * vel });
        this._tone(out, t, { ...b, detune: 7, v: 0.1 * vel });
        break;
      }
      case 'lead':
        this._tone(out, t, { type: 'square', f, dur: dur + 0.08, a: 0.01, hold: dur * 0.8, v: 0.1 * vel, ft: 'lowpass', ff: 2600, vib: 5.5, vibd: 8 });
        break;
      case 'reed':
        this._tone(out, t, { type: 'sawtooth', f, dur: dur + 0.1, a: 0.03, hold: dur * 0.75, v: 0.2 * vel, ft: 'bandpass', ff: 1400, q: 1.5, vib: 5, vibd: 12 });
        break;
      case 'flute':
        this._tone(out, t, { type: 'sine', f, dur: dur + 0.12, a: 0.05, hold: dur * 0.7, v: 0.2 * vel, vib: 5, vibd: 10 });
        this._tone(out, t, { type: 'triangle', f: f * 2, dur: dur + 0.1, a: 0.05, hold: dur * 0.6, v: 0.03 * vel });
        this._noise(out, t, { ft: 'bandpass', ff: Math.min(f * 2, 12000), q: 5, dur: dur * 0.6 + 0.05, a: 0.03, v: 0.04 * vel });
        break;
      case 'strings':
        for (const d of [-9, 0, 9]) {
          this._tone(out, t, { type: 'sawtooth', f, detune: d, dur: dur + 0.45, a: Math.min(0.35, dur * 0.3), hold: dur * 0.6, v: 0.05 * vel, ft: 'lowpass', ff: 1600, q: 0.5 });
        }
        break;
      case 'airPad':
        for (const d of [-6, 6]) {
          this._tone(out, t, { type: 'sawtooth', f, detune: d, dur: dur + 1.2, a: Math.min(0.8, dur * 0.4), hold: Math.max(0, dur - 0.8), v: 0.04 * vel, ft: 'lowpass', ff: 2400, trem: 0.3, tremd: 0.3 });
        }
        this._tone(out, t, { type: 'sine', f: f * 2, dur: dur + 1.2, a: 0.8, hold: Math.max(0, dur - 0.8), v: 0.035 * vel });
        break;
      case 'warmPad':
        for (const d of [-5, 5]) {
          this._tone(out, t, { type: 'triangle', f, detune: d, dur: dur + 0.6, a: 0.4, hold: Math.max(0, dur - 0.4), v: 0.08 * vel, ft: 'lowpass', ff: 1200 });
        }
        this._tone(out, t, { type: 'sine', f: f * 0.5, dur: dur + 0.6, a: 0.4, hold: Math.max(0, dur - 0.4), v: 0.05 * vel });
        break;
      case 'darkPad':
        for (const d of [-7, 7]) {
          this._tone(out, t, { type: 'sawtooth', f, detune: d, dur: dur + 0.7, a: 0.5, hold: Math.max(0, dur - 0.5), v: 0.07 * vel, ft: 'lowpass', ff: 500, q: 2 });
        }
        break;
      case 'choir':
        this._tone(out, t, { type: 'sawtooth', f, detune: -8, dur: dur + 0.7, a: 0.4, hold: Math.max(0, dur - 0.4), v: 0.1 * vel, ft: 'bandpass', ff: 750, q: 3, vib: 5.5, vibd: 12 });
        this._tone(out, t, { type: 'sawtooth', f, detune: 8, dur: dur + 0.7, a: 0.45, hold: Math.max(0, dur - 0.45), v: 0.07 * vel, ft: 'bandpass', ff: 1150, q: 4, vib: 5, vibd: 12 });
        this._tone(out, t, { type: 'triangle', f, dur: dur + 0.7, a: 0.4, hold: Math.max(0, dur - 0.4), v: 0.05 * vel });
        break;
      case 'distPad':
        this._tone(out, t, { type: 'sawtooth', f, dur: dur + 0.05, a: 0.01, hold: dur * 0.85, v: 0.06 * vel, shape: 4, ft: 'lowpass', ff: 1700 });
        break;
      case 'bassSub':
        this._tone(out, t, { type: 'sine', f, dur: dur + 0.1, a: 0.01, hold: dur * 0.7, v: 0.45 * vel });
        this._tone(out, t, { type: 'triangle', f, dur: dur + 0.1, a: 0.01, hold: dur * 0.6, v: 0.1 * vel });
        break;
      case 'bassPluck':
        this._tone(out, t, { type: 'sawtooth', f, dur: Math.min(dur, 0.6) + 0.1, a: 0.004, v: 0.28 * vel, ft: 'lowpass', ff: 1400, ff2: 220, fsweep: 0.25, q: 4 });
        this._tone(out, t, { type: 'sine', f, dur: Math.min(dur, 0.6) + 0.1, a: 0.004, v: 0.32 * vel });
        break;
      case 'bassDist':
        this._tone(out, t, { type: 'sawtooth', f, dur: dur + 0.04, a: 0.005, hold: dur * 0.8, v: 0.16 * vel, shape: 5, ft: 'lowpass', ff: 900, q: 2 });
        this._tone(out, t, { type: 'square', f: f * 0.5, dur: dur + 0.04, a: 0.005, hold: dur * 0.8, v: 0.12 * vel, ft: 'lowpass', ff: 300 });
        break;
      case 'lowPluck':
        this._tone(out, t, { type: 'triangle', f, f2: f * 0.98, dur: Math.min(dur + 0.2, 0.9), a: 0.004, v: 0.38 * vel, ft: 'lowpass', ff: 900 });
        break;
      default:
        this._tone(out, t, { type: 'triangle', f, dur: dur + 0.1, v: 0.2 * vel });
    }
  }

  // 鼓组
  _drum(kind, t, vel, out) {
    switch (kind) {
      case 'kick':
        this._tone(out, t, { type: 'sine', f: 150, f2: 42, sweep: 0.12, dur: 0.38, v: 0.85 * vel, a: 0.002 });
        this._noise(out, t, { ft: 'highpass', ff: 3000, dur: 0.015, v: 0.18 * vel, a: 0.001 });
        break;
      case 'boom':
        this._tone(out, t, { type: 'sine', f: 110, f2: 30, sweep: 0.3, dur: 0.9, v: 1 * vel, a: 0.002 });
        this._noise(out, t, { color: 'brown', ft: 'lowpass', ff: 200, dur: 0.5, v: 0.5 * vel });
        break;
      case 'snare':
        this._noise(out, t, { ft: 'highpass', ff: 1500, dur: 0.18, v: 0.32 * vel, a: 0.001 });
        this._tone(out, t, { type: 'triangle', f: 200, f2: 160, dur: 0.1, v: 0.28 * vel, a: 0.001 });
        break;
      case 'clap':
        for (let i = 0; i < 3; i++) this._noise(out, t, { at: i * 0.012, ft: 'bandpass', ff: 1400, q: 1.2, dur: i === 2 ? 0.15 : 0.02, v: 0.28 * vel, a: 0.001 });
        break;
      case 'hat':
        this._noise(out, t, { ft: 'highpass', ff: 7500, dur: 0.045, v: 0.14 * vel, a: 0.001 });
        break;
      case 'ohat':
        this._noise(out, t, { ft: 'highpass', ff: 7000, dur: 0.25, v: 0.1 * vel, a: 0.001 });
        break;
      case 'tom':
        this._tone(out, t, { type: 'sine', f: 170, f2: 85, sweep: 0.2, dur: 0.32, v: 0.6 * vel, a: 0.002 });
        this._noise(out, t, { color: 'brown', ft: 'lowpass', ff: 400, dur: 0.08, v: 0.2 * vel });
        break;
      case 'tomHi':
        this._tone(out, t, { type: 'sine', f: 260, f2: 140, sweep: 0.15, dur: 0.22, v: 0.5 * vel, a: 0.002 });
        break;
      case 'dum':
        this._tone(out, t, { type: 'sine', f: 105, f2: 68, sweep: 0.15, dur: 0.4, v: 0.7 * vel, a: 0.002 });
        this._noise(out, t, { color: 'brown', ft: 'lowpass', ff: 500, dur: 0.06, v: 0.2 * vel });
        break;
      case 'tek':
        this._noise(out, t, { ft: 'bandpass', ff: 3200, q: 1.5, dur: 0.05, v: 0.32 * vel, a: 0.001 });
        this._tone(out, t, { type: 'sine', f: 720, f2: 600, dur: 0.05, v: 0.14 * vel, a: 0.001 });
        break;
      case 'shaker':
        this._noise(out, t, { ft: 'bandpass', ff: 6500, q: 1.5, dur: 0.07, v: 0.16 * vel, a: 0.012 });
        break;
      case 'rim':
        this._tone(out, t, { type: 'square', f: 820, dur: 0.025, v: 0.1 * vel, a: 0.001, ft: 'bandpass', ff: 1600 });
        this._noise(out, t, { ft: 'bandpass', ff: 2500, q: 4, dur: 0.03, v: 0.18 * vel, a: 0.001 });
        break;
      case 'toll':
        this._fm(out, t, { f: 65, ratio: 1.4, index: 3, idur: 1.5, dur: 3.5, v: 0.3 * vel, a: 0.003 });
        this._tone(out, t, { type: 'sine', f: 65, dur: 3, v: 0.18 * vel });
        break;
      case 'crash':
        this._noise(out, t, { ft: 'highpass', ff: 4500, dur: 1.4, v: 0.18 * vel, a: 0.002 });
        break;
      default:
        break;
    }
  }
}

export const audio = new AudioSystem();
export default audio;
