import assert from 'node:assert/strict';
import test from 'node:test';
import { DoubleSide, FrontSide, Vector2, Vector3 } from 'three';
import { LeafType, Tree, TreePreset } from '../build/ez-tree.es.js';

test('the full, reduced and coarse blades enclose a volume', () => {
  for (const type of Object.values(LeafType)) {
    for (const leafDetail of ['full', 'reduced', 'coarse']) {
      const tree = new Tree();
      tree.options.leaves.type = type;
      tree.options.branch.levels = 0;
      tree.options.leaves.count = 1;
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

test('each shipped preset fits the budget with closed or thin blades, including its visible trellis', () => {
  for (const preset of Object.keys(TreePreset)) {
    const tree = new Tree();
    tree.loadPreset(preset);
    const target = 25000;
    for (const thinLeaves of [false, true]) {
      const detail = tree.fitTriangleBudget(target, { thinLeaves });
      const { branches, leaves } = tree.createGeometry(detail);
      let triangles = (branches.index.count + leaves.index.count) / 3;
      tree.trellisMesh?.traverseVisible(mesh => { if (mesh.isMesh) triangles += mesh.geometry.index.count / 3; });
      assert(triangles <= target && leaves.index.count > 0, preset);
      assert.equal(leaves.userData.doubleSided, thinLeaves);
      if (preset === 'Ash Medium') {
        assert.equal(leaves.userData.leafSites, thinLeaves ? 1434 : 385);
        assert.equal(triangles, thinLeaves ? 24992 : 24192);
      }
    }
  }
});

test('thin blades have opaque textured surfaces, usable normals and species-specific outlines', () => {
  const costs = { ash: 12, oak: 6, aspen: 4, pine: 10 };
  for (const [type, triangles] of Object.entries(costs)) {
    const tree = new Tree();
    tree.options.leaves.type = type;
    tree.options.branch.levels = 0;
    tree.options.leaves.count = 10;
    tree.generate({ leafDetail: 'thin', leafStride: 1.72 });
    const { geometry: g, material } = tree.leavesMesh;
    const count = Math.ceil(tree.skeleton.leaves.length / 1.72);
    assert.equal(g.userData.leafSites, count);
    assert.equal(g.index.count / 3, count * triangles);
    assert.equal(material.side, DoubleSide);
    assert.equal(material.transparent, false);
    assert.equal(material.alphaTest, 0);
    const { position, normal, uv, leafFlex } = g.attributes;
    for (let i = 0; i < g.index.count; i += 3) {
      const ids = [0, 1, 2].map(j => g.index.getX(i + j));
      const [a, b, c] = ids.map(id => new Vector3().fromBufferAttribute(position, id));
      const [u, v, w] = ids.map(id => new Vector2().fromBufferAttribute(uv, id));
      assert(b.sub(a).cross(c.sub(a)).lengthSq() > 0, type);
      assert(v.sub(u).cross(w.sub(u)) > 0, type);
    }
    for (let i = 0; i < normal.count; i++) {
      assert(Math.abs(new Vector3().fromBufferAttribute(normal, i).length() - 1) < 0.00001);
    }
    const bladeRoots = Array.from({ length: uv.count / count }, (_, i) => i).filter(i => uv.getY(i) === 0);
    assert.equal(bladeRoots.length, { ash: 6, oak: 1, aspen: 1, pine: 5 }[type]);
    assert.equal(leafFlex.getX(0), 0);
    assert.deepEqual(tree.createGeometry({ leafDetail: 'thin', leafStride: 1.72 }).leaves.attributes.position.array, position.array);
  }
});

test('mixed LODs render both sides of thin leaves and share the same wind time', () => {
  const tree = new Tree();
  tree.options.branch.levels = 0;
  tree.generateLODs(['full', 'thin', 'thin'].map((leafDetail, distance) => ({ distance, detail: { leafDetail } })));
  const materials = tree.lod.levels.map(level => level.object.children[1].material);
  assert.deepEqual(materials.map(m => m.side), [FrontSide, DoubleSide, DoubleSide]);
  assert.equal(materials[1], materials[2]);
  for (const material of new Set(materials)) {
    material.onBeforeCompile({ uniforms: {}, vertexShader: '' });
  }
  tree.update(3);
  for (const material of materials) assert.equal(material.userData.shader.uniforms.uTime.value, 3);
  let disposed = 0;
  materials[1].addEventListener('dispose', () => disposed++);
  tree.generate();
  assert.equal(disposed, 1);
  assert.equal(tree.leavesMesh.material.side, FrontSide);
});

test('bark UVs follow the trunk and retain the same coordinates when rings are skipped', () => {
  const tree = new Tree();
  tree.loadPreset('Oak Medium');
  const full = tree.branchesMesh.geometry.attributes.uv;
  const reduced = tree.createGeometry({ sectionStride: 3 }).branches.attributes.uv;
  const rowSize = tree.options.branch.segments[0] + 1;
  const sections = tree.options.branch.sections[0];
  for (let ring = 1; ring <= sections; ring++) {
    assert(full.getY(ring * rowSize) > full.getY((ring - 1) * rowSize));
    if (ring % 3 === 0) assert.equal(reduced.getY(ring / 3 * rowSize), full.getY(ring * rowSize));
  }
});

test('compound leaflets have individual surface UVs while the whole leaf shares one wind attachment', () => {
  const tree = new Tree();
  tree.loadPreset('Ash Small');
  const { uv, leafFlex } = tree.leavesMesh.geometry.attributes;
  const perLeaf = uv.count / tree.skeleton.leaves.length;
  let leafletRoots = 0;
  for (let i = 0; i < perLeaf; i++) {
    if (uv.getY(i) === 0 && leafFlex.getX(i) > 0) {
      assert.equal(uv.getX(i), 0.5);
      leafletRoots++;
    }
  }
  assert.equal(leafletRoots, 5);
  assert.equal(leafFlex.getX(0), 0);
});
