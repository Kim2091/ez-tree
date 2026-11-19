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

export function frameTree(tree, camera, controls, sun) {
  const bounds = new THREE.Box3().setFromObject(tree);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(0.5, size.length() / 2);
  const direction = camera.position.clone().sub(controls.target).normalize();
  const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
  const distance = 1.15 * Math.max(size.y, Math.max(size.x, size.z) / camera.aspect) / (2 * Math.tan(halfFov))
    + 0.35 * Math.max(size.x, size.z);
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, Math.max(1, distance));
  controls.update();
  sun.target.position.copy(center);
  Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius });
  sun.shadow.camera.updateProjectionMatrix();
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
    0.015,
    2000,
  );

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = true;
  controls.maxPolarAngle = Math.PI / 2 + 0.35;
  controls.minDistance = 0.05;
  controls.maxDistance = 150;
  const tree = new Tree();
  loadPresetWithTextures(tree, 'Ash Medium');
  camera.position.set(1, 0.02, 0.28);
  frameTree(tree, camera, controls, environment.skybox.sun);
  renderer.domElement.title = 'Double-click bark or foliage to inspect its surface';
  renderer.domElement.addEventListener('dblclick', event => {
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(2 * (event.clientX - rect.left) / rect.width - 1,
      1 - 2 * (event.clientY - rect.top) / rect.height);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects([tree.leavesMesh, tree.branchesMesh], false)[0];
    if (!hit) return frameTree(tree, camera, controls, environment.skybox.sun);
    const d = hit.object === tree.leavesMesh ? tree.options.leaves.size * 2.3 : tree.options.branch.radius[0] * 5;
    controls.target.copy(hit.point);
    camera.position.copy(hit.point).addScaledVector(ray.ray.direction, -Math.max(0.12, d));
    controls.update();
  });
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
