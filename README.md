# Ink Raid

A first-person shooter on a desk, drawn in pen: the ink has climbed off the page.

Everything on screen is drawn from code at run time: pen lines and stipple on sketchbook paper, a
few coloured inks, and red for anything that wants you gone. Waves of ink figures come for you
across a desk of books, pens, a mug, a pencil pot, a toy train and a Newton's cradle. It runs in
the browser, on a laptop without a graphics card, or on a phone.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

A production build:

```bash
npm run build
npm run preview    # http://localhost:4173
```

## Deploy

It deploys to Cloudflare Workers as static assets (`wrangler.jsonc`): no server code, just `dist/`
served from Cloudflare's edge. `public/_headers` caches the hashed files in `dist/assets/` for a
year, so a returning player loads straight from cache.

```bash
npx wrangler login # once
npm run cf:dev     # the build, served locally by the Cloudflare runtime: http://localhost:8787
npm run deploy     # build and upload; prints the https://ink-raid.<account>.workers.dev URL
```

The bottom-left corner shows the build: `v.` and the first four characters of the commit it was
built from (`WORKERS_CI_COMMIT_SHA` on Cloudflare's own builds, `git rev-parse HEAD` otherwise). A
build from a tree with uncommitted changes still shows the last commit, and says so when it builds.

## Controls

Keyboard and mouse. The keys can't be rebound yet.

- **Getting about:** WASD (or the arrow keys) to walk, Shift to run. Space jumps, and a second
  Space in mid-air jumps again. C (or Ctrl) crouches; crouch at a run and you slide.
- **The jetpack:** hold Q (or E) to fly. It burns fuel, shown under the crosshair, and cuts out
  when the tank is empty; it refuels whenever you are not flying, in the air too.
- **Fighting:** left mouse fires and right mouse aims. R reloads, F swings a quick melee, and 1–5
  or the mouse wheel change weapon.
- **Grenades:** G throws one. Keep G down longer for a longer throw.
- **Bandages:** H wraps one, if you have one.
- **Pausing:** Esc.

A gamepad works too, and on a touch screen the controls appear on screen.

## Playing with friends

Co-op goes through [p3p2](https://p3p2.me), a small server you can run yourself
(<https://github.com/doublependu/p3p2>). Whoever has a p3p2 server makes a room for the game's URL
in its portal, opens the game, presses FRIENDS on the title screen, pastes the room URL, and sends
the invite link it gives. Everybody who opens the link is asked to join.

- PLAY starts a run for everybody in the room; whoever is on the title screen then gets JOIN.
- Each player past the first adds half a wave. The host's page runs the figures for everyone.
- Down is out until the next wave starts. The run is over when everybody is down at once.
- The desk does not stop for a pause, and there is no friendly fire.
- If the host leaves, the next player carries on with the same figures and the same wave.

Alone, the game asks no server anything: it loads p3p2's 2 KB entry and nothing more.

For a local server, run `npm run dev` in a p3p2 checkout (port 8080) and this game with
`npm run dev -- --host`. Make a room in its portal for `http://<this machine's address>:5173/`.

## Tests

The tools in `tools/` drive the game in a visible Chrome (Playwright, `channel: 'chrome'`).
Most need `npm run preview` running on port 4173. Run them one at a time: they share the port, and
the game pauses when its window loses focus.

| command | checks |
|---|---|
| `npm run render` | the renderer: outlines, stroke and stipple patterns, anchoring, inks, the held weapon, phones |
| `npm run game` | play: weapons, enemies, bosses, waves, pickups, the menu and HUD |
| `npm run feel` | movement against its numbers: speeds, jumps, slides, crouch |
| `npm run collide` | what is drawn is what you hit, stand on and shoot |
| `npm run reach` | every place on the map can be walked to, by you and by enemies |
| `npm run toys` | the pendulum and the cradle move as physics says |
| `npm run touch` | the touch controls |
| `npm run perf` | load time and frame times on a throttled desktop and phone |
| `npm run coop` | co-op in several browsers against a real p3p2 server: the same figures, hits, downs, the host leaving, a reload, a phone, frame times with friends. It starts a server from a p3p2 checkout (`P3P2_DIR`, default `~/Repos/p3p2`), or uses `P3P2_URL` and `P3P2_PASSWORD` |
| `npm run figures` | enemies stay easy to spot from 10 m to 60 m |
| `npm run shots`, then `node tools/compare.mjs gate shots/stills/*.png` | the look of the page, as numbers |
| `npm run distcheck` | the build ships the game and nothing else |

### The bot and the videos

`npm run autoplay` lets a bot play a whole run and records it. The bot plays by
a player's rules:

- it only presses keys and moves the mouse;
- it only acts on what is on screen and on the HUD;
- its reaction time and turn speed are a person's.

The game runs on a virtual clock and is photographed frame by frame, so the
video is 1080p60 with no dropped frames on any machine. The sound is rendered
offline to the same clock. Recordings go to `OUT_DIR` (default
`/run/media/p1/DRIVE2/ink-raid`).

| command | does |
|---|---|
| `npm run autoplay` | one recorded run, 1920x1080 (about an hour to record ten minutes of play) |
| `npm run autoplay -- --portrait` | the same at 1080x1920, for a Short |
| `npm run autoplay -- --fast --runs 5` | five unrecorded runs, about 5x faster than real time, to test the bot or the game |
| `npm run botreport` | the playtest numbers from every run: waves, damage by enemy, deaths, stuck spots, heap over time |
| `npm run cut -- --long <run> --short <portrait run> [--link <url>] [--text]` | the YouTube video, its chapters and thumbnail, a Short, and a clip for X, each with its post text (`--text`: only the posts, no encoding) |

## Credits

- Inspired by <https://doodleshooter.vercel.app>
  - <https://x.com/EvanMilenko>
- [three.js](https://threejs.org), MIT licence.
- [Kalam](https://fonts.google.com/specimen/Kalam) by the Indian Type Foundry, SIL Open Font
  Licence 1.1 (`public/fonts/`).
- All sound is synthesised in the browser; there are no audio files.


