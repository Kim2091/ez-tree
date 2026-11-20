import assert from 'node:assert/strict';
import test from 'node:test';
import { DoubleSide, FrontSide, Line3, Quaternion, ShaderLib, Texture, Vector2, Vector3 } from 'three';
import { LeafType, Tree, TreePreset } from '../build/ez-tree.es.js';

test('increasing damage keeps earlier wounds and their leaf identities across LODs', () => {
  const tree = new Tree();
  tree.options.branch.levels = 0;
  tree.options.leaves.count = 48;
  for (const type of Object.values(LeafType)) {
    tree.options.leaves.type = type;
    tree.generate({ leafDetail: 'thin' });
    let reference;
    for (const leafDetail of ['thin', 'coarse', 'reduced', 'full']) {
      const meshes = [0, 0.35, 1].map(damage => {
        tree.options.leaves.damage = damage;
        return tree.createGeometry({ leafDetail }).leaves;
      });
      const [clean, mixed, worn] = meshes.map(g => g.attributes.position.array);
      assert.deepEqual(meshes[0].index.array, meshes[2].index.array);
      const size = clean.length / tree.skeleton.leaves.length;
      const ids = [];
      for (let start = 0; start < clean.length; start += size) {
        const part = data => data.subarray(start, start + size);
        assert.notDeepEqual(part(clean), part(worn));
        if (part(mixed).some((v, i) => v !== clean[start + i])) {
          ids.push(start / size);
          assert.deepEqual(part(mixed), part(worn));
        }
      }
      assert(ids.length && ids.length < tree.skeleton.leaves.length);
      if (reference) assert.deepEqual(ids, reference);
      reference = ids;
    }
  }
});

test('the upper surfaces of both opposite ash leaflets face the same side of the stalk', () => {
  const tree = new Tree();
  tree.options.branch.levels = 0;
  tree.options.leaves.type = LeafType.Ash;
  tree.options.leaves.maps.normal = new Texture();
  tree.options.leaves.maps.normal.channel = 1;
  tree.options.leaves.textured = true;
  for (const leafDetail of ['full', 'reduced', 'coarse', 'thin']) {
    tree.generate({ leafDetail });
    const g = tree.leavesMesh.geometry;
    const { origin, size, orientation } = tree.skeleton.leaves[0];
    const inverse = new Quaternion().setFromEuler(orientation).invert();
    const upper = [new Vector3(), new Vector3()];
    for (let i = 0; i < g.index.count / tree.skeleton.leaves.length; i += 3) {
      const indices = [0, 1, 2].map(j => g.index.getX(i + j));
      if (g.attributes.uv1.getX(indices[0]) >= 0.5) continue;
      const [a, b, c] = indices.map(j => new Vector3().fromBufferAttribute(g.attributes.position, j)
        .sub(origin).applyQuaternion(inverse).divideScalar(size));
      const x = (a.x + b.x + c.x) / 3;
      if (Math.abs(x) > 0.10) upper[Number(x > 0)].add(b.sub(a).cross(c.sub(a)));
    }
    for (const normal of upper) assert(normal.normalize().z > 0.85, leafDetail);
  }
});

