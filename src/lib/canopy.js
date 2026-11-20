import { MathUtils, Vector3 } from 'three';
import { applyAttachmentOffset } from './branch';

// Estimate local canopy depth against an angular outer hull. This is a
// deterministic exposure approximation, not a simulation of annual growth.
// Leaves sharing a node receive the same decision so pairs and clusters stay
// intact as pruning strength increases.
export function pruneInteriorLeaves(leaves, strength, seed) {
  if (!leaves.length) return leaves;
  const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const leaf of leaves) { min.min(leaf.origin); max.max(leaf.origin); }
  const center = min.add(max).multiplyScalar(0.5);
  const outer = new Float64Array(12 * 6);
  const samples = leaves.map(leaf => {
    const point = leaf.origin.clone().sub(center), distance = point.length();
    const azimuth = Math.atan2(point.z, point.x);
    const column = Math.min(11, Math.floor((azimuth + Math.PI) / (Math.PI * 2) * 12));
    const row = Math.min(5, Math.floor((distance ? point.y / distance * 0.5 + 0.5 : 0.5) * 6));
    const cell = row * 12 + column;
    outer[cell] = Math.max(outer[cell], distance);
    return { cell, distance };
  });
  const amount = MathUtils.clamp(strength ?? 0, 0, 1);
  return leaves.filter((leaf, i) => {
    const { cell, distance } = samples[i];
    const depth = outer[cell] > 0 ? MathUtils.clamp(1 - distance / outer[cell], 0, 1) : 0;
    leaf.canopyDepth = depth;
    if (!amount) return true;
    const p = leaf.origin;
    let hash = Math.imul(Math.round(p.x * 1000), 0x1f123bb5)
      ^ Math.imul(Math.round(p.y * 1000), 0x5f356495)
      ^ Math.imul(Math.round(p.z * 1000), 0x6c8e9cf5) ^ seed;
    hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
    hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
    const choice = ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
    return choice >= amount * MathUtils.smoothstep(depth, 0.08, 0.65);
  });
}

// Compare the middle and tip of each blade against the full crown from
// four horizontal directions. Counts retain information about both gaps
// and dense sprays without rasterizing millions of LOD0 triangles.
export function selectLeafSites(leaves, count, scale, paired, offsets, clustered = false) {
  const resolution = Math.max(8, Math.min(64, Math.ceil(Math.sqrt(count))));
  const views = [[1, 0], [0, 1], [Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2]];
  const minX = views.map(() => Infinity), maxX = views.map(() => -Infinity);
  let minY = Infinity, maxY = -Infinity;
  const tips = leaves.map(leaf => new Vector3(0, leaf.size, 0).applyEuler(leaf.orientation));
  leaves.forEach(({ origin }, i) => {
    const tip = tips[i];
    minY = Math.min(minY, origin.y, origin.y + tip.y);
    maxY = Math.max(maxY, origin.y, origin.y + tip.y);
    views.forEach(([dx, dz], v) => {
      const root = origin.x * dx + origin.z * dz;
      const end = root + tip.x * dx + tip.z * dz;
      minX[v] = Math.min(minX[v], root, end);
      maxX[v] = Math.max(maxX[v], root, end);
    });
  });
  // The extra border records samples enlarged beyond the full silhouette.
  const width = resolution + 2;
  const bin = (n, lo, hi) => 1 + Math.max(-1, Math.min(resolution,
    Math.floor((n - lo) / Math.max(hi - lo, 1e-6) * (resolution - 1))));
  const reference = new Uint32Array(views.length * width * width);
  const kept = new Uint32Array(reference.length);
  const samples = views.length * 2;
  const cells = new Uint32Array(leaves.length * samples);
  const reduced = new Vector3();
  leaves.forEach(({ origin, attachment }, i) => {
    applyAttachmentOffset(reduced.copy(origin), attachment, offsets);
    views.forEach(([dx, dz], v) => {
      const x = origin.x * dx + origin.z * dz;
      const shiftedX = reduced.x * dx + reduced.z * dz;
      const tip = tips[i];
      const delta = tip.x * dx + tip.z * dz;
      const cell = (cx, cy, t) => (v * width + bin(cy + t * tip.y, minY, maxY)) * width
        + bin(cx + t * delta, minX[v], maxX[v]);
      for (let j = 0; j < 2; j++) {
        const t = (j + 1) * 0.45;
        reference[cell(x, origin.y, t)]++;
        cells[i * samples + v * 2 + j] = cell(shiftedX, reduced.y, t * scale);
      }
    });
  });
  const fraction = count / leaves.length;
  const priority = Float32Array.from(reference, n => n ? 1 + (n - 1) * fraction : 0);
  function score(i) {
    // Retain terminal buds more often so reduced crowns don't leave long,
    // unsupported-looking bare branch ends protruding through the leaves.
    let value = leaves[i].terminal ? 2 : 0;
    for (let j = i * samples; j < (i + 1) * samples; j++) {
      const cell = cells[j], target = priority[cell];
      value += target ? (target - kept[cell]) / (target + kept[cell]) + 0.35 / Math.sqrt(reference[cell]) : -1;
    }
    return value;
  }
  const selected = new Uint8Array(leaves.length);
  function keep(i) {
    selected[i] = 1;
    for (let j = i * samples; j < (i + 1) * samples; j++) kept[cells[j]]++;
  }
  // Local quotas spread the survivors across shoots. Reserve up to half
  // each four-site quota for an intact opposite pair on ash.
  for (let k = 0; k < count; k += 4) {
    let quota = Math.min(4, count - k);
    const first = Math.floor(k * leaves.length / count);
    const end = Math.floor((k + quota) * leaves.length / count);
    if (clustered && quota >= 4) {
      let best = -1, bestScore = -Infinity;
      for (let i = first; i + 3 < end; i++) {
        if (![1, 2, 3].every(j => leaves[i].origin.equals(leaves[i + j].origin))) continue;
        const value = score(i) + score(i + 1) + score(i + 2) + score(i + 3);
        if (value > bestScore) { best = i; bestScore = value; }
      }
      if (best >= 0) {
        for (let j = 0; j < 4; j++) keep(best + j);
        quota -= 4;
      }
    }
    if (paired && quota >= 3) {
      let best = -1, bestScore = -Infinity;
      for (let i = first; i + 1 < end; i++) {
        if (!leaves[i].origin.equals(leaves[i + 1].origin)) continue;
        const value = score(i) + score(i + 1);
        if (value > bestScore) { best = i; bestScore = value; }
      }
      if (best >= 0) { keep(best); keep(best + 1); quota -= 2; }
    }
    while (quota-- > 0) {
      let best = -1, bestScore = -Infinity;
      for (let i = first; i < end; i++) {
        if (selected[i]) continue;
        const value = score(i);
        if (value > bestScore) { best = i; bestScore = value; }
      }
      keep(best);
    }
  }
  const indices = [];
  selected.forEach((chosen, i) => { if (chosen) indices.push(i); });
  return indices;
}
