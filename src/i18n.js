// 多语言：界面文案 t(key, params) + 游戏数据（恐龙 / 骑手 / 怪物名等）的就地替换
//   data.js 中的中文是原文；切换语言时把译文写回这些数据对象，其他模块照常读取 def.name 即可。
import { DINOS, RIDERS, ENEMIES, BOSSES, LEVELS, WEAPON_LEVELS, GATES, BIOME_NAMES, UPGRADES } from './data.js';
import { save, persist } from './save.js';
import zh from './locales/zh-CN.js';
import en from './locales/en.js';
import ja from './locales/ja.js';

export const LANGS = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
];
const PACKS = { 'zh-CN': zh, en, ja };

const byId = (arr) => Object.fromEntries(arr.filter(Boolean).map((x) => [x.id, x]));
const DATA_TARGETS = {
  dinos: byId(DINOS), riders: byId(RIDERS), enemies: ENEMIES, bosses: BOSSES, levels: byId(LEVELS),
  weaponLevels: WEAPON_LEVELS, gates: GATES, biomes: BIOME_NAMES, upgrades: byId(UPGRADES),
};

// 按译文的结构从 data.js 读出中文原文，切回中文时用它还原
function snapshot(target, shape) {
  const out = {};
  for (const k of Object.keys(shape)) {
    if (target[k] == null) continue;
    out[k] = shape[k] && typeof shape[k] === 'object' ? snapshot(target[k], shape[k]) : target[k];
  }
  return out;
}
function patch(target, src) {
  for (const k of Object.keys(src)) {
    if (target[k] == null) continue;
    if (src[k] && typeof src[k] === 'object') patch(target[k], src[k]);
    else target[k] = src[k];
  }
}
zh.data = {};
for (const pack of Object.values(PACKS)) {
  for (const [sec, shape] of Object.entries(pack.data || {})) {
    zh.data[sec] = { ...snapshot(DATA_TARGETS[sec], shape), ...(zh.data[sec] || {}) };
  }
}

let lang = 'zh-CN';
let dict = zh.ui;

export function detectLang() {
  const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']);
  for (const raw of list) {
    const l = String(raw).toLowerCase();
    if (l.startsWith('zh')) return 'zh-CN';
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('en')) return 'en';
  }
  return 'en';
}

export function getLang() { return lang; }

export function t(key, params) {
  let s = dict[key] ?? zh.ui[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m));
  return s;
}

export function setLang(id, { store = true } = {}) {
  if (!PACKS[id]) id = 'zh-CN';
  lang = id;
  dict = PACKS[id].ui;
  // 先还原中文，再覆盖译文（译文缺失的条目自动回退为中文）
  for (const [sec, src] of Object.entries(zh.data)) patch(DATA_TARGETS[sec], src);
  if (id !== 'zh-CN') for (const [sec, src] of Object.entries(PACKS[id].data || {})) patch(DATA_TARGETS[sec], src);
  document.documentElement.lang = id;
  document.documentElement.dataset.lang = id;
  document.title = t('doc.title');
  if (store) { save.settings.lang = id; persist(); }
}

setLang(save.settings.lang || detectLang(), { store: false });
