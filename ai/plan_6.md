# Plan 6: new weapons, the same in a friend's hands, apart at the start, a pause on the phone

Answers `prompt_6.md`. Where each item of the prompt is answered:

| prompt | here |
|---|---|
| Multiplayer 1: a friend's weapons look different from mine | §1, with the new models |
| Multiplayer 2: everybody starts on one spot | §2 |
| Phone 2: no way to pause | §3 |
| Phone 3: a touch anywhere on the right shoots | §4 |
| Feature 1: new, fancier models for every weapon | §1 |
| Feature 2: a longer throw, a better explosion | §5 |
| Older items | §6. All four are still there (checked below). The idle arms are added |

## 1. The weapons: new models, and the same ones in a friend's hands

### Why a friend's gun looks different

They are different models. Your gun is built in `entities/weapons/models.js`. A friend's figure
carries a second set, built by `addProp()` in `entities/enemies/rig.js`, the props the enemies
hold:

- **Drawn in the friend's own ink.** The props use the figure's materials, so they are blue or
  green all over. Yours is pen and heavy black, with a red dot.
- **Much simpler.** The rifle is one box for the barrel and one for the stock. The sniper is the
  same two boxes with a longer barrel.
- **Two are other kinds of gun:**
  - the shotgun is a double barrel (two boxes side by side), where yours is a pump;
  - the staple gun is the enemy stapler's `staples` prop (`HELD.stapler = 'staples'` in
    `net/crew.js`): two flat boxes, a desk stapler held out.

The fix is one set of models, built once in `models.js`, both for your hands and for a friend's.

### The new models

**What doesn't change:**

- **How they're made.** Boxes, cylinders and a few turned shapes, built in code with no textures,
  drawn by the ink pass like everything else. No glTF files: no download to add to the load, and
  nothing that ignores the page's rules (inks, looks, outlines). The code grows by a few KB.
- **The sight line.** `sight` stays the height the eye looks along when aiming (`Gun` drops the
  model by exactly that).
  - Nothing in front of a sight rises into its window. The rifle's carry handle was taken off for
    this once (the comment in `buildRifle`).
  - The rifle's reflex sight stays an open window. The sniper's model still hides when scoped.
- **The rearmost point.** The `aimZ` derivations in `GUNS` count on the stock ending 0.43
  (rifle), 0.47 (shotgun) and 0.54 (sniper) model units behind the grip. A new stock stays inside
  that, or `aimZ` is worked out again in its comment.
- **The anchors.** `muzzle` and `eject` follow the new geometry. Every builder also returns a new
  `grip`: where the right hand holds, which is the pistol grip, or the middle of the katana's hilt.
- **What it costs.**
  - One mesh per ink and look, plus one per moving part: 6 at most per weapon, and only the
    weapon in hand is drawn.
  - Under 2,000 triangles each. The rifle is about 170 now.
  - The gun covers the same part of the screen as before, so fill rate doesn't change.
