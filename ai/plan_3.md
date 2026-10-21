# Plan 3: a friend you can see fighting, and room on the phone's right side

Answers `prompt_3.md`. Two parts:

1. A friend's figure in co-op: the gun they hold, held the right way, their shots and the marks
   they leave, and no sinking into the floor after a jetpack landing
2. The phone's buttons: the less used ones go to the top right, smaller, and a second INK goes
   top left

## 1. A friend's figure in co-op

### What is wrong, and why

Each of the four complaints has its own cause.

1. **Always the same gun.** A friend is built once from `FRIEND` in `net/crew.js`, with
   `prop: 'rifle'`. What a page sends about its player (`Crew.say`) does not include the weapon it
   holds, so the other pages cannot know it.
2. **"His katana behind his body".** That is the rifle, in `pose()`'s aim branch
   (`entities/enemies/rig.js:455`). A friend is posed with `aim` whenever they are up and moving
   slower than 0.6 of walking speed, so most of the time.
   - **The direction is wrong.** A figure faces −z: its eyes are there, and its yaw is the
     player's yaw (forward is `(-sin yaw, 0, -cos yaw)`). The aim branch turns the upper arms by
     −1.42 and −1.3 rad about x. That swings them back to **+z**, behind the figure.
   - **The gun points down.** The barrel lies along the forearm's −z. That is forward when the
     forearm hangs down, as at rest, and straight down once the forearm is raised.
   - **Measured.** The rig was posed in node:
     - at rest, the grip is 5 cm in front of the body and the muzzle 66 cm in front;
     - aiming, the grip is 48 cm **behind** it and the muzzle 60 cm under the grip.
   - **Seen.** A side-on render of the same figure holds the rifle out in front at rest. In the
     aim pose it holds a long thin bar upright behind its back, pointing at the floor.
   - **Enemies have it too.** Every enemy with a gun takes this pose while it aims at you, and
     faces you as it does. So its gun is hidden behind its own body at the moment it matters most.
   - **Two smaller signs that `pose()` was written for a figure facing +z:**
     - `lean` tips the chest toward +z. So walking figures lean backwards, a charging one leans
       back 0.7, and a staggered one "leans back" toward −z, which is forwards.
     - A crouched friend (`crew.js:198`, `chest.rotation.x += 0.35`) bends backwards.

     The melee wind-up (`raise`, `cut`) is right as it is: the blade goes up and back, over −z.
3. **No firing, no marks.** Tracers, impacts, muzzle puffs and grenades are drawn only by the
   page whose player made them.
   - On the host, a guest's hit on a figure shows a red splash. That comes from `damage` with
     `info.by`, and nothing else is shown.
   - Nothing at all is sent about shots that hit the desk, a toy, a plane or nothing.
   - Nothing is sent about katana swings or grenades either.
4. **Below the ground after a jetpack landing.**
   - **Why reports stop.** p3p2 sends presence only when it changes (`sendPresence` compares the
     JSON with the last one sent). A player who lands and stands still sends one last report with
     the landed height, then nothing.
   - **What `Smooth` does with that.** `Crew` draws friends through `Smooth`, which by default
     **coasts** for 250 ms past the last report. It carries on along the line through the last two
     reports, holds there for up to a second, then slides back over another 250 ms. The last two
     reports are "falling" and "landed", so it carries the figure on down through the floor.
   - **How far.** Falling from a full tank's 17 m is about 34 m/s at the floor (√(2·34·17)).
     A quarter of a second of that is about 8.5 m below the floor, for about a second. A plain
     jump down from a crate gives 2–3 m.
   - **Only on landing, not while walking.** While walking, the same coasting overshoots a stop
     by v × 0.25 s, about 1.5 m at walking speed, sideways and above ground, so it is less obvious.

### What changes

#### 1.1 The pose (`entities/enemies/rig.js`)

