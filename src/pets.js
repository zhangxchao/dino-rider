// 宠物模式的规则：买宠物 / 喂饲料 / 成长 / 住所 / 装备 / 技能。界面只调用这里，不直接改存档。
import { PETS, PET_RULES, HABITATS, FEEDS, GEM, gemBagTotal } from './data.js';
import { save, persist } from './save.js';
import { today } from './meta.js';

export const petDef = (id) => PETS.find((p) => p.id === id) || null;
export const ownedPet = (id) => (save.pets.owned[id] || null);
export const isAdult = (id) => { const o = ownedPet(id); return !!o && o.feeds >= PET_RULES.feedsToAdult; };
export const adultPets = () => PETS.filter((p) => isAdult(p.id));

/** 今天还能喂几次（跨天自动清零；按本机日历天，和每日任务同一套日期） */
export function feedsLeft(id) {
  const o = ownedPet(id);
  if (!o) return 0;
  const day = today();
  return Math.max(0, PET_RULES.feedsPerDay - (o.day === day ? o.today : 0));
}

const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

export function buyPet(id) {
  const def = petDef(id);
  if (!def) return fail('unknown');
  if (ownedPet(id)) return fail('owned');
  if (save.coins < PET_RULES.petPrice) return fail('coins', { need: PET_RULES.petPrice - save.coins });
  save.coins -= PET_RULES.petPrice;
  save.pets.owned[id] = { feeds: 0, day: '', today: 0, habitat: 'lawn' };
  if (!save.pets.active) save.pets.active = id;
  persist();
  return { ok: true };
}

export function feedPet(id) {
  const o = ownedPet(id);
  const def = petDef(id);
  if (!o || !def) return fail('unknown');
  if (o.feeds >= PET_RULES.feedsToAdult) return fail('adult');
  if (feedsLeft(id) <= 0) return fail('daily');
  if (save.coins < PET_RULES.feedPrice) return fail('coins', { need: PET_RULES.feedPrice - save.coins });
  const day = today();
  save.coins -= PET_RULES.feedPrice;
  if (o.day !== day) { o.day = day; o.today = 0; }
  o.today++;
  o.feeds++;
  const grew = o.feeds >= PET_RULES.feedsToAdult;
  persist();
  return { ok: true, grew, feed: FEEDS[def.feed] };
}

export function buyHabitat(id) {
  const h = HABITATS.find((x) => x.id === id);
  if (!h) return fail('unknown');
  if (save.pets.habitats.includes(id)) return fail('owned');
  if (save.coins < h.price) return fail('coins', { need: h.price - save.coins });
  save.coins -= h.price;
  save.pets.habitats.push(id);
  persist();
  return { ok: true };
}

export function setHabitat(petId, habitatId) {
  const o = ownedPet(petId);
  if (!o || !save.pets.habitats.includes(habitatId)) return false;
  o.habitat = habitatId;
  persist();
  return true;
}

/**
 * 装备 / 技能（slot = 'gear' | 'skill'）一次只能带一个，买了就带上：
 * 点另一件会换过去（原来那件还没用过，全额退款）；再点同一件就是取消并退款。
 */
export function toggleSlot(slot, id) {
  const cur = save.pets[slot];
  if (cur === id) { save.coins += PET_RULES.gearPrice; save.pets[slot] = null; persist(); return { ok: true, action: 'unequip' }; }
  const refund = cur ? PET_RULES.gearPrice : 0;
  if (save.coins + refund < PET_RULES.gearPrice) return fail('coins', { need: PET_RULES.gearPrice - save.coins - refund });
  save.coins += refund - PET_RULES.gearPrice;
  save.pets[slot] = id;
  persist();
  return { ok: true, action: cur ? 'swap' : 'equip' };
}

export function buyGem(color) {
  if (save.coins < GEM.price) return fail('coins', { need: GEM.price - save.coins });
  save.coins -= GEM.price;
  save.gems[color] = (save.gems[color] || 0) + 1;
  persist();
  return { ok: true, total: gemBagTotal(save.gems) };
}
