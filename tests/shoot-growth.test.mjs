import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { LeafType, Tree } from '../build/ez-tree.es.js';

test('oak trunks retain a bend through the main fork and the crown stays balanced', () => {
  for (const name of ['Oak Small', 'Oak Medium', 'Oak Large']) {
    for (const seed of [35729, 23399, 42]) {
      const tree = new Tree(); tree.loadPreset(name);
      tree.options.seed = seed; tree.options.leaves.count = 0;
      tree.options.branch.trunkBend = 0; tree.generate({ leafScale: 0 });
      const before = tree.skeleton.branches[0];
      assert(before.forkRing > 0, name);
      const point = before.sections[Math.floor(before.sections.length * 0.35)].origin.clone();
      tree.options.branch.trunkBend = 1; tree.generate({ leafScale: 0 });
      const after = tree.skeleton.branches[0];
      assert(point.distanceTo(after.sections[Math.floor(after.sections.length * 0.35)].origin) > 0.03, name);
      assert(tree.skeleton.branches.filter(branch => branch.level === 1 && branch.scaffold).length >= 2, name);
      tree.branchesMesh.geometry.computeBoundingBox();
      const size = tree.branchesMesh.geometry.boundingBox.getSize(new Vector3());
      const crownRatio = (size.x + size.z) / (2 * size.y);
      assert(crownRatio > 0.65 && crownRatio < 1.75, `${name}, seed ${seed}: ${crownRatio}`);
    }
  }
  const tree = new Tree(); tree.loadPreset('Oak Medium');
  tree.options.branch.structureVariation = 0;
  tree.options.branch.trunkBend = 0; tree.generate({ leafScale: 0 });
  const straight = tree.skeleton.branches[0].sections.at(-1).origin.clone();
  tree.options.branch.trunkBend = 1; tree.generate({ leafScale: 0 });
  assert(straight.distanceTo(tree.skeleton.branches[0].sections.at(-1).origin) > 0.1);
});

test('upright broadleaf growth keeps major limbs rising while willow remains weeping', () => {
  for (const name of ['Oak Medium', 'Ash Medium', 'Sugar Maple']) {
    const tree = new Tree(); tree.loadPreset(name);
    const countFalling = () => tree.skeleton.branches.filter(branch => branch.level > 0 && branch.level <= 2)
      .reduce((count, branch) => count + branch.sections.slice(1).filter((section, i) =>
        section.origin.y < branch.sections[i].origin.y - 0.01).length, 0);
    const corrected = countFalling();
    tree.options.branch.uprightGrowth = 0; tree.generate({ leafScale: 0 });
    const original = countFalling();
    assert(original > 0 && corrected < original * 0.1, `${name}: ${corrected} vs ${original}`);
  }
  const willow = new Tree(); willow.loadPreset('Weeping Willow');
  const before = willow.skeleton.branches.map(branch => branch.sections.map(section => section.origin.toArray()));
  willow.options.branch.uprightGrowth = 0; willow.generate({ leafScale: 0 });
  assert.deepEqual(willow.skeleton.branches.map(branch => branch.sections.map(section => section.origin.toArray())), before);
});

test('broadleaf scaffolds fork again, hold their junction at LOD and carry fine leaf-bearing twigs', () => {
  const tree = new Tree();
  tree.loadPreset('Ash Medium');
  tree.options.leaves.interiorPruning = 0; // Isolate branch growth from canopy exposure.
  tree.options.branch.forkedCrown = false;
  tree.generate({ leafScale: 0 });
  const oldCount = tree.skeleton.branches.length, leafCount = tree.skeleton.leaves.length;
  tree.options.branch.forkedCrown = true;
  tree.generate({ leafScale: 0 });
  const { branches, leaves } = tree.skeleton;
  const trunk = branches[0], junction = trunk.sections[trunk.forkRing];
  const primary = branches.find(b => b.attachment?.a === junction && b.attachment.f === 0);
  assert(primary.baseRadius > 0.63 * junction.radius);
  assert(primary.forkRing > 0 && trunk.sections[trunk.forkRing + 2].radius < junction.radius);
  const full = tree.branchesMesh.geometry.attributes.position;
  const low = tree.createGeometry({ sectionStride: trunk.sections.length - 2, leafScale: 0 }).branches.attributes.position;
  for (let j = 0; j <= trunk.segmentCount; j++) {
    const row = trunk.segmentCount + 1;
    assert(new Vector3().fromBufferAttribute(full, trunk.forkRing * row + j)
      .equals(new Vector3().fromBufferAttribute(low, row + j)));
  }
  assert.equal(leaves.length, leafCount);
  assert(branches.length > oldCount);
  const twigKnots = new Set(branches.slice(oldCount).flatMap(b => b.sections));
  const mounted = leaves.filter(l => twigKnots.has(l.attachment.a));
  assert(mounted.length > 0 && mounted.length % 2 === 0);
  for (let i = 0; i < mounted.length; i += 2) {
    const { a, b, f } = mounted[i].attachment;
    assert(mounted[i].origin.equals(new Vector3().lerpVectors(a.origin, b.origin, f)));
    assert(mounted[i].origin.equals(mounted[i + 1].origin));
  }
});

