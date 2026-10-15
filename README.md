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

## Controls

Keyboard and mouse. The keys can't be rebound yet.

- **Getting about:** WASD (or the arrow keys) to walk, Shift to run. Space jumps, and a second
  Space in mid-air jumps again. C (or Ctrl) crouches; crouch at a run and you slide.
- **The hook:** Q (or E) fires it at anything drawn in range, and reels you in while held.
- **Fighting:** left mouse fires and right mouse aims. R reloads, F swings a quick melee, and 1–5
  or the mouse wheel change weapon.
- **Grenades:** G throws one. Keep G down longer for a longer throw.
- **Bandages:** H wraps one, if you have one.
- **Pausing:** Esc.

A gamepad works too, and on a touch screen the controls appear on screen.

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
| `npm run cut -- --long <run> --short <portrait run>` | the YouTube video, its chapters and thumbnail, a Short, and a clip for X |

## Credits

- Inspired by <https://doodleshooter.vercel.app>
  - <https://x.com/EvanMilenko>
- [three.js](https://threejs.org), MIT licence.
- [Kalam](https://fonts.google.com/specimen/Kalam) by the Indian Type Foundry, SIL Open Font
  Licence 1.1 (`public/fonts/`).
- All sound is synthesised in the browser; there are no audio files.


