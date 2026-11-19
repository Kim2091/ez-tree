import * as THREE from 'three';
import { LeafType } from './enums';

// Each pair gives the distance along the blade and its half-width. The first
// and last points are single vertices. The intermediate rings make a closed
// blade with a longitudinal fold around the midrib.
const oak = [
  [0.075, 0.008], [0.135, 0.020], [0.191, 0.096], [0.211, 0.115],
  [0.229, 0.116], [0.250, 0.091], [0.270, 0.060],
  [0.324, 0.164], [0.358, 0.218], [0.381, 0.222], [0.399, 0.207], [0.437, 0.109],
  [0.507, 0.221], [0.541, 0.260], [0.564, 0.267], [0.586, 0.255], [0.635, 0.132],
  [0.709, 0.214], [0.740, 0.227], [0.764, 0.219], [0.808, 0.119],
  [0.837, 0.095], [0.889, 0.101], [0.943, 0.077], [0.978, 0.039],
];
const aspen = [
  [0.19, 0.006], [0.22, 0.03], [0.25, 0.17], [0.29, 0.245],
  [0.35, 0.29], [0.44, 0.314], [0.53, 0.307], [0.62, 0.271],
  [0.72, 0.203], [0.81, 0.131], [0.91, 0.046],
];
const leaflet = [[0.08, 0.017], [0.21, 0.098], [0.35, 0.142], [0.48, 0.153],
  [0.62, 0.136], [0.76, 0.091], [0.89, 0.034]];
const stalk = [[0.05, 0.014], [0.60, 0.010], [0.93, 0.006]];
const needle = [[0.08, 0.020], [0.52, 0.017], [0.83, 0.010]];

// Outline samples for the two-sided mesh. Keep two oak lobes, the aspen
// shoulder, opposite ash leaflets and the full five-needle fascicle.
const thinStations = new Map([
  [oak, [oak[9], oak[11], oak[19]]],
  [aspen, [aspen[3], aspen[7]]],
  [leaflet, [leaflet[3]]],
  [stalk, [stalk[0]]],
  [needle, [needle[0]]],
]);

