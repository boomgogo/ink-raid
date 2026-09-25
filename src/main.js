import * as THREE from 'three';
import { Pipeline } from './render/pipeline.js';
import { buildDesk } from './world/map_desk.js';
import { buildCalib, CALIB_SHOTS } from './world/map_calib.js';
import { buildSky } from './world/sky.js';
import { Input } from './core/input.js';
import { Player } from './entities/player.js';
import { TYPES } from './entities/enemies/types.js';
import { Game } from './game.js';
import { raycast } from './core/physics.js';
import { difficulty, setDifficulty } from './core/difficulty.js';

// The ink pipeline, THE DESK, and a player you can move around it.
// Weapons and enemies hang off `ctx` next.

const canvas = document.getElementById('c');
const ink = new Pipeline(canvas);
const { scene, camera } = ink;

const params = new URLSearchParams(location.search);
const useCalib = params.get('scene') === 'calib';
const level = useCalib ? buildCalib(scene) : buildDesk(scene);
const sky = buildSky(scene);

const input = new Input(canvas, {
  sens: Number(localStorage.getItem('ink_sens')) || 100,
  invert: localStorage.getItem('ink_invert') === '1',
});

const ctx = { scene, camera, level, input, renderer: ink };
const player = new Player(ctx);
ctx.player = player;

// ?scene=calib and pinned camera poses are for the capture tools; they skip the
// game entirely so a shot is never taken mid-wave.
const headless = useCalib || params.has('shot') || params.has('cam');
const game = headless ? null : new Game(ctx);

// ?debug=input: which device holds the trigger, and the raw events behind it.
// The log starts now so the overlay has the events from before it loaded.
if (params.get('debug') === 'input') {
  input.log = [];
  import('./ui/inputDebug.js').then((m) => m.mountInputDebug(input, game));
}

// --- camera poses, for the shot harness -----------------------------------
// Derived from the level's own open ground rather than typed in: hand-picked
// coordinates go stale the moment the map moves, and a camera that ends up
// inside a book stack wastes a whole round of comparison before anyone notices.
//
// An establishing shot also has to be able to SEE the level. The ring poses used
// to be "stand on a spawn point, look at the middle", and half of them came back
// with the ruler bridge or the pencil slashing corner to corner across an
// otherwise empty frame — the level reduced to a thin band with a giant blank
// diagonal over it. Camera poses are still derived rather than typed (hand-picked
// coordinates go stale the moment the map moves), but now the derivation checks
// its own work: cast the sightline, and if something is sitting in the first
// stretch of it, raise the eye and try again before giving up and turning the
// camera a few degrees off centre.
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

function clearPose(lv, from, target, minClear = 22) {
  // Candidate eye heights, then small yaw offsets. Height first: most of the
  // blockers on THE DESK are low things you can look over (the pencil, the
  // near book edge), and raising the camera keeps the composition centred.
  for (const h of [1.7, 3.2, 5.0, 7.5]) {
    for (const yawOff of [0, 0.22, -0.22, 0.45, -0.45]) {
      const eye = [from.x, from.y + h, from.z];
      const c = Math.cos(yawOff), s = Math.sin(yawOff);
      const dx = target[0] - eye[0], dz = target[2] - eye[2];
      const aim = [eye[0] + dx * c - dz * s, target[1], eye[2] + dx * s + dz * c];
      _o.set(eye[0], eye[1], eye[2]);
      _d.set(aim[0] - eye[0], aim[1] - eye[1], aim[2] - eye[2]).normalize();
      const hit = raycast(lv, _o, _d, minClear);
      if (!hit) return [eye, aim];
    }
  }
  return [[from.x, from.y + 5.0, from.z], target];
}

function deskShots(lv) {
  const c = [0, 6, 0];
  const eye = (p, h = 1.7) => [p.x, p.y + h, p.z];
  const out = {
    spawn: [eye(lv.startPoint), c],
    overview: [[0, 78, 0.1], [0, 0, 0]],
    far: [[0, 26, 46], [0, 4, -6]],
    top: [[0, 34, 30], [0, 4, -8]],
  };
  lv.spawns.forEach((p, i) => { out[`ring${i}`] = clearPose(lv, p, c); });
  return out;
}

const SHOTS = { ...deskShots(level), ...CALIB_SHOTS };

const yaw = { v: Math.PI };
const pitch = { v: 0 };

function pose(x, y, z, yw, pt) {
  camera.position.set(x, y, z);
  yaw.v = yw; pitch.v = pt;
  camera.rotation.set(pt, yw, 0);
}

