# Ink Raid: where the project stands

A browser first-person shooter drawn as pen on paper, in three.js r170 with Vite and plain
JavaScript. This file is the starting point for anyone, human or model, picking the project up. See
`README.md` for running it and the controls.

## Targets

From `CLAUDE.md`:

- **Load:** interactive in 2–3 s on an average connection; 1 s would be great; 4 s at most.
- **Hardware:** play well on a three-year-old PC without a dedicated GPU, and on an entry-level
  phone.

`npm run perf` measures both:

- time to interaction under a 10 Mbps, 40 ms network;
- frame times with the CPU throttled 4× (desktop) and 6× (phone).

## Map of `src/`

| folder | what's in it |
|---|---|
| `render/` | the renderer (below) |
| `world/` | the desk: `build.js` (geometry and colliders), `map_desk.js` (the level), `movers.js` (things that move and carry you), the train, the pendulum and cradle, the sky, the title-screen flight, a calibration scene |
| `core/` | physics and collision, input, waves, difficulty, springs |
| `entities/` | the player, the grapple, weapons, enemies (types, rigs, AI), pickups, paper planes |
| `fx/` | particles, tracers and decals; synthesised audio |
| `ui/` | the HUD, the touch controls, hand-drawn buttons |

## Rendering

Three passes each frame (`render/pipeline.js`):

1. **World.** Every surface is drawn once into an RGBA8 target and a depth texture. It writes how
   much ink its pattern puts on the pixel, its tone, and its ink and look (`render/surface.js`).
   - **The pattern** is anchored to what it's drawn on: world space for the static desk, and the
     body's own frame for anything that moves.
   - **Half-tones** are "slice lines": the surface crossed by evenly spaced parallel planes.
   - **Shadowed sides** are stippled.
   - Spacing steps in octaves with distance, so marks keep their size on screen.
2. **Held weapon.** It's drawn into its own share of the depth range, so it never clips into a
   wall.
3. **Page.** One full-screen pass (`render/page.js`) makes the picture:
   - outlines from the Laplacian of inverse depth: silhouettes bold, convex creases medium, concave
     creases thin and broken;
   - the paper and its dot grid;
   - the distance fade;
   - the screen effects for hurt, low health, death and hitstop.

**Looks:** `LINE`, `SOLID`, `WASH`, `WRAP` and `MASS` (`render/palette.js`). They say how a
surface is drawn, apart from which ink draws it.

**Debug:** `?view=edges|tone|pattern|ink|depth` shows one layer, and `?graph=1` swaps in graph
paper.

## Play

- **Waves:** you fight waves of red ink figures across the desk, with a boss every few waves.
- **Types and bosses:** they are listed in `entities/enemies/types.js`.
- **Difficulty:** PLAY or EASY (`core/difficulty.js`).
- **Pickups:** bandages heal. Shooting down a paper plane drops a bandage or a staple gun.

## Tools

See the table in `README.md`. The browser tools need Chrome and `npm run preview` on port 4173,
and must run one at a time. `compare.mjs` holds the style contract (paper, ink, dot grid, ink load)
and the figure-legibility band. Both are measured from this build.

## The bot and the recordings

`tools/autoplay.mjs` lets a bot play whole runs, unrecorded for testing or recorded for video.
`tools/cut.mjs` turns the recordings into a YouTube video, a Short and a clip for X.
`tools/bot/report.mjs` sums the runs up as playtest numbers.

- **The clock:** `tools/bot/clock.js` replaces `performance.now`, `requestAnimationFrame`, the
  timers and the HUD's CSS animations with a virtual clock. The tool steps it one 1/60 s frame at a
  time and screenshots each frame over CDP.
  - Real-time tab capture topped out near 30 fps at 1080p on the development machine.
  - The virtual clock gives exact 60 fps on any machine, at about 95 ms per frame.
- **The sound:** every `noise()`/`tone()` call in `fx/audio.js` is logged against the virtual
  clock, then rendered offline into an `OfflineAudioContext`.
