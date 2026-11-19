import * as THREE from 'three';

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
