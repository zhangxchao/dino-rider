// =====================================================================
//  游戏数据：恐龙 / 骑手 / 怪物 / 首领 / 关卡 / 升级
//  所有模块共享这份数据（模型构建、玩法逻辑、界面）。
// =====================================================================

// 近战攻击动作风格（模型动画 & 玩法判定共用）
//   bite 撕咬 | horn 角顶 | claw 爪击 | tail 尾击 | stomp 踩踏 | peck 啄击 | headbutt 头槌
// 技能类型（玩法逻辑实现 / 模型可按类型做专属动画）
//   roar 咆哮 | charge 冲锋 | pounce 飞扑 | spin 旋风 | stomp 震地 | frenzy 狂暴
//   fortress 堡垒 | dive 俯冲 | sonic 音波 | venom 毒液 | wave 音爆 | spikes 尖刺 | sprint 疾跑

export const DINOS = [
  {
    id: 'trex', name: '霸王龙', en: 'Tyrannosaurus Rex', era: '白垩纪晚期',
    desc: '史上最著名的掠食者，巨大的头颅与恐怖咬合力，一口就能撕碎强敌。',
    body: 'theropod', scale: 1.3, riderScale: 1.0,
    features: ['bigHead', 'tinyArms', 'stripes'],
    colors: { main: 0x5f7a3a, belly: 0xd8c79a, accent: 0x34431f, extra: 0x8a5a2a, eye: 0xffc400 },
    stats: { hp: 230, atk: 32, def: 0.2, speed: 9.5, reach: 2.6, atkRate: 0.8 },
    attack: 'bite',
    skill: { type: 'roar', name: '霸王咆哮', desc: '震耳欲聋的咆哮，伤害前方整条道路上的敌人并眩晕 2.5 秒。', cd: 12, power: 1.5, radius: 14, stun: 2.5 },
  },
  {
    id: 'triceratops', name: '三角龙', en: 'Triceratops', era: '白垩纪晚期',
    desc: '三根巨角与坚固颈盾，防御与冲撞兼备的重装战士。',
    body: 'ceratopsian', scale: 1.15, riderScale: 1.0,
    features: ['threeHorns', 'frill'],
    colors: { main: 0x6d7f8f, belly: 0xc9c2a8, accent: 0xc0533a, extra: 0xf1e3c0, eye: 0xffd24a },
    stats: { hp: 250, atk: 24, def: 0.3, speed: 9, reach: 2.2, atkRate: 0.9 },
    attack: 'horn',
    skill: { type: 'charge', name: '三角冲锋', desc: '低头无敌冲锋 1.5 秒，撞飞沿途所有怪物；首领战时射出冲击波。', cd: 8, power: 1.8, dist: 24, speedMul: 2.6 },
  },
  {
    id: 'raptor', name: '迅猛龙', en: 'Velociraptor', era: '白垩纪晚期',
    desc: '聪明敏捷的羽毛猎手，脚上的镰刀爪让猎物闻风丧胆。',
    body: 'theropod', scale: 0.72, riderScale: 0.8,
    features: ['feathers', 'sickleClaw', 'stripes'],
    colors: { main: 0xb5763a, belly: 0xead2a8, accent: 0x5b2e14, extra: 0x2f6f8f, eye: 0xffe14a },
    stats: { hp: 140, atk: 16, def: 0.05, speed: 14, reach: 1.8, atkRate: 1.8 },
    attack: 'claw',
    skill: { type: 'pounce', name: '迅猛飞扑', desc: '高高跃起（空中无敌），落地造成范围伤害并释放冲击波。', cd: 6, power: 2.2, radius: 6, dist: 20 },
  },
  {
    id: 'stegosaurus', name: '剑龙', en: 'Stegosaurus', era: '侏罗纪晚期',
    desc: '背负双排骨板，尾端四根尖刺是它最致命的武器。',
    body: 'stegosaur', scale: 1.1, riderScale: 1.0,
    features: ['plates', 'thagomizer'],
    colors: { main: 0x7a8a4a, belly: 0xd6cfa0, accent: 0xc4553a, extra: 0xe8b04a, eye: 0xffd24a },
    stats: { hp: 240, atk: 22, def: 0.3, speed: 8.5, reach: 2.8, atkRate: 0.85 },
    attack: 'tail',
    skill: { type: 'spin', name: '骨刺旋风', desc: '原地旋转甩尾，三连击周围敌人，还能打散飞来的子弹。', cd: 9, power: 1.3, radius: 8, hits: 3 },
  },
  {
    id: 'brachiosaurus', name: '腕龙', en: 'Brachiosaurus', era: '侏罗纪晚期',
    desc: '高耸入云的巨型植食者，一脚踏下地动山摇。',
    body: 'sauropod', scale: 1.55, riderScale: 1.0,
    features: ['highNeck', 'spots'],
    colors: { main: 0x7d8f9a, belly: 0xd8d2bf, accent: 0x55636e, extra: 0xa3b86a, eye: 0x222222 },
    stats: { hp: 330, atk: 26, def: 0.25, speed: 7.5, reach: 2.6, atkRate: 0.6 },
    attack: 'stomp',
    skill: { type: 'stomp', name: '大地震踏', desc: '人立而起重重踏地，冲击波沿道路向前连续推进。', cd: 12, power: 1.8, radius: 18, waves: 3 },
  },
  {
    id: 'spinosaurus', name: '棘龙', en: 'Spinosaurus', era: '白垩纪中期',
    desc: '背生巨帆的河流霸主，最大的肉食恐龙之一。',
    body: 'theropod', scale: 1.3, riderScale: 1.0,
    features: ['sail', 'crocSnout'],
    colors: { main: 0x4f5f6a, belly: 0xc8bfa8, accent: 0xd46a2a, extra: 0x2a3a44, eye: 0xffb000 },
    stats: { hp: 270, atk: 28, def: 0.15, speed: 10, reach: 2.6, atkRate: 0.95 },
    attack: 'bite',
    skill: { type: 'frenzy', name: '狂暴撕咬', desc: '6 秒内射速翻倍、撕咬加速，并且撕咬可以吸血。', cd: 14, duration: 6, rateMul: 2.2, lifesteal: 0.25 },
  },
  {
    id: 'ankylosaurus', name: '甲龙', en: 'Ankylosaurus', era: '白垩纪晚期',
    desc: '全身披挂骨甲的活体坦克，尾锤能敲碎骨头。',
    body: 'ankylosaur', scale: 1.05, riderScale: 1.0,
    features: ['armor', 'tailClub'],
    colors: { main: 0x8a7a5a, belly: 0xcfc2a0, accent: 0x5a4a3a, extra: 0xb09a6a, eye: 0xffd24a },
    stats: { hp: 245, atk: 22, def: 0.36, speed: 7.5, reach: 2.4, atkRate: 0.8 },
    attack: 'tail',
    skill: { type: 'fortress', name: '铁甲堡垒', desc: '5 秒内减免 80% 伤害，并反弹部分伤害。', cd: 14, duration: 5, reduce: 0.8, thorns: 0.6 },
  },
  {
    id: 'pteranodon', name: '无齿翼龙', en: 'Pteranodon', era: '白垩纪晚期',
    desc: '翱翔天际的翼龙，从高空俯冲轰炸敌人。',
    body: 'pterosaur', scale: 1.0, riderScale: 0.85,
    features: ['wings', 'headCrest'],
    colors: { main: 0x9aa6b8, belly: 0xe8e2d4, accent: 0xd9532b, extra: 0x5a6a84, eye: 0xffd24a },
    stats: { hp: 150, atk: 18, def: 0.05, speed: 13, reach: 2.0, atkRate: 1.3 },
    attack: 'peck',
    skill: { type: 'dive', name: '俯冲轰炸', desc: '冲上高空（无敌）向前方敌人投下炸弹，落地再造成爆炸。', cd: 9, power: 2.4, radius: 9, dist: 24 },
  },
  {
    id: 'parasaurolophus', name: '副栉龙', en: 'Parasaurolophus', era: '白垩纪晚期',
    desc: '头顶长管状冠饰，能吹出响彻山谷的号角声。',
    body: 'ornithopod', scale: 1.05, riderScale: 1.0,
    features: ['tubeCrest', 'stripes'],
    colors: { main: 0x5d8a5a, belly: 0xe0d8b0, accent: 0xd9772b, extra: 0x2f5a3a, eye: 0xffd24a },
    stats: { hp: 200, atk: 18, def: 0.15, speed: 11, reach: 2.2, atkRate: 1.1 },
    attack: 'tail',
    skill: { type: 'sonic', name: '共鸣号角', desc: '向前方释放音波伤害敌人，并回复 30% 生命。', cd: 11, power: 1.4, range: 18, angle: 70, heal: 0.3 },
  },
  {
    id: 'allosaurus', name: '异特龙', en: 'Allosaurus', era: '侏罗纪晚期',
    desc: '侏罗纪的顶级猎手，眼上的小角是它的标志。',
    body: 'theropod', scale: 1.1, riderScale: 1.0,
    features: ['browHorns', 'stripes'],
    colors: { main: 0xa0663a, belly: 0xe6c9a0, accent: 0x5a2e1a, extra: 0xd24a2a, eye: 0xffc400 },
    stats: { hp: 240, atk: 26, def: 0.12, speed: 11, reach: 2.3, atkRate: 1.1 },
    attack: 'bite',
    skill: { type: 'pounce', name: '猎杀突袭', desc: '猛然跃起扑杀，落地撕裂一片区域并释放冲击波。', cd: 7, power: 2.0, radius: 7, dist: 22 },
  },
  {
    id: 'carnotaurus', name: '食肉牛龙', en: 'Carnotaurus', era: '白垩纪晚期',
    desc: '头顶一对牛角的短跑冠军，冲撞力惊人。',
    body: 'theropod', scale: 1.05, riderScale: 1.0,
    features: ['bullHorns', 'tinyArms', 'spots'],
    colors: { main: 0xa3432f, belly: 0xe0b98a, accent: 0x5a1e14, extra: 0xf0d080, eye: 0xffe14a },
    stats: { hp: 190, atk: 25, def: 0.12, speed: 12.5, reach: 2.2, atkRate: 1.1 },
    attack: 'headbutt',
    skill: { type: 'charge', name: '公牛冲撞', desc: '超高速无敌冲撞，撞飞一路上的怪物。', cd: 7, power: 1.7, dist: 28, speedMul: 3 },
  },
  {
    id: 'dilophosaurus', name: '双冠龙', en: 'Dilophosaurus', era: '侏罗纪早期',
    desc: '头顶双冠、颈部张开伞状皮褶，喷射致命毒液。',
    body: 'theropod', scale: 0.9, riderScale: 0.9,
    features: ['doubleCrest', 'neckFrill', 'stripes'],
    colors: { main: 0x6aa04a, belly: 0xefe2a0, accent: 0xe6c43a, extra: 0x8a3ab0, eye: 0xff4a4a },
    stats: { hp: 160, atk: 18, def: 0.08, speed: 12, reach: 2.0, atkRate: 1.3 },
    attack: 'bite',
    skill: { type: 'venom', name: '毒液喷射', desc: '扇形喷出 7 团毒液，命中敌人持续中毒。', cd: 7, power: 1.1, count: 7, spread: 50, poison: 3 },
  },
  {
    id: 'pachycephalosaurus', name: '肿头龙', en: 'Pachycephalosaurus', era: '白垩纪晚期',
    desc: '头顶厚达 25 厘米的骨质圆顶，铁头功天下第一。',
    body: 'ornithopod', scale: 0.95, riderScale: 0.9,
    features: ['dome'],
    colors: { main: 0x7c8a5a, belly: 0xe2d6b0, accent: 0xd9c8a0, extra: 0x4a5a3a, eye: 0xffd24a },
    stats: { hp: 170, atk: 22, def: 0.22, speed: 11, reach: 1.9, atkRate: 1.2 },
    attack: 'headbutt',
    skill: { type: 'charge', name: '铁头猛撞', desc: '低头无敌猛撞，撞飞并眩晕沿途的怪物。', cd: 7, power: 2.2, dist: 20, speedMul: 2.8, stun: 1.5 },
  },
  {
    id: 'iguanodon', name: '禽龙', en: 'Iguanodon', era: '白垩纪早期',
    desc: '最早被命名的恐龙之一，拇指上长着锋利尖刺。',
    body: 'ornithopod', scale: 1.15, riderScale: 1.0,
    features: ['thumbSpike'],
    colors: { main: 0x5f7a8a, belly: 0xd6d0b8, accent: 0x3a4a5a, extra: 0xe0c070, eye: 0xffd24a },
    stats: { hp: 240, atk: 22, def: 0.22, speed: 10, reach: 2.2, atkRate: 1.0 },
    attack: 'claw',
    skill: { type: 'stomp', name: '震地重踏', desc: '重踏地面，冲击波沿道路向前推进，震飞敌人。', cd: 10, power: 1.5, radius: 12, waves: 2 },
  },
  {
    id: 'giganotosaurus', name: '南方巨兽龙', en: 'Giganotosaurus', era: '白垩纪晚期',
    desc: '比霸王龙还要庞大的南美巨兽，怒吼震碎山岳。',
    body: 'theropod', scale: 1.42, riderScale: 1.0,
    features: ['bigHead', 'stripes'],
    colors: { main: 0x7a5a4a, belly: 0xd8c0a0, accent: 0x3a2a2a, extra: 0xa04a3a, eye: 0xff9a00 },
    stats: { hp: 250, atk: 34, def: 0.18, speed: 9.5, reach: 2.8, atkRate: 0.75 },
    attack: 'bite',
    skill: { type: 'roar', name: '巨兽怒吼', desc: '毁天灭地的怒吼，伤害前方所有敌人并眩晕。', cd: 12, power: 1.7, radius: 16, stun: 2 },
  },
  {
    id: 'therizinosaurus', name: '镰刀龙', en: 'Therizinosaurus', era: '白垩纪晚期',
    desc: '拥有近一米长的镰刀巨爪，外表憨厚实则凶猛。',
    body: 'theropod', scale: 1.15, riderScale: 1.0,
    features: ['longClaws', 'feathers', 'potBelly', 'longNeck'],
    colors: { main: 0x8a7a5a, belly: 0xe8dcc0, accent: 0x5a4a3a, extra: 0xe0d0b0, eye: 0xffd24a },
    stats: { hp: 210, atk: 27, def: 0.15, speed: 9.5, reach: 2.4, atkRate: 1.2 },
    attack: 'claw',
    skill: { type: 'frenzy', name: '镰刃乱舞', desc: '6 秒内射速与撕咬速度大增，撕咬吸取生命。', cd: 13, duration: 6, rateMul: 2.4, lifesteal: 0.2 },
  },
  {
    id: 'baryonyx', name: '重爪龙', en: 'Baryonyx', era: '白垩纪早期',
    desc: '长着鳄鱼般的吻部与巨大拇指爪的捕鱼能手。',
    body: 'theropod', scale: 1.1, riderScale: 1.0,
    features: ['crocSnout', 'thumbClaw'],
    colors: { main: 0x5a7a6a, belly: 0xd8d0b0, accent: 0x2a4a5a, extra: 0xb0c080, eye: 0xffc400 },
    stats: { hp: 200, atk: 26, def: 0.14, speed: 10.5, reach: 2.3, atkRate: 1.1 },
    attack: 'claw',
    skill: { type: 'spin', name: '利爪旋风', desc: '挥舞巨爪原地旋转，四连击周围敌人并打散子弹。', cd: 9, power: 1.2, radius: 7, hits: 4 },
  },
  {
    id: 'diplodocus', name: '梁龙', en: 'Diplodocus', era: '侏罗纪晚期',
    desc: '身长三十米的巨龙，鞭子般的长尾能甩出音爆。',
    body: 'sauropod', scale: 1.45, riderScale: 1.0,
    features: ['longNeck', 'whipTail', 'stripes'],
    colors: { main: 0x8a7a6a, belly: 0xe0d6c0, accent: 0x5a4a44, extra: 0x6a8a5a, eye: 0x222222 },
    stats: { hp: 310, atk: 24, def: 0.22, speed: 8, reach: 3.2, atkRate: 0.7 },
    attack: 'tail',
    skill: { type: 'wave', name: '音爆长鞭', desc: '甩尾产生音爆冲击波，贯穿前方所有敌人。', cd: 9, power: 2.0, range: 40, width: 5 },
  },
  {
    id: 'styracosaurus', name: '戟龙', en: 'Styracosaurus', era: '白垩纪晚期',
    desc: '颈盾边缘长满长刺，宛如一顶尖刺王冠。',
    body: 'ceratopsian', scale: 1.05, riderScale: 1.0,
    features: ['noseHorn', 'spikedFrill'],
    colors: { main: 0x9a7a4a, belly: 0xe0d0a8, accent: 0x3a6ab0, extra: 0xf0e0c0, eye: 0xffd24a },
    stats: { hp: 235, atk: 23, def: 0.3, speed: 9.5, reach: 2.2, atkRate: 0.95 },
    attack: 'horn',
    skill: { type: 'spikes', name: '尖刺爆发', desc: '向前方扇形射出 16 根骨刺，贯穿敌人。', cd: 9, power: 1.3, count: 16 },
  },
  {
    id: 'gallimimus', name: '似鸡龙', en: 'Gallimimus', era: '白垩纪晚期',
    desc: '恐龙界的短跑健将，速度快到只剩残影。',
    body: 'theropod', scale: 0.85, riderScale: 0.85,
    features: ['beak', 'feathers', 'longNeck'],
    colors: { main: 0xc9a05a, belly: 0xf2e6c8, accent: 0x7a5a2a, extra: 0x3a8ab0, eye: 0x222222 },
    stats: { hp: 150, atk: 15, def: 0.05, speed: 16, reach: 1.8, atkRate: 1.6 },
    attack: 'peck',
    skill: { type: 'sprint', name: '疾风冲刺', desc: '4 秒内速度激增且无敌，残影灼伤触碰的敌人。', cd: 10, duration: 4, speedMul: 1.8, power: 0.6 },
  },
];

