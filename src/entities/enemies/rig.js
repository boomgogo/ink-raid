import * as THREE from 'three';
import { surface } from '../../render/surface.js';
import { INK, LOOK } from '../../render/palette.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const merged = (geos) => mergeGeometries(geos, false);

// The enemies are stick figures someone drew in red biro, and they are built the
// way you would draw one: a big round head, an oval body, four limbs of two
// segments each. No skinning, no skeleton asset — a Group per joint, posed by
// arithmetic every frame.
//
// The body is drawn in LOOK.MASS — a red hatch at fixed WORLD spacing, so the
// strokes stay put on the figure and merge into a mass as it recedes.
//
// This replaces `contrast: 0, lift: 1`, which took the body out of the
// hatch ramp entirely and left pure outline with bare paper inside. That read
// as a drawing of a person up close and as nothing at all at range, which is
// what every reviewer meant by "enemies are anonymous at distance". Measured, a
// 28x62 px figure carried 0.278 ink inside its own bounding box, and in a real
// firefight no figure was detected at all.
//
// The first attempt at fixing this went the other way and filled the torso
// solid, which turns the figure into a blob with the limbs lost inside its
// silhouette. What reads is neither: outline with bare paper inside up close,
// and at twenty metres a solid red mass with a pale core — because the strokes
// are in world units and converge on screen as it gets further away. Fixed
// world spacing does that for free.
// `tools/compare.mjs figure` measures it.

const LIMB_SEG = 6;

function limb(mat, r, len) {
  const g = new THREE.CylinderGeometry(r, r * 0.88, len, LIMB_SEG);
  g.translate(0, -len / 2, 0);          // pivot at the top, so it swings from the joint
  const m = new THREE.Mesh(g, mat);
  return m;
}

// Proportions, chosen against the legibility gate in figures.mjs and the
// hit-volume fidelity report in collide.mjs:
//   * drawn height = 1.7*scale (the body capsule's own height, manager.js:153)
//   * head diameter 28% of drawn height — mid the 25-33% target
//   * legs 35% of drawn height — mid the 30-40% target
//   * idle arms held 62 deg out from vertical — mid the 55-70 deg target
const PROPORTION = {
  legFrac: 0.35,          // of drawn height, split evenly thigh/shin
  headFrac: 0.28,         // head diameter, as a fraction of drawn height
  armSpread: (62 * Math.PI) / 180,
};

/**
 * @param {object} t  a type's `look` (hat, prop) and `frame` (scale, girth,
 *   headSize, limbThickness)
 */