- **The aim branch, rewritten for a figure facing −z:**
  - both upper arms come forward and up, so the hands meet in front of the chest: the right hand
    on the grip, the left reaching toward the barrel;
  - the gun points the way the figure faces.
- **The grip's orientation is set, not inherited.** `pose()` takes an optional `pitch`, which is 0
  for enemies. The grip's world orientation is set to "level along the facing, tilted by pitch".
  It is worked out from the chain above it (chest, upper arm, forearm), all of which `pose()`
  itself has just set. So it is exact whatever the arm angles turn out to be: the arms can be
  tuned for looks without moving the barrel.
- **Other poses are left alone.** The rest and walking poses already point the barrel forward,
  and the wind-up does too. Only the aim branch changes the grip, and the others reset it.
- **The `lean` sign is flipped,** with the head's counter-tilt that goes with it:
  - walking and charging figures lean forwards;
  - staggered ones reel backwards, as the comments say;
  - `crew.js`'s crouch bends forwards (−0.35).
- **Enemies change with it.** Every enemy now points its gun at you while it aims, which is a tell
  you can read. Their hit volumes ride the joints, so they follow the arms.
- **Checks:**
  - **A pose check in node,** like the one used to find this. Each prop is posed at rest,
    walking, aiming at pitch −0.6, 0 and +0.6, and in the wind-up. It checks:
    - aiming, the muzzle is in front of the chest, at least 0.3 m along the facing;
    - the barrel is within 10° of the aim direction;
    - at rest and walking, the barrel points forwards (its dot product with the facing is above
      0).

    It goes in `tools/collide.mjs`, which already poses every figure, so the pose rules and the
    hit-volume rules are checked in one place.
  - `npm run collide`: every hit volume stays inside the broad-phase bound (`POSE_SWING`) in the
    new aim pose. If an arm reaches further forward than 0.45 m allows, `POSE_SWING` grows with it.
  - `npm run figures`: the legibility band, unchanged or reported.
  - `npm run render` and `npm run gate`.
  - Side-on screenshots of one figure per prop, before and after, at rest, aiming level and aiming
    up.

#### 1.2 The gun they hold (`net/crew.js`)

- **Presence gets `w`:** the held slot, 0 to 4, in `game.weapons`' order (rifle, shotgun, sniper,
  katana, staple gun). It changes only on a swap, so it costs nothing between swaps.
- **A friend's figure carries all five props** from the start, built by the rig's own `addProp`
  (`rifle`, `shotgun`, `sniper`, `katana`, and `staples` for the staple gun). Only the one in
  `w` is shown, and a hidden mesh is not drawn. `buildFigure` takes a list of props for this;
  enemies still pass one.
- **The katana is held as a blade, not aimed like a gun:**
  - it is held forward in the rest pose;
  - a swing (1.4) plays the wind-up and cut the cutter enemies already have.
- **When they are down,** the figure falls as now, with whatever it held.

#### 1.3 Pointing where they look

- `pt`, the pitch, is already sent and never used. It goes into `pose()` as `pitch`, and the head
  tilts with it, a little.
- **When the gun is up:** a friend aims whenever they are up and not sprinting. That is stance
  `sprint` in `st`, in place of today's speed test, which lowers the gun at 0.6 of walking speed.
  While they sprint, the gun is carried as at rest.
- **Why it matters:** a tracer (1.4) then leaves a muzzle that points the way it goes.

#### 1.4 Shots, swings and throws: a new message, `pf`

- **What it carries:** what a player's weapons did, for the others to see. It is for show only.
  It hurts nobody: hits on figures still go to the host as `hit`, as they do now.
- **How it is sent:** to everybody, `volatile` (droppable, like `hr`), in bytes through
  `net/wire.js`, at most twenty batches a second. That is the same cadence as `hit`
  (`BATCH_SECONDS`).
