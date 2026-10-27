# Plan 5: p3p2 0.2, its own button, and the link to muon.day

Answers `prompt_5.md`. Three parts:

1. Move to `@p3p2/client` 0.2.0
2. Show p3p2's own button, and turn FRIENDS into PLAY WITH FRIENDS on the title screen
3. The link back goes to muon.day instead of maize.live

## 1. `@p3p2/client` 0.2.0

### What 0.2 changes, and what it means here

From the [release notes](https://github.com/doublependu/p3p2/releases/tag/v0.2.0) and
`docs/integrate.md#from-01-to-02`, checked against the 0.2.0 package from npm:

| 0.2 change | here |
|---|---|
| `p3p2.host()`, `room.isMod`, `room.kick()`, `room.end()`, error codes `room-url` and `room` are gone | None of them are used in `src/`. The panel did the hosting, and it now drops the room-URL field |
| Everybody joins through the room's invite link, the owner too. The panel has no room-URL field. Outside a room it says "No server yet?" with p3p2.me, and "Already have one? Open the invite link from the server." | The README's "paste the room URL" goes. Our own p3p2.me line under FRIENDS (`.ir-p3p2`) now repeats what the panel says, so it goes too |
| `Smooth` has `coast: 0` by default; 0.1 coasted 250 ms | `net/crew.js` already asks for `coast: 0`. `net/horde.js` uses the default for figures and planes, so the upgrade would quietly change how they are drawn when a report comes late |
| New error codes `hidden` and `name`; dashes at the end of `invite.code` | The panel handles both. The game doesn't call `join` or `peek` itself |
| Two tabs of one browser are one player | Nothing to do. `tools/coop.mjs` already gives each player a browser context of its own |
| Protocol still 1, nothing changed on the wire | A 0.2 server also takes 0.1 pages, so a room with players on old and new builds works at the protocol level. The game version (`__BUILD__`) still keeps different builds apart |

Size: the entry is 1966 B gzip (1908 B before). The panel is 6.3 KB, up from 5.3 KB, and it still
loads only when a room is opened. The 2–3 s load target doesn't move.

### What changes

- `package.json`: `"@p3p2/client": "^0.2.0"`, then `npm install` so the lockfile follows.
- `net/horde.js`: pass `coast: 250` to both `Smooth`s (the figures and the planes, three places:
  lines 74, 75 and 196). That is what they do now. Figures and planes are reported all the time, so
  coasting only acts when a report is late, and there it hides a hitch better than a freeze would.
  A one-line comment says why, the way `crew.js` explains its `coast: 0`.
- `net/crew.js`: leave `coast: 0` as it is. It is the default now, but keeping it says the choice
  was deliberate, and it already has its comment.
- `net/room.js`: `open()`'s comment ("paste a room URL…") becomes "open an invite, invite, see
  who is here". `enter()`'s branch "a run alone, opened to friends" can now only be reached when
  `start()` resumes a room after PLAY has already been pressed. It stays, because that case is
  real, and its comment says so.

## 2. p3p2's own button

### Is there a reason it isn't used as it is?

The **box** (the panel) already is p3p2's own. FRIENDS calls `p3p2.open()`, and that opens the
built-in panel unchanged. What was switched off is the **button**, the 👥 logo pill
(`ui: { button: false }` in `main.js`). The reason given there is "every corner of the HUD is
taken", and it still holds while a run is being played:

- **Desktop:** score top left, wave readout top right, health bottom left, weapons bottom right.
- **Phone:** the second INK top left, LOAD/NEXT/WRAP along the top right, the INK arc bottom
  right, the stick's half bottom left.

p3p2 puts the button 12 px from a corner, `position: fixed`, at the top `z-index`. Wherever it
went, it would sit on a control or a readout. On a phone it would also take touches meant for the
game.

Away from a run (the title, pause and death screens) nothing needs those corners. So the plan is
to use the button as it comes, and hide it only while a run is being played.

### What changes

- `main.js`: `ui: { chatKey: false }`, with `button` left at its default (on) and `corner` at its
  default (top right). `chatKey` stays off. The game has no use for Enter, but while a run is
  being played the panel is hidden, and chat opening behind it would be worse. The comment above
  it is rewritten to say this.
- **Hidden in a run:** `Screens._show()` and `Screens.hide()` (`ui/screens.js`) toggle a class on
  `<html>`, say `ir-playing`. `hud.css` adds `.ir-playing p3p2-panel { display: none; }`. p3p2's
  inline style sets only position, so the class wins.
  - The rule is "hidden while no screen is up" and not "shown while one is". That way the panel's
    own *Join?*, which opens at boot from an invite link, can't be hidden before the first screen
    comes up. The class is only set when a screen goes away for a run.
  - The panel can't be open while a run is being played, because the only ways to open it (the
    button and PLAY WITH FRIENDS) are on screens. If PLAY is pressed with the panel open, it goes
    away with its button. That is what should happen as the pointer locks.
  - The unread-chat badge and the live mark are on the button. They show again on the pause and
    death screens.
