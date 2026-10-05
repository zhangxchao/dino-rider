// =====================================================================
//  长期目标：每日任务 + 成就
//  - 每日任务：每天按日期抽 3 个（全玩家同一天相同），完成后到「任务」界面领取金币
//  - 成就：基于累计统计，达成后领取金币
//  游戏里通过 meta.track(事件, 数量) 上报；完成时回调 onNotify 弹出提示
// =====================================================================
import { save, persist } from './save.js';
import { LEVELS, DINOS } from './data.js';
import { t } from './i18n.js';

// —— 每日任务模板：ev 事件名，goals 三档目标，max=true 表示取单局最大值而不是累加 ——
export const MISSIONS = [
  { id: 'kill', ev: 'kill', icon: '💀', goals: [150, 300, 500] },
  { id: 'combo', ev: 'combo', icon: '🔥', goals: [60, 120, 250], max: true },
  { id: 'gate', ev: 'gate', icon: '🚪', goals: [4, 8, 14] },
  { id: 'boss', ev: 'boss', icon: '👑', goals: [1, 2, 3] },
  { id: 'perfect', ev: 'perfect', icon: '✨', goals: [8, 20, 40] },
  { id: 'coin', ev: 'coin', icon: '🪙', goals: [200, 400, 700] },
  { id: 'ult', ev: 'ult', icon: '🦖', goals: [1, 3, 5] },
  { id: 'win', ev: 'win', icon: '🏆', goals: [1, 2, 3] },
  { id: 'dist', ev: 'dist', icon: '🏃', goals: [1500, 3000, 5000] },
  { id: 'skill', ev: 'skill', icon: '💥', goals: [8, 16, 30] },
  { id: 'elite', ev: 'elite', icon: '⚔️', goals: [2, 5, 9] },
  { id: 'egg', ev: 'egg', icon: '🥚', goals: [1, 2, 4] },
];
const TIER_REWARD = [70, 110, 160];

// —— 成就：check(save) 返回当前进度，goal 目标值 ——
const L = (k) => (save.life && save.life[k]) || 0;
const starsTotal = () => save.stars.reduce((a, b) => a + b, 0);
export const ACHIEVEMENTS = [
  { id: 'firstWin', icon: '🥇', goal: 1, reward: 100, get: () => save.stats.wins },
  { id: 'wins25', icon: '🏆', goal: 25, reward: 400, get: () => save.stats.wins },
  { id: 'kills1k', icon: '💀', goal: 1000, reward: 150, get: () => save.stats.kills },
  { id: 'kills10k', icon: '☠️', goal: 10000, reward: 600, get: () => save.stats.kills },
  { id: 'boss1', icon: '👑', goal: 1, reward: 100, get: () => save.stats.bosses },
  { id: 'boss20', icon: '🐉', goal: 20, reward: 500, get: () => save.stats.bosses },
  { id: 'allLevels', icon: '🗺️', goal: LEVELS.length, reward: 600, get: () => save.stars.filter((s) => s > 0).length },
  { id: 'stars', icon: '⭐', goal: LEVELS.length * 3, reward: 1000, get: starsTotal },
  { id: 'combo200', icon: '🔥', goal: 200, reward: 200, get: () => L('bestCombo') },
  { id: 'combo500', icon: '🌋', goal: 500, reward: 500, get: () => L('bestCombo') },
  { id: 'perfect100', icon: '✨', goal: 100, reward: 250, get: () => L('perfect') },
  { id: 'ult10', icon: '🦖', goal: 10, reward: 200, get: () => L('ult') },
  { id: 'gates100', icon: '🚪', goal: 100, reward: 200, get: () => L('gate') },
  { id: 'endless2k', icon: '♾️', goal: 2000, reward: 250, get: () => save.endlessBest },
  { id: 'endless6k', icon: '🌌', goal: 6000, reward: 700, get: () => save.endlessBest },
  { id: 'dinos5', icon: '🦕', goal: 5, reward: 250, get: () => Object.keys(save.dinoWins).length },
  { id: 'dinosAll', icon: '🦴', goal: DINOS.length, reward: 1200, get: () => Object.keys(save.dinoWins).length },
  { id: 'hardWin', icon: '😈', goal: 1, reward: 400, get: () => L('hardWin') },
  { id: 'rich', icon: '💰', goal: 20000, reward: 500, get: () => L('coin') },
];

