// The in-run HUD: everything drawn over the desk while a wave is on, plus the
// three modal screens (owned by Screens, ./screens.js).
//
// Every per-frame setter caches the value it last wrote and only touches the
// DOM when something actually changed — most frames call every setter and
// write nothing at all. Transient things (a hit landing, a banner, a kill-feed
// line, a damage wedge) are never reused and restarted: each is a fresh little
// element that plays its own entrance once and removes itself, which is the
// "no forced reflow to restart an animation" rule from the spec — a node that
// was never on the page before has no stale animation state to fight.
import './hud.css';
import { Screens } from './screens.js';

/** Marks a tip segment for emphasis, so callers pass structured text, never markup. */
export const EM = (text) => ({ em: text });

const FEED_MAX = 5;
const FEED_LIFE = 1.8;
const BANNER_LIFE = 1.9;
const HIT_LIFE = 0.28;
const DMG_LIFE = 1.0;
const TIP_DEFAULT = 4;

// Round to a step so a spring that is still settling doesn't write the DOM
// every frame over a change too small to see.
const q = (v, step) => Math.round(v / step) * step;

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function textParts(parts) {
  if (typeof parts === 'string') return parts.replace(/[<>]/g, '');
  return parts.map((p) => (typeof p === 'string' ? p.replace(/[<>]/g, '')
    : `<b>${String(p.em).replace(/[<>]/g, '')}</b>`)).join('');
}

export class Hud {
  constructor(root) {
    this.root = root;
    this.el = {};
    this._c = {}; // last-written-value cache, per setter
    this._slotsSig = '';
    this._tallyNums = [];

    root.appendChild(el(`<div id="irRun" class="ir-run">
      <div class="ir-cluster ir-top-l">
        <div class="ir-score"><span class="ir-lbl">SCORE</span><b id="irScore">0</b></div>
        <div id="irCombo" class="ir-combo"></div>
      </div>

      <div class="ir-cluster ir-top-r">
        <div class="ir-wave">WAVE <b id="irWave">1</b></div>
        <div id="irLeft" class="ir-left"></div>
        <div id="irMod" class="ir-mod"></div>
      </div>

      <div id="irBoss" class="ir-boss">
        <div id="irBossName" class="ir-foe-title"></div>
        <div class="ir-foe-meter"><i id="irBossFill"></i></div>
      </div>

      <div id="irFeed" class="ir-feed"></div>

      <div class="ir-cluster ir-bl">
        <div class="ir-hprow">
          <span class="ir-lbl">LIFE</span>
          <div class="ir-hpbar"><i id="irHpFill"></i></div>
          <b id="irHpNum">0</b>
          <span id="irEye" class="ir-eye" title="opens red when something's hunting you">
            <svg viewBox="0 0 28 16" aria-hidden="true">
              <path class="ir-eye-shut" d="M2 8 Q14 2 26 8" />
              <g class="ir-eye-open">
                <path d="M2 8 Q14 -1 26 8 Q14 17 2 8 Z" />
                <circle cx="14" cy="8" r="3.1" />
              </g>
            </svg>
          </span>
        </div>
        <div class="ir-ammorow">
          <b id="irMag">0</b><span id="irReserve" class="ir-reserve">/0</span>
          <span id="irReload" class="ir-reload">RE-INKING</span>
        </div>
        <div class="ir-icons">
          <div id="irNades" class="ir-nades"></div>
          <div id="irBand" class="ir-band"></div>
        </div>
        <div id="irTally" class="ir-tally">
          <span class="ir-tallylbl">MARKS</span>
          <span id="irTallyPast" class="ir-tallypast"></span>
          <b id="irTallyNow" class="ir-tallynow">0</b>
        </div>
      </div>

      <div class="ir-cluster ir-br">
        <div class="ir-weaponrow">
          <b id="irWeaponName">RIFLE</b>
          <div id="irHint" class="ir-hint"></div>
        </div>
        <div id="irSlots" class="ir-slots"></div>
      </div>

      <div id="irEdge" class="ir-edge">
        <div class="ir-edgelbl">BLADE</div>
        <div class="ir-edgebar"><i id="irEdgeFill"></i></div>
        <div id="irEdgeReady" class="ir-edgeready">SHARP</div>
      </div>

      <div class="ir-center">
        <div id="irScope" class="ir-scope">
          <div class="ir-scope-mask"></div>
          <div class="ir-scope-ring"></div>
          <div class="ir-scope-cross">
            <i class="n"></i><i class="s"></i><i class="e"></i><i class="w"></i>
          </div>
          <div class="ir-scope-dot"></div>
        </div>

        <div id="irGuard" class="ir-guard"></div>
        <div id="irWrap" class="ir-wrap"></div>
        <div id="irGrapple" class="ir-grapple"></div>
        <div id="irStam" class="ir-stam"><i id="irStamFill"></i></div>

        <div id="irCross" class="ir-cross">
          <i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i>
          <i class="slit"></i>
        </div>
        <div id="irHits" class="ir-hits"></div>
        <div id="irDmg" class="ir-dmg"></div>
        <div id="irPips" class="ir-pips">
          <i class="ir-pip" data-i="0"></i><i class="ir-pip" data-i="1"></i>
        </div>
      </div>

      <div id="irBanner" class="ir-banner"></div>
      <div id="irTip" class="ir-tip"></div>
    </div>`));

    const $ = (id) => this.root.querySelector(id);
    this.el = {
      run: $('#irRun'),
      score: $('#irScore'), combo: $('#irCombo'),
      wave: $('#irWave'), left: $('#irLeft'), mod: $('#irMod'),
      boss: $('#irBoss'), bossName: $('#irBossName'), bossFill: $('#irBossFill'),
      feed: $('#irFeed'),
      hpFill: $('#irHpFill'), hpNum: $('#irHpNum'), hpRow: this.root.querySelector('.ir-hprow'),
      mag: $('#irMag'), reserve: $('#irReserve'), reload: $('#irReload'),
      nades: $('#irNades'), band: $('#irBand'),
      tallyPast: $('#irTallyPast'), tallyNow: $('#irTallyNow'),
      weaponName: $('#irWeaponName'), hint: $('#irHint'), slots: $('#irSlots'),
      edge: $('#irEdge'), edgeFill: $('#irEdgeFill'), edgeReady: $('#irEdgeReady'),
      scope: $('#irScope'),
      guard: $('#irGuard'), wrap: $('#irWrap'), grapple: $('#irGrapple'),
      stam: $('#irStam'), stamFill: $('#irStamFill'),
      cross: $('#irCross'), hits: $('#irHits'), dmg: $('#irDmg'),
      pips: $('#irPips'), pip: [...this.root.querySelectorAll('#irPips .ir-pip')],
      eye: $('#irEye'),
      banner: $('#irBanner'), tip: $('#irTip'),
    };

    this.screens = new Screens(this.root, () => this.clearMessage());
  }

