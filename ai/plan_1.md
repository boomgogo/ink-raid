# Plan 1: an autoplay bot, three gameplay videos, and the fixes they turn up

Answers `prompt_1.md`. `tools/play.mjs` today walks a fixed 20 s movement script with no enemies
and records it with Playwright's `recordVideo`. That gives 1280×800 VP8 at a low bitrate, drops
frames, and has no sound. This plan turns it into a bot that plays a full run the way a person
would. Every run is recorded at broadcast quality with the game's audio. Three edits are cut from
the recordings, and what the bot runs into becomes the list of bugs and tuning to fix.

Everything recorded or rendered goes under `/run/media/p1/DRIVE2/ink-raid/` (916 GB disk, 839 GB
free). Only code goes in the repo.

## 1. Ground rules for the bot ("play as a human")

The score only means something if the bot could have been a person at the keyboard. So it follows
these rules:

- **Inputs only.** It writes `input.state[action]`, `input.fire`/`input.aim`, and look deltas
  through `input.mouse.dx/dy` (the same path a real mouse takes, `core/input.js:142`). It never
  calls `teleport`, `face`, `setDifficulty` mid-run, or writes `hp`, `score`, `mag` or enemy state.
  The current `play.mjs` and the `_aim` loop in `game.mjs` set `player.yaw` directly; the bot
  won't.
- **Sees what a player sees.**
  - It only targets enemies that are inside the camera frustum and have line of sight
    (`raycastLevel`).
  - Off-screen threats come from cues a player also gets: the hurt direction, enemy shots in the
    air, and the HUD's remaining count. It turns toward those.
- **Human limits.**
  - Reaction delay of 180–260 ms before it acquires a new target.
  - The turn rate is capped, and aim follows a critically damped spring (`core/spring.js`) with a
    small overshoot and jitter, so the crosshair moves like a hand.
  - Accuracy falls off with range and with the target's speed.
- **Difficulty.** `PLAY` (medium), chosen from the title screen with a real click, same as a
  player.
- **Self-check.** At the end of a run the tool diffs a snapshot of the guarded fields against what
  inputs alone could explain. Any write the bot wasn't allowed to make fails the run loudly.

## 2. The bot (`tools/bot/`)

Node drives the browser with Playwright. The brain is injected with `page.addInitScript`, so it
never ships in `dist/` and `npm run distcheck` stays green. It runs inside the page on its own
`requestAnimationFrame` tick, so its reaction time is real and not dominated by a Playwright
round trip.

- **`brain.js`.** A small utility-AI loop, about 30 Hz. It scores each action and does the best
  one:
  - **Engage.** Pick the target by threat: who is winding up, distance, type (from
    `entities/enemies/types.js`), and the boss first. Choose the weapon by range: shotgun under
    8 m, rifle in the middle, sniper past 30 m on stationary types, katana for dash-slash and
    parrying rounds when they're close.
  - **Stay alive.**
    - Strafe across the line of fire, and jump or slide while engaged.
    - Back off to cover when HP is under 40%.
    - Bandage (H) when nothing has line of sight. Reload when it's safe, not at a fixed mag count.
  - **Collect.** Bandages and staple guns, and shooting paper planes when they're clear.
  - **Grenades.** Thrown at a cluster of three or more, or at a boss's escort.
  - **Movement.**
    - Local steering with raycast feelers around the obstacles on the desk.
    - Mantle and ladder use through the normal inputs.
    - The grapple to get away from danger or reach high ground. Anchors come from what's drawn in
      range, the same rule as the player's Q.
    - **Unstuck:** if it hasn't moved in 1.5 s, jump, then turn and dash.
  - **Waves.** During the breather, walk to the centre of open ground. That's derived the same
    way `main.js` derives the camera poses, so nothing is hand-typed.