- **The looks.**
  - Round parts (barrels, the scope, the magazine tube, the katana's hilt) are drawn in `WRAP`,
    with an `aAxis` along their length, so they are ringed like the desk's pencils.
  - Bodies stay pen in `LINE`, and fittings heavy black.
  - At most one accent ink per weapon.

**Each weapon, more like the real thing:**

| weapon | what's added |
|---|---|
| rifle | A chamfered receiver with an ejection port and charging handle. A trigger guard and trigger. A curved magazine (two angled boxes). A handguard with raised bands. A flash hider with prongs. A stock with a cheek rest and a black butt pad. The reflex sight as now, its red dot the accent |
| shotgun | A ribbed pump that slides. The magazine tube's cap. A heat shield over the barrel. A side saddle of orange shells, the accent: it shows as many shells as are in the tube, up to four. The bead on its rib as now. A recoil pad |
| sniper | A fluted barrel and a ported muzzle brake. A bipod folded under the fore-end. The scope with its two turrets and a wider objective bell. A bolt handle with a ball knob, which works. A cheek riser and a box magazine |
| staple gun | The striker lever on top, which presses on each shot. A spring under it, in `WRAP`. The staple strip showing in a slot along the magazine. A metal nose plate. The orange rubber grip as now |
| katana | A curved blade, as five boxes bent along it, with the temper line (hamon) drawn along it in pen. A collar (habaki). A disc guard (tsuba). The wrapped hilt with its diamond bands, and an end cap |
| grenade | The thrown one is a plain black sphere now. It gets a body with two grooves, a cap, a lever and a pin ring, in two instanced meshes (body and fittings), and it tumbles as it flies |

**The moving parts work.** `buildShotgun` and `buildSniper` already return `pump` and `bolt`, but
nothing moves them. Each built model gets a `tick(gun)`, driven by the timers the gun already
keeps (`cooldown`, `reloading`), with no new state:

- the shotgun's pump goes back and forward in the first half of its 0.85 s after each shot;
- the sniper's bolt goes up, back, forward and down across its 1.0 s;
- the rifle's magazine drops out and comes back across its 1.5 s reload;
- the staple gun's lever goes down and up on each shot.

### A friend holds the same gun

- **`buildProp(key)` in `models.js`:**
  - builds the very model you hold;
  - merges its parts into one mesh per ink and look, with the moving parts at rest;
  - scales it by one factor times the weapon's own view scale (0.58 for the guns, 0.7 for the
    katana), so the five keep the sizes they have relative to each other in your hands. The factor
    is chosen so the rifle is as long as the old prop (0.82 m), against the figure's 1.7 m: about
    0.76;
  - moves it so its `grip` is at the hand;
  - returns `{ root, muzzle }`, with the muzzle in the hand's frame.
- **It is drawn in your gun's inks** (pen, black, the red dot, the orange grip), not in the
  friend's blue or green. The figure keeps its own ink, so you can still tell who is who.
- **`rig.js`:** the `look.props` branch, which only friends use, builds each prop with
  `buildProp`. The enemies keep `addProp`, in red: see the choices at the end.
- **`net/crew.js`:**
  - `HELD` becomes the weapon keys themselves, so the staple gun is no longer the enemies'
    `staples`;
  - the `MUZZLE` table goes. A friend's tracer leaves from their prop's own `muzzle`, so it can't
    drift from the model.
- **Draw calls:** a friend's figure shows one prop. The rifle is 4 meshes (pen, black, the
  ringed barrel, the dot) where the old prop was 2, so five friends add 10 calls at most.

## 2. Apart at the start

### Now

Every page puts its own player on `level.startPoint` (`Player.respawn()`): at the start of a run,
at each wave when a player who is down comes back (`Game.revive()`), and after a fall off the
edge (`onVoidDrop`). Every player in a room stands in the same place.

### What changes

- **A row of start points.** `world/map_desk.js` builds `startPoints` next to `startPoint`:
  - the start itself first, then points 2 m apart across the way the start faces, alternating
    sides (+2, −2, +4, −4 m and so on), 8 in all;
  - each kept only if `isOpen` there, with the same headroom test as the start. If too few are
    open, a second row 2 m behind;
  - it is built once from the map, so every page has the same row;
  - `build.js` `finish()` hands it on with the rest. `map_calib.js` gets a row of one.
  - **Why 2 m:** a friend's figure with its arms out spans about 1.3 m, so 2 m leaves a clear
    0.7 m between two of them. They are still plainly a group, all facing up the arena.
- **Which point is whose.** `Net.slot()` counts the members whose `order` is lower than this
  page's own. p3p2's `member.order` is the order of joining, the same on every page, so two
  pages that see the same members never pick the same point. Alone, it is 0, the start itself:
  nothing changes for a single player, nor for any tool that plays alone.
- **`Player.respawn(at)`** takes the point. `Game` asks for it in `beginRun`, `revive` and
  `onVoidDrop` (`level.startPoints[slot % length]`).
