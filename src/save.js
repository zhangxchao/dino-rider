// 本地存档（localStorage）
import { LEVELS, UPGRADES, upgradeCost, GEM, GEM_COLORS, emptyGemBag, gemColor } from './data.js';

const KEY = 'dino-rider-save-v1';

function defaultPets() {
  return {
    owned: {},                         // id -> { feeds, day, today, habitat }
    habitats: ['lawn'],                // 已拥有的住所（草坪免费）
    rider: 'kidBoy',                   // 小骑手：kidBoy / kidGirl
    gear: null,                        // 这一局带的装备（普通骑手的武器），一局用完就没了
    skill: null,                       // 这一局带的技能（普通骑手的被动），一局用完就没了
    active: null,                      // 当前出战的宠物
  };
}

function normalizePets(p) {
  const d = defaultPets();
  const o = p && typeof p === 'object' ? p : {};
  const owned = {};
  for (const [id, v] of Object.entries(o.owned || {})) {
    if (!v || typeof v !== 'object') continue;
    owned[id] = { feeds: Math.max(0, v.feeds | 0), day: String(v.day || ''), today: Math.max(0, v.today | 0), habitat: v.habitat || 'lawn' };
  }
  return {
    ...d, ...o, owned,
    habitats: Array.from(new Set(['lawn', ...(Array.isArray(o.habitats) ? o.habitats : [])])),
  };
}

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
    gems: emptyGemBag(),               // 宝石袋：按颜色计数，还没镶嵌的
    dinoGems: {},                      // 每只恐龙镶嵌的宝石颜色（数组，最多 5 颗）
    dinoSkin: {},                      // 每只恐龙当前穿的皮肤
    pets: defaultPets(),               // 宠物模式：拥有的宠物、住所、选好的骑手 / 装备 / 技能
    tutorialDone: false,               // 新手引导是否完成
    tutUlt: false,                     // 是否提示过觉醒
    life: {},                          // 累计统计（成就用）：perfect / ult / gate / coin / bestCombo …
    achv: {},                          // 成就状态：id -> 'done' | 'claimed'
    daily: null,                       // 每日任务 { date, list }
    settings: { music: 0.55, sfx: 0.8, quality: 'high', sensitivity: 1, shake: false, invertY: false, touch: 'auto', autoRes: true, showFps: false, fx: 'medium', difficulty: 'medium', vibrate: true, reduceMotion: false, mute: false },
  };
}

// 老存档里宝石是一颗普通的、不记颜色的计数。读档时改成蓝色，数量和已镶嵌的颗数都不变。
function normalizeGems(s) {
  const bag = emptyGemBag();
  if (typeof s.gems === 'number') bag.blue = Math.max(0, s.gems | 0);
  else if (s.gems && typeof s.gems === 'object') {
    for (const c of GEM_COLORS) bag[c.id] = Math.max(0, s.gems[c.id] | 0);
  }
  const dinoGems = {};
  for (const [id, v] of Object.entries(s.dinoGems || {})) {
    if (Array.isArray(v)) dinoGems[id] = v.filter((x) => gemColor(x)).slice(0, GEM.max);
    else dinoGems[id] = Array.from({ length: Math.max(0, Math.min(GEM.max, v | 0)) }, () => 'blue');
  }
  return { gems: bag, dinoGems };
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
      ...normalizeGems(s),
      pets: normalizePets(s.pets),
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

/** 这只恐龙镶着的宝石用完即弃，不退回宝石袋 */
export function spendDinoGems(id) {
  const list = save.dinoGems && save.dinoGems[id];
  if (!list || (Array.isArray(list) ? list.length === 0 : !(list | 0))) return false;
  delete save.dinoGems[id];
  return true;
}

/** 宠物模式带的装备和技能是一次性的：一局结束（赢、输、中途退出）后清空，要再买 */
export function spendPetGear() {
  if (!save.pets || (!save.pets.gear && !save.pets.skill)) return false;
  save.pets.gear = null;
  save.pets.skill = null;
  return true;
}

export function resetSave() {
  const d = defaults();
  d.settings = save.settings;
  Object.keys(save).forEach((k) => delete save[k]);
  Object.assign(save, d);
  persist();
}
