// 菜单界面：标题 / 选择坐骑 / 关卡 / 升级 / 设置 / 帮助 / 暂停 / 结算 / 结局
import { DINOS, RIDERS, LEVELS, BOSSES, UPGRADES, upgradeCost } from './data.js';
import { save, persist, resetSave } from './save.js';
import { SKILL_ICON, WEAPON_ICON } from './hud.js';
import { formatTime } from './util.js';
import { t, LANGS, getLang, setLang } from './i18n.js';

const BIOME_EMOJI = { jungle: '🌴', desert: '🏜️', frost: '❄️', swamp: '🍄', volcano: '🌋', shadow: '🏰', hive: '🦗' };
const BIOME_BG = {
  jungle: 'linear-gradient(160deg,#2f7a3a 0%,#1b4a2a 55%,#0d2416 100%)',
  desert: 'linear-gradient(160deg,#e0a64a 0%,#a8622a 55%,#4a2a14 100%)',
  frost: 'linear-gradient(160deg,#9ad4ff 0%,#4a7ab0 55%,#1a2a4a 100%)',
  swamp: 'linear-gradient(160deg,#5a7a4a 0%,#2e4a3a 55%,#101c18 100%)',
  volcano: 'linear-gradient(160deg,#ff7a2a 0%,#8a1a14 55%,#240808 100%)',
  shadow: 'linear-gradient(160deg,#8a4ad0 0%,#3a1a6a 55%,#0e0620 100%)',
  hive: 'linear-gradient(160deg,#c0304a 0%,#5a1424 55%,#14040a 100%)',
};
const WEAPON_TRAITS = (w) => {
  const r = [];
  if (w.count > 1) r.push(t('trait.count', { n: w.count }));
  if (w.pierce) r.push(t('trait.pierce', { n: w.pierce }));
  if (w.aoe) r.push(t('trait.aoe', { n: w.aoe }));
  if (w.homing) r.push(t('trait.homing'));
  if (w.bounce) r.push(t('trait.bounce', { n: w.bounce }));
  if (w.slow) r.push(t('trait.slow', { n: Math.round(w.slow * 100) }));
  if (w.burn) r.push(t('trait.burn'));
  if (w.arc) r.push(t('trait.arc'));
  if (w.knock) r.push(t('trait.knock'));
  return r;
};

function el(html) {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild;
}

