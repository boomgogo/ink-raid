// The three modal panels: title, pause, death. One sheet of paper laid over
// the desk, translucent enough that the menu's camera flight still shows
// through it. `Game` hands this data and callbacks; it never reaches into the
// DOM this module owns, and this module never reaches back into Game.
import { quillButton } from './quill.js';

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
// look speed as a multiplier of the default: 100 reads 1.00×
const lookSpeed = (v) => `${(v / 100).toFixed(2)}×`;

export class Screens {
  /**
   * @param {HTMLElement} root
   * @param {() => void} [onShow]  called the instant any screen opens, so a
   *   banner playing behind it ("SECOND DRAFT") never gets caught drawn
   *   straight through the screen's own title.
   */
  constructor(root, onShow) {
    this.node = el('<div id="irScreen" class="ir-screen"></div>');
    this._onShow = onShow;
    root.appendChild(this.node);
    this.node.addEventListener('click', () => this._onBackdrop?.());
  }

  get visible() { return this.node.classList.contains('ir-on'); }

  hide() {
    this.node.classList.remove('ir-on');
    this.node.innerHTML = '';
    this._onBackdrop = null;
  }

  _show(panelHtml, onBackdrop) {
    this._onShow?.();
    this._onBackdrop = onBackdrop;
    this.node.classList.add('ir-on');
    this.node.innerHTML = `<div class="ir-panel">${panelHtml}</div>`;
    // stop every control from bubbling its click up to the backdrop handler
    this.node.querySelectorAll('button, input, label, details, summary').forEach((n) => {
      n.addEventListener('click', (e) => e.stopPropagation());
    });
    return this.node.querySelector('.ir-panel');
  }

  /**
   * @param {object} o
   * @param {object} o.diffs       { key: { label, blurb, best } }, in display order
   * @param {string} o.selected    the primary/filled difficulty key
   * @param {number} o.sens        20-270
   * @param {boolean} o.invert
   * @param {boolean} o.music
   * @param {number} o.volume      0-100
   * @param {boolean} o.howtoOpen
   * @param {boolean} o.touch      true on a touch-primary device
   * @param {(key:string)=>void} o.onStart
   * @param {(key:'volume'|'music'|'sens'|'invert', value:any)=>void} o.onSetting
   * @param {(open:boolean)=>void} o.onHowto
   * @param {()=>void} o.onBackdrop
   */
  menu(o) {
    const starts = Object.entries(o.diffs).map(([key, d]) => {
      const primary = key === o.selected;
      const best = d.best ? ` &middot; best ${d.best}` : '';
      return `<button class="ir-start${primary ? ' ir-primary' : ''}" data-difficulty="${key}" data-primary="${primary}">
        ${quillButton(`start-${key}`, { filled: primary })}
        <span class="ir-startname">${esc(d.label)}</span>
        <span class="ir-startblurb">${esc(d.blurb)}${best}</span>
      </button>`;
    }).join('');

    const howtoBody = o.touch ? `
      <p><b>left thumb</b> — the floating stick that appears where you press: push it far to sprint.</p>
      <p><b>right side</b> — drag to look; a quick tap there fires one shot.</p>
      <p><b>INK</b> holds the trigger and keeps aiming while you drag on it.</p>
      <p><b>UP</b> jump (again in the air) &middot; <b>DUCK</b> crouch, or slide while moving fast</p>
      <p><b>LINE</b> grapple: tap to fire, hold to reel, jump to launch</p>
      <p><b>LOAD</b> reload &middot; <b>BLAST</b> grenade &middot; <b>NEXT</b> swap weapon</p>
      <p><b>WRAP</b> appears once you are carrying a bandage</p>
      <p>shoot down a paper plane for a bandage, or a staple gun</p>
    ` : `
      <p><b>WASD</b> move, mouse to look &middot; <b>Shift</b> sprint &middot; <b>Space</b> jump, again in the air</p>
      <p><b>C</b> crouch — quieter, and you won't walk off an edge; hold it while sprinting to slide, in the air to dash</p>
      <p><b>Space</b> into a wall is a wall jump &middot; walk into a ladder to climb it, <b>C</b> to slide back down</p>
      <p><b>Q</b> grapple — tap to fire, hold to reel in, jump to launch off it</p>
      <p>left click fires, right click aims &middot; <b>1-4</b> rifle, shotgun, sniper, katana</p>
      <p>shoot down a paper plane: a bandage, or a staple gun on <b>5</b></p>
      <p><b>R</b> reload &middot; <b>G</b> throws a grenade, held a moment longer for more distance</p>
      <p><b>H</b> wraps a bandage — kills leave them, and every tower top keeps one</p>
      <p><b>F</b> a quick slash &middot; <b>M</b> toggles the music</p>
      <p>with the katana, right click raises a guard — time its rise to a hit and it parries; right click then a left click while EDGE is lit spends it on a dash-slash</p>
      <p><b>Esc</b> pauses</p>
      <p class="ir-tpnote">on a touchpad, turn off tap-to-click and press down to fire</p>
    `;

    const panel = this._show(`
      <h1 class="ir-title">INK RAID</h1>
      <p class="ir-tagline">the ink has climbed off the page</p>
      <div class="ir-starts">${starts}</div>
      <details class="ir-howto" id="irHowto" ${o.howtoOpen ? 'open' : ''}>
        <summary>how to play</summary>
        <div class="ir-howtobody">${howtoBody}</div>
      </details>
      <div class="ir-settings" id="irSettings">
        <label>volume
          <input type="range" id="irVol" min="0" max="100" step="5" value="${o.volume}">
          <b id="irVolV">${o.volume}</b>
        </label>
        <label><input type="checkbox" id="irMusic" ${o.music ? 'checked' : ''}> music</label>
        <label>look speed
          <input type="range" id="irSens" min="20" max="270" step="6" value="${o.sens}">
          <b id="irSensV">${lookSpeed(o.sens)}</b>
        </label>
        <label><input type="checkbox" id="irInvert" ${o.invert ? 'checked' : ''}> invert vertical look</label>
      </div>
      <p class="ir-go">choose one and start drawing</p>
    `, o.onBackdrop);

    panel.querySelectorAll('[data-difficulty]').forEach((b) => {
      b.addEventListener('click', () => o.onStart(b.dataset.difficulty));
    });
    panel.querySelector('#irSettings').addEventListener('click', (e) => e.stopPropagation());
    const howto = panel.querySelector('#irHowto');
    howto.addEventListener('click', (e) => e.stopPropagation());
    howto.addEventListener('toggle', () => o.onHowto?.(howto.open));
    panel.querySelector('#irVol').addEventListener('input', (e) => {
      const v = Number(e.target.value);
      panel.querySelector('#irVolV').textContent = v;
      o.onSetting('volume', v);
    });
    panel.querySelector('#irMusic').addEventListener('change', (e) => o.onSetting('music', e.target.checked));
    panel.querySelector('#irSens').addEventListener('input', (e) => {
      const v = Number(e.target.value);
      panel.querySelector('#irSensV').textContent = lookSpeed(v);
      o.onSetting('sens', v);
    });
    panel.querySelector('#irInvert').addEventListener('change', (e) => o.onSetting('invert', e.target.checked));
  }