- **The bot plays by a player's rules:**
  - `sense.js` copies what is on screen and on the HUD into a plain snapshot.
  - `brain.js` decides from that snapshot alone. `autoplay.mjs` refuses to run if `brain.js`
    names the game or the page.
  - `driver.js` writes keys, the trigger and mouse counts, nothing else.
  - It has human limits: 180–260 ms reaction, a spring-damped hand with a top speed, and a fire
    tolerance of about the target's size.
  - It knows the map the way a player learns it: a 0.5 m walk grid built from the real level
    (`navgrid.mjs`, the same column test as `reach.mjs`) and where the sniper nests are.
- **Output:** recordings go to `/run/media/p1/DRIVE2/ink-raid` (`OUT_DIR`), one folder per run
  with `events.jsonl`. `tools/bot/stage.mjs` sets up a scene for reproducing what a run's log
  shows.

## Conventions

- **Units:** metres and seconds.
- **Colour:** the scene declares ink indices, never colours; the page pass looks them up.
- **Shaders:** GLSL lives in template literals tagged `/* glsl */`. The build strips their
  comments, and `npm run distcheck` checks that it did.
- **Test hooks:** `window.__ink` exposes hooks for the tools: poses, teleports, the game object and
  stats.

## Tuning

**Where the numbers live:**

| what | where |
|---|---|
| weapons | `entities/weapons/index.js` `GUNS`, grouped by concern, with the katana's guard in `GUARD` |
| grenades | `GRENADE` |
| enemies | `entities/enemies/types.js` `TYPES` |
| which enemy types come in which wave | `DEBUT`, `WEIGHT_CURVE` |
| wave modifiers | `MODIFIERS` |
| player movement | `entities/player.js` `MOVE`, `MANTLE`, `LADDER` |
| body size | `core/physics.js` `PLAYER_BODY` |
| difficulty | `core/difficulty.js` |

**How to read them:** every number carries a one-line derivation from its design target. For
example: hits to kill, magazine time, apex height, settle time.

**Tests pin some values exactly:**

- `tools/feel.mjs`, `reach.mjs` and `game.mjs` pin a few of them;
- the comment beside a pinned value says so;
- change a pinned value only together with its test.

**Springs** (`core/spring.js`) are solved exactly each frame, so how they settle does not depend
on the frame rate.

## Enemies that cannot be found or reached

Found by the bot's runs (see `ai/next_1.md`), all in `entities/enemies/manager.js`:

- **Stragglers** (`AWARE.straggle`): the last two, unfound for 35 s, are sent to search where you
  are, every 8 s. A straggler blocked by a wall tries another way in.
- **Nest snipers** that cannot see you from their nest are redrawn on a free nest that can
  (`renest`). The mug's nest only sees over the rim.
- **Trapped** (`TRAPPED`): an enemy trying to move but not a metre further on in 10 s is redrawn
  somewhere open, out of sight. One was found wedged under the big pencil, where it could not be
  seen or shot.
- **After death**, rounds and blades no longer land on the player.

## Known issues and next steps

- **Seams:** where the slice family changes on curved surfaces, lines meet in soft chevrons.
- **Ink load:** one establishing shot (ring0) sits above the ink-load band. It is a close-up of a
  big wall.
- **Generous hit volumes:** enemy limbs are drawn thinner than their hit volumes.
  - `tools/collide.mjs`'s report counts many shots just beside a figure as hits.
  - None are missed where the figure is drawn.
  - Narrowing the capsules in `entities/enemies/rig.js` would tighten it.
- **Untested by people:** the tuning was re-derived from targets. The bot's runs are the only
  playtest so far.
- **Fill rate:**
  - At 1920x1080 the frame costs about 31 ms of GPU time on an HD 630 (2017) whatever is on screen,
    so about 32 fps.
  - `npm run perf` measures 1280x800.
  - A newer integrated GPU is two to three times faster.
- **Off-screen damage:** about 40% of the bot's hits came from enemies not on screen.