// ---------------------------------------------------------------------
//  骑手：提供远程武器 + 被动加成
//  weapon.type: spear arrow fireball laser bullet shuriken missile ice rock cannon
//  bonus: hp(比例) atk(比例) def(减伤) speed(比例) cdr(比例) crit(暴击率) regen(每秒回血) coins(金币比例)
// ---------------------------------------------------------------------
export const RIDERS = [
  {
    id: 'knight', name: '圣光骑士', en: 'Knight',
    desc: '身披银甲的骑士，投出贯穿敌阵的圣光长枪。',
    colors: { main: 0xc8ccd6, accent: 0x2a4ab0, skin: 0xf2c9a0, extra: 0xffd24a },
    weapon: { type: 'spear', name: '圣光投枪', dmg: 16, cd: 0.75, speed: 44, count: 1, spread: 0, pierce: 3, color: 0xffe27a },
    bonus: { def: 0.08 }, bonusText: '减伤 +8%',
  },
  {
    id: 'elf', name: '精灵弓手', en: 'Elf Archer',
    desc: '森林中的神射手，一次射出三支精灵之箭。',
    colors: { main: 0x3f8a4a, accent: 0x8a5a2a, skin: 0xf6d8b8, extra: 0xf0e070 },
    weapon: { type: 'arrow', name: '三重精灵箭', dmg: 6.5, cd: 0.55, speed: 58, count: 3, spread: 14, color: 0x9cff7a },
    bonus: { crit: 0.15 }, bonusText: '暴击率 +15%',
  },
  {
    id: 'wizard', name: '烈焰法师', en: 'Fire Wizard',
    desc: '掌控火焰的大法师，火球落地爆炸灼烧敌人。',
    colors: { main: 0x6a2ab0, accent: 0xffc400, skin: 0xf2c9a0, extra: 0xeeeeee },
    weapon: { type: 'fireball', name: '爆裂火球', dmg: 15, cd: 0.9, speed: 28, count: 1, aoe: 4, burn: 3, color: 0xff7a2a },
    bonus: { cdr: 0.15 }, bonusText: '技能冷却 -15%',
  },
  {
    id: 'astronaut', name: '太空宇航员', en: 'Astronaut',
    desc: '穿越时空而来的宇航员，激光枪射速惊人。',
    colors: { main: 0xf0f0f0, accent: 0xff7a1a, skin: 0xf2c9a0, extra: 0x46a0ff },
    weapon: { type: 'laser', name: '脉冲激光', dmg: 4.5, cd: 0.16, speed: 85, count: 1, color: 0x46e0ff },
    bonus: { speed: 0.1 }, bonusText: '移动速度 +10%',
  },
  {
    id: 'cowboy', name: '西部牛仔', en: 'Cowboy',
    desc: '荒野快枪手，左轮子弹又快又准。',
    colors: { main: 0x8a5a2a, accent: 0x3a6aa0, skin: 0xe8b890, extra: 0xd0a050 },
    weapon: { type: 'bullet', name: '快枪连射', dmg: 11, cd: 0.33, speed: 75, count: 1, color: 0xffd070 },
    bonus: { crit: 0.2 }, bonusText: '暴击率 +20%',
  },
  {
    id: 'ninja', name: '暗影忍者', en: 'Ninja',
    desc: '来无影去无踪的忍者，手里剑能在敌人间弹射。',
    colors: { main: 0x22242e, accent: 0xd02a3a, skin: 0xf2c9a0, extra: 0xc0c8ff },
    weapon: { type: 'shuriken', name: '弹射手里剑', dmg: 9, cd: 0.4, speed: 42, count: 1, bounce: 3, color: 0xc0c8ff },
    bonus: { speed: 0.15 }, bonusText: '移动速度 +15%',
  },
  {
    id: 'mecha', name: '机甲战士', en: 'Mecha Pilot',
    desc: '驾驶小型机甲的少年，发射自动追踪导弹。',
    colors: { main: 0xe04a3a, accent: 0xf0f0f0, skin: 0xf2c9a0, extra: 0x46e0ff },
    weapon: { type: 'missile', name: '追踪导弹', dmg: 14, cd: 1.0, speed: 30, count: 2, spread: 30, homing: 5, aoe: 3, color: 0xff5a3a },
    bonus: { hp: 0.1 }, bonusText: '最大生命 +10%',
  },
  {
    id: 'princess', name: '冰雪公主', en: 'Ice Princess',
    desc: '来自北境的公主，冰晶魔法能冻结敌人。',
    colors: { main: 0x8ad0ff, accent: 0xffffff, skin: 0xf8dcc8, extra: 0xc0a0ff },
    weapon: { type: 'ice', name: '冰晶之刺', dmg: 11, cd: 0.6, speed: 40, count: 1, slow: 0.5, slowTime: 2.5, color: 0xaaddff },
    bonus: { regen: 1.5 }, bonusText: '每秒回复 1.5 生命',
  },
  {
    id: 'caveman', name: '原始人阿猛', en: 'Caveman',
    desc: '力大无穷的原始部落勇士，投掷巨石砸扁敌人。',
    colors: { main: 0xa06a3a, accent: 0xe0c080, skin: 0xd8a070, extra: 0x5a3a1a },
    weapon: { type: 'rock', name: '投石重击', dmg: 24, cd: 1.1, speed: 26, count: 1, aoe: 3, arc: true, color: 0x9a8a7a },
    bonus: { atk: 0.12 }, bonusText: '近战伤害 +12%',
  },
  {
    id: 'pirate', name: '海盗船长', en: 'Pirate Captain',
    desc: '纵横七海的海盗船长，手持炮弹爆破一切。',
    colors: { main: 0x8a1a2a, accent: 0x1a1a1a, skin: 0xe8b890, extra: 0xffd24a },
    weapon: { type: 'cannon', name: '爆破炮弹', dmg: 30, cd: 1.4, speed: 34, count: 1, aoe: 5, knock: 8, color: 0x333333 },
    bonus: { coins: 0.25 }, bonusText: '金币收益 +25%',
  },
];

