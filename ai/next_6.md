# Next 6: what plan 6 built, and what comes next

Plan 6 is built, with the two changes asked for before it started:

- the hit volumes are trimmed by a quarter, not a half;
- the idle arms are fixed.

Every tool has been run against the final build. One check fails, `coop`'s phone frame-time
comparison. Measured beside the last commit, it fails there too, so it is noise in a narrow check,
not this plan (below).

## Done

### The phone

- **Only INK fires.** The tap-to-fire on the look pad is gone (`ui/touch.js`), with what it kept:
  `TAP_MS`, `TAP_TRAVEL`, `lookMoved`, `lookStart`. `PULSE_MS` stays, so a tap on INK still fires.
- **PAUSE**, at the left end of the top row:
  - it is 44 px and keeps its place when WRAP is away;
  - it presses the `pause` action, as Esc and a pad's start button do;
  - the pause sheet says "tap anywhere to keep going" on a touch screen.
- **Pause when the page is hidden** (`visibilitychange` in `game.js`), on every device.
  - `pause()` lets go of the touch layer (`touch.clear()`).
  - Before, a finger down as the page went away walked the stick on after the resume: 0.31 m in
    0.6 s in the test. Now it moves 0.00 m.
- **The boss bar:**
  - upright, it moves under the top row;
  - on its side, it narrows to stop short of the row (`hud.css`);
  - `touch.mjs` now puts the bar up and checks every button against it.
- **Not in the plan: a button holds its action for a whole frame.**
  - A tap can start and end between two frames: a quick one on a slow phone, or any tap from
    Playwright's touch input, which sends both at once.
  - PAUSE is read before the touch layer updates, so such a tap was never seen.
  - Now a release that comes too soon waits until two `update()` calls have passed. This holds for
    every button.

### Apart at the start

