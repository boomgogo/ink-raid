# Plan 2: co-op through p3p2, links and a version, a jetpack, and the empty box

Answers `prompt_2.md`. Five pieces, in the order they will be built. The small ones come first so
they are in place before the big one, and the jetpack comes before co-op so the friends' figures
can show it.

1. The empty box on the pause screen
2. The version in a corner
3. The links: fork me on GitHub, more games on Maize.Live
4. The jetpack, in place of the grapple
5. Co-op through p3p2

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

- **Where it comes from:** `vite.config.js` defines `__COMMIT__` at build time:
  1. `WORKERS_CI_COMMIT_SHA` if Cloudflare's build sets it;
  2. otherwise `git rev-parse HEAD`;
  3. `'dev'` if neither works.
- **What it reads:** `v.` and the first four characters, for example `v.2f20`, as the prompt asks.
  - `npm run deploy` builds from the working tree, so a build with uncommitted changes would
    still show the last commit. The build prints a warning when the tree is dirty, and the shown
    version is not changed.
- **Where it shows:** all four corners of the HUD are taken during play (`.ir-top-l`, `.ir-top-r`,
  `.ir-bl`, `.ir-br`). The screens' corners are free. So it shows:
  - in the bottom-left corner of the screen overlay (`#irScreen`), on the title, pause and death
    screens;
  - on the boot splash (`#boot`), as static text that `main.js` fills in.

  It is small, at about 0.6 of the HUD's type size, and faint, so it does not compete with the
  panel. It is not shown during play.
- **p3p2:** p3p2 keeps players on different builds in different rooms, and needs a version for
  that. The reference fork used `Date.now()`. This uses the full commit hash, with the build time
  added when the tree is dirty, so two local builds of different code don't share a room.

## 3. The links

Two links, in one line at the foot of the panel. The panel is drawn in pen, so they are drawn in
pen too: underlined text in the panel's ink, with no ribbon image and no added request.

- **fork me on GitHub** → `https://github.com/boomgogo/ink-raid` (the `origin` remote).
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

## 4. The jetpack, in place of the grapple

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
| `airControl` | 1.5× `MOVE.airControl` | the grapple's multiplier, kept |
| `tank` | 1 | |
| `burn` | ~0.42 /s | ~2.4 s of flight from full, the grapple's stamina budget |
| `refill` | ~0.34 /s | ~3 s from empty |
| `refillWait` | 0.5 s | the grapple's `staminaWait`, kept |
| `minIgnite` | 0.12 | the grapple's `fire()` floor, so an empty tank can't flicker |

**The ceiling.** One full tank from the floor should top the highest tower with room to spare.
From standing: a jump, then about 2.4 s of burn at up to 9 m/s, is about 15–18 m. The highest
grapple anchor on the desk is 16.5 m (`world/map_desk.js:266`).

**Two checks to settle the numbers:**

- `tools/feel.mjs`: from the floor, one tank gets you onto the highest tower top.
- The same test proves one tank does not reach out of the map. If it does, add a soft ceiling: the
  thrust fades out above a height set from the map's tallest structure.

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
- **The HUD:** the existing stamina bar (`#irStam`) becomes the fuel gauge: `hud.setFuel(fuel,
  burning)`. It turns red under `minIgnite`, the cue `tools/lib/redblobs.mjs` already knows as
  "low grapple stamina".
- **What you see:** while burning, a stream of small ink puffs from `fx/effects.js`'s particle
  pool, falling from under the camera. A little reaches the bottom of the screen in first person.
  It costs no new draw calls, as it uses the pool there is.
- **What you hear:** a filtered noise hiss in `fx/audio.js`, started and stopped with the burn, so
  the bot's offline audio render picks it up with no change.
- **Text:**
  - the touch button: LINE becomes JET (`ui/touch.js`);
  - the how-to lines in `ui/screens.js`;
  - the opening tip (`game.js:306`): "hold Q to fly; it refuels when you stop";
  - `README.md`'s controls.
- **Test hooks:** `window.__ink` reports `jet: { burning, fuel }` in place of `grapple`.

### Tools that change with it

- **`tools/feel.mjs`:** the two grapple sections become jetpack checks:
  - holding lifts you off the floor;
  - fuel drains while burning;
  - an empty tank cuts out and you fall;
  - fuel refills after the wait and not before;
  - you can't ignite under `minIgnite`;
  - the ceiling (above).
