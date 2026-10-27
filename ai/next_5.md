# Next 5: what plan 5 built, and what comes next

Plan 5 is built, and every tool it touches has been run against the final build. One thing differs
from the plan: behind a screen, the run's HUD and the thumb buttons are no longer drawn (below).

## Done

### `@p3p2/client` 0.2.0

- `package.json` asks for `^0.2.0`, and the lockfile has 0.2.0.
- **Coasting:** `net/horde.js` gives its three `Smooth`s `coast: COAST` (250 ms), which was 0.1's
  default. 0.2's default is none, so without this a guest's figures and planes would have frozen
  on a late report instead of carrying on. `net/crew.js` keeps its explicit `coast: 0`.
- **Unchanged:** nothing that 0.2 removed (`p3p2.host()`, `isMod`, `kick`, `end`, the `room-url`
  and `room` error codes) was used here.
- `net/room.js`: two comments now match 0.2. `enter()`'s branch "a run alone, opened to friends"
  is now only reached by a reload whose `start()` lands after PLAY. It stays.
- **Sizes, from the build:**
  - the entry is still about 2 KB;
  - `p3p2-panel` is 6.1 KB gzip, and is still fetched only when the panel is opened;
  - `npm run perf`: 0.95 s to interaction, 244 KB.

### p3p2's own button

- `main.js`: `ui: { chatKey: false }`. The 👥 button is back, in p3p2's default corner (top right).
- **Hidden while a run is played:**
  - `Screens.hide()` sets `ir-playing` on `<html>`, and `Screens._show()` clears it;
  - `hud.css` hides `p3p2-panel` under `ir-playing`;
  - only a screen going away sets the class, so the panel's *Join?*, shown as the page loads from
    an invite, is never hidden.
- **Not in the plan: nothing of the run behind a screen.**
  - `html:not(.ir-playing) :is(#irRun, .touch) { visibility: hidden }`.
  - The title and death screens already hid the HUD (`setGameVisible(false)`), but the pause
    screen did not.
  - The thumb buttons showed through all three screens, though a screen (z-index 5) takes every
    touch.
  - **Why:** with them drawn, the button sat on something in every corner on the pause screen:
    - the wave readout on a desktop;
    - LOAD on a phone, and on a phone's title screen too.
  - **Tried first:** moving the button to the top centre with CSS. That still covered WRAP on a
    360 px phone held upright (the row is 162 px wide from the right edge), and the boss bar
    behind the pause sheet in a boss wave.
  - **Now:** the paused desk shows through the sheet with no HUD, as the title and death screens
    did already. The pause sheet already gives the difficulty, score and wave.
- **PLAY WITH FRIENDS** is on the title only. It opens the same panel (`p3p2.open()`). In a room it
  reads `PLAY WITH FRIENDS · 3 here`. The pause and death screens have the corner button instead.
- The p3p2.me line under the button (`.ir-p3p2`) is gone. 0.2's panel says it itself: "No server
  yet? p3p2.me says how to get one."

### muon.day

- "more games on muon.day" → `https://muon.day`, on the boot splash (`index.html`) and on the
  title and pause screens (`LINKS`, `ui/screens.js`).

### Tools and docs

- **`tools/coop.mjs`**, for 0.2:
  - `makeRoom` logs in at `/login`, creates the room, and returns the room page's invite link;
  - Ann comes in through that link like everyone else, and is the host as the first one in;
  - **new:** alone, p3p2's button is on the title and opens its panel ("…open the invite link…"),
    with the room code still unfetched until then;
  - **new:** on a phone, the button is hidden in a run; on the pause screen it is back and opens
    the panel, and PLAY WITH FRIENDS isn't there.
- **`tools/touch.mjs`**, on four phones, upright and on its side: the button is on the screen and
  clear of every control, readout and thumb button on the title and pause screens, and not drawn
  in a run. It saves `shots/stills/touch-<w>x<h>-pause.png`.
- **The p3p2 checkout** at `/run/media/p1/DRIVE2/p1/Repos/p3p2` is at `v0.2.0-1` (`main`, pulled,
  `npm install` done). `npm run coop` needs `P3P2_DIR` set to it, because `~/Repos/p3p2` doesn't
  exist on this machine.
- `README.md` and `ai/summary.md`:
  - the 0.2 way into a room (create it in the portal, then **Open** or send the invite link);
  - where the button is;
  - the links line;
  - the tools.

## Results

| tool | result |
|---|---|
| `npm run build`, `npm run distcheck` | pass |
| `npm run touch` | 51/51 (12 new checks for the button) |
| `npm run game` | 85/85 |
| `npm run perf` | 7/7: 0.95 s to interaction; desktop p99 31.5 ms (max 33), still close to its limit as before |
| `P3P2_DIR=… npm run coop` against a p3p2 0.2.0 server | 36/36 (2 new checks) |

## What comes next

- **A look by hand**, on a real phone and a desktop:
  - **the pause screen without the HUD:** if health and ammo are missed there, the other way is to
    keep the HUD and move only what is under the corner button;
  - **the button over a notch:** p3p2 puts it 12 px from the corner with no safe-area inset, so on
    a phone held on its side it may sit under the notch.
- **A mixed room:** a 0.2 server takes 0.1 pages, but players on builds before and after this one
  are kept apart by `__BUILD__` anyway, so this only matters for p3p2 itself.
- **Still open from `ai/summary.md`:**
  - a nest sniper that is the last figure, when no nest can see anyone;
  - the idle arms crossed over the chest;
  - the generous hit volumes;
  - fill rate at 1080p on an older integrated GPU.