test('pine whorls and trained trellises keep their own growth pattern', () => {
  const tree = new Tree();
  for (const preset of ['Pine Small', 'Trellis']) {
    tree.loadPreset(preset);
    tree.options.branch.forkedCrown = false;
    tree.generate({ leafScale: 0 });
    const clean = tree.branchesMesh.geometry.attributes.position.array;
    tree.options.branch.forkedCrown = true;
    tree.generate({ leafScale: 0 });
    assert.deepEqual(tree.branchesMesh.geometry.attributes.position.array, clean);
  }
});

test('limb bends concentrate changes of heading without moving forks on the trunk', () => {
  const tree = new Tree();
  tree.loadPreset('Ash Medium');
  function measure(amount) {
    tree.options.branch.limbBends = amount;
    tree.generate({ leafScale: 0 });
    const trunk = new Set(tree.skeleton.branches[0].sections);
    const limbs = tree.skeleton.branches.filter(b => trunk.has(b.attachment?.a) && b.attachment.a !== b.attachment.b);
    const starts = limbs.map(b => b.sections[0].origin.toArray());
    let straight = 0, pronounced = 0, reversals = 0;
    for (const { sections } of limbs) {
      // Every other ring is an original growth knot; intermediate mesh rings
      // round the path and should not change the scale of this measurement.
      const knots = sections.filter((_, i) => i % 2 === 0);
      const pitches = knots.slice(1).map((s, i) => Math.asin(s.origin.clone().sub(knots[i].origin).normalize().y));
      const turns = pitches.slice(1).map((p, i) => (p - pitches[i]) * 180 / Math.PI);
      straight += turns.filter(a => Math.abs(a) < 3).length;
      pronounced += turns.filter(a => Math.abs(a) > 12).length;
      if (turns.some(a => a < -5) && turns.some(a => a > 5)) reversals++;
    }
    return { starts, straight, pronounced, reversals, indices: tree.branchesMesh.geometry.index.count };
  }
  const smooth = measure(0), bent = measure(0.85);
  assert.deepEqual(bent.starts, smooth.starts);
  assert.equal(bent.indices, smooth.indices);
  assert(bent.straight > smooth.straight && bent.pronounced > smooth.pronounced);
  assert(bent.reversals > smooth.reversals);
  assert.deepEqual(measure(0.85), bent);
});

test('the crown has uneven fork spacing, unequal scaffolds and repeatable growth', () => {
  const tree = new Tree();
  tree.options.leaves.count = 0;
  tree.options.seed = 38;
  const samples = variation => {
    tree.options.branch.structureVariation = variation;
    tree.generate();
    const [trunk, ...others] = tree.skeleton.branches;
    const limbs = others.filter(b => trunk.sections.includes(b.attachment?.a) && b.attachment.a !== b.attachment.b);
    return limbs.map(({sections, baseRadius, attachment: a}) =>
      [a.a.distance + (a.b.distance - a.a.distance) * a.f, baseRadius, ...sections.at(-1).origin.toArray()]);
  };
  const regular = samples(0), varied = samples(0.85);
  assert.equal(varied.length, regular.length);
  assert(varied.length > 4);
  for (const column of [0, 1, 2, 3, 4]) {
    assert(varied.some((row, i) => Math.abs(row[column] - regular[i][column]) > 0.01));
  }
  assert.deepEqual(samples(0.85), varied);
  assert.deepEqual(samples(0), regular);
});

