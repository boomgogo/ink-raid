# Next 1: the bot, the recordings, and what they found

Answers `prompt_1.md`, implementing `plan_1.md`.

## What was built

- **The bot** (`tools/bot/`):
  - `sense.js` copies what is on screen and on the HUD into a snapshot.
  - `brain.js` decides from that snapshot alone. `autoplay.mjs` refuses to run if `brain.js` names
    the game or the page.
  - `driver.js` presses keys and moves the mouse, and nothing else.
  - **Human limits:**
    - 180–260 ms reaction;
    - aim on a damped spring, with overshoot and a top speed of about 630°/s;
    - it only fires when the crosshair is on the target.
  - **Map knowledge:** a 0.5 m walk grid built from the real level (`navgrid.mjs`, 51k nodes,
    ladders included) and the sniper nest positions.
  - **Tactics:**
    - the gun by range, keeping hole punches beyond their 14 m falloff;
    - strafing, sidestepping a gun's tell or a charge;
    - cover and bandages when hurt;
    - grenades into crowds;
    - planes in a lull;
    - following the pips, and finding a vantage point on a nest sniper;
    - climbing ladders.
- **Recording at 1080p60** (`autoplay.mjs`, `clock.js`): the game runs on a virtual clock and the
  tool steps and screenshots one frame at a time, so there are no dropped frames. The sound is
  logged and rendered offline to the same clock.
- **Editing** (`tools/cut.mjs`):
  - the whole run with chapters, a description and a thumbnail;
  - highlight reels for a Short and for X, picked from `events.jsonl` (kills weighted by combo,
    headshots and bosses) and captioned in Kalam.
- `report.mjs`: the playtest numbers. `stage.mjs`: reproduce a scene from a log.
- `npm run autoplay | cut | botreport`, and `npm run play -- --bot`.

## Deviation from the plan

Tab capture (the plan's first choice) delivered about 30 fps at 1080p on this machine, measured
with the frames off the track before any encoding, on either GPU. The plan's
`recordVideo` fallback has the same limit and no sound.

The virtual clock replaced both. It costs about 95 ms per frame for a single run, and 130–140 ms
each with three running at once. Ten minutes of play takes about 1.5 hours to record.

## The videos (in `/run/media/p1/DRIVE2/ink-raid/out`)

| file | what |
|---|---|
| `youtube_long.mp4` | the run with seed 1001: one take from the title screen to the death screen, about 12 min. Wave 7, 26,705 points, 61 kills, killed by THE AUTHOR, the first boss. |
| `youtube_long.txt` | description and chapters. `Play it: <link>` needs the deployed URL. |
| `thumbnail.png` | 1280x720 |
| `short.mp4` | 1080x1920, 45 s, from the portrait run (seed 3001, wave 4) |
| `x.mp4` | 1920x1080, 30–45 s, from the same run as the long video |

The raw runs are in `runs/`, one folder per run, with `run.mp4`, `sound.wav`, `events.jsonl` and
`summary.json`.

## What the runs found, and the fixes

Roughly forty unrecorded runs, then seven recorded ones.

- **Waves that would not end.** The last one or two roamed while the player searched. Wave 1 alone
  took up to 160 s.
  - **Fix:** the straggler rule (`AWARE.straggle`). With two or fewer left and no contact for
    35 s, they search toward you, again every 8 s.
  - **The first version made it worse.** It refreshed `hunt` every frame, so a hunter that could
    not reach you never went blind. One pushed at a wall below a ledge for ten minutes. Searching
    fixes it. A straggler blocked by a wall tries another way in.
- **A sketch wedged under the big pencil**, in the crook of the shaft and the cone. There it could
  see you but could not be seen or shot, so the wave never ended.
  - **Fix:** `TRAPPED`. An enemy that has been trying to move, and has gone less than a metre in
    10 s, is redrawn somewhere open, out of sight.
- **The coffee mug's sniper nest** only sees over the rim: a sniper there and the player below could
  wait each other out forever.
  - **Fix:** a straggling nest sniper that cannot see you moves to a free nest that can (`renest`).
- **Hits after death.** Rounds and blades kept landing on the death screen, each with its hurt
  flash, kick and sound. They no longer do.

`npm run game` passes 83/83 with these changes, and `npm run distcheck` passes.

`npm run perf` passes 6/7.

- **Passing:** time to interaction 0.92 s, 227 KB transferred, 56–57 fps on the throttled desktop,
  51 fps on the throttled phone.
- **Failing:** the desktop p99 frame, at 33.6–35.3 ms against a 33 ms limit.
- **Before these changes:** the same gate measured 35.7 ms on one run and 32.3 ms on the next. It
  sits on the limit either way.
- **Per-frame cost of the changes:** one distance check per enemy. Everything else runs only for
  the last two enemies of a wave.

## What the numbers say (`npm run botreport`)

- **How far the bot gets:** wave 4–5 on average, wave 9 at best (52,285 points). It mostly dies to
  hole punches.
- **Off-screen damage:** 40–50% of the hits the bot takes come from enemies that are not on screen.
  That is partly the bot: it looks where it walks. It is also worth watching with people:
  - the hurt arc is the only cue;
  - sketches fire from 28 m.
- **Fill rate:** at 1920x1080 a frame costs about 31 ms of GPU time on this HD 630 (2017), whatever
  is on screen, so about 32 fps. `npm run perf` measures 1280x800. A current integrated GPU is
  two to three times faster.
- **The heap** moves between 29 and 46 MB over the 12-minute recorded run, sampled every minute,
  with no climb. The unrecorded runs, stepped faster, read up to about 100 MB before a collection.
  The enemy list does not grow.

## Next

- **Playtest with people**, with the report's numbers to compare against. In particular:
  - the hole punch, which kills the bot most;
  - off-screen hits;
  - the straggler timing (35 s).
- **A better bot** would go further and make better long videos:
  - pre-aiming where enemies come from;
  - clearing the angles of cover;
  - the katana parry;
  - smarter grenade use.
- **Recording time:** a faster screenshot path. A headless shell with `HeadlessExperimental.beginFrame`
  could halve it.
- **Fill rate:** consider capping the pixel count at 1080p on desktops, as on phones, if 1080p on
  older integrated GPUs matters.
- **Short:** the HUD text is small at 1080 px wide. A portrait run could use the phone layout.