function makeTemplate(type, detail, variant) {
  const positions = [], colors = [], indices = [], uvs = [];
  const color = new THREE.Color({
    oak: 0x66864a, aspen: 0x83a357, ash: 0x749553, pine: 0x4c7861,
  }[type]);
  const point = new THREE.Vector3();

  // A blade grows along local +Y. Spread opens it away from the stalk and
  // azimuth turns it around the stalk. Sub-blades share the same wind field.
  function blade(profile, length = 1, base = 0, spread = 0, azimuth = 0, thickness = 0.13) {
    const orientation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, azimuth, -spread, 'YXZ'),
    );
    const halfWidth = Math.max(...profile.map(row => row[1]));
    const broad = profile !== stalk && profile !== needle;
    function vertex(x, y, z, tone) {
      // Project each individual blade in its own frame. Compound leaves and
      // needles each get a root-to-tip texture with their own central vein.
      uvs.push(0.5 + x / (2 * halfWidth) * (profile === stalk ? 0.025 : 0.96), y);
      const curve = Math.sin(Math.PI * y);
      if (broad) {
        // Offset each margin independently. Oak lobes sweep forward from the
        // midrib; aspen shoulders curve back into the petiole. The midrib
        // stays continuous through every fold and each leaflet stays attached.
        const edge = x / halfWidth;
        const wave = Math.sin(8 * y + variant * 3.1 + 1.7 * Math.sign(x));
        const sweep = profile === oak ? 0.55 * (1 - y * y)
          : profile === aspen ? -0.28 * (1 - y) : 0.13;
        y += sweep * Math.abs(x) + 0.027 * edge * wave;
        x *= 0.93 + 0.12 * variant + 0.105 * wave;
        z += 0.027 * edge * wave * curve;
      }
      x += variant * 0.12 * halfWidth * y * y;
      z += variant * (0.07 * y * y + 0.25 * x * curve);
      point.set(x, y, z).multiplyScalar(length).applyQuaternion(orientation);
      positions.push(point.x, point.y + base, point.z);
      colors.push(color.r * tone, color.g * tone, color.b * tone);
      return positions.length / 3 - 1;
    }

    const softEdge = broad && detail === 'full';
    const root = vertex(0, 0, 0, 0.68);
    if (detail === 'thin') {
      const tip = vertex(0, 1, profile === stalk ? 0 : -0.065, 1.04);
      const stations = thinStations.get(profile);
      let previous;
      for (const [y, width] of stations) {
        const bend = profile === stalk ? 0 : 0.085 * Math.sin(Math.PI * y) - 0.065 * y * y;
        const left = vertex(-width, y, bend, 0.93);
        const right = vertex(width, y, bend + width * y * 0.1, 0.96);
        if (stations.length === 1) {
          // Join along the midrib so the two halves catch light differently.
          indices.push(root, right, tip, root, tip, left);
          return;
        }
        if (previous) {
          indices.push(previous.left, previous.right, right, previous.left, right, left);
        } else {
          indices.push(root, right, left);
        }
        previous = { left, right };
      }
      indices.push(previous.left, previous.right, tip);
      return;
    }
    let previous;
    // Keep the blade's broadest station when reducing its longitudinal rings.
    const widest = profile.reduce((best, row) => row[1] > best[1] ? row : best);
    const stations = detail === 'coarse' ? [widest]
      : detail === 'reduced' ? profile.filter((row, i) => i % 3 === 0 || row === widest)
      : profile;
    for (const [y, width] of stations) {
      const bend = profile === stalk ? 0 : 0.085 * Math.sin(Math.PI * y) - 0.065 * y * y;
      const ridge = profile === stalk ? 0 : bend + width * 0.13;
      const depth = width * (broad ? 0.016 : thickness);
      const lip = softEdge ? 0.4 * depth : 0;
      const right = bend + 0.10 * width * y;
      const ring = [
        vertex(-width, y, bend + lip, 0.93),
        vertex(0, y, ridge + depth, 1.04),
        vertex(width, y, right + lip, 0.96),
      ];
      // Separate the two sides of the blade at the margin. Shared normals
      // on a knife edge cancel out and make a thin leaf look folded in half.
      if (softEdge) ring.push(vertex(width, y, right - lip, 1.04));
      ring.push(vertex(0, y, ridge - depth, 1.12));
      if (softEdge) ring.push(vertex(-width, y, bend - lip, 1.02));
      for (let side = 0; side < ring.length; side++) {
        const next = (side + 1) % ring.length;
        if (previous) {
          indices.push(previous[side], previous[next], ring[side],
            previous[next], ring[next], ring[side]);
        } else {
          indices.push(root, ring[next], ring[side]);
        }
      }
      previous = ring;
    }
    const tip = vertex(0, 1, profile === stalk ? 0 : -0.065, 1.04);
    for (let side = 0; side < previous.length; side++) {
      indices.push(previous[side], previous[(side + 1) % previous.length], tip);
    }
  }

  if (type === LeafType.Ash) {
    blade(stalk, 0.74, 0, 0, 0, 0.8);
    // Opposite leaflet pairs and a terminal leaflet share one rachis.
    for (const [base, length, pitch] of [[0.21, 0.48, 1.0], [0.44, 0.41, 0.87]]) {
      for (const angle of [0.12, Math.PI - 0.12]) {
        blade(leaflet, length, base, pitch, angle);
      }
    }
    blade(leaflet, 0.34, 0.68, 0.06);
  } else if (type === LeafType.Pine) {
    // Five slender, individually capped needles radiate from one fascicle.
    const needles = detail === 'coarse' ? 3 : detail === 'reduced' ? 4 : 5;
    for (let i = 0; i < needles; i++) {
      blade(needle, 0.86 + i * 0.035, 0, 0.20 + i * 0.09, i * 2.40, 0.72);
    }
  } else {
    blade(type === LeafType.Aspen ? aspen : oak);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { positions, colors, indices, uvs, normals: geometry.attributes.normal.array };
}