test('a terminal broad leaf opens toward the sky on a twisted shoot and stays attached across LODs', () => {
  const tree = new Tree();
  tree.options.branch.levels = 0;
  tree.options.branch.gnarliness[0] = 0;
  tree.options.branch.force.strength = 0;
  tree.options.branch.twist[0] = 0.5;
  tree.options.leaves.type = LeafType.Aspen;
  tree.options.leaves.angle = 62;
  tree.options.leaves.count = 3;
  const headings = [];
  for (const seed of [12, 15, 12]) {
    tree.options.seed = seed;
    tree.generate({ leafDetail: 'thin' });
    assert.equal(tree.skeleton.leaves.length, 4);
    const tip = tree.skeleton.branches[0].sections.at(-1);
    const leaf = tree.skeleton.leaves[0];
    assert.equal(leaf.attachment.a, tip);
    assert(leaf.origin.equals(tip.origin));
    const axis = new Vector3(0, 1, 0).applyEuler(leaf.orientation);
    const top = new Vector3(0, 0, 1).applyEuler(leaf.orientation);
    assert(axis.y > 0.45 && axis.y < 0.95);
    assert(top.y > 0.3);
    headings.push(axis);

    const full = tree.createGeometry({ leafDetail: 'full' }).leaves.attributes.position;
    const thin = tree.leavesMesh.geometry.attributes.position;
    assert(new Vector3().fromBufferAttribute(full, 0).distanceTo(leaf.origin) < 1e-5);
    assert(new Vector3().fromBufferAttribute(thin, 0).distanceTo(leaf.origin) < 1e-5);
  }
  assert(headings[0].equals(headings[2]));
  assert(headings[0].distanceTo(headings[1]) > 0.1);
});

test('intermediate branch rings soften turns while retaining growth knots', () => {
  const tree = new Tree(); tree.loadPreset('Ginkgo');
  const maxTurn = sections => {
    let worst = 0;
    for (let i = 1; i < sections.length - 1; i++) {
      const incoming = sections[i].origin.clone().sub(sections[i - 1].origin).normalize();
      const outgoing = sections[i + 1].origin.clone().sub(sections[i].origin).normalize();
      worst = Math.max(worst, incoming.angleTo(outgoing));
    }
    return worst;
  };
  const candidates = tree.skeleton.branches.filter(b => b.attachment && b.sections.length >= 7 && b.sections.length % 2 === 1);
  let checked = 0;
  for (const { sections } of candidates) {
    const growthKnots = sections.filter((_, i) => i % 2 === 0);
    const originalTurn = maxTurn(growthKnots);
    if (originalTurn < 0.1) continue;
    assert(maxTurn(sections) < originalTurn);
    checked++;
  }
  assert(checked > 50);
});

test('maple and ash grow opposite side shoots, while oak remains alternate', () => {
  for (const [name, expectPairs] of [['Sugar Maple', true], ['Ash Medium', true], ['Oak Medium', false]]) {
    const tree = new Tree(); tree.loadPreset(name);
    const nodes = new Map();
    for (const branch of tree.skeleton.branches) {
      if (!branch.attachment || branch.attachment.a === branch.attachment.b) continue;
      const key = branch.sections[0].origin.toArray().map(x => x.toFixed(6)).join('/');
      nodes.set(key, (nodes.get(key) ?? 0) + 1);
    }
    const pairs = [...nodes.values()].filter(count => count > 1).length;
    if (expectPairs) assert(pairs > 50, name);
    else assert.equal(pairs, 0, name);
  }
});

test('weeping willow shoots terminate above the local ground across seeds and LODs', () => {
  const tree = new Tree(); tree.loadPreset('Weeping Willow');
  for (const seed of [1, 2, 3, 45122]) {
    tree.options.seed = seed;
    tree.generate({ leafScale: 0 });
    for (const branch of tree.skeleton.branches) {
      if (branch.surfaceRoot) continue;
      for (const section of branch.sections) assert(section.origin.y >= -1e-8, `seed ${seed}`);
    }
    const g = tree.createGeometry({ sectionStride: 4, leafScale: 0 }).branches;
    assert(g.index.count > 0);
  }
});

test('ginkgo leaves grow in clusters on short-shoot nodes', () => {
  const tree = new Tree(); tree.loadPreset('Ginkgo');
  const nodes = new Map();
  for (const leaf of tree.skeleton.leaves) {
    const key = leaf.origin.toArray().map(x => x.toFixed(6)).join('/');
    nodes.set(key, (nodes.get(key) ?? 0) + 1);
  }
  const clusters = [...nodes.values()].filter(n => n >= 3 && n <= 4);
  assert(clusters.length > 100);
  const detail = tree.fitTriangleBudget(25000, { thinLeaves: true });
  const geometry = tree.createGeometry(detail).leaves;
  const { position } = geometry.attributes;
  const perLeaf = position.count / geometry.userData.leafSites;
  const roots = [];
  // Ginkgo's second template vertex is its petiole base.
  for (let i = 0; i < position.count; i += perLeaf) roots.push(new Vector3().fromBufferAttribute(position, i + 1));
  const grouped = roots.filter(root => roots.filter(other => root.distanceToSquared(other) < 0.00005).length >= 4);
  assert(grouped.length > roots.length * 0.25);
});