test('shoot variation changes only baked pigment and stays consistent across blade resolutions', () => {
  const tree = new Tree();
  tree.options.branch.levels = 0;
  tree.options.leaves.type = LeafType.Ash;
  tree.options.leaves.count = 12;
  tree.generate({ leafDetail: 'thin' });
  const natural = tree.leavesMesh.geometry;
  const sites = tree.skeleton.leaves;
  assert(sites[0].pigment > sites[1].pigment); // terminal leaf and the basal pair
  for (let i = 1; i < sites.length; i += 2) assert.equal(sites[i].pigment, sites[i + 1].pigment);
  const full = tree.createGeometry({ leafDetail: 'full' }).leaves;
  for (let i = 0; i < sites.length; i++) {
    const root = g => new Vector3().fromBufferAttribute(g.attributes.color, i * g.attributes.color.count / sites.length);
    assert(root(full).equals(root(natural)));
  }
  tree.options.leaves.shootColorVariation = false;
  const plain = tree.createGeometry({ leafDetail: 'thin' }).leaves;
  for (const key of ['position', 'normal', 'uv', 'leafFlex']) {
    assert.deepEqual(natural.attributes[key].array, plain.attributes[key].array);
  }
  assert.deepEqual(natural.index.array, plain.index.array);
  assert.notDeepEqual(natural.attributes.color.array, plain.attributes.color.array);
  tree.options.leaves.shootColorVariation = true;
  tree.generate({ leafDetail: 'thin' });
  assert.deepEqual(natural.attributes.color.array, tree.leavesMesh.geometry.attributes.color.array);
});

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
    tree.options.branch.structureVariation = 0; // Reference seed from before variable forks.
    tree.loadPreset(preset);
    tree.options.bark.damage = 0; // Reference budget for an unchipped trunk.
    const target = 25000;
    for (const thinLeaves of [false, true]) {
      const detail = tree.fitTriangleBudget(target, { thinLeaves });
      const { branches, leaves } = tree.createGeometry(detail);
      let triangles = (branches.index.count + leaves.index.count) / 3;
      tree.trellisMesh?.traverseVisible(mesh => { if (mesh.isMesh) triangles += mesh.geometry.index.count / 3; });
      assert(triangles <= target && leaves.index.count > 0, preset);
      assert.equal(leaves.userData.doubleSided, thinLeaves);
      if (preset === 'Ash Medium') {
        assert.equal(leaves.userData.leafSites, thinLeaves ? 1605 : 385);
        assert.equal(triangles, thinLeaves ? 24972 : 24192);
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

test('only the closest LOD defaults to full blades and explicit overrides win', () => {
  const tree = new Tree();
  tree.options.branch.levels = 0;
  const sides = () => tree.lod.levels.map(level => level.object.children[1].material.side);
  tree.generateLODs();
  assert.deepEqual(sides(), [FrontSide, DoubleSide, DoubleSide]);
  tree.generateLODs([{ distance: 60 }, { distance: 10 }, { distance: 100, detail: { leafDetail: 'coarse' } }]);
  assert.deepEqual(sides(), [FrontSide, DoubleSide, FrontSide]);
});

test('leaf scattering follows the material across LODs and can be disabled without changing topology', () => {
  const tree = new Tree();
  tree.options.branch.levels = 0;
  tree.options.leaves.maps.subsurface = new Texture();
  tree.options.leaves.textured = true;
  tree.generateLODs();
  for (const { object } of tree.lod.levels) {
    const mat = object.children[1].material;
    const shader = { ...ShaderLib.standard, uniforms: {} };
    mat.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uLeafSubsurfaceMap.value, tree.options.leaves.maps.subsurface);
    mat.leafScattering.strength = 0;
    assert.equal(shader.uniforms.uLeafScatterStrength.value, 0);
    assert.equal(mat.transparent, false);
    assert.equal(mat.alphaTest, 0);
    assert.equal(object.children[0].material.leafScattering, undefined);
  }
  const count = tree.leavesMesh.geometry.index.count;
  tree.options.leaves.textured = false;
  tree.generate();
  assert.equal(tree.leavesMesh.material.leafScattering, undefined);
  assert.equal(tree.leavesMesh.geometry.index.count, count);
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
  }
  const originals = Array.from({length: sections + 1}, (_, i) => full.getY(i * rowSize));
  const kept = Array.from({length: Math.ceil(sections / 3) + 1}, (_, i) => reduced.getY(i * rowSize));
  assert.deepEqual(kept, originals.filter(v => kept.includes(v)));
  assert.equal(kept[0], originals[0]);
  assert.equal(kept.at(-1), originals.at(-1));
});

