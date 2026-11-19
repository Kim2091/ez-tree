import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { Tree } from '../build/ez-tree.es.js';

test('tapered side branches have outward normals perpendicular to the sloping bark', () => {
  const tree = new Tree();
  const branch = tree.options.branch;
  branch.levels = 1;
  branch.children[0] = 1;
  branch.angle[1] = 75;
  branch.force.strength = 0;
  for (const level of [0, 1]) {
    branch.gnarliness[level] = 0;
    branch.twist[level] = 0;
    branch.sections[level] = 8;
  }
  branch.taper[1] = 0.8;
  tree.options.leaves.count = 0;
  tree.generate();

  const { position, normal } = tree.branchesMesh.geometry.attributes;
  let first = 0;
  for (const { sections, segmentCount } of tree.skeleton.branches) {
    const axis = sections.at(-1).origin.clone().sub(sections[0].origin).normalize();
    const row = segmentCount + 1;
    if (Math.abs(axis.y) < 0.9) {
      for (let j = 0; j < row; j++) {
        const i = first + 3 * row + j;
        const n = new Vector3().fromBufferAttribute(normal, i);
        const along = new Vector3().fromBufferAttribute(position, i + row)
          .sub(new Vector3().fromBufferAttribute(position, i - row)).normalize();
        const radial = new Vector3().fromBufferAttribute(position, i).sub(sections[3].origin).normalize();
        assert(n.dot(radial) > 0.9);
        assert(n.dot(axis) > 0);
        assert(Math.abs(n.dot(along)) < 1e-5);
      }
      return;
    }
    first += sections.length * row;
  }
  assert.fail('Expected an inclined side branch');
});
