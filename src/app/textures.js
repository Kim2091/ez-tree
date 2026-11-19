import * as THREE from 'three';
import { LeafType, TreePreset } from '@dgreenheck/ez-tree';

// Bark keys map 1:1 to ambientcg directories under /textures/bark/.
// Add or remove entries to expose more variants in the UI dropdown.
export const BarkType = {
  Aspen: 'Aspen',
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

function surfaceMaps(base, foliage = false) {
  if (sets.has(base)) return sets.get(base);
  const maps = {};
  const channels = [['color', 'Color.jpg'], ['normal', 'NormalGL.jpg'], ['roughness', 'Roughness.jpg']];
  if (foliage) channels.push(['subsurface', 'Subsurface.png']);
  for (const [channel, file] of channels) {
    const url = base + '_' + file;
    let texture;
    const loaded = new Promise(resolve => {
      texture = textureLoader.load(url, () => resolve(true), undefined, () => {
        maps[channel] = null;
        console.warn('Missing surface map: ' + url);
        resolve(false);
      });
    });
    if (channel === 'color') texture.colorSpace = THREE.SRGBColorSpace;
    if (channel === 'color' || channel === 'roughness') texture.userData.mimeType = 'image/jpeg';
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
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
    const map = material[key];
    if (!map) continue;
    await ready.get(map);
    if (!map.image) material[key] = null;
  }
}

export function applyTreeTextures(tree) {
  const bark = tree.options.bark, leaf = tree.options.leaves;
  const barkType = Object.hasOwn(BarkType, bark.type) ? bark.type : BarkType.Bark001;
  const dir = barkType + '_1K-JPG';
  Object.assign(bark.maps, surfaceMaps('/textures/bark/' + dir + '/' + dir));
  const shape = Object.values(LeafType).includes(leaf.type) ? leaf.type : LeafType.Oak;
  Object.assign(leaf.maps, surfaceMaps('/textures/foliage/' + shape, true));
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
