import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Box3, Group, Mesh, Vector3 } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Tree } from '../build/ez-tree.es.js';
import { LODManager } from '../src/app/lod-management.js';
import { constrainLowerLODBounds, fitsSize, regrowToSize } from '../src/app/size-fit.js';
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

test('size limits regrow the crown while preserving leaf size and trunk thickness', () => {
  const tree = new Tree(); tree.loadPreset('Ash Small');
  const originalSizes = tree.skeleton.leaves.map(leaf => leaf.size);
  const trunkRadius = tree.skeleton.branches[0].baseRadius;
  const originalBranches = tree.skeleton.branches.length;
  const originalTip = tree.skeleton.branches[0].sections.at(-1).origin.toArray();
  tree.options.bounds.enabled = true;
  tree.options.bounds.max = { x: 3, y: 4, z: 2 };
  const details = [{ leafDetail: 'thin' }, { leafDetail: 'thin', leafScale: 2 }, { leafDetail: 'micro' }];
  const manager = new LODManager(tree, details);
  assert(regrowToSize(tree, manager, details).fitted);
  assert.deepEqual(tree.skeleton.leaves.map(leaf => leaf.size), originalSizes);
  assert.equal(tree.skeleton.branches[0].baseRadius, trunkRadius);
  assert.equal(tree.skeleton.branches.length, originalBranches);
  assert(new Set(Object.values(tree.options.bounds.growthScale).map(value => value.toFixed(3))).size > 1);
  assert.deepEqual(tree.scale.toArray(), [1, 1, 1]);
  constrainLowerLODBounds(manager, details, tree.options.bounds.max);
  for (const detail of details) assert(fitsSize(manager.boundsFor(detail), tree.options.bounds.max));
  const base = manager.boundsFor(details[0]).getSize(new Vector3()).toArray();
  const fingerprint = () => {
    const { branches, leaves } = tree.createGeometry(details[0]);
    const hash = createHash('sha256');
    for (const geometry of [branches, leaves]) {
      hash.update(Buffer.from(geometry.attributes.position.array.buffer));
      geometry.dispose();
    }
    return hash.digest('hex');
  };
  const originalGeometry = fingerprint();
  details[1] = { leafDetail: 'thin', leafScale: 0.5 };
  manager.reconcile();
  constrainLowerLODBounds(manager, details, tree.options.bounds.max);
  assert.deepEqual(manager.boundsFor(details[0]).getSize(new Vector3()).toArray(), base);
  assert.equal(fingerprint(), originalGeometry);
  assert.deepEqual(tree.position.toArray(), [0, 0, 0]);
  tree.options.bounds.enabled = false;
  regrowToSize(tree, manager, details);
  assert.deepEqual(tree.skeleton.branches[0].sections.at(-1).origin.toArray(), originalTip);
});

test('height-limited oak keeps its upright trunk and attached limbs', () => {
  const tree = new Tree(); tree.loadPreset('Oak Medium');
  tree.options.seed = 85;
  tree.options.bounds.enabled = true;
  tree.options.bounds.growthScale = { x: 1, y: 0.25, z: 1 };
  tree.generate({ leafDetail: 'micro' });
  const trunk = tree.skeleton.branches[0], base = trunk.sections[0].origin;
  for (const i of [trunk.forkRing, trunk.sections.length - 1]) {
    if (i === undefined) continue;
    const tip = trunk.sections[i].origin;
    assert(Math.hypot(tip.x - base.x, tip.z - base.z) < 1e-8);
  }
  for (const branch of tree.skeleton.branches) {
    if (!branch.attachment || branch.surfaceRoot) continue;
    const { a, b, f } = branch.attachment;
    const expected = a.origin.clone().lerp(b.origin, f);
    assert(branch.sections[0].origin.distanceTo(expected) < 1e-5);
  }
});

test('nonbinding limits leave generated branch paths untouched', () => {
  const tree = new Tree(); tree.loadPreset('Oak Small');
  const before = tree.skeleton.branches.map(branch => branch.sections.map(section => section.origin.toArray()));
  tree.options.bounds.enabled = true;
  tree.options.bounds.max = { x: 1000, y: 1000, z: 1000 };
  const details = [{ leafDetail: 'thin' }], manager = new LODManager(tree, details);
  assert(regrowToSize(tree, manager, details).fitted);
  assert.deepEqual(tree.skeleton.branches.map(branch => branch.sections.map(section => section.origin.toArray())), before);
});

test('unattainable size limits restore the original instead of clipping fixed-size features', () => {
  const tree = new Tree(); tree.options.branch.levels = 0; tree.options.leaves.count = 0;
  tree.generate();
  const originalTip = tree.skeleton.branches[0].sections.at(-1).origin.toArray();
  tree.options.bounds.enabled = true;
  tree.options.bounds.max = { x: 0.01, y: 0.01, z: 0.01 };
  const details = [{ leafDetail: 'thin' }], manager = new LODManager(tree, details);
  assert.equal(regrowToSize(tree, manager, details).fitted, false);
  assert.deepEqual(tree.options.bounds.growthScale, { x: 1, y: 1, z: 1 });
  assert.deepEqual(tree.skeleton.branches[0].sections.at(-1).origin.toArray(), originalTip);
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

test('regrown size-limited geometry exports without a model scaling transform', async () => {
  const tree = new Tree();
  tree.options.branch.levels = 0; tree.options.leaves.count = 8;
  tree.options.bounds.enabled = true;
  tree.options.bounds.max = { x: 2, y: 3, z: 2 };
  tree.generate({ leafDetail: 'thin' });
  const manager = new LODManager(tree, [{ leafDetail: 'thin' }]);
  assert(regrowToSize(tree, manager, manager.details).fitted);
  const model = new Group(); model.name = 'Tree';
  const geometry = tree.createGeometry(manager.details[0]);
  for (const [mesh, shape] of [[tree.branchesMesh, geometry.branches], [tree.leavesMesh, geometry.leaves]]) {
    const copy = new Mesh(shape, mesh.material.clone());
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
    assert.deepEqual(model.scale.toArray(), [1, 1, 1]);
  } finally { globalThis.FileReader = previous; }
});
