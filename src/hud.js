// 游戏内 HUD（跑道模式）
import * as THREE from 'three';
import { GATES, WEAPON_LEVELS, WEAPON_MAX, XP_NEED } from './data.js';
import { formatTime } from './util.js';
import { t } from './i18n.js';
import { bendVec } from './bend.js';

export const SKILL_ICON = {
  roar: '🗯️', charge: '🐂', pounce: '🐾', spin: '🌀', stomp: '💥', frenzy: '🔥', fortress: '🛡️',
  dive: '☄️', sonic: '🎺', venom: '🧪', wave: '🌊', spikes: '🦔', sprint: '⚡',
};
export const WEAPON_ICON = {
  spear: '🔱', arrow: '🏹', fireball: '🔥', laser: '💠', bullet: '🔫', shuriken: '✴️', missile: '🚀', ice: '❄️', rock: '🪨', cannon: '💣',
};

const _v = new THREE.Vector3();

export class Hud {
  constructor(root, fxLayer, { dino, rider, thumb, touch, endless }) {
    this.root = root;
    this.fxLayer = fxLayer;
    this.endless = endless;
    root.innerHTML = `
      <div class="dmg-flash"></div>
      <div class="hud-player panel">
        <div class="portrait">${thumb ? `<img src="${thumb}">` : ''}</div>
        <div>
          <div class="nm">${dino.name}<small>${t('common.rider', { name: rider.name })}</small></div>
          <div class="bar-outer"><div class="bar-fill ghost"></div><div class="bar-fill hp"></div><div class="bar-text"></div></div>
          <div class="weapon-row">
            <span class="wicon">${WEAPON_ICON[rider.weapon.type] || '🎯'}</span>
            <span class="wlv">Lv.1</span>
            <span class="wname">${rider.weapon.name}</span>
          </div>
          <div class="bar-outer thin xp"><div class="bar-fill xpfill"></div></div>
          <div class="gate-icons"></div>
          <div class="buffs"></div>
        </div>
      </div>
      <div class="hud-top">
        <div class="route ${endless ? 'hidden' : ''}">
          <div class="route-bar"><div class="route-fill"></div><div class="route-dino">🦖</div><div class="route-boss">💀</div></div>
          <div class="route-text"></div>
        </div>
        <div class="endless-dist ${endless ? '' : 'hidden'}"></div>
        <div class="boss-wrap"></div>
      </div>
      <div class="hud-right">
        <div class="hud-stats">
          <div class="hud-stat gold"><i class="coin-ico"></i> <span class="coins">0</span></div>
          <div class="hud-stat">💀 <span class="kills">0</span></div>
          <div class="hud-stat">⏱ <span class="time">0:00</span></div>
        </div>
      </div>
      <div class="combo"><div class="n">0</div><div class="l">${t('hud.combo')}</div></div>
      <div class="lvlup"></div>
      <div class="hud-skills">
        <div class="skill-ico big skill"><div class="lbl">${dino.skill.name}</div>${SKILL_ICON[dino.skill.type] || '✨'}<div class="cd"></div><div class="cdt"></div><div class="key">Q</div></div>
      </div>
      <div class="hud-hints">
        ${t('hud.hints')}
      </div>`;
    if (touch) root.querySelector('.hud-hints').classList.add('hidden');
    const $ = (s) => root.querySelector(s);
    this.el = {
      flash: $('.dmg-flash'), hp: $('.bar-fill.hp'), ghost: $('.bar-fill.ghost'), hpText: $('.bar-text'),
      wlv: $('.wlv'), xp: $('.xpfill'), gates: $('.gate-icons'), buffs: $('.buffs'),
      routeFill: $('.route-fill'), routeDino: $('.route-dino'), routeText: $('.route-text'), dist: $('.endless-dist'),
      bossWrap: $('.boss-wrap'), route: $('.route'),
      coins: $('.coins'), kills: $('.kills'), time: $('.time'), combo: $('.combo'), comboN: $('.combo .n'),
      skillCd: $('.skill .cd'), skillCdt: $('.skill .cdt'), skill: $('.skill'), lvlup: $('.lvlup'),
    };
    this.reticle = document.createElement('div');
    this.reticle.className = 'reticle';
    fxLayer.appendChild(this.reticle);
    this.cache = {};
    this.bossEl = null;
    this.lastCombo = 0;
    this.lvlTimer = null;
  }

