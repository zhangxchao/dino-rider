// 本地存档（localStorage）
import { LEVELS, UPGRADES } from './data.js';

const KEY = 'dino-rider-save-v1';

function defaults() {
  return {
    coins: 0,
    unlocked: 1,                       // 已解锁关卡数
    stars: LEVELS.map(() => 0),
    bestTime: LEVELS.map(() => 0),
    upgrades: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])),
    dino: 'trex',
    rider: 'knight',
    cleared: false,                    // 是否已通关全部关卡
    endlessBest: 0,
    stats: { kills: 0, bosses: 0, plays: 0, wins: 0 },
    dinoWins: {},                      // 每只恐龙的胜场
    settings: { music: 0.55, sfx: 0.8, quality: 'high', sensitivity: 1, shake: false, invertY: false, touch: 'auto', autoRes: true, showFps: false, fx: 'medium' },
  };
}

function load() {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    return {
      ...d, ...s,
      stars: LEVELS.map((_, i) => (s.stars && s.stars[i]) || 0),
      bestTime: LEVELS.map((_, i) => (s.bestTime && s.bestTime[i]) || 0),
      upgrades: { ...d.upgrades, ...(s.upgrades || {}) },
      stats: { ...d.stats, ...(s.stats || {}) },
      settings: { ...d.settings, ...(s.settings || {}) },
      dinoWins: { ...(s.dinoWins || {}) },
      // 新增关卡后：已经通关原最后一关的老存档，自动解锁新关卡
      unlocked: Math.min(LEVELS.length, Math.max(s.unlocked || 1, ...LEVELS.map((_, i) => ((s.stars && s.stars[i]) > 0 ? i + 2 : 1)))),
    };
  } catch {
    return d;
  }
}

export const save = load();

export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* 隐私模式等情况下忽略 */ }
}

export function resetSave() {
  const d = defaults();
  d.settings = save.settings;
  Object.keys(save).forEach((k) => delete save[k]);
  Object.assign(save, d);
  persist();
}