// —— 日期与伪随机：同一天抽到的任务固定 ——
export function today(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = (h + 0x6d2b79f5) | 0; let x = Math.imul(h ^ (h >>> 15), 1 | h); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

function rollDaily(date) {
  const rnd = seeded('dr-daily-' + date);
  const pool = MISSIONS.slice();
  const list = [];
  for (let k = 0; k < 3; k++) {
    const m = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    const tier = k === 2 ? 2 : Math.floor(rnd() * 2); // 第三个任务总是难一档
    list.push({ id: m.id, tier, goal: m.goals[tier], prog: 0, claimed: false, notified: false });
  }
  return { date, list };
}

class Meta {
  constructor() {
    this.onNotify = null;
    this.ensure();
  }

  ensure() {
    if (!save.life) save.life = {};
    if (!save.achv) save.achv = {};          // id -> 'done' | 'claimed'
    const d = today();
    if (!save.daily || save.daily.date !== d) { save.daily = rollDaily(d); persist(); }
    return save.daily;
  }

  get daily() { return this.ensure(); }

  /** 上报事件：kill / combo(最大值) / gate / boss / perfect / coin / ult / win / dist / skill / elite / egg / hardWin */
  track(ev, n = 1) {
    const life = save.life;
    if (ev === 'combo') { if (n > (life.bestCombo || 0)) life.bestCombo = n; } else if (ev !== 'dist') life[ev] = (life[ev] || 0) + n;
    const D = this.ensure();
    for (const m of D.list) {
      const tpl = MISSIONS.find((x) => x.id === m.id);
      if (!tpl || tpl.ev !== ev || m.prog >= m.goal) continue;
      m.prog = tpl.max ? Math.max(m.prog, Math.min(m.goal, n)) : Math.min(m.goal, m.prog + n);
      if (m.prog >= m.goal && !m.notified) { m.notified = true; this.notify(`🎯 ${t('meta.done')} ${this.missionText(m)}`); }
    }
    if (ev !== 'kill' && ev !== 'coin') this.checkAchievements();
  }

  checkAchievements() {
    let changed = false;
    for (const a of ACHIEVEMENTS) {
      if (save.achv[a.id]) continue;
      if (a.get() >= a.goal) { save.achv[a.id] = 'done'; changed = true; this.notify(`${a.icon} ${t('meta.achv')} ${t(`meta.a.${a.id}.name`)}`); }
    }
    return changed;
  }

  notify(msg) { if (this.onNotify) this.onNotify(msg); }

  missionText(m) { return t(`meta.m.${m.id}`, { n: m.goal.toLocaleString() }); }
  missionReward(m) { return TIER_REWARD[m.tier] || 80; }

  claimMission(i) {
    const m = this.daily.list[i];
    if (!m || m.claimed || m.prog < m.goal) return 0;
    m.claimed = true;
    const r = this.missionReward(m);
    save.coins += r;
    persist();
    return r;
  }

  claimAchievement(id) {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a || save.achv[id] !== 'done') return 0;
    save.achv[id] = 'claimed';
    save.coins += a.reward;
    persist();
    return a.reward;
  }

  /** 有多少奖励可以领（标题页红点） */
  get claimable() {
    this.checkAchievements();
    return this.daily.list.filter((m) => m.prog >= m.goal && !m.claimed).length + ACHIEVEMENTS.filter((a) => save.achv[a.id] === 'done').length;
  }
}

export const meta = new Meta();
