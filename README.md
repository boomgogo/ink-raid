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

## Credits

- Inspired by <https://doodleshooter.vercel.app>
  - <https://x.com/EvanMilenko>
- [three.js](https://threejs.org), MIT licence.
- [Kalam](https://fonts.google.com/specimen/Kalam) by the Indian Type Foundry, SIL Open Font
  Licence 1.1 (`public/fonts/`).
- All sound is synthesised in the browser; there are no audio files.


