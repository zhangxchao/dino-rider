import { createRequire } from 'module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
import fs from 'fs';
const { DINOS, RIDERS, BALANCE } = await import('/home/user/dino-rider/src/data.js');
const [dId, rId, out] = process.argv.slice(2);
const D = DINOS.find((d) => d.id === dId), R = RIDERS.find((r) => r.id === rId);
const b = R.bonus || {}, s = D.stats;
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const F = {
  hp: (d) => d.stats.hp, atk: (d) => d.stats.atk, dps: (d) => d.stats.atk * d.stats.atkRate,
  spd: (d) => d.stats.speed, def: (d) => d.stats.def, reach: (d) => d.stats.reach,
  rate: (d) => d.stats.atkRate, tough: (d) => d.stats.hp / (1 - d.stats.def), cd: (d) => -d.skill.cd,
};
const rank = (k) => { const v = DINOS.map(F[k]), x = F[k](D); const r = 1 + v.filter((y) => y > x + 1e-9).length; const tie = v.filter((y) => Math.abs(y - x) < 1e-9).length > 1; return (tie ? '并列' : '') + '第 ' + r; };
const max = (k) => Math.max(...DINOS.map(F[k]));
// 配骑手后的实战数值
const hp2 = Math.round(s.hp * (1 + (b.hp || 0)));
const def2 = 1 - (1 - s.def) * (1 - (b.def || 0));
const atk2 = s.atk * (1 + (b.atk || 0));
const spd2 = s.speed * (1 + (b.speed || 0));
const f1 = (x) => (Math.round(x * 10) / 10).toString();
const rows = [
  ['❤️', '血量', 'hp', s.hp, hp2 !== s.hp ? `${hp2}` : null],
  ['⚔️', '攻击', 'atk', s.atk, atk2 !== s.atk ? f1(atk2) : null],
  ['🔥', '每秒近战', 'dps', f1(s.atk * s.atkRate), atk2 !== s.atk ? f1(atk2 * s.atkRate) : null],
  ['🛡️', '减伤', 'def', Math.round(s.def * 100) + '%', def2 !== s.def ? f1(def2 * 100) + '%' : null],
  ['💪', '耐打度', 'tough', Math.round(s.hp / (1 - s.def)), (hp2 !== s.hp || def2 !== s.def) ? Math.round(hp2 / (1 - def2)) : null],
  ['💨', '速度', 'spd', s.speed, spd2 !== s.speed ? f1(spd2) : null],
  ['📏', '攻击距离', 'reach', s.reach, null],
  ['⏱️', '攻速', 'rate', s.atkRate + ' 次/秒', null],
];
const bar = (k) => Math.max(0.06, F[k](D) / max(k));
const SK = D.skill, W = R.weapon;
const skillBits = [`冷却 ${SK.cd} 秒`, `威力 ×${SK.power}`, SK.radius && `范围 ${SK.radius}`, SK.dist && `突进 ${SK.dist}`, SK.stun && `眩晕 ${SK.stun} 秒`].filter(Boolean);
const wDmg = W.dmg * BALANCE.riderDmg;
const wBits = [
  ['单发伤害', f1(wDmg)], ['每轮发射', `${W.count} 发`], ['冷却', `${W.cd} 秒`],
  ['每秒伤害', f1(wDmg * W.count / W.cd)],
  W.pierce && ['贯穿', `${W.pierce} 个敌人`], W.homing && ['追踪', '自动锁定'], W.aoe && ['爆炸范围', W.aoe],
  W.spread ? ['散射角', `${W.spread}°`] : null,
].filter(Boolean);
const main = hex(D.colors.main), accent = hex(R.colors.extra || R.colors.main), wcol = hex(W.color);
const hero = fs.readFileSync(`/home/user/dino-rider/cards/hero-${dId}.png`).toString('base64');
const no = String(DINOS.indexOf(D) + 1).padStart(3, '0');
const tough2 = hp2 / (1 - def2), wDps = wDmg * W.count / W.cd;
const power = Math.round((tough2 + atk2 * s.atkRate * 10 + wDps * 10 + spd2 * 10) * 3);
// 六维雷达：各项 / 全体最高
const AX = [['血量', 'hp'], ['攻击', 'atk'], ['攻速', 'rate'], ['速度', 'spd'], ['攻距', 'reach'], ['减伤', 'def']];
const RC = 175, RR = 128;
const pt = (i, k) => { const a = -Math.PI / 2 + i * Math.PI / 3; return [RC + Math.cos(a) * RR * k, RC + Math.sin(a) * RR * k]; };
const poly = (f) => AX.map((_, i) => pt(i, f(i)).map((v) => v.toFixed(1)).join(',')).join(' ');
const radar = `<svg viewBox="0 0 350 350" width="350" height="350">
${[1, 0.75, 0.5, 0.25].map((k) => `<polygon points="${poly(() => k)}" fill="${k === 1 ? '#ffffff0d' : 'none'}" stroke="#ffffff30" stroke-width="2"/>`).join('')}
${AX.map((_, i) => { const [x, y] = pt(i, 1); return `<line x1="${RC}" y1="${RC}" x2="${x}" y2="${y}" stroke="#ffffff25" stroke-width="2"/>`; }).join('')}
<polygon points="${poly((i) => Math.max(0.08, F[AX[i][1]](D) / max(AX[i][1])))}" fill="#ffc54899" stroke="#ffe27a" stroke-width="4" stroke-linejoin="round"/>
${AX.map(([n], i) => { const [x, y] = pt(i, 1.2); return `<text x="${x}" y="${y + 9}" text-anchor="middle" font-size="25" fill="#ffe9b8">${n}</text>`; }).join('')}
</svg>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 4in 6in; margin: 0 }
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { width: 1200px; height: 1800px; background: #000 }
body { font-family: 'WenQuanYi Zen Hei', sans-serif; color: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.holo { position: absolute; inset: 0; background: conic-gradient(from 30deg, #ffd34a, #ff6ad5, #6ad5ff, #7dffb0, #fff27a, #ff9a4a, #c86aff, #ffd34a) }
.card { position: absolute; inset: 30px; border-radius: 38px; overflow: hidden; background: #120b08; box-shadow: 0 0 0 5px #fff8, inset 0 0 0 4px #e6b54a }
.art { position: absolute; left: 0; right: 0; top: 0; height: 1000px; overflow: hidden;
  background: radial-gradient(circle at 50% 52%, #fff6d0 0%, #ffc548 12%, ${main} 38%, #1a0f0a 78%) }
.burst { position: absolute; left: 50%; top: 52%; width: 2400px; height: 2400px; transform: translate(-50%, -50%);
  background: repeating-conic-gradient(from 0deg, #ffffff2a 0deg 4deg, transparent 4deg 12deg);
  -webkit-mask: radial-gradient(circle, #000 10%, transparent 55%) }
.art img { position: absolute; left: 50%; top: 52%; width: 1300px; transform: translate(-50%, -50%); filter: drop-shadow(0 0 22px #fff8) drop-shadow(0 10px 20px #0008) }
.art::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, #0007, transparent 16%, transparent 78%, #120b08 100%) }
.attr { position: absolute; left: 40px; top: 40px; width: 132px; height: 132px; border-radius: 50%; z-index: 2;
  background: radial-gradient(circle at 35% 30%, #fff6c8, #ffc548 40%, #a8620e); box-shadow: 0 0 0 6px #3a1e08, 0 0 0 10px #ffd34a, 0 8px 18px #000a;
  display: flex; flex-direction: column; align-items: center; justify-content: center; color: #3a1e08 }
.attr b { font-size: 64px; line-height: 1 } .attr span { font-size: 19px; margin-top: 4px }
.rare { position: absolute; right: 40px; top: 44px; z-index: 2; font: italic 900 96px/1 'Arial Black', sans-serif; letter-spacing: -2px;
  background: linear-gradient(135deg, #fff 0%, #ffe27a 25%, #ff6ad5 50%, #6ad5ff 75%, #fff 100%); -webkit-background-clip: text; color: transparent;
  filter: drop-shadow(0 4px 0 #3a1e08) drop-shadow(0 0 10px #fff8) }
.power { position: absolute; left: 40px; top: 200px; z-index: 2; padding: 12px 28px 12px 22px; transform: skewX(-12deg);
  background: linear-gradient(90deg, #c8160e, #ff5a2a); border: 4px solid #ffd34a; box-shadow: 0 6px 14px #000a }
.power > * { transform: skewX(12deg); display: block }
.power small { font-size: 22px; color: #ffe9b8; letter-spacing: 4px } .power b { font: italic 900 64px/1 'Arial Black', sans-serif }
.no { position: absolute; right: 44px; top: 152px; z-index: 2; font: bold 26px/1 'Arial', sans-serif; color: #fffc; text-shadow: 0 2px 4px #000 }
.ribbon { position: absolute; left: 0; right: 0; top: 850px; height: 170px; z-index: 3; display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: linear-gradient(180deg, transparent, #0009 30%, #000c 70%, transparent) }
.ribbon h1 { font-size: 104px; line-height: 1; letter-spacing: 8px;
  background: linear-gradient(180deg, #fff, #ffe27a 55%, #e08a1e); -webkit-background-clip: text; color: transparent;
  filter: drop-shadow(0 5px 0 #5a1e08) drop-shadow(0 0 16px #ffb30088) }
.ribbon p { margin-top: 8px; font-size: 28px; letter-spacing: 3px; color: #ffe9b8 }
.ribbon p i { font-style: normal; color: #ffd34a; letter-spacing: 6px; margin-right: 14px }
.panel { position: absolute; left: 34px; right: 34px; top: 1028px; display: grid; grid-template-columns: 350px 1fr; gap: 14px; align-items: center }
.hexes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px 8px }
.hx { height: 158px; clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%); background: linear-gradient(180deg, #ffd34a, #a8620e); padding: 4px }
.hx div { width: 100%; height: 100%; clip-path: inherit; background: linear-gradient(180deg, #3a2414, #140c08); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center }
.hx .l { font-size: 20px; color: #f3d48a } .hx .v { font: bold 40px/1.1 'Arial', sans-serif; margin-top: 2px } .hx .v.s { font-size: 30px }
.hx .p { font-size: 17px; color: #7fe08a; line-height: 1.1 } .hx .r { font-size: 17px; color: #ffe9b8aa; line-height: 1.2 } .hx .r.t { color: #ffd34a }
.strip { position: absolute; left: 34px; right: 34px; display: flex; border-radius: 18px; overflow: hidden; border: 3px solid #e6b54a; background: #0009 }
.strip .tag { width: 150px; flex: none; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 30px; line-height: 1.15; font-weight: bold; color: #fff;
  background: linear-gradient(180deg, #ff5a2a, #b0100a); letter-spacing: 2px }
.strip.w .tag { background: linear-gradient(180deg, #4a7aff, #2a1a8a) }
.strip .body { padding: 12px 20px; flex: 1 }
.strip h2 { font-size: 36px; color: #ffd34a; display: flex; align-items: baseline; gap: 16px } .strip.w h2 { color: ${wcol} }
.strip h2 small { font-size: 20px; color: #f0e2c8; font-weight: normal }
.strip .tags { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 6px; font-size: 21px; color: #f0e2c8 }
.strip .tags b { color: #ffd34a; font-weight: normal } .strip .tags .g { color: #7fe08a }
.foot { position: absolute; left: 44px; right: 44px; bottom: 16px; display: flex; justify-content: space-between; font-size: 18px; color: #ffe9b870 }
</style></head><body><div class="holo"></div><div class="card">
<div class="art"><div class="burst"></div><img src="data:image/png;base64,${hero}"></div>
<div class="attr"><b>${D.stats.atk >= 30 ? '力' : D.stats.speed >= 12 ? '速' : D.stats.def >= 0.25 ? '坚' : '技'}</b><span>${D.era}</span></div>
<div class="rare">SSR</div>
<div class="no">DR-${no}</div>
<div class="power"><small>综合战力</small><b>${power}</b></div>
<div class="ribbon"><h1>${D.name}</h1><p><i>★★★★★</i>${R.name} 驾驭 · ${D.en.toUpperCase()}</p></div>
<div class="panel"><div>${radar}</div><div class="hexes">
${rows.map(([ic, nm, k, v, v2]) => { const rk = rank(k); const top = /第 [1-3]$/.test(rk); const vs = String(v).replace(' 次/秒', ''); return `<div class="hx"><div><span class="l">${nm}</span><span class="v${vs.length > 4 ? ' s' : ''}">${vs}</span>${v2 ? `<span class="p">配骑手 ${v2}</span>` : ''}<span class="r${top ? ' t' : ''}">${top ? '★' : ''}${rk.replace('并列', '并')}</span></div></div>`; }).join('')}
</div></div>
<div class="strip" style="top:1404px"><div class="tag">必杀技</div><div class="body"><h2>${SK.name}<small>冷却${rank('cd').replace('第 ', '第')}</small></h2><div class="tags"><span>${SK.desc}</span></div><div class="tags">${skillBits.map((x) => `<span>◆ ${x}</span>`).join('')}</div></div></div>
<div class="strip w" style="top:1552px"><div class="tag">骑手<br>武器</div><div class="body"><h2>${W.name}<small>${R.name}</small></h2><div class="tags">${wBits.map(([a, v]) => `<span>${a} <b>${v}</b></span>`).join('')}<span class="g">⬆ ${R.bonusText}</span></div></div></div>
<div class="foot"><span>恐龙骑士 · 远古征途　排名为 ${DINOS.length} 只恐龙中的名次 · 战力为卡牌综合值</span><span>zhangxchao.github.io/dino-rider</span></div>
</div></body></html>`;
fs.writeFileSync(`/home/user/dino-rider/cards/${out}.html`, html);
const br = await chromium.launch();
const p = await br.newPage({ viewport: { width: 1200, height: 1800 } });
await p.goto('file:///home/user/dino-rider/cards/' + out + '.html');
await p.waitForTimeout(800);
await p.screenshot({ path: `/home/user/dino-rider/cards/${out}.png` });
await p.emulateMedia({ media: 'print' });
await p.pdf({ path: `/home/user/dino-rider/cards/${out}.pdf`, width: '4in', height: '6in', printBackground: true, scale: 384 / 1200 });
await br.close();
