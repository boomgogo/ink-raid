# Next 3: what plan 3 built, and what comes next

Plan 3 is built, and every tool has been run against the final build. Only the checks by hand on a
real phone are left.

## Done

### A friend's figure

- **No sinking after a landing** (`net/crew.js`):
  - A friend is now drawn through `Smooth` with `coast: 0`.
  - The new co-op case watches a guest burn a full tank and land. Before the fix it drew them
    3.48 m under the floor. Now the lowest point drawn, over about 300 frames, is 0.00 m from
    where they landed.
- **The pose** (`entities/enemies/rig.js`):
  - The aim branch is written for a figure facing −z, as it does.
  - The gun is laid along the facing, tipped by `pitch`, by setting the grip's turn from the
    joints above it (`layGun`). The arms can be posed for looks without moving the barrel.
  - The forward/back sign is flipped in three places, all with the same mistake:
    - `lean`: walkers lean forward, and a staggered figure reels back;
    - the wind-up: it leans back, then forward into the cut;
    - a friend's crouch bends forward.
  - **Enemies share it:** a figure aiming at you now points its gun at you.
    - On the host, enemies also aim up or down at their target (`pitchTo`).
    - On a guest's page, a figure aims up or down only when it is after that page's own player,
      since that page is not told who else a figure is after.
  - **Pictures,** in the git-ignored `shots/stills/`:
    - `pose-before-side.png`: the old aim, a bar held upright behind the back;
    - `pose-after-side.png`: left to right, rest, aiming level, aiming up, aiming down,
      walking;
    - `pose-after-front.png`: the same five poses from the front.
- **The gun they hold:**
  - Each page now sends `w`, the weapon in its player's hands.
  - A friend's figure carries all five props, and shows the one in `w`.
  - It aims where they look (`pt`) unless they sprint. The katana is carried.
  - While their jetpack burns, the figure takes the flyers' legs-up pose.
- **Shots, slashes and grenades** (`pf`, `net/crew.js`):
  - **What is sent:**
    - `Gun.fire`, the katana's swings and `Grenades.throw` tell `ctx.tell`, which `net/room.js`
      sets only in a room;
    - batches go out in bytes, droppable, twenty a second at most;
    - a rifle held down is about 100 B/s.
  - **What the other pages draw,** 120 ms after it arrives:
    - a puff and tracers from the drawn gun;
    - blots on the desk, found by a 60 cm ray of the page's own, so a blot on a toy rides the
      toy;
    - a red splash on a figure, except on the host, which drew it already as it took the health
      off;
    - a grenade that flies and goes off as on the thrower's page, harmless.
  - **Sound:** their shots, slashes and blasts are heard, fading out by 60 m (`near` on
    `audio.shot`, `swing` and `explosion`).
- **A test hook:** `window.__ink.poseFigure`, the rig's `pose()`, for pictures of one pose.

### The phone's buttons (`ui/touch.js`, `ui/hud.css`)

- **The bottom right:**
  - INK stays in the corner, at 92 px.
  - DUCK, UP, JET and BLAST are 60 px, on an arc of radius 118 px round it, from straight left
    to 80°.
  - The cluster is 208 × 202 px. Before, the buttons rose 320 px up a 390 px landscape screen.
- **The top right:** LOAD, NEXT and WRAP in a row of 44 px buttons. The wave readout and the
  feed move down under them.
- **The top left:** a second INK, 76 px, under the score. It holds or taps the trigger and does
  not aim. The blade gauge moves right of it.
- **The weapon readout:** in landscape it sits left of the cluster, and in portrait above it.
- **Positions:** every button's position and size is now in `touch.js`. `hud.css` only says how
  they look.
- **The title screen's touch how-to** says where everything went.

### The tests

- **`tools/collide.mjs`, in node:**
  - every gun points where its figure aims;
  - every hit volume stays inside its bound.

  Both are checked for every figure in 26 poses. `rig.js` already claimed `collide` checked the
  bound; until now it did not. On the old rig the first check fails: guns 75° off their aim, and
  grips 0.48 m behind the chest.
- **`tools/touch.mjs`:**
  - **The layout,** on four phones: 390×844, 844×390, 360×740 and 740×360. On each it checks:
    - every button is 44 px or more;
    - every button is on the screen;
    - no button sits on another;
    - no button sits on a word or number the HUD shows.

    Buttons are tested as circles, since a touch lands only inside one.
  - **Against the old layout,** the readout check fails in all four: UP on the slot list in
    landscape, DUCK on the life readout upright.
  - **New checks:** the left INK held, tapped, dragged (it must not turn the view), and held while
    the other thumb looks; and NEXT.
- **`tools/coop.mjs`, eight new cases:**
  - the landing;
  - the gun they hold;
  - held where they look;
  - a desk shot's tracer and blot;
  - a shotgun's eight pellets;
  - a slash;
  - a grenade;
  - a splash on a third page.

  The frame-time check now runs with the friends firing.
