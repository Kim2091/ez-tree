import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Group, Mesh, Vector3 } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Tree } from '../build/ez-tree.es.js';
import { LODManager } from '../src/app/lod-management.js';
import { exportUSD } from '../src/app/usd.js';

test('LOD fitting enforces decreasing budgets without changing LOD0', () => {
  const tree = new Tree(); tree.loadPreset('Oak Medium');
  const base = tree.fitTriangleBudget(25000, { microLeaves: true });
  const details = [base, { leafDetail: 'thin' }, { leafDetail: 'full' }];
  const manager = new LODManager(tree, details);
  const original = structuredClone(details[0]);
  assert(manager.count(details[1]) > manager.count(details[0]));
  assert.deepEqual(manager.reconcile(), [1, 2]);
  assert.deepEqual(details[0], original);
  let counts = details.map(detail => manager.count(detail));
  assert(counts[0] >= counts[1] && counts[1] >= counts[2]);
  details[1] = { leafDetail: 'full' };
  manager.reconcile();
  assert.deepEqual(details[0], original);
  counts = details.map(detail => manager.count(detail));
  assert(counts[0] >= counts[1] && counts[1] >= counts[2]);
  manager.reconcile({ auto: true });
  assert.deepEqual(details[0], original);
  counts = details.map(detail => manager.count(detail));
  assert(counts[0] >= counts[1] && counts[1] >= counts[2]);
});

test('size limits uniformly fit every LOD without changing the LOD0 scale', () => {
  const tree = new Tree(); tree.loadPreset('Ash Small');
  tree.options.bounds.enabled = true;
  tree.options.bounds.max = { x: 3, y: 4, z: 2 };
  const details = [{ leafDetail: 'thin' }, { leafDetail: 'thin', leafScale: 2 }, { leafDetail: 'micro' }];
  const manager = new LODManager(tree, details);
  const base = tree.sizeLimitFactor(manager.boundsFor(details[0]));
  const scales = details.map(detail => Math.min(base, tree.sizeLimitFactor(manager.boundsFor(detail))));
  for (const [i, detail] of details.entries()) {
    const size = manager.boundsFor(detail).getSize(new Vector3()).multiplyScalar(scales[i]);
    assert(size.x <= 3 + 1e-6 && size.y <= 4 + 1e-6 && size.z <= 2 + 1e-6);
  }
  details[1] = { leafDetail: 'thin', leafScale: 0.5 };
  manager.reconcile();
  assert.equal(tree.sizeLimitFactor(manager.boundsFor(details[0])), base);
  assert.deepEqual(tree.position.toArray(), [0, 0, 0]);
});

test('lower main branches can be raised or culled at a trunk clearance', () => {
  const tree = new Tree(); tree.loadPreset('Oak Medium');
  function mainAttachments() {
    const trunk = tree.skeleton.branches[0], sections = new Set(trunk.sections);
    return tree.skeleton.branches.filter(branch => !branch.surfaceRoot && branch.attachment
      && sections.has(branch.attachment.a) && sections.has(branch.attachment.b));
  }
  const original = mainAttachments().length;
  tree.options.branch.clearTrunkHeight = 3;
  tree.options.branch.lowerLimbMode = 'raise';
  tree.generate({ leafDetail: 'micro' });
  const raised = mainAttachments();
  assert.equal(raised.length, original);
  for (const branch of raised) assert(branch.sections[0].origin.y >= 3 - 1e-6);
  tree.options.branch.lowerLimbMode = 'cull';
  tree.generate({ leafDetail: 'micro' });
  const culled = mainAttachments();
  assert(culled.length < raised.length);
  for (const branch of culled) assert(branch.sections[0].origin.y >= 3 - 1e-6);
});

test('size-limited output keeps its transform through GLB and USD export', async () => {
  const tree = new Tree();
  tree.options.branch.levels = 0; tree.options.leaves.count = 8;
  tree.options.bounds.enabled = true;
  tree.options.bounds.max = { x: 2, y: 3, z: 2 };
  tree.generate({ leafDetail: 'thin' });
  const manager = new LODManager(tree, [{ leafDetail: 'thin' }]);
  const scale = tree.sizeLimitFactor(manager.boundsFor(manager.details[0]));
  const model = new Group(); model.name = 'Tree'; model.scale.setScalar(scale);
  for (const mesh of [tree.branchesMesh, tree.leavesMesh]) {
    const copy = new Mesh(mesh.geometry, mesh.material.clone());
    model.add(copy);
  }
  const previous = globalThis.FileReader;
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend(); }); }
  };
  try {
    const glb = await new GLTFExporter().parseAsync(model, { binary: true });
    const loaded = await new GLTFLoader().parseAsync(glb, '');
    const size = new Box3().setFromObject(loaded.scene).getSize(new Vector3());
    assert(size.x <= 2 + 1e-5 && size.y <= 3 + 1e-5 && size.z <= 2 + 1e-5);
    const usd = await exportUSD(model).text();
    assert(usd.includes('matrix4d xformOp:transform'));
    assert(usd.includes(Number(scale.toPrecision(7)).toString()));
  } finally { globalThis.FileReader = previous; }
});