// ---------------------------------------------------------------------
//  普通怪物
//  ranged: 远程攻击配置（kind: arrow | spore | orb | fireball | ice）
// ---------------------------------------------------------------------
export const ENEMIES = {
  slime:      { name: '史莱姆',   hp: 36,  dmg: 7,  speed: 4.2, radius: 0.9, atkRange: 1.4, atkCd: 1.3, score: 10, coins: 1, color: 0x5ad06a },
  goblin:     { name: '哥布林',   hp: 50,  dmg: 9,  speed: 5.5, radius: 0.7, atkRange: 1.6, atkCd: 1.1, score: 15, coins: 2, color: 0x7ab03a },
  bat:        { name: '吸血蝙蝠', hp: 28,  dmg: 6,  speed: 7.5, radius: 0.7, atkRange: 1.8, atkCd: 1.0, score: 12, coins: 1, flying: true, hover: 3.2, color: 0x4a3a5a },
  scorpion:   { name: '沙漠巨蝎', hp: 80,  dmg: 12, speed: 5.0, radius: 1.3, atkRange: 2.2, atkCd: 1.4, score: 20, coins: 3, poison: 2, color: 0xb0702a },
  skeleton:   { name: '骷髅战士', hp: 70,  dmg: 11, speed: 4.8, radius: 0.7, atkRange: 1.9, atkCd: 1.2, score: 18, coins: 2, color: 0xe8e2d0 },
  archer:     { name: '骷髅弓手', hp: 45,  dmg: 9,  speed: 4.0, radius: 0.7, atkCd: 2.0, score: 20, coins: 3, color: 0xd8d2c0,
                ranged: { range: 24, speed: 32, kind: 'arrow', color: 0xeeeeee } },
  wolf:       { name: '冰原狼',   hp: 60,  dmg: 10, speed: 8.5, radius: 1.0, atkRange: 1.8, atkCd: 1.0, score: 18, coins: 2, color: 0xc8d8e8 },
  yeti:       { name: '雪怪',     hp: 180, dmg: 18, speed: 4.0, radius: 1.6, atkRange: 2.6, atkCd: 1.8, score: 40, coins: 6, color: 0xf0f4f8 },
  mushroom:   { name: '毒孢菇',   hp: 55,  dmg: 8,  speed: 3.0, radius: 0.9, atkCd: 2.2, score: 18, coins: 2, color: 0xb04ad0,
                ranged: { range: 18, speed: 18, kind: 'spore', color: 0xb070ff, poison: 2 } },
  wisp:       { name: '幽魂鬼火', hp: 40,  dmg: 9,  speed: 6.0, radius: 0.7, atkCd: 2.0, score: 22, coins: 3, flying: true, hover: 2.8, color: 0x7affd0,
                ranged: { range: 20, speed: 22, kind: 'orb', color: 0x7affd0 } },
  imp:        { name: '火焰小鬼', hp: 55,  dmg: 10, speed: 6.5, radius: 0.7, atkCd: 1.8, score: 22, coins: 3, color: 0xe04a1a,
                ranged: { range: 20, speed: 26, kind: 'fireball', color: 0xff6a1a } },
  golem:      { name: '岩石傀儡', hp: 260, dmg: 22, speed: 3.5, radius: 1.8, atkRange: 3.0, atkCd: 2.2, score: 60, coins: 8, color: 0x6a5a50 },
  mage:       { name: '暗影法师', hp: 90,  dmg: 14, speed: 4.5, radius: 0.8, atkCd: 2.4, score: 35, coins: 5, teleport: true, color: 0x6a2ab0,
                ranged: { range: 26, speed: 24, kind: 'orb', color: 0xb04aff, homing: 1.5 } },
  darkKnight: { name: '暗影骑士', hp: 220, dmg: 20, speed: 5.5, radius: 1.1, atkRange: 2.6, atkCd: 1.5, score: 50, coins: 7, color: 0x2a2a3a },
};