- **A case it doesn't cover:** two players who join at the same moment might each see the other
  a moment late, and share a point once. That is how it is now, so it is no worse.

## 3. A pause on the phone

### The button

- **PAUSE**, a fourth small button at the left end of the top row, beside LOAD, NEXT and WRAP
  (`ON_ROW` in `ui/touch.js`, index 3). It is the same 44 px, so `touch.mjs`'s size, overlap and
  readout checks cover it.
  - It keeps its place when WRAP is hidden, so the thumb learns where it is.
- **It presses the `pause` action,** the one Esc and the pad's start button press
  (`data-a="pause"`). `Game.update()` already pauses on it, so the button takes the same path as
  the keyboard. Nothing new is needed in `game.js` for it.
- **The tap that pauses doesn't also resume.** The button's `touchstart` already calls
  `preventDefault`, so the browser makes no click from it for the pause sheet to take as "tap
  anywhere to keep going". `touch.mjs` checks this.
- **The pause sheet says "tap anywhere to keep going" on a touch screen,** as the death screen
  already words it (`o.touch`).

### Pause on app switch

- **`visibilitychange` in `game.js`:** when the page is hidden in a run (playing or down), it
  pauses. Coming back to the game lands on the pause screen, not in the fight.
  - It applies to the desktop too. There, losing the pointer lock already pauses (alt-tab, Esc),
    but not for a pad player, who has no lock.
  - With friends, the desk goes on while you're away, as it does for any pause.
- **`pause()` lets go of the touch layer (`touch.clear()`).** A finger that was down when the page
  went away may never send its `touchend`. Without the clear, the stick would walk on, and INK
  keep firing, once the game was resumed.

### The boss bar, found on the way

On a phone held upright the top row already sits on the boss bar. The bar is centred and
`min(46vw, 420px)` wide: on a 360 px phone it runs from 97 to 263 px, and WRAP is at 198–242 px.
PAUSE would land on it too.

`touch.mjs` never sees this, because the bar isn't in its readout check. The fix:

- under `ir-touch`, the bar moves down under the row, as the wave readout already does;
- `.ir-boss.ir-on` joins the readouts `touch.mjs` checks, with a boss wave put up for it.

## 4. Only INK shoots

- **The tap goes.** A quick tap on the look pad pulls the trigger for 110 ms (`end` in
  `_bind()`). That code goes, with `TAP_MS`, `TAP_TRAVEL`, `lookMoved` and `lookStart`.
  - A touch on the right half now only looks.
  - `PULSE_MS` stays: it is how a tap on INK, shorter than a frame, still gets its shot.
- **The words follow:**
  - the header comment of `ui/touch.js`;
  - the title screen's how-to (`ui/screens.js`): "drag to look; a quick tap there fires one shot"
    becomes "drag to look; INK fires";
  - `README.md`'s right thumb;
  - `touch.mjs`'s list of things to try by hand loses "does tap-to-fire misfire while you are
    turning?".

## 5. The grenade

### A longer throw

The derivations beside `GRENADE.throw` read the speeds as distances. Worked out with the game's
own numbers (eye at 1.6 m, a lift of 2.6 m/s, gravity 32 m/s², to where it first lands on flat
ground):

| throw | `min` 8.5 m/s | `max` 25 m/s now | `max` 28 m/s |
|---|---|---|---|
| level | 4.0 m | 10.7 m | 11.9 m |
| 20° up | 4.8 m | 20.0 m | 23.8 m |
| the furthest (41°) | 5.0 m | 24.6 m | 29.9 m |

- **`max` goes from 25 to 28.** A full throw goes about a fifth further at the angles that are
  thrown: "a little further". The longest is in the air 1.4 s, well inside the 2.1 s fuse.
- **`min` stays.** A quick tap still drops it about 4 m away, inside its own 7.5 m blast. That is
  what makes a short lob risky.
- **The comments say landing distances,** as above, in place of the speeds read as metres.
- A friend's grenade flies through the same `fly()`, so it lands where it did on their page.

