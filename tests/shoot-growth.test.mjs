import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { LeafType, Tree } from '../build/ez-tree.es.js';

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
      const pitches = sections.slice(1).map((s, i) => Math.asin(s.origin.clone().sub(sections[i].origin).normalize().y));
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