  /** @param {{diffLabel:string, score:number, wave:number, onMainMenu:Function, onBackdrop:Function}} o */
  pause(o) {
    const panel = this._show(`
      <h1 class="ir-title">PAUSED</h1>
      <p class="ir-stats">${esc(o.diffLabel)} &middot; score <b>${o.score}</b> &middot; wave <b>${o.wave}</b></p>
      <button class="ir-leave" id="btnMenu">${quillButton('pause-menu')}<span>MAIN MENU</span></button>
      <p class="ir-go">click anywhere to keep going</p>
    `, o.onBackdrop);
    panel.querySelector('#btnMenu').addEventListener('click', () => o.onMainMenu());
  }

  /**
   * @param {{diffLabel:string, waves:number, kills:number, score:number, best:number,
   *          touch:boolean, onMainMenu:Function, onBackdrop:Function}} o
   */
  death(o) {
    const plural = o.waves === 1 ? '' : 's';
    const again = o.touch ? 'tap to start a fresh page' : 'click, or press Space, to start a fresh page';
    const panel = this._show(`
      <h1 class="ir-title">DRAWN OVER</h1>
      <p class="ir-stats">you survived <b>${o.waves}</b> wave${plural} &middot; <b>${o.kills}</b> kills &middot; score <b>${o.score}</b></p>
      <p class="ir-best">${esc(o.diffLabel)} &middot; best ${o.best}</p>
      <button class="ir-leave" id="btnMenu">${quillButton('death-menu')}<span>MAIN MENU</span></button>
      <p class="ir-go">${again}</p>
    `, o.onBackdrop);
    panel.querySelector('#btnMenu').addEventListener('click', () => o.onMainMenu());
  }
}