### A bigger bang

Now: 26 black strokes, a square black blot, and the same camera kick wherever it went off,
even 25 m away. The new blast, in the order you see it:

1. **The flash:** a star of nine uneven orange spikes round a black one, turned to face the
   camera. It grows to 2.4 m across in 0.06 s and is gone by 0.22 s.
2. **The ring:** a flat black ring on the ground, growing to the blast radius (7.5 m) in 0.18 s
   and thinning out by 0.3 s. It shows how far the blast reached, which is useful as well as
   loud.
3. **Smoke:** seven puffs (spheres, pen, `LINE`), so the page hatches and outlines them like
   anything else. They swell to 0.6–1.1 m in 0.35 s, rise 1.5 m, and shrink away by 1.4 s.
4. **Debris:** two bursts in place of one. 18 quick orange sparks, then 24 heavier black chunks
   that fall back.
5. **The scorch:** a splat with fourteen uneven points, in place of the square blot, at the same
   3.5 m.
6. **The camera:** the kick and the hitstop fall off with distance (full at the blast, none from
   20 m). Only your own blast makes the hitstop, as now.
7. **The sound:**
   - a short crack;
   - the boom as now, a little longer;
   - a low rumble that dies over a second.

   All of it scaled by `near`, as now.

**What it costs:**

- Flash, ring, smoke and scorch are four instanced meshes in `fx/effects.js`, pooled for four
  blasts at once and hidden when there are none.
- They are drawn by the one surface program every mesh shares, so no shader compiles mid-fight.
- The strokes come out of the existing pool of 420.
- A friend's blast is drawn the same way (`mark()`), harmless as now.

## 6. The older items

Each one checked against the code as it is today.

| item | still there? | where |
|---|---|---|
| The last figure is a nest sniper and no nest sees anyone: the wave stalls | yes | `renest()` returns when no free nest sees a player, and `trapped()` skips every stationary figure (`manager.js`) |
| Hit volumes bigger than the drawn limbs | yes | the capsules in `buildFigure()` are unchanged since `next_3.md` measured 2377 shots registering beside the drawing, and none missed on it |
| `figures.mjs`'s lineup faces away from the camera | yes | the camera looks along +z (yaw π), and the lineup is turned π, so it faces +z too, away from the camera, though the comment says "facing the camera" |
| A friend's footsteps and jetpack make no sound | yes | `crew.js` draws their jet's puffs, "and no hiss (their steps are not heard either)" |
| The idle arms cross in front of the chest (from `ai/summary.md`, added to this plan) | yes | `pose()`'s rest branch turns the left arm by +`armSpread` about z, which swings it across the body |

### The last sniper comes down

- **When:** `renest()` finds no free nest that sees anyone, twice running (`straggleEvery` × 2,
  16 s).
- **Where it goes:** the sniper comes down off its nest, to the `spawnPool` point nearest the
  nest that no player can see, the same test `trapped()` uses.
- **What it does then:** it is a figure on foot (`e.afoot`), and searches for the nearest player
  like any other straggler.
- **In the code:** the checks for `t.role?.stationary` go through a helper, `rooted(e)`, which is
  false once a figure is afoot.
- **In co-op:** it runs on the host's page with the rest of these rules.
- **The test:** `game.mjs` stages the scene `tools/bot/stage.mjs` already makes from the bot's
  run: a `liner` on the nest at (0, 15.5, −31), the player at (−25.4, 0, 5.1). Within 90 s the
  sniper must leave its nest and be seen by the player. One `--fast` bot run should then get
  past wave 5, where it stalled in plan 3.

### Hit volumes: measure, then trim

The old number counts any registered shot that misses the figure's triangles. But the outline is
drawn across the edge, about half of it outside the triangles, so some of those shots land on
ink you can see. `collide.mjs` learns to say where they land:

- by part (head, torso, arms, legs, hat);
- by how far outside the triangles, in cm, with the ones inside half an outline's width at 14 m
  (about 3 cm) counted apart.