- **What one batch holds:**

  | event | bytes |
  |---|---|
  | a shot: the gun, then each pellet's end point (three `pos`) and what it hit (air, desk, figure, plane) | 2 + 7 per pellet |
  | a katana swing: which way | 2 |
  | a grenade thrown: where from, and its velocity | 1 + 12 |

  A rifle held down is ten one-pellet shots a second, about 100 B/s. A shotgun is 58 B a pump.
- **The hooks:**
  - `Gun.shoot`, `Katana`'s swing and `Grenades.throw` call a hook on `ctx`. It is null when
    alone, so a game alone does nothing new.
  - `Net` sets the hook when it enters a room and clears it when it leaves. `Crew` queues the
    events and sends them with its batch.
- **What the other pages draw,** for each friend:
  - **When:** each event is played back after the same delay the figure is drawn with (`Smooth`'s
    120 ms), so the shot leaves the figure when it is drawn firing, not before.
  - **A shot:**
    - a small puff at the drawn muzzle;
    - a tracer from the drawn muzzle to each end point, in the gun's own width (`cosmetics`);
    - then, by what the shot hit:
      - **the desk:** an impact (blot and puff). The page casts a short ray of its own, 30 cm
        either side of the end point, for the surface's normal and for the toy it is on, so
        blots on the train ride the train as the shooter's do;
      - **a figure:** the red splash (`effects.hit`). The host already shows its own splash
        through `damage`, so it is not drawn twice there;
      - **a plane, or air:** the tracer alone.
  - **A swing:** the cut pose over the katana's 0.28 s swing.
  - **A grenade:** it flies on this page from the same place and velocity, and goes off with the
    burst and the scorch. It is only drawn: no damage, no noise for the figures, no shove for the
    toys, no hurt to this page's player. The thrower's page did the real blast.
- **Sound:** friends make no sound today. Their shots are proposed to be heard, quieter with
  distance and gone past 60 m, as the host's figures' shots are on a guest's page (`foeShot`,
  `horde.js:488`). This needs `audio.shot(kind, near)`, with the `near` that `whistle` and
  `click` already take. Their grenades would sound the same way. Footsteps and the jetpack's hiss
  stay silent.
- **The cost of a frame:**
  - tracers, blots and particles come from the pools there are (`MAX_TRACERS`, `MAX_DECALS`, the
    particle pool), so nothing new is drawn;
  - each pellet that reaches the desk costs one ray 60 cm long;
  - four friends with rifles is 40 short rays a second.

#### 1.5 Landing (`net/crew.js`)

- **The fix:** `new Smooth({ angles: [3], jump: 6, coast: 0 })`. With no coasting, a figure whose
  reports stop stays at the last place it was reported, which is where it landed.
- **What is given up:** a report that comes late now holds the figure still for that moment,
  where before it carried on. Presence comes twenty times a second, the figure is drawn 120 ms
  late, and `Smooth` lengthens that delay by itself when reports come late. So a held moment
  should be rare and short.
- **While the jetpack burns,** the friend is posed with `flying` (legs drawn up), which the rig
  already has for the flyers.

### Testing it

**New cases in `tools/coop.mjs`,** between two pages unless a third is needed:

| case | passes when |
|---|---|
| the gun they hold | the guest switches to each of the five; on the host the figure shows that prop and only that one, within 300 ms |
| held the right way | the guest looks level, then 30° up, then 30° down. On the host, the figure's muzzle is in front of its chest and the barrel is within 10° of the guest's view |
| a shot at the desk | the guest fires one rifle round at a wall. On the host, within 400 ms, a tracer ends within 5 cm of the guest's own impact, and a new blot is there |
| a shot at a figure | with three pages, the guest's hit on a figure shows a red splash on the third page |
| a shotgun | eight tracers on the host for one pump on the guest |
| a katana swing | the figure on the host goes through the cut pose |
| a grenade | it is drawn on the host, goes off there, and takes no health from the host's player |
| landing | the guest burns a full tank, falls and stands still. On the host, sampled every frame for 1.5 s from the landing, the figure's feet never go more than 5 cm under the height the guest landed at. Today this should fail by metres, and it is run first to show that |
| frame times with friends | the existing check, with the friends now holding their triggers down while it measures |

