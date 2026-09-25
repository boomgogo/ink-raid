// Does the collision model agree with the drawing?
//
// The complaint that started this: "weapon hit points sometimes render in
// mid-air, and sometimes I feel like I shot an enemy but it's not registered."
// Both are the same fault seen from two sides. A bullet stops at the first
// collider it meets and stamps an ink blot there, so a collider that is bigger
// than, or somewhere other than, the thing it stands for puts a blot on bare
// paper AND eats the shot that should have gone through to the enemy behind it.
//
// You cannot eyeball that — an invisible wall is invisible. So this fires rays
// through the real level from real vantage points and compares two answers:
//
//   the PHYSICS answer   core/physics.js raycast, what the bullet does
//   the DRAWN answer     the nearest triangle of the merged level meshes,
//                        which is the pen stroke the player is aiming at
//
// and classifies every disagreement:
//
//   PHANTOM  physics stops where nothing is drawn — an invisible wall. This is
//            the blot in mid-air and the shot that vanished. Gated at 0.
//   GHOST    something is drawn but the bullet goes through it. Mostly legal:
//            the map marks its decoration `solid: false` on purpose (the
//            coffee in the mug, the scribbles on the page, the ruler's tick
//            marks). Reported, not gated.
//
// Before any of that, in node: every primitive against its own triangles, and
// the things a BODY does that a ray cannot show — standing on an open tube,
// running into a thin wall faster than a frame, standing up under a ledge, and
// walking through something drawn that is not solid.
import { chromium } from 'playwright';
import * as THREE from 'three';
import { Builder, STAIR } from '../src/world/build.js';
import { buildDesk } from '../src/world/map_desk.js';
import { raycast, floorAt, newBody, stepBody, GRAVITY } from '../src/core/physics.js';
import { Player, MOVE } from '../src/entities/player.js';
import { ghostsInWalkableSpace } from './lib/ghosts.mjs';
import { thingOverlaps, unowned, sunk, overlapDepth, drawnPrimitives, sdf } from './lib/overlap.mjs';
import { touchesColumn } from '../src/core/physics.js';
import { flightCurve } from '../src/world/flight.js';