Then trim what the numbers point at. Two likely sources, from the code:

- **The ends.** A capsule runs one radius past the end of the limb it stands for, and a drawn
  limb stops flat. Past the hands and feet that is 6–7 cm of nothing. The forearm and shin
  capsules end one radius short, as the torso's `off` does.
- **The radius.** A limb is drawn as a six-sided cylinder, whose flats are 0.87 of its radius from
  the axis, tapering to 0.88 at the bottom. Its capsule uses the full radius.

The gate stays: 0.0% of the shots that land on the drawing go unregistered. The aim is a
quarter fewer registering beside it: from 2377 to about 1780, and no further, so the volumes stay
a little generous for a thumb on a phone. `npm run collide`'s "every hit volume inside its bound"
still holds.

### `figures.mjs`'s lineup faces the camera

- **The fix:** the lineup's turn goes from π to 0. Then the eyes are on the side the camera sees,
  as the comment says.
- **Re-measured:** the band (from 10 m to 60 m) is measured again.
  - The eyes are two small solid dots, so the ink load moves a little.
  - If it leaves the band, the band is moved to the new measurement, not the figure: the figures
    are what they were, and only the side being measured changed.
  - The old and new numbers go in `next_6.md`.

### The idle arms

- **The fault:** at rest, and walking, a figure's arms cross in front of its chest. `pose()` sets
  their spread about z with the wrong sign: a hanging arm turned by +62° about z swings towards
  +x, and the left arm hangs at −x, so it swings across the body. The right arm does the same the
  other way.
- **The fix:** the signs flip, so the arms are held out from the body, as `PROPORTION.armSpread`'s
  comment says they are: in the rest branch of `pose()`, for the free left arm in a wind-up, and
  in `buildFigure()`'s starting values, which the broad-phase bound is measured from.
  - The aim pose is left: there both hands are meant to come in to the gun.
- **Checked:** `npm run collide` (the guns still point where their figures aim, every hit volume
  still inside its bound), a still of the lineup before and after, and `figures.mjs`'s band,
  measured once for this and the lineup's turn together.

### A friend is heard

In `Crew.draw()`, where the puffs already are:

