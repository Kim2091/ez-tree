import * as THREE from 'three';

// Sugar maple (Acer saccharum) has opposite, simple leaves with five
// pointed lobes and rounded sinuses. Sources:
// https://mdc.mo.gov/discover-nature/field-guide/sugar-maple
// https://dendro.cnre.vt.edu/dendrology/syllabus/factsheet.cfm?id=2
const profile = [
  [0.12, 0.009], [0.20, 0.012], [0.25, 0.075],
  [0.30, 0.17], [0.36, 0.35], [0.39, 0.43],
  [0.42, 0.31], [0.46, 0.22], [0.49, 0.205],
  [0.54, 0.29], [0.63, 0.43], [0.68, 0.48],
  [0.71, 0.35], [0.75, 0.22], [0.78, 0.19],
  [0.82, 0.19], [0.88, 0.145], [0.94, 0.085],
];
const thin = [profile[5], profile[8], profile[11], profile[14], profile[16]];

// Return the same template layout as foliage.js. A triangulated outline
// preserves all five lobes, including in the double-sided thin LOD.
export function makeSugarMapleTemplate(detail, variant, damagePattern = -1) {
  const stations = detail === 'thin' || detail === 'coarse' ? thin
    : detail === 'reduced' ? profile.filter((_, i) => i % 2 === 0 || [5, 8, 11, 14].includes(i)) : profile;
  const outline = [new THREE.Vector2(0, 0),
    ...stations.map(([y, x]) => new THREE.Vector2(x, y)),
    new THREE.Vector2(0, 1),
    ...stations.slice().reverse().map(([y, x]) => new THREE.Vector2(-x, y))];
  const triangles = THREE.ShapeUtils.triangulateShape(outline, []);
  const positions = [], colors = [], indices = [], uvs = [], lowerFaces = [];
  const color = new THREE.Color(0x72934f);
  const sides = detail === 'thin' ? 1 : 2;
  const side = damagePattern % 2 ? 1 : -1;
  for (let face = 0; face < sides; face++) {
    for (const p of outline) {
      const originalX = p.x, originalY = p.y;
      let x = originalX, y = originalY;
      let z = 0.025 * Math.sin(Math.PI * y) + variant * 0.045 * y * y;
      let dry = 0;
      if (damagePattern >= 0) {
        if (damagePattern >= 12) {
          const reach = Math.max(0, y - 0.55 - 0.08 * side * x / 0.48);
          y -= 0.22 * reach;
          z -= 0.65 * reach;
          dry = THREE.MathUtils.smoothstep(reach, 0, 0.25) * 0.48;
        } else if (damagePattern >= 8) {
          const roll = Math.max(0, side * x / 0.48) * THREE.MathUtils.smoothstep(y, 0.16, 0.77);
          x *= 1 - 0.4 * roll;
          z -= 0.35 * roll;
          dry = 0.82 * roll;
        } else if (damagePattern % 4 >= 2) {
          const cut = 0.74 + 0.12 * side * x / 0.48;
          const missing = Math.max(0, y - cut);
          dry = THREE.MathUtils.smoothstep(y - cut, -0.065, 0.045);
          y -= 0.94 * missing;
          x += side * 0.24 * missing;
          z -= 0.18 * missing;
        } else if (x * side > 0) {
          const distance = Math.abs(y - (damagePattern >= 4 ? 0.62 : 0.48)) / 0.2;
          const bite = Math.sqrt(Math.max(0, 1 - distance * distance));
          x *= 1 - 0.61 * bite;
          z -= 0.027 * bite;
          dry = 0.78 * bite;
        }
      }
      x += variant * 0.025 * y * y;
      z += (face ? -1 : 1) * 0.003 * THREE.MathUtils.smoothstep(originalY, 0, 0.12);
      positions.push(x, y, z);
      uvs.push(0.5 + originalX / 0.96 * 0.96, originalY);
      const pale = face === 1;
      colors.push(color.r * (pale ? 1.36 : 1) * (1 + 0.62 * dry),
        color.g * (pale ? 1.20 : 1) * (1 - 0.54 * dry),
        color.b * (pale ? 1.65 : 1) * (1 - 0.55 * dry));
    }
    for (const [a, b, c] of triangles) {
      if (face) lowerFaces[indices.length / 3] = true;
      const offset = face * outline.length;
      indices.push(offset + a, offset + (face ? c : b), offset + (face ? b : c));
    }
  }
  // Close the margin between the upper and lower surfaces. The outline runs
  // counterclockwise on the upper face, so the rim traverses it in reverse.
  if (sides === 2) {
    const n = outline.length;
    for (let a = 0; a < n; a++) {
      const b = (a + 1) % n;
      indices.push(b, a, a + n, b, a + n, b + n);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { positions, colors, indices, uvs, lowerFaces, normals: geometry.attributes.normal.array };
}