// --- the primitives, before anything is launched ---------------------------
//
// One shape at a time, against the triangles the very same call draws. Nothing
// here is a hand-computed expectation: the Builder draws a primitive and
// collides it, and both answers are asked of the same rays and the same
// columns. Numbers that have to be typed twice are how the collision model
// drifted off the drawing in the first place.
{
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const TOL = 0.12;              // how far the two answers may differ, in metres
  let bad = 0;
  const check = (name, ok, detail = '') => {
    if (!ok) bad++;
    console.log(` ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${detail}`);
  };

  // Build one primitive alone, then ask the ink and the colliders the same
  // questions. `size` is roughly how big it is, so the probes can be placed.
  function audit(name, build, size, { standTol = TOL, allOfIt = true } = {}) {
    const b = new Builder();
    build(b);
    const lv = { colliders: b.colliders, ramps: b.ramps };
    const scene = new THREE.Scene();
    const built = b.finish(scene);
    const meshes = built.meshes;
    for (const m of meshes) {
      m.updateMatrixWorld(true);
      // "Is there ink here" is a question about the drawing, not about which way
      // it faces. Without this, a ray that enters an open tube — the mug, the
      // pencil cup, a torus with an arc — leaves through a BACK face and the
      // raycaster reports nothing at all.
      m.material.side = THREE.DoubleSide;
    }
    const rc = new THREE.Raycaster();
    rc.far = size * 40;

    const ink = (o, d) => {
      rc.set(o, d);
      let best = null;
      for (const m of meshes) {
        const h = rc.intersectObject(m, false)[0];
        if (h && (!best || h.distance < best.distance)) best = h;
      }
      return best;
    };
    // A ray that grazes the silhouette, or a column that lands on a vertical
    // face, is a coin toss at the last decimal place and says nothing about
    // whether the two models agree. Skipped, and counted so the skipping is
    // visible.
    const GRAZE = 0.05;

    // --- rays: a fan from all round the outside, aimed through the middle ---
    let seed = 20260913;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);
    const box = new THREE.Box3();
    for (const m of meshes) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); }
    const mid = box.getCenter(new THREE.Vector3());
    const ext = box.getSize(new THREE.Vector3());
    const far = Math.max(ext.x, ext.y, ext.z) * 2.2 + 4;

    let rays = 0, phantom = 0, ghost = 0, worstP = 0, worstG = 0, grazed = 0;
    const o = new THREE.Vector3(), d = new THREE.Vector3(), aim = new THREE.Vector3();
    for (let i = 0; i < 4000; i++) {
      const a = rnd() * Math.PI * 2, e = rnd() * Math.PI;
      o.set(mid.x + Math.cos(a) * Math.cos(e) * far, mid.y + Math.sin(e) * far, mid.z + Math.sin(a) * Math.cos(e) * far);
      aim.set(mid.x + rnd() * ext.x * 1.4, mid.y + rnd() * ext.y * 1.4, mid.z + rnd() * ext.z * 1.4);
      d.copy(aim).sub(o).normalize();
      const hit = ink(o, d);
      if (hit && Math.abs(hit.face.normal.dot(d)) < GRAZE) { grazed++; continue; }
      rays++;
      const h = raycast(lv, o, d, far * 3);
      const pT = h ? h.dist : Infinity;
      const dT = hit ? hit.distance : Infinity;
      if (pT < dT - TOL) { phantom++; worstP = Math.max(worstP, Math.min(dT, far * 3) - pT); }
      else if (dT < pT - TOL) { ghost++; worstG = Math.max(worstG, Math.min(pT, far * 3) - dT); }
    }
    // A budget rather than zero, because two things disagree at the last
    // decimal and neither is a modelling error:
    //   * the silhouette, where a ray is tangent and the answer is a coin toss;
    //   * the open end of a torus drawn with an `arc`, where three.js caps
    //     nothing and the last capsule's end is round. A bullet fired into the
    //     mouth of that tube stops a tube-radius inside it, on ink you can see.
    // Anything that is actually wrong runs to whole percent, not tenths.
    const BUDGET = 0.006;
    check(`${name}: bullets stop only on ink`, phantom <= rays * BUDGET,
      phantom ? `${phantom}/${rays} up to ${worstP.toFixed(2)} m early` : `${rays} rays, ${grazed} grazing`);
    if (allOfIt) {
      check(`${name}: bullets stop on all of it`, ghost <= rays * BUDGET,
        ghost ? `${ghost}/${rays} up to ${worstG.toFixed(2)} m late` : '');
    }

    // --- columns: where you stand, against where the ink's top surface is ---
    let cols = 0, off = 0, worstC = 0;
    const down = V(0, -1, 0);
    const top = box.max.y + 1;
    for (let ix = 0; ix < 41; ix++) {
      for (let iz = 0; iz < 41; iz++) {
        const x = box.min.x + (ix / 40) * ext.x + rnd() * 0.02;
        const z = box.min.z + (iz / 40) * ext.z + rnd() * 0.02;
        o.set(x, top, z);
        const hit = ink(o, down);
        if (!hit || Math.abs(hit.face.normal.y) < GRAZE) continue;   // a wall, not a floor
        const inkY = hit.point.y;
        cols++;
        // Probed at the column and a tolerance either side: a round thing is
        // collided at the INSCRIBED radius of the polygon it is drawn as, so
        // the very last millimetre of its rim has ink over no collider by
        // design, and a grid point can land in it.
        let e = Math.abs(floorAt(lv, x, z, top) - inkY);
        if (!isFinite(e)) {
          // No floor at all under ink. A round thing is collided at the
          // INSCRIBED radius of the polygon it is drawn as, so the last
          // millimetre of its rim is ink over nothing by design, and a grid
          // point can land in it — but only within a tolerance of the edge.
          for (const [ox, oz] of [[TOL, 0], [-TOL, 0], [0, TOL], [0, -TOL]]) {
            e = Math.min(e, Math.abs(floorAt(lv, x + ox, z + oz, top) - inkY));
          }
        }
        if (e > standTol) { off++; worstC = Math.max(worstC, e); }
      }
    }
    // the same budget, with a floor under it: an arch's footprint is only a
    // few hundred columns and a couple of them is noise, not a model
    if (standTol !== null) {
      check(`${name}: you stand on the ink`, off <= Math.max(3, cols * BUDGET),
        off ? `${off}/${cols} columns, worst ${worstC.toFixed(2)} m` : `${cols} columns${standTol !== TOL ? `, within ${standTol.toFixed(2)} m` : ''}`);
    }
  }

  // Round things are drawn as polygons, and the collider deliberately takes the
  // INSCRIBED radius of that polygon — inside the ink is honest, outside it is
  // an invisible wall. So the shape audits below are run at a fine tessellation,
  // where the two are the same thing to within the tolerance, and the policy
  // itself is checked on its own further down.
  const FINE = { seg: 96, seg2: 48, rseg: 48 };
  audit('box', (b) => b.box(0, 0, 0, 4, 2, 3), 4);
  audit('box turned 45', (b) => b.box(0, 0, 0, 4, 2, 0.4, { rotY: Math.PI / 4 }), 4);
  audit('box tipped', (b) => b.box(0, 0, 0, 6, 1, 3, { rotZ: 0.35 }), 6);
  audit('cylinder', (b) => b.cyl(0, 0, 0, 3, 5, FINE), 6);
  audit('cylinder on its side', (b) => b.cyl(0, 2, 0, 1.9, 12, { axis: 'x', rotY: -0.72, ...FINE }), 12);
  audit('cylinder along z', (b) => b.cyl(0, 1.5, 0, 1.1, 14, { axis: 'z', ...FINE }), 14);
  audit('tapered, like a pencil', (b) => b.cyl(0, 0, 0, 2, 6, { rTop: 0.8, ...FINE }), 6);
  audit('cone', (b) => b.cone(0, 0, 0, 2, 5, FINE), 5);
  audit('cylinder at an angle', (b) => b.cyl(0, 4, 0, 1.2, 9, { tilt: 0.7, rotY: 0.4, ...FINE }), 9);
  audit('sphere', (b) => b.sphere(0, 3, 0, 2.5, FINE), 5);
  audit('torus', (b) => b.torus(0, 4, 0, 4, 0.8, FINE), 9);
  audit('torus on its side', (b) => b.torus(0, 4, 0, 4, 0.8, { axis: 'y', ...FINE }), 9);
  audit('half a torus, turned', (b) => b.torus(0, 3, 0, 4, 0.5, { arc: Math.PI, rotY: 0.9, ...FINE }), 9);
  for (const dir of ['+x', '-x', '+z', '-z']) {
    audit(`ramp ${dir}`, (b) => b.ramp(0, 0, 0, dir, 10, 6, { rise: 0.4, thick: 0.5 }), 10);
  }
  // A mound is a sunken ellipsoid with only its cap drawn, on the floor that
  // hides the rest (from below, a ray meets the floor first in both answers).
  // Once finely cut, like the shapes above; and once as coarsely as the desk
  // draws one, where the collider is inset by the polygon's sagitta — bullets
  // must still stop only on ink, and feet stand within the tolerance of it. A
  // ray skimming the inset rim at a few degrees runs a long way through ink
  // and no collider, as round things do at their silhouettes, so the coarse
  // one is not asked to stop a bullet on all of it.
  audit('mound', (b) => { b.box(0, -1, 0, 15, 1, 15); b.mound(0, 0, 7, 2.4, FINE); }, 14);
  audit('mound, as the desk draws it', (b) => { b.box(0, -1, 0, 15, 1, 15); b.mound(0, 0, 7, 2.4); }, 14,
    { allOfIt: false });

  // Stairs: bullets stop on the drawn treads and nowhere else — the slab feet
  // walk on is body-only, so it must never stop a ray — and feet are within
  // half a riser of a tread. Every direction, because the slab is tipped.
  for (const dir of ['+x', '-x', '+z', '-z']) {
    audit(`stairs ${dir}`, (b) => b.stairs(0, 0, 0, dir, 9, 6, 6.9), 9,
      { standTol: STAIR.riser / 2 + 0.01 });
  }
  // A ladder: the rails stop bullets where they are drawn. The rungs are too
  // thin to collide and are allowed through, and nothing on it is stood on.
  audit('ladder', (b) => { b.box(0, 0, -1, 4, 6, 2); b.ladder(0, 0, 0, '+z', 6); }, 6,
    { standTol: null, allOfIt: false });
  audit('ladder on a round wall', (b) => { b.cyl(0, 0, 0, 3, 6, { seg: 48 }); b.ladder(Math.sin(0.7) * 3, 0, Math.cos(0.7) * 3, 0.7, 6); }, 6,
    { standTol: null, allOfIt: false });

  // The policy, on a coarse shape: never outside the ink, and never further
  // inside it than the polygon's own sagitta.
  {
    const SEG = 6, R = 1.9;
    const b = new Builder();
    b.cyl(0, 0, 0, R, 8, { seg: SEG });
    const ins = R * Math.cos(Math.PI / SEG);
    check('a 6-sided prism collides as its inscribed circle',
      Math.abs(b.colliders[0].rBot - ins) < 1e-9,
      `r ${ins.toFixed(3)} against ${R} drawn, sagitta ${(R - ins).toFixed(3)} m`);
  }

  // --- bodies ----------------------------------------------------------------
  //
  // A ray cannot tell you any of these. They are about what the column test and
  // stepBody do with a box that walks.
  const levelOf = (build) => {
    const b = new Builder();
    b.box(0, -1, 0, 60, 1, 60);                         // a floor to stand on
    build(b);
    const lv = b.finish(new THREE.Scene());
    lv.killY = -20;
    return lv;
  };
  // gravity and the ground stick, as Player and Enemies drive a body
  const run = (lv, body, vx, vz, secs, fps) => {
    const dt = 1 / fps;
    for (let i = 0; i < secs * fps; i++) {
      body.vel.x = vx; body.vel.z = vz;
      body.vel.y = body.onGround ? -2 : body.vel.y - GRAVITY * dt;
      stepBody(lv, body, dt);
    }
    return body;
  };

  // An open tube lets a bullet into its mouth and still has a lid to stand on.
  // Without the lid a column through it crosses nothing: the mug and the pencil
  // cup were walk-through, and the snipers on their rims fell inside.
  {
    const lv = levelOf((b) => b.cyl(0, 0, 0, 5, 8, { open: true, seg: 48 }));
    const dropped = run(lv, newBody(new THREE.Vector3(0, 10, 0)), 0, 0, 2, 60);
    check('open tube: you stand on its lid', dropped.onGround && Math.abs(dropped.pos.y - 8) < 0.01,
      `landed at y ${dropped.pos.y.toFixed(2)} (want 8)`);
    const walked = run(lv, newBody(new THREE.Vector3(12, 0, 0)), -6.6, 0, 3, 60);
    check('open tube: you cannot walk into it', walked.pos.x > 4.5,
      `stopped at x ${walked.pos.x.toFixed(2)} (the wall is at ${(5 * Math.cos(Math.PI / 48)).toFixed(2)})`);
    const shot = raycast(lv, new THREE.Vector3(0, 12, 0), new THREE.Vector3(0, -1, 0), 30);
    check('open tube: a bullet still goes in', shot && shot.point.y < 0.01,
      `stopped at y ${shot ? shot.point.y.toFixed(2) : 'nothing'} (want the floor inside, 0)`);
  }

  // Faster than a frame. A dash-slash is 34 m/s, and at 20 fps that is 1.7 m
  // a frame against a sticky note 0.35 m thick.
  {
    // wide enough that sliding along it cannot take a body round the end
    const lv = levelOf((b) => b.box(0, 0, 0, 56, 5, 0.35));
    for (const fps of [20, 30, 60]) {
      const body = run(lv, newBody(new THREE.Vector3(0, 0, 4)), 0, -34, 1, fps);
      check(`34 m/s into a 0.35 m wall @ ${fps} fps`, body.pos.z > 0.175,
        `ended at z ${body.pos.z.toFixed(2)} (the wall's near face is 0.18)`);
    }
    // and along a diagonal, where each axis on its own is slower than the body
    const body = run(lv, newBody(new THREE.Vector3(-3, 0, 3)), 24, -24, 1, 20);
    check('34 m/s diagonally into it @ 20 fps', body.pos.z > 0.175, `ended at z ${body.pos.z.toFixed(2)}`);
  }

  // A mound is walked up and over from the flat, and down the far side without
  // leaving it: it is in the ramp magnet, as a ramp is.
  {
    const lv = levelOf((b) => b.mound(0, 0, 7, 2.4));
    const body = newBody(new THREE.Vector3(-10, 0.05, 0));
    let top = 0, air = 0, onIt = false;
    for (let i = 0; i < 4 * 60; i++) {
      body.vel.x = 6.6; body.vel.z = 0;
      body.vel.y = body.onGround ? -2 : body.vel.y - GRAVITY / 60;
      stepBody(lv, body, 1 / 60);
      top = Math.max(top, body.pos.y);
      if (body.pos.y > 0.05) onIt = true;
      if (onIt && body.pos.y > 0.05 && !body.onGround) air++;
    }
    check('a mound: walk up it and over', top > 2.2 && body.pos.x > 9,
      `top ${top.toFixed(2)} of 2.4, ended at x ${body.pos.x.toFixed(1)}`);
    check('a mound: down the far side on the ground', air === 0, `${air} frames in the air`);
  }

  // Standing up under something. The body used to grow into the ceiling, and
  // every move after that overlapped it and was refused, both ways.
  {
    const lv = levelOf((b) => b.box(0, 1.3, -3, 6, 0.5, 4));   // underside at 1.3, z -5..-1
    lv.startPoint = new THREE.Vector3(0, 0.05, 3);
    const p = new Player({ level: lv, camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene() });
    const held = new Set();
    const input = { look: () => ({ yaw: 0, pitch: 0 }), down: (k) => held.has(k), pressed: () => false };
    const sim = (secs) => { for (let i = 0; i < secs * 60; i++) p.update(1 / 60, input); };
    sim(0.3);
    // crouch-walk in until the middle of the ledge, however fast a crouch is
    held.add('crouch'); held.add('forward');
    for (let i = 0; i < 4 * 60 && p.body.pos.z > -3; i++) p.update(1 / 60, input);
    const under = p.body.pos.z;
    held.clear(); sim(1.0);
    const h = p.body.height;
    held.add('back'); sim(2.0);
    held.clear(); sim(0.5);
    check('under a 1.3 m ledge you stay crouched', under < -1.5 && h < 1.3,
      `crouched to z ${under.toFixed(2)}, let go: height ${h.toFixed(2)} (want ${MOVE.bodyHeightCrouch})`);
    check('and can walk out and stand up', p.body.pos.z > -0.5 && p.body.height > MOVE.bodyHeight - 0.01,
      `walked back to z ${p.body.pos.z.toFixed(2)}, height ${p.body.height.toFixed(2)}`);
  }

  // --- the desk, for bodies ----------------------------------------------------
  {
    const lv = buildDesk(new THREE.Scene());
    // Every sniper nest holds whoever is put on it. Two used to drop them
    // through an open tube to the desk.
    const fell = lv.snipers
      .map((n) => ({ n, y: run(lv, newBody(n, 0.34, 1.7, 0.6), 0, 0, 2, 60).pos.y }))
      .filter(({ n, y }) => y < n.y - 0.5);
    check('every sniper nest holds a body', fell.length === 0,
      fell.length ? fell.map(({ n, y }) => `${n.x},${n.y},${n.z} -> y ${y.toFixed(2)}`).join('; ')
        : `${lv.snipers.length} nests`);

    // The tips are separated from the body. Every point (a cone
    // tagged pencil or pen) has to start where another piece of the same
    // pencil ends. The cup's used to hang 5.7 m off the end of the barrel.
    const pieces = lv.colliders.filter((c) => c.shape === 'cyl' && (c.tag === 'pencil' || c.tag === 'pen'));
    const points = pieces.filter((c) => c.rTop === 0);
    const loose = points.filter((t) => !pieces.some((c) => c !== t && c.bEnd.distanceTo(t.aEnd) < 0.02));
    check('every pencil and pen point is on its pencil', points.length > 0 && loose.length === 0,
      loose.length ? loose.map((t) => `${t.c.x.toFixed(0)},${t.c.y.toFixed(0)},${t.c.z.toFixed(0)}`).join('; ')
        : `${points.length} points`);

    // The menu camera's loop never goes through anything, and never passes
    // closer than a metre to it: the path, and six arms a metre long at every
    // step along it.
    if (lv.flight) {
      const curve = flightCurve(lv.flight), len = curve.getLength(), n = Math.ceil(len / 0.25);
      const arms = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((a) => new THREE.Vector3(...a));
      const hits = [];
      // What moves is wherever it might be: the train anywhere on the track,
      // up to its roof; each toy anywhere in its swing.
      const still = { ...lv, colliders: lv.colliders.filter((c) => !c.mover) };
      const swept = (p) => {
        if (lv.track && lv.track.distance(p.x, p.z) < 1.4 + 1.5 && p.y < 4.2 + 1.5) return 'the train';
        if (lv.pendulum) {
          const f = lv.pendulum.f, dx = p.x - f.pivot.x, dz = p.z - f.pivot.z;
          const off = dx * f.n.x + dz * f.n.z, along = dx * f.t.x + dz * f.t.z;
          if (Math.abs(off) < 1.2 + 1.5 && Math.hypot(along, p.y - f.pivot.y) < 10.5 + 1.5) return 'the pendulum';
        }
        if (lv.cradle) {
          const f = lv.cradle.f, dx = p.x - f.origin.x, dz = p.z - f.origin.z;
          if (Math.abs(dx * f.t.x + dz * f.t.z) < 8.5 && Math.abs(dx * f.n.x + dz * f.n.z) < 3.5 && p.y < 10.5) return 'the cradle';
        }
        return null;
      };
      let prev = curve.getPointAt(0);
      for (let i = 1; i <= n; i++) {
        const p = curve.getPointAt(i / n);
        const d = p.clone().sub(prev), dl = d.length();
        if (raycast(still, prev, d.normalize(), dl)) hits.push(p);
        else if (arms.some((a) => raycast(still, p, a, 1.0))) hits.push(p);
        else if (swept(p)) hits.push(p);
        prev = p;
      }
      check('the menu camera flies clear of everything', hits.length === 0,
        hits.length ? `${hits.length} close calls, first at ${hits[0].toArray().map((v) => v.toFixed(1)).join(', ')}`
          : `${len.toFixed(0)} m loop, ${(len / 5.5).toFixed(0)} s round`);
    }

    // A pen lying on the table must not poke into the pencil holder: objects
    // on the table must not overlap each other. Every drawn
    // primitive belongs to a thing (Builder.thing), no two things share more
    // than 3 cm of space unless one says it squeezes the other, and nothing
    // stands in the desk top. See tools/lib/overlap.mjs.
    {
      const loose = unowned(lv);
      check('everything drawn belongs to a thing', loose.length === 0,
        loose.length ? loose.slice(0, 4).map((c) => `${c.shape} ${c.tag || ''} at ${c.c.x.toFixed(1)},${c.c.y.toFixed(1)},${c.c.z.toFixed(1)}`).join('; ')
          : `${lv.things.size} things`);
      const { overlaps, squeezed } = thingOverlaps(lv);
      const at = (o) => o.at.map((v) => v.toFixed(1)).join(', ');
      check('nothing on the desk overlaps anything else', overlaps.length === 0,
        overlaps.length ? overlaps.slice(0, 4).map((o) => `${o.a} into ${o.b} by ${o.depth.toFixed(2)} m at ${at(o)}`).join('; ')
          : `putty pressed on purpose: ${squeezed.map((o) => `${o.a} / ${o.b}`).join(', ') || 'none'}`);
      const under = sunk(lv);
      check('nothing stands in the desk top', under.length === 0,
        under.map((u) => `${u.obj} to y ${u.y.toFixed(2)}`).join('; '));
    }

    // The train's whole path. Nothing static comes within a metre of it, so
    // whatever it pushes is never squeezed against anything — except the track
    // under it and the platforms beside it, which it clears by 0.1. And
    // nothing stands over the track lower than 6.5 m, the head of someone
    // riding on the cab roof.
    if (lv.train) {
      const train = lv.train, track = lv.track;
      const statics = drawnPrimitives(lv).filter((c) => !c.mover && c.obj !== 'desk');
      const close = new Set(['track', ...lv.stations.map((st) => st.name)]);
      const grow = (c, m) => {
        const g = { ...c, min: c.min.clone().subScalar(m), max: c.max.clone().addScalar(m) };
        if (c.shape === 'box') Object.assign(g, { hx: c.hx + m, hy: c.hy + m, hz: c.hz + m });
        else if (c.shape === 'cyl') Object.assign(g, { hy: c.hy + m, rBot: c.rBot + m, rTop: c.rTop + m });
        else if (c.shape === 'ball') Object.assign(g, { hx: c.hx + m, hy: c.hy + m, hz: c.hz + m });
        else g.r = c.r + m;
        return g;
      };
      const s0 = train.s, near = new Map();
      for (let s = 0; s < track.length; s += 0.5) {
        train.s = s; train.place(); lv.movers.step(1 / 60, lv, []);
        for (const car of train.cars) {
          for (const { world: c } of car.body.colliders) {
            for (const [m, list] of [[1, statics.filter((k) => !close.has(k.obj))], [0.1, statics.filter((k) => close.has(k.obj))]]) {
              const g = grow(c, m);
              for (const k of list) {
                if (g.max.x <= k.min.x || k.max.x <= g.min.x || g.max.z <= k.min.z || k.max.z <= g.min.z || g.max.y <= k.min.y || k.max.y <= g.min.y) continue;
                const o = overlapDepth(g, k, 8);
                if (o && (!near.has(k.obj) || o.depth > near.get(k.obj).depth)) near.set(k.obj, { ...o, s, car: car.name });
              }
            }
          }
        }
      }
      let over = [];
      for (let s = 0; s < track.length; s += 0.5) {
        const q = track.at(s);
        for (const k of statics) {
          if (close.has(k.obj)) continue;
          const span = touchesColumn(k, q.x, q.z, 1.4 + 0.35);
          if (span && span.lo < 6.5 && span.hi > 0.35) over.push(`${k.obj} at ${s.toFixed(0)} m`);
        }
      }
      over = [...new Set(over)];
      train.s = s0; train.place(); lv.movers.step(1 / 60, lv, []); lv.movers.step(1 / 60, lv, []);
      check('the train clears everything on its way', near.size === 0,
        near.size ? [...near].slice(0, 4).map(([obj, o]) => `${o.car} within reach of ${obj} at ${o.s.toFixed(0)} m round, (${o.at.map((v) => v.toFixed(1)).join(', ')})`).join('; ')
          : `${track.length.toFixed(0)} m of track, 1 m clear, 0.1 m to the track and the platforms`);
      check('nothing over the track under 6.5 m', over.length === 0, over.slice(0, 4).join('; '));
    }

    // The pendulum and the cradle swing clear of everything, their own stands
    // included, and of the train: two simulated minutes of the toys running as
    // the game runs them, every mover primitive against every still one and
    // against each other's, at every fifth frame.
    if (lv.toys) {
      const statics = drawnPrimitives(lv).filter((c) => !c.mover && c.obj !== 'desk');
      const swinging = [...lv.pendulum.links, ...lv.cradle.balls];
      const cars = lv.train.cars.map((c) => c.body);
      const hits = new Map();
      const saved = lv.toys.movers.bodies.map((b) => [b.pos.clone(), b.quat.clone()]);
      const note = (a, b, o) => { const k = `${a} / ${b}`; if (!hits.has(k) || o.depth > hits.get(k).depth) hits.set(k, o); };
      for (let f = 0; f < 120 * 60; f++) {
        lv.toys.update(1 / 60, lv, []);
        if (f % 5) continue;
        for (const body of swinging) {
          for (const { world: c } of [...body.colliders, ...body.ghosts]) {
            for (const k of statics) {
              if (c.max.x <= k.min.x || k.max.x <= c.min.x || c.max.z <= k.min.z || k.max.z <= c.min.z || c.max.y <= k.min.y || k.max.y <= c.min.y) continue;
              const o = overlapDepth(c, k, 6);
              if (o && o.depth > 0.03) note(body.name, k.obj, o);
            }
            for (const car of cars) for (const { world: k } of car.colliders) {
              if (c.max.x <= k.min.x || k.max.x <= c.min.x || c.max.z <= k.min.z || k.max.z <= c.min.z || c.max.y <= k.min.y || k.max.y <= c.min.y) continue;
              const o = overlapDepth(c, k, 6);
              if (o) note(body.name, car.name, o);
            }
          }
        }
      }
      lv.toys.movers.bodies.forEach((b, i) => lv.toys.movers.setPose(b, ...saved[i]));
      lv.toys.movers.step(1 / 60, lv, []); lv.toys.movers.step(1 / 60, lv, []);
      check('the pendulum and the cradle swing clear', hits.size === 0,
        hits.size ? [...hits].slice(0, 4).map(([k, o]) => `${k} by ${o.depth.toFixed(2)} m at ${o.at.map((v) => v.toFixed(1)).join(', ')}`).join('; ')
          : '2 minutes of swinging, against everything still and the train');
    }

    // The paper planes' circles: every point a plane's middle flies through,
    // at the bottom and the top of its swell, three metres clear of anything
    // plus half its wingspan. The lamp's head is the tallest thing near them.
    {
      const { PLANES } = await import('../src/entities/planes.js');
      const still = drawnPrimitives(lv).filter((c) => !c.mover);
      const pad = 3 + PLANES.span / 2;
      let worst = Infinity, what = '';
      for (const c of PLANES.circles) {
        const cx = Math.cos(c.at) * PLANES.offset, cz = Math.sin(c.at) * PLANES.offset;
        for (let a = 0; a < Math.PI * 2; a += 0.05) {
          for (const y of [c.y - 0.9, c.y + 0.9]) {
            const p = [cx + Math.cos(a) * c.r, y, cz + Math.sin(a) * c.r];
            for (const k of still) {
              if (p[0] < k.min.x - pad || p[0] > k.max.x + pad || p[2] < k.min.z - pad || p[2] > k.max.z + pad || p[1] > k.max.y + pad) continue;
              const d = sdf(k, p);
              if (d < worst) { worst = d; what = k.obj; }
            }
          }
        }
      }
      check("the paper planes' circles are clear", worst >= pad,
        `${worst.toFixed(1)} m from the nearest thing (${what}), want ${pad.toFixed(2)}`);
    }

    // Drawn things you would walk through. Make them solid, or say why not.
    const listed = ghostsInWalkableSpace(lv);
    const untagged = listed.filter((g) => !g.ghost.ghost);
    const tags = {};
    for (const g of listed) if (g.ghost.ghost) tags[g.ghost.ghost] = (tags[g.ghost.ghost] || 0) + 1;
    check('no untagged ghost you can walk in', untagged.length === 0,
      untagged.length
        ? untagged.slice(0, 4).map(({ ghost: g, at }) => `${g.shape} ${g.tag || ''} w ${g.min.x.toFixed(0)},${g.min.y.toFixed(1)},${g.min.z.toFixed(0)} over y ${at[1].toFixed(1)}`).join('; ')
        : `${(lv.ghosts || []).length} ghosts, ${listed.length} in walkable space, tagged ${JSON.stringify(tags)}`);
  }

  console.log(bad ? `\n  ${bad} primitive checks FAILED\n` : '\n  every primitive collides as it is drawn, and bodies stay out of it\n');
  if (bad) process.exit(1);
}

