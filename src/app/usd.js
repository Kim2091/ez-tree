// ASCII layers are valid .usd files. Keep the mesh indexed and write arrays
// in chunks so exporting a dense canopy does not build one string per vertex
// for the lifetime of the stage.
const number = n => Number(n.toPrecision(7)).toString();
const tuple = (...values) => '(' + values.map(number).join(', ') + ')';

function array(parts, name, count, item, interpolation) {
  parts.push('        ' + name + ' = [');
  for (let start = 0; start < count; start += 1024) {
    const line = [];
    for (let i = start; i < Math.min(count, start + 1024); i++) line.push(item(i));
    parts.push((start ? ',\n' : '') + line.join(', '));
  }
  parts.push(']' + (interpolation ? ' (interpolation = "' + interpolation + '")' : '') + '\n');
}

const meshKind = mesh => ({ branches: 'Bark', leaves: 'Leaves' }[mesh.material.name] ?? 'Trellis');

function writeMesh(parts, mesh, name, kind, textures) {
  const g = mesh.geometry;
  const { position, normal, uv, color } = g.attributes;
  const tint = mesh.material.color;
  const index = g.index;
  const corners = index?.count ?? position.count;
  parts.push(`    def Mesh "${name}" (prepend apiSchemas = ["MaterialBindingAPI"])\n    {\n`);
  parts.push(`        rel material:binding = </Tree/Looks/${kind}>\n`);
  parts.push('        uniform token subdivisionScheme = "none"\n');
  const matrix = mesh.matrixWorld.elements;
  const rows = [0, 4, 8, 12].map(i => tuple(...matrix.slice(i, i + 4)));
  parts.push('        matrix4d xformOp:transform = (' + rows.join(', ') + ')\n');
  parts.push('        uniform token[] xformOpOrder = ["xformOp:transform"]\n');
  array(parts, 'point3f[] points', position.count, i => tuple(position.getX(i), position.getY(i), position.getZ(i)));
  array(parts, 'int[] faceVertexCounts', corners / 3, () => '3');
  array(parts, 'int[] faceVertexIndices', corners, i => index ? index.getX(i) : i);
  array(parts, 'normal3f[] normals', normal.count, i => tuple(normal.getX(i), normal.getY(i), normal.getZ(i)), 'vertex');
  const repeat = mesh.material.map?.repeat ?? { x: 1, y: 1 };
  if (uv) array(parts, 'texCoord2f[] primvars:st', uv.count, i => tuple(uv.getX(i) * repeat.x, uv.getY(i) * repeat.y), 'vertex');
  array(parts, 'color3f[] primvars:displayColor', color?.count ?? 1, i => color
    ? tuple(color.getX(i) * tint.r, color.getY(i) * tint.g, color.getZ(i) * tint.b)
    : tuple(tint.r, tint.g, tint.b), color ? 'vertex' : 'constant');
  if (color && textures?.color) {
    array(parts, 'float4[] primvars:surfaceTint', color.count, i =>
      tuple(color.getX(i) * tint.r, color.getY(i) * tint.g, color.getZ(i) * tint.b, 1), 'vertex');
  }
  parts.push('    }\n');
}

function material(kind, mesh, textures) {
  const path = '/Tree/Looks/' + kind;
  const tint = mesh.material.color;
  const channels = [
    ['color', 'diffuseColor', 'color3f', 'rgb'],
    ['normal', 'normal', 'normal3f', 'rgb'],
    ['roughness', 'roughness', 'float', 'r'],
  ].filter(([map]) => textures[map]);
  const surface = [
    '            color3f inputs:diffuseColor.connect = <' + path + '/Color.outputs:result>',
    '            float inputs:roughness = ' + number(mesh.material.roughness),
    '            float inputs:opacity = 1',
  ];
  let nodes = `
        def Shader "Color" {
            uniform token info:id = "UsdPrimvarReader_float3"
            string inputs:varname = "displayColor"
            float3 outputs:result
        }`;
  if (channels.length) nodes += `
        def Shader "UV" {
            uniform token info:id = "UsdPrimvarReader_float2"
            string inputs:varname = "st"
            float2 outputs:result
        }`;
  const vertexTint = textures.color && mesh.material.vertexColors;
  if (vertexTint) nodes += `
        def Shader "Tint" {
            uniform token info:id = "UsdPrimvarReader_float4"
            string inputs:varname = "surfaceTint"
            float4 outputs:result
        }`;
  for (const [map, input, type, output] of channels) {
    const scale = map === 'normal' ? '(2, 2, 2, 1)' : tuple(tint.r, tint.g, tint.b, 1);
    nodes += `
        def Shader "${map}Map" {
            uniform token info:id = "UsdUVTexture"
            asset inputs:file = @${textures[map]}@
            float2 inputs:st.connect = <${path}/UV.outputs:result>
            token inputs:sourceColorSpace = "${map === 'color' ? 'sRGB' : 'raw'}"
            token inputs:wrapS = "repeat"
            token inputs:wrapT = "repeat"
            ${map === 'color' && vertexTint ? 'float4 inputs:scale.connect = <' + path + '/Tint.outputs:result>'
              : map === 'roughness' ? '' : 'float4 inputs:scale = ' + scale}
            ${map === 'normal' ? 'float4 inputs:bias = (-1, -1, -1, 0)' : ''}
            ${output === 'r' ? 'float' : 'float3'} outputs:${output}
        }`;
    const connection = `            ${type} inputs:${input}.connect = <${path}/${map}Map.outputs:${output}>`;
    if (map === 'color') surface[0] = connection;
    else if (map === 'roughness') surface[1] = connection;
    else surface.push(connection);
  }
  return `    def Material "${kind}" {
        token outputs:surface.connect = <${path}/Surface.outputs:surface>
        def Shader "Surface" {
            uniform token info:id = "UsdPreviewSurface"
${surface.join('\n')}
            token outputs:surface
        }${nodes}
    }\n`;
}

export function exportUSD(root, textures = {}) {
  root.updateMatrixWorld(true);
  const parts = ['#usda 1.0\n(\n    defaultPrim = "Tree"\n    upAxis = "Y"\n    metersPerUnit = 1\n)\n\ndef Xform "Tree"\n{\n'];
  const materials = new Map();
  const instances = new Map();
  root.traverseVisible(mesh => {
    if (!mesh.isMesh || !mesh.geometry.attributes.position?.count) return;
    const kind = meshKind(mesh);
    const n = instances.get(kind) ?? 0;
    instances.set(kind, n + 1);
    materials.set(kind, mesh);
    writeMesh(parts, mesh, n ? kind + '_' + n : kind, kind, textures[kind]);
  });
  parts.push('    def Scope "Looks"\n    {\n');
  for (const [kind, mesh] of materials) parts.push(material(kind, mesh, textures[kind] ?? {}));
  parts.push('    }\n}\n');
  return new Blob(parts, { type: 'application/octet-stream' });
}

// Pack each referenced image once for all LOD stages.
export async function collectTextures(root, files) {
  const textures = {};
  for (const mesh of root.children.filter(child => child.isMesh)) {
    const maps = {};
    for (const [channel, key] of [['color', 'map'], ['roughness', 'roughnessMap'], ['normal', 'normalMap']]) {
      const src = mesh.material[key]?.image?.src;
      if (!src) continue;
      const name = 'textures/' + new URL(src).pathname.split('/').pop();
      const response = await fetch(src);
      if (!response.ok) throw new Error('Could not read ' + name);
      files[name] = new Uint8Array(await response.arrayBuffer());
      maps[channel] = name;
    }
    textures[meshKind(mesh)] = maps;
  }
  return textures;
}