- **Two old co-op cases had faults of their own:**
  - **"Its rounds reach a guest"** failed before any of this. The test put the host on the spawn
    point furthest from the desk's centre, which was also the point it chose for the gun. The
    figure stood in the host and shot at the host's feet. The host now goes to the point
    furthest from the gun.
  - **"One bandage"** asked whether any bandage was left on the host's desk. It now asks about
    the one it dropped: the map has its own, and a plane can drop another.

## Changed from the plan

- **`w` is the weapon's key** (`rifle` … `stapler`), not its slot number, so the order of
  `game.weapons` does not matter.
- **The arc's buttons are 60 px,** not 64. Four 64 px buttons that clear each other need a 140 px
  radius, and the cluster would have been 230 px tall.
- **A slash is sent without a direction:** nothing draws one.
- **Playback** waits a fixed 120 ms, `Smooth`'s base delay. It does not follow the extra delay
  `Smooth` adds by itself when reports come late.
- **Enemies aim up and down at their target.** The plan kept their pitch at 0.
- **The wind-up's lean** is flipped as well as `lean` and the crouch: it had the same mistake.

## Test results, final build

| tool | result |
|---|---|
| `npm run game` | 85/85 |
| `npm run feel` | 29/29 |
| `npm run reach` | passes |
| `npm run touch` | 39/39 (20 before): four phones, the left INK, NEXT |
| `npm run toys` | all pass |
| `npm run collide` | passes, with the two pose checks |
| `npm run figures` | passes from 10 m to 60 m |
| `npm run render` | 26/26 |
| `npm run distcheck` | passes |
| `npm run coop` | 34/34 (26 before) |
| `npm run perf` | 7/7 |
| shots gate | only `ring0` fails, the known ink-load issue |
| bot, one unrecorded run | to wave 5, then a stall that the last commit shares (below) |

- **`coop`:**
  - **The full runs:** the first run, before the two test fixes, was 33/34 ("its rounds reach a
    guest"). The second was 33/34 ("one bandage"). The third was 34/34.
  - **Frame times with four friends firing:** a guest on a phone's 6× throttle drew 254 of their
    rounds while it was measured.

    | | fps median | p99 |
    |---|---|---|
    | with friends | 34 | 59 ms |
    | alone | 37 | 62 ms |
- **`collide`:**
  - No shot that lands on a figure's drawing fails to register.
  - Shots that register just beside a figure: 2377, against 2390 on the last commit.
- **`perf`:** three runs each, alternating with a build of the last commit.

  | | last commit | this build |
  |---|---|---|
  | time to interaction | 0.96 s | 1.02 s |
  | transfer | 241 KB | 244 KB |
  | desktop p99 | 24.6 ms (22.2–28.8) | 26.5 ms (25.0–29.0) |
  | phone fps | 52 | 51 |
  | phone p99 | 35.6 ms | 34.1 ms |

  - The differences are within each build's own spread.
  - 3 KB at 10 Mbps is about 2 ms, so the 0.06 s gap in time to interaction is noise.
  - Both builds sit under the 33 ms desktop limit today, where both measured about 34 ms in
    plan 2. That is this machine, not the code.
- **The shots gate:** the README's command, `compare.mjs gate shots/stills/*.png`, takes every
  still in the folder. That includes UI captures from `game`, `coop` and `touch`, such as the
  scope and the friends panel, which were never meant to pass it. Gated on the 20 stills
  `npm run shots` makes, only `ring0` fails.
- **The bot:**
  - **The run:** it reached wave 5 by 450 s. One figure was left, a `liner` on the nest at
    (0, 15.5, −31), and the bot stood near (−25.4, 0, 5.1) until the 1800 s cap.
  - **It is not this plan's doing.** `tools/bot/stage.mjs` puts the bot and that sniper back in
    that scene, and both builds play it frame for frame the same.
  - **Why:** `renest` moves a nest sniper only to a nest that can see a player, and none can see
    that spot. `trapped` skips stationary figures. So the wave waits for the player to go and
    find the sniper, and the bot does not.
  - The run went to the scratchpad, not `OUT_DIR`, to keep it out of `botreport`'s numbers.

## Next

1. **A real phone.**
   - Two thumbs on the new layout. The left INK at the top left is a reach when the phone is
     upright, which the plan chose to accept.
   - Co-op over the LAN, still only played through `coop.mjs`'s Pixel 7 profile.
2. **The last sniper.** When no nest can see anyone, a nest sniper that is a straggler could
   come down and hunt, or the bot could learn to go and look at the nests. A person would find
   it, but a wave held open by one sniper out of sight is still a dull minute.
3. **The idle arms.** At rest a figure's arms cross in front of its chest (`pose()`'s arm spread
   has the wrong sign). `figures.mjs`'s band was tuned on that look, so it waits for a pass that
   can re-tune it.
4. **`figures.mjs`'s lineup** faces away from the camera (rotation π), whatever its comment says.
5. **The shots gate's command** in `README.md` should name only what `npm run shots` makes, or
   `shots` should write to a folder of its own.
6. **Playback timing:** a friend's shot is drawn a fixed 120 ms after it arrives. On a jittery
   connection, `Smooth` draws the figure later than that, so the tracer can leave a little ahead
   of the figure.
7. **Still silent:** a friend's footsteps and jetpack.
8. **The bot never flies,** as before.