- **`events`.** The brain logs to a buffer, and Node drains it to `events.jsonl` with a
  timestamp on the video clock. The events are kill (type, weapon, crit, combo), multi-kill, wave
  start and clear (with the modifier), boss spawn and kill, damage taken (source type), heal,
  pickup, grapple, near-death, death (cause), stuck, page error, and fps every second.
- **`tools/play.mjs`** stays the movement reel. It gains `--bot` to run the bot instead, so
  `npm run play` still does what the README says. New scripts:
  - `npm run autoplay`: one recorded run.
  - `npm run autoplay -- --runs N`: keep the best of N.
  - `npm run autoplay -- --portrait`: record in portrait.

## 3. Recording at quality, with sound

The HUD is DOM over the canvas, so capturing only the canvas would lose it. The desktop is
Wayland, so ffmpeg `x11grab` can't reliably see the window either. The plan is tab capture
inside Chrome:

- **Chrome flags:** `--auto-accept-this-tab-capture`, `--autoplay-policy=no-user-gesture-required`
  and `--hide-scrollbars`. Drop `--mute-audio`.
- **Capture call:** `getDisplayMedia({ preferCurrentTab: true, audio: true,
  suppressLocalAudioPlayback: true })`, then `MediaRecorder` with VP9 at about 16 Mbps, 60 fps.
- **Getting the data out:** 1 s chunks go to Node through `page.exposeBinding` and are appended to
  `raw.webm` on DRIVE2 as they arrive. Memory stays flat over a 15-minute run, and a crash keeps
  everything recorded up to that point.
- **Window size:**
  - Landscape is a 1920×1080 viewport with `deviceScaleFactor` 1.
  - Portrait is 1080×1920 (the phone HUD layout, played with keyboard and mouse inputs).
  - The window must keep focus, because losing it pauses the game. The tool asserts
    `document.hasFocus()` every second and logs any pause as an event.
- **The GPU:** let Chrome use the Intel HD 630, not the GTX 1050. The spec's target is a PC
  without a dedicated GPU, so the footage shows the game as those players see it. The fps events
  are a free soak test of that.
- **Fallback** if tab capture misbehaves: `recordVideo` at 1920×1080 for the picture, plus a
  `MediaStreamAudioDestinationNode` tapped off `Audio.master` and recorded separately, then
  muxed. Muxing needs a small hook in `fx/audio.js`: an optional `tap()` that adds the destination
  node, at zero cost when nobody calls it.

## 4. Getting a long, high-scoring run

- Play several runs (`--runs 5` or so, about 10–20 minutes each). Keep the one with the highest
  wave reached, then the highest score. All the raw runs stay on DRIVE2.
- The YouTube video has to be one continuous run longer than 5 minutes. If the best run dies
  before 5 minutes, that means the bot (or the game) needs tuning, not a montage. Fix the bot's
  survival behaviour first.
- The bot must not be weakened to fit a length, and the game must not be softened to flatter the
  bot. Any game change comes through section 6.

## 5. The three edits (`tools/cut.mjs`, ffmpeg)

`cut.mjs` reads `events.jsonl` and scores 1-second windows:

- kills × combo;
- multi-kills, boss kill, near-death survival and grapple escapes;
- a penalty for breathers and for being stuck.

It picks the highlights from those scores, then encodes with libx264 at `-preset slow -crf 18`
and AAC at 192 kbps, with `-movflags +faststart`. Text overlays use `drawtext` with Kalam
(`public/fonts/kalam-latin.woff2`, converted to TTF once), so the titles match the game's hand.