// ---------------------------------------------------------------------
//  首领  patterns: slam 重砸 | volley 环形弹幕 | barrage 连续瞄准射击 | summon 召唤
//                  charge 冲撞 | burrow 遁地突袭 | breath 吐息 | meteor 陨石雨
// ---------------------------------------------------------------------
export const BOSSES = {
  spider:     { name: '剧毒蛛后', title: '丛林之主',   hp: 4500, dmg: 18, speed: 6.5, radius: 3.2, height: 4,
                patterns: ['slam', 'volley', 'summon', 'charge'], summon: ['slime', 'goblin'], projColor: 0x9cff3a, color: 0x3a2a4a },
  sandworm:   { name: '沙海巨蠕', title: '沙漠吞噬者', hp: 6500, dmg: 22, speed: 7, radius: 3.0, height: 6,
                patterns: ['burrow', 'volley', 'slam', 'barrage'], summon: ['scorpion'], projColor: 0xffc04a, color: 0xc09060 },
  frostGiant: { name: '冰霜巨人', title: '永冻之王',   hp: 7500, dmg: 26, speed: 5, radius: 3.2, height: 8,
                patterns: ['slam', 'barrage', 'summon', 'volley'], summon: ['wolf'], projColor: 0x9ae0ff, color: 0x8ab8e0 },
  hydra:      { name: '沼泽三头蛇', title: '迷雾梦魇', hp: 9000, dmg: 24, speed: 4.5, radius: 3.5, height: 7,
                patterns: ['breath', 'volley', 'barrage', 'summon'], summon: ['mushroom', 'wisp'], projColor: 0x7aff4a, color: 0x3a6a4a },
  magmaGolem: { name: '熔岩巨魔', title: '火山之心',   hp: 10500, dmg: 30, speed: 5, radius: 3.6, height: 8,
                patterns: ['slam', 'meteor', 'charge', 'volley'], summon: ['imp'], projColor: 0xff6a1a, color: 0x3a2a2a },
  overlord:   { name: '暗影魔王', title: '远古终焉',   hp: 12500, dmg: 32, speed: 6, radius: 3.0, height: 7,
                patterns: ['barrage', 'volley', 'meteor', 'summon', 'charge', 'slam', 'breath'], summon: ['skeleton', 'mage', 'darkKnight'],
                projColor: 0xb04aff, color: 0x1a1024, phases: 3 },
};

