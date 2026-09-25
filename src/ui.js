// 菜单界面：标题 / 选择坐骑 / 关卡 / 升级 / 设置 / 帮助 / 暂停 / 结算 / 结局
import { DINOS, RIDERS, LEVELS, BOSSES, UPGRADES, upgradeCost } from './data.js';
import { save, persist, resetSave } from './save.js';
import { SKILL_ICON, WEAPON_ICON } from './hud.js';
import { formatTime } from './util.js';

const ATTACK_NAME = { bite: '撕咬', horn: '角顶', claw: '爪击', tail: '尾击', stomp: '踩踏', peck: '啄击', headbutt: '头槌' };
const BIOME_EMOJI = { jungle: '🌴', desert: '🏜️', frost: '❄️', swamp: '🍄', volcano: '🌋', shadow: '🏰' };
const BIOME_BG = {
  jungle: 'linear-gradient(160deg,#2f7a3a 0%,#1b4a2a 55%,#0d2416 100%)',
  desert: 'linear-gradient(160deg,#e0a64a 0%,#a8622a 55%,#4a2a14 100%)',
  frost: 'linear-gradient(160deg,#9ad4ff 0%,#4a7ab0 55%,#1a2a4a 100%)',
  swamp: 'linear-gradient(160deg,#5a7a4a 0%,#2e4a3a 55%,#101c18 100%)',
  volcano: 'linear-gradient(160deg,#ff7a2a 0%,#8a1a14 55%,#240808 100%)',
  shadow: 'linear-gradient(160deg,#8a4ad0 0%,#3a1a6a 55%,#0e0620 100%)',
};
const WEAPON_TRAITS = (w) => {
  const t = [];
  if (w.count > 1) t.push(`${w.count} 连发`);
  if (w.pierce) t.push(`穿透 ${w.pierce}`);
  if (w.aoe) t.push(`爆炸范围 ${w.aoe}m`);
  if (w.homing) t.push('自动追踪');
  if (w.bounce) t.push(`弹射 ${w.bounce} 次`);
  if (w.slow) t.push(`减速 ${Math.round(w.slow * 100)}%`);
  if (w.burn) t.push('灼烧');
  if (w.arc) t.push('抛物线');
  if (w.knock) t.push('强力击退');
  return t;
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
          <div class="logo-big">恐龙骑士</div>
          <div class="logo-sub">DINO RIDERS · 远古征途</div>
          <div class="tagline">骑上恐龙沿着远古大道一路狂奔！骑手自动开火，<br>左右走位撞飞怪物、穿过强化门升级武器，击败终点的恐怖首领！</div>
        </div>
        <div class="menu">
          <button class="btn" data-act="levels"><span class="ico">⚔️</span>开始冒险</button>
          <button class="btn ghost" data-act="select"><span class="ico">🦖</span>选择坐骑 · 骑手</button>
          <button class="btn ghost" data-act="shop"><span class="ico">🛠️</span>升级工坊</button>
          <button class="btn ghost" data-act="settings"><span class="ico">⚙️</span>设置</button>
          <button class="btn ghost" data-act="help"><span class="ico">📖</span>操作说明</button>
        </div>
        <div class="current">
          <div class="lbl">当前坐骑</div>
          <div class="nm">${d.name}</div>
          <div class="rd">骑手 · ${r.name}</div>
          <div class="rd" style="margin-top:8px;font-size:14px;color:#fffa">⭐ ${totalStars} / ${LEVELS.length * 3}　🏆 已通关 ${save.stars.filter((s) => s > 0).length} / ${LEVELS.length}</div>
        </div>
        <div style="position:absolute;right:4vw;top:22px">${this.coinPill()}</div>
      </div>`);
    n.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'settings') this.show('settings', { from: 'title' });
      else this.show(a);
    }));
    return n;
  }

  // ------------------------------------------------------------------
  build_select() {
    const n = el(`
      <div>
        <div class="topbar">
          <button class="btn ghost small" data-back>← 返回</button>
          <h2>选择坐骑</h2>
          <div class="tabs">
            <div class="tab ${this.tab === 'dino' ? 'active' : ''}" data-tab="dino">🦖 恐龙 · ${DINOS.length}</div>
            <div class="tab ${this.tab === 'rider' ? 'active' : ''}" data-tab="rider">🧑 骑手 · ${RIDERS.length}</div>
          </div>
          <div class="spacer"></div>
          ${this.coinPill()}
        </div>
        <div class="grid-panel panel"><div class="card-grid"></div></div>
        <div class="info-panel panel"></div>
        <div class="hint-drag">拖动画面可旋转查看</div>
        <div class="preview-name"><div class="a"></div><div class="b"></div></div>
        <div class="bottom">
          <button class="btn" data-go>确认出发 →</button>
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
      pb.textContent = `骑手 · ${r.name}`;
      if (this.tab === 'dino') {
        const s = d.stats;
        const bar = (k, v, max, txt) => `<div class="stat-row"><span class="k">${k}</span><span class="bar"><i style="width:${Math.min(100, v / max * 100)}%"></i></span><span class="v">${txt}</span></div>`;
        const wins = save.dinoWins[d.id] || 0;
        info.innerHTML = `
          <h3>${d.name}</h3>
          <div class="en">${d.en}</div>
          <span class="era">${d.era}</span> <span class="era" style="background:rgba(79,201,255,.15);color:#8fdcff">攻击方式：${ATTACK_NAME[d.attack]}</span>
          ${wins ? `<span class="era" style="background:rgba(98,227,127,.15);color:#8ff0a0">胜场 ${wins}</span>` : ''}
          <p>${d.desc}</p>
          <div style="margin-top:12px">
            ${bar('生命', s.hp, 330, s.hp)}
            ${bar('攻击', s.atk, 34, s.atk)}
            ${bar('防御', s.def, 0.45, Math.round(s.def * 100) + '%')}
            ${bar('速度', s.speed, 16, s.speed)}
            ${bar('攻速', s.atkRate, 1.8, s.atkRate.toFixed(1))}
            ${bar('范围', s.reach, 3.2, s.reach.toFixed(1))}
          </div>
          <div class="skill-box">
            <div class="t">${SKILL_ICON[d.skill.type]} 技能：${d.skill.name}<small>冷却 ${d.skill.cd}s</small></div>
            <div class="d">${d.skill.desc}</div>
          </div>`;
      } else {
        const w = r.weapon;
        const dps = (w.dmg * (w.count || 1) / w.cd).toFixed(0);
        info.innerHTML = `
          <h3>${r.name}</h3>
          <div class="en">${r.en}</div>
          <p style="margin-top:8px">${r.desc}</p>
          <div class="skill-box">
            <div class="t">${WEAPON_ICON[w.type]} 武器：${w.name}</div>
            <div class="d">伤害 ${w.dmg}${w.count > 1 ? ' × ' + w.count : ''} · 间隔 ${w.cd}s · 理论秒伤 ${dps}<br>${WEAPON_TRAITS(w).join(' · ') || '稳定可靠'}</div>
          </div>
          <div class="skill-box" style="background:rgba(98,227,127,.08);border-color:rgba(98,227,127,.3)">
            <div class="t" style="color:#8ff0a0">✨ 被动加成</div>
            <div class="d">${r.bonusText}</div>
          </div>
          <p style="margin-top:12px;color:var(--muted);font-size:12.5px">骑手会自动瞄准前方的怪物持续射击。击败怪物获得经验，武器最高可升到 Lv.10（多重弹道、射速、穿透、追踪）。</p>`;
      }
    };

    const renderGrid = () => {
      if (this.tab === 'dino') {
        grid.innerHTML = DINOS.map((d) => `
          <div class="card ${d.id === save.dino ? 'active' : ''}" data-id="${d.id}">
            ${save.dinoWins[d.id] ? `<span class="badge">🏆${save.dinoWins[d.id]}</span>` : ''}
            <img src="${thumbs.dino[d.id] || ''}" alt="">
            <div class="nm">${d.name}</div>
          </div>`).join('');
      } else {
        grid.innerHTML = RIDERS.map((r) => `
          <div class="card ${r.id === save.rider ? 'active' : ''}" data-id="${r.id}">
            <img src="${thumbs.rider[r.id] || ''}" alt="">
            <div class="nm">${r.name}</div>
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
          <div class="boss">全程 ${lv.length} 米 · 首领：${BOSSES[lv.boss].name}</div>
          <div class="desc">${lv.desc}</div>
          <div class="stars">${[0, 1, 2].map((k) => `<span class="${k < stars ? 'on' : 'off'}">★</span>`).join('')}
            ${save.bestTime[i] ? `<span style="font-size:12px;color:#fffa;letter-spacing:0;margin-left:8px">最快 ${formatTime(save.bestTime[i])}</span>` : ''}</div>
          ${locked ? '<div class="lock">🔒</div>' : ''}
        </div>`;
    }).join('');
    const endlessLocked = save.unlocked < 2;
    const n = el(`
      <div>
        <div class="topbar">
          <button class="btn ghost small" data-back>← 返回</button>
          <h2>选择关卡</h2>
          <span style="color:var(--muted);font-weight:700">出战：${d.name} · ${r.name}</span>
          <button class="btn ghost small" data-sel>更换</button>
          <div class="spacer"></div>
          ${this.coinPill()}
        </div>
        <div class="map">
          ${cards}
          <div class="level-card endless ${endlessLocked ? 'locked' : ''}" data-endless style="animation-delay:.4s">
            <div class="bg" style="background:linear-gradient(120deg,#3a1a0a,#7a2a1a 40%,#2a1a4a)"></div>
            <div class="emoji">♾️</div>
            <h4>无尽模式</h4>
            <div class="desc">随机地形，道路永无尽头，每 1400 米出现一只首领。${save.endlessBest ? `最佳纪录：${save.endlessBest} 米` : endlessLocked ? '通过第 1 关后解锁' : '尚无纪录，快来挑战！'}</div>
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
          <button class="btn ghost small" data-back>← 返回</button>
          <h2>升级工坊</h2>
          <span style="color:var(--muted)">永久强化，对所有恐龙与骑手生效</span>
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
              <div class="d">${u.desc}（当前：${this.upgradeNow(u, lv)}）</div>
              <div class="pips">${Array.from({ length: u.max }, (_, k) => `<i class="${k < lv ? 'on' : ''}"></i>`).join('')}</div>
            </div>
            <button class="btn small" data-id="${u.id}" ${maxed || save.coins < cost ? 'disabled' : ''}>${maxed ? '已满级' : `<i class="coin-ico"></i> ${cost}`}</button>
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
          <h2>⚙️ 设置</h2>
          <div class="set-row"><label>🎵 音乐音量</label><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-k="music"></div>
          <div class="set-row"><label>🔊 音效音量</label><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-k="sfx"></div>
          <div class="set-row"><label>🎨 画质</label><div class="seg" data-k="quality"><button data-v="high" class="${s.quality === 'high' ? 'on' : ''}">高（泛光+阴影）</button><button data-v="low" class="${s.quality === 'low' ? 'on' : ''}">流畅</button></div></div>
          <div class="set-row"><label>⚡ 自动调节分辨率（保持流畅）</label><div class="seg" data-k="autoRes"><button data-v="1" class="${s.autoRes !== false ? 'on' : ''}">开</button><button data-v="0" class="${s.autoRes === false ? 'on' : ''}">关</button></div></div>
          <div class="set-row"><label>📊 显示帧率</label><div class="seg" data-k="showFps"><button data-v="1" class="${s.showFps ? 'on' : ''}">开</button><button data-v="0" class="${!s.showFps ? 'on' : ''}">关</button></div></div>
          <div class="set-row"><label>📳 镜头震动（容易晕可关闭）</label><div class="seg" data-k="shake"><button data-v="1" class="${s.shake ? 'on' : ''}">开</button><button data-v="0" class="${!s.shake ? 'on' : ''}">关</button></div></div>
          ${from === 'title' ? `<div class="set-row"><label>🗑️ 重置进度</label><button class="btn danger small" data-reset>清空存档</button></div>` : ''}
          <div class="row-btns"><button class="btn" data-back>完成</button></div>
        </div>
      </div>`);
    n.querySelectorAll('input[type=range]').forEach((inp) => inp.addEventListener('input', () => {
      s[inp.dataset.k] = +inp.value;
      this.app.applySettings();
      persist();
    }));
    n.querySelectorAll('.seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const k = seg.dataset.k;
      const v = b.dataset.v;
      s[k] = k === 'quality' ? v : v === '1';
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      this.app.applySettings();
      persist();
    })));
    const reset = n.querySelector('[data-reset]');
    if (reset) {
      let armed = false;
      reset.addEventListener('click', () => {
        if (!armed) { armed = true; reset.textContent = '再点一次确认清空'; return; }
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
          <h2>📖 操作说明</h2>
          <div class="keys">
            <div><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd></div><div>左右移动（恐龙会自动向前跑）</div>
            <div><kbd>按住鼠标</kbd></div><div>左右拖动也能移动；触屏上直接用手指左右滑动</div>
            <div><kbd>空格</kbd> / <kbd>W</kbd></div><div>跳跃：跳过怪物、落石和地面冲击</div>
            <div><kbd>Q</kbd> / <kbd>E</kbd> / <kbd>Shift</kbd></div><div>释放恐龙专属技能</div>
            <div><kbd>Esc</kbd> / <kbd>P</kbd></div><div>暂停</div>
          </div>
          <div class="help-tip">
            🎯 骑手会<b>自动射击</b>前方的怪物，恐龙会<b>自动撕咬</b>贴身的敌人。<br>
            💥 血量低的小怪可以直接<b>撞飞</b>；又硬又大的怪物和落石要先打掉，或者绕开。<br>
            ⭐ 击败怪物获得经验，<b>武器自动升级</b>到 Lv.10；路上的<b>强化门</b>二选一，从哪边跑过就获得哪边的强化。<br>
            💀 跑到终点迎战首领：地面出现<b style="color:#ff6a6a">红色预警</b>时及时左右躲开。<br>
            ⭐ 星级：通关 1 星 · 剩余生命 ≥50% 再得 1 星 · 消灭 70% 以上的怪物再得 1 星。
          </div>
          <div class="row-btns"><button class="btn" data-back>明白了！</button></div>
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
          <h2>⏸ 暂停</h2>
          <div style="display:flex;flex-direction:column;gap:12px">
            <button class="btn" data-a="resume">▶ 继续战斗</button>
            <button class="btn ghost" data-a="restart">↻ 重新开始</button>
            <button class="btn ghost" data-a="settings">⚙️ 设置</button>
            <button class="btn ghost" data-a="help">📖 操作说明</button>
            <button class="btn danger" data-a="quit">⌂ 返回主菜单</button>
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
        <h2 style="color:#ffe27a">🏆 胜利！</h2>
        <div class="big-stars">${[0, 1, 2].map((k) => `<span class="${k < r.stars ? 'on' : ''}" style="animation-delay:${0.2 + k * 0.25}s">★</span>`).join('')}</div>
        <div class="result-grid">
          <div class="cell"><div class="k">用时</div><div class="v">${formatTime(r.time)}</div></div>
          <div class="cell"><div class="k">击杀</div><div class="v">${r.kills}</div></div>
          <div class="cell"><div class="k">最高连击</div><div class="v">${r.maxCombo}</div></div>
          <div class="cell"><div class="k">武器等级</div><div class="v">Lv.${r.weaponLv >= 10 ? 'MAX' : r.weaponLv}</div></div>
          <div class="cell"><div class="k">拾取金币</div><div class="v gold">+${r.coins}</div></div>
          <div class="cell"><div class="k">关卡奖励</div><div class="v gold">+${r.reward}</div></div>
        </div>
        <div class="star-reqs">
          <div class="ok">★ 击败首领通关</div>
          <div class="${r.hpR >= 0.5 ? 'ok' : ''}">★ 剩余生命 ≥ 50%（${Math.round(r.hpR * 100)}%）</div>
          <div class="${r.killRate >= 0.7 ? 'ok' : ''}">★ 消灭 70% 以上的怪物（${Math.round(r.killRate * 100)}%）</div>
        </div>`;
    } else {
      body = `
        <h2 style="color:#ff8080">${r.endless ? '♾️ 冒险结束' : '💀 战败'}</h2>
        ${r.endless ? `<div style="text-align:center;font-size:22px;font-weight:900;margin-bottom:12px">一共跑了 ${r.dist} 米${r.newBest ? ' <span style="color:var(--gold)">· 新纪录！</span>' : ''}</div>` : `<p style="text-align:center;color:var(--muted);margin-bottom:12px">${r.bossReached ? '已经打到首领了，差一点点！' : `跑完了 ${Math.round(r.progress * 100)}% 的路程。`}去升级工坊强化一下，或者换一只恐龙试试？</p>`}
        <div class="result-grid">
          <div class="cell"><div class="k">武器等级</div><div class="v">Lv.${r.weaponLv >= 10 ? 'MAX' : r.weaponLv}</div></div>
          <div class="cell"><div class="k">击杀</div><div class="v">${r.kills}</div></div>
          <div class="cell"><div class="k">最高连击</div><div class="v">${r.maxCombo}</div></div>
          <div class="cell"><div class="k">获得金币</div><div class="v gold">+${r.coins}</div></div>
        </div>`;
    }
    const n = el(`
      <div>
        <div class="overlay-dim"></div>
        <div class="center-panel panel result">
          ${body}
          <div class="row-btns">
            ${r.final && r.win ? '<button class="btn" data-a="ending">🎉 观看结局</button>' : ''}
            ${hasNext ? '<button class="btn" data-a="next">下一关 →</button>' : ''}
            <button class="btn ${hasNext || (r.final && r.win) ? 'ghost' : ''}" data-a="retry">↻ ${r.win ? '再玩一次' : '再试一次'}</button>
            ${!r.win ? '<button class="btn ghost" data-a="shop">🛠️ 升级工坊</button>' : ''}
            <button class="btn ghost" data-a="menu">⌂ 主菜单</button>
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
          <div class="logo-big" style="font-size:clamp(44px,7vw,96px)">恭喜通关！</div>
          <p>你和你的恐龙伙伴穿越了丛林、沙海、雪原、沼泽与火山，<br>最终在暗影要塞击败了暗影魔王。<br>远古大陆重新迎来了和平与阳光！🌅</p>
          <div class="result-grid" style="max-width:520px;margin:0 auto">
            <div class="cell"><div class="k">累计击杀</div><div class="v">${save.stats.kills}</div></div>
            <div class="cell"><div class="k">击败首领</div><div class="v">${save.stats.bosses}</div></div>
            <div class="cell"><div class="k">收集星星</div><div class="v" style="color:var(--gold)">★ ${stars} / ${LEVELS.length * 3}</div></div>
            <div class="cell"><div class="k">无尽模式</div><div class="v" style="color:var(--good)">已解锁</div></div>
          </div>
          <p class="credits">试试用全部 20 种恐龙通关，收集所有星星，或挑战无尽模式的最高纪录！<br>
          本游戏中的所有 3D 模型、地形、音效与音乐均为程序实时生成 · Three.js + Web Audio</p>
          <div class="row-btns"><button class="btn" data-a="menu">返回主菜单</button><button class="btn ghost" data-a="endless">♾️ 挑战无尽模式</button></div>
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