test('thinning preserves ash pairs at the fitted quota and keeps roots on simplified wood', () => {
  const tree = new Tree();
  tree.loadPreset('Ash Medium');
  const detail = tree.fitTriangleBudget(25000, {thinLeaves: true});
  const g = tree.createGeometry(detail).leaves;
  const pos = g.attributes.position, nodes = new Map();
  const step = pos.count / g.userData.leafSites;
  for (let i = 0; i < pos.count; i += step) {
    const key = [pos.getX(i), pos.getY(i), pos.getZ(i)].join(',');
    nodes.set(key, (nodes.get(key) ?? 0) + 1);
  }
  assert([...nodes.values()].filter(n => n === 2).length >= 300);
  assert.deepEqual(tree.createGeometry(detail).leaves.attributes.position.array, pos.array);
  tree.options.branch.levels = 0;
  tree.options.branch.sections[0] = 8;
  tree.generate({leafDetail: 'thin', sectionStride: 16});
  const sections = tree.skeleton.branches[0].sections;
  const trunk = new Line3(sections[0].origin, sections.at(-1).origin);
  const roots = tree.leavesMesh.geometry.attributes.position;
  for (let i = 0; i < roots.count; i += roots.count / tree.skeleton.leaves.length) {
    const p = new Vector3().fromBufferAttribute(roots, i);
    assert(trunk.closestPointToPoint(p, true, new Vector3()).distanceTo(p) < 1e-5);
  }
});

test('each textured broadleaf triangle samples one face and preserves its original blade UVs', () => {
  const tree = new Tree();
  tree.options.branch.levels = 0;
  tree.options.leaves.textured = true;
  tree.options.leaves.maps.normal = new Texture();
  tree.options.leaves.maps.normal.channel = 1;
  for (const leafDetail of ['full', 'reduced', 'coarse', 'thin']) {
    tree.generate({leafDetail});
    const g = tree.leavesMesh.geometry, {uv, uv1} = g.attributes;
    const sides = new Set();
    for (let i = 0; i < g.index.count; i += 3) {
      const ids = [0, 1, 2].map(j => g.index.getX(i + j));
      const side = Math.round(2 * uv1.getX(ids[0]) - uv.getX(ids[0]));
      for (const v of ids) {
        assert(Math.abs(2 * uv1.getX(v) - side - uv.getX(v)) < 1e-6);
        assert.equal(uv1.getY(v), uv.getY(v));
      }
      sides.add(side);
    }
    assert.equal(sides.size, leafDetail === 'thin' ? 1 : 2);
    assert.equal(tree.leavesMesh.material.alphaTest, 0);
  }
});

test('simplified side shoots and terminal continuations stay joined to translated parents', () => {
  const tree = new Tree();
  tree.options.branch.levels = 2;
  for (let i = 0; i <= 2; i++) tree.options.branch.sections[i] = 8;
  tree.generate({sectionStride: 16, leafDetail: 'thin'});
  const p = tree.branchesMesh.geometry.attributes.position;
  const centers = new Map();
  let first = 0, displaced = 0;
  for (const {sections, segmentCount, attachment, chip} of tree.skeleton.branches) {
    const lo = sections[0].origin, hi = sections.at(-1).origin;
    const shift = new Vector3();
    if (attachment) {
      const {a, b, f} = attachment;
      const expected = new Vector3().lerpVectors(centers.get(a), centers.get(b), f);
      const actual = new Vector3();
      for (let j = 0; j < segmentCount; j++) actual.add(new Vector3().fromBufferAttribute(p, first + j));
      assert(actual.divideScalar(segmentCount).distanceTo(expected) < 1e-5);
      shift.subVectors(expected, lo);
      if (shift.length() > 1e-4) displaced++;
    }
    sections.forEach((s, i) => centers.set(s,
      new Vector3().lerpVectors(lo, hi, i / (sections.length - 1)).add(shift)));
    first += 2 * (segmentCount + 1);
    if (chip?.threshold < tree.options.bark.damage) first += 24;
  }
  assert(displaced > 0);
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
