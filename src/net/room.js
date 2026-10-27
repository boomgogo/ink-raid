import { DIFFICULTIES } from '../core/difficulty.js';
import { Crew } from './crew.js';
import { Horde } from './horde.js';
import { num } from './wire.js';

// Friends on the same desk, through a p3p2 room.
//
// A p3p2 server relays and remembers, and never knows what an ink figure is. This file is what
// the game knows of a room: who is in it (net/crew.js), whose page runs the horde for everybody
// and how the others see it (net/horde.js), and the run they share.
//
// The run is the room's: one value, kept by the room and written by the host.
//
//   run   { id, d, on: true, at }               started, at difficulty d
//         { id, d, on: false, waves, kills }   over: everybody in it was down at once
//
// Whoever presses PLAY first starts it for everybody (a guest asks the host: `start`). A page on
// the title screen when a run starts, or one that comes in during one, joins it from there with
// one click. A player who goes down is back at the start of the next wave. The run is over when
// every page that is in it is down at the same time.

const CHECK_SECONDS = 0.5;
/** A run that has just started is not over because the others have not said yet that they are in it. */
const SETTLE_MS = 4000;

export class Net {
  /**
   * @param {any} game the Game (game.js)
   * @param {any} p3p2 the P3P2 instance (main.js)
   */
  constructor(game, p3p2) {
    this.game = game;
    this.p3p2 = p3p2;
    this.ctx = game.ctx;
    this.room = null;
    this.crew = new Crew(game.ctx, document.getElementById('hud'), game);
    this.horde = new Horde(game, this);
    /** The room's run, as the room last said. */
    this.run = null;
    /** This page has been running the horde, or drawing what the host sent: it knows the run. */
    this.knows = false;
    this.checkT = 0;
    this._targets = [];
    this._targetsFrame = -1;
    this.frame = 0;
    this._offs = [];
    p3p2.on('room', (room) => this.enter(room));
    p3p2.on('leave', (reason) => this.left(reason));
  }

  inRoom() { return !!this.room; }

  /** Is it this page that runs the horde? Alone it always is. */
  leads() { return !this.room || this.room.isHost; }

  runOn() { return !!this.run?.on; }

  /** The 👥 panel: how to get into a room, the invite to pass on, who is here. */
  open() { this.p3p2.open(); }

  // ---- in and out of a room --------------------------------------------------------------

  enter(room) {
    if (room === this.room) return;
    if (this.room) this.left('replaced');
    this.room = room;
    const r = room;
    const g = this.game;
    this.crew.start(r);
    this.horde.start(r);
    // what this page's player's weapons do, for the others to see (net/crew.js `pf`)
    this.ctx.tell = this.crew;
    this.run = validRun(r.retained('run'));
    this.knows = false;
    this._offs.push(
      r.on('run', (data, _from, meta) => { if (meta.retained) this.onRun(validRun(data)); }),
      r.on('start', (data) => { if (r.isHost) this.startFor(data?.d); }),
      r.on('host-change', () => this.roles()),
      r.on('member-join', (m) => g.hud.kill(`${m.name} came onto the desk`)),
      r.on('member-leave', (m) => g.hud.kill(`${m.name} left`)),
      r.on('member-state', (m, state) => {
        if (state === 'lost') g.hud.kill(`${m.name}: no word from them`);
        else if (state === 'away') g.hud.kill(`${m.name} looked away`);
      }),
    );

    if (r.isHost && g.inRun()) {
      // A run alone, opened to friends: it goes on, and is the room's now. With p3p2 0.2 a room
      // is only entered through an invite link, which loads the page afresh, so this is a reload
      // back into the room whose `start()` came after PLAY had been pressed.
      this.knows = true;
      const id = (this.run?.id || 0) + 1;
      g.runId = id;
      this.horde.lead();
      this.publish({ id, d: g.difficulty, on: true, at: r.now() });
    } else if (g.inRun()) {
      // Somebody else's room, and their desk: what this page was playing alone stops here.
      g.abandonRun();
    }
    this.roles();
    g.hud.kill(r.isHost ? 'the desk is open to your friends' : `you joined ${r.name}`);
    g.roomChanged();
  }

  left() {
    if (!this.room) return;
    for (const off of this._offs) off();
    this._offs = [];
    this.ctx.tell = null;
    this.crew.stop();
    this.horde.stop();
    this.horde.alone();
    this.room = null;
    this.run = null;
    this.game.leftRoom();
  }

  /** Whose horde it is: the host's page runs it, the others draw it. */
  roles() {
    const r = this.room;
    if (!r) return;
    if (r.isHost) {
      // A run this page knows nothing of (the room remembered it after everybody had left, or the
      // host went before a single report came) cannot be carried on: it is over.
      if (this.runOn() && !this.knows && !this.horde.last) {
        this.publish({ ...this.run, on: false, waves: this.run.waves || 0, kills: [] });
      }
      this.knows = true;
      this.horde.lead();
    } else {
      this.horde.follow();
    }
  }

  // ---- the run ------------------------------------------------------------------------

  publish(run) {
    this.run = run;
    this.room?.send('run', run, { retain: 'room' });
  }

