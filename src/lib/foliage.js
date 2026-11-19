import * as THREE from 'three';
import { LeafType } from './enums';

// Each pair gives the distance along the blade and its half-width. The first
// and last points are single vertices. Interior stations have four vertices
// around the midrib, giving the blade a closed, folded cross-section.
const oak = [
  [0.08, 0.012], [0.14, 0.04], [0.22, 0.14], [0.28, 0.10],
  [0.39, 0.23], [0.44, 0.22], [0.48, 0.13], [0.60, 0.27],
  [0.65, 0.25], [0.69, 0.15], [0.79, 0.22], [0.84, 0.19], [0.91, 0.10],
];
const aspen = [
  [0.14, 0.012], [0.21, 0.17], [0.33, 0.29], [0.45, 0.33],
  [0.56, 0.32], [0.70, 0.25], [0.83, 0.14], [0.91, 0.065],
];
const leaflet = [[0.10, 0.035], [0.32, 0.16], [0.55, 0.18], [0.78, 0.11]];
const stalk = [[0.05, 0.014], [0.60, 0.010], [0.93, 0.006]];
const needle = [[0.08, 0.020], [0.52, 0.017], [0.83, 0.010]];

function makeTemplate(type, detail) {
  const positions = [], colors = [], indices = [];
  const color = new THREE.Color({
    oak: 0x72964a, aspen: 0xa1b965, ash: 0x75994e, pine: 0x477e54,
  }[type]);
  const point = new THREE.Vector3();

  // A blade grows along local +Y. Spread opens it away from the stalk and
  // azimuth turns it around the stalk. Sub-blades share the same wind field.
  function blade(profile, length = 1, base = 0, spread = 0, azimuth = 0, thickness = 0.13) {
    const orientation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, azimuth, -spread, 'YXZ'),
    );
    function vertex(x, y, z, tone) {
      point.set(x, y, z).multiplyScalar(length).applyQuaternion(orientation);
      positions.push(point.x, point.y + base, point.z);
      colors.push(color.r * tone, color.g * tone, color.b * tone);
      return positions.length / 3 - 1;
    }

    const root = vertex(0, 0, 0, 0.68);
    let previous;
    // Keep the blade's broadest station when reducing its longitudinal rings.
    const widest = profile.reduce((best, row) => row[1] > best[1] ? row : best);
    const stations = detail === 'coarse' ? [widest]
      : detail === 'reduced' ? profile.filter((row, i) => i % 3 === 0 || row === widest)
      : profile;
    for (const [y, width] of stations) {
      const bend = profile === stalk ? 0 : 0.12 * Math.sin(Math.PI * y) - 0.11 * y * y;
      const ridge = profile === stalk ? 0 : bend + width * 0.24;
      const depth = width * thickness;
      const ring = [
        vertex(-width, y, bend, 0.84),
        vertex(0, y, ridge + depth, 1.16),
        vertex(width, y, bend + 0.10 * width * y, 0.93),
        vertex(0, y, ridge - depth, 0.78),
      ];
      for (let side = 0; side < 4; side++) {
        const next = (side + 1) % 4;
        if (previous) {
          indices.push(previous[side], previous[next], ring[side],
            previous[next], ring[next], ring[side]);
        } else {
          indices.push(root, ring[next], ring[side]);
        }
      }
      previous = ring;
    }
    const tip = vertex(0, 1, profile === stalk ? 0 : -0.11, 1.04);
    for (let side = 0; side < 4; side++) {
      indices.push(previous[side], previous[(side + 1) % 4], tip);
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
  return { positions, colors, indices, normals: geometry.attributes.normal.array };
}

const templates = new Map();
for (const detail of ['full', 'reduced', 'coarse']) {
  templates.set(detail, new Map(Object.values(LeafType).map(type => [type, makeTemplate(type, detail)])));
}

function getTemplate(type, detail) {
  const species = templates.get(detail) ?? templates.get('full');
  return species.get(type) ?? species.get(LeafType.Oak);
}

export function trianglesPerLeaf(type, detail) {
  return getTemplate(type, detail).indices.length / 3;
}

// Bake the local template into a single indexed mesh for rendering and GLB.
// Allocate once at the final size, since dense presets can have thousands of
// placements. Use the original skeleton index at every LOD for stable color.
export function meshFoliage(placements, type, stride, scale, detail) {
  const template = getTemplate(type, detail);
  const count = scale > 0 ? Math.ceil(placements.length / stride) : 0;
  const perLeaf = template.positions.length / 3;
  const vertices = count * perLeaf;
  const verts = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  const uvs = new Float32Array(vertices * 2);
  const IndexArray = vertices > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(count * template.indices.length);
  const orientation = new THREE.Quaternion();
  const point = new THREE.Vector3();

  for (let k = 0; k < count; k++) {
    const i = k * stride;
    const leaf = placements[i];
    const start = k * perLeaf;
    orientation.setFromEuler(leaf.orientation);
    const size = leaf.size * scale;
    const phase = (i * 0.61803398875 + leaf.size) % 1;
    const brightness = 0.78 + 0.32 * phase;
    for (let j = 0; j < perLeaf; j++) {
      const src = 3 * j;
      const dst = 3 * (start + j);
      point.fromArray(template.positions, src).applyQuaternion(orientation)
        .multiplyScalar(size).add(leaf.origin).toArray(verts, dst);
      point.fromArray(template.normals, src).applyQuaternion(orientation).toArray(normals, dst);
      colors[dst] = template.colors[src] * brightness;
      colors[dst + 1] = template.colors[src + 1] * brightness;
      colors[dst + 2] = template.colors[src + 2] * brightness;
      uvs[2 * (start + j)] = 0.5 + template.positions[src];
      uvs[2 * (start + j) + 1] = template.positions[src + 1];
    }
    const firstIndex = k * template.indices.length;
    for (let j = 0; j < template.indices.length; j++) {
      indices[firstIndex + j] = start + template.indices[j];
    }
  }
  return { verts, normals, uvs, colors, indices };
}