// ---------------------------------------------------------------------
//  关卡 / 地形
// ---------------------------------------------------------------------
export const LEVELS = [
  { id: 0, name: '翠绿丛林', biome: 'jungle',  boss: 'spider',     length: 1150,
    desc: '沿着丛林小径一路狂奔，冲破怪物大军，击败剧毒蛛后！',
    pool: { slime: 6, goblin: 3, bat: 2 }, elite: 'goblin', reward: 120, mul: 1.0 },
  { id: 1, name: '炽热沙海', biome: 'desert',  boss: 'sandworm',   length: 1250,
    desc: '烈日下的古道，骷髅与巨蝎挡路，沙虫在沙丘下游走。',
    pool: { scorpion: 3, skeleton: 3, archer: 2, goblin: 2 }, elite: 'scorpion', reward: 180, mul: 1.25 },
  { id: 2, name: '冰封雪原', biome: 'frost',   boss: 'frostGiant', length: 1350,
    desc: '暴风雪中狼群成群扑来，冰霜巨人守在雪道尽头。',
    pool: { wolf: 6, bat: 2 }, elite: 'yeti', reward: 240, mul: 1.5 },
  { id: 3, name: '迷雾沼泽', biome: 'swamp',   boss: 'hydra',      length: 1400,
    desc: '踏过沼泽栈道，毒孢菇与鬼火潜伏在迷雾中。',
    pool: { slime: 3, mushroom: 3, wisp: 2, goblin: 2 }, elite: 'golem', reward: 300, mul: 1.8 },
  { id: 4, name: '熔岩火山', biome: 'volcano', boss: 'magmaGolem', length: 1450,
    desc: '岩浆奔涌的火山大道，火焰小鬼漫天飞舞。',
    pool: { imp: 4, bat: 3, goblin: 2 }, elite: 'golem', reward: 380, mul: 2.1 },
  { id: 5, name: '暗影要塞', biome: 'shadow',  boss: 'overlord',   length: 1550,
    desc: '通往要塞的最后一段路，打倒暗影魔王，拯救远古大陆！',
    pool: { skeleton: 4, archer: 2, mage: 2, wisp: 2 }, elite: 'darkKnight', reward: 500, mul: 2.5 },
];