  // --- visibility -----------------------------------------------------------

  setGameVisible(on) {
    if (this._c.gameVisible === on) return;
    this._c.gameVisible = on;
    this.el.run.classList.toggle('ir-hidden', !on);
  }

  closeScreen() { this.screens.hide(); }
  get screenVisible() { return this.screens.visible; }

  // --- score / combo / wave --------------------------------------------------

  showScore(n) {
    if (this._c.score === n) return;
    this._c.score = n;
    this.el.score.textContent = n;
  }

  setCombo(x) {
    if (this._c.combo === x) return;
    this._c.combo = x;
    this.el.combo.textContent = x > 1 ? `combo ×${x}` : '';
  }

  showWave(n) {
    if (this._c.wave === n) return;
    this._c.wave = n;
    this.el.wave.textContent = n;
  }

  setLeft(n) {
    if (this._c.left === n) return;
    this._c.left = n;
    this.el.left.textContent = n > 0 ? `${n} enemies left` : '';
  }

  showTwist(s) {
    if (this._c.mod === s) return;
    this._c.mod = s;
    this.el.mod.textContent = s || '';
  }

  // --- health / ammo ----------------------------------------------------------

  showHealth(hp, max) {
    const frac = q(Math.max(0, Math.min(1, max > 0 ? hp / max : 0)), 0.005);
    const num = Math.ceil(hp);
    if (this._c.hpFrac !== frac) {
      this._c.hpFrac = frac;
      this.el.hpFill.style.transform = `scaleX(${frac})`;
    }
    if (this._c.hpNum !== num) {
      this._c.hpNum = num;
      this.el.hpNum.textContent = num;
    }
    const low = max > 0 && hp < max * 0.3;
    if (this._c.low !== low) {
      this._c.low = low;
      this.el.hpRow.classList.toggle('ir-low', low);
    }
  }

  showAmmo(mag, reserve, reloading) {
    const magTxt = mag === Infinity ? '∞' : String(mag);
    if (this._c.mag !== magTxt) { this._c.mag = magTxt; this.el.mag.textContent = magTxt; }
    if (mag === Infinity) {
      if (this._c.reserve !== '') { this._c.reserve = ''; this.el.reserve.textContent = ''; }
    } else if (this._c.reserve !== reserve) {
      this._c.reserve = reserve;
      this.el.reserve.textContent = `/${reserve}`;
    }
    if (this._c.reloading !== !!reloading) {
      this._c.reloading = !!reloading;
      this.el.reload.classList.toggle('ir-on', !!reloading);
    }
  }

