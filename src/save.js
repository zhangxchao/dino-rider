// 本地存档（localStorage）
import { LEVELS, UPGRADES, upgradeCost } from './data.js';

const KEY = 'dino-rider-save-v1';

function defaults() {
  return {
    coins: 0,
    unlocked: 1,                       // 已解锁关卡数
    levelOrder: 2,                     // 关卡顺序版本（2 = 由易到难）
    upgradesRefunded: true,            // 升级工坊已移除（老存档读取时退还金币）
    stars: LEVELS.map(() => 0),
    bestTime: LEVELS.map(() => 0),
    upgrades: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])),
    dino: 'trex',
    rider: 'knight',
    cleared: false,                    // 是否已通关全部关卡
    endlessBest: 0,
    stats: { kills: 0, bosses: 0, plays: 0, wins: 0 },
    dinoWins: {},                      // 每只恐龙的胜场
    skins: ['default'],                // 已解锁的皮肤
    gems: 0,                           // 宝石袋里还没镶嵌的宝石
    dinoGems: {},                      // 每只恐龙镶嵌的宝石数
    dinoSkin: {},                      // 每只恐龙当前穿的皮肤
    tutorialDone: false,               // 新手引导是否完成
    tutUlt: false,                     // 是否提示过觉醒
    life: {},                          // 累计统计（成就用）：perfect / ult / gate / coin / bestCombo …
    achv: {},                          // 成就状态：id -> 'done' | 'claimed'
    daily: null,                       // 每日任务 { date, list }
    settings: { music: 0.55, sfx: 0.8, quality: 'high', sensitivity: 1, shake: false, invertY: false, touch: 'auto', autoRes: true, showFps: false, fx: 'medium', difficulty: 'medium', vibrate: true, reduceMotion: false, mute: false },
  };
}

function load() {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    // 关卡改成由易到难的顺序后：把旧存档里按旧顺序记录的星数 / 最佳时间换到新位置
    if ((s.levelOrder || 1) < 2) {
      const OLD = ['jungle', 'desert', 'frost', 'swamp', 'volcano', 'shadow', 'hive'];
      const remap = (arr) => (Array.isArray(arr) ? LEVELS.map((L) => arr[OLD.indexOf(L.biome)] || 0) : arr);
      s.stars = remap(s.stars);
      s.bestTime = remap(s.bestTime);
      s.unlocked = LEVELS.length;
    }
    s.levelOrder = 2;
    // 升级工坊已移除：把买过的升级按原价全部退还成金币（只退一次）
    if (!s.upgradesRefunded && s.upgrades) {
      let refund = 0;
      for (const u of UPGRADES) for (let lv = 0; lv < Math.min(u.max, s.upgrades[u.id] || 0); lv++) refund += upgradeCost(u, lv);
      s.coins = (s.coins || 0) + refund;
      s.upgrades = {};
    }
    s.upgradesRefunded = true;
    return {
      ...d, ...s,
      stars: LEVELS.map((_, i) => (s.stars && s.stars[i]) || 0),
      bestTime: LEVELS.map((_, i) => (s.bestTime && s.bestTime[i]) || 0),
      upgrades: { ...d.upgrades, ...(s.upgrades || {}) },
      stats: { ...d.stats, ...(s.stats || {}) },
      settings: { ...d.settings, ...(s.settings || {}) },
      dinoWins: { ...(s.dinoWins || {}) },
      skins: Array.from(new Set(['default', ...(s.skins || [])])),
      dinoSkin: { ...(s.dinoSkin || {}) },
      gems: Math.max(0, s.gems | 0),
      dinoGems: { ...(s.dinoGems || {}) },
      // 老玩家（玩过至少一局）不再弹新手引导
      tutorialDone: s.tutorialDone ?? ((s.stats && s.stats.plays > 0) || false),
      tutUlt: s.tutUlt ?? ((s.stats && s.stats.plays > 2) || false),
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