// With rotation order YXZ, forward is (-sin y cos p, sin p, -cos y cos p).
const _f = new THREE.Vector3();
function poseLook([fx, fy, fz], [tx, ty, tz]) {
  _f.set(tx - fx, ty - fy, tz - fz).normalize();
  pose(fx, fy, fz, Math.atan2(-_f.x, -_f.z), Math.asin(THREE.MathUtils.clamp(_f.y, -1, 1)));
}

const applyShot = (n) => SHOTS[n] && poseLook(SHOTS[n][0], SHOTS[n][1]);

// a pinned pose freezes the camera for capture; otherwise the player owns it
let frozen = false;
if (params.has('shot') && SHOTS[params.get('shot')]) { applyShot(params.get('shot')); frozen = true; }
else if (params.has('cam')) { pose(...params.get('cam').split(',').map(Number)); frozen = true; }

if (params.get('graph') === '1') ink.setPaper('graph');
// ?view=edges | tone | pattern | ink | depth: one layer of the page on its own
if (params.has('view')) ink.setView(params.get('view'));

// --- loop -----------------------------------------------------------------
const clock = new THREE.Clock();
let t = 0;
let frames = 0;
let fpsT = 0;
let fps = 0;
let worstFrame = 0;

function frame() {
  requestAnimationFrame(frame);
  const raw = clock.getDelta();
  const dt = Math.min(0.05, raw);
  t += dt;

  // The pad has to be polled before anything reads the input: the Gamepad API
  // raises no events for sticks or triggers, only for connect and disconnect.
  input._pollPad(dt);

  let fx = {};
  if (game) {
    game.pinned = frozen;
    fx = game.update(dt);
  } else if (!frozen) {
    player.update(dt, input);
  }
  input.endFrame();

  sky.update(t);
  ink.render(t, fx);

  frames++;
  fpsT += dt;
  if (raw > worstFrame) worstFrame = raw;
  if (fpsT > 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
}
frame();

requestAnimationFrame(() => requestAnimationFrame(() => {
  document.getElementById('boot')?.classList.add('gone');
  window.__inkReady = true;
}));

window.__ink = {
  renderer: ink,
  camera,
  level,
  player,
  input,
  game,
  shots: Object.keys(SHOTS),
  pose,
  poseLook,
  // a pinned pose is the same frame every time: the toys go back to their start
  shot: (n) => { frozen = true; level.toys?.reset(level); game?.planes?.reset(); applyShot(n); },
  play: () => { frozen = false; },
  stats: () => ({ fps, drawCalls: ink.stats.calls, tris: ink.stats.tris, worstFrame: +(worstFrame * 1000).toFixed(1) }),
  resetWorst: () => { worstFrame = 0; },

  // Movement telemetry. Feel is judged by hand, but the things that make it feel
  // wrong — a sprint that does not reach its speed, a jump that misses its apex,
  // a slide that never ends — are all numbers, and numbers can be regression
  // tested.
  probe: () => ({
    pos: player.body.pos.toArray().map((n) => +n.toFixed(2)),
    vel: player.body.vel.toArray().map((n) => +n.toFixed(2)),
    speed: +Math.hypot(player.body.vel.x, player.body.vel.z).toFixed(2),
    onGround: player.body.onGround,
    sliding: player.sliding,
    crouching: player.crouching,
    sprinting: player.sprinting,
    hopsLeft: player.airHops,
    grapple: { attached: player.grapple.attached, stam: +player.grapple.stam.toFixed(2), target: player.grapple.targetValid },
    hp: Math.round(player.hp),
    fov: +camera.fov.toFixed(1),
    eyeY: +player.eye.y.toFixed(2),
  }),

  // Drive the player without a real keyboard, so movement can be exercised
  // headlessly. Actions are the names from BINDINGS, not key codes.
  sim: (actions, ms) => {
    for (const k of actions) input.state[k] = true;
    return new Promise((r) => setTimeout(() => {
      for (const k of actions) input.state[k] = false;
      r(window.__ink.probe());
    }, ms));
  },
  tap: (action) => { input.state[action] = true; setTimeout(() => { input.state[action] = false; }, 40); },
  teleport: (x, y, z) => { player.body.pos.set(x, y, z); player.body.vel.set(0, 0, 0); },
  face: (yw, pt = 0) => { player.yaw = yw; player.pitch = pt; },
  raycastLevel: (o, d, max) => raycast(level, o, d, max),
  // the roster, so tools/collide.mjs can audit one figure of every type without
  // keeping its own copy of the list
  enemyTypes: Object.keys(TYPES),
  // the live dials, and a way to flip them without a run, for tools/game.mjs
  difficulty,
  setDifficulty,
};