**The game's own tools:** `npm run game`, `feel`, `touch` (part 2), `collide`, `figures`,
`render`, `perf`, `distcheck`, and an unrecorded bot run. The bot sees enemies aim through
`sense.js` from what is on screen, so their new pose could change how it does. The bot's run is
compared with the last one in `next_2.md`.

## 2. The phone's buttons

### Now

All eight buttons sit in the bottom-right corner (`ui/touch.js` `BTNS`, and `.tfire`, `.tswap`,
`.theal` in `hud.css`). Measured with a bandage in hand:

- **Landscape, 844×390:**
  - the buttons run from 68 px to 380 px down the screen, 80% of its height, on the side the
    right thumb looks with;
  - the weapon's name, its hint and the slot list (`.ir-br`, moved to `bottom: 46vh` for touch)
    sit under BLAST, UP and WRAP, where they can't be read.
- **Portrait, 390×844:** the cluster takes the lower right third. The slot list sits just above
  it.

Fire is only on the right. So you can walk and shoot (stick plus INK), but you cannot turn with
the right thumb and shoot at the same time. INK aims while you drag it, but one thumb is doing
both.

### After

```
 SCORE 0                                        [LOAD][NEXT][WRAP]
 ( INK )                                                  WAVE 3
                                                       12 left

                                                   (BLAST)
                                              ( JET )
                                         ( UP  )
                                     (DUCK)          (   INK   )
```

- **The top right,** in a row along the top edge: LOAD, NEXT and WRAP (WRAP only while you carry
  a bandage). They are the ones you press least: reloading also happens by itself when the clip
  is empty, swaps are now and then, and bandages are rare.
  - All three are 44 px, the floor `touch.mjs` checks. Today LOAD is 64 px and WRAP 48 px.
  - They sit 8 px apart, 10 px from the top and 14 px from the right.
  - In touch mode the WAVE readout (`.ir-top-r`) and the kill feed move down by one row, to sit
    under them.
- **The bottom right:** INK in the corner as now, at 92 px, with UP, JET, DUCK and BLAST on an arc
  round it, each 64 px.
  - The arc's radius is about 140 px, so neighbours have about 8 px between them.
  - The whole cluster is about 230 px tall, under 60% of a landscape phone's height. Today it is
    320 px.
  - JET sits next to UP, because you jump and then fly.
- **The weapon readout** (`.ir-br`) never sits under a button:
  - **in landscape,** it moves to the left of the cluster, at the bottom;
  - **in portrait,** it stays above the cluster, at the new height.
- **The second INK, top left:**
  - It is 76 px, under SCORE and the combo line, 16 px from the left edge.
  - Its touches never reach the canvas, so it cannot start the stick.
  - **Hold** it to hold the trigger; **tap** it for one shot, as with the right one.
  - **It does not aim when dragged.** Turning is the right thumb's job here: the left thumb holds
    the trigger while the right thumb turns on the look pad.
  - It is on whenever the touch layer is.
- **`touch.js`:**
  - One `fireId` becomes one per INK button. The trigger is held while either is down, or during
    a tap's pulse.
  - Only the right INK aims as it is dragged.
  - `clear()` lets go of both.
  - The `BTNS` positions are re-laid out as above. LOAD, NEXT and WRAP become a top-right group,
    positioned from the top (`top`, not `bottom`) in `hud.css`.
- **Text:**
  - the touch how-to on the title screen (`ui/screens.js:105`): two INK buttons, and where LOAD,
    NEXT and WRAP went;
  - the checklist `touch.mjs` prints for a person: "can you reach the left INK without letting go
    of the phone?".

### Testing it (`tools/touch.mjs`)

