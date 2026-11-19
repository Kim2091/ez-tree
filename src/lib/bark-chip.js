import { Vector2, Vector3 } from 'three';

// Replace a bark quad with a closed rim around a narrow, recessed sliver.
// Corners run around the surface: lower left, upper left, upper right, lower right.
export const chipTrianglesAdded = 10;

export function cutBarkChip(buffers, corners, u, v, width, height, depth, lean) {
  const positions = corners.map(i => new Vector3().fromArray(buffers.verts, 3 * i));
  const uvs = corners.map(i => new Vector2().fromArray(buffers.uvs, 2 * i));
  const sample = (quad, x, y) => quad[0].clone().lerp(quad[3], x)
    .lerp(quad[1].clone().lerp(quad[2], x), y);
  const normal = positions[1].clone().sub(positions[0])
    .cross(positions[3].clone().sub(positions[0])).normalize();
  const lip = [[u - width, v - height * 0.38], [u + width * lean, v + height],
    [u + width, v + height * 0.22], [u - width * lean, v - height]];
  const crest = lip.map(([x, y]) => sample(positions, x, y));
  const grain = lip.map(([x, y]) => sample(uvs, x, y));
  function vertex(point, uv, n, tint) {
    const index = buffers.verts.length / 3;
    buffers.verts.push(point.x, point.y, point.z);
    buffers.uvs.push(uv.x, uv.y);
    buffers.normals.push(n.x, n.y, n.z);
    buffers.colors.push(...tint);
    return index;
  }
  const rim = crest.map((p, i) => vertex(p, grain[i], normal, [255, 255, 255]));
  const floor = sample(positions, u, v).addScaledVector(normal, -depth);
  const centerUV = sample(uvs, u, v);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    buffers.indices.push(corners[i], corners[j], rim[i], corners[j], rim[j], rim[i]);
    const facet = crest[j].clone().sub(crest[i]).cross(floor.clone().sub(crest[i])).normalize();
    // The split wood runs along the grain. A narrower UV strip stretches
    // its grain along the scar while the surrounding bark retains its UVs.
    const strip = uv => new Vector2(centerUV.x + (uv.x - centerUV.x) * 0.16, uv.y);
    buffers.indices.push(vertex(crest[i], strip(grain[i]), facet, [246, 175, 103]),
      vertex(crest[j], strip(grain[j]), facet, [246, 175, 103]),
      vertex(floor, centerUV, facet, [197, 111, 60]));
  }
}
