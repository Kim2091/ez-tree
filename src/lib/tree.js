import * as THREE from 'three';
import RNG from './rng';
import { chipTrianglesAdded, cutBarkChip } from './bark-chip';
import { Branch, applyAttachmentOffset, crownFork, growthIntervals, limbBends } from './branch';
import { TreeType, LeafType } from './enums';
import { bendWillowShoot } from './willow';
import { meshFoliage, trianglesPerLeaf } from './foliage';
import { pruneInteriorLeaves } from './canopy';
import TreeOptions from './options';
import { loadPreset } from './presets/index';
import { Trellis } from './trellis';

const up = new THREE.Vector3(0, 1, 0);
const turn = Math.PI * 2;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));

// The blade's local +Y follows its midrib and +Z is its upper surface.
function leafOrientation(axis, roll) {
  axis.normalize();
  const side = new THREE.Vector3().crossVectors(axis, up);
  if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
  side.normalize().applyAxisAngle(axis, roll);
  const normal = new THREE.Vector3().crossVectors(side, axis);
  return new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, axis, normal));
}

// Sample position, orientation and taper at the same point on the parent.
function sampleBranch(sections, t) {
  const p = THREE.MathUtils.clamp(t, 0, 1) * (sections.length - 1);
  const i = Math.floor(p);
  const a = sections[i], b = sections[Math.min(i + 1, sections.length - 1)];
  const f = p - i;
  return {
    origin: a.origin.clone().lerp(b.origin, f),
    frame: new THREE.Quaternion().setFromEuler(a.orientation)
      .slerp(new THREE.Quaternion().setFromEuler(b.orientation), f),
    radius: THREE.MathUtils.lerp(a.radius, b.radius, f),
    attachment: { a, b, f },
  };
}

// Ease abrupt heading changes over adjacent growth sections. Work on the
// skeleton before creating child branches and leaves, so every attachment
// samples the same curved path at Full detail and reduced LODs. The endpoints
// stay fixed, preserving the branch base and its terminal junction.
function smoothBranchPath(sections) {
  if (sections.length < 4) return;
  const original = sections.map(section => section.origin.clone());
  for (let i = 1; i < sections.length - 1; i++) {
    const midpoint = original[i - 1].clone().add(original[i + 1]).multiplyScalar(0.5);
    sections[i].origin.lerp(midpoint, 0.45);
  }
  for (let i = 1; i < sections.length; i++) {
    const before = sections[i - 1].origin;
    const after = sections[Math.min(i + 1, sections.length - 1)].origin;
    const tangent = after.clone().sub(before);
    if (tangent.lengthSq() < 1e-12) continue;
    tangent.normalize();
    const frame = new THREE.Quaternion().setFromEuler(sections[i].orientation);
    const current = up.clone().applyQuaternion(frame);
    const correction = new THREE.Quaternion().setFromUnitVectors(current, tangent);
    sections[i].orientation.setFromQuaternion(correction.multiply(frame));
  }
}

// Insert interpolated rings between the growth knots. The original knots
// remain exact, including the fork junction; the added rings round the mesh
// without changing the number of growth decisions or random samples.
function refineBranchPath(sections) {
  const refined = [];
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i], b = sections[i + 1];
    const previous = sections[Math.max(0, i - 1)].origin;
    const next = sections[Math.min(sections.length - 1, i + 2)].origin;
    const origin = a.origin.clone().add(b.origin).multiplyScalar(0.5)
      .addScaledVector(b.origin.clone().sub(previous).sub(next.clone().sub(a.origin)), 1 / 16);
    // Cubic interpolation should not overshoot vertically beyond its knots.
    origin.y = THREE.MathUtils.clamp(origin.y, Math.min(a.origin.y, b.origin.y), Math.max(a.origin.y, b.origin.y));
    const frame = new THREE.Quaternion().setFromEuler(a.orientation)
      .slerp(new THREE.Quaternion().setFromEuler(b.orientation), 0.5);
    refined.push(a, { origin, orientation: new THREE.Euler().setFromQuaternion(frame),
      radius: (a.radius + b.radius) * 0.5, distance: (a.distance + b.distance) * 0.5 });
  }
  refined.push(sections.at(-1));
  return refined;
}

// Low, tapered roots radiate from the basal flare and dip beneath the local
// ground plane. They are real mesh branches, not a texture or shadow decal.
function surfaceRootBranches(trunk, seed) {
  const base = trunk.sections[0], radius = base.radius;
  if (radius <= 0.02) return [];
  const rng = new RNG(seed ^ 0x2f39a15b);
  const count = 5 + Math.floor(rng.random() * 3), phase = rng.random(turn);
  const roots = [];
  for (let i = 0; i < count; i++) {
    const angle = phase + turn * (i + rng.random(0.16, -0.16)) / count;
    const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const sideways = new THREE.Vector3(-direction.z, 0, direction.x);
    const length = radius * rng.random(3.6, 2.1);
    const rootRadius = radius * rng.random(0.32, 0.22);
    const bend = rng.random(0.18, -0.18);
    const points = [0, 0.25, 0.55, 0.8, 1].map((t, j) => base.origin.clone()
      .addScaledVector(direction, radius * 0.48 + length * t)
      .addScaledVector(sideways, bend * length * t * t)
      .addScaledVector(up, radius * [0.06, 0.10, 0.03, -0.10, -0.25][j]));
    const sections = points.map((origin, j) => {
      const before = points[Math.max(0, j - 1)], after = points[Math.min(points.length - 1, j + 1)];
      const tangent = after.clone().sub(before).normalize();
      return { origin, orientation: new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, tangent)),
        radius: rootRadius * [1, 0.82, 0.55, 0.27, 0.02][j], distance: length * [0, 0.25, 0.55, 0.8, 1][j] };
    });
    roots.push({ sections, segmentCount: 6, baseRadius: rootRadius, trunk: false, surfaceRoot: true,
      attachment: { a: base, b: base, f: 0 } });
  }
  return roots;
}

function splitTerminalShoot(sections, leaves, firstLeaf, rng, ground = -Infinity) {
  const total = sections.at(-1).distance;
  if (total < 0.18 || rng.random() > 0.55) return null;
  const start = rng.random(0.57, 0.30);
  const base = sampleBranch(sections, start);
  if (base.radius <= 0) return null;
  const azimuth = rng.random(turn);
  const angle = rng.random(0.87, 0.38);
  const axis = new THREE.Vector3(Math.sin(angle) * Math.cos(azimuth), Math.cos(angle),
    Math.sin(angle) * Math.sin(azimuth)).applyQuaternion(base.frame);
  const tipAxis = axis.clone().addScaledVector(up, rng.random(0.44, 0.09)).normalize();
  const length = total * (1 - start) * rng.random(1.32, 0.78);
  const radius = base.radius * rng.random(0.63, 0.45);
  const knots = [];
  const origin = base.origin.clone();
  for (let k = 0; k < 5; k++) {
    const t = k / 4;
    const dir = axis.clone().lerp(tipAxis, THREE.MathUtils.smoothstep(t, 0, 1)).normalize();
    const orientation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    knots.push({ origin: origin.clone(), orientation, distance: length * t,
      radius: radius * (1 - 0.94 * t) });
    origin.addScaledVector(dir, length / 4);
  }
  if (knots.some(knot => knot.origin.y < ground)) return null;
  // Redirect alternate distal nodes as units. Opposite leaves remain paired
  // and the original shoot keeps its terminal bud.
  let previous, move = false;
  for (let i = firstLeaf; i < leaves.length; i++) {
    const leaf = leaves[i], site = leaf.attachment;
    if (site.a === site.b) continue;
    const t = THREE.MathUtils.lerp(site.a.distance, site.b.distance, site.f) / total;
    if (t <= start) continue;
    if (previous !== t) {
      move = !move;
      previous = t;
    }
    if (!move) continue;
    const next = sampleBranch(knots, (t - start) / (1 - start));
    const rotation = next.frame.multiply(sampleBranch(sections, t).frame.invert());
    leaf.orientation.setFromQuaternion(rotation.multiply(new THREE.Quaternion().setFromEuler(leaf.orientation)));
    leaf.origin.copy(next.origin);
    leaf.attachment = next.attachment;
  }
  return { sections: knots, attachment: base.attachment, baseRadius: radius, segmentCount: 3, trunk: false };
}

// Keep both ends, then split the interval with the largest centerline error
// until it has the same number of rings as uniform sampling at this stride.
function branchRings(sections, stride, offsets, forkRing) {
  if (stride === 1 || sections.length < 3) return sections;
  const last = sections.length - 1;
  const spans = Math.ceil(last / stride);
  const ids = forkRing && spans >= 2 ? [0, forkRing, last] : [0, last];
  const point = new THREE.Vector3();
  while (ids.length <= spans) {
    let maxError = -1, best = 0, insert = 0;
    for (let j = 1; j < ids.length; j++) {
      const a = ids[j - 1], b = ids[j];
      for (let i = a + 1; i < b; i++) {
        point.lerpVectors(sections[a].origin, sections[b].origin, (i - a) / (b - a));
        const error = point.distanceToSquared(sections[i].origin);
        if (error > maxError) { maxError = error; best = i; insert = j; }
      }
    }
    ids.splice(insert, 0, best);
  }
  for (let j = 1; j < ids.length; j++) {
    const a = ids[j - 1], b = ids[j];
    for (let i = a + 1; i < b; i++) {
      const shift = new THREE.Vector3().lerpVectors(sections[a].origin, sections[b].origin, (i - a) / (b - a));
      offsets.set(sections[i], shift.sub(sections[i].origin));
    }
  }
  return ids.map(i => sections[i]);
}

