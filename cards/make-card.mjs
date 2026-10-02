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
<polygon points="${poly((i) => Math.max(0.08, F[AX[i][1]](D) / max(AX[i][1])))}" fill="#d9b46470" stroke="#f6e3a1" stroke-width="3" stroke-linejoin="round"/>
${AX.map(([n], i) => { const [x, y] = pt(i, 1.2); return `<text x="${x}" y="${y + 9}" text-anchor="middle" font-size="25" fill="#d9b464">${n}</text>`; }).join('')}
</svg>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 4in 6in; margin: 0 }
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { width: 1200px; height: 1800px; background: #000 }
body { font-family: 'WenQuanYi Zen Hei', sans-serif; color: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.holo { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 30%, #1d1712, #070504 75%) }
.noise { position: absolute; inset: 0; opacity: .5; mix-blend-mode: overlay; z-index: 20; pointer-events: none }
.gold { position: absolute; inset: 22px; border-radius: 44px; background: linear-gradient(135deg, #7a5520 0%, #f6e3a1 18%, #b8892f 36%, #fff2c4 52%, #a87a28 70%, #f3d98f 86%, #6a4818 100%); box-shadow: 0 0 0 2px #2a1a08, 0 6px 24px #000 }
.corner { position: absolute; width: 96px; height: 96px; z-index: 12 }
.sheen { position: absolute; inset: 0; z-index: 11; pointer-events: none; background: linear-gradient(115deg, transparent 30%, #ffffff10 42%, #ffffff06 48%, transparent 60%) }
.card { position: absolute; inset: 36px; border-radius: 32px; overflow: hidden; background: #0e0a08; box-shadow: inset 0 0 0 2px #2a1a08 }
.inline { position: absolute; inset: 46px; border-radius: 24px; border: 2px solid #d9b46499; z-index: 10; pointer-events: none; box-shadow: inset 0 0 0 4px #0e0a0899, inset 0 0 0 5px #d9b46444 }
.art { position: absolute; left: 0; right: 0; top: 0; height: 1000px; overflow: hidden;
  background: radial-gradient(ellipse 55% 45% at 50% 50%, #f6d79a 0%, ${main}cc 30%, ${main}55 52%, transparent 75%), radial-gradient(ellipse at 50% 40%, #2a1d15, #0b0806 80%) }
.glow { position: absolute; left: 50%; top: 78%; width: 900px; height: 160px; transform: translate(-50%, -50%); background: radial-gradient(closest-side, #f6d79a55, transparent) }
.vig { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 50%, transparent 50%, #000a 100%) }
.burst { position: absolute; left: 50%; top: 52%; width: 2400px; height: 2400px; transform: translate(-50%, -50%);
  background: repeating-conic-gradient(from 0deg, #fff1c814 0deg 3deg, transparent 3deg 12deg);
  -webkit-mask: radial-gradient(circle, #000 10%, transparent 55%) }
.art img { position: absolute; left: 50%; top: 52%; width: 1300px; transform: translate(-50%, -50%); filter: drop-shadow(0 0 14px #f6d79a66) drop-shadow(0 14px 24px #000a) }
.art::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, #0007, transparent 16%, transparent 78%, #120b08 100%) }
.attr { position: absolute; left: 40px; top: 40px; width: 132px; height: 132px; border-radius: 50%; z-index: 2;
  background: radial-gradient(circle at 35% 28%, #fff2c4, #d9ab52 45%, #7a5520 100%); box-shadow: inset 0 3px 6px #fff8, inset 0 -6px 12px #5a3a1288, 0 0 0 5px #1a1008, 0 0 0 8px #c9a050, 0 10px 20px #000c;
  display: flex; flex-direction: column; align-items: center; justify-content: center; color: #3a1e08 }
.attr b { font-size: 64px; line-height: 1; color: #4a2c0c; text-shadow: 0 2px 0 #fff6, 0 -1px 0 #3a1e0866 } .attr span { font-size: 19px; margin-top: 4px }
.rare { position: absolute; right: 40px; top: 44px; z-index: 2; font: italic 900 82px/1 'Arial Black', sans-serif; letter-spacing: -2px; -webkit-text-stroke: 2px #e9c777;
  background: linear-gradient(135deg, #fff 0%, #ffe27a 25%, #ff6ad5 50%, #6ad5ff 75%, #fff 100%); -webkit-background-clip: text; color: transparent;
  filter: drop-shadow(0 4px 0 #1a1008) drop-shadow(0 0 6px #fff4) }
.power { position: absolute; left: 40px; top: 200px; z-index: 2; padding: 12px 28px 12px 22px; transform: skewX(-12deg);
  background: linear-gradient(180deg, #5a1010, #2a0606); border: 3px solid #d9b464; box-shadow: inset 0 0 0 2px #0008, inset 0 2px 0 #ffffff22, 0 8px 18px #000c }
.power > * { transform: skewX(12deg); display: block }
.power small { font-size: 21px; color: #d9b464; letter-spacing: 6px } .power b { font: italic 900 62px/1 'Arial Black', sans-serif; background: linear-gradient(180deg, #7a5520 0%, #f6e3a1 18%, #b8892f 36%, #fff2c4 52%, #a87a28 70%, #f3d98f 86%, #6a4818 100%); -webkit-background-clip: text; color: transparent }
.no { position: absolute; right: 44px; top: 140px; z-index: 2; font: bold 24px/1 'Arial', sans-serif; letter-spacing: 3px; color: #d9b464; text-shadow: 0 2px 4px #000 }
.ribbon { position: absolute; left: 0; right: 0; top: 838px; height: 200px; z-index: 3; display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: linear-gradient(180deg, transparent, #000a 30%, #000c 70%, transparent) }
.rule { flex: none; width: 760px; height: 2px; background: linear-gradient(90deg, transparent, #d9b464 20%, #fff2c4 50%, #d9b464 80%, transparent); position: relative; margin: 8px 0 }
.rule::before, .rule::after { content: ''; position: absolute; top: -6px; width: 12px; height: 12px; background: #e9c777; transform: rotate(45deg) }
.rule::before { left: 70px } .rule::after { right: 70px }
.ribbon h1 { font-size: 104px; line-height: 1; letter-spacing: 8px;
  background: linear-gradient(180deg, #fff8e0 0%, #f6e3a1 35%, #c9952f 60%, #fff2c4 80%, #a87a28 100%); -webkit-background-clip: text; color: transparent;
  -webkit-text-stroke: 1.5px #fff2c488; filter: drop-shadow(0 4px 0 #2a1406) drop-shadow(0 0 8px #ffb30044) }
.ribbon p { margin-top: 2px; font-size: 28px; letter-spacing: 3px; color: #ffe9b8 }
.ribbon p i { font-style: normal; color: #e9c777; letter-spacing: 6px; margin-right: 14px }
.panel { position: absolute; left: 34px; right: 34px; top: 1028px; display: grid; grid-template-columns: 350px 1fr; gap: 14px; align-items: center }
.hexes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px 8px }
.hx { height: 150px; clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%); background: linear-gradient(160deg, #7a5520 0%, #f6e3a1 18%, #b8892f 36%, #fff2c4 52%, #a87a28 70%, #f3d98f 86%, #6a4818 100%); padding: 3px }
.hx div { width: 100%; height: 100%; clip-path: inherit; background: linear-gradient(180deg, #ffffff14 0%, #2a1f18 18%, #120d0a 70%, #1a1310 100%); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center }
.hx .l { font-size: 20px; color: #d9b464; letter-spacing: 1px } .hx .v { font: bold 40px/1.1 'Arial', sans-serif; margin-top: 2px } .hx .v.s { font-size: 30px }
.hx .p { font-size: 17px; color: #7fe08a; line-height: 1.1 } .hx .r { font-size: 17px; color: #c9a86a; line-height: 1.2 } .hx .r.t { color: #ffe08a }
.strip { position: absolute; left: 34px; right: 34px; display: flex; border-radius: 14px; overflow: hidden; border: 2px solid #d9b464; background: linear-gradient(180deg, #ffffff0a, #00000080); box-shadow: inset 0 0 0 3px #0008 }
.strip .tag { width: 150px; flex: none; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 30px; line-height: 1.15; font-weight: bold; color: #fff;
  background: linear-gradient(180deg, #6a1414, #2a0606); border-right: 2px solid #d9b464; color: #f6e3a1; letter-spacing: 4px }
.strip.w .tag { background: linear-gradient(180deg, #1a2a5a, #070c22) }
.strip .body { padding: 12px 20px; flex: 1 }
.strip h2 { font-size: 36px; color: #f6e3a1; display: flex; align-items: baseline; gap: 16px } .strip.w h2 { color: ${wcol} }
.strip h2 small { font-size: 20px; color: #f0e2c8; font-weight: normal }
.strip .tags { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 6px; font-size: 20px; color: #f0e2c8 }
.strip .tags b { color: #e9c777; font-weight: normal } .strip .tags .g { color: #7fe08a }
.foot { position: absolute; left: 44px; right: 44px; bottom: 26px; display: flex; justify-content: space-between; font-size: 17px; color: #c9a86a99 }
</style></head><body><div class="holo"></div><div class="gold"></div><div class="card">
<div class="art"><div class="burst"></div><div class="glow"></div><div class="vig"></div><img src="data:image/png;base64,${hero}"></div>
<div class="attr"><b>${D.stats.atk >= 30 ? '力' : D.stats.speed >= 12 ? '速' : D.stats.def >= 0.25 ? '坚' : '技'}</b><span>${D.era}</span></div>
<div class="rare">SSR</div>
<div class="no">DR-${no}</div>
<div class="power"><small>综合战力</small><b>${power}</b></div>
<div class="ribbon"><div class="rule"></div><h1>${D.name}</h1><p><i>★★★★★</i>${R.name} 驾驭 · ${D.en.toUpperCase()}</p><div class="rule"></div></div>
<div class="panel"><div>${radar}</div><div class="hexes">
${rows.map(([ic, nm, k, v, v2]) => { const rk = rank(k); const top = /第 [1-3]$/.test(rk); const vs = String(v).replace(' 次/秒', ''); return `<div class="hx"><div><span class="l">${nm}</span><span class="v${vs.length > 4 ? ' s' : ''}">${vs}</span>${v2 ? `<span class="p">配骑手 ${v2}</span>` : ''}<span class="r${top ? ' t' : ''}">${top ? '★' : ''}${rk.replace('并列', '并')}</span></div></div>`; }).join('')}
</div></div>
<div class="strip" style="top:1386px"><div class="tag">必杀技</div><div class="body"><h2>${SK.name}<small>冷却${rank('cd').replace('第 ', '第')}</small></h2><div class="tags"><span>${SK.desc}</span></div><div class="tags">${skillBits.map((x) => `<span>◆ ${x}</span>`).join('')}</div></div></div>
<div class="strip w" style="top:1530px"><div class="tag">骑手<br>武器</div><div class="body"><h2>${W.name}<small>${R.name}</small></h2><div class="tags">${wBits.map(([a, v]) => `<span>${a} <b>${v}</b></span>`).join('')}<span class="g">⬆ ${R.bonusText}</span></div></div></div>
<div class="foot"><span>恐龙骑士 · 远古征途　排名为 ${DINOS.length} 只恐龙中的名次 · 战力为卡牌综合值</span><span>zhangxchao.github.io/dino-rider</span></div>
</div><div class="sheen"></div><div class="inline"></div><svg class="corner" style="left:40px;top:40px" viewBox="0 0 120 120"><defs><linearGradient id="cg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2c4"/><stop offset=".5" stop-color="#c9952f"/><stop offset="1" stop-color="#f6e3a1"/></linearGradient></defs><path d="M8 70 V8 H70" fill="none" stroke="url(#cg)" stroke-width="4"/><path d="M20 52 V20 H52" fill="none" stroke="url(#cg)" stroke-width="2"/><rect x="2" y="2" width="12" height="12" transform="rotate(45 8 8)" fill="url(#cg)"/><circle cx="70" cy="8" r="4" fill="url(#cg)"/><circle cx="8" cy="70" r="4" fill="url(#cg)"/></svg><svg class="corner" style="right:40px;top:40px;transform:scaleX(-1)" viewBox="0 0 120 120"><defs><linearGradient id="cg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2c4"/><stop offset=".5" stop-color="#c9952f"/><stop offset="1" stop-color="#f6e3a1"/></linearGradient></defs><path d="M8 70 V8 H70" fill="none" stroke="url(#cg)" stroke-width="4"/><path d="M20 52 V20 H52" fill="none" stroke="url(#cg)" stroke-width="2"/><rect x="2" y="2" width="12" height="12" transform="rotate(45 8 8)" fill="url(#cg)"/><circle cx="70" cy="8" r="4" fill="url(#cg)"/><circle cx="8" cy="70" r="4" fill="url(#cg)"/></svg><svg class="corner" style="left:40px;bottom:40px;transform:scaleY(-1)" viewBox="0 0 120 120"><defs><linearGradient id="cg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2c4"/><stop offset=".5" stop-color="#c9952f"/><stop offset="1" stop-color="#f6e3a1"/></linearGradient></defs><path d="M8 70 V8 H70" fill="none" stroke="url(#cg)" stroke-width="4"/><path d="M20 52 V20 H52" fill="none" stroke="url(#cg)" stroke-width="2"/><rect x="2" y="2" width="12" height="12" transform="rotate(45 8 8)" fill="url(#cg)"/><circle cx="70" cy="8" r="4" fill="url(#cg)"/><circle cx="8" cy="70" r="4" fill="url(#cg)"/></svg><svg class="corner" style="right:40px;bottom:40px;transform:scale(-1,-1)" viewBox="0 0 120 120"><defs><linearGradient id="cg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2c4"/><stop offset=".5" stop-color="#c9952f"/><stop offset="1" stop-color="#f6e3a1"/></linearGradient></defs><path d="M8 70 V8 H70" fill="none" stroke="url(#cg)" stroke-width="4"/><path d="M20 52 V20 H52" fill="none" stroke="url(#cg)" stroke-width="2"/><rect x="2" y="2" width="12" height="12" transform="rotate(45 8 8)" fill="url(#cg)"/><circle cx="70" cy="8" r="4" fill="url(#cg)"/><circle cx="8" cy="70" r="4" fill="url(#cg)"/></svg><svg class="noise" width="1200" height="1800"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .45  0 0 0 0 .4  0 0 0 .35 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg></body></html>`;
fs.writeFileSync(`/home/user/dino-rider/cards/${out}.html`, html);
const br = await chromium.launch();
const p = await br.newPage({ viewport: { width: 1200, height: 1800 } });
await p.goto('file:///home/user/dino-rider/cards/' + out + '.html');
await p.waitForTimeout(800);
await p.screenshot({ path: `/home/user/dino-rider/cards/${out}.png` });
await p.emulateMedia({ media: 'print' });
await p.pdf({ path: `/home/user/dino-rider/cards/${out}.pdf`, width: '4in', height: '6in', printBackground: true, scale: 384 / 1200 });
await br.close();