Today it plays one phone in portrait, at 390×844. It will play four:

- portrait 390×844 and landscape 844×390;
- a small phone, 360×740, both ways.

On each:

- every button is at least 44 px and inside the screen (these checks exist; they now run on all
  four);
- **no two buttons overlap,** WRAP included;
- **no button covers a HUD readout:** SCORE, combo, WAVE, the kill feed, LIFE, ammo, the weapon
  name, the hint and the slot list. Each is compared by its bounding box;
- **the left INK:**
  - held, it holds the trigger;
  - tapped, it fires one shot;
  - dragged, it does not turn the camera;
- **left INK and the look pad together:** held with a drag on the right half, the player fires
  and turns at the same time;
- **the right INK** still holds the trigger and aims while it is dragged;
- **the top-right row:** LOAD reloads, NEXT swaps, WRAP heals.

Screenshots of all four layouts, before and after, go in `next_3.md`.

## Load and frame time

- **Load:** nothing new is fetched. The code is a few hundred bytes of script and CSS.
  `npm run perf` confirms time to interaction stays at about 0.92 s.
- **Frame:** the extra props are hidden, so they add no draw calls, and the effects come from
  the existing pools.
  - **The new costs:** setting a grip's orientation each frame for each aiming figure (a few
    quaternion products), and the short rays (1.4).
  - **Where they are measured:**
    - `npm run perf` alone: the desktop's worst 1% must not get worse. It sits on its 33 ms limit
      already, so three runs alternate with a build of the last commit, as in plan 2;
    - `coop.mjs`'s phone with friends, now with the friends firing.

## Order of work

1. **The landing.** The `coop.mjs` case first, to watch it fail; then `coast: 0`; then the case
   again. This is the smallest change and the most visible bug.
2. **The pose.** The node check first, to watch it fail on today's aim pose; then the aim branch,
   the grip, the lean sign and the crouch. Then `collide`, `figures`, `render`, `gate`, and the
   side-on screenshots.
3. **The gun they hold, and where they look:** `w`, the five props, `pitch`, and the cases for
   them.
4. **`pf`:** the hooks, the batch, and the playback (shots, swings, grenades), then the sound.
   The cases for them, and the frame time with friends firing.
5. **The buttons:** the layout, the second INK, the readouts that move, and the four-phone
   `touch.mjs`.
6. **Everything,** against the final build: `game`, `feel`, `reach`, `touch`, `toys`, `collide`,
   `figures`, `render`, `perf`, `distcheck`, `coop`, and an unrecorded bot run.
7. **Documentation:**
   - `ai/summary.md`: the pose fix, the friend's figure, `pf` in the `net/` notes, the touch
     layout;
   - `README.md`'s controls;
   - `ai/next_3.md`, with the results as they come out, failures included.

## Judgement calls (yours to change)

- **Enemies' poses are fixed too,** since it is one function: they point their guns at you while
  aiming, and lean the right way. Fixing only the friend would mean a second pose function with
  the same bug left in the first.
- **A friend's shots are heard,** quieter with distance. The prompt asks only to see them.
- **A friend's grenades and katana swings are shown,** as well as the shots the prompt names.
- **BLAST stays by INK.** Only LOAD, NEXT and WRAP move up. BLAST can join them if the right side
  is still crowded.
- **The left INK is top left in portrait as well.** That is a reach for the thumb. Lower on the
  left edge would be easier to reach, but is not what the prompt asked.
- **The left INK only fires.** It does not aim when dragged, so it can't fight the right thumb
  over the camera.
- **Not in this plan:** the idle arms. `pose()` sets their spread with the wrong sign too, so at
  rest both arms cross in front of the chest instead of standing out from it. `figures.mjs`'s
  legibility band was tuned on that look, and nobody has complained about it. Separately,
  `figures.mjs` turns the lineup to face away from the camera (rotation π, while its comment says
  "facing the camera"). Both are noted for `next_3.md`.