export class UI {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('screens');
    this.current = null;
    this.tab = 'dino';
    this.root.addEventListener('mouseover', (e) => {
      const t = e.target.closest('button, .card, .tab, .level-card:not(.locked)');
      if (t && t !== this._lastHover) { this._lastHover = t; app.audio.play('hover', { volume: 0.25 }); }
    });
    this.root.addEventListener('click', (e) => {
      const t = e.target.closest('button, .tab');
      if (t) app.audio.play('click', { volume: 0.5 });
    });
  }

  show(name, data) {
    this.root.innerHTML = '';
    const node = this['build_' + name](data);
    node.id = 's-' + name;
    node.classList.add('screen', 'show');
    this.root.appendChild(node);
    this.current = name;
    this.app.onScreen(name);
  }

  hide() {
    this.root.innerHTML = '';
    this.current = null;
  }

  coinPill() { return `<div class="coin-pill"><i class="coin-ico"></i> <span>${save.coins}</span></div>`; }

  // ------------------------------------------------------------------
  build_title() {
    const d = DINOS.find((x) => x.id === save.dino) || DINOS[0];
    const r = RIDERS.find((x) => x.id === save.rider) || RIDERS[0];
    const totalStars = save.stars.reduce((a, b) => a + b, 0);
    const n = el(`
      <div>
        <div class="title-wrap">
          <div class="logo-big">${t('game.logo')}</div>
          <div class="logo-sub">${t('game.sub')}</div>
          <div class="tagline">${t('title.tagline')}</div>
        </div>
        <div class="menu">
          <button class="btn" data-act="levels"><span class="ico">⚔️</span>${t('title.start')}</button>
          <button class="btn ghost" data-act="select"><span class="ico">🦖</span>${t('title.select')}</button>
          <button class="btn ghost" data-act="shop"><span class="ico">🛠️</span>${t('title.shop')}</button>
          <button class="btn ghost" data-act="settings"><span class="ico">⚙️</span>${t('title.settings')}</button>
          <button class="btn ghost" data-act="help"><span class="ico">📖</span>${t('title.help')}</button>
        </div>
        <div class="current">
          <div class="lbl">${t('title.current')}</div>
          <div class="nm">${d.name}</div>
          <div class="rd">${t('common.rider', { name: r.name })}</div>
          <div class="rd" style="margin-top:8px;font-size:14px;color:#fffa">${t('title.progress', { stars: totalStars, maxStars: LEVELS.length * 3, cleared: save.stars.filter((s) => s > 0).length, total: LEVELS.length })}</div>
        </div>
        <div style="position:absolute;right:4vw;top:22px">${this.coinPill()}</div>
        <button class="btn ghost small lang-btn" data-lang>🌐 ${LANGS.find((l) => l.id === getLang()).label}</button>
      </div>`);
    n.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'settings') this.show('settings', { from: 'title' });
      else this.show(a);
    }));
    n.querySelector('[data-lang]').addEventListener('click', () => {
      const i = LANGS.findIndex((l) => l.id === getLang());
      setLang(LANGS[(i + 1) % LANGS.length].id);
      this.show('title');
    });
    return n;
  }

  // ------------------------------------------------------------------
  build_select() {
    const n = el(`
      <div>
        <div class="topbar">
          <button class="btn ghost small" data-back>${t('common.back')}</button>
          <h2>${t('select.title')}</h2>
          <div class="tabs">
            <div class="tab ${this.tab === 'dino' ? 'active' : ''}" data-tab="dino">${t('select.tabDino', { n: DINOS.length })}</div>
            <div class="tab ${this.tab === 'rider' ? 'active' : ''}" data-tab="rider">${t('select.tabRider', { n: RIDERS.length })}</div>
          </div>
          <div class="spacer"></div>
          ${this.coinPill()}
        </div>
        <div class="grid-panel panel"><div class="card-grid"></div></div>
        <div class="info-panel panel"></div>
        <div class="hint-drag">${t('select.dragHint')}</div>
        <div class="preview-name"><div class="a"></div><div class="b"></div></div>
        <div class="bottom">
          <button class="btn" data-go>${t('select.go')}</button>
        </div>
      </div>`);
    const grid = n.querySelector('.card-grid');
    const info = n.querySelector('.info-panel');
    const pa = n.querySelector('.preview-name .a');
    const pb = n.querySelector('.preview-name .b');
    const thumbs = this.app.thumbs || { dino: {}, rider: {} };

    const renderInfo = () => {
      const d = DINOS.find((x) => x.id === save.dino) || DINOS[0];
      const r = RIDERS.find((x) => x.id === save.rider) || RIDERS[0];
      pa.textContent = d.name;
      pb.textContent = t('common.rider', { name: r.name });
      if (this.tab === 'dino') {
        const s = d.stats;
        const bar = (k, v, max, txt) => `<div class="stat-row"><span class="k">${k}</span><span class="bar"><i style="width:${Math.min(100, v / max * 100)}%"></i></span><span class="v">${txt}</span></div>`;
        const wins = save.dinoWins[d.id] || 0;
        info.innerHTML = `
          <h3>${d.name}</h3>
          ${d.en !== d.name ? `<div class="en">${d.en}</div>` : ''}
          <span class="era">${d.era}</span> <span class="era" style="background:rgba(79,201,255,.15);color:#8fdcff">${t('select.attack', { name: t('attack.' + d.attack) })}</span>
          ${wins ? `<span class="era" style="background:rgba(98,227,127,.15);color:#8ff0a0">${t('select.wins', { n: wins })}</span>` : ''}
          <p>${d.desc}</p>
          <div style="margin-top:12px">
            ${bar(t('stat.hp'), s.hp, 330, s.hp)}
            ${bar(t('stat.atk'), s.atk, 38, s.atk)}
            ${bar(t('stat.def'), s.def, 0.45, Math.round(s.def * 100) + '%')}
            ${bar(t('stat.speed'), s.speed, 16, s.speed)}
            ${bar(t('stat.atkRate'), s.atkRate, 1.8, s.atkRate.toFixed(1))}
            ${bar(t('stat.reach'), s.reach, 3.2, s.reach.toFixed(1))}
          </div>
          <div class="skill-box">
            <div class="t">${SKILL_ICON[d.skill.type]} ${t('select.skill', { name: d.skill.name })}<small>${t('select.cd', { n: d.skill.cd })}</small></div>
            <div class="d">${d.skill.desc}</div>
          </div>`;
      } else {
        const w = r.weapon;
        const dps = (w.dmg * (w.count || 1) / w.cd).toFixed(0);
        info.innerHTML = `
          <h3>${r.name}</h3>
          ${getLang() !== 'en' ? `<div class="en">${r.en}</div>` : ''}
          <p style="margin-top:8px">${r.desc}</p>
          <div class="skill-box">
            <div class="t">${WEAPON_ICON[w.type]} ${t('select.weapon', { name: w.name })}</div>
            <div class="d">${t('select.weaponStats', { dmg: w.dmg + (w.count > 1 ? ' × ' + w.count : ''), cd: w.cd, dps })}<br>${WEAPON_TRAITS(w).join(' · ') || t('trait.none')}</div>
          </div>
          <div class="skill-box" style="background:rgba(98,227,127,.08);border-color:rgba(98,227,127,.3)">
            <div class="t" style="color:#8ff0a0">${t('select.passive')}</div>
            <div class="d">${r.bonusText}</div>
          </div>
          <p style="margin-top:12px;color:var(--muted);font-size:12.5px">${t('select.riderNote')}</p>`;
      }
    };

    const renderGrid = () => {
      if (this.tab === 'dino') {
        grid.innerHTML = DINOS.map((d) => `
          <div class="card ${d.id === save.dino ? 'active' : ''}" data-id="${d.id}">
            ${save.dinoWins[d.id] ? `<span class="badge">🏆${save.dinoWins[d.id]}</span>` : ''}
            <img src="${thumbs.dino[d.id] || ''}" alt="">
            <div class="nm" title="${d.name}">${d.name}</div>
          </div>`).join('');
      } else {
        grid.innerHTML = RIDERS.map((r) => `
          <div class="card ${r.id === save.rider ? 'active' : ''}" data-id="${r.id}">
            <img src="${thumbs.rider[r.id] || ''}" alt="">
            <div class="nm" title="${r.name}">${r.name}</div>
          </div>`).join('');
      }
      grid.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => {
        const id = c.dataset.id;
        if (this.tab === 'dino') {
          if (save.dino === id) return;
          save.dino = id;
          const d = DINOS.find((x) => x.id === id);
          this.app.audio.roar(d.scale);
        } else {
          if (save.rider === id) return;
          save.rider = id;
          const r = RIDERS.find((x) => x.id === id);
          this.app.audio.play(r.weapon.type);
        }
        persist();
        grid.querySelectorAll('.card').forEach((x) => x.classList.toggle('active', x.dataset.id === id));
        this.app.showcase?.setSelection(save.dino, save.rider, true);
        renderInfo();
      }));
    };

    n.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      this.tab = t.dataset.tab;
      n.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      renderGrid(); renderInfo();
    }));
    n.querySelector('[data-back]').addEventListener('click', () => this.show('title'));
    n.querySelector('[data-go]').addEventListener('click', () => this.show('levels'));
    renderGrid(); renderInfo();
    return n;
  }

  // ------------------------------------------------------------------
  build_levels() {
    const d = DINOS.find((x) => x.id === save.dino) || DINOS[0];
    const r = RIDERS.find((x) => x.id === save.rider) || RIDERS[0];
    const cards = LEVELS.map((lv, i) => {
      const locked = i >= save.unlocked;
      const stars = save.stars[i] || 0;
      return `
        <div class="level-card ${locked ? 'locked' : ''}" data-i="${i}" style="animation-delay:${i * 0.06}s">
          <div class="bg" style="background:${BIOME_BG[lv.biome]}"></div>
          <div class="num">${String(i + 1).padStart(2, '0')}</div>
          <div class="emoji">${BIOME_EMOJI[lv.biome]}</div>
          <h4>${lv.name}</h4>
          <div class="boss">${t('levels.route', { len: lv.length, boss: BOSSES[lv.boss].name })}</div>
          <div class="desc">${lv.desc}</div>
          <div class="stars">${[0, 1, 2].map((k) => `<span class="${k < stars ? 'on' : 'off'}">★</span>`).join('')}
            ${save.bestTime[i] ? `<span style="font-size:12px;color:#fffa;letter-spacing:0;margin-left:8px">${t('levels.best', { time: formatTime(save.bestTime[i]) })}</span>` : ''}</div>
          ${locked ? '<div class="lock">🔒</div>' : ''}
        </div>`;
    }).join('');
    const endlessLocked = save.unlocked < 2;
    const n = el(`
      <div>
        <div class="topbar">
          <button class="btn ghost small" data-back>${t('common.back')}</button>
          <h2>${t('levels.title')}</h2>
          <span style="color:var(--muted);font-weight:700">${t('levels.team', { dino: d.name, rider: r.name })}</span>
          <button class="btn ghost small" data-sel>${t('levels.change')}</button>
          <div class="spacer"></div>
          ${this.coinPill()}
        </div>
        <div class="map">
          ${cards}
          <div class="level-card endless ${endlessLocked ? 'locked' : ''}" data-endless style="animation-delay:.4s">
            <div class="bg" style="background:linear-gradient(120deg,#3a1a0a,#7a2a1a 40%,#2a1a4a)"></div>
            <div class="emoji">♾️</div>
            <h4>${t('endless.name')}</h4>
            <div class="desc">${t('endless.desc')}${save.endlessBest ? t('endless.best', { n: save.endlessBest }) : endlessLocked ? t('endless.locked') : t('endless.none')}</div>
            ${endlessLocked ? '<div class="lock">🔒</div>' : ''}
          </div>
        </div>
      </div>`);
    n.querySelector('[data-back]').addEventListener('click', () => this.show('title'));
    n.querySelector('[data-sel]').addEventListener('click', () => this.show('select'));
    n.querySelectorAll('.level-card[data-i]').forEach((c) => c.addEventListener('click', () => {
      const i = +c.dataset.i;
      if (i >= save.unlocked) { this.app.audio.play('error'); return; }
      this.app.audio.play('select');
      this.app.startGame({ levelIdx: i, dinoId: save.dino, riderId: save.rider });
    }));
    n.querySelector('[data-endless]').addEventListener('click', () => {
      if (endlessLocked) { this.app.audio.play('error'); return; }
      this.app.audio.play('select');
      this.app.startGame({ endless: true, dinoId: save.dino, riderId: save.rider });
    });
    return n;
  }

  // ------------------------------------------------------------------
  build_shop() {
    const n = el(`
      <div>
        <div class="topbar">
          <button class="btn ghost small" data-back>${t('common.back')}</button>
          <h2>${t('shop.title')}</h2>
          <span style="color:var(--muted)">${t('shop.sub')}</span>
          <div class="spacer"></div>
          ${this.coinPill()}
        </div>
        <div class="list panel"></div>
      </div>`);
    const list = n.querySelector('.list');
    const render = () => {
      n.querySelector('.coin-pill span').textContent = save.coins;
      list.innerHTML = UPGRADES.map((u) => {
        const lv = save.upgrades[u.id] || 0;
        const maxed = lv >= u.max;
        const cost = upgradeCost(u, lv);
        return `
          <div class="up-row">
            <div class="ico">${u.icon}</div>
            <div class="main">
              <div class="t">${u.name} <span style="color:var(--muted);font-size:13px">Lv.${lv}/${u.max}</span></div>
              <div class="d">${u.desc}${t('shop.now', { v: this.upgradeNow(u, lv) })}</div>
              <div class="pips">${Array.from({ length: u.max }, (_, k) => `<i class="${k < lv ? 'on' : ''}"></i>`).join('')}</div>
            </div>
            <button class="btn small" data-id="${u.id}" ${maxed || save.coins < cost ? 'disabled' : ''}>${maxed ? t('shop.maxed') : `<i class="coin-ico"></i> ${cost}`}</button>
          </div>`;
      }).join('');
      list.querySelectorAll('button[data-id]').forEach((b) => b.addEventListener('click', () => {
        const u = UPGRADES.find((x) => x.id === b.dataset.id);
        const lv = save.upgrades[u.id] || 0;
        const cost = upgradeCost(u, lv);
        if (lv >= u.max || save.coins < cost) { this.app.audio.play('error'); return; }
        save.coins -= cost;
        save.upgrades[u.id] = lv + 1;
        persist();
        this.app.audio.play('buy');
        render();
      }));
    };
    n.querySelector('[data-back]').addEventListener('click', () => this.show('title'));
    render();
    return n;
  }

  upgradeNow(u, lv) {
    switch (u.id) {
      case 'hp': return `+${lv * 10}%`;
      case 'atk': return `+${lv * 10}%`;
      case 'def': return `-${lv * 4}%`;
      case 'speed': return `+${lv * 5}%`;
      case 'rider': return `+${lv * 12}%`;
      case 'cdr': return `-${lv * 6}%`;
      case 'magnet': return `+${lv * 25}%`;
      default: return lv;
    }
  }

  // ------------------------------------------------------------------
  build_settings({ from = 'title' } = {}) {
    const s = save.settings;
    const n = el(`
      <div>
        ${from === 'pause' ? '<div class="overlay-dim"></div>' : ''}
        <div class="center-panel panel">
          <h2>${t('settings.title')}</h2>
          <div class="set-row"><label>${t('settings.lang')}</label><div class="seg" data-lang>${LANGS.map((l) => `<button data-v="${l.id}" class="${l.id === getLang() ? 'on' : ''}">${l.label}</button>`).join('')}</div></div>
          <div class="set-row"><label>${t('settings.music')}</label><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-k="music"></div>
          <div class="set-row"><label>${t('settings.sfx')}</label><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-k="sfx"></div>
          <div class="set-row"><label>${t('settings.quality')}</label><div class="seg" data-k="quality"><button data-v="high" class="${s.quality === 'high' ? 'on' : ''}">${t('settings.qualityHigh')}</button><button data-v="low" class="${s.quality === 'low' ? 'on' : ''}">${t('settings.qualityLow')}</button></div></div>
          <div class="set-row"><label>${t('settings.fx')}</label><div class="seg" data-k="fx">${['full', 'medium', 'low'].map((v) => `<button data-v="${v}" class="${(s.fx || 'medium') === v ? 'on' : ''}">${t('settings.fx.' + v)}</button>`).join('')}</div></div>
          <div class="set-row"><label>${t('settings.autoRes')}</label><div class="seg" data-k="autoRes"><button data-v="1" class="${s.autoRes !== false ? 'on' : ''}">${t('common.on')}</button><button data-v="0" class="${s.autoRes === false ? 'on' : ''}">${t('common.off')}</button></div></div>
          <div class="set-row"><label>${t('settings.fps')}</label><div class="seg" data-k="showFps"><button data-v="1" class="${s.showFps ? 'on' : ''}">${t('common.on')}</button><button data-v="0" class="${!s.showFps ? 'on' : ''}">${t('common.off')}</button></div></div>
          <div class="set-row"><label>${t('settings.shake')}</label><div class="seg" data-k="shake"><button data-v="1" class="${s.shake ? 'on' : ''}">${t('common.on')}</button><button data-v="0" class="${!s.shake ? 'on' : ''}">${t('common.off')}</button></div></div>
          ${from === 'title' ? `<div class="set-row"><label>${t('settings.reset')}</label><button class="btn danger small" data-reset>${t('settings.resetBtn')}</button></div>` : ''}
          <div class="row-btns"><button class="btn" data-back>${t('settings.done')}</button></div>
        </div>
      </div>`);
    n.querySelectorAll('input[type=range]').forEach((inp) => inp.addEventListener('input', () => {
      s[inp.dataset.k] = +inp.value;
      this.app.applySettings();
      persist();
    }));
    n.querySelectorAll('.seg[data-lang] button').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.v === getLang()) return;
      setLang(b.dataset.v);
      this.show('settings', { from });
    }));
    n.querySelectorAll('.seg[data-k]').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const k = seg.dataset.k;
      const v = b.dataset.v;
      s[k] = k === 'quality' || k === 'fx' ? v : v === '1';
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      this.app.applySettings();
      persist();
    })));
    const reset = n.querySelector('[data-reset]');
    if (reset) {
      let armed = false;
      reset.addEventListener('click', () => {
        if (!armed) { armed = true; reset.textContent = t('settings.resetConfirm'); return; }
        resetSave();
        this.app.showcase?.setSelection(save.dino, save.rider);
        this.show('title');
      });
    }
    n.querySelector('[data-back]').addEventListener('click', () => {
      if (from === 'pause') this.show('pause');
      else this.show('title');
    });
    return n;
  }

  // ------------------------------------------------------------------
  build_help({ from = 'title' } = {}) {
    const n = el(`
      <div>
        ${from === 'pause' ? '<div class="overlay-dim"></div>' : ''}
        <div class="center-panel panel">
          <h2>${t('help.title')}</h2>
          <div class="keys">
            <div><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd></div><div>${t('help.move')}</div>
            <div><kbd>${t('help.mouse')}</kbd></div><div>${t('help.drag')}</div>
            <div><kbd>${t('help.space')}</kbd> / <kbd>W</kbd></div><div>${t('help.jump')}</div>
            <div><kbd>Q</kbd> / <kbd>E</kbd> / <kbd>Shift</kbd></div><div>${t('help.skill')}</div>
            <div><kbd>R</kbd></div><div>${t('help.ult')}</div>
            <div><kbd>Esc</kbd> / <kbd>P</kbd></div><div>${t('help.pause')}</div>
          </div>
          <div class="help-tip">
            ${t('help.tips')}<br>
            ${t('help.tips2')}<br>
            ${t('help.tips3')}
          </div>
          <div class="row-btns"><button class="btn" data-back>${t('help.ok')}</button></div>
        </div>
      </div>`);
    n.querySelector('[data-back]').addEventListener('click', () => this.show(from === 'pause' ? 'pause' : 'title'));
    return n;
  }

  // ------------------------------------------------------------------
  build_pause() {
    const n = el(`
      <div>
        <div class="overlay-dim"></div>
        <div class="center-panel panel" style="width:min(420px,92vw)">
          <h2>${t('pause.title')}</h2>
          <div style="display:flex;flex-direction:column;gap:12px">
            <button class="btn" data-a="resume">${t('pause.resume')}</button>
            <button class="btn ghost" data-a="restart">${t('pause.restart')}</button>
            <button class="btn ghost" data-a="settings">${t('pause.settings')}</button>
            <button class="btn ghost" data-a="help">${t('pause.help')}</button>
            <button class="btn danger" data-a="quit">${t('pause.quit')}</button>
          </div>
        </div>
      </div>`);
    n.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'resume') this.app.resume();
      else if (a === 'restart') this.app.restart();
      else if (a === 'settings') this.show('settings', { from: 'pause' });
      else if (a === 'help') this.show('help', { from: 'pause' });
      else if (a === 'quit') this.app.exitToMenu();
    }));
    return n;
  }

  // ------------------------------------------------------------------
  build_result(r) {
    const hasNext = r.win && !r.final && r.levelIdx + 1 < LEVELS.length;
    let body;
    if (r.win) {
      body = `
        <h2 style="color:#ffe27a">${t('result.win')}</h2>
        <div class="big-stars">${[0, 1, 2].map((k) => `<span class="${k < r.stars ? 'on' : ''}" style="animation-delay:${0.2 + k * 0.25}s">★</span>`).join('')}</div>
        <div class="result-grid">
          <div class="cell"><div class="k">${t('result.time')}</div><div class="v">${formatTime(r.time)}</div></div>
          <div class="cell"><div class="k">${t('result.kills')}</div><div class="v">${r.kills}</div></div>
          <div class="cell"><div class="k">${t('result.combo')}</div><div class="v">${r.maxCombo}</div></div>
          <div class="cell"><div class="k">${t('result.weaponLv')}</div><div class="v">Lv.${r.weaponLv >= 10 ? 'MAX' : r.weaponLv}</div></div>
          <div class="cell"><div class="k">${t('result.coinsPicked')}</div><div class="v gold">+${r.coins}</div></div>
          <div class="cell"><div class="k">${t('result.reward')}</div><div class="v gold">+${r.reward}</div></div>
        </div>
        <div class="star-reqs">
          <div class="ok">${t('result.starClear')}</div>
          <div class="${r.hpR >= 0.5 ? 'ok' : ''}">${t('result.starHp', { n: Math.round(r.hpR * 100) })}</div>
          <div class="${r.killRate >= 0.7 ? 'ok' : ''}">${t('result.starKill', { n: Math.round(r.killRate * 100) })}</div>
        </div>`;
    } else {
      body = `
        <h2 style="color:#ff8080">${r.endless ? t('result.endlessOver') : t('result.lose')}</h2>
        ${r.endless ? `<div style="text-align:center;font-size:22px;font-weight:900;margin-bottom:12px">${t('result.dist', { n: r.dist })}${r.newBest ? ` <span style="color:var(--gold)">${t('result.newBest')}</span>` : ''}</div>` : `<p style="text-align:center;color:var(--muted);margin-bottom:12px">${r.bossReached ? t('result.bossReached') : t('result.progress', { n: Math.round(r.progress * 100) })}${t('result.tryUpgrade')}</p>`}
        <div class="result-grid">
          <div class="cell"><div class="k">${t('result.weaponLv')}</div><div class="v">Lv.${r.weaponLv >= 10 ? 'MAX' : r.weaponLv}</div></div>
          <div class="cell"><div class="k">${t('result.kills')}</div><div class="v">${r.kills}</div></div>
          <div class="cell"><div class="k">${t('result.combo')}</div><div class="v">${r.maxCombo}</div></div>
          <div class="cell"><div class="k">${t('result.coinsGot')}</div><div class="v gold">+${r.coins}</div></div>
        </div>`;
    }
    const n = el(`
      <div>
        <div class="overlay-dim"></div>
        <div class="center-panel panel result">
          ${body}
          <div class="row-btns">
            ${r.final && r.win ? `<button class="btn" data-a="ending">${t('result.ending')}</button>` : ''}
            ${hasNext ? `<button class="btn" data-a="next">${t('result.next')}</button>` : ''}
            <button class="btn ${hasNext || (r.final && r.win) ? 'ghost' : ''}" data-a="retry">↻ ${r.win ? t('result.replay') : t('result.retry')}</button>
            ${!r.win ? `<button class="btn ghost" data-a="shop">${t('result.shop')}</button>` : ''}
            <button class="btn ghost" data-a="menu">${t('result.menu')}</button>
          </div>
        </div>
      </div>`);
    n.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'next') this.app.startGame({ levelIdx: r.levelIdx + 1, dinoId: save.dino, riderId: save.rider });
      else if (a === 'retry') this.app.restart();
      else if (a === 'ending') this.app.exitToMenu('ending');
      else if (a === 'shop') this.app.exitToMenu('shop');
      else this.app.exitToMenu();
    }));
    if (r.win) setTimeout(() => this.app.audio.play('star'), 250);
    return n;
  }

  // ------------------------------------------------------------------
  build_ending() {
    const stars = save.stars.reduce((a, b) => a + b, 0);
    const n = el(`
      <div>
        <canvas class="fireworks" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
        <div class="end-wrap">
          <div class="logo-big" style="font-size:clamp(44px,7vw,96px)">${t('ending.title')}</div>
          <p>${t('ending.story')}</p>
          <div class="result-grid" style="max-width:520px;margin:0 auto">
            <div class="cell"><div class="k">${t('ending.kills')}</div><div class="v">${save.stats.kills}</div></div>
            <div class="cell"><div class="k">${t('ending.bosses')}</div><div class="v">${save.stats.bosses}</div></div>
            <div class="cell"><div class="k">${t('ending.stars')}</div><div class="v" style="color:var(--gold)">★ ${stars} / ${LEVELS.length * 3}</div></div>
            <div class="cell"><div class="k">${t('ending.endless')}</div><div class="v" style="color:var(--good)">${t('ending.unlocked')}</div></div>
          </div>
          <p class="credits">${t('ending.credits')}</p>
          <div class="row-btns"><button class="btn" data-a="menu">${t('ending.menu')}</button><button class="btn ghost" data-a="endless">${t('ending.playEndless')}</button></div>
        </div>
      </div>`);
    n.querySelector('[data-a=menu]').addEventListener('click', () => { this.stopFireworks?.(); this.show('title'); });
    n.querySelector('[data-a=endless]').addEventListener('click', () => { this.stopFireworks?.(); this.app.startGame({ endless: true, dinoId: save.dino, riderId: save.rider }); });
    requestAnimationFrame(() => this.fireworks(n.querySelector('.fireworks')));
    this.app.audio.startMusic('victory');
    return n;
  }

  fireworks(canvas) {
    const ctx = canvas.getContext('2d');
    const parts = [];
    let alive = true;
    let last = performance.now();
    let spawnAcc = 0;
    const resize = () => { canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; };
    resize();
    const burst = () => {
      const x = canvas.width * (0.15 + Math.random() * 0.7);
      const y = canvas.height * (0.1 + Math.random() * 0.4);
      const hue = Math.floor(Math.random() * 360);
      const n = 70 + Math.floor(Math.random() * 50);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 80 + Math.random() * 260;
        parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1.2 + Math.random() * 0.8, t: 0, hue: hue + Math.random() * 40 });
      }
      this.app.audio.play('explosion', { volume: 0.25, pitch: 1.6 });
    };
    const step = (now) => {
      if (!alive || !canvas.isConnected) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      spawnAcc += dt;
      if (spawnAcc > 0.55) { spawnAcc = 0; burst(); }
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += dt;
        if (p.t > p.life) { parts.splice(i, 1); continue; }
        p.vy += 160 * dt; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const a = 1 - p.t / p.life;
        ctx.fillStyle = `hsla(${p.hue},100%,65%,${a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    this.stopFireworks = () => { alive = false; };
  }
}