test('ginkgo spur geometry carries leaf clusters and collapses them onto the parent for LODs', () => {
  const tree = new Tree();
  tree.loadPreset('Ginkgo');
  tree.options.branch.levels = 0;
  tree.options.leaves.count = 12;
  tree.generate();
  const twig = tree.skeleton.branches.find(branch => branch.fineTwig);
  assert(twig);
  const leaf = tree.skeleton.leaves.findIndex(site => site.attachment.a === twig.sections[1]);
  assert(leaf >= 0);
  const full = tree.createGeometry({ fineTwigs: true });
  const reduced = tree.createGeometry({ fineTwigs: false });
  assert(full.branches.index.count > reduced.branches.index.count);
  const positions = full.leaves.attributes.position;
  const perLeaf = positions.count / tree.skeleton.leaves.length;
  const fullRoot = new Vector3().fromBufferAttribute(positions, leaf * perLeaf + 1);
  const lowRoot = new Vector3().fromBufferAttribute(reduced.leaves.attributes.position, leaf * perLeaf + 1);
  const expected = twig.sections[1].origin.clone().sub(twig.sections[0].origin);
  assert(fullRoot.sub(lowRoot).distanceTo(expected) < 1e-5);
});

test('ginkgo primary limbs are distributed on both sides of the trunk fork', () => {
  const tree = new Tree(); tree.loadPreset('Ginkgo');
  const trunk = tree.skeleton.branches[0];
  const sections = new Set(trunk.sections);
  const forkDistance = trunk.sections[trunk.forkRing].distance;
  const positions = tree.skeleton.branches
    .filter(branch => sections.has(branch.attachment?.a) && branch.attachment.a !== branch.attachment.b)
    .map(({ attachment: a }) => a.a.distance + (a.b.distance - a.a.distance) * a.f);
  assert(positions.some(distance => distance < forkDistance - 0.1));
  assert(positions.some(distance => distance > forkDistance + 0.1));
});

test('ground clearance applies across species and can be disabled', () => {
  const tree = new Tree();
  for (const name of ['Ginkgo', 'Weeping Willow', 'Sugar Maple', 'Oak Medium', 'Pine Medium']) {
    tree.options.branch.stopAtGround = true;
    tree.loadPreset(name);
    for (const branch of tree.skeleton.branches) {
      if (branch.surfaceRoot) continue;
      for (const section of branch.sections) assert(section.origin.y >= -1e-8, name);
    }
  }
  tree.loadPreset('Weeping Willow');
  tree.options.branch.stopAtGround = false;
  tree.generate({ leafScale: 0 });
  assert(tree.skeleton.branches.some(branch => !branch.surfaceRoot && branch.sections.some(section => section.origin.y < 0)));
});

test('surface roots taper into the ground and can be disabled', () => {
  const tree = new Tree(); tree.options.leaves.count = 0; tree.generate();
  const roots = tree.skeleton.branches.filter(branch => branch.surfaceRoot);
  assert(roots.length >= 5 && roots.length <= 7);
  for (const root of roots) {
    assert(root.sections.at(-1).origin.y < 0);
    assert(root.sections.at(-1).radius < root.sections[0].radius * 0.1);
  }
  const signature = roots.map(root => root.sections.map(section => section.origin.toArray()));
  tree.generate();
  assert.deepEqual(tree.skeleton.branches.filter(branch => branch.surfaceRoot)
    .map(root => root.sections.map(section => section.origin.toArray())), signature);
  tree.options.branch.surfaceRoots = false;
  tree.generate();
  assert(!tree.skeleton.branches.some(branch => branch.surfaceRoot));
});

test('interior pruning is deterministic, monotonic, and preserves whole leaf nodes', () => {
  for (const name of ['Sugar Maple', 'Ginkgo']) {
    const tree = new Tree(); tree.loadPreset(name);
    const snapshots = [];
    for (const strength of [0, 0.5, 1]) {
      tree.options.leaves.interiorPruning = strength;
      tree.generate({ leafDetail: 'thin' });
      const nodes = new Map();
      for (const leaf of tree.skeleton.leaves) {
        assert(leaf.canopyDepth >= 0 && leaf.canopyDepth <= 1);
        const key = leaf.origin.toArray().map(value => value.toFixed(6)).join('/');
        nodes.set(key, (nodes.get(key) ?? 0) + 1);
      }
      snapshots.push(nodes);
    }
    assert(snapshots[0].size > snapshots[1].size && snapshots[1].size > snapshots[2].size, name);
    for (const [key, count] of snapshots[2]) {
      assert.equal(snapshots[1].get(key), count);
      assert.equal(snapshots[0].get(key), count);
    }
    tree.generate({ leafDetail: 'thin' });
    const repeated = tree.skeleton.leaves.map(leaf => leaf.origin.toArray().join('/'));
    tree.generate({ leafDetail: 'thin' });
    assert.deepEqual(tree.skeleton.leaves.map(leaf => leaf.origin.toArray().join('/')), repeated);
  }
});