const templates = new Map();
for (const detail of ['full', 'reduced', 'coarse', 'thin']) {
  templates.set(detail, new Map(Object.values(LeafType).map(type => [
    type, [-1, -0.5, 0, 0.5, 1].map(variant => makeTemplate(type, detail, variant)),
  ])));
}

function getTemplate(type, detail) {
  const species = templates.get(detail) ?? templates.get('full');
  return species.get(type) ?? species.get(LeafType.Oak);
}

export function trianglesPerLeaf(type, detail) {
  return getTemplate(type, detail)[0].indices.length / 3;
}

// Keep one site from each block. Choosing the lowest stable priority keeps
// nested LODs consistent and avoids always taking the same side of leaf pairs.
function retainedSite(start, end) {
  let best = start, bestRank = Infinity;
  for (let i = start; i < end; i++) {
    let hash = Math.imul(i ^ (i >>> 16), 0x45d9f3b);
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
    const rank = (hash ^ (hash >>> 16)) >>> 0;
    if (rank < bestRank) { best = i; bestRank = rank; }
  }
  return best;
}

// Bake the local template into a single indexed mesh for rendering and GLB.
// Allocate once at the final size, since dense presets can have thousands of
// placements. Use the original skeleton index at every LOD for stable color.
export function meshFoliage(placements, type, stride, scale, detail) {
  const variants = getTemplate(type, detail);
  const topology = variants[0];
  const count = scale > 0 ? Math.ceil(placements.length / stride) : 0;
  const perLeaf = topology.positions.length / 3;
  const vertices = count * perLeaf;
  const verts = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  const uvs = new Float32Array(vertices * 2);
  const flex = new Float32Array(vertices);
  const IndexArray = vertices > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(count * topology.indices.length);
  const orientation = new THREE.Quaternion();
  const point = new THREE.Vector3();

  // Fractional spacing uses the entire site range, including the final twig.
  const spacing = Number.isInteger(stride) ? stride : placements.length / count;
  for (let k = 0; k < count; k++) {
    const first = Math.floor(k * spacing);
    const end = k === count - 1 ? placements.length : Math.floor((k + 1) * spacing);
    const i = stride === 1 ? first : retainedSite(first, end);
    const leaf = placements[i];
    const start = k * perLeaf;
    orientation.setFromEuler(leaf.orientation);
    const size = leaf.size * scale;
    const phase = (i * 0.61803398875 + leaf.size) % 1;
    const template = variants[Math.floor(phase * variants.length)];
    const brightness = 0.81 + 0.30 * phase;
    for (let j = 0; j < perLeaf; j++) {
      const src = 3 * j;
      const dst = 3 * (start + j);
      point.fromArray(template.positions, src).applyQuaternion(orientation)
        .multiplyScalar(size).add(leaf.origin).toArray(verts, dst);
      point.fromArray(template.normals, src).applyQuaternion(orientation).toArray(normals, dst);
      colors[dst] = template.colors[src] * brightness * (0.92 + 0.22 * phase);
      colors[dst + 1] = template.colors[src + 1] * brightness;
      colors[dst + 2] = template.colors[src + 2] * brightness;
      flex[start + j] = template.positions[src + 1] * size;
    }
    uvs.set(template.uvs, 2 * start);
    const firstIndex = k * template.indices.length;
    for (let j = 0; j < template.indices.length; j++) {
      indices[firstIndex + j] = start + template.indices[j];
    }
  }
  return { verts, normals, uvs, colors, indices, flex, leafSites: count, doubleSided: detail === 'thin' };
}