// 跑道参数
export const RUN_SPEED = 17;      // 前进速度（米/秒）

// ---------------------------------------------------------------------
//  武器成长：击败怪物获得经验，逐级强化骑手武器（每关重新开始）
// ---------------------------------------------------------------------
export const WEAPON_LEVELS = [
  null,
  { dmg: 1.0,  rate: 1.0,  count: 0, pierce: 0, name: '初始武器' },
  { dmg: 1.2,  rate: 1.0,  count: 0, pierce: 0, name: '伤害提升' },
  { dmg: 1.2,  rate: 1.0,  count: 1, pierce: 0, name: '双重弹道' },
  { dmg: 1.2,  rate: 1.15, count: 1, pierce: 0, name: '射速提升' },
  { dmg: 1.3,  rate: 1.15, count: 1, pierce: 1, name: '穿透强化' },
  { dmg: 1.4,  rate: 1.15, count: 2, pierce: 1, name: '三重弹道' },
  { dmg: 1.4,  rate: 1.3,  count: 2, pierce: 1, name: '狂热射击' },
  { dmg: 1.55, rate: 1.3,  count: 2, pierce: 2, name: '破甲之力' },
  { dmg: 1.55, rate: 1.4,  count: 3, pierce: 2, name: '四重弹道' },
  { dmg: 1.75, rate: 1.5,  count: 3, pierce: 3, homing: 2.5, name: '究极武装' },
];
export const WEAPON_MAX = WEAPON_LEVELS.length - 1;
// XP_NEED[lv] = 从 lv 升到 lv+1 所需经验
export const XP_NEED = [0, 16, 26, 36, 48, 60, 72, 86, 100, 118, Infinity];

