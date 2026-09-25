// ?debug=input — what the game thinks the input devices are doing.
//
// Written for "the gun fires on its own" and every report like it. Such a
// report is always one of three things — a device the player did not know was
// pressing (a touchpad's tap-to-click, a drifting pad trigger), a control that
// means more than it says (the touch look-pad used to fire after 260 ms), or a
// real bug — and all three look the same from the outside. This shows which
// device holds the trigger and the raw events that put it there, so the answer
// is read off the screen instead of guessed.
//
// Loaded on demand from main.js, so it costs nothing without the flag.

export function mountInputDebug(input, game) {
  if (!input.log) input.log = [];
  const el = document.createElement('div');
  el.id = 'inputDebug';
  el.style.cssText = [
    'position:fixed', 'left:8px', 'top:120px', 'z-index:9', 'pointer-events:none',
    'font:12px/1.35 ui-monospace,Menlo,Consolas,monospace', 'color:#22222b',
    'background:rgba(250,248,238,.9)', 'border:1.5px solid #22222b', 'border-radius:6px',
    'padding:6px 8px', 'white-space:pre', 'max-width:60vw', 'overflow:hidden',
  ].join(';');
  document.body.appendChild(el);

  const dots = (by) => Object.entries(by).map(([k, v]) => `${k} ${v ? '#' : '.'}`).join('  ');
  const render = () => {
    const now = performance.now();
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected).length : 0;
    el.textContent = [
      `fire ${input.fire ? 'ON ' : 'off'}   ${dots(input.fireBy)}`,
      `aim  ${input.aim ? 'ON ' : 'off'}   ${dots(input.aimBy)}`,
      `pointer lock ${input.locked ? 'on' : 'off'} · touch layer ${game?.touch?.enabled ? 'on' : 'off'}`
        + ` · touchpad suspected ${input.touchpadSuspected ? 'yes' : 'no'}`,
      `primary pointer ${matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine'}`
        + ` · touch points ${navigator.maxTouchPoints} · gamepads ${pads}`,
      '',
      ...input.log.slice(-14).reverse()
        .map((e) => `${((e.t - now) / 1000).toFixed(1).padStart(6)} s  ${e.text}`),
    ].join('\n');
  };
  render();
  setInterval(render, 100);
  return el;
}