- **Steps:** one each time the drawn legs cross, from the same phase that swings them, while they
  are on the ground and going over 1.5 m/s, as your own steps are (`Player`'s `onStep`).
  - Heard to 20 m, quieter on the way.
  - `audio.step(speed, near)` takes a `near`.
- **Jet:** the hiss while their jetpack burns, every `JET.hissEvery` as yours, heard to 40 m.
  - `audio.jet(near)` takes a `near`.
- **Bounded:** only the three nearest friends make steps, and the two nearest a hiss. Five friends
  flying at once is not 60 noise voices a second on a phone.

## Load and frame budget

- **Load:** the models and the blast are code. Estimate: +6 KB gzip at most, about 5 ms at
  10 Mbps, against 0.95 s to interaction now. `npm run perf` measures it.
- **Frames:**
  - draw calls rise by up to 4 while a blast is on screen, 1 for the thrown grenade, up to 2 per
    friend, and up to 2 for the weapon in hand;
  - no new programs;
  - fill rate is the same.

  `npm run perf`'s desktop worst 1% is close to its 33 ms limit (31.5 ms last time), so it is
  run three times each against the last commit, as in plan 3.

## Tools

- **`tools/game.mjs`:**
  - **ADS:** for the rifle, shotgun and staple gun, the sight's dot or bead, projected to the
    screen while aiming, is within 3 px of the crosshair. The new models are where this could go
    wrong, and nothing measures it today.
  - **Moving parts:** the pump, the bolt, the magazine and the lever each move after a shot or a
    reload, and come back.
  - **The throw:** a full throw from level lands 11.5 m away or more.
  - **The last sniper:** above.
  - **Stills:** the five weapons at the hip and aimed, `shots/stills/weapon-<key>-hip.png` and
    `-ads.png`, for a look by eye.
- **`tools/touch.mjs`:**
  - **No tap fire:** "tap fires the weapon" becomes "a tap on the look pad does not fire".
  - **A kill by thumb:** "a kill by touch alone" taps INK instead of the look pad.
  - **PAUSE:**
    - tapping it pauses;
    - the same tap doesn't resume;
    - a tap on the sheet does resume.
  - **App switch:** a second tab brought to the front hides the page, so the browser itself sends
    `visibilitychange`, and the game is paused when the tab comes back. If that is flaky in
    headful Chrome, the event is sent by hand.
  - **The layout:** the boss bar is in the readout check.
  - **The 👥 button on the pause screen:** reached by tapping PAUSE, not by calling `pause()`.
- **`tools/coop.mjs`:**
  - **The phone:** it taps PAUSE in place of `pause()`.
  - **Apart:**
    - at a run's start, every page's player is at least 1.8 m from every other's;
    - the same after a revive.
  - **The same gun:** a friend's visible prop is named for the weapon in their hands, `stapler`
    included.
  - **Heard:** a friend walking within 20 m makes steps on the other page. Counted by wrapping
    `audio.step`, as the frame-time case wraps other things.
- **`tools/collide.mjs`:**
  - the breakdown above;
  - `GUNS_HELD` learns `stapler`, so the aim check covers the new props.
- **`tools/figures.mjs`:** the turn and the band.
- **Re-run unchanged:**
  - `npm run build` and `npm run distcheck`;
  - `render`: the held weapon is still whole against a wall and outlined;
  - `feel`, `reach`, `toys`;
  - one bot run with `--fast`.

## Docs

- **`ai/summary.md`:**
  - Play: the grenade's throw, the blast's ring;
  - Co-op: a friend's gun is the model you hold, the start row, their steps and jet;
  - Touch: PAUSE, no tap fire, pause on app switch;
  - Enemies that cannot be found or reached: the sniper that comes down, out of "Not yet handled";
  - Known issues: the hit volumes as measured, `figures.mjs` facing the camera, the idle arms
    gone.
- **`README.md`:** the touch controls (no tap fire, PAUSE along the top right), and pausing.
- **`ai/next_6.md`** afterwards, as usual.

## Order

1. **Touch:** no tap fire, PAUSE, pause on app switch, `touch.clear()` on pause, the boss bar.
   Then `touch.mjs`. This part is small and stands alone.
2. **Spawn:** the start row and `Net.slot()`, then `coop.mjs`.
3. **The models,** one weapon at a time, each with the ADS check and its stills before the next.
4. **`buildProp`** and a friend's figure, then `collide.mjs` and `coop.mjs`.
5. **The grenade:** the throw, the model, the blast.
6. **The older items:** the sniper, the lineup and the idle arms (one re-measure of
   `figures.mjs` for both), a friend's sounds, then the hit volumes, measured before they are
   trimmed.
7. **The full run of tools,** `perf` three times each way, the docs.

## Choices made that you may want otherwise

- **The enemies keep their props.** Figures holding a rifle, shotgun or sniper could hold the new
  models, in red.
  - That is 14 figures with up to 3 meshes each instead of 2.
  - It moves what `figures.mjs` measures.
  - The prompt asks about friends' guns, so they are left.
- **A friend's gun is in your gun's inks,** not theirs. It looks the same as yours, which is what
  was asked. The figure's blue or green still says who it is.
- **No grenade in your hand while it cooks.** `buildGrenade()` exists and is unused. Showing it
  rising into the bottom left as G is held would be one more model in the held pass. It isn't
  asked, so it is left.
- **`min` throw speed stays,** so a quick tap is still a lob into your own blast.
- **The hit volumes are trimmed by a quarter** of the shots that register beside the drawing,
  not more: generous hit volumes help a thumb on a phone.
- **2 m between start points.** Wider reads more clearly as apart. Narrower reads more as a squad.
