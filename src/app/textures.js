import * as THREE from 'three';
import { LeafType, TreePreset } from '@dgreenheck/ez-tree';

// Bark values map to directories under /textures/bark/.
// Add or remove entries to expose more variants in the UI dropdown.
export const BarkType = {
  Aspen: 'Aspen',
  'Photo Smooth (unidentified)': 'PhotoSmooth',
  'Photo Furrowed (unidentified)': 'PhotoFurrowed',
  Bark001: 'Bark001',
  Bark002: 'Bark002',
  Bark003: 'Bark003',
  Bark004: 'Bark004',
  Bark006: 'Bark006',
  Bark007: 'Bark007',
  Bark008: 'Bark008',
  Bark012: 'Bark012',
  Bark013: 'Bark013',
  Bark014: 'Bark014',
  Bark015: 'Bark015',
};

const textureLoader = new THREE.TextureLoader();
const sets = new Map();
const ready = new WeakMap();

function surfaceMaps(base, species) {
  if (sets.has(base)) return sets.get(base);
  const photoBark = /\/Photo(?:Smooth|Furrowed)_1K-JPG\//.test(base);
  // Explicit null clears the photo height map when selecting another bark.
  const maps = { normal: null, roughness: null, height: null };
  const channels = photoBark ? [['color', 'Color.png'], ['normal', 'NormalGL.png'], ['roughness', 'Roughness.png'], ['height', 'Height.png']]
    : [['color', 'Color.jpg'], ['normal', 'NormalGL.jpg'], ['roughness', 'Roughness.jpg']];
  if (species) channels.push(['subsurface', 'Subsurface.png']);
  for (const [channel, file] of channels) {
    const sided = species && species !== LeafType.Pine && (channel === 'normal' || channel === 'roughness');
    const url = base + (sided ? '_Faces_' : '_') + file;
    let texture;
    const loaded = new Promise(resolve => {
      texture = textureLoader.load(url, () => resolve(true), undefined, () => {
        maps[channel] = null;
        console.warn('Missing surface map: ' + url);
        resolve(false);
      });
    });
    if (channel === 'color') texture.colorSpace = THREE.SRGBColorSpace;
    if (photoBark && channel === 'color') {
      // The longer photographic crops cover more vertical distance per tile.
      texture.userData.uvAspect = base.includes('PhotoSmooth') ? 4328 / 2836 : 4328 / 2486;
    }
    if (sided) texture.channel = 1;
    texture.userData.mimeType = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
    texture.anisotropy = 4;
    maps[channel] = texture;
    ready.set(texture, loaded);
  }
  sets.set(base, maps);
  return maps;
}

// The user can export immediately after changing species. Wait for the maps
// attached to this export snapshot, including any still being decoded.
export async function prepareExportMaterial(material) {
  const scattering = material.leafScattering;
  if (scattering?.map) {
    await ready.get(scattering.map);
    if (!scattering.map.image) scattering.map = null;
  }
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'barkHeightMap']) {
    const map = material[key];
    if (!map) continue;
    await ready.get(map);
    if (!map.image) material[key] = null;
  }
}

export function applyTreeTextures(tree) {
  const bark = tree.options.bark, leaf = tree.options.leaves;
  const barkType = Object.values(BarkType).includes(bark.type) ? bark.type : BarkType.Bark001;
  const dir = barkType + '_1K-JPG';
  Object.assign(bark.maps, surfaceMaps('/textures/bark/' + dir + '/' + dir));
  const shape = Object.values(LeafType).includes(leaf.type) ? leaf.type : LeafType.Oak;
  Object.assign(leaf.maps, surfaceMaps('/textures/foliage/' + shape, shape));
}

/**
 * Loads a named preset onto the tree, applying the matching texture set in
 * the same step so the first generate sees the textures.
 * @param {import('@dgreenheck/ez-tree').Tree} tree
 * @param {string} name - key into TreePreset registry
 * @param {boolean} generate - set false to skip the generate step when the
 * caller will generate the tree itself (e.g. via generateLODs)
 */
export function loadPresetWithTextures(tree, name, generate = true) {
  const json = structuredClone(TreePreset[name]);
  if (!json) return;
  tree.options.copy(json);
  applyTreeTextures(tree);
  if (generate) {
    tree.generate();
  }
}
