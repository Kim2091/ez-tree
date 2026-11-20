import { ShapeUtils, Vector2, Vector3 } from 'three';

// Replace a bark quad with a closed rim around a narrow, recessed sliver.
// Corners run around the surface: lower left, upper left, upper right, lower right.
export const chipTrianglesAdded = 14;

const outlines = {
  sliver: [[-0.60,-0.48],[-0.97,0.14],[0.08,1],[0.85,0.45],[0.65,-0.24],[-0.16,-1]],
  split: [[-0.32,-0.58],[-0.90,0.16],[0.27,1],[0.22,0.28],[0.86,-0.14],[-0.21,-1]],
  scrape: [[-0.61,-0.76],[-1,0.18],[-0.37,0.83],[0.69,0.64],[0.95,-0.32],[0.22,-0.91]],
};

export function cutBarkChip(buffers, corners, u, v, width, height, depth, chip) {
  const positions = corners.map(i => new Vector3().fromArray(buffers.verts, 3 * i));
  const uvs = corners.map(i => new Vector2().fromArray(buffers.uvs, 2 * i));
  const sample = (quad, x, y) => quad[0].clone().lerp(quad[3], x)
    .lerp(quad[1].clone().lerp(quad[2], x), y);
  const normal = positions[1].clone().sub(positions[0])
    .cross(positions[3].clone().sub(positions[0])).normalize();
  const lip = outlines[chip.kind].map(([x, y]) =>
    [u + width * (0.76 * x + 0.33 * chip.lean * y), v + height * y]);
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
  const barkNormals = corners.map(i => new Vector3().fromArray(buffers.normals, 3 * i));
  const rim = crest.map((p, i) => vertex(p, grain[i], sample(barkNormals, ...lip[i]).normalize(), [255, 255, 255]));
  const floor = sample(positions, u + width * chip.lean * 0.23, v).addScaledVector(normal, -depth);
  const centerUV = sample(uvs, u + width * chip.lean * 0.23, v);
  const age = chip.age;
  const fresh = chip.kind === 'split' ? [179, 139, 100] : [246, 192, 136];
  const edge = fresh.map((c, i) => Math.round(c + ([166, 155, 139][i] - c) * age));
  const shade = chip.kind === 'split' ? 0.48 : chip.kind === 'scrape' ? 0.83 : 0.66;
  const inner = edge.map(c => Math.round(c * shade));
  // Triangulate the irregular lip as a hole in the original quad. A fixed
  // fan can cross a corner of the lip when a wound lies near a ring seam.
  const boundary = [new Vector2(0, 0), new Vector2(0, 1), new Vector2(1, 1), new Vector2(1, 0)];
  const surface = corners.concat(rim);
  for (const [a, b, c] of ShapeUtils.triangulateShape(boundary, [lip.map(([x, y]) => new Vector2(x, y))])) {
    buffers.indices.push(surface[c], surface[b], surface[a]);
  }
  for (let i = 0; i < rim.length; i++) {
    const j = (i + 1) % rim.length;
    const facet = crest[j].clone().sub(crest[i]).cross(floor.clone().sub(crest[i])).normalize();
    // The split wood runs along the grain. A narrower UV strip stretches
    // its grain along the scar while the surrounding bark retains its UVs.
    const strip = uv => new Vector2(centerUV.x + (uv.x - centerUV.x) * 0.16, uv.y);
    buffers.indices.push(vertex(crest[i], strip(grain[i]), facet, edge),
      vertex(crest[j], strip(grain[j]), facet, edge),
      vertex(floor, centerUV, facet, inner));
  }
}