  // --- grenades / bandages -----------------------------------------------------

  _iconRow(container, n, key, cls) {
    if (this._c[key] === n) return;
    this._c[key] = n;
    while (container.children.length < n) container.appendChild(el(`<i class="${cls}"></i>`));
    while (container.children.length > n) container.lastElementChild.remove();
  }

  setNades(n) { this._iconRow(this.el.nades, n, 'nades', 'ir-nade'); }
  setBandages(n) { this._iconRow(this.el.band, n, 'band', 'ir-roll'); }

  setWrap(frac) {
    const on = frac >= 0;
    if (this._c.wrapOn !== on) { this._c.wrapOn = on; this.el.wrap.classList.toggle('ir-on', on); }
    if (!on) return;
    const f = q(Math.max(0, Math.min(1, frac)), 1 / 50);
    if (this._c.wrapF !== f) { this._c.wrapF = f; this.el.wrap.style.setProperty('--f', f); }
  }

  // --- eye / tally -------------------------------------------------------------

  setEye(open) {
    if (this._c.eye === open) return;
    this._c.eye = open;
    this.el.eye.classList.toggle('ir-open', !!open);
  }

  setTally(kills) {
    if (this._c.tally === kills) return;
    const prevList = this._tallyNums.slice(-2);
    this._tallyNums.push(kills);
    this._c.tally = kills;
    this.el.tallyNow.textContent = kills;
    this.el.tallyPast.innerHTML = prevList.map((n) => `<s>${n}</s>`).join(' ');
  }

  // --- weapon slots --------------------------------------------------------------

  showSlots(weapons, activeIndex) {
    const sig = weapons.map((w, i) => `${w.hidden ? 1 : 0}${i === activeIndex ? 1 : 0}${w.name}|${w.ammoText}`).join(';');
    if (sig === this._slotsSig) return;
    this._slotsSig = sig;
    const box = this.el.slots;
    box.innerHTML = '';
    weapons.forEach((w, i) => {
      if (w.hidden) return;
      const empty = w.firesRounds && w.mag <= 0 && w.reserveLeft <= 0;
      const row = el(`<div class="ir-slot${i === activeIndex ? ' ir-active' : ''}${empty ? ' ir-empty' : ''}">
        <span class="ir-slotkey">${i + 1}</span>
        <span class="ir-slotname">${w.name}</span>
        <span class="ir-slotammo">${w.ammoText}</span>
      </div>`);
      box.appendChild(row);
    });
    const active = weapons[activeIndex];
    if (active) {
      if (this._c.wname !== active.name) { this._c.wname = active.name; this.el.weaponName.textContent = active.name; }
      if (this._c.hint !== active.hint) { this._c.hint = active.hint; this.el.hint.textContent = active.hint || ''; }
    }
  }

  // --- crosshair / spread ---------------------------------------------------------

  showSpread(halfAngle, fov, viewportH, isKatana, isScoped) {
    if (this._c.kind !== isKatana) {
      this._c.kind = isKatana;
      this.el.cross.classList.toggle('ir-katana', !!isKatana);
    }
    const r = Math.max(6, Math.tan(halfAngle) / Math.tan(fov / 2) * (viewportH / 2));
    const rq = q(r, 0.5);
    if (this._c.spreadR !== rq) {
      this._c.spreadR = rq;
      this.el.cross.style.setProperty('--r', `${rq}px`);
    }
  }

  showScope(on) {
    if (this._c.scope === on) return;
    this._c.scope = on;
    this.el.scope.classList.toggle('ir-on', !!on);
    this.el.cross.classList.toggle('ir-hidden', !!on);
  }

  // --- grapple / stamina ------------------------------------------------------------

  setGrapple(state, stam) {
    if (this._c.grap !== state) {
      this._c.grap = state;
      this.el.grapple.dataset.state = String(state);
    }
    const on = stam < 0.995;
    if (this._c.stamOn !== on) { this._c.stamOn = on; this.el.stam.classList.toggle('ir-on', on); }
    if (!on) return;
    const s = q(Math.max(0, Math.min(1, stam)), 1 / 100);
    if (this._c.stam !== s) {
      this._c.stam = s;
      this.el.stamFill.style.transform = `scaleX(${s})`;
      this.el.stam.classList.toggle('ir-low', s < 0.25);
    }
  }

