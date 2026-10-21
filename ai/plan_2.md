# Plan 2: co-op through p3p2, links and a version, a jetpack, and the empty box

Answers `prompt_2.md`. Five pieces, in the order they will be built. The small ones come first so
they are in place before the big ones. Co-op is brought over from the reference fork **before** the
jetpack, because it applies cleanly onto the game's files as they are now, and would not after the
jetpack has changed them (see section 4).

1. The empty box on the pause screen
2. The version in a corner
3. The links: fork me on GitHub, more games on Maize.Live
4. Co-op through p3p2, brought over from the fork
5. The jetpack, in place of the grapple, then into co-op

## 1. The empty box on the pause screen

**Cause.** `src/ui/hud.css:320` has `.ir-leave span { position: relative; }`. It is meant for the
MAIN MENU label, but it also matches the quill's own `<span class="ir-quill">` (`ui/quill.js:57`).
It is more specific than `.ir-quill { position: absolute; inset: 0 }`, so the quill falls back into
the flow. Its SVG is `width: 100%; height: 100%`, so the drawn frame grows to the panel's width and
pushes the label down below it. The empty box is that frame. The death screen has the same button
and the same bug.

The reference fork found the same thing (`~/Repos/p3p2_test_repos/ink-raid/ai/p3p2_next.md`,
"Changed in the game").

**Fix.** `.ir-leave > span:not(.ir-quill) { position: relative; }`.

**Check.** Screenshots of the pause and death screens at 1280x800 and at phone size, before and
after the fix. A check in `tools/game.mjs`: the MAIN MENU quill's box is no bigger than the button's.

## 2. The version in a corner

- **Where it comes from:** `vite.config.js` works out the commit at build time:
  1. `WORKERS_CI_COMMIT_SHA` if Cloudflare's build sets it;
  2. otherwise `git rev-parse HEAD`;
  3. `'dev'` if neither works.
- **What it reads:** `v.` and the first four characters, for example `v.2f20`, as the prompt asks.
  - `npm run deploy` builds from the working tree, so a build with uncommitted changes would
    still show the last commit. The build prints a warning when the tree is dirty, and the shown
    version is not changed.
- **How it gets there:** written into `index.html` at build time (a `transformIndexHtml` hook), and
  defined as `__VERSION__` for the scripts. So it is on the boot splash from the first paint,
  before any script has loaded, and costs no script bytes.
