import assert from 'node:assert/strict';
import test from 'node:test';
import { LeafType, Tree, TreePreset } from '../build/ez-tree.es.js';

test('the surface of each blade or needle encloses a volume at every resolution', () => {
  for (const type of Object.values(LeafType)) {
    for (const leafDetail of ['full', 'reduced', 'coarse']) {
      const tree = new Tree();
      tree.options.leaves.type = type;
      tree.generate({ leafDetail });
      const g = tree.leavesMesh.geometry;
      const numPlacements = tree.skeleton.leaves.length;
      const numVertices = g.attributes.position.count / numPlacements;
      const corners = g.index.count / numPlacements;
      const edges = new Map();
      const positions = g.attributes.position;
      let volume = 0;
      for (let i = 0; i < corners; i += 3) {
        const ids = [0, 1, 2].map(k => g.index.getX(i + k));
        for (const [j, a] of ids.entries()) {
          const b = ids[(j + 1) % 3];
          assert(a !== b && a >= 0 && a < numVertices);
          const key = Math.min(a, b) + '/' + Math.max(a, b);
          const edge = edges.get(key) ?? { count: 0, winding: 0 };
          edge.count++;
          edge.winding += a < b ? 1 : -1;
          edges.set(key, edge);
        }
        const [a, b, c] = ids.map(id => [positions.getX(id), positions.getY(id), positions.getZ(id)]);
        volume += a[0] * (b[1] * c[2] - b[2] * c[1])
          + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
      }
      for (const edge of edges.values()) assert.deepEqual(edge, { count: 2, winding: 0 });
      assert(volume > 0, type + ' ' + leafDetail);
      assert.equal(g.attributes.color.count, g.attributes.position.count);
      assert.equal(tree.leavesMesh.material.transparent, false);
      assert.equal(tree.leavesMesh.material.alphaTest, 0);
      assert.equal(tree.leavesMesh.material.map, null);
    }
  }
});

test('large meshes keep valid indices and regenerate exactly at the same seed', () => {
  const tree = new Tree();
  tree.loadPreset('Ash Medium');
  const geometry = tree.leavesMesh.geometry;
  assert(geometry.attributes.position.count > 65535);
  assert(geometry.index.array instanceof Uint32Array);
  let highest = 0;
  for (const index of geometry.index.array) highest = Math.max(highest, index);
  assert.equal(highest, geometry.attributes.position.count - 1);
  tree.generate();
  assert.deepEqual(tree.leavesMesh.geometry.attributes.position.array, geometry.attributes.position.array);
  tree.options.leaves.count = 0;
  tree.generate();
  assert.equal(tree.leavesMesh.geometry.index.count, 0);
});

test('each shipped preset fits the budget, including its visible trellis', () => {
  for (const preset of Object.keys(TreePreset)) {
    const tree = new Tree();
    tree.loadPreset(preset);
    const target = 25000;
    const detail = tree.fitTriangleBudget(target);
    const { branches, leaves } = tree.createGeometry(detail);
    let triangles = (branches.index.count + leaves.index.count) / 3;
    tree.trellisMesh?.traverseVisible(mesh => { if (mesh.isMesh) triangles += mesh.geometry.index.count / 3; });
    assert(triangles <= target && leaves.index.count > 0, preset);
  }
});
