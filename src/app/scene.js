import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Tree, TreePreset } from '@dgreenheck/ez-tree';
import { Environment } from './environment';
import { loadPresetWithTextures } from './textures';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function paintUI() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

/**
 * Creates a new instance of the Three.js scene
 * @param {THREE.WebGLRenderer} renderer 
 * @returns 
 */
export async function createScene(renderer) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x94b9f8, 0.0015);

  const environment = new Environment();
  scene.add(environment);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    2000,
  );

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = true;
  controls.maxPolarAngle = Math.PI / 2 + 0.35;
  controls.minDistance = 0.5;
  controls.maxDistance = 150;
  const tree = new Tree();
  loadPresetWithTextures(tree, 'Ash Medium');
  const bounds = new THREE.Box3().setFromObject(tree);
  bounds.getCenter(controls.target);
  const height = bounds.max.y - bounds.min.y;
  const distance = 0.65 * height / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.copy(controls.target).add(new THREE.Vector3(distance, -0.06 * height, 0));
  controls.update();
  tree.castShadow = true;
  tree.receiveShadow = true;
  scene.add(tree);

  // Add a forest of trees in the background
  const forest = new THREE.Group();
  forest.name = 'Forest';

  const logoElement = document.getElementById('logo');
  const progressElement = document.getElementById('loading-text');

  logoElement.style.clipPath = `inset(100% 0% 0% 0%)`;
  progressElement.innerHTML = 'LOADING... 0%';

  const treeCount = 16;
  const minDistance = 175;
  const maxDistance = 500;

  function createTree() {
    const r = minDistance + Math.random() * maxDistance;
    const theta = 2 * Math.PI * Math.random();
    const presets = Object.keys(TreePreset);
    const index = Math.floor(Math.random() * presets.length);

    const t = new Tree();
    t.position.set(r * Math.cos(theta), 0, r * Math.sin(theta));
    loadPresetWithTextures(t, presets[index], false);
    t.options.seed = 10000 * Math.random();
    // The scenery stays outside the editing area. Only allocate its distant mesh.
    t.generateLODs([{ distance: 0, detail: {
      sectionStride: 6, segmentFactor: 0.4, leafStride: 10, leafScale: 1.4, leafDetail: 'coarse',
    } }]);
    t.castShadow = true;
    t.receiveShadow = true;

    forest.add(t);
  }

  async function loadTrees(i) {
    while (i < treeCount) {
      createTree();

      const progress = Math.floor(100 * (i + 1) / treeCount);

      // Update progress UI
      logoElement.style.clipPath = `inset(${100 - progress}% 0% 0% 0%)`;
      progressElement.innerText = `LOADING... ${progress}%`;

      // Wait for the next animation frame to continue
      await paintUI();

      i++;
    }

    // All trees are loaded, hide loading screen
    await sleep(300);
    logoElement.style.clipPath = `inset(0% 0% 0% 0%)`;
    document.getElementById('loading-screen').style.display = 'none';
  }

  // Start the tree loading process
  await loadTrees(0);

  scene.add(forest);

  return {
    scene,
    environment,
    tree,
    camera,
    controls
  }
}