- **PLAY WITH FRIENDS:** on the title screen only. The prompt asks for it "in the main menu", and
  on the pause and death screens the corner button now does the same thing.
  - `game.js` `friendsButton()`: the label becomes `PLAY WITH FRIENDS`, and `PLAY WITH FRIENDS · 3
    here` in a room. The count stays because the button showed it before.
  - `pause()` and both `death()` calls stop passing `friends`. `Screens._friends()` already draws
    nothing when it gets none.
  - `quillButton('friends')`: check that the pen outline stretches to the longer label at phone
    width, and doesn't wrap onto two lines beside MAIN MENU. If it wraps, it goes on a row of its
    own above PLAY.
- `ui/screens.js`: drop the `.ir-p3p2` paragraph and its `inRoom` early return. Drop the
  `.ir-p3p2` rules from `hud.css`. `inRoom` then has no reader in `friendsButton()`, so it goes.
  The JSDoc follows.

### Where the button lands

Top right on every screen is the default. The screens are a centred sheet, so the corner is
normally clear. Two things are checked rather than assumed:

- **A phone held upright.** Whether the sheet reaches the top right corner, and the pill (about
  42×34 px) covers a setting or a link.
- **A notch.** p3p2 uses a plain 12 px with no safe-area inset, so on its side the pill may sit
  under the notch.

If either goes wrong, the fix is another `corner` (bottom right is clear on all three screens) or
an inset through the same class. It isn't a button of our own.

## 3. muon.day

- `index.html:72` (boot splash) and `src/ui/screens.js:18` (`LINKS`, title and pause): set
  `href="https://muon.day"` and the text to "more games on muon.day". The prompt writes it in
  lower case, where the old text had "Maize.Live". muon.day answers (HTTP 200).
- `README.md` and `ai/summary.md` say Maize.Live in their links line, and they follow. Earlier
  plans and prompts stay as they were written.

## Tools

- **`tools/coop.mjs` needs a 0.2 server.** The portal has lost the "Room URL" field, so `makeRoom`
  and `hostRoom` fail.
  - `makeRoom` goes to `/login` and logs in. It creates the room, waits for its heading, and reads
    the room page's **Invite link**, pressing **Create invite** if there isn't one yet. This
    matches p3p2's own `e2e/tests/helpers.ts` `createRoom`.
  - `hostRoom` goes, and Ann comes in with `join('Ann', invite)` like everyone else. The first one
    in is the host, as before. Nothing later in the tool depends on how the host got in.
  - The phone check taps `[data-a="friends"]` on the title screen. That stays: Fi has just joined
    and is on the title.
  - New checks:
    - **Alone:** the corner button is there on the title screen, and `p3p2-core`/`p3p2-panel` are
      still never fetched. The button is drawn by the entry, and its click loads the rest.
    - **In a run:** the button is hidden (`p3p2-panel` has no box), and it is back on the pause
      screen.
    - **Pause:** PLAY WITH FRIENDS isn't on the pause screen, and the corner button opens the same
      `dialog` named Multiplayer.
- **The p3p2 checkout.** `coop.mjs` defaults to `~/Repos/p3p2`, which doesn't exist on this
  machine. The checkout at `/run/media/p1/DRIVE2/p1/Repos/p3p2` is at `v0.1.1-6`. To run coop it
  needs `git checkout v0.2.0 && npm install`, with `P3P2_DIR` pointing at it. That is another
  repository, so I'll ask before touching it.
- **`tools/touch.mjs`.** On the title and pause screens on each of its four phones, upright and on
  its side, check that the `p3p2-panel` box doesn't overlap any button, input or link on the
  sheet. The shots it already takes show it.
- **Unchanged and re-run:**
  - `npm run build` and `npm run distcheck`;
  - `npm run perf`, for load time with the bigger panel, though the panel isn't loaded on an
    ordinary visit;
  - `npm run game`.

## Docs

- `README.md`, "Playing with friends":
  - Whoever has a p3p2 server creates a room for the game's URL in its portal, and presses
    **Open** on the room's page, or sends the invite link it shows.
  - Everybody, owner included, comes in through that link.
  - Inside the game, the 👥 button in the top right or PLAY WITH FRIENDS on the title opens the
    panel, with the invite link and QR code to pass on.
  - The "for a local server" paragraph says the same: "create a room…, press Open".
- `ai/summary.md`: the co-op bullets (the p3p2 version, the button shown away from a run, PLAY
  WITH FRIENDS on the title only, no p3p2.me line of ours), and the links line.
- `ai/next_5.md` afterwards, as usual.

## Order

1. Bump the client, add `coast: 250` in horde, `npm run build`, and play alone. Nothing should
   look different yet.
2. Button on, `ir-playing`, PLAY WITH FRIENDS, drop `.ir-p3p2`.
3. muon.day.
4. `touch.mjs` checks, and look at the shots.
5. Update `coop.mjs` for 0.2, and run it against a 0.2 server once the checkout is updated.
6. README, summary, `next_5.md`.

## Choices made that you may want otherwise

- **PLAY WITH FRIENDS on the title only.** Pause and death rely on the corner button. Putting it
  back on those screens is one argument each.
- **The count stays** in the label, as `PLAY WITH FRIENDS · 3 here`.
- **The link text is "more games on muon.day"**, in lower case as the prompt writes it.
- **The button is hidden in a run.** The other way would be to keep it on the desktop in the top
  right and move the wave readout down under it, as the phone layout does for LOAD/NEXT/WRAP.
  - That would show unread chat and the live mark during play.
  - It would also put a clickable thing in the corner that the locked pointer can't reach anyway.