  // --- katana: focus gauge / guard ring ----------------------------------------------

  setFocus(frac, ready) {
    const on = frac >= 0;
    if (this._c.edgeOn !== on) { this._c.edgeOn = on; this.el.edge.classList.toggle('ir-on', on); }
    if (!on) return;
    const f = q(Math.max(0, Math.min(1, frac)), 1 / 100);
    if (this._c.edgeF !== f) { this._c.edgeF = f; this.el.edgeFill.style.transform = `scaleY(${f})`; }
    if (this._c.ready !== !!ready) { this._c.ready = !!ready; this.el.edge.classList.toggle('ir-ready', !!ready); }
  }

  setGuard(frac, broken) {
    const on = frac >= 0;
    if (this._c.guardOn !== on) { this._c.guardOn = on; this.el.guard.classList.toggle('ir-on', on); }
    if (!on) return;
    const f = q(Math.max(0, Math.min(1, frac)), 1 / 100);
    if (this._c.guardF !== f) { this._c.guardF = f; this.el.guard.style.setProperty('--f', f); }
    if (this._c.broken !== !!broken) { this._c.broken = !!broken; this.el.guard.classList.toggle('ir-broken', !!broken); }
  }

  // --- boss ------------------------------------------------------------------------

  showBoss(name, frac) {
    const on = frac !== null && frac !== undefined;
    if (this._c.bossOn !== on) { this._c.bossOn = on; this.el.boss.classList.toggle('ir-on', on); }
    if (!on) return;
    if (this._c.bossName !== name) { this._c.bossName = name; this.el.bossName.textContent = name; }
    const f = q(Math.max(0, Math.min(1, frac)), 1 / 200);
    if (this._c.bossFrac !== f) { this._c.bossFrac = f; this.el.bossFill.style.transform = `scaleX(${f})`; }
  }

  // --- pips --------------------------------------------------------------------------

  setPips(angles) {
    const on = angles.length > 0;
    if (this._c.pipsOn !== on) { this._c.pipsOn = on; this.el.pips.classList.toggle('ir-on', on); }
    this.el.pip.forEach((p, i) => {
      const a = angles[i];
      if (a === undefined) { p.classList.remove('ir-on'); return; }
      p.classList.add('ir-on');
      p.style.setProperty('--ang', `${a}rad`);
    });
  }

  // --- transient: hitmarkers, damage wedges, kill feed, banner, tips ------------------

  // kind: 'body' | 'crit' | 'kill'
  markHit(kind) {
    const node = el(`<i class="ir-hit ir-hit-${kind}"></i>`);
    this.el.hits.appendChild(node);
    setTimeout(() => node.remove(), HIT_LIFE * 1000);
  }

  showHurtFrom(angleRad) {
    const node = el('<i class="ir-wedge"></i>');
    node.style.setProperty('--ang', `${angleRad}rad`);
    this.el.dmg.appendChild(node);
    setTimeout(() => node.remove(), DMG_LIFE * 1000);
  }

  kill(text, points) {
    const box = this.el.feed;
    const row = el(`<div class="ir-feedrow"><span class="ir-feedtext"></span>${points ? `<span class="ir-feedpts">+${points}</span>` : ''}</div>`);
    row.querySelector('.ir-feedtext').textContent = text;
    box.appendChild(row);
    while (box.children.length > FEED_MAX) box.firstElementChild.remove();
    setTimeout(() => row.remove(), FEED_LIFE * 1000);
  }

  message(main, sub) {
    this.clearMessage();
    const node = el(`<div class="ir-msg"><div class="ir-msg-main"></div>${sub ? '<div class="ir-msg-sub"></div>' : ''}</div>`);
    node.querySelector('.ir-msg-main').textContent = main;
    if (sub) node.querySelector('.ir-msg-sub').textContent = sub;
    this.el.banner.appendChild(node);
    this._bannerNode = node;
    setTimeout(() => { if (this._bannerNode === node) this._bannerNode = null; node.remove(); }, BANNER_LIFE * 1000);
  }

  clearMessage() {
    this.el.banner.innerHTML = '';
    this._bannerNode = null;
  }

  /**
   * @param {string|Array<string|{em:string}>} parts  plain text, or segments
   *   built with EM() for the bits that should stand out — never HTML.
   * @param {number} [seconds]
   */
  tip(parts, seconds = TIP_DEFAULT) {
    this.el.tip.innerHTML = '';
    const node = el(`<div class="ir-tipline" style="--life:${seconds}s">${textParts(parts)}</div>`);
    this.el.tip.appendChild(node);
    setTimeout(() => node.remove(), seconds * 1000);
  }
}
