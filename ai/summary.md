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
| `entities/` | the player, the jetpack, weapons, enemies (types, rigs, AI), pickups, paper planes |
| `net/` | co-op through p3p2: `room.js` (the room and its run), `crew.js` (the other players, and their shots, slashes and grenades), `horde.js` (the host's figures, rounds, waves and pickups, as the others see them), `wire.js` (the binary reports) |
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
- **Weapons** (`entities/weapons/models.js`): the rifle, shotgun, sniper, staple gun and katana are
  built in code, one mesh per ink and look and one per moving part. Round parts are drawn in
  `WRAP`.
  - The rifle's magazine drops out on a reload. The shotgun's pump racks after each shot, and its
    side saddle shows up to four spare shells. The sniper's bolt is worked after each shot. The
    staple gun's lever snaps down with each staple. Each model's `tick(gun)` drives its parts
    from the gun's own timers.
  - Each sight is a part named `sight` on the eye line. `npm run game` checks it lands on the
    crosshair while aiming.
  - The katana's blade is built face by face, with a real ridge crease. No `ExtrudeGeometry`: it
    pulled in three's triangulation, about 5 KB gzip.
  - The katana moves the same in your hands and in a friend's (`KATANA_MOVES`): it rests low on
    the right; it slashes from raised on the right diagonally down to the left; and its guard holds
    the blade level across the front of the body. `KATANA_MOVES` says where the blade points.
    `KATANA_HANDS` (`weapons/index.js`) says where your hands are, and `BLADE_HANDS` (`rig.js`) a
    figure's, which reaches both arms to the hilt. The slash turns the blade nearly square to the way
    the holder faces. A slash in the plane of straight ahead is what a real sword does, but from your
    own eye the blade then points down the line of sight and only the hilt is seen going by.
- **Grenades** (`GRENADE`, `entities/weapons/grenade.js`):
  - A full throw lands about 12 m out thrown level, 30 m at the best angle. The table beside
    `GRENADE.throw` gives the landing distances.
  - Thrown, a grenade is a green body with black fittings, and tumbles as it flies.
  - The blast (`BLAST` and `blast()` in `fx/effects.js`) is, in order:
    - a flash;
    - a ring out to the blast radius;
    - smoke that swells, rises and shrinks away;
    - two bursts of strokes;
    - a splat-shaped scorch, on the surface under the grenade.
  - All of it is pooled and instanced, and hidden when no blast is on. The camera's kick fades out
    by 20 m.
- **The jetpack** (`entities/jetpack.js`, `JET`) replaced the grapple, on the same keys. Hold to fly;
  the thrust is throttled to a 9 m/s climb, and a tank lasts 2.1 s: about 17 m up from standing, a
  metre over the highest place. It refuels whenever it is not burning, in the air too.
- **Co-op** through a p3p2 server (`net/`, `@p3p2/client` 0.2, from the fork at
  `~/Repos/p3p2_test_repos/ink-raid`):
  - everybody comes into a room through its invite link, the server's owner too: there is no room
    URL to paste since p3p2 0.2;
  - p3p2's own 👥 button sits in its corner (top right) on the title, pause and death screens, and
    is hidden while a run is played, when every corner is the HUD's (`ir-playing` on `<html>`,
    set by `ui/screens.js`). Behind a screen nothing of the run is drawn, the pause screen
    included, nor the thumb buttons, which a screen covers anyway;
  - PLAY WITH FRIENDS on the title opens the same panel. The panel itself says where to get a room
    (p3p2.me);
  - the run is the room's: PLAY starts it for everybody, the others get JOIN;
  - everybody starts in a row 2 m apart (`startPoints`, `world/map_desk.js`), taking a place by
    the order of joining (`Net.slot()`, p3p2's `member.order`). That place is used at the start of
    a run, at each wave when coming back from down, and after a fall off the edge. Alone, a player
    starts on the start itself;
  - each player past the first adds half a wave (`CREW` in `core/waves.js`);
  - down is out until the next wave; the run is over when everybody here is down at once;
  - the host's page runs the figures, the waves, the planes and the pickups; the others draw them
    140 ms in the past and send the host their hits;
  - when the host leaves, the next player takes the figures over;
  - a friend is drawn with the weapon in their hands, aimed where they look (`w` and `pt` in what
    each page sends). It is the very model you hold (`buildProp`, `models.js`), merged, scaled to
    the figure and in its own inks, and its tracers leave from that model's muzzle;
  - a friend's katana guard goes out as `g` in presence, held up at least 300 ms
    (`GUARD_SHOWN_MS`), so that a parry, a tap of aim, is not lost between two reports;
  - their shots, slashes and grenades go to the others as `pf` (`net/crew.js`), and are drawn as
    late as the figure is: tracers from the drawn gun, blots on the desk, red splashes on figures.
    It is for show only, since hits still go to the host as `hit`. Their shots and blasts are heard
    within 60 m. Their steps are heard within 20 m and their jet's hiss within 40 m, from the
    three and two nearest of them (`HEARD_MOVING`);
  - a friend is drawn with no coasting (`Smooth`, `coast: 0`). A page stops sending once its
    player stands still, and coasting carried a landing on through the floor. The host's figures
    and planes coast 250 ms over a late report (`COAST` in `net/horde.js`), as p3p2 0.1 did by
    default;
  - alone, the page loads p3p2's 2 KB entry and asks no server anything.
- **Touch** (`ui/touch.js`):
  - INK sits in the bottom-right corner, with DUCK, UP, JET and BLAST on an arc round it;
  - only the two INKs fire. The look pad only looks: a quick tap on it was once a shot;
  - LOAD, NEXT, WRAP and PAUSE are a row of small buttons along the top right, and the wave
    readout moves down under them:
    - PAUSE keeps its place when WRAP is away, and presses the same `pause` action as Esc;
    - upright, the boss bar moves under the row; on its side, it narrows to stop short of it;
  - a button's action is held until a whole frame has seen it, so a tap shorter than a frame
    still counts;
  - a second INK at the top left only holds the trigger, so the left thumb fires while the right
    thumb aims;
  - the game pauses when the page is hidden (`visibilitychange`, `game.js`), on every device;
  - `pause()` lets go of every finger (`touch.clear()`), so one down as the page went away does
    not walk on afterwards;
  - `npm run touch` checks:
    - the layout on four phones, upright and on their side, with a boss's bar up;
    - that p3p2's button is clear of everything on the title and pause screens, and gone in a
      run;
    - PAUSE by a real tap;
    - that a tap on the look pad does not fire.
- **The build** shows in the bottom-left corner as `v.` and four characters of its commit
  (`vite.config.js`), on the boot splash too. p3p2's game version is 12 characters of the commit,
  plus the build time when the tree is dirty.
- **Links** to the GitHub repository and to muon.day sit on the boot splash and the title and
  pause screens.

## Tools

See the table in `README.md`. The browser tools need Chrome and `npm run preview` on port 4173,
and must run one at a time. `tools/coop.mjs` (`npm run coop`) also needs a p3p2 checkout at
v0.2.0 or later, at `~/Repos/p3p2` (or `P3P2_DIR`), whose server it starts. On the development
machine that is `/run/media/p1/DRIVE2/p1/Repos/p3p2`; it drives five or six Chrome windows into
one room. `compare.mjs` holds the style contract (paper, ink, dot grid, ink load)
and the figure-legibility band. Both are measured from this build.

## The bot and the recordings

`tools/autoplay.mjs` lets a bot play whole runs, unrecorded for testing or recorded for video.
`tools/cut.mjs` turns the recordings into a YouTube video, a Short and a clip for X, and writes the text to post with each.
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
- **Figures face −z.**
  - `pose()` (`entities/enemies/rig.js`) lays the gun along the facing, tipped by `pitch`,
    whatever the arms are doing.
  - Until plan 3 the aim and the lean were written for a figure facing +z: every gun was held
    behind its figure's back, pointing at the floor.
  - `npm run collide` checks that every gun points where its figure aims, and that every hit
    volume stays inside its bound in every pose.

## Tuning

**Where the numbers live:**

| what | where |
|---|---|
| weapons | `entities/weapons/index.js` `GUNS`, grouped by concern, with the katana's guard in `GUARD` |
| grenades | `GRENADE` |
| a grenade's blast, as drawn | `fx/effects.js` `BLAST` |
| enemy hit volumes | `entities/enemies/rig.js` `HIT_LIMB`, `HIT_END` |
| the start row | `world/map_desk.js` `ROW` |
| a friend's steps and hiss | `net/crew.js` `HEARD_MOVING` |
| enemies | `entities/enemies/types.js` `TYPES` |
| which enemy types come in which wave | `DEBUT`, `WEIGHT_CURVE` |
| wave modifiers | `MODIFIERS` |
| player movement | `entities/player.js` `MOVE`, `MANTLE`, `LADDER` |
| the jetpack | `entities/jetpack.js` `JET` |
| co-op wave size | `core/waves.js` `CREW` |
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
  - When no nest can see anyone, twice running (16 s apart), the sniper comes down (`comeDown`).
    It goes to open ground out of everybody's sight, as near the nearest player as
    `TRAPPED.away` (18 m) allows, and searches on foot like any straggler (`e.afoot`). Once it
    sees you it stands and shoots. From the worst spot on the desk it took about 50 s to walk to
    the player, by way of one `trapped()` redraw.
  - `rooted(e)` stands in for every check of `stationary`.
  - `npm run game` stages the scene the bot stalled in during plan 3, and checks the sniper is
    found.
- **Trapped** (`TRAPPED`): an enemy trying to move but not a metre further on in 10 s is redrawn
  somewhere open, out of sight. One was found wedged under the big pencil, where it could not be
  seen or shot.
- **After death**, rounds and blades no longer land on the player.
- **In co-op** these run on the host's page only, for every player: "unfound" is unfound by all of
  them, a straggler goes looking for the nearest, a nest sniper moves to a nest that sees anyone,
  and a trapped figure is redrawn out of everybody's sight. A player who is down is nobody's
  target, and no round is judged on their page.

## Known issues and next steps

- **Seams:** where the slice family changes on curved surfaces, lines meet in soft chevrons.
- **Ink load:** one establishing shot (ring0) sits above the ink-load band. It is a close-up of a
  big wall.
- **Hit volumes, a little generous on purpose:** a limb's capsule is 0.94 of its drawn corner
  radius (`HIT_LIMB`), and a forearm's and a shin's stop 0.4 of a radius short of the hand or
  foot (`HIT_END`, `entities/enemies/rig.js`).
  - In plan 6 the shots registering beside the drawing went from 2984 to 2238, a quarter fewer.
    None are missed where the figure is drawn.
  - `npm run collide` says where those shots land, by part and by distance. About 70% are within
    3.3 cm of the triangles, which is on the drawn outline.
  - Medium's `aimMargin` (1.08) still widens every volume, and easy's (1.35) more.
- **Untested by people:** the tuning was re-derived from targets. The bot's runs are the only
  playtest so far.
- **Fill rate:**
  - At 1920x1080 the frame costs about 31 ms of GPU time on an HD 630 (2017) whatever is on screen,
    so about 32 fps.
  - `npm run perf` measures 1280x800.
  - A newer integrated GPU is two to three times faster.
- **Off-screen damage:** about 40% of the bot's hits came from enemies not on screen.
- **Desktop frame budget:** `npm run perf`'s worst 1% of desktop frames is close to its 33 ms
  limit.
  - It sat on the limit from itr 1 to plan 2, at 34.1 ms before plan 2.
  - In plan 3 it measured 26.5 ms, and 24.6 ms for the build before it, in three runs each
    alternating. That points to the machine's state, not the code.
- **Co-op by hand:** the phone over the LAN has only been tried through `tools/coop.mjs`'s phone
  profile, not on a real phone.
- **The legibility band** (`FIGURE_TOL`, `tools/compare.mjs`) was re-derived in plan 6.
  - The figures now hold their arms out at rest, where they used to cross them over the chest.
  - `figures.mjs`'s lineup now faces the camera.
  - Fill is ink over the figure's box, and the arms widen the box. So the median fell from 0.63
    to 0.39 while every figure is still found at every distance.
  - `figures.mjs` prints the percentiles the band is made from.
- **Jetpack-only tops:** `npm run reach` lists them and checks a gun can see each one (all can, as
  of plan 2). A new tall thing on the desk should be checked the same way.