export function buildFigure(t, penId = INK.RED) {
  const body_ = surface({ ink: penId, look: LOOK.MASS, contrast: 1, lift: -0.04 });
  const solid = surface({ ink: penId, look: LOOK.SOLID, side: THREE.DoubleSide });
  const line = body_;

  const root = new THREE.Group();
  const pivot = new THREE.Group();       // the whole-body pivot: death tip-over, walk bob
  root.add(pivot);

  const drawnHeight = 1.7;               // scale is applied once, to `root`, below
  const girth = t.frame.girth, headSize = t.frame.headSize;
  // Limbs nearly twice as thick as the first pass. At the old radius an arm
  // projects to about 1.5 px wide at ten metres and rather less beyond that, so
  // the arms were there, correctly posed, and completely invisible — which is
  // most of why these still read as snowmen after the torso was fixed. A pen
  // does not draw a limb thinner than the line it is drawn with.
  const limbRadius = t.frame.limbThickness * 1.9;

  // Legs are the bottom PROPORTION.legFrac of the drawn height; the pelvis
  // sits on top of them.
  const legLen = drawnHeight * PROPORTION.legFrac;
  const pelvis = new THREE.Group();
  pelvis.position.y = legLen;
  pivot.add(pelvis);

  // Head and torso are OUTLINES with bare paper inside, like a drawing; only
  // the hats and the eyes are filled. Proportions are the cartoon ones, not
  // human ones: the head is nearly a third of the total height and as wide as
  // the body. That is what makes a few red strokes read as a PERSON at forty
  // metres — a realistically-proportioned stick figure at this scale is an
  // unreadable smudge.
  const chest = new THREE.Group();
  pelvis.add(chest);
  const chestR = 0.23 * girth;
  const chestMesh = new THREE.Mesh(new THREE.SphereGeometry(chestR, 11, 8), line);
  // Narrower and taller than a sphere: a circular torso the same size as the
  // head is what made these read as snowmen in the lineup shot.
  chestMesh.scale.set(0.86, 1.28, 0.72);
  chestMesh.position.y = 0.25;
  chest.add(chestMesh);

  const head = new THREE.Group();
  head.position.y = 0.72;
  chest.add(head);
  const headR = (PROPORTION.headFrac * drawnHeight * 0.5) * headSize;
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(headR, 12, 9), line);
  headMesh.scale.set(1, 0.96, 0.94);
  head.add(headMesh);
  // two dots for eyes: the whole face, and enough to tell which way it is looking
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15 * headR, 5, 4), solid);
    eye.position.set(sx * 0.36 * headR, 0.13 * headR, -0.93 * headR);
    head.add(eye);
  }
  const hatHits = addHat(head, t.look.hat, headR, line, solid);

  // arms out of the top of the chest, so they break the silhouette —
  // attached OUTSIDE the chest's silhouette, or the arms disappear into it
  // and the figure reads as a snowman
  const armUL = new THREE.Group(); armUL.position.set(-0.22 * girth, 0.44, 0);
  const armUR = new THREE.Group(); armUR.position.set(0.22 * girth, 0.44, 0);
  chest.add(armUL, armUR);
  // Held out towards horizontal. At 0.32 rad the arms hung inside the chest's
  // own silhouette entirely; at 0.78 they were outside it but still running
  // parallel to the body's own edge, so they merged with its outline and the
  // figure read as a head on a bag with two legs. PROPORTION.armSpread (62
  // deg from vertical) is the angle at which an arm reads as a separate limb
  // rather than as part of the trunk.
  armUL.rotation.z = PROPORTION.armSpread;
  armUR.rotation.z = -PROPORTION.armSpread;
  armUL.add(limb(line, limbRadius, 0.30));
  armUR.add(limb(line, limbRadius, 0.30));
  const armFL = new THREE.Group(); armFL.position.y = -0.30; armUL.add(armFL);
  const armFR = new THREE.Group(); armFR.position.y = -0.30; armUR.add(armFR);
  armFL.add(limb(line, limbRadius * 0.92, 0.24));
  armFR.add(limb(line, limbRadius * 0.92, 0.24));

  // legs: long, thin, and set apart enough to read as two
  const thighLen = legLen * 0.54, shinLen = legLen * 0.46;
  const legUL = new THREE.Group(); legUL.position.set(-0.16 * girth, 0, 0);
  const legUR = new THREE.Group(); legUR.position.set(0.16 * girth, 0, 0);
  pelvis.add(legUL, legUR);
  legUL.add(limb(line, limbRadius * 1.1, thighLen));
  legUR.add(limb(line, limbRadius * 1.1, thighLen));
  const legFL = new THREE.Group(); legFL.position.y = -thighLen; legUL.add(legFL);
  const legFR = new THREE.Group(); legFR.position.y = -thighLen; legUR.add(legFR);
  legFL.add(limb(line, limbRadius, shinLen));
  legFR.add(limb(line, limbRadius, shinLen));

  // the prop mount: on the right forearm, where a held weapon rides
  const grip = new THREE.Group();
  grip.position.set(0, -0.22, 0);
  armFR.add(grip);
  addProp(grip, t.look.prop, line, solid);

  root.scale.setScalar(t.frame.scale || 1);

  // --- hit volumes ---------------------------------------------------------
  //
  // A figure is a head, a chest and eight limb segments, so the hit volumes
  // are two spheres and eight capsules — one per drawn part, each ANCHORED TO
  // THE OBJECT THAT CARRIES IT and running down that joint's own -y, which is
  // exactly how limb() builds the mesh.
  //
  // What was here once was three spheres at heights typed out by hand, which
  // went wrong in every way a second copy of a number can: a floating head
  // hitbox, hit volumes that did not move with the pose, and one sphere doing
  // duty for two separate legs. Anchoring every volume to the drawing it
  // belongs to fixes all three and keeps them fixed. `npm run collide`
  // measures it by firing a grid of rays at one figure of every type, mid-
  // stride at fourteen metres, and asking both the hitboxes and the triangles
  // on the page: the target is 0.0% of shots landing on the drawing that do
  // not register.
  const sc = t.frame.scale || 1;
  const hit = [
    { part: 'head', node: headMesh, len: 0, r: headR * sc },
    // The chest is drawn as a sphere squashed to 0.86 x 1.28 x 0.72, so a
    // sphere round it has to be as wide as it is TALL and puts a third of a
    // metre of hitbox in front of a boss's chest. A short upright capsule is
    // the same shape to within a centimetre. The shoulders that a fat sphere
    // would be reaching for are the arm capsules' job instead.
    { part: 'torso', node: chestMesh, off: 0.11 * girth, len: 0.22 * girth, r: 0.19 * girth * sc },
    { part: 'arms', node: armUL, len: 0.30, r: limbRadius * sc },
    { part: 'arms', node: armUR, len: 0.30, r: limbRadius * sc },
    { part: 'arms', node: armFL, len: 0.24, r: limbRadius * 0.92 * sc },
    { part: 'arms', node: armFR, len: 0.24, r: limbRadius * 0.92 * sc },
    { part: 'legs', node: legUL, len: thighLen, r: limbRadius * 1.1 * sc },
    { part: 'legs', node: legUR, len: thighLen, r: limbRadius * 1.1 * sc },
    { part: 'legs', node: legFL, len: shinLen, r: limbRadius * sc },
    { part: 'legs', node: legFR, len: shinLen, r: limbRadius * sc },
    // a hat wider than the head brings its own volumes: see addHat
    ...hatHits.map((h) => ({ ...h, r: h.r * sc })),
  ];

  // Broad phase: one sphere round the lot, measured off the rest pose rather
  // than guessed, and widened by the furthest any pose throws a part out of it.
  root.updateMatrixWorld(true);
  let lo = Infinity, hi = -Infinity, wide = 0;
  const q = new THREE.Vector3();
  for (const h of hit) {
    for (const y of h.len ? [h.off || 0, (h.off || 0) - h.len] : [0]) {
      if (h.at) q.set(h.at[0], h.at[1], h.at[2]).applyMatrix4(h.node.matrixWorld);
      else q.set(0, y, 0).applyMatrix4(h.node.matrixWorld);
      lo = Math.min(lo, q.y - h.r);
      hi = Math.max(hi, q.y + h.r);
      wide = Math.max(wide, Math.hypot(q.x, q.z) + h.r);
    }
  }
  const bound = { y: (lo + hi) / 2, r: Math.max((hi - lo) / 2, wide) + POSE_SWING * sc };

  return {
    root,
    J: { pivot, pelvis, chest, head, armUL, armUR, armFL, armFR, legUL, legUR, legFL, legFR, grip },
    materials: [line, solid],
    hit,
    bound,
  };
}