- **`tools/play.mjs`:** the grapple beat becomes a jetpack beat: up onto a tower top.
- **The bot:**
  - `sense.js` reports `jet`;
  - `brain.js` gets a simple use: burn to reach a vantage point on a nest sniper, and to get out
    when hurt and cornered. It reads the fuel gauge, as a player would.
  - The "inputs only" rule is unchanged, since it holds the same action.
- **`tools/touch.mjs`:** the JET label and hold.
- `tools/cut.mjs` mentions the grapple in text only, and that is updated.

## 5. Co-op through p3p2

### Starting point

- **The reference fork:** `~/Repos/p3p2_test_repos/ink-raid`, branch `p3p2`. It works and is
  tested by 13 browser tests in p3p2's repository.
  - It was built on itr 0 (`6cca3a9`). This repo has had itr 1 since, which changed
    `entities/enemies/manager.js` (stragglers, `TRAPPED`, `renest`) and `game.js`.
  - So the fork is **ported, not merged**:
    - `src/net/` (room, crew, horde, wire; about 1,350 lines) comes over as it is;
    - its eight hook sites in the game's own files are reapplied by hand onto the current code.
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
- The game's version for p3p2 is the commit hash (section 2).

### What changes from the fork, on top of the port

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
- **The jetpack in presence:** the burn flag goes in each player's presence bits. A friend's figure
  shows the same ink puffs, from the shared particle pool, and their hiss is skipped, as the
  others' sounds are now.
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
  `npm run perf` must still pass: 0.92 s and 227 KB now, against a 2–3 s target. The added bytes
  are measured and reported in `next_2.md`.
- **The bot:** `autoplay.mjs` runs alone. The virtual clock (`tools/bot/clock.js`) replaces timers
  and `performance.now`, which p3p2's client also uses. The client must stay idle without a room,
  and an unrecorded bot run will confirm it.
- **The build:** `npm run distcheck` passes. The client's chunks are plain JS with no
  `/* glsl */`, so the strip leaves them alone.

### Testing it

- **A local server:**
  - `~/Repos/p3p2`, `npm run dev`, on port 8080;
  - this game with `npm run dev -- --host`, on port 5173;
  - a room created in p3p2's local portal for this game's URL.

  This follows the fork's `p3p2_next.md` ("How to see it").
- **The browser tests:**
  - p3p2's `e2e/tests/games/ink-raid.spec.ts` (13 tests), run with this checkout in `GAMES_DIR`:
    `GAMES=ink-raid npm run e2e -- games/ink-raid`.
  - Where the spec names the grapple or the old screens, it is updated here, in a copy kept as
    `tools/coop.spec.ts`, and the change is offered to p3p2.
  - Plus two new cases:
    - a friend's jetpack burn is seen on the other page;
    - stragglers search toward the nearest of two players.
- **By hand:** two browsers, one of them a phone on the LAN. The phone's link to p3p2.me and the
  FRIENDS panel must fit and work by touch.
- **The game's own tools,** against the final build:
  - `npm run game`, `feel`, `reach`, `touch`, `toys`, `perf` and `distcheck`;
  - `npm run render`, since the HUD and screens changed.

## Order of work, and what is reported

1. The empty box. Then the version. Then the links. Each is small, and each gets screenshots.
2. **The jetpack.** Tuned against `feel.mjs` and the ceiling check, then the bot, then a few
   unrecorded bot runs to see how it changes how far the bot gets.
3. **Co-op:**
   - port `src/net/`;
   - reapply the hooks onto itr 1;
   - the p3p2.me link;
   - the e2e spec;
   - the two new cases.
4. **Documentation:**
   - `ai/summary.md`: a `net/` row in the map, the jetpack, the version, the links;
   - `README.md`: controls, and how to play with friends;
   - `ai/next_2.md`, with the test results as they come out, failures included.

## Judgement calls (yours to change)

- **The version** shows on the screens and the splash, not during play, because every HUD corner
  is in use. The alternative is a faint `v.xxxx` tucked under the bottom-left cluster during play.
- **The links** show on the title screen as well as the splash and the pause screen.
- **Jump-to-launch** goes with the grapple.
- **The jetpack refuels in the air** when it isn't burning, not only on the ground.
- **Co-op** keeps all of the fork's decisions as they were.
