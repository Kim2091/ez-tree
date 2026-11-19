import { CanvasTexture } from 'three';

const packedMasks = new WeakMap();

// The authoring PNG is plain grayscale. glTF stores the diffuse transmission
// weight in A on a separate texture, independent of base-color opacity.
function transmissionMask(map) {
  if (packedMasks.has(map)) return packedMasks.get(map);
  const canvas = document.createElement('canvas');
  canvas.width = map.image.width;
  canvas.height = map.image.height;
  const context = canvas.getContext('2d');
  context.drawImage(map.image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i + 3] = pixels.data[i];
    pixels.data.fill(255, i, i + 3);
  }
  context.putImageData(pixels, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.name = 'Leaf subsurface weight';
  texture.flipY = map.flipY;
  packedMasks.set(map, texture);
  return texture;
}

export function leafDiffuseTransmission(writer) {
  const name = 'KHR_materials_diffuse_transmission';
  return {
    name,
    writeMaterial(material, definition) {
      // This Three.js exporter spells the metallic/roughness UV selector
      // "channel". glTF readers consume "texCoord" on textureInfo.
      const mr = definition.pbrMetallicRoughness?.metallicRoughnessTexture;
      if (mr && 'channel' in mr) {
        mr.texCoord = mr.channel;
        delete mr.channel;
      }
      const scattering = material.leafScattering;
      if (!scattering?.map) return;
      definition.extensions ??= {};
      definition.extensions[name] = {
        diffuseTransmissionFactor: scattering.strength,
        diffuseTransmissionColorFactor: scattering.color.toArray(),
        diffuseTransmissionTexture: { index: writer.processTexture(transmissionMask(scattering.map)) },
      };
      writer.extensionsUsed[name] = true;
    },
  };
}