// The most any pose moves a hit anchor away from its rest position: a leg
// swinging 0.9 rad, or the head 0.72 out along a chest that leans 0.3. Only
// the broad phase uses it, so it only has to be an over-estimate — `npm run
// collide` checks every volume in every pose stays inside the bound.
const POSE_SWING = 0.45;

/**
 * Hats. Returns hit volumes for any part of the hat that stands out past the
 * head's own sphere, since a shot that lands on the drawing has to register
 * (`npm run collide`): spheres at `at`, a point in the hat mesh's frame.
 */
function addHat(head, kind, hs, line, solid) {
  if (!kind || kind === 'none') return [];
  // Headgear found on a desk, one silhouette per type, read across the arena
  // before anything else about the figure is.
  // Each is one mesh per pen, merged, not a mesh per piece: an enemy's parts
  // are drawn one call each, and a crimped cap of thirteen pieces was thirteen.
  if (kind === 'clip') {
    // a paperclip stuck in the head like an antenna, bent over at the top
    const loop = new THREE.TorusGeometry(0.09 * hs, 0.02, 4, 12, Math.PI * 1.7);
    loop.rotateZ(0.5); loop.rotateY(Math.PI / 2);
    loop.translate(0.02 * hs, 0.37 * hs, 0);
    const stem = new THREE.CylinderGeometry(0.02, 0.02, 0.2 * hs, 4);
    stem.rotateX(-0.15);
    stem.translate(0.02 * hs, 0.25 * hs, 0.02 * hs);
    const clip = new THREE.Mesh(mergeGeometries([loop, stem], false), solid);
    head.add(clip);
    return [{ part: 'head', node: clip, len: 0, at: [0.02 * hs, 0.37 * hs, 0], r: 0.12 * hs },
      { part: 'head', node: clip, len: 0, at: [0.02 * hs, 0.27 * hs, 0.02 * hs], r: 0.06 * hs }];
  } else if (kind === 'blade') {
    // a craft-knife blade worn as a crest, front to back, raked forward
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15 * hs, 0.36 * hs), solid);
    bl.position.set(0, 0.28 * hs, -0.02 * hs);
    bl.rotation.x = -0.4;
    head.add(bl);
    return [-0.12, 0, 0.12].map((z) => ({ part: 'head', node: bl, len: 0, at: [0, 0, z * hs], r: 0.09 * hs }));
  } else if (kind === 'pencap') {
    // a pen's cap, tall and narrow, with its clip down one side
    const pc = new THREE.Mesh(new THREE.CylinderGeometry(0.11 * hs, 0.17 * hs, 0.36 * hs, 10), line);
    pc.position.y = 0.3 * hs;
    head.add(pc);
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.26 * hs, 0.045), solid);
    clip.position.set(0.16 * hs, 0.29 * hs, 0);
    head.add(clip);
    // capsules down the cap and its clip, end to end
    return [{ part: 'head', node: pc, len: 0.36 * hs, off: 0.18 * hs, r: 0.175 * hs },
      { part: 'head', node: clip, len: 0.26 * hs, off: 0.13 * hs, r: 0.06 * hs }];
  } else if (kind === 'brim') {
    // a wide flat brim: the one hat that widens the silhouette at the top, so a
    // hole punch reads as itself at range before its gun does
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34 * hs, 0.34 * hs, 0.03, 12), solid);
    brim.position.y = 0.1 * hs;
    head.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * hs, 0.18 * hs, 0.16 * hs, 9), solid);
    crown.position.y = 0.19 * hs;
    head.add(crown);
    // What stands out past the head: the brim's rim, as a ring of small spheres
    // just touching, and the top of the crown.
    const out = [{ part: 'head', node: crown, len: 0, at: [0, 0.06 * hs, 0], r: 0.16 * hs }];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      out.push({ part: 'head', node: brim, len: 0, at: [Math.cos(a) * 0.285 * hs, 0, Math.sin(a) * 0.285 * hs], r: 0.065 * hs });
    }
    return out;
  } else if (kind === 'highlighter') {
    // a highlighter's cap stood on the head, chisel tip up, in the one ink on
    // the figure that is not red
    const cap = new THREE.CylinderGeometry(0.1 * hs, 0.1 * hs, 0.3 * hs, 8);
    cap.translate(0, 0.33 * hs, 0);
    const tip = new THREE.BoxGeometry(0.14 * hs, 0.1 * hs, 0.05 * hs);
    tip.translate(0, 0.52 * hs, 0);
    const orange = surface({ ink: INK.ORANGE, look: LOOK.SOLID, side: THREE.DoubleSide });
    const hl = new THREE.Mesh(mergeGeometries([cap, tip], false), orange);
    hl.rotation.z = 0.25;
    head.add(hl);
    return [{ part: 'head', node: hl, len: 0.36 * hs, off: 0.54 * hs, r: 0.11 * hs }];
  } else if (kind === 'stapler') {
    // a stapler lying front to back on the head, its arm hinged a little open
    const base = new THREE.BoxGeometry(0.16 * hs, 0.06 * hs, 0.6 * hs);
    base.translate(0, 0.27 * hs, 0);
    const arm = new THREE.BoxGeometry(0.14 * hs, 0.07 * hs, 0.56 * hs);
    arm.rotateX(-0.18);
    arm.translate(0, 0.36 * hs, 0.02 * hs);
    const hinge = new THREE.CylinderGeometry(0.05 * hs, 0.05 * hs, 0.16 * hs, 8);
    hinge.rotateZ(Math.PI / 2);
    hinge.translate(0, 0.31 * hs, 0.27 * hs);
    const st = new THREE.Mesh(mergeGeometries([base, arm, hinge], false), line);
    head.add(st);
    return [-0.24, -0.08, 0.08, 0.24].map((z) => ({ part: 'head', node: st, len: 0, at: [0, 0.32 * hs, z * hs], r: 0.12 * hs }));
  } else if (kind === 'stamp') {
    // a rubber stamp's handle: the pad as a flat cap, a neck, and the knob
    const plate = new THREE.CylinderGeometry(0.22 * hs, 0.22 * hs, 0.05 * hs, 12);
    plate.translate(0, 0.22 * hs, 0);
    const neck = new THREE.CylinderGeometry(0.07 * hs, 0.09 * hs, 0.2 * hs, 8);
    neck.translate(0, 0.34 * hs, 0);
    const knob = new THREE.SphereGeometry(0.13 * hs, 10, 8);
    knob.translate(0, 0.52 * hs, 0);
    const sm = new THREE.Mesh(mergeGeometries([plate, neck, knob], false), solid);
    head.add(sm);
    const out = [{ part: 'head', node: sm, len: 0, at: [0, 0.52 * hs, 0], r: 0.14 * hs },
      { part: 'head', node: sm, len: 0.2 * hs, off: 0.44 * hs, r: 0.1 * hs }];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      out.push({ part: 'head', node: sm, len: 0, at: [Math.cos(a) * 0.19 * hs, 0.22 * hs, Math.sin(a) * 0.19 * hs], r: 0.06 * hs });
    }
    return out;
  } else if (kind === 'crown') {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * hs, 0.2 * hs, 0.1, 8, 1, true), solid);
    c.position.y = 0.18 * hs;
    head.add(c);
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.035 * hs, 0.12 * hs, 4), solid);
      const a = (i / 5) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.18 * hs, 0.28 * hs, Math.sin(a) * 0.18 * hs);
      head.add(s);
    }
  }
  return [];
}

