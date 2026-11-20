import * as THREE from 'three';

// A bud can carry a limb on in a different direction after a stretch of
// straight wood. Store changes of heading in radians at fractions of its
// length, so the same turn can span one ring or several.
export function limbBends(rng, continuation, evergreen) {
  const hand = rng.random() < 0.5 ? -1 : 1;
  const firstPitch = rng.random() < (evergreen ? 0.78 : 0.62)
    ? -rng.random(0.92, 0.42) : rng.random(0.62, 0.12);
  const scale = continuation ? 0.74 : 1;
  const bends = [{
    at: rng.random(0.43, 0.16), width: rng.random(0.14, 0.055),
    pitch: scale * firstPitch, yaw: scale * hand * rng.random(0.83, 0.23),
  }];
  if (rng.random() < 0.76) {
    // Some shoots recover from a dip; others continue laterally or droop
    // again. The second bud can also grow out of the first bend's plane.
    bends.push({
      at: rng.random(0.83, 0.57), width: rng.random(0.15, 0.055),
      pitch: scale * (rng.random() < 0.56 ? rng.random(0.94, 0.38) : -rng.random(0.68, 0.12)),
      yaw: scale * hand * rng.random(0.53, -0.93),
    });
  }
  return bends;
}

// An interval represents a season's extension. Short extensions cluster
// neighboring attachments, long ones leave bare wood between forks.
export function growthIntervals(count, variation, rng) {
  const bounds = [0];
  for (let i = 0; i < count; i++) {
    bounds.push(bounds[i] + Math.exp(variation * rng.random(1.1, -1.1)));
  }
  const total = bounds[count];
  return bounds.map(value => value / total);
}

export function applyAttachmentOffset(point, attachment, offsets) {
  if (attachment && offsets.size) {
    const { a, b, f } = attachment;
    if (offsets.has(a)) point.addScaledVector(offsets.get(a), 1 - f);
    if (offsets.has(b)) point.addScaledVector(offsets.get(b), f);
  }
  return point;
}

export class Branch {
  /**
   * Generates a new branch
   * @param {THREE.Vector3} origin The starting point of the branch
   * @param {THREE.Euler} orientation The starting orientation of the branch
   * @param {number} length The length of the branch
   * @param {number} radius The radius of the branch at its starting point
   */
  constructor(
    origin = new THREE.Vector3(),
    orientation = new THREE.Euler(),
    length = 0,
    radius = 0,
    level = 0,
    sectionCount = 0,
    segmentCount = 0,
    vigor = 1,
    attachment,
  ) {
    this.origin = origin.clone();
    this.orientation = orientation.clone();
    this.length = length;
    this.radius = radius;
    this.level = level;
    this.sectionCount = sectionCount;
    this.segmentCount = segmentCount;
    this.vigor = vigor;
    this.attachment = attachment;
  }
}
