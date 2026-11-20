import assert from 'node:assert/strict';
import test from 'node:test';
import { Texture, Vector3 } from 'three';
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
  tree.options.bark.damage = 0.25;
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
  branch.limbBends = 0;
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

test('lateral branches have a geometric collar that tapers away from the junction', () => {
  const tree = new Tree(); tree.loadPreset('Oak Small');
  tree.options.bark.damage = 0;
  tree.generate();
  const position = tree.branchesMesh.geometry.attributes.position;
  let first = 0;
  for (const branch of tree.skeleton.branches) {
    const row = branch.segmentCount + 1;
    if (branch.attachment && branch.attachment.a !== branch.attachment.b && !branch.fineTwig) {
      const { sections } = branch;
      const start = new Vector3().fromBufferAttribute(position, first).distanceTo(sections[0].origin);
      assert(Math.abs(start / sections[0].radius - 1.3) < 1e-5);
      const last = new Vector3().fromBufferAttribute(position, first + (sections.length - 1) * row)
        .distanceTo(sections.at(-1).origin);
      assert(last / sections.at(-1).radius < 1.05);
      return;
    }
    first += branch.sections.length * row;
  }
  assert.fail('Expected a lateral branch');
});

test('bark UV phases vary between limbs and reproduce for the same seed', () => {
  const tree = new Tree(); tree.loadPreset('Ash Small'); tree.options.bark.damage = 0; tree.generate();
  const offsets = tree.skeleton.branches.filter(branch => branch.barkOffset > 0).map(branch => branch.barkOffset);
  assert(offsets.length > 10);
  assert(new Set(offsets.map(value => value.toFixed(4))).size > 10);
  const uv = tree.branchesMesh.geometry.attributes.uv.array.slice();
  tree.generate();
  assert.deepEqual(tree.branchesMesh.geometry.attributes.uv.array, uv);
});

test('photo bark UVs wrap once around the trunk and survive ring reduction', () => {
  const tree = new Tree(); tree.options.branch.levels = 0;
  tree.options.branch.surfaceRoots = false; tree.options.bark.damage = 0;
  tree.options.bark.type = 'PhotoSmooth';
  tree.options.bark.maps.color = new Texture();
  tree.options.bark.maps.color.userData.uvAspect = 4328 / 2836;
  tree.generate();
  const full = tree.branchesMesh.geometry.attributes.uv;
  const reduced = tree.createGeometry({ sectionStride: 3 }).branches.attributes.uv;
  const row = tree.skeleton.branches[0].segmentCount + 1;
  const rings = tree.skeleton.branches[0].sections.length;
  for (let i = 0; i < rings; i++) {
    const first = i * row, last = first + row - 1;
    assert(Math.abs((full.getX(last) - full.getX(first)) - Math.round(full.getX(last) - full.getX(first))) < 1e-5);
    assert.equal(full.getY(first), full.getY(last));
  }
  assert.equal(full.getX(0), 0);
  assert.equal(full.getX(row - 1), 1);
  assert.equal(full.getX(row), 0);
  for (let i = 0; i < reduced.count; i += row) {
    const match = Array.from({ length: rings }, (_, j) => j * row)
      .some(j => Math.abs(full.getX(j) - reduced.getX(i)) < 1e-6 && Math.abs(full.getY(j) - reduced.getY(i)) < 1e-6);
    assert(match);
  }
});
