import * as THREE from 'three';

// Reserve an existing lateral at a real ring. Both stems retain a share
// of the cross-sectional area carried into that ring.
export function crownFork(branch, options, rng) {
  const level = branch.level;
  if (level >= options.levels || options.children[level] < 2 || branch.sectionCount < 3 ||
    branch.length <= 2 * branch.radius || branch.radius <= 0 ||
    options.radius[level + 1] <= 0 || options.length[level + 1] <= 0) return null;
  if (level > 0 && !branch.scaffold && (level > 1 || branch.radius < 0.27 * options.radius[0])) return null;
  const start = options.start[level + 1];
  const fraction = start + (1 - start) * (level === 0 ? rng.random(0.48, 0.23) : rng.random(0.66, 0.34));
  const ring = Math.max(1, Math.ceil(start * branch.sectionCount), Math.round(fraction * branch.sectionCount));
  if (ring >= branch.sectionCount) return null;
  const azimuth = rng.random(Math.PI * 2);
  const radiusShare = Math.min(0.81, options.radius[level + 1] * rng.random(1.46, 1.27));
  return {
    ring, at: ring / branch.sectionCount, azimuth, radiusShare,
    remaining: Math.sqrt(1 - radiusShare * radiusShare),
    axis: new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth)),
    deflection: THREE.MathUtils.degToRad(options.angle[level + 1]) * rng.random(0.62, 0.37) * Math.min(1, radiusShare / 0.55),
  };
}

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