const URL_BASE = process.env.OURS_URL || 'http://localhost:4173/';
const TOL = 0.06;            // metres the two answers may differ by and still agree
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--hide-scrollbars', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(URL_BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__inkReady === true, { timeout: 30000 });
await sleep(500);

const out = await page.evaluate(({ TOL }) => {
  const lv = window.__ink.level;

  // --- the drawn answer: every triangle the level meshes put on the page ----
  // Things that move are drawn in their bodies' frames and placed by the
  // shader (world/movers.js), so their vertices go through their body's
  // matrix here, where they are right now.
  const tris = [];
  const bodies = lv.movers ? lv.movers.bodies.map((b) => b.matrix.elements) : [];
  for (const m of [...lv.meshes, ...(lv.movers ? lv.movers.meshes : [])]) {
    m.updateMatrixWorld(true);
    const g = m.geometry;
    const pos = g.attributes.position;
    const body = g.attributes.aBody;
    const el = g.index ? g.index.array : null;
    const n = el ? el.length : pos.count;
    const w = m.matrixWorld.elements;
    const tx = (e, x, y, z, o) => {
      o[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
      o[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      o[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    };
    const v = [0, 0, 0];
    for (let i = 0; i < n; i += 3) {
      for (let k = 0; k < 3; k++) {
        const idx = el ? el[i + k] : i + k;
        tx(body ? bodies[Math.round(body.getX(idx))] : w, pos.getX(idx), pos.getY(idx), pos.getZ(idx), v);
        tris.push(v[0], v[1], v[2]);
      }
    }
  }
  const T = new Float64Array(tris);
  const nTri = T.length / 9;

  // Moller-Trumbore, both faces: "is there ink here", not "which way does it face"
  function drawnHit(ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT;
    for (let i = 0; i < T.length; i += 9) {
      const ax = T[i], ay = T[i + 1], az = T[i + 2];
      const e1x = T[i + 3] - ax, e1y = T[i + 4] - ay, e1z = T[i + 5] - az;
      const e2x = T[i + 6] - ax, e2y = T[i + 7] - ay, e2z = T[i + 8] - az;
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-9 && det < 1e-9) continue;
      const inv = 1 / det;
      const tx0 = ox - ax, ty0 = oy - ay, tz0 = oz - az;
      const u = (tx0 * px + ty0 * py + tz0 * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty0 * e1z - tz0 * e1y, qy = tz0 * e1x - tx0 * e1z, qz = tx0 * e1y - ty0 * e1x;
      const vv = (dx * qx + dy * qy + dz * qz) * inv;
      if (vv < 0 || u + vv > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 1e-4 && t < best) best = t;
    }
    return best;
  }

  // --- where to stand ------------------------------------------------------
  // The landmarks, at eye height, plus a couple of rooftops: the faults are
  // around the turned and round things, so stand next to each of them.
  const spots = [
    ['player start', lv.startPoint.x, lv.startPoint.y + 1.7, lv.startPoint.z],
    ['plaza centre', 0, 2.2, 0],
    ['ring road N', 0, 1.9, -20],
    ['ring road S', 0, 1.9, 20],
    ['ring road E', 20, 1.9, 0],
    ['ring road W', -20, 1.9, 0],
    ['by the mug', -18, 1.9, 0],
    ['by the pencil cup', 16, 1.9, -18],
    ['by the stapler', -16, 1.9, -18],
    ['by the big pencil', -16, 1.9, 16],
    ['by the eraser steps', 16, 1.9, 16],
    ['by the north stairs', -3, 1.9, -12],
    ['by the binder ladder', 18, 1.9, -8],
    ['on the tape lip', 0, 12.7, 16],
    ['by the east station', 40, 1.9, 18],
    ['by the west station', -40, 1.9, -18],
    ['on the east platform', 42.9, 2.6, 20],
    ['high, over the arena', 0, 22, 0],
  ];

  const RANGE = 90;
  const YAWS = 72, PITCHES = 9;
  // Jittered, but deterministically. An unjittered grid puts rays exactly along
  // the world axes, where they graze box edges tangentially and the triangle
  // test misses by an ulp — which reports as a phantom and is nothing of the
  // kind. The jitter is smaller than anything the audit is looking for.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);
  let rays = 0, phantom = 0, ghost = 0;
  const byCause = {};
  const worstP = [], worstG = [];

  const o = new (lv.startPoint.constructor)();
  const d = new (lv.startPoint.constructor)();

  for (const [name, ox, oy, oz] of spots) {
    o.set(ox, oy, oz);
    for (let j = 0; j < PITCHES; j++) {
      const pitch = -0.5 + (j / (PITCHES - 1)) * 0.85 + rnd() * 0.01;   // down a bit, up a lot
      for (let i = 0; i < YAWS; i++) {
        const yaw = (i / YAWS) * Math.PI * 2 + rnd() * 0.01;
        d.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize();
        rays++;
        const h = window.__ink.raycastLevel(o, d, RANGE);
        const pT = h ? h.dist : Infinity;
        const dT = drawnHit(ox, oy, oz, d.x, d.y, d.z, RANGE);
        if (pT < dT - TOL) {
          phantom++;
          const c = h.box;
          const id = `${c.tag || '·'} ${c.shape} @ ${c.c.x.toFixed(0)},${c.c.y.toFixed(0)},${c.c.z.toFixed(0)}`
            + ` ${(c.max.x - c.min.x).toFixed(1)}x${(c.max.y - c.min.y).toFixed(1)}x${(c.max.z - c.min.z).toFixed(1)}`;
          byCause[id] = (byCause[id] || 0) + 1;
          worstP.push({ spot: name, gap: +(Math.min(dT, RANGE) - pT).toFixed(2), at: [+h.point.x.toFixed(1), +h.point.y.toFixed(1), +h.point.z.toFixed(1)], id });
        } else if (dT < pT - TOL) {
          ghost++;
          worstG.push({ spot: name, gap: +(Math.min(pT, RANGE) - dT).toFixed(2) });
        }
      }
    }
  }
  worstP.sort((a, b) => b.gap - a.gap);
  return { rays, nTri, phantom, ghost, worstP: worstP.slice(0, 8), byCause, spots: spots.length };
}, { TOL });

// ---------------------------------------------------------------------------
// The other half of the same complaint: shooting an enemy and nothing
// happening. An enemy is not level geometry — it is a posed figure and three
// spheres — but the question is identical. Spawn one of each type, pose it the
// way the game poses it, and ask both sides about the same rays.
await page.evaluate(() => window.__ink.game.startRun());
await sleep(400);

const foes = await page.evaluate(() => {
  const G = window.__ink.game;
  const E = G.ctx.enemies;
  const P = G.ctx.player;
  const types = window.__ink.enemyTypes;

  // Freeze the world: we want to interrogate one pose, not chase a moving one.
  G.state = 'paused';

  const rows = [];
  for (const type of types) {
    E.clear();
    const at = new P.body.pos.constructor(0, 0.3, -14);
    // Hunting, and turned from yaw 0, as every enemy spawned before they could
    // roam (and look any way they like): the same pose the numbers were taken in.
    const e = E.spawn(type, at, { mind: 'hunt' });
    if (!e) continue;
    e.yaw = 0;
    e.body.pos.copy(at);
    // walk it, so the pose is the one that used to throw the hitboxes off
    E.think(e, 1 / 60, P);
    E.frame++;
    e.fig.root.updateMatrixWorld(true);

    // the drawn figure, as triangles
    const T = [];
    const held = new Set();
    e.fig.J.grip.traverse((o) => held.add(o));
    e.fig.root.traverse((o) => {
      if (!o.isMesh) return;
      // The weapon in its hand is a prop, not a body part: nothing on the
      // figure claims it, and shooting someone's rifle should not hurt them.
      if (held.has(o)) return;
      const g = o.geometry, pos = g.attributes.position, el = g.index ? g.index.array : null;
      const n = el ? el.length : pos.count;
      const v = new P.body.pos.constructor();
      for (let i = 0; i < n; i++) {
        const idx = el ? el[i] : i;
        v.set(pos.getX(idx), pos.getY(idx), pos.getZ(idx)).applyMatrix4(o.matrixWorld);
        T.push(v.x, v.y, v.z);
      }
    });

    const eye = new P.body.pos.constructor(0, 1.7, 0);
    const d = new P.body.pos.constructor();
    let rays = 0, phantom = 0, missed = 0, hit = 0, oldPhantom = 0, oldMissed = 0;
    const missBand = new Array(10).fill(0);
    const N = 121;
    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        // sweep a window that comfortably contains the figure at 14 m
        const tx = (ix / (N - 1) - 0.5) * 4.0;
        const ty = 0.9 + (iy / (N - 1) - 0.5) * 4.0;
        d.set(tx - eye.x, ty - eye.y, -14 - eye.z).normalize();
        rays++;
        const h = E.raycast(eye, d, 60);
        // nearest drawn triangle of the figure
        let best = Infinity;
        for (let i = 0; i < T.length; i += 9) {
          const ax = T[i], ay = T[i + 1], az = T[i + 2];
          const e1x = T[i + 3] - ax, e1y = T[i + 4] - ay, e1z = T[i + 5] - az;
          const e2x = T[i + 6] - ax, e2y = T[i + 7] - ay, e2z = T[i + 8] - az;
          const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (det > -1e-9 && det < 1e-9) continue;
          const inv = 1 / det;
          const t0x = eye.x - ax, t0y = eye.y - ay, t0z = eye.z - az;
          const u = (t0x * px + t0y * py + t0z * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = t0y * e1z - t0z * e1y, qy = t0z * e1x - t0x * e1z, qz = t0x * e1y - t0y * e1x;
          const vv = (d.x * qx + d.y * qy + d.z * qz) * inv;
          if (vv < 0 || u + vv > 1) continue;
          const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (t > 1e-4 && t < best) best = t;
        }
        const onInk = best < Infinity;
        if (h && !onInk) phantom++;
        else if (!h && onInk) {
          missed++;
          // where on the figure was the shot that did not count? bucket it by
          // height above the feet, in tenths of the figure
          const hy = (eye.y + d.y * best - e.body.pos.y) / (1.85 * (e.t.frame.scale || 1));
          missBand[Math.max(0, Math.min(9, Math.floor(hy * 10)))]++;
        } else if (h && onInk) hit++;

        // The same ray against the hitboxes as they were: three spheres at
        // fixed heights above the feet, 15% oversize, and never moved by the
        // pose. Kept here so the improvement is a measurement, not a claim.
        let oldHit = false;
        const sc = e.t.frame.scale || 1, bw = e.t.frame.girth, hs = e.t.frame.headSize;
        for (const [oy, orr] of [[0.62 + 0.25 + 0.72, 0.26 * hs], [0.62 + 0.25, 0.28 * bw], [0.30, 0.24]]) {
          const cx0 = e.body.pos.x, cy0 = e.body.pos.y + oy * sc, cz0 = e.body.pos.z;
          const rx = cx0 - eye.x, ry = cy0 - eye.y, rz = cz0 - eye.z;
          const R = orr * sc * 1.15;
          const bb = rx * d.x + ry * d.y + rz * d.z;
          if (bb < 0) continue;
          if (bb * bb - (rx * rx + ry * ry + rz * rz - R * R) >= 0) { oldHit = true; break; }
        }
        if (oldHit && !onInk) oldPhantom++;
        else if (!oldHit && onInk) oldMissed++;
      }
    }
    rows.push({ type, rays, phantom, missed, hit, oldPhantom, oldMissed, missBand, ink: hit + missed });
  }
  E.clear();
  G.state = 'playing';
  return rows;
});

await browser.close();

console.log('\n  enemies — a grid of rays at one figure, 14 m out, mid-stride');
console.log('  (a shot that lands on the drawing should register; one that lands beside it should not)\n');
console.log('    type        on ink    MISSED was -> now      PHANTOM was -> now');
let fMiss = 0, fPhan = 0, fInk = 0, fOldMiss = 0, fOldPhan = 0;
for (const r of foes) {
  fMiss += r.missed; fPhan += r.phantom; fInk += r.ink;
  fOldMiss += r.oldMissed; fOldPhan += r.oldPhantom;
  const p = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '0.0').padStart(5) + '%';
  console.log(`    ${r.type.padEnd(10)} ${String(r.ink).padStart(6)}    ${p(r.oldMissed, r.ink)} -> ${p(r.missed, r.ink)}       ${String(r.oldPhantom).padStart(5)} -> ${String(r.phantom).padStart(5)}`);
}
const P = (n, d) => ((n / d) * 100).toFixed(1) + '%';
console.log(`\n    shots on the drawing that do NOT register:  ${P(fOldMiss, fInk)}  ->  ${P(fMiss, fInk)}`);
console.log(`    shots that register beside the drawing:     ${fOldPhan}  ->  ${fPhan}`);
const bands = new Array(10).fill(0);
for (const r of foes) r.missBand.forEach((n, i) => { bands[i] += n; });
if (fMiss) {
  console.log('\n    where the misses land, feet (0.0) to top of head (1.0):');
  for (let i = 9; i >= 0; i--) {
    const bar = '#'.repeat(Math.round((bands[i] / Math.max(...bands)) * 40));
    console.log(`      ${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}  ${String(bands[i]).padStart(5)}  ${bar}`);
  }
}

const pct = (n) => ((n / out.rays) * 100).toFixed(2) + '%';
console.log(`\n  ${out.rays} rays from ${out.spots} vantage points, against ${out.nTri} drawn triangles\n`);
console.log(`  PHANTOM  ${String(out.phantom).padStart(5)}  ${pct(out.phantom)}   bullet stops on bare paper`);
console.log(`  GHOST    ${String(out.ghost).padStart(5)}  ${pct(out.ghost)}   bullet passes through ink (decoration is meant to)`);
if (out.phantom) {
  console.log('\n  phantoms by collider:');
  for (const [id, n] of Object.entries(out.byCause).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${String(n).padStart(4)}  ${id}`);
  }
  console.log('\n  worst single rays:');
  for (const w of out.worstP) {
    console.log(`    ${w.spot.padEnd(20)} ${String(w.gap).padStart(6)} m early at ${w.at.join(', ')}`);
  }
}
console.log(out.phantom === 0 ? '\n  PASS — nothing stops a bullet that is not drawn\n' : `\n  FAIL — ${out.phantom} invisible walls\n`);
process.exit(out.phantom === 0 ? 0 : 1);
