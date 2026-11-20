import * as THREE from 'three';

// Fan outline, with a narrow petiole, rounded shoulders and the characteristic
// apical cleft. The two sides retain their cleft in the distant mesh as well.
const fullOutline = [
  [0, 0], [-0.018, 0.20], [-0.10, 0.32], [-0.24, 0.43],
  [-0.40, 0.56], [-0.49, 0.68], [-0.51, 0.78], [-0.46, 0.86],
  [-0.34, 0.90], [-0.20, 0.89], [-0.09, 0.84], [0, 0.73],
  [0.09, 0.84], [0.20, 0.89], [0.34, 0.90], [0.46, 0.86],
  [0.51, 0.78], [0.49, 0.68], [0.40, 0.56], [0.24, 0.43],
  [0.10, 0.32], [0.018, 0.20],
];
const thinOutline = [
  [0, 0], [-0.018, 0.20], [-0.35, 0.50], [-0.51, 0.78],
  [-0.34, 0.90], [-0.16, 0.87], [0, 0.73], [0.16, 0.87],
  [0.34, 0.90], [0.51, 0.78], [0.35, 0.50], [0.018, 0.20],
];

// Same return contract as foliage's other leaf templates. Every damage variant
// preserves topology so mixed healthy and damaged leaves can share one buffer.
export function makeGinkgoTemplate(detail, variant, damagePattern) {
  const outline = detail === 'thin' || detail === 'coarse' ? thinOutline : fullOutline;
  const thin = detail === 'thin';
  const positions = [], colors = [], uvs = [], indices = [], lowerFaces = [];
  const color = new THREE.Color(0x88a85a);
  const damaged = damagePattern >= 0;
  const side = damagePattern % 2 ? 1 : -1;
  const rolled = damagePattern >= 8 && damagePattern < 12;
  const creased = damagePattern >= 12;
  const torn = damagePattern % 4 >= 2;
  function vertex(x, y, underside) {
    const originalX = x, originalY = y;
    let dry = 0, z = 0.045 * Math.sin(Math.PI * y) + variant * 0.025 * x;
    if (damaged && rolled) {
      const roll = THREE.MathUtils.smoothstep(side * x, 0, 0.5) * THREE.MathUtils.smoothstep(y, 0.2, 0.65);
      x *= 1 - 0.35 * roll; z -= 0.22 * roll; dry = 0.8 * roll;
    } else if (damaged && creased) {
      const reach = Math.max(0, y - 0.57 - side * x * 0.12);
      y -= 0.25 * reach; z -= 0.65 * reach; dry = Math.min(0.5, reach * 2);
    } else if (damaged && torn) {
      const cut = 0.76 + 0.12 * side * x;
      const reach = Math.max(0, y - cut);
      y -= 0.8 * reach; z -= 0.25 * reach; dry = Math.min(0.9, reach * 6);
    } else if (damaged && side * x > 0) {
      const bite = Math.max(0, 1 - Math.abs(y - 0.72) / 0.2);
      x *= 1 - 0.5 * bite; dry = 0.7 * bite;
    }
    x += variant * 0.025 * y;
    z += underside ? -0.008 : 0.008;
    positions.push(x, y, z);
    uvs.push(0.5 + originalX * 0.94, originalY);
    const tone = underside ? 1.12 : 0.95;
    colors.push(color.r * tone * (1 + 0.6 * dry), color.g * tone * (1 - 0.54 * dry), color.b * tone * (1 - 0.55 * dry));
    return positions.length / 3 - 1;
  }
  function face(underside) {
    const center = vertex(0, 0.48, underside);
    const ring = outline.map(([x, y]) => vertex(x, y, underside));
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (underside) {
        lowerFaces[indices.length / 3] = true;
        indices.push(center, a, b);
      } else indices.push(center, b, a);
    }
    return ring;
  }
  const front = face(false);
  if (!thin) {
    const back = face(true);
    for (let i = 0; i < front.length; i++) {
      const j = (i + 1) % front.length;
      indices.push(front[i], front[j], back[i], front[j], back[j], back[i]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { positions, colors, indices, uvs, lowerFaces, normals: geometry.attributes.normal.array };
}