  onRun(run) {
    const g = this.game;
    const before = this.run;
    this.run = run;
    if (!run) return;
    if (run.on) {
      if (before?.id !== run.id) this.knows = this.leads();
      // the one who asked for it is in it at once; the rest join from the title screen
      if (g.wantRun && g.runId !== run.id) g.beginRun(run.d, run.id);
      else g.roomChanged();
    } else if (g.runId === run.id) {
      g.runOver(run);
    } else {
      g.roomChanged();
    }
  }

  /** PLAY in a room: the run that is on, or a new one for everybody. */
  play(d) {
    const g = this.game;
    if (this.runOn()) return g.beginRun(this.run.d, this.run.id);
    g.wantRun = true;
    if (this.room.isHost) this.startFor(d);
    else this.room.send('start', { d }, { to: 'host' });
  }

  /** The host starts a run for everybody. */
  startFor(d) {
    if (this.runOn() || !this.room) return;
    const key = DIFFICULTIES[d] ? d : 'medium';
    const id = (this.run?.id || 0) + 1;
    this.knows = true;
    this.publish({ id, d: key, on: true, at: this.room.now() });
    this.onRun(this.run);
    this.game.newDesk();
    this.game.waves.start();
  }

  /** The host: is everybody who is in the run down? Then it is over, for everybody. */
  check() {
    const run = this.run;
    const r = this.room;
    if (!run?.on || !r?.isHost || r.now() - run.at < SETTLE_MS) return;
    const g = this.game;
    const mine = g.runId === run.id && g.inRun();
    const others = this.crew.inRun(run.id);
    // Up counts only for whoever is here. A page that closed is "lost" to the room for as long as
    // the server waits for it to come back, and one in the background is "away": the horde can
    // hit neither (Crew.targets), and counted as up, either kept a run nobody else was left in
    // going until the server gave up on it, half a minute later.
    if ((mine && this.ctx.player.alive) || others.some((p) => p.alive && p.member.state === 'here')) return;
    const kills = others.map((p) => [p.member.name, p.kills]);
    if (mine) kills.unshift([r.self.name, g.kills]);
    this.game.waves.stop();
    this.publish({ id: run.id, d: run.d, on: false, waves: this.game.waves.wave, kills: kills.slice(0, 64) });
    this.onRun(this.run);
  }

  // ---- every frame ----------------------------------------------------------------------

  /** This page's player is up and in the run: the horde can go for it, and rounds can reach it. */
  mine() {
    const g = this.game;
    return !!this.run?.on && g.runId === this.run.id && (g.state === 'playing' || g.state === 'paused') && this.ctx.player.alive;
  }

  /** Who the horde can go for: this page's player if it is up and in the run, and the others who are. */
  targets(out = []) {
    if (this._targetsFrame === this.frame) {
      out.push(...this._targets);
      return out;
    }
    const list = this._targets;
    list.length = 0;
    const run = this.run;
    if (run?.on) {
      if (this.mine()) list.push(this.ctx.player);
      this.crew.targets(run.id, list);
    }
    this._targetsFrame = this.frame;
    out.push(...list);
    return out;
  }

  /** Before anybody walks: the toys, which carry and push whoever stands on them. */
  before(dt) {
    this.frame++;
    this.game.toys?.update(dt, this.ctx.level, this.game.walkers(this.game.state === 'playing'));
  }

  /** After this page's player has moved: the horde, the waves, the desk, and the others. */
  after(dt) {
    const g = this.game;
    const ctx = this.ctx;
    const playing = g.state === 'playing';
    ctx.enemies.update(dt);
    if (this.leads() && this.runOn()) g.waves.update(dt);
    ctx.pickups.update(dt, playing ? ctx.player : null);
    ctx.planes.update(dt);
    this.horde.tick(dt);
    this.crew.say(ctx.player, g.inRun() ? g.runId : 0, g.kills, g.weapon.key);
    this.crew.flush(dt);
    this.crew.draw(dt);
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = CHECK_SECONDS;
      this.check();
    }
  }

  /** For the tests: what this page knows of the room. */
  status() {
    const r = this.room;
    return {
      inRoom: !!r, host: !!r?.isHost, run: this.run, runId: this.game.runId, state: this.game.state,
      wave: this.game.waves.wave, waveState: this.game.waves.state, remaining: this.game.waves.remaining,
      crew: this.crew.list(), horde: this.horde.list(),
      pickups: this.ctx.pickups.list.map((q) => ({ id: q.id || 0, item: q.item })),
      planes: this.ctx.planes.list.map((p) => p.mode),
    };
  }
}

function validRun(v) {
  if (!v || typeof v !== 'object' || !Number.isSafeInteger(v.id) || v.id < 1 || typeof v.on !== 'boolean') return null;
  return {
    id: v.id, d: DIFFICULTIES[v.d] ? v.d : 'medium', on: v.on, at: num(v.at),
    waves: Math.max(0, Math.floor(num(v.waves))),
    kills: Array.isArray(v.kills)
      ? v.kills.filter((k) => Array.isArray(k) && typeof k[0] === 'string').slice(0, 64).map((k) => [k[0].slice(0, 24), Math.max(0, Math.floor(num(k[1])))])
      : [],
  };
}