// 强化门（路上二选一）
export const GATES = {
  count:  { icon: '➕', name: '弹道 +1',    color: 0x3ab8ff },
  rate:   { icon: '⚡', name: '射速 +25%',  color: 0xffc830 },
  dmg:    { icon: '💥', name: '伤害 +30%',  color: 0xff5a3a },
  pierce: { icon: '🗡️', name: '穿透 +1',    color: 0xb070ff },
  heal:   { icon: '❤️', name: '回复 40% 生命', color: 0x50e070 },
  shield: { icon: '🛡️', name: '护盾 8 秒',  color: 0xffe070 },
  skill:  { icon: '✨', name: '技能充能',    color: 0x70e0ff },
  xp:     { icon: '⭐', name: '武器经验 +25', color: 0xfff080 },
  magnet: { icon: '🧲', name: '磁力 10 秒',  color: 0x60a0ff },
  gamble: { icon: '🎲', name: '命运骰子',    color: 0xff60c0 },
};

export const BIOME_NAMES = {
  jungle: '丛林', desert: '沙漠', frost: '雪原', swamp: '沼泽', volcano: '火山', shadow: '暗影',
};

// ---------------------------------------------------------------------
//  永久升级（金币购买，对所有恐龙生效）
// ---------------------------------------------------------------------
export const UPGRADES = [
  { id: 'hp',     icon: '❤️', name: '生命强化', desc: '最大生命 +10%',     max: 10, base: 60, step: 45 },
  { id: 'atk',    icon: '🦷', name: '利齿打磨', desc: '近战伤害 +10%',     max: 10, base: 60, step: 45 },
  { id: 'def',    icon: '🛡️', name: '厚皮护甲', desc: '受到伤害 -4%',       max: 8,  base: 70, step: 55 },
  { id: 'speed',  icon: '💨', name: '疾风之腿', desc: '移动速度 +5%',      max: 6,  base: 50, step: 45 },
  { id: 'rider',  icon: '🎯', name: '骑手特训', desc: '骑手武器伤害 +12%', max: 10, base: 60, step: 45 },
  { id: 'cdr',    icon: '⏳', name: '远古智慧', desc: '技能冷却 -6%',      max: 6,  base: 80, step: 60 },
  { id: 'magnet', icon: '🧲', name: '磁力獠牙', desc: '拾取范围 +25%',     max: 4,  base: 40, step: 40 },
];

export function upgradeCost(up, level) {
  return up.base + up.step * level;
}
