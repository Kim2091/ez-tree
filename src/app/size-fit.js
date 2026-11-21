import { Vector3 } from 'three';

export function fitsSize(bounds, max, tolerance = 0.001) {
  if (bounds.isEmpty()) return true;
  const size = bounds.getSize(new Vector3());
  return ['x', 'y', 'z'].every(axis => size[axis] <= max[axis] + tolerance);
}

// Regenerate the skeleton with independently adjusted growth axes. Leaf
// blades and woody cross-sections are not scaled. If a limit is smaller than
// those fixed features can accommodate, restore the natural tree and report it.
export function regrowToSize(tree, manager, details, { restart = true } = {}) {
  const options = tree.options.bounds;
  if (restart || !options.enabled) options.growthScale = { x: 1, y: 1, z: 1 };
  const grow = () => {
    tree.generate({ ...details[0], leafScale: 0 });
    manager.invalidate();
  };
  grow();
  if (!options.enabled) return { fitted: true, attempts: 0 };
  for (let attempts = 0; attempts < 8; attempts++) {
    const box = manager.boundsFor(details[0]);
    if (fitsSize(box, options.max)) return { fitted: true, attempts };
    const size = box.getSize(new Vector3());
    let changed = false;
    for (const axis of ['x', 'y', 'z']) {
      if (size[axis] <= options.max[axis] + 0.001) continue;
      const old = options.growthScale[axis];
      options.growthScale[axis] = Math.max(0.01, old * Math.max(0.1, Math.min(0.95, 0.97 * options.max[axis] / size[axis])));
      changed ||= options.growthScale[axis] < old - 1e-6;
    }
    if (!changed) break;
    grow();
  }
  if (fitsSize(manager.boundsFor(details[0]), options.max)) return { fitted: true, attempts: 8 };
  options.growthScale = { x: 1, y: 1, z: 1 };
  grow();
  return { fitted: false, attempts: 8 };
}

// Lower LOD editing must not regenerate or resize LOD0. Reduce excessive
// leaf enlargement if possible, otherwise fall back to the preceding level.
export function constrainLowerLODBounds(manager, details, max) {
  const adjusted = [];
  if (!fitsSize(manager.boundsFor(details[0]), max)) return adjusted;
  for (let i = 1; i < details.length; i++) {
    if (fitsSize(manager.boundsFor(details[i]), max)) continue;
    const candidate = { ...details[i], leafScale: Math.min(1, details[i].leafScale ?? 1) };
    details[i] = fitsSize(manager.boundsFor(candidate), max) ? candidate : { ...details[i - 1] };
    adjusted.push(i);
  }
  return adjusted;
}