| output | spec | content |
|---|---|---|
| `youtube_long.mp4` | 1920×1080, 60 fps, longer than 5 min, one continuous take | The whole best run from the click on PLAY to the death screen. A 3 s title card is laid over the opening flight. It closes on the final wave and score. |
| `youtube_long.txt` | description | Chapters made from the wave and boss events, plus final stats, controls and the play link. |
| `thumbnail.png` | 1280×720 | The frame from the best-scoring window, with "WAVE N" in Kalam. |
| `short.mp4` | 1080×1920, 60 fps, 45–58 s | Taken from a separate portrait run, which looks better than cropping 16:9. A hook in the first 2 s (a multi-kill or boss), then the best windows, and a closing frame with the score. |
| `x.mp4` | 1920×1080, 60 fps, 30–45 s (X's limit is 2:20 and 512 MB) | The best windows cut from the long run, opening on action. Captions burned in, since X autoplays muted. |

### Layout on DRIVE2

```
/run/media/p1/DRIVE2/ink-raid/
  runs/<date>-<n>-<landscape|portrait>/   raw.webm, events.jsonl, summary.json, console.log
  out/                                    youtube_long.mp4, youtube_long.txt, thumbnail.png,
                                          short.mp4, x.mp4, cuts.json (which windows, why)
  tools/                                  the font converted to TTF, ffmpeg logs
```

The path is the default `OUT_DIR`. Setting `OUT_DIR` moves it, so the tools still work on a
machine without that drive.

## 6. Gameplay improvements and bug fixes

The bot's runs are the playtest that `summary.md` says is missing. After the first batch of
runs, `tools/bot/report.mjs` aggregates the `events.jsonl` files into numbers:

- time per wave, and damage taken per wave by enemy type;
- the causes of death;
- how often each weapon is used, and its kills per minute;
- where and how often anything got stuck (the bot or an enemy);
- page errors, and fps or heap over time.

The fixes come from those numbers, and each goes in with its test. These are the candidates to
check first:

- **Soak:** heap and frame time across a 15-minute run. Watch particles, decals, bullets, enemy
  marks and audio nodes for leaks. The game's run length has never been tested past a couple of
  minutes.
- **Stuck enemies or player:** places where figures or the player wedge on the desk geometry.
  Cross-check them with `npm run reach`.
- **Difficulty curve past wave 10:** whether the ramp in `core/waves.js` (`RAMP`, `perWave`,
  `crowdCap`) produces a wall or a plateau. Retune with the derivation comment updated. Pinned
  values move only with their test.
- **Hit volumes:** narrow the limb capsules in `entities/enemies/rig.js` (a known issue), checked
  with `npm run collide`.
- **Unfair deaths:** damage from off-screen enemies the player had no cue for, or spawns in sight
  despite `SPAWN`.
- **Anything the recordings show by eye:** HUD overlap at 1080p and in portrait, unreadable
  moments, a camera that films the sky.

The game changes must keep the load and hardware targets. `npm run perf` and `npm run distcheck`
are run after the fixes, along with the test suite each touched system has (`game`, `feel`,
`collide`, `reach`).

## 7. Order of work

1. **Bot brain and fairness check,** run unrecorded at 1280×800 until it survives several waves.
2. **Recorder,** tab capture with audio. Check one 2-minute clip with `ffprobe`: 60 fps, an audio
   track, and the HUD visible.
3. **First batch** of landscape runs, then `report.mjs`, then fix the bugs and tuning it shows,
   re-running the affected tests.
4. **Final runs:** landscape (best of N) and portrait.
5. **`cut.mjs`,** producing the three edits, the thumbnail and the description. Watch every
   output end to end.
6. **Docs:**
   - `README.md` tools table gets `autoplay` and `cut`;
   - `ai/summary.md` gets the bot, the recording pipeline and what changed in the game;
   - `ai/next_1.md`.

## Risks

- **Tab capture:** `--auto-accept-this-tab-capture` behaviour varies by Chrome version. The
  `recordVideo` + audio-tap fallback is in place for that.
- **CPU load:** recording 1080p60 at the same time as the game on an iGPU may cost frames. Check
  fps in the events. If it dips, record at 1080p30 for the long video and keep 60 for the
  highlights.
- **A bot good enough to pass 5 minutes:** it may need real tuning time. The fairness rules stay
  fixed. What can change is the bot's tactics, not its limits.
- **Focus:** the game pauses on blur, so nothing else should take focus during a recording.
