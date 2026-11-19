import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { LeafType, Tree } from '../build/ez-tree.es.js';

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