// Estimate visible centerline displacement, weighted by projected branch
// area (length times radius). Straight stems can give their rings to leaves.
function branchShapeError(branches, stride, leafSize) {
  if (stride === 1) return 0;
  let error = 0, area = 0;
  const offsets = new Map();
  for (const { sections, baseRadius, forkRing } of branches) {
    offsets.clear();
    branchRings(sections, stride, offsets, forkRing);
    const weight = sections.at(-1).distance * baseRadius;
    area += weight;
    const normalize = Math.max(1e-6, leafSize + baseRadius) * (sections.length - 1);
    for (const shift of offsets.values()) error += shift.length() * weight / normalize;
  }
  return error / Math.max(area, 1e-6);
}

export class Tree extends THREE.Group {
  /**
   * @type {RNG}
   */
  rng;

  /**
   * @type {TreeOptions}
   */
  options;

  /**
   * @type {Branch[]}
   */
  branchQueue = [];
  #windTime = { value: 0 };

  /**
   * @param {TreeOptions} params
   */
  constructor(options = new TreeOptions()) {
    super();
    this.name = 'Tree';
    this.branchesMesh = new THREE.Mesh();
    this.leavesMesh = new THREE.Mesh();
    this.trellisMesh = null;
    this.lod = null;
    this.skeleton = null;
    this.add(this.branchesMesh);
    this.add(this.leavesMesh);
    this.options = options;
  }

  update(elapsedTime) {
    this.#windTime.value = elapsedTime;
  }

  /**
   * Loads a preset tree from JSON 
   * @param {string} preset 
   */
  loadPreset(name) {
    const json = loadPreset(name);
    this.loadFromJson(json);
  }

  /**
   * Loads a tree from JSON
   * @param {TreeOptions} json 
   */
  loadFromJson(json) {
    this.options.copy(json);
    this.generate();
  }

  /**
   * @typedef {Object} LODDetail
   * @property {number} [sectionStride=1] Average spacing of retained rings. The
   *   first and last rings are always kept so branch endpoints stay put
   * @property {number} [segmentFactor=1] Radial segment multiplier;
   *   segments = max(3, round(segmentCount * segmentFactor))
   * @property {number} [leafStride=1] Average spacing between retained leaf sites
   * @property {string} [leafDetail='full'] Blade resolution: full, reduced, coarse or thin
   * @property {boolean} [fineTwigs=true] Include small woody spur shoots
   * @property {number} [leafScale=1] Size multiplier for the kept leaves,
   *   typically 1/sqrt(kept fraction) to preserve canopy coverage
   */

  /**
   * @typedef {Object} LODLevel
   * @property {number} distance Camera distance at which this level activates
   * @property {number} [hysteresis] Switch hysteresis as a fraction of distance
   * @property {LODDetail} [detail] Meshing detail for this level
   */

  /**
   * Default levels for generateLODs(). Use closed blades nearby and thin blades at distance.
   * @type {LODLevel[]}
   */
  static defaultLODLevels = [
    { distance: 0, detail: {} },
    {
      distance: 100,
      hysteresis: 0.05,
      detail: {
        sectionStride: 3,
        segmentFactor: 0.75,
        leafStride: 2,
        leafDetail: 'thin',
        fineTwigs: false,
        // Slightly under the area-preserving sqrt(2): individual leaves are
        // still resolvable at this distance, so a full compensation reads as
        // "bigger leaves" rather than "same canopy".
        leafScale: 1.25,
      },
    },
    {
      distance: 250,
      hysteresis: 0.05,
      detail: {
        sectionStride: 6,
        segmentFactor: 0.4,
        leafStride: 4,
        leafDetail: 'thin',
        fineTwigs: false,
        leafScale: 1.3,
      },
    },
  ];

  /**
   * Generate a new tree
   * @param {LODDetail} detail Mesh resolution to generate
   */
  generate(detail = {}) {
    this.#clearLOD();
    this.#generateSkeleton();

    const buffers = this.#meshSkeleton(detail);
    this.branches = buffers.branches;
    this.leaves = buffers.leaves;

    this.createBranchesGeometry();
    this.createLeavesGeometry();
    this.createTrellis();
  }

  /**
   * Generates the tree as a set of levels of detail hosted in a THREE.LOD
   * object inside this group. The renderer switches levels automatically
   * based on camera distance. Levels share materials by sidedness and use
   * the same wind time uniform.
   * @param {LODLevel[]} levels Level descriptors, in any order
   */
  generateLODs(levels = Tree.defaultLODLevels) {
    this.#clearLOD();
    this.#generateSkeleton();

    const barkMaterial = this.#createBarkMaterial();
    const leafMaterials = new Map();

    this.lod = new THREE.LOD();
    this.lod.name = 'TreeLOD';

    // THREE.LOD sorts its levels by distance internally, so sort here too and
    // let the nearest level own the reused meshes regardless of input order.
    const ordered = [...levels].sort(
      (a, b) => (a.distance ?? 0) - (b.distance ?? 0),
    );

    ordered.forEach((level, index) => {
      const buffers = this.#meshSkeleton({
        ...level.detail, leafDetail: level.detail?.leafDetail ?? (index === 0 ? 'full' : 'thin'),
      });

      let branchesMesh, leavesMesh;
      if (index === 0) {
        // Reuse the existing meshes for the closest level so update(),
        // traversal and the vertex/triangle count getters keep working.
        this.branches = buffers.branches;
        this.leaves = buffers.leaves;
        branchesMesh = this.branchesMesh;
        leavesMesh = this.leavesMesh;
        branchesMesh.geometry.dispose();
        branchesMesh.material.dispose();
        leavesMesh.geometry.dispose();
        leavesMesh.material.dispose();
      } else {
        branchesMesh = new THREE.Mesh();
        leavesMesh = new THREE.Mesh();
      }

      branchesMesh.geometry = this.#buildBufferGeometry(buffers.branches);
      branchesMesh.material = barkMaterial;
      leavesMesh.geometry = this.#buildBufferGeometry(buffers.leaves);
      const twoSided = buffers.leaves.doubleSided;
      if (!leafMaterials.has(twoSided)) leafMaterials.set(twoSided, this.#createLeafMaterial(twoSided));
      leavesMesh.material = leafMaterials.get(twoSided);

      for (const mesh of [branchesMesh, leavesMesh]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }

      const group = new THREE.Group();
      group.add(branchesMesh, leavesMesh);
      this.lod.addLevel(group, level.distance ?? 0, level.hysteresis ?? 0);
    });