- **The row:** `world/map_desk.js` builds `startPoints`:
  - the start, then 2 m apart across the way it looks, alternating sides, wherever the ground is
    open, then a row behind;
  - on the desk that is 7 in the front row (the ground right of +4 m isn't open) and 1 behind.
- **Whose place:** `Net.slot()` counts the members with a lower `order` than this page's own.
  `Game.startSpot()` uses it at the start of a run, at a revive, and after a fall off the edge.
- **Alone:** slot 0, the start itself, so no tool that plays alone sees a change.

### The weapons

- **New models** (`entities/weapons/models.js`): one mesh per ink and look, one per moving part,
  round parts in `WRAP`.
  - **Rifle:** ribbed handguard, curved magazine, flash hider with prongs, stock and cheek rest,
    rail, controls.
  - **Shotgun:** ribbed pump, vented heat shield, tube cap, recoil pad, and a saddle of orange
    spare shells.
  - **Sniper:** stepped barrel, ported brake, folded bipod, scope with turrets and bells, bolt with
    a ball knob.
  - **Staple gun:** a lever hinged at the front, a coil spring showing on the side, a strip of
    staples, and a bead with a notch.
  - **Katana:** the blade built face by face, with a curve, a ridge crease and a pointed tip; a
    collar; a disc guard; the hilt in a crossed-strap wrap.
- **Moving parts,** each driven by `tick(gun)` from the gun's own timers:
  - the shotgun's pump racks after each shot;
  - the sniper's bolt turns up, draws back, and returns;
  - the rifle's magazine drops out and returns on a reload;
  - the staple gun's lever snaps down;
  - the saddle shows as many shells as are in reserve, up to four.
- **Sights:** every sight is a part named `sight` on the eye line. The stills script measured each
  0.0 px from the crosshair while aiming.
- **What stayed:** every rear end is inside what `aimZ` was worked out against. The staple gun's
  comment now says 0.11, with 0.24 m to spare.
- **A friend holds the same model.** `buildProp(key)` merges the model you hold into one mesh per
  material, scales it to the figure (`ON_FIGURE` 0.73: the old prop's 0.82 m rifle) and puts its
  grip at the hand.
  - `rig.js` uses it for the friend's `look.props`.
  - `crew.js`'s `HELD` is the weapon keys, and the hand-typed `MUZZLE` table is gone: tracers
    leave from the model's own muzzle.
  - Enemies keep their red props.
- **Stills,** in the scratchpad of this session, not the repo: the five at the hip and aimed, and
  five friends, one with each.

### The grenade

- **The throw:** `GRENADE.throw.max` goes from 25 to 28 m/s. The comment now gives landing
  distances: level 11.9 m (was 10.7), 20° up 23.8 m (was 20.0), furthest 29.9 m (was 24.6). In the
  game a full level throw first landed 11.6 m out.
- **Thrown:** a green body with black fittings, two instanced meshes, tumbling and slowing at each
  bounce.
- **The blast** (`BLAST`, `Effects.blast`), in order:
  - an orange star round a black one, facing the camera;
  - a ring growing to the 7.5 m radius and thinning out;
  - seven hatched puffs that swell, rise and shrink away;
  - 18 orange sparks and 24 black chunks;
  - a splat-shaped scorch.

  All of it is pooled for four blasts, and each mesh is hidden when it has none.
- **The scorch** is stamped on the surface under the grenade (a 0.6 m ray down). The old blot was
  stamped at the grenade's middle, about 0.2 m above the floor. A blast in the air leaves none.
- **The camera's kick and hitstop** fall off to nothing at 20 m. They were the same at any
  distance.
- **The sound:** a crack, the boom, and a rumble.
- **`coop.mjs`** counts a friend's blast by `effects.blasted`: the scorch is no longer among the
  bullet blots.

### The older items

- **The last sniper:**
  - `renest` failing twice brings the sniper down (`comeDown`): out of everybody's sight, as near
    the nearest player as `TRAPPED.away` (18 m) allows, searching on foot (`e.afoot`);
  - every `stationary` check goes through `rooted(e)`;
  - once it sees you it stands and shoots.
  - **The test:** `game.mjs` stages the bot's stall from plan 3. The sniper was found 29, 65 and
    68 s into the scene; at worst about 50 s of that is walking (below).
- **The idle arms:** the spread's sign is flipped in `buildFigure()` and in `pose()`'s rest branch,
  and for the free arm in a wind-up. Figures now hold their arms out, as `armSpread`'s comment
  always said.
- **`figures.mjs`:**
  - the lineup faces the camera (turn 0, not π);
  - figures stand at least 2.4 m apart: arms out, at 1.6 m their hands joined and six were found
    as one;
  - it prints the fill percentiles the band is made from.
- **The band, re-derived** (`FIGURE_TOL`, `compare.mjs`):

  | | p10 | median | p90 | band |
  |---|---|---|---|---|
  | back to the camera, arms crossed (before) | 0.49 | 0.63 | 0.79 | 0.45–0.85 |
  | facing, arms crossed | 0.54 | 0.66 | 0.81 | still in the old band |
  | facing, arms out (now) | 0.33 | 0.39 | 0.43 | 0.28–0.50 |

  Turning the lineup alone kept it in the old band. Fill is ink over the figure's box, and arms
  out widen the box. Every figure is still found at every distance, and at 40 m each is a solid
  red person with its arms out (stills compared by eye). The band is used only by `figures.mjs`
  and `compare.mjs figure`, not by the shots gate.
- **A friend is heard:**
  - steps each time their drawn legs cross, on the ground, over 1.5 m/s, heard to 20 m;
  - the jet's hiss to 40 m;
  - only from the 3 and 2 nearest (`HEARD_MOVING`);
  - `audio.step` and `audio.jet` take a `near`.
- **Hit volumes, a quarter fewer beside the drawing:**
  - limb capsules are 0.94 of the drawn corner radius (`HIT_LIMB`); PLAY's aim margin of 1.08
    brings them back out past the corners;
  - forearms and shins stop 0.4 of a radius short of the hand or foot (`HIT_END`).
  - **The baseline moved first:** with the arms out, 2984 shots registered beside the drawing,
    against 2358 with the arms crossed.
  - **The trim:** 2984 → 2238, exactly a quarter. A later run gave 2203, as the walking pose varies
    a little between runs.
  - Shots on the drawing that don't register: still 0.0%.
  - **Tried and dropped:** radius 0.93 gave 27.7% fewer, and 0.95 gave 22.6%.
  - `collide.mjs` now prints where they land. About 70% are within 3.3 cm of the triangles, which
    is on the drawn outline. 13 are further than 13 cm (91 before).

## Changed from the plan

- **The press latch on the touch buttons** (above): the plan had no need for it until a real tap
  was sent.
- **The page going out of sight is faked in `touch.mjs`:** Playwright emulates focus, so another
  tab brought to the front hides nothing. The plan allowed for this.
- **The sniper comes down near the player, not near its nest.**
  - Near its nest, it walked over a minute.
  - Near the player, it is out of sight behind a wall and can still take 50 s, by way of one
    `trapped()` redraw.
  - On foot it stands and shoots once it sees you. With a nest's pace it backed away to 70 m, got
    stuck, and was redrawn away again.
  - The test starts with one failed nest search already counted, as the scene already starts 34 s
    into the no-contact wait, and allows 120 s.
- **The blast's ring is a band standing round the blast** (pen, `LINE`), not a flat ring. Flat on
  the floor it is edge-on from eye height.
- **The flash sits 0.36 m above the grenade:** centred on it, half the star was under the floor.
- **The katana's blade is built by hand.** `ExtrudeGeometry` pulled in three's triangulation:
  227.7 KB gzip against 222.7.
- **The rifle's rail slots stop at the sight:** nearer the eye they loomed like steps.
- **The staple gun's rear notch posts are taller,** so its bead sits in the gap.
- **`ON_FIGURE` is 0.73, not 0.76:** the new rifle is 1.93 model units long.
- **`coop.mjs`'s frame-time case measures from the start spot:** the fifth player now starts 4 m
  to the side, and the alone measurement stood on the start.

## Results, final build

| tool | result |
|---|---|
| `npm run build`, `npm run distcheck` | pass; 223.0 KB gzip (gzip -9), +4.4 KB on the last commit |
| `npm run game` | 87/87 (2 new: the full throw, the last sniper) |
| `npm run touch` | 55/55 (5 new: the look pad, PAUSE, the sheet, the page hidden, no finger held) |
| `npm run render` | 26/26: the new rifle is whole against a wall and outlined |
| `npm run feel` | 29/29 |
| `npm run reach`, `npm run toys` | pass |
| `npm run collide` | pass: guns point where their figures aim (the friends' new props included), every hit volume inside its bound, no invisible walls |
| `npm run figures` | pass, in the re-derived band, all 30 found |
| `npm run coop` | 38/39, the failure below |
| `npm run perf` | below |

- **`game`:** an earlier full run was 86/87. The throw case had failed on its own set-up: its
  flatness test compared the floor to the spawn point's height. The final run is 87/87:
  - the throw lands 11.6 m out;
  - the sniper was found 29 s into the scene. Run alone, it took 65 and 68 s: how it walks varies.
- **`coop`'s phone frames:** with four friends firing, the check wants a phone's median at least
  85% of alone. Two full runs failed: 36 against 43, and 34 against 46.
  - The last commit's own `coop.mjs`, on its build, passed by a hair: 37 against 44, which is
    85.0%.
  - Cut down to the four players and this one case, alternated three times each:
    - this build: 41, 43, 43 fps with friends, two passes and one fail on p99;
    - the last commit: 37, 37, 37, one pass and two fails.
  - Four friends with the new rifles, measured alone on a 6× phone: 53–56 fps on both builds.
  - So the new props are not the cost. The check sits on its threshold for both builds on this
    machine.
- **`perf`,** three runs each, alternating:

  | | this build | last commit |
  |---|---|---|
  | time to interaction | 0.92, 0.92, 0.96 s | 0.94, 0.90, 0.86 s |
  | transfer | 248 KB | 244 KB |
  | desktop p99 (max 33) | 33.2, 36.4, 33.0 ms | 35.7, 35.1, 33.4 ms |
  | phone fps | 49, 46, 42 | 50, 35, 51 |
  | phone p99 (max 50) | 42.5, 42.8, 43.2 ms | 45.8, 45.4, 45.8 ms |

  The desktop p99 is on its limit for both, as `ai/summary.md` already records for this machine.
- **Not run:** a bot run. The sniper case it used to stall in is now a `game.mjs` case.

## After a first look: the katana

A friend's slash looked strange, and their guard did not show at all. Both now move as your own
katana does.

- **One set of moves** (`KATANA_MOVES` in `weapons/models.js`):
  - **rest:** low on the right;
  - **slash:** raised on the right, then cut diagonally down to the left;
  - **guard:** the blade held level across the front of the body, edge out.

  These say where the blade points. Your hands are placed by `KATANA_HANDS` (`weapons/index.js`).
  A friend's are placed by `BLADE_HANDS` (`rig.js`), where a two-bone reach puts both hands on the
  hilt.
- **Your own slash** used to roll the blade about its length, low on the right, and every other
  slash rolled the other way. **A friend's** was a cutter's chop, from behind the head straight
  down.
- **The slash turns the blade nearly square to the way you face.** Tried first: a slash through
  straight ahead, which is what a sword does. From your own eye the blade then points down the line
  of sight, and only the hilt is seen going by.
- **The guard goes out in presence as `g`,** held up at least 300 ms, so that a parry (a tap of
  aim) is not lost between two reports.
- **The dash-slash is drawn as a slash in your hands.** A friend already saw one.
- **New checks:**
  - `game.mjs`: the tip crosses your view from top right to bottom left, and the guard lies level
    below the crosshair;
  - `coop.mjs`: the same on a friend's figure, plus a 60 ms tap of aim is seen.
- **Test windows:** `game.mjs` and `touch.mjs` now launch Chrome with
  `--disable-backgrounding-occluded-windows`, as `coop.mjs` does. Since the pause on a hidden page,
  a test window covered by another counted as hidden and paused the run. That cost two `game.mjs`
  runs: once 87/89, once 86/89 with the game left paused.
- **Results:**
  - `game` 89/89;
  - `coop` 41/41, its phone frame-time check passing too (35 against 35 fps);
  - `touch` 55/55;
  - `collide` clean (0.0% missed; 2213 shots register beside a figure, within the pose variation
    above).

## What comes next

1. **A look by hand**, on a desktop and a real phone:
   - the new models in the hand, and on a friend at 10–20 m, where their guns are thin lines;
   - the blast from close up and across the desk;
   - PAUSE where the thumb reaches;
   - whether the look pad without its tap feels right.
2. **The last sniper's walk.** From the worst spot it can take 50 s to reach you, through a
   `trapped()` redraw. Choosing a place to come down that has a way through to the player (the bot
   has a walk grid, `navgrid.mjs`; the game has none) would cut it.
3. **`coop`'s frame-time check:** measure each side twice, alternating, or compare against the
   last commit rather than alone. As it stands it passes and fails on noise.
4. **The enemies' guns:** the rifle, shotgun and sniper figures could hold the new models in red.
   That would mean re-measuring `figures.mjs` and counting draw calls on 14 figures.
5. **A grenade in the hand while it cooks:** not asked for, and still not drawn.
6. **Still open from before:** fill rate at 1080p on an older integrated GPU; co-op on a real
   phone over the LAN; a friend's shot drawn a fixed 120 ms after it arrives.