function addProp(gun, kind, line, solid) {
  if (!kind || kind === 'none') return;
  if (kind === 'marker') {
    // a fat highlighter, held like a pointer
    gun.add(new THREE.Mesh(merged([
      new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8).rotateX(Math.PI / 2).translate(0, 0, -0.18),
      box(0.07, 0.05, 0.05, 0, 0, -0.42),
    ]), solid));
    return;
  }
  if (kind === 'tape') {
    // a tape dispenser: the roll on its spindle, and the base with its cutter
    gun.add(new THREE.Mesh(merged([
      new THREE.TorusGeometry(0.11, 0.035, 5, 12).rotateY(Math.PI / 2).translate(0, 0.04, -0.12),
      box(0.08, 0.06, 0.3, 0, -0.06, -0.12),
    ]), line));
    return;
  }
  if (kind === 'staples') {
    // a big stapler, held out like a gun
    gun.add(new THREE.Mesh(merged([
      box(0.1, 0.06, 0.5, 0, -0.04, -0.2),
      box(0.09, 0.06, 0.46, 0, 0.04, -0.18),
    ]), line));
    return;
  }
  // Each new prop is merged into as few meshes as the rifle has (two): every
  // mesh on a figure is a draw call, and there are fourteen figures.
  if (kind === 'katana') {
    // a long thin blade out of a guard, and the grip behind it: one mesh
    gun.add(new THREE.Mesh(merged([
      box(0.025, 0.07, 1.05, 0, 0, -0.6),
      box(0.2, 0.05, 0.045, 0, 0, -0.06),
      box(0.04, 0.045, 0.24, 0, 0, 0.07),
    ]), solid));
    return;
  }
  if (kind === 'shotgun') {
    // short and fat, two barrels side by side and a stock, with a pump under them
    gun.add(new THREE.Mesh(merged([
      box(0.06, 0.06, 0.52, -0.035, 0, -0.26),
      box(0.06, 0.06, 0.52, 0.035, 0, -0.26),
      box(0.07, 0.13, 0.22, 0, 0, 0.11),
    ]), line));
    gun.add(new THREE.Mesh(box(0.09, 0.06, 0.18, 0, -0.07, -0.3), solid));
    return;
  }
  const len = kind === 'sniper' ? 1.1 : kind === 'pistol' ? 0.26 : 0.62;
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, len), line);
  barrel.position.z = -len / 2;
  gun.add(barrel);
  if (kind !== 'pistol') {
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.1, 0.2), line);
    stock.position.z = 0.1;
    gun.add(stock);
  }
}