    this.add(this.lod);
    this.createTrellis();
  }

  /**
   * Builds branch and leaf geometry at the given detail level without
   * modifying the tree's own meshes. Useful for external instancing or
   * custom LOD systems. Reuses the current skeleton, generating one first
   * if none exists.
   * @param {LODDetail} detail
   * @returns {{ branches: THREE.BufferGeometry, leaves: THREE.BufferGeometry }}
   */
  createGeometry(detail = {}) {
    if (!this.skeleton) {
      this.#generateSkeleton();
    }
    const buffers = this.#meshSkeleton(detail);
    return {
      branches: this.#buildBufferGeometry(buffers.branches),
      leaves: this.#buildBufferGeometry(buffers.leaves),
    };
  }

  /**
   * Build static, instanced leaf meshes for a glTF export. The returned group
   * uses the same leaf selection, damage and attachment offsets as the baked
   * geometry. The caller owns and must dispose each child geometry.
   * @param {LODDetail} detail
   * @param {THREE.Material} material
   * @returns {THREE.Group}
   */
  createInstancedFoliage(detail = {}, material = this.leavesMesh.material) {
    if (!this.skeleton) this.#generateSkeleton();
    const buffers = this.#meshSkeleton(detail, true).leaves;
    const group = new THREE.Group();
    group.name = 'Instanced Leaves';
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(), color = new THREE.Color();
    for (const { template, transforms, colors } of buffers.instances.values()) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(template.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(template.normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(template.uvs, 2));
      if (template.faceUVs) geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(template.faceUVs, 2));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(template.colors, 3));
      geometry.setIndex(template.indices);
      geometry.computeBoundingSphere();
      const mesh = new THREE.InstancedMesh(geometry, material, colors.length / 3);
      mesh.name = 'Leaf instances';
      for (let i = 0; i < mesh.count; i++) {
        const at = i * 8;
        position.fromArray(transforms, at);
        quaternion.fromArray(transforms, at + 3);
        scale.setScalar(transforms[at + 7]);
        mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
        mesh.setColorAt(i, color.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]));
      }
      group.add(mesh);
    }
    return group;
  }

  /**
   * Tears down any LOD state and restores the flat branches/leaves meshes
   * as direct children, so generate() behaves as if LODs never existed.
   */
  #clearLOD() {
    if (!this.lod) return;

    const extraMaterials = new Set();
    this.lod.levels.forEach((level) => {
      for (const mesh of level.object.children) {
        // One level reuses branchesMesh/leavesMesh; their geometry and the
        // shared materials are disposed by whichever generate path runs next.
        if (mesh === this.branchesMesh || mesh === this.leavesMesh) continue;
        mesh.geometry.dispose();
        if (mesh.material !== this.leavesMesh.material && mesh.material !== this.branchesMesh.material) {
          extraMaterials.add(mesh.material);
        }
      }
    });
    for (const material of extraMaterials) material.dispose();

    this.remove(this.lod);
    this.lod = null;
    this.add(this.branchesMesh, this.leavesMesh);
  }

  /**
   * Grows the tree skeleton: the section frames of every branch and the
   * placement of every leaf. All RNG consumption happens here, so any
   * number of meshing passes can run against one skeleton without changing
   * the tree's shape.
   */
  #generateSkeleton() {
    this.skeleton = {
      branches: [],
      leaves: [],
    };

    this.rng = new RNG(this.options.seed);

    // Create the trunk of the tree first
    this.branchQueue.push(
      new Branch(
        new THREE.Vector3(),
        new THREE.Euler(),
        this.options.branch.length[0],
        this.options.branch.radius[0],
        0,
        this.options.branch.sections[0],
        this.options.branch.segments[0],
      ),
    );

    const tipShoots = [];
    while (this.branchQueue.length > 0) {
      const branch = this.branchQueue.shift();
      this.#growBranch(branch, tipShoots);
    }
    for (const shoot of tipShoots) this.skeleton.branches.push(shoot);
    this.skeleton.leaves = pruneInteriorLeaves(this.skeleton.leaves, this.options.leaves.interiorPruning, this.options.seed);
    const occupied = new Set(this.skeleton.leaves.map(leaf => leaf.attachment?.a));
    this.skeleton.branches = this.skeleton.branches.filter(branch => !branch.fineTwig || occupied.has(branch.sections.at(-1)));
    if (this.options.branch.surfaceRoots) {
      this.skeleton.branches.push(...surfaceRootBranches(this.skeleton.branches[0], this.options.seed));
    }
  }

  /**
   * Meshes the current skeleton into geometry buffers at the given detail.
   * Consumes no RNG, so it can run repeatedly with different detail specs.
   * @param {LODDetail} detail
   */
  #meshSkeleton(detail = {}, collectInstances = false) {
    const sectionStride = Math.max(1, Math.floor(detail.sectionStride ?? 1));
    const segmentFactor = detail.segmentFactor ?? 1;
    const leafStride = Math.max(1, detail.leafStride ?? 1);
    const leafScale = detail.leafScale ?? 1;

    const branches = {
      verts: [],
      normals: [],
      indices: [],
      uvs: [],
      colors: [],
      windFactor: []
    };

    const offsets = new Map();
    for (const skeletonBranch of this.skeleton.branches) {
      if (skeletonBranch.fineTwig && detail.fineTwigs === false) {
        // Move the attached leaves back to the parent shoot when its tiny
        // woody spur is omitted. Include any shift from reducing that parent.
        const base = applyAttachmentOffset(skeletonBranch.sections[0].origin.clone(), skeletonBranch.attachment, offsets);
        for (const section of skeletonBranch.sections) offsets.set(section, base.clone().sub(section.origin));
      } else {
        this.#meshBranch(branches, skeletonBranch, sectionStride, segmentFactor, offsets);
      }
    }

    const maps = this.options.leaves.maps;
    const faceUVs = this.options.leaves.textured && (maps?.roughness?.channel === 1 || maps?.normal?.channel === 1);
    const leaves = meshFoliage(this.skeleton.leaves, this.options.leaves, leafStride, leafScale,
      detail.leafDetail, offsets, faceUVs, this.options.seed, collectInstances);
    return { branches, leaves };
  }

  /**
   * Fit a triangle budget using the current skeleton. Estimate the exact cost
   * of each candidate before allocating any vertex buffers. When the target
   * is below the smallest supported mesh, return the lowest-cost result.
   * @param {number} target Maximum triangles, including any visible trellis
   * @param {{thinLeaves?: boolean}} options Use thin blades to retain more occupied leaf sites
   * @returns {LODDetail}
   */
  fitTriangleBudget(target, { thinLeaves = false } = {}) {
    if (!this.skeleton) this.#generateSkeleton();
    let fixed = 0;
    for (const branch of this.skeleton.branches) {
      if (branch.fineTwig) continue;
      if (branch.chip?.threshold < this.options.bark.damage) fixed += chipTrianglesAdded;
    }
    this.trellisMesh?.traverseVisible(o => { if (o.isMesh) fixed += o.geometry.index.count / 3; });
    const count = this.skeleton.leaves.length;
    const bladeDetails = thinLeaves ? ['thin'] : ['full', 'reduced', 'coarse'];
    let best, bestExcess = Infinity, bestPenalty = Infinity;
    for (const sectionStride of [1, 2, 3, 4, 6, 8, 16]) {
      const ringPenalty = thinLeaves
        ? 0.30 * Math.log2(sectionStride) + 2 * branchShapeError(this.skeleton.branches.filter(branch => !branch.fineTwig), sectionStride, this.options.leaves.size)
        : 0.55 * Math.log2(sectionStride);
      for (const segmentFactor of [1, 0.75, 0.5, 0.25]) {
        let branches = fixed;
        for (const { sections, segmentCount, fineTwig } of this.skeleton.branches) {
          if (fineTwig) continue;
          const spans = Math.ceil((sections.length - 1) / sectionStride);
          branches += 2 * spans * Math.max(3, Math.round(segmentCount * segmentFactor));
        }
        for (const [tier, leafDetail] of bladeDetails.entries()) {
          const cost = trianglesPerLeaf(this.options.leaves.type, leafDetail);
          const capacity = Math.max(1, Math.floor((target - branches) / cost));
          const precision = thinLeaves ? 100 : 1;
          const leafStride = Math.min(128, Math.max(1, Math.ceil(count * precision / capacity) / precision));
          const total = branches + Math.ceil(count / leafStride) * cost;
          const excess = Math.max(0, total - target);
          // Prefer preserving occupied leaf sites before spending on blade detail.
          const penalty = 1.8 * Math.log2(leafStride) + tier
            + ringPenalty + 0.4 * Math.log2(1 / segmentFactor);
          if (excess < bestExcess || (excess === bestExcess && penalty < bestPenalty)) {
            bestExcess = excess;
            bestPenalty = penalty;
            best = { sectionStride, segmentFactor, leafStride, leafDetail, fineTwigs: false,
              leafScale: thinLeaves ? Math.min(1.65, Math.sqrt(leafStride))
                : Math.min(1.5, Math.pow(leafStride, 0.25)) };
          }
        }
      }
    }
    return best;
  }

  /**
   * Grows a branch's skeleton, queueing child branches and recording leaf
   * placements. Random choices are recorded here and shared across LODs.
   * @param {Branch} branch
   * @returns
   */
  #growBranch(branch, tipShoots) {
    let sectionOrientation = branch.orientation.clone();
    let sectionOrigin = branch.origin.clone();
    const sectionLength = branch.length / branch.sectionCount;
    let bendX = 0, bendZ = 0;
    const variation = THREE.MathUtils.clamp(this.options.branch.structureVariation ?? 0, 0, 1);
    const forked = this.options.branch.forkedCrown && this.options.type === TreeType.Deciduous && !this.options.trellis.enabled;
    const forkRng = forked ? new RNG(this.options.seed ^ Math.imul(this.skeleton.branches.length + 1, 0x632be5ab)) : null;
    let fork = forked ? crownFork(branch, this.options.branch, forkRng) : null;
    const bends = branch.level > 0 ? THREE.MathUtils.clamp(this.options.branch.limbBends ?? 0, 0, 1) * (branch.scaffold ? 0.52 : 1) : 0;
    const turns = bends ? limbBends(new RNG(this.options.seed ^ Math.imul(this.skeleton.branches.length + 1, 0x94d049bb)),
      branch.attachment?.a === branch.attachment?.b, this.options.type === TreeType.Evergreen) : [];
    let leaderAxis, handoff, leaderBend;
    if (!fork && variation && branch.level === 0 && this.options.type === TreeType.Deciduous) {
      const rng = new RNG(this.options.seed ^ 0x6ac07385);
      const heading = rng.random(turn);
      leaderAxis = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
      handoff = rng.random(0.68, 0.38);
      leaderBend = variation * Math.min(1, 30 * Math.abs(this.options.branch.gnarliness[0])) * rng.random(0.43, 0.20);
    }

    // This information is used for generating child branches after the branch
    // geometry has been constructed
    let sections = [];

    for (let i = 0; i <= branch.sectionCount; i++) {
      let sectionRadius = branch.radius;

      // If final section of final level, set radius to effecively zero
      if (
        i === branch.sectionCount &&
        branch.level === this.options.branch.levels
      ) {
        sectionRadius = 0.001;
      } else if (this.options.type === TreeType.Deciduous) {
        const t = i / branch.sectionCount;
        const taper = this.options.branch.taper[branch.level];
        sectionRadius *= 1 - taper * t * (fork ? 0.67 : 1);
        if (fork) {
          const transfer = THREE.MathUtils.smoothstep(t, fork.at, Math.min(1, fork.at + 0.23));
          sectionRadius *= 1 - transfer * (1 - fork.remaining);
        }
      } else if (this.options.type === TreeType.Evergreen) {
        // Evergreens do not have a terminal branch so they have a taper of 1
        sectionRadius *= 1 - (i / branch.sectionCount);
      }

      // Use this information later on when generating child branches
      sections.push({
        origin: sectionOrigin.clone(),
        orientation: sectionOrientation.clone(),
        radius: sectionRadius,
        distance: i * sectionLength,
      });
      if (i === branch.sectionCount) break;

      sectionOrigin.add(
        new THREE.Vector3(0, sectionLength, 0).applyEuler(sectionOrientation),
      );

      // Perturb the orientation of the next section randomly. The higher the
      // gnarliness, the larger potential perturbation
      const gnarliness = Math.abs(this.options.branch.gnarliness[branch.level]);
      const drift = 1 - 0.62 * bends;
      bendX = 0.62 * bendX + drift * this.rng.random(gnarliness, -gnarliness);
      bendZ = 0.62 * bendZ + drift * this.rng.random(gnarliness, -gnarliness);
      sectionOrientation.x += bendX;
      sectionOrientation.z += bendZ;

      // Apply growth force to the branch
      const qSection = new THREE.Quaternion().setFromEuler(sectionOrientation);

      const qTwist = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        this.options.branch.twist[branch.level],
      );

      qSection.multiply(qTwist);
      if (fork) {
        // The parent yields in the opposite direction to the new stem.
        const end = Math.min(1, fork.at + 0.30);
        const step = THREE.MathUtils.smoothstep((i + 1) / branch.sectionCount, fork.at, end)
          - THREE.MathUtils.smoothstep(i / branch.sectionCount, fork.at, end);
        if (step) qSection.multiply(new THREE.Quaternion().setFromAxisAngle(fork.axis, -fork.deflection * step));
      }
      if (leaderBend) {
        // A lateral bud takes over the leader partway up the trunk; the lower
        // bole stays upright and the upper stem carries the change of heading.
        const transfer = t => THREE.MathUtils.smoothstep(t, handoff - 0.16, handoff + 0.16);
        const step = transfer((i + 1) / branch.sectionCount) - transfer(i / branch.sectionCount);
        qSection.premultiply(new THREE.Quaternion().setFromAxisAngle(leaderAxis, leaderBend * step));
      }

      // Rotate the section's growth direction toward force.direction (positive
      // strength) or away from it (negative). The (sectionUp × target) axis
      // makes force.direction behave as a real world axis: when sectionUp is
      // already aligned with target the rotation is zero, so a vertical trunk
      // with force=(0,1,0) doesn't get gnarliness drift amplified — the old
      // slerp form was degenerate at qForce=identity and pushed branches in
      // whatever random direction the section had drifted.
      const sectionUp = new THREE.Vector3(0, 1, 0).applyQuaternion(qSection);
      let pitch = 0, yaw = 0, activity = 0;
      for (const bud of turns) {
        const start = bud.at - bud.width, end = bud.at + bud.width;
        const weight = THREE.MathUtils.smoothstep((i + 1) / branch.sectionCount, start, end)
          - THREE.MathUtils.smoothstep(i / branch.sectionCount, start, end);
        pitch += bends * weight * bud.pitch;
        yaw += bends * weight * bud.yaw;
        activity += weight;
      }
      if (branch.sweep) {
        pitch += (1 - bends) * branch.sweep * (2.8 * (i + 0.5) / branch.sectionCount - 1) / branch.sectionCount;
      }
      if (pitch || yaw) {
        const liftAxis = new THREE.Vector3().crossVectors(sectionUp, up);
        if (liftAxis.lengthSq() < 1e-8 && bends) {
          liftAxis.set(1, 0, 0).applyQuaternion(qSection);
          liftAxis.y = 0;
        }
        if (liftAxis.lengthSq() > 1e-8) qSection.premultiply(new THREE.Quaternion().setFromAxisAngle(liftAxis.normalize(), pitch));
        if (yaw) qSection.premultiply(new THREE.Quaternion().setFromAxisAngle(up, yaw));
        sectionUp.copy(up).applyQuaternion(qSection);
      }
      const target = new THREE.Vector3()
        .copy(this.options.branch.force.direction)
        .normalize();
      const axis = new THREE.Vector3().crossVectors(sectionUp, target);
      const sinFull = axis.length();
      if (sinFull > 1e-6) {
        axis.divideScalar(sinFull);
        const fullAngle = Math.atan2(sinFull, sectionUp.dot(target));
        // A new bud responds to overhead light more strongly than the
        // established run it follows. Other force directions remain usable.
        const overhead = Math.max(0, target.y) * (this.options.branch.force.strength > 0 ? bends : 0);
        let responseToLight = 1 - 0.94 * overhead * (1 - Math.min(1, activity));
        if (fork && i / branch.sectionCount >= fork.at && this.options.branch.force.strength > 0) {
          responseToLight *= 1 - 0.72 * Math.max(0, target.y);
        }
        const step = responseToLight * this.options.branch.force.strength / Math.max(sectionRadius, 0.12);
        // Ease the response near the light direction so fine twigs retain
        // their own headings instead of all snapping upright.
        const response = step > 0 ? 1 - variation * (1 - Math.min(1, fullAngle * 0.8)) : 1;
        const clamped = Math.max(-fullAngle, Math.min(fullAngle, step)) * response;
        qSection.premultiply(
          new THREE.Quaternion().setFromAxisAngle(axis, clamped),
        );
      }

      if (this.options.leaves.type === LeafType.Willow) bendWillowShoot(qSection, branch.level, branch.sectionCount);

      // Apply trellis force if enabled
      if (this.options.trellis.enabled) {
        const trellisResult = this.calculateTrellisForce(sectionOrigin, sectionRadius);
        if (trellisResult) {
          const qTrellis = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            trellisResult.direction,
          );
          qSection.rotateTowards(qTrellis, trellisResult.strength);
        }
      }

      sectionOrientation.setFromQuaternion(qSection);
    }

    // Branchlets stop at the local ground plane instead of continuing
    // underground. This can be disabled for trees above a drop-off. Keep the
    // intersection as a terminal ring so attachments remain on the wood.
    let grounded = false;
    if (this.options.branch.stopAtGround && branch.level > 0) {
      const ground = 0.03;
      const crossing = sections.findIndex((section, i) => i > 0 && section.origin.y < ground);
      if (crossing > 0) {
        const a = sections[crossing - 1], b = sections[crossing];
        const fraction = THREE.MathUtils.clamp((a.origin.y - ground) / (a.origin.y - b.origin.y), 0, 1);
        if (crossing === 1 && fraction < 0.001) return;
        const frame = new THREE.Quaternion().setFromEuler(a.orientation)
          .slerp(new THREE.Quaternion().setFromEuler(b.orientation), fraction);
        sections = sections.slice(0, crossing);
        sections.push({ origin: a.origin.clone().lerp(b.origin, fraction),
          orientation: new THREE.Euler().setFromQuaternion(frame),
          radius: Math.max(0.001, THREE.MathUtils.lerp(a.radius, b.radius, fraction) * 0.15),
          distance: THREE.MathUtils.lerp(a.distance, b.distance, fraction) });
        grounded = true;
        // A clipped parent no longer has the original normalized fork domain.
        fork = null;
      }
    }
    if (branch.level > 0) {
      smoothBranchPath(sections);
      sections = refineBranchPath(sections);
      if (fork) fork.ring *= 2;
    }

    const chipRng = new RNG(this.options.seed ^ Math.imul(this.skeleton.branches.length + 1, 0x85ebca6b));
    const chip = branch.radius > 0.045 && branch.length > 0.12 ? {
      threshold: chipRng.random() * (branch.level === 0 ? 0.24 : 1),
      height: chipRng.random(0.77, 0.16), angle: chipRng.random(), lean: chipRng.random(0.65, -0.65),
      kind: ['sliver', 'split', 'scrape'][Math.floor(chipRng.random() * 3)], age: chipRng.random(),
    } : null;
    this.skeleton.branches.push({
      chip,
      forkRing: fork?.ring,
      sections,
      segmentCount: branch.segmentCount,
      baseRadius: branch.radius,
      // A stable independent phase prevents identical bark features from
      // lining up on neighboring limbs, without changing growth randomness.
      barkOffset: branch.level === 0 ? 0 : new RNG(this.options.seed ^ Math.imul(this.skeleton.branches.length + 1, 0x6c8e9cf5)).random(),
      trunk: branch.level === 0,
      attachment: branch.attachment,
    });

    const firstLeaf = this.skeleton.leaves.length;
    // Deciduous trees have a terminal branch that grows out of the
    // end of the parent branch
    if (this.options.type === 'deciduous') {
      const lastSection = sections[sections.length - 1];
      const endAttachment = { a: lastSection, b: lastSection, f: 0 };

      if (branch.level < this.options.branch.levels && !grounded) {
        const extension = new Branch(
          lastSection.origin, lastSection.orientation,
          this.options.branch.length[branch.level + 1] * branch.vigor
            * (branch.level === 0 ? (this.options.branch.leaderScale ?? 1) : 1),
          lastSection.radius, branch.level + 1,
          // Match the last ring of the parent at this continuation.
          branch.sectionCount, branch.segmentCount, branch.vigor, endAttachment,
        );
        extension.scaffold = Boolean(fork || branch.scaffold);
        this.branchQueue.push(extension);
      } else if (branch.level === this.options.branch.levels && !grounded) {
        let orientation = lastSection.orientation;
        if (this.options.leaves.type !== 'pine') {
          // A terminal petiole continues the shoot, then bends as the blade opens.
          // Its roll follows the sky even when the supporting wood has twisted.
          const rng = new RNG(this.options.seed ^ Math.imul(this.skeleton.branches.length, 0x85ebca6b));
          const azimuth = rng.random(turn);
          const opening = THREE.MathUtils.degToRad(this.options.leaves.angle * rng.random(0.58, 0.36));
          const axis = new THREE.Vector3(Math.cos(azimuth) * Math.sin(opening), Math.cos(opening),
            Math.sin(azimuth) * Math.sin(opening)).applyEuler(lastSection.orientation);
          axis.y = axis.y * 0.70 - 0.08;
          orientation = leafOrientation(axis, rng.random(0.46, -0.46));
        }
        this.#recordLeaf(lastSection.origin, orientation, 1, endAttachment);
      }
    }

    // If we are on the last branch level, generate leaves
    if (branch.level === this.options.branch.levels) {
      this.generateLeaves(sections, branch.vigor, tipShoots);
    } else if (branch.level < this.options.branch.levels) {
      if (this.options.type === TreeType.Evergreen && branch.level === 0) {
        this.generateLeaves(sections.slice(-2), 0.32);
      }
      const count = this.options.branch.children[branch.level];
      this.generateChildBranches(
        this.options.type === TreeType.Evergreen && branch.level > 0
          ? Math.round(count * Math.min(1, 0.24 + branch.vigor)) : count,
        branch.level + 1,
        sections, branch.vigor, fork);
    }

    if (firstLeaf < this.skeleton.leaves.length) {
      // A separate seed keeps pigment independent of the growth RNG and blade shape.
      const shoot = new RNG(this.options.seed ^ Math.imul(this.skeleton.branches.length, 0x9e3779b1)).random();
      const length = sections.at(-1).distance;
      for (let i = firstLeaf; i < this.skeleton.leaves.length; i++) {
        const leaf = this.skeleton.leaves[i];
        const { a, b, f } = leaf.shootAttachment ?? leaf.attachment;
        const distance = THREE.MathUtils.lerp(a.distance, b.distance, f);
        const tip = length > 0 ? THREE.MathUtils.smoothstep(distance / length, 0.45, 1) : 0;
        leaf.pigment = 0.80 * shoot - 0.65 + (0.28 + 0.55 * shoot) * tip;
      }
    }
    if (forked && branch.level > 0 && branch.level === this.options.branch.levels) {
      // Several buds can form side shoots along a growing terminal branch.
      // Willow keeps its hanging branchlets rather than these rising twigs.
      const oppositeOrWillow = [LeafType.Willow, LeafType.Maple, LeafType.Ash].includes(this.options.leaves.type);
      const attempts = oppositeOrWillow ? 1 : 3;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const twig = splitTerminalShoot(sections, this.skeleton.leaves, firstLeaf, forkRng,
          this.options.branch.stopAtGround ? 0.03 : -Infinity);
        if (twig) tipShoots.push(twig);
      }
    }
  }

  /**
   * Generate branches from a parent branch
   * @param {number} count The number of child branches to generate
   * @param {number} level The level of the child branches
   * @param {{
   *  origin: THREE.Vector3,
   *  orientation: THREE.Euler,
   *  radius: number
   * }[]} sections The parent branch's sections
   * @returns
   */
  generateChildBranches(count, level, sections, parentVigor = 1, fork = null) {
    const opt = this.options.branch;
    const evergreen = this.options.type === TreeType.Evergreen;
    const variation = THREE.MathUtils.clamp(opt.structureVariation ?? 0, 0, 1);
    const growth = new RNG(this.options.seed ^ Math.imul(this.skeleton.branches.length, 0x27d4eb2d));
    if (count > 1 && level > 1) count = Math.max(1, Math.round(count * (1 + variation * growth.random(0.26, -0.45))));
    const start = opt.start[level];
    const phase = this.rng.random(turn);
    const perWhorl = Math.min(count, 5);
    const whorls = Math.ceil(count / perWhorl);
    const tiered = evergreen && level === 1;
    const bounds = count > 0 && variation > 0 ? growthIntervals(tiered ? whorls : count, variation, growth) : null;
    const dominant = Math.floor(growth.random() * count);
    const openSide = growth.random(turn);
    // Maple and ash have opposite buds on young shoots. Mature scaffolds
    // often lose one of a pair, so retain the irregular larger limbs.
    // https://forestry.extension.wisc.edu/learn/tree-identification/
    const opposite = !this.options.trellis.enabled && level > 1
      && (this.options.leaves.type === LeafType.Ash || this.options.leaves.type === LeafType.Maple);
    const nodeCount = Math.ceil(count / 2);
    let pairedSlot = 0, pairedAngle = 0;
    for (let i = 0; i < count; i++) {
      let slot = (i + this.rng.random(0.85, 0.15)) / count;
      let angle = phase + goldenAngle * i + this.rng.random(0.28, -0.28);
      if (evergreen && level === 1) {
        const tier = Math.floor(i / perWhorl);
        const members = Math.min(perWhorl, count - tier * perWhorl);
        slot = (tier + this.rng.random(0.87, 0.13)) / whorls;
        angle = phase + tier * goldenAngle + turn * (i % perWhorl) / members + this.rng.random(0.13, -0.13);
      }
      if (bounds) {
        const n = tiered ? Math.floor(i / perWhorl) : i;
        const local = slot * (tiered ? whorls : count) - n;
        slot = THREE.MathUtils.lerp(bounds[n], bounds[n + 1], local);
        angle += variation * growth.random(tiered ? 0.34 : 0.70, tiered ? -0.34 : -0.70);
      }
      if (opposite) {
        if (i % 2 === 0) {
          const node = Math.floor(i / 2);
          pairedSlot = (node + this.rng.random(0.80, 0.20)) / nodeCount;
          pairedAngle = phase + node * Math.PI / 2 + this.rng.random(0.20, -0.20);
        }
        slot = pairedSlot;
        angle = pairedAngle + (i % 2) * Math.PI;
      }
      const coLeader = fork && i === dominant;
      const forkPair = opposite && fork && Math.floor(i / 2) === Math.floor(dominant / 2);
      let t = start + (1 - start) * slot;
      if (coLeader || forkPair) {
        t = fork.at;
        angle = fork.azimuth + (forkPair && !coLeader ? Math.PI : 0);
      } else if (fork && level === 1 && Math.abs(t - fork.at) < 0.04) {
        // Leave room around the major fork, while allowing other limbs to
        // arise both above and below it along the parent trunk.
        t = THREE.MathUtils.clamp(fork.at + (t < fork.at ? -0.04 : 0.04), start, 1);
      }
      const { origin, frame, radius, attachment } = sampleBranch(sections, t);
      const crownAngle = evergreen && level === 1 ? 1.08 - 0.63 * slot * slot : 1;
      // One broadleaf lateral can compete with the leader. Its siblings
      // spread at wider angles and have unequal access to the open crown.
      const competitor = !evergreen && count > 1 && i === dominant;
      const exposure = Math.cos(angle - openSide);
      const reach = competitor ? 0.42 : 0.25 * exposure + growth.random(0.17, -0.20);
      const forkAngle = competitor ? -0.34 : growth.random(0.39, -0.16);
      const opening = THREE.MathUtils.degToRad(opt.angle[level] * crownAngle * this.rng.random(1.14, 0.86)
        * (coLeader ? 0.55 : 1 + variation * forkAngle));
      let direction = new THREE.Vector3(Math.sin(angle) * Math.sin(opening), Math.cos(opening),
        Math.cos(angle) * Math.sin(opening)).applyQuaternion(frame);
      if (evergreen && level > 1) {
        const axis = up.clone().applyQuaternion(frame);
        const side = new THREE.Vector3().crossVectors(axis, up);
        if (side.lengthSq() > 0.0001) {
          direction = axis.multiplyScalar(Math.cos(opening))
            .addScaledVector(side.normalize(), (i % 2 ? -1 : 1) * Math.sin(opening))
            .addScaledVector(up, this.rng.random(0.25, 0.04)).normalize();
        }
      }
      const orientation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction));
      const envelope = evergreen && level === 1 ? Math.pow(1 - t, 0.65)
        : 0.72 + 0.34 * Math.sin(Math.PI * slot);
      const vigor = parentVigor * envelope * this.rng.random(1.16, 0.84) * (1 + variation * reach);
      const radiusRatio = coLeader ? fork.radiusShare :
        Math.min(Math.max(0.94, opt.radius[level]), opt.radius[level] * (1 + variation * reach * 0.75));
      const remainingLength = coLeader ? 0.76 * sections.at(-1).distance * (1 - t) : 0;
      const child = new Branch(origin, orientation, opt.length[level] * vigor + remainingLength,
        radius * radiusRatio, level,
        opt.sections[level], opt.segments[level], vigor, attachment);
      child.scaffold = Boolean(coLeader);
      child.sweep = variation * growth.random(0.98, 0.09) * (competitor ? 0.35 : 1);
      this.branchQueue.push(child);
    }
  }

  // Opposite pairs on ash share a node. The other blades and needle bundles
  // follow successive nodes around the twig, with a different phase per shoot.
  generateLeaves(sections, vigor = 1, tipShoots = []) {
    const { type, angle, start } = this.options.leaves;
    const count = Math.round(this.options.leaves.count * (type === 'pine' ? Math.min(1, 0.32 + vigor) : 1));
    const phase = this.rng.random(turn);
    const paired = type === 'ash' || type === 'maple';
    // Ginkgo's short spur shoots bear clusters of fan leaves.
    // https://naturewalk.yale.edu/trees/ginkgoaceae/ginkgo-biloba/ginkgo-41
    const clustered = type === 'ginkgo';
    const perNode = paired ? 2 : clustered ? 4 : 1;
    const nodes = Math.ceil(count / perNode);
    for (let n = 0; n < nodes; n++) {
      const t = start + (1 - start) * (n + this.rng.random(0.85, 0.15)) / nodes;
      let { origin, frame, attachment, radius } = sampleBranch(sections, t);
      const shootAttachment = attachment;
      const azimuth = phase + n * (paired ? Math.PI / 2 : goldenAngle) + this.rng.random(0.18, -0.18);
      const members = Math.min(perNode, count - perNode * n);
      if (clustered) {
        const length = this.rng.random(0.075, 0.025);
        const direction = new THREE.Vector3(Math.cos(azimuth), 0.22, Math.sin(azimuth)).normalize().applyQuaternion(frame);
        const q = new THREE.Quaternion().setFromUnitVectors(up, direction);
        const start = { origin: origin.clone(), orientation: new THREE.Euler().setFromQuaternion(q), radius: Math.min(radius * 0.3, 0.004), distance: 0 };
        const end = { origin: origin.clone().addScaledVector(direction, length), orientation: start.orientation.clone(), radius: start.radius * 0.55, distance: length };
        tipShoots.push({ sections: [start, end], attachment, baseRadius: start.radius, segmentCount: 3, trunk: false, fineTwig: true });
        origin = end.origin;
        attachment = { a: end, b: end, f: 0 };
      }
      for (let k = 0; k < members; k++) {
        const a = azimuth + k * (paired ? Math.PI : clustered ? turn / members : 0);
        const pitch = THREE.MathUtils.degToRad(angle * this.rng.random(1.17, 0.83));
        const axis = new THREE.Vector3(Math.cos(a) * Math.sin(pitch), Math.cos(pitch),
          Math.sin(a) * Math.sin(pitch)).applyQuaternion(frame);
        // The blade's wide surface tends to face the sky, with some roll and
        // petiole droop. Needles keep their radial arrangement around the shoot.
        if (type !== 'pine') axis.y = axis.y * 0.65 - this.rng.random(0.23, 0.02);
        const rotation = leafOrientation(axis, this.rng.random(0.72, -0.72));
        const previousCount = this.skeleton.leaves.length;
        this.#recordLeaf(origin, rotation, type === 'pine' ? Math.min(1, 0.58 + vigor) : 1, attachment);
        if (clustered && this.skeleton.leaves.length > previousCount) this.skeleton.leaves.at(-1).shootAttachment = shootAttachment;
      }
    }
  }

  /**
  * Records a leaf placement in the skeleton. The size variance is sampled
  * here so the meshing passes stay RNG-free.
  * @param {THREE.Vector3} origin The starting point of the leaf
  * @param {THREE.Euler} orientation The orientation of the leaf
  */
  #recordLeaf(origin, orientation, scale = 1, attachment) {
    const size =
      this.options.leaves.size * scale *
      (1 +
        this.rng.random(
          this.options.leaves.sizeVariance,
          -this.options.leaves.sizeVariance,
        ));

    if (size <= 0 || this.options.leaves.count <= 0) return;
    this.skeleton.leaves.push({
      origin: origin.clone(),
      orientation: orientation.clone(),
      size,
      attachment,
    });
  }

  /**
   * Emits the ring geometry and indices for one skeleton branch
   * @param {{verts: number[], normals: number[], indices: number[], uvs: number[]}} buffers
   * @param {{sections: {origin: THREE.Vector3, orientation: THREE.Euler, radius: number}[], segmentCount: number, baseRadius: number}} skeletonBranch
   * @param {number} sectionStride Average spacing of retained section rings
   * @param {number} segmentFactor Radial segment multiplier
   */
  #meshBranch(buffers, skeletonBranch, sectionStride, segmentFactor, offsets) {
    const { sections, segmentCount, baseRadius } = skeletonBranch;

    // Terminal branches inherit the parent's segmentCount, so parent and
    // child resolve to the same reduced count and junctions stay sealed.
    const segments = Math.max(3, Math.round(segmentCount * segmentFactor));

    // Number of texture wraps around the branch's circumference. Scaling with
    // the branch's base radius keeps bark feature size roughly consistent
    // across thick trunks and thin twigs. Held constant for the whole branch
    // so tapered sections share a wrap count and don't twist the texture
    // longitudinally.
    const photoBark = this.options.bark.type === 'PhotoSmooth' || this.options.bark.type === 'PhotoFurrowed';
    const wrapsX = Math.max(
      1,
      Math.round(turn * baseRadius * this.options.bark.textureScale.x * (photoBark ? 1.5 : 1)),
    );

    const sampled = branchRings(sections, sectionStride, offsets, skeletonBranch.forkRing);
    const translation = applyAttachmentOffset(new THREE.Vector3(), skeletonBranch.attachment, offsets);
    if (translation.lengthSq() > 0) {
      for (const section of sections) {
        if (offsets.has(section)) offsets.get(section).add(translation);
        else offsets.set(section, translation);
      }
    }

    // Used later for geometry index generation
    const indexOffset = buffers.verts.length / 3;
    const aspect = this.options.bark.maps.color?.userData?.uvAspect ?? 1;
    const tileHeight = Math.max(0.15, turn * baseRadius / wrapsX) * Math.max(0.01, this.options.bark.textureScale.y) * aspect;
    const phase = (this.options.seed % 571) * 0.11;
    const flareHeight = Math.max(0.04, 1.4 * baseRadius);
    const flareStrength = skeletonBranch.trunk
      ? Math.min(1, 12 * baseRadius / Math.max(0.01, sections.at(-1).distance)) : 0;
    const lateral = skeletonBranch.attachment && skeletonBranch.attachment.a !== skeletonBranch.attachment.b
      && !skeletonBranch.fineTwig;
    const collarHeight = Math.max(0.02, Math.min(baseRadius * 3, sections.at(-1).distance * 0.22));

    for (let k = 0, ring = 0; k < sampled.length; k++) {
      const section = sampled[k];
      // Read the original taper so shared rings keep their lighting across LODs.
      while (sections[ring] !== section) ring++;
      const before = sections[Math.max(0, ring - 1)];
      const after = sections[Math.min(ring + 1, sections.length - 1)];
      const run = after.distance - before.distance;
      const flare = flareStrength * Math.exp(-section.distance / flareHeight);
      const collar = lateral ? 0.30 * Math.exp(-section.distance / collarHeight) : 0;
      const flareBefore = flareStrength * Math.exp(-before.distance / flareHeight);
      const flareAfter = flareStrength * Math.exp(-after.distance / flareHeight);
      const collarBefore = lateral ? 0.30 * Math.exp(-before.distance / collarHeight) : 0;
      const collarAfter = lateral ? 0.30 * Math.exp(-after.distance / collarHeight) : 0;

      // Create the segments that make up this section.
      let first;
      for (let j = 0; j < segments; j++) {
        let angle = (2.0 * Math.PI * j) / segments;

        // Create the segment vertex
        const lobe = 0.74 + 0.29 * Math.cos(5 * angle + phase) + 0.16 * Math.cos(3 * angle - phase);
        const radius = section.radius * (1 + flare * lobe + collar);
        const vertex = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
          .multiplyScalar(radius)
          .applyEuler(section.orientation)
          .add(section.origin).add(translation);

        const dr = flare * (-1.45 * Math.sin(5 * angle + phase) - 0.48 * Math.sin(3 * angle - phase)) / (1 + flare * lobe + collar);
        // Match the actual neighboring rings rather than a continuous
        // derivative: the mesh interpolates linearly between these rings.
        const radiusBefore = before.radius * (1 + flareBefore * lobe + collarBefore);
        const radiusAfter = after.radius * (1 + flareAfter * lobe + collarAfter);
        const axial = run !== 0 ? (radiusBefore - radiusAfter) / run : 0;
        const normal = new THREE.Vector3(Math.cos(angle) + dr * Math.sin(angle),
          axial, Math.sin(angle) - dr * Math.cos(angle))
          .applyEuler(section.orientation)
          .normalize();

        // Physical distance keeps bark grain continuous through rings and LOD switches.
        const uv = new THREE.Vector2(
          (j / segments) * wrapsX,
          section.distance / tileHeight + (skeletonBranch.barkOffset ?? 0),
        );

        buffers.verts.push(...Object.values(vertex));
        buffers.normals.push(...Object.values(normal));
        buffers.uvs.push(...Object.values(uv));
        buffers.colors.push(255, 255, 255);

        if (j === 0) {
          first = { vertex, normal, uv };
        }
      }

      // Duplicate the first vertex so there is continuity in the UV mapping.
      // u=wrapsX maps to the same texel as u=0 since wrapsX is an integer.
      buffers.verts.push(...Object.values(first.vertex));
      buffers.normals.push(...Object.values(first.normal));
      buffers.uvs.push(first.uv.x + wrapsX, first.uv.y);
      buffers.colors.push(255, 255, 255);
    }

    // Build geometry for each section of the branch (cylinder without end caps)
    let v1, v2, v3, v4;
    const N = segments + 1;
    const chip = skeletonBranch.chip;
    const cut = chip?.threshold < this.options.bark.damage;
    const height = cut ? chip.height * sections.at(-1).distance : -1;
    const column = cut ? Math.floor(chip.angle * segments) : -1;
    for (let i = 0; i < sampled.length - 1; i++) {
      // Build the quad for each segment of the section
      for (let j = 0; j < segments; j++) {
        v1 = indexOffset + i * N + j;
        // The last segment wraps around back to the starting segment, so omit j + 1 term
        v2 = indexOffset + i * N + (j + 1);
        v3 = v1 + N;
        v4 = v2 + N;
        if (j === column && sampled[i].distance <= height && height < sampled[i + 1].distance) {
          const span = sampled[i + 1].distance - sampled[i].distance;
          const radius = sampled[i].radius;
          const u = THREE.MathUtils.clamp(chip.angle * segments - j, 0.12, 0.88);
          const v = THREE.MathUtils.clamp((height - sampled[i].distance) / span, 0.08, 0.92);
          const wide = chip.kind === 'scrape';
          const w = Math.min((wide ? 0.11 : chip.kind === 'split' ? 0.026 : 0.055) * segments, 0.85 * Math.min(u, 1 - u));
          const h = Math.min((wide ? 0.68 : 1.35) * radius / span, 0.90 * Math.min(v, 1 - v));
          cutBarkChip(buffers, [v1, v3, v4, v2], u, v, w, h, Math.min((wide ? 0.045 : 0.12) * radius, 0.24 * h * span), chip);
        } else {
          buffers.indices.push(v1, v3, v2, v2, v3, v4);
        }
      }
    }
  }

  /**
   * Builds a BufferGeometry from raw attribute buffers
   * @returns {THREE.BufferGeometry}
   */
  #buildBufferGeometry(buffers) {
    const g = new THREE.BufferGeometry();
    const attribute = (data, size) => new THREE.BufferAttribute(
      data instanceof Float32Array ? data : new Float32Array(data), size,
    );
    g.setAttribute('position', attribute(buffers.verts, 3));
    g.setAttribute('normal', attribute(buffers.normals, 3));
    g.setAttribute('uv', attribute(buffers.uvs, 2));
    if (buffers.faceUVs) g.setAttribute('uv1', attribute(buffers.faceUVs, 2));
    if (buffers.colors) g.setAttribute('color', buffers.flex ? attribute(buffers.colors, 3)
      : new THREE.Uint8BufferAttribute(buffers.colors, 3, true));
    if (buffers.flex) {
      g.setAttribute('leafFlex', attribute(buffers.flex, 1));
      g.userData.leafSites = buffers.leafSites;
      g.userData.doubleSided = buffers.doubleSided;
    }
    // Three chooses 16- or 32-bit indices for ordinary branch index arrays.
    g.setIndex(Array.isArray(buffers.indices)
      ? buffers.indices : new THREE.BufferAttribute(buffers.indices, 1));
    g.computeBoundingSphere();
    return g;
  }

  /**
   * Creates the bark material from the current options
   * @returns {THREE.MeshStandardMaterial}
   */
  #createBarkMaterial() {
    const mat = new THREE.MeshStandardMaterial({
      name: 'branches',
      vertexColors: true,
      flatShading: this.options.bark.flatShading,
      color: new THREE.Color(this.options.bark.tint),
      metalness: 0.0,
      roughness: 1.0,
    });

    if (this.options.bark.textured) {
      const maps = this.options.bark.maps;
      const apply = (texture) => {
        if (!texture) return null;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        return texture;
      };
      if (maps.color) mat.map = apply(maps.color);
      if (maps.ao) mat.aoMap = apply(maps.ao);
      if (maps.normal) mat.normalMap = apply(maps.normal);
      if (maps.height) mat.barkHeightMap = apply(maps.height);
      if (maps.roughness) {
        mat.roughnessMap = apply(maps.roughness);
        // Point metalnessMap at the same texture: metalness stays 0 because
        // the metalness factor is 0, and GLTFExporter reuses the texture
        // as-is instead of synthesizing a merged metal/rough PNG (and
        // warning about it) when the two slots differ.
        mat.metalnessMap = mat.roughnessMap;
      }
    }

    return mat;
  }

  /**
   * Generates the geometry for the branches
   */
  createBranchesGeometry() {
    this.branchesMesh.geometry.dispose();
    this.branchesMesh.geometry = this.#buildBufferGeometry(this.branches);
    this.branchesMesh.material.dispose();
    this.branchesMesh.material = this.#createBarkMaterial();
    this.branchesMesh.castShadow = true;
    this.branchesMesh.receiveShadow = true;
  }

  /**
   * Creates the leaf material, including the wind sway vertex shader, from
   * the current options
   * @returns {THREE.MeshStandardMaterial}
   */
  #createLeafMaterial(doubleSided) {
    const maps = this.options.leaves.textured ? this.options.leaves.maps : null;
    const mat = new THREE.MeshStandardMaterial({
      name: 'leaves',
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      vertexColors: true,
      map: maps?.color ?? null,
      normalMap: maps?.normal ?? null,
      roughnessMap: maps?.roughness ?? null,
      metalnessMap: maps?.roughness ?? null,
      color: new THREE.Color(this.options.leaves.tint),
      flatShading: !this.options.leaves.roundedNormals,
      metalness: 0.0,
      roughness: 1.0,
      dithering: true
    });

    if (maps?.subsurface) {
      const color = { oak: 0xa6bd54, aspen: 0xc1d46b, ash: 0xb0c765, pine: 0x729354 };
      mat.leafScattering = {
        map: maps.subsurface,
        color: new THREE.Color(color[this.options.leaves.type] ?? color.oak).multiply(mat.color),
        strength: THREE.MathUtils.clamp(this.options.leaves.subsurfaceStrength, 0, 1),
      };
      mat.defines.USE_LEAF_SCATTERING = 1;
    }

    // Add custom shader code for branch swaying
    mat.onBeforeCompile = (shader) => {
      if (mat.leafScattering) {
        const scattering = mat.leafScattering;
        shader.uniforms.uLeafSubsurfaceMap = { value: scattering.map };
        shader.uniforms.uLeafScatterColor = { value: scattering.color };
        shader.uniforms.uLeafScatterStrength = { get value() { return scattering.strength; } };
        shader.vertexShader = 'varying vec2 vLeafScatterUv;\n' + shader.vertexShader.replace(
          '#include <uv_vertex>', '#include <uv_vertex>\n vLeafScatterUv = uv;',
        );
        // Each direct light already includes its attenuation and shadow.
        // Transfer the masked fraction of diffuse energy to the back face.
        const lights = THREE.ShaderChunk.lights_fragment_begin.replaceAll(
          'RE_Direct( directLight,',
          `reflectedLight.directDiffuse += leafScatterWeight * directLight.color * (
            BRDF_Lambert(uLeafScatterColor) * max(-dot(geometryNormal, directLight.direction), 0.0)
            - BRDF_Lambert(material.diffuseColor) * max(dot(geometryNormal, directLight.direction), 0.0));
          RE_Direct( directLight,`,
        );
        shader.fragmentShader = `
          varying vec2 vLeafScatterUv;
          uniform sampler2D uLeafSubsurfaceMap;
          uniform vec3 uLeafScatterColor;
          uniform float uLeafScatterStrength;
        ` + shader.fragmentShader.replace('#include <lights_fragment_begin>',
          'float leafScatterWeight = uLeafScatterStrength * texture2D(uLeafSubsurfaceMap, vLeafScatterUv).r;\n' + lights);
      }
      shader.uniforms.uTime = this.#windTime;
      shader.uniforms.uWindStrength = { value: new THREE.Vector3(0.10, 0, 0.07) };
      shader.uniforms.uWindFrequency = { value: 0.5 };
      shader.uniforms.uWindScale = { value: 70 };

      shader.vertexShader = `
        attribute float leafFlex;
        uniform float uTime;
        uniform vec3 uWindStrength;
        uniform float uWindFrequency;
        uniform float uWindScale;
        ` + shader.vertexShader;

      // Add code for simplex noise
      shader.vertexShader = shader.vertexShader.replace(
        `void main() {`,
        `
        // GLSL Simplex Noise 3D
        // Source: https://github.com/ashima/webgl-noise

        vec3 mod289(vec3 x) {
            return x - floor(x * (1.0 / 289.0)) * 289.0;
        }

        vec4 mod289(vec4 x) {
            return x - floor(x * (1.0 / 289.0)) * 289.0;
        }

        vec4 permute(vec4 x) {
            return mod289(((x*34.0)+1.0)*x);
        }

        vec4 taylorInvSqrt(vec4 r) {
            return 1.79284291400159 - 0.85373472095314 * r;
        }

        vec3 fade(vec3 t) {
            return t*t*t*(t*(t*6.0-15.0)+10.0);
        }

        // Classic Simplex Noise 3D
        float simplex3(vec3 v) {
            const vec2  C = vec2(1.0/6.0, 1.0/3.0);
            const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

            // First corner
            vec3 i  = floor(v + dot(v, C.yyy) );
            vec3 x0 = v - i + dot(i, C.xxx);

            // Other corners
            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = 1.0 - g;
            vec3 i1 = min( g.xyz, l.zxy );
            vec3 i2 = max( g.xyz, l.zxy );

            //  x0 = x0 - 0. + 0.0 * C 
            vec3 x1 = x0 - i1 + C.xxx;
            vec3 x2 = x0 - i2 + C.yyy; // 2.0 * C.x = 1/3 = C.y
            vec3 x3 = x0 - D.yyy;      // -1.0 + 3.0 * C.x = -0.5

            // Permutations
            i = mod289(i);
            vec4 p = permute( permute( permute( 
                        i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                      + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
                      + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

            // Gradients: 7x7 points over a square, mapped onto an octahedron.
            // The ring size 17*17 = 289 is close to the mapping's singularity.
            float n_ = 0.142857142857; // 1.0/7.0
            vec3  ns = n_ * D.wyz - D.xzx;

            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)

            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)

            vec4 x = x_ *ns.x + ns.yyyy;
            vec4 y = y_ *ns.x + ns.yyyy;
            vec4 h = 1.0 - abs(x) - abs(y);

            vec4 b0 = vec4( x.xy, y.xy );
            vec4 b1 = vec4( x.zw, y.zw );

            vec4 s0 = floor(b0)*2.0 + 1.0;
            vec4 s1 = floor(b1)*2.0 + 1.0;
            vec4 sh = -step(h, vec4(0.0));

            vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
            vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

            vec3 g0 = vec3(a0.xy,h.x);
            vec3 g1 = vec3(a0.zw,h.y);
            vec3 g2 = vec3(a1.xy,h.z);
            vec3 g3 = vec3(a1.zw,h.w);

            // Normalise gradients
            vec4 norm = taylorInvSqrt(vec4(dot(g0,g0), dot(g1,g1), dot(g2,g2), dot(g3,g3)));
            g0 *= norm.x;
            g1 *= norm.y;
            g2 *= norm.z;
            g3 *= norm.w;

            // Mix contributions from the four corners
            vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
            m = m * m;
            return 42.0 * dot( m*m, vec4( dot(g0,x0), dot(g1,x1), 
                                          dot(g2,x2), dot(g3,x3) ) );
        }
          
        void main() {`,
      );

      shader.vertexShader = shader.vertexShader.replace(
        `#include <project_vertex>`,
        `
        vec4 mvPosition = vec4(transformed, 1.0);

        float windOffset = 2.0 * 3.14 * simplex3(mvPosition.xyz / uWindScale);
        vec3 windSway = leafFlex * uWindStrength * (
          0.5 * sin(uTime * uWindFrequency + windOffset) +
          0.3 * sin(2.0 * uTime * uWindFrequency + 1.3 * windOffset) +
          0.2 * sin(5.0 * uTime * uWindFrequency + 1.5 * windOffset)
        );
        mvPosition.xyz += windSway;

        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
        `
      );

      // Non-enumerable so JSON serialization (e.g. GLTFExporter's userData
      // pass) skips the live shader object — Texture uniforms inside it are
      // not serializable.
      Object.defineProperty(mat.userData, 'shader', {
        value: shader,
        configurable: true,
        enumerable: false,
      });
    };

    return mat;
  }

  /**
   * Generates the geometry for the leaves
   */
  createLeavesGeometry() {
    this.leavesMesh.geometry.dispose();
    this.leavesMesh.geometry = this.#buildBufferGeometry(this.leaves);
    this.leavesMesh.material.dispose();
    this.leavesMesh.material = this.#createLeafMaterial(this.leaves.doubleSided);
    this.leavesMesh.castShadow = true;
    this.leavesMesh.receiveShadow = true;
  }

  /**
   * Create or update the trellis geometry
   */
  createTrellis() {
    // Remove old trellis if exists
    if (this.trellisMesh) {
      this.remove(this.trellisMesh);
      this.trellisMesh.dispose();
      this.trellisMesh = null;
    }

    // Create new trellis if enabled and visible
    if (this.options.trellis.enabled && this.options.trellis.visible) {
      this.trellisMesh = new Trellis(this.options.trellis);
      this.trellisMesh.generate();
      this.add(this.trellisMesh);
    }
  }

  /**
   * Find the nearest point on the trellis grid to a given position
   * @param {THREE.Vector3} position
   * @returns {THREE.Vector3}
   */
  getNearestTrellisPoint(position) {
    const t = this.options.trellis;
    const trellisX = t.position.x;
    const trellisY = t.position.y;
    const trellisZ = t.position.z;

    // Trellis bounds
    const minX = trellisX - t.width / 2;
    const maxX = trellisX + t.width / 2;
    const minY = trellisY;
    const maxY = trellisY + t.height;

    // Clamp position to trellis bounds for projection
    const clampedX = Math.max(minX, Math.min(maxX, position.x));
    const clampedY = Math.max(minY, Math.min(maxY, position.y));

    // Find nearest horizontal line (Y = constant)
    const nearestHLineY = Math.round((clampedY - minY) / t.spacing) * t.spacing + minY;
    const finalHLineY = Math.max(minY, Math.min(maxY, nearestHLineY));

    // Find nearest vertical line (X = constant)
    const nearestVLineX = Math.round((clampedX - minX) / t.spacing) * t.spacing + minX;
    const finalVLineX = Math.max(minX, Math.min(maxX, nearestVLineX));

    // Point on nearest horizontal line (X can vary along the line)
    const pointOnHLine = new THREE.Vector3(clampedX, finalHLineY, trellisZ);

    // Point on nearest vertical line (Y can vary along the line)
    const pointOnVLine = new THREE.Vector3(finalVLineX, clampedY, trellisZ);

    // Return whichever is closer
    const distH = position.distanceTo(pointOnHLine);
    const distV = position.distanceTo(pointOnVLine);

    return distH < distV ? pointOnHLine : pointOnVLine;
  }

  /**
   * Calculate the force vector toward the nearest trellis point
   * @param {THREE.Vector3} position Current section position
   * @param {number} radius Current section radius
   * @returns {{ direction: THREE.Vector3, strength: number } | null}
   */
  calculateTrellisForce(position, radius) {
    const trellis = this.options.trellis;
    const nearestPoint = this.getNearestTrellisPoint(position);

    const distance = position.distanceTo(nearestPoint);

    // Only apply force within max distance
    if (distance > trellis.force.maxDistance) return null;
    if (distance < 0.001) return null; // Avoid division by zero

    // Calculate direction toward trellis
    const direction = new THREE.Vector3()
      .subVectors(nearestPoint, position)
      .normalize();

    // Calculate strength with distance falloff
    // Closer = stronger force, scaled by inverse radius (like existing force)
    const distanceFactor = 1 - Math.pow(
      distance / trellis.force.maxDistance,
      trellis.force.falloff,
    );
    const strength = trellis.force.strength * distanceFactor / radius;

    return { direction, strength };
  }

  get vertexCount() {
    return (this.branches.verts.length + this.leaves.verts.length) / 3;
  }

  get triangleCount() {
    return (this.branches.indices.length + this.leaves.indices.length) / 3;
  }
}