  set(key, val, fn) {
    if (this.cache[key] === val) return;
    this.cache[key] = val;
    fn(val);
  }

  damageFlash() {
    const f = this.el.flash;
    f.style.transition = 'none';
    f.style.opacity = '0.7';
    requestAnimationFrame(() => { f.style.transition = 'opacity .45s'; f.style.opacity = ''; });
  }

  levelUp(lv, name) {
    const el = this.el.lvlup;
    el.innerHTML = `<div class="a">${t('hud.levelUp')}</div><div class="b">Lv.${lv}${lv >= WEAPON_MAX ? ' MAX' : ''} · ${name}</div>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.lvlTimer);
    this.lvlTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  showBoss(boss) {
    this.el.route.classList.add('hidden');
    this.el.dist.classList.add('hidden');
    this.el.bossWrap.innerHTML = `
      <div class="boss-bar">
        <div class="nm">${boss.def.name}<small>${boss.def.title}</small></div>
        <div class="bar-outer"><div class="bar-fill ghost"></div><div class="bar-fill hp"></div><div class="bar-text"></div></div>
        <div class="boss-phase"></div>
      </div>`;
    this.bossEl = {
      hp: this.el.bossWrap.querySelector('.hp'), ghost: this.el.bossWrap.querySelector('.ghost'),
      text: this.el.bossWrap.querySelector('.bar-text'), phase: this.el.bossWrap.querySelector('.boss-phase'),
    };
  }

  hideBoss() {
    this.el.bossWrap.innerHTML = '';
    this.bossEl = null;
    if (this.endless) this.el.dist.classList.remove('hidden');
  }

  update(game, dt) {
    const p = game.player;
    const st = p.stats;
    const hpR = Math.max(0, p.hp / st.maxHp);
    this.set('hp', Math.round(hpR * 1000), () => {
      this.el.hp.style.width = (hpR * 100).toFixed(1) + '%';
      this.el.ghost.style.width = (hpR * 100).toFixed(1) + '%';
      this.el.hp.classList.toggle('low', hpR < 0.3);
      this.root.classList.toggle('low-hp', hpR < 0.25 && p.alive);
    });
    this.set('hpt', Math.ceil(p.hp), (v) => { this.el.hpText.textContent = `${v} / ${st.maxHp}`; });

    // 武器
    const W = p.weapon;
    this.set('wlv', W.level, (v) => {
      this.el.wlv.textContent = v >= WEAPON_MAX ? 'Lv.MAX' : 'Lv.' + v;
      this.el.wlv.classList.toggle('max', v >= WEAPON_MAX);
    });
    const xr = W.level >= WEAPON_MAX ? 1 : W.xp / XP_NEED[W.level];
    this.set('xp', Math.round(xr * 100), (v) => { this.el.xp.style.width = v + '%'; });
    this.set('gates', W.gates.length, () => {
      const counts = {};
      for (const k of W.gates) counts[k] = (counts[k] || 0) + 1;
      this.el.gates.innerHTML = Object.entries(counts).map(([k, n]) => `<span title="${GATES[k].name}">${GATES[k].icon}${n > 1 ? '×' + n : ''}</span>`).join('');
    });

    const buffs = [];
    if (p.buffs.frenzy > 0) buffs.push(t('buff.frenzy', { t: p.buffs.frenzy.toFixed(1) }));
    if (p.buffs.fortress > 0) buffs.push(t('buff.fortress', { t: p.buffs.fortress.toFixed(1) }));
    if (p.buffs.shield > 0) buffs.push(t('buff.shield', { t: p.buffs.shield.toFixed(1) }));
    if (p.buffs.sprint > 0) buffs.push(t('buff.sprint', { t: p.buffs.sprint.toFixed(1) }));
    if (p.buffs.power > 0) buffs.push(t('buff.power', { t: p.buffs.power.toFixed(1) }));
    if (p.poisonT > 0) buffs.push(t('buff.poison'));
    if (p.slowT > 0) buffs.push(t('buff.slow'));
    this.set('buffs', buffs.join('|'), () => { this.el.buffs.innerHTML = buffs.map((b) => `<span class="buff">${b}</span>`).join(''); });

    // 技能
    const scd = p.def.skill.cd * st.cdMul;
    const sr = Math.max(0, p.skillCd / scd);
    this.set('scd', Math.round(sr * 100), () => {
      this.el.skillCd.style.setProperty('--p', (sr * 100).toFixed(0) + '%');
      this.el.skill.classList.toggle('ready', sr <= 0);
    });
    this.set('scdt', p.skillCd > 0 ? Math.ceil(p.skillCd) : 0, (v) => { this.el.skillCdt.textContent = v > 0 ? v : ''; });

    // 路线进度
    if (!this.endless) {
      const pr = game.progress;
      this.set('route', Math.round(pr * 400), () => {
        this.el.routeFill.style.width = (pr * 100).toFixed(1) + '%';
        this.el.routeDino.style.left = (pr * 100).toFixed(1) + '%';
      });
      this.set('routeT', Math.max(0, Math.ceil((game.length - p.pos.z) / 10) * 10), (v) => {
        this.el.routeText.textContent = v > 0 ? t('hud.toBoss', { n: v }) : t('hud.bossFight');
      });
    } else {
      this.set('dist', Math.floor(p.pos.z), (v) => { this.el.dist.innerHTML = t('hud.dist', { n: v }); });
    }

    this.set('coins', game.stats.coins, (v) => { this.el.coins.textContent = v; });
    this.set('kills', game.stats.kills, (v) => { this.el.kills.textContent = v; });
    this.set('time', Math.floor(game.time), () => { this.el.time.textContent = formatTime(game.time); });

    const c = game.combo;
    this.set('combo', c, (v) => {
      this.el.combo.classList.toggle('show', v >= 5);
      this.el.comboN.textContent = v;
      if (v > this.lastCombo) { this.el.combo.classList.remove('bump'); void this.el.combo.offsetWidth; this.el.combo.classList.add('bump'); }
      this.lastCombo = v;
    });

    if (this.bossEl && game.boss) {
      const b = game.boss;
      const r = Math.max(0, b.hp / b.maxHp);
      this.set('bhp', Math.round(r * 1000) + '|' + Math.ceil(b.hp), () => {
        this.bossEl.hp.style.width = (r * 100).toFixed(1) + '%';
        this.bossEl.ghost.style.width = (r * 100).toFixed(1) + '%';
        this.bossEl.text.textContent = `${Math.ceil(b.hp)} / ${b.maxHp}`;
      });
      this.set('bph', b.phase, (v) => { this.bossEl.phase.textContent = b.phases > 1 ? t('hud.phase', { n: v, max: b.phases }) : ''; });
    }

    // 自动瞄准标记
    const aim = game.aimTarget;
    if (aim && game.state !== 'win') {
      bendVec(aim.getCenter(_v)).project(game.camera);
      if (_v.z < 1) {
        this.reticle.style.display = 'block';
        this.reticle.style.left = ((_v.x * 0.5 + 0.5) * game.viewW).toFixed(0) + 'px';
        this.reticle.style.top = ((-_v.y * 0.5 + 0.5) * game.viewH).toFixed(0) + 'px';
      } else this.reticle.style.display = 'none';
    } else this.reticle.style.display = 'none';
  }

  dispose() {
    clearTimeout(this.lvlTimer);
    this.root.innerHTML = '';
    this.root.classList.remove('low-hp');
    this.reticle.remove();
  }
}