- **Where it shows:** the prompt asks for "an unused corner of the game", so it is there during
  play too:
  - **during play,** faint and small (about 0.6 of the HUD's type size), in the bottom-left corner
    below the health cluster (`.ir-bl` stops 2.4vh short of the edge, which leaves room for one
    small line). It never takes the pointer;
  - **on the title, pause and death screens,** in the same corner;
  - **on the boot splash** (`#boot`), in the same corner.
- **p3p2:** p3p2 keeps players on different builds in different rooms, and needs a version for
  that. The reference fork used `Date.now()`. This uses the full commit hash, with the build time
  added when the tree is dirty, so two local builds of different code don't share a room.

## 3. The links

Two links, in one line at the foot of the panel. The panel is drawn in pen, so they are drawn in
pen too: underlined text in the panel's ink, with no ribbon image and no added request.

- **fork me on GitHub** → `https://github.com/boomgogo/ink-raid` (the `origin` remote). The game is
  GPL-3.0, so forks are welcome.
- **more games on Maize.Live** → `https://maize.live`.

Both open in a new tab (`target="_blank" rel="noopener"`).

**Where they show:**

- **The pause screen**, as asked.
- **The loading page.** The prompt's "loading page" is taken to mean both of these:
  - **The boot splash** (`#boot` in `index.html`), as plain HTML. It is up for under a second on
    a good connection, so these links are mostly seen on a slow one.
  - **The title screen.** It is the page a player sees once the game has loaded. It is also the
    only one of the two a phone can reach: there is no pause button for touch.

  If only the boot splash was meant, the title screen's line is a one-line delete.

**Clicks:** `Screens._show` stops clicks from reaching the backdrop only for buttons, inputs,
labels and details. `a` is added to that list. Without it, a click on a link on the pause screen
would also resume the game and lock the pointer.

**The boot splash:** `#boot` is a fixed, full-window cover. The links sit inside it and take the
pointer. After `.gone` it has `pointer-events: none`, so they stop catching clicks once it fades.

**Load cost:** a few hundred bytes of HTML. `npm run perf` confirms it.

## 4. Co-op through p3p2

### Starting point

- **The reference fork:** `~/Repos/p3p2_test_repos/ink-raid`, branch `p3p2`, on itr 0
  (`6cca3a9`).
- **What has changed here since:** of the game's shipped files, only
  `entities/enemies/manager.js` (+113 −2: stragglers, `TRAPPED`, `renest`, no hits after death),
  plus `README.md` and `package.json`. `game.js` has not changed.
- **So it is applied, not retyped:** the fork's diff from `6cca3a9`, for `src/` and
  `vite.config.js`, goes onto the working tree as a three-way apply, with no commit:

  ```sh
  git -C ~/Repos/p3p2_test_repos/ink-raid diff 6cca3a9 p3p2 -- src vite.config.js > fork.diff
  git apply -3 fork.diff
  ```

  - `net/` (room, crew, horde, wire; about 1,350 lines) is new and comes over as it is;
  - `game.js`, `screens.js`, `hud.css`, `waves.js`, `pickups.js`, `planes.js`, `main.js` and
    `vite.config.js` apply cleanly, as they are unchanged here (sections 1–3 are done first, and
    touch only `hud.css`, `screens.js` and `vite.config.js` where the fork does not, or the
    hunks are resolved by hand);
  - `manager.js` is the one real merge: the fork's ~450 lines of hooks (`targetOf`, and the
    guest's side of `damage`, `noise`, `stagger`) meet itr 1's.
- **Why before the jetpack:** the jetpack edits `game.js`, `screens.js`, `hud.css` and `main.js`.
  Done first, it would turn those clean applies into hand merges. The jetpack's flag goes into
  what each player sends once the jetpack exists (section 5).
- **Its decisions are kept** (`p3p2_plan.md` section 3):
  - down until the next wave; the run ends when everybody is down at once;
  - waves grow by half for each extra player;
  - the run is the room's, with JOIN on the title screen;
  - pausing does not stop the desk;
  - no friendly fire;
  - FRIENDS on the title, pause and death screens.

### The package

- `npm install @p3p2/client`: 0.1.1 from npm, which is current. The fork used a vendored 0.0.0
  tarball.
- 0.1.1 has everything the fork leaned on:
  - `member-state` with here, away and lost;
  - `room.limits`;
  - ops that wait for the connection.
- `vite.config.js`: `optimizeDeps.exclude: ['@p3p2/client']`, as in the fork. The client's entry
  then stays a separate small file, and the rest loads only when a room is opened.
- The game's version for p3p2 is the commit hash (section 2), in place of the fork's `__BUILD__`.

### What changes from the fork, on top of the apply

- **itr 1's enemy rules run on the host only:**
  - the straggler search (`AWARE.straggle`);
  - `TRAPPED` redraws;
  - `renest`.

  Guests see their results in the host's reports. "Unfound for 35 s" means unfound by **every**
  player, and "out of sight" for a redraw means out of sight of all of them. The fork already
  spawns out of sight of all players, and that helper is reused.
- **No hits after death in co-op:** itr 1 stopped rounds and blades landing on a dead player. In
  co-op, a player who is down is skipped by `targetOf`, and rounds that reach a downed page are not
  judged.
- **The link to p3p2.me:**
  - **On the title screen,** beside FRIENDS: "play with friends: get a room at p3p2.me". That is
    where player 1 starts.
  - **On the pause screen,** in the same row as FRIENDS.
  - It opens in a new tab and says where a room or a server comes from. The library's own panel
    is left alone.
- **Pause and death screens:** FRIENDS and the p3p2.me link sit beside MAIN MENU. They use the
  `.ir-leave` style, which section 1's fix makes safe to reuse.

### Alone, it must be what it was

- **No network:** an ordinary visit loads the client's ~2 KB entry and asks no server anything.
- **Load:** time to interaction stays inside the target (0.92 s and 227 KB now, against 2–3 s).
  The added bytes are measured and reported in `next_2.md`.
- **The bot:** `autoplay.mjs` runs alone. The virtual clock (`tools/bot/clock.js`) replaces timers
  and `performance.now`, which p3p2's client also uses. The client must stay idle without a room,
  and an unrecorded bot run will confirm it.
- **The build:** `npm run distcheck` passes. The client's chunks are plain JS with no
  `/* glsl */`, so the strip leaves them alone.

### Frame time, alone and with friends

`npm run perf` is not all green now: it passes 6 of 7. The desktop's worst 1% of frames is at
33.6–35.3 ms against a 33 ms limit (`ai/next_1.md`), and was on the limit before itr 1 too.

- **Alone:** that number must not get worse. It is measured before section 4 and again at the end,
  with the jetpack's puffs on screen.
- **With friends:** the spec asks for entry-level phones, and co-op adds other players' figures,
  the horde's sync and interpolation every frame. `tools/coop.mjs` (below) measures frame times on
  the guest's page with three friends in the room, under the same 6× CPU throttle `perf.mjs` uses
  for a phone, and reports them next to the alone numbers.

### Testing it

- **A local server:**
  - `~/Repos/p3p2`, `npm run dev`, on port 8080;
  - this game with `npm run dev -- --host`, or a `preview` build, on its port;
  - a room created in p3p2's local portal for this game's URL.

  This follows the fork's `p3p2_next.md` ("How to see it").
- **The browser tests have to be written here.** The fork's notes name
  `e2e/tests/games/ink-raid.spec.ts` in p3p2's repository (13 tests), but that file is not in
  `~/Repos/p3p2` on any branch or in its history, nor anywhere else on this machine, and p3p2's
  runner (`e2e/tools/run.ts`) has no `GAMES` or `GAMES_DIR` support. So:
  - **`tools/coop.mjs`,** a plain Playwright script like `game.mjs` and `touch.mjs`. It starts
    p3p2's server from `~/Repos/p3p2` (or uses one already running), serves this build, opens a
    room through the server's own API, and drives several pages into it.
  - **Its cases,** taken from the table in the fork's `p3p2_next.md`, as far as one machine allows:
    - alone: as before, and no server asked anything;
    - two players: the same figures on both pages; a guest's hit takes a figure down, and the kill
      is the guest's;
    - four players: one horde, a wave the size of four;
    - shot at: a figure goes for the nearest player, and its rounds reach a guest on the guest's
      own page;
    - down and up: down until the next wave; everybody down ends the run for everybody;
    - the host leaves mid-wave: the next player runs the same figures;
    - on the desk: a dropped bandage is the same for both and goes to whoever walks over it;
    - a reload: back in the room and back in the run;
    - a phone: in by the link, FRIENDS by touch, a panel that fits;
    - frame times with friends (above).
  - **Plus the new cases:**
    - a friend's jetpack burn is seen on the other page;
    - stragglers search toward the nearer of two players;
    - a downed player takes no rounds.
  - Other engines, a lossy connection and the traffic count were in the fork's list. They need
    p3p2's lag proxy and more engines than this repo installs, and are left out unless they come
    cheap; `next_2.md` says which were run.
- **By hand:** two browsers, one of them a phone on the LAN. The phone's link to p3p2.me and the
  FRIENDS panel must fit and work by touch.

## 5. The jetpack, in place of the grapple

### What it is

- **Flying:** hold the key (Q or E, the pad's button 4, or the touch button that was LINE) and the
  pack pushes you up. Steering in the air is stronger while it burns.
- **Fuel:** it burns while you fly. When it runs out the pack cuts out and you fall.
- **Refuelling:** fuel comes back over time while you are not flying. It starts after a short
  beat, so feathering the key does not refuel in mid-air for free. It refuels in the air too, as
  long as you are not burning: the prompt says "while not flying", and gliding down between
  bursts is the skill.
- **No new key:** it replaces the grapple outright, on the same bindings, so nothing else moves.

### Tuning (`entities/jetpack.js`, `JET`)

Each number is derived from a target, as in `MOVE`. Gravity is 34 m/s², the grapple's own
reference point.

| dial | value | from |
|---|---|---|
| `thrust` | ~48 m/s² | beats gravity by ~14 m/s², so lift-off from standing is clear within 0.2 s |
| `climbMax` | ~9 m/s | above the jump's 7.4 m/s, so it reads as flight, not a long jump |
| `airControl` | 1.5× `MOVE.airControl` | a reversal of walk speed in 0.33 s while it burns, not 0.5 |
| `airCap` | 12 m/s | above sprint (8.8) and the cutter (10.5), under half a dash |
| `tank` | 1 | |
| `burn` | 0.48 /s | 2.1 s from full: set from the ceiling (below) |
| `refill` | ~0.34 /s | ~3 s from empty |
| `refillWait` | 0.5 s | so feathering the key does not refuel for free |
| `minIgnite` | 0.12 | the grapple's `fire()` floor, so an empty tank can't flicker |

**The ceiling.** One full tank from the floor should top the highest place, with a little room to
spare. The highest declared place is the pencil cup's rim, at 16 m; the north stack's roof is next,
at 15.5 m. The tallest thing on the desk is the lamp, at 28.4 m.

The arithmetic, with thrust 48 and a 9 m/s climb:

- from rest, 0.64 s to reach 9 m/s, covering 2.9 m;
- then 9 m per second of burn;
- then 1.2 m of coasting after the cut-out (9²/2·34);
- and a jump first adds about 0.8 m and saves most of the run-up.

With 2.1 s of burn (`burn` 0.48 /s) that is about 17 m from standing, a metre over the pencil
cup's rim, and about 20 m with a jump first: 8 m under the lamp, so one tank never takes you out
over the top of the map, and no soft ceiling is needed. `tools/feel.mjs` measures 16.9 m and
19.7 m.

**It can't hover for ever.** Holding a height takes thrust for 34/48, about 71%, of the time.
Fuel burns at `burn` while thrusting and comes back at only 0.34 /s, after a 0.5 s wait, while not.
So refuelling in the air stretches a glide but cannot keep you up.

**The checks that settle the numbers,** in `tools/feel.mjs`, in node at exactly 60 fps against the
real desk:

- one tank from standing tops the highest place;
- with a jump first, it stays 2 m or more under the tallest thing on the desk;
- from the floor in front of the north stack, one tank gets you onto its roof (four routes, with
  0.00 to 0.07 of the tank left).

### Places only a jetpack reaches

The grapple needed a surface in range to hook. The jetpack reaches the top of anything under the
ceiling. Some of those tops may be places no enemy can walk to and no gun can see, where a player
could wait out a wave. The straggler search and `TRAPPED` assume you can be found.

- **The check:** a sweep in `tools/reach.mjs`, over the walk grid's standable cells. For each cell
  only a jetpack reaches, it asks whether a ranged enemy can stand somewhere it can see it from.
- **If some are blind spots:** they are listed in `next_2.md`. If they matter, the cheapest fix is
  a sniper nest or a spawn point with a line onto them.

### Code

- **New `src/entities/jetpack.js`**, with the same shape as `Grapple`:
  - `update(dt, input)`;
  - `fuel`, `fuelShown` and `burning`;
  - `cut()` for respawn, ladders and death.
- **`player.js`:**
  - `this.grapple` becomes `this.jet`.
  - Every `grapple.attached` branch becomes `jet.burning`:
    - the ladder (flying lets go of it);
    - the stronger air control;
    - jump-to-launch, which goes: with no rope there is nothing to launch off, so Space in the
      air is the double jump again.
  - `b.onGround = false` while the pack lifts.
- **Goes:** `entities/grapple.js`, the rope mesh, `GRAPPLE`, and the HUD reticle (`#irGrapple`
  with its spin animation in `hud.css`).
- **Also goes:** `level.anchors` and every `b.anchor(...)` call in `map_desk.js`, `pendulum.js` and
  `cradle.js`. They exist only for the grapple.
  - The comments in `map_desk.js` that say "not grapple-only" stay true, and are reworded.
  - `reach.mjs` already proves every place can be reached without it. Its "NOT without the
    grapple" line becomes "NOT without the jetpack".
- **The HUD:** the existing stamina bar becomes the fuel gauge (`#irFuel`, `hud.setFuel(fuel)`). It
  turns red under a quarter of a tank, half a second of burn, as the stamina bar did: a warning
  before the pack cuts out. `tools/lib/redblobs.mjs` already allows red there.
- **What you see:** while burning, a stream of small ink puffs from `fx/effects.js`'s particle
  pool, from two nozzles on your back. It costs no new draw calls, as it uses the pool there is.
  Friends see them. In first person they are behind and below you and fall away as you climb, so
  they do not show: there, the cues are the fuel gauge under the crosshair and the hiss.
- **What you hear:** a hiss made of short filtered `noise()` bursts, one every ~0.1 s while it
  burns, the way footsteps are made. The bot's recorder logs only `noise()` and `tone()` calls
  (`tools/bot/driver.js`), each with its own length, so a hiss held on one long-running node
  would be missing from the recordings. Made of bursts, it is recorded with no change to the bot.
- **Text:**
  - the touch button: LINE becomes JET (`ui/touch.js`);
  - the how-to lines in `ui/screens.js`;
  - the opening tip (`game.js`): "hold Q to fly; it refuels when you stop";
  - `README.md`'s controls.
- **Test hooks:** `window.__ink` reports `jet: { burning, fuel }` in place of `grapple`.

### In co-op

- **The burn flag** goes in each player's presence bits. A friend's figure shows the same ink
  puffs, from the shared particle pool, and their hiss is skipped, as the others' sounds are now.

### Tools that change with it

- **`tools/feel.mjs`:** the two grapple sections become jetpack checks:
  - holding lifts you off the floor;
  - fuel drains while burning;
  - an empty tank cuts out and you fall;
  - fuel refills after the wait and not before;
  - you can't ignite under `minIgnite`;
  - the ceiling (above).
- **`tools/play.mjs`:** the grapple beat becomes a jetpack beat: up onto a tower top.
- **`tools/reach.mjs`:** the wording, and the blind-spot sweep (above).
- **The bot:** `sense.js` reports `jet` in place of `grapple`, so it keeps running. The bot never
  used the grapple (`brain.js` holds it at `false`), so teaching it to fly would be new behaviour
  the prompt did not ask for. It is left out of this plan.
- **`tools/touch.mjs`:** the "HOOK" item in its checklist for checking by hand becomes "JET".
- `tools/cut.mjs` does not mention the grapple, and is untouched.

## Order of work, and what is reported

1. The empty box. Then the version. Then the links. Each is small, and each gets screenshots.
2. **A baseline:** `npm run perf` and `npm run game` on the tree as it is then, so the end can be
   compared with it.
3. **Co-op:**
   - the three-way apply of the fork, and the merge of `manager.js`;
   - `npm install @p3p2/client`, and the version in place of `__BUILD__`;
   - itr 1's rules on the host only, and no hits after death;
   - the p3p2.me link;
   - `tools/coop.mjs` and its cases, against a local p3p2 server.
4. **The jetpack:** tuned against `feel.mjs` and the ceiling check, then the blind-spot sweep, then
   its flag in co-op and its case in `coop.mjs`.
5. **The game's own tools,** against the final build: `npm run game`, `feel`, `reach`, `touch`,
   `toys`, `perf`, `distcheck` and `render`, and an unrecorded bot run.
6. **Documentation:**
   - `ai/summary.md`: a `net/` row in the map, the jetpack, the version, the links;
   - `README.md`: controls, and how to play with friends;
   - `ai/next_2.md`, with the test results as they come out, failures included.

## Judgement calls (yours to change)

- **The version** shows during play as well, faint in the bottom-left corner, as well as on the
  screens and the splash.
- **The links** show on the title screen as well as the splash and the pause screen.
- **Jump-to-launch** goes with the grapple.
- **The jetpack refuels in the air** when it isn't burning, not only on the ground.
- **The bot** does not learn to fly.
- **Co-op** keeps all of the fork's decisions as they were.
