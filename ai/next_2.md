# Next 2: what plan 2 built, and what comes next

Plan 2 is built, and every tool has been run against the final build. Only the check by hand on a
real phone is left.

## Done

- **The empty box** (`ui/hud.css`): `.ir-leave > span:not(.ir-quill)`. A check in `tools/game.mjs`
  measures the MAIN MENU frame on the pause and death screens.
- **The version** (`vite.config.js`): `v.` and four characters of the commit.
  - It shows on the boot splash (written into `index.html` at build time), on the screens, and
    faint in the bottom-left corner during play.
  - The build warns when the tree is dirty.
  - p3p2's version is 12 characters of the commit, plus the build time when the tree is dirty.
    p3p2 takes 32 characters at most, so the full hash failed.
- **The links:** fork me on GitHub, and more games on Maize.Live.
  - They are on the boot splash and the title and pause screens.
  - A click on a link no longer resumes the game.
- **Co-op:** the fork's diff, merged three ways per file (`git merge-file`).
  - The only real conflicts were in `manager.js`.
  - `@p3p2/client` 0.1.1 is installed from npm.
  - The straggler search, `renest` and `TRAPPED` run on the host only, for every player.
  - The p3p2.me link sits beside FRIENDS until the page is in a room.
- **A fix the tests found** (`net/room.js` `check()`): a player who closed their page stayed "up"
  while p3p2 waited for them to come back. A run nobody else was left in went on for about 30 s.
  Now only players who are present count as up.
- **The jetpack** (`entities/jetpack.js`) replaces the grapple.
  - A tank burns at 0.48 a second, so it lasts 2.1 s.
  - That is about 17 m up from standing, over the highest place (the pencil cup's rim, 16 m), and
    about 20 m with a jump first.
  - The lamp is 28.4 m, so no soft ceiling was needed.
  - The fuel gauge turns red under a quarter tank, as the stamina bar did.
  - Friends see your puffs: the burn flag is the `j` field in what each player sends.
  - In first person the puffs do not show: they are behind and below you. The gauge and the hiss
    are the cues there.
  - The grapple points are gone from the map, and the bot's key is now `jet`.
- **The docs:** `ai/summary.md` and `README.md` are updated, and the plan matches what was built.

## Test results, final build

| tool | result |
|---|---|
| `npm run game` | 85/85, including two new checks on the MAIN MENU frame |
| `npm run feel` | 29/29, including nine jetpack checks |
| `npm run reach` | passes |
| `npm run coop` (new) | 26/26 |
| `npm run touch` | 20/20 |
| `npm run toys` | all pass |
| `npm run render` | 26/26 |
| `npm run distcheck` | passes |
| `npm run perf` | 6/7, the same check failing as before plan 2 |
| bot, one unrecorded run | to wave 4, 316 s, no errors, no hang on the virtual clock |

- **`feel`:** one tank gets you onto the north stack's roof by all four routes tried, with 0.00 to
  0.07 of the tank left.
- **`reach`:** the new blind-spot sweep found 1648 tops only the jetpack reaches. Every one is in
  sight of somewhere a gun can stand.
- **`coop`:** it starts p3p2 from `~/Repos/p3p2`.
  - Its first runs failed on its own setup: test players were shot down while standing idle, and
    a wave twist made every figure hunt.
  - Test players now have a billion health except where a check downs them.
  - The frame-time check compares with the same page alone. Its absolute numbers (about 70 ms p99
    both ways) come from five Chrome windows sharing one GPU.
- **`perf`:** load is unchanged at 0.92 s; the transfer grew from 227 KB to 241 KB.
  - The failing check is the desktop's worst 1% of frames, on its 33 ms limit as before.
  - Alternating three runs each against a build of the last commit: 34.3 ms there, 34.0 ms here.
    Plan 2 costs nothing measurable there.
- **The bot's run** went to the scratchpad, not `OUT_DIR`, to keep it out of `botreport`'s numbers.

## Next

1. **A real phone over the LAN.** So far only `coop.mjs`'s Pixel 7 profile has played co-op.
2. **The desktop frame budget.** It sat on its limit before this plan and still does.
3. **The jetpack in first person.** If flying feels unannounced, a little rumble or a wisp at the
   screen's lower corners would do it. Today there is the gauge and the hiss.
4. **The bot never flies.** Teaching it to use the jetpack would change the playtest numbers, and
   was left out on purpose.
5. **The p3p2 spec.** The fork's notes name a spec in p3p2's repository that no longer exists.
   `tools/coop.mjs` could be offered to p3p2 in its place.
