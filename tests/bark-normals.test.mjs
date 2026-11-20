import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { Tree } from '../build/ez-tree.es.js';
import { cutBarkChip } from '../src/lib/bark-chip.js';

test('scar faces wind outward where a wound approaches a ring seam', () => {
  for (const kind of ['sliver', 'split', 'scrape']) {
    for (const lean of [-0.65, 0.65]) {
      const b = { verts: [0,0,0, 0,1,0, 1,1,0, 1,0,0], uvs: [0,0, 0,1, 1,1, 1,0],
        normals: [0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1], colors: Array(12).fill(255), indices: [] };
      cutBarkChip(b, [0,1,2,3], 0.15, 0.8, 0.12, 0.18, 0.03, { kind, lean, age: 0.3 });
      assert.equal(b.indices.length / 3, 16);
      let area = 0;
      for (let i = 0; i < b.indices.length; i += 3) {
        const [a, c, d] = b.indices.slice(i, i + 3).map(j => new Vector3().fromArray(b.verts, 3 * j));
        const projected = -c.sub(a).cross(d.sub(a)).z / 2;
        assert(projected > 0, kind);
        area += projected;
      }
      assert(Math.abs(area - 1) < 1e-8);
    }
  }
});

test('recessed bark chips survive ring reduction and fit inside the tree budget', () => {
  const tree = new Tree();
  tree.loadPreset('Ash Medium');
  const detail = tree.fitTriangleBudget(25000, { thinLeaves: true });
  const count = tree.skeleton.branches.filter(b => b.chip?.threshold < tree.options.bark.damage).length;
  assert(count > 0);
  for (const level of [detail, { sectionStride: 1, segmentFactor: 1, leafScale: 0 }]) {
    tree.options.bark.damage = 0.25;
    const { branches, leaves } = tree.createGeometry(level);
    if (level === detail) assert((branches.index.count + leaves.index.count) / 3 <= 25000);
    tree.options.bark.damage = 0;
    const clean = tree.createGeometry(level).branches;
    assert.equal(branches.index.count - clean.index.count, 42 * count);
    assert.equal(branches.attributes.color.count, branches.attributes.position.count);
    assert(branches.attributes.color.array.some(v => v < 255));
    assert(clean.attributes.color.array.every(v => v === 255));
  }
});

test('tapered side branches have outward normals perpendicular to the sloping bark', () => {
  const tree = new Tree();
  tree.options.bark.damage = 0; // Compare uninterrupted rows of tapering bark.
  const branch = tree.options.branch;
  branch.structureVariation = 0;
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
