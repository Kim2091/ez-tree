import oak from './presets/oak_medium.json';

export default class TreeOptions {
  constructor() {
    this.seed = 0;
    this.type = oak.type;
    // A new library tree uses the same crown and surfaces as the editor's oak.
    // Clone the nested controls so edits to one seed never mutate the preset.
    this.bark = {
      ...structuredClone(oak.bark),
      damage: 0.25,
      maps: { color: null, ao: null, normal: null, roughness: null },
    };
    this.branch = structuredClone(oak.branch);
    this.leaves = {
      ...oak.leaves,
      maps: { color: null, normal: null, roughness: null, subsurface: null },
      subsurfaceStrength: 0.65,
      shootColorVariation: true,
      damage: 0.18,
      roundedNormals: true,
    };

    // Trellis parameters
    this.trellis = {
      // Whether trellis is enabled
      enabled: false,

      // Position of trellis (z is distance from tree)
      position: { x: 0, y: 0, z: -2 },

      // Width of trellis grid (X direction)
      width: 10,

      // Height of trellis grid (Y direction)
      height: 20,

      // Distance between grid lines
      spacing: 2,

      // Force parameters
      force: {
        // How strongly branches bend toward trellis
        strength: 0.02,
        // Maximum distance at which trellis affects branches
        maxDistance: 3,
        // Distance falloff exponent (1 = linear, 2 = quadratic)
        falloff: 1,
      },

      // Radius of trellis cylinders
      cylinderRadius: 0.05,

      // Whether to show trellis geometry
      visible: true,

      // Color of trellis
      color: 0x8b4513,
    };
  }

  /**
   * Copies the values from source into this object
   * @param {TreeOptions} source 
   */
  copy(source, target = this) {
    for (let key in source) {
      if (source.hasOwnProperty(key) && target.hasOwnProperty(key)) {
        const value = source[key];
        // Assign THREE.Texture (and any non-plain object) by reference rather
        // than recursing — recursion would walk a Texture's internals.
        if (value !== null && typeof value === 'object' && value.constructor === Object) {
          this.copy(value, target[key]);
        } else {
          target[key] = value;
        }
      }
    }
  }
}