/**
 * Pose a figure. Everything is arithmetic on a phase — no clips, no blending.
 * `walk` is how much the legs should be moving, `t` a running phase.
 */
export function pose(J, o) {
  const { t, walk, aim, lean, dead, hurt, flying, raise = 0, cut = 0 } = o;
  const p = t * 9;

  if (dead) {
    // Death is not a ragdoll: the figure crumples and the whole drawing tips
    // over, which is what a drawing being scribbled out looks like.
    const k = Math.min(1, o.downFor * 3.4);
    J.pivot.rotation.z = k * 1.5;
    J.pivot.position.y = -k * 0.55;
    J.chest.rotation.x = k * 0.9;
    J.head.rotation.x = k * 1.1;
    J.armUL.rotation.x = -k * 2.2;
    J.armUR.rotation.x = -k * 1.8;
    J.legUL.rotation.x = k * 1.4;
    J.legUR.rotation.x = k * 0.9;
    return;
  }

  const swing = Math.sin(p) * walk;
  const swing2 = Math.sin(p + Math.PI) * walk;

  J.pivot.rotation.z = 0;
  J.pivot.position.y = flying ? Math.sin(t * 4) * 0.08 : Math.abs(Math.sin(p)) * 0.045 * walk;
  J.pelvis.rotation.y = swing * 0.12;
  J.chest.rotation.y = -swing * 0.16;
  J.chest.rotation.x = lean * 0.5 + walk * 0.18;
  J.head.rotation.x = -lean * 0.35 + (hurt || 0) * 0.5;

  if (flying) {
    J.legUL.rotation.x = -0.5 + Math.sin(t * 5) * 0.2;
    J.legUR.rotation.x = -0.4 + Math.sin(t * 5 + 1) * 0.2;
  } else {
    J.legUL.rotation.x = swing * 0.9;
    J.legUR.rotation.x = swing2 * 0.9;
    J.legFL.rotation.x = Math.max(0, -swing) * 0.9;
    J.legFR.rotation.x = Math.max(0, -swing2) * 0.9;
  }

  // NOTE: these overwrite rotation.z every frame, so the rest pose set in
  // buildFigure() is only ever a starting value — widening the arms there and
  // not here does nothing at all at runtime. The arms are held well out from the
  // body so they break the silhouette: tucked in, they disappear into the chest
  // and the figure reads as a snowman past about fifteen metres.
  if (raise > 0 || cut > 0) {
    // A melee strike, and its tell. `raise` takes the blade up over the head
    // and back through the wind-up; `cut` brings it down through the swing.
    // The wind-up is the one pose that has to read at a glance across the
    // ring road, so it is big: the whole arm, not the wrist.
    const up = raise * (1 - cut);
    J.armUR.rotation.x = -2.9 * up + 0.5 * cut;
    J.armUR.rotation.z = -0.35 - 0.3 * up;
    J.armFR.rotation.x = -0.9 * up + 0.2 * cut;
    J.armUL.rotation.x = -0.6 * up;
    J.armUL.rotation.z = PROPORTION.armSpread;
    J.armFL.rotation.x = 0.5;
    J.chest.rotation.x += -0.25 * up + 0.35 * cut;
  } else if (aim) {
    // both hands to the prop, pointing where it is looking
    J.armUR.rotation.x = -1.42;
    J.armUR.rotation.z = -0.34;
    J.armFR.rotation.x = 0.12;
    J.armUL.rotation.x = -1.3;
    J.armUL.rotation.z = 0.62;
    J.armFL.rotation.x = 0.4;
  } else {
    J.armUR.rotation.x = swing2 * 0.7;
    J.armUR.rotation.z = -PROPORTION.armSpread;
    J.armUL.rotation.x = swing * 0.7;
    J.armUL.rotation.z = PROPORTION.armSpread;
    J.armFR.rotation.x = 0.25 + Math.max(0, swing2) * 0.5;
    J.armFL.rotation.x = 0.25 + Math.max(0, swing) * 0.5;
  }
}
