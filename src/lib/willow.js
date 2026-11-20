import * as THREE from 'three';

// Salix babylonica bears a spreading scaffold with slender, pendulous outer
// branchlets. Bend only the outer levels: forcing the whole tree downward would
// also bow the trunk and erase the characteristic umbrella-shaped crown.
// https://www.rhs.org.uk/plants/66012/salix-babylonica/details
const down = new THREE.Vector3(0, -1, 0);
const localUp = new THREE.Vector3(0, 1, 0);

/** Mutate a section quaternion after the ordinary growth forces are applied. */
export function bendWillowShoot(orientation, level, sectionCount) {
  if (level < 2 || sectionCount <= 0) return;
  const direction = localUp.clone().applyQuaternion(orientation);
  const axis = new THREE.Vector3().crossVectors(direction, down);
  const sin = axis.length();
  if (sin < 1e-7) return;
  const remaining = Math.atan2(sin, direction.dot(down));
  // Distribute the bend over the shoot, independent of section resolution.
  const totalBend = level === 2 ? 0.8 : 1.8;
  const step = Math.min(remaining, totalBend / sectionCount);
  orientation.premultiply(new THREE.Quaternion().setFromAxisAngle(axis.divideScalar(sin), step));
}
