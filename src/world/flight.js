import * as THREE from 'three';

// The camera on the menu screen: a slow loop through the desk.
//
// In the preparation page, the camera flies through the environment. It used
// to sit still at the player start. Now it follows a
// closed curve through the level's `flight` waypoints at walking pace: over
// the notebook, under the north stack, up past the pencil cup, along the
// ruler and back down the west side. It is the scene the game already draws,
// so it adds no load time.
//
// The curve is sampled by arc length, so the speed is even whatever the gaps
// between waypoints. `npm run collide` flies the same curve against the
// colliders, so a map change that puts a wall across it fails there, not on
// the title screen.

export const FLIGHT = { speed: 5.5, lead: 9, dip: 1.2 };

export function flightCurve(points) {
  return new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), true, 'centripetal');
}

export class MenuFlight {
  constructor(points) {
    this.curve = flightCurve(points);
    this.length = this.curve.getLength();
    this.u = 0;
    this._p = new THREE.Vector3();
    this._t = new THREE.Vector3();
  }

  /** Move the camera `dt` further along the loop, looking a little way ahead and down. */
  update(dt, camera) {
    this.u = (this.u + (dt * FLIGHT.speed) / this.length) % 1;
    this.curve.getPointAt(this.u, this._p);
    this.curve.getPointAt((this.u + FLIGHT.lead / this.length) % 1, this._t);
    this._t.y -= FLIGHT.dip;
    camera.position.copy(this._p);
    camera.lookAt(this._t);
  }
}
