import { Box3 } from 'three';

// Count actual exported triangles, including any visible trellis. Cache by
// detail until the shared tree skeleton or trellis changes.
export class LODManager {
  constructor(tree, details) {
    this.tree = tree;
    this.details = details;
    this.cache = new Map();
  }

  invalidate() { this.cache.clear(); }

  count(detail) {
    const key = JSON.stringify(detail);
    if (this.cache.has(key)) return this.cache.get(key).triangles;
    const { branches, leaves } = this.tree.createGeometry(detail);
    let triangles = (branches.index.count + leaves.index.count) / 3;
    branches.computeBoundingBox(); leaves.computeBoundingBox();
    const bounds = new Box3().union(branches.boundingBox).union(leaves.boundingBox);
    branches.dispose(); leaves.dispose();
    this.tree.updateMatrixWorld(true);
    const worldToTree = this.tree.matrixWorld.clone().invert();
    this.tree.trellisMesh?.traverseVisible(mesh => {
      if (!mesh.isMesh) return;
      triangles += mesh.geometry.index.count / 3;
      mesh.geometry.computeBoundingBox();
      const local = worldToTree.clone().multiply(mesh.matrixWorld);
      bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(local));
    });
    this.cache.set(key, { triangles, bounds });
    return triangles;
  }

  boundsFor(detail) {
    this.count(detail);
    return this.cache.get(JSON.stringify(detail)).bounds;
  }

  // Never rewrite LOD0. Only refit a later level when it exceeds its
  // predecessor, unless the user explicitly requests automatic LODs.
  reconcile({ auto = false } = {}) {
    const adjusted = [];
    let previous = this.count(this.details[0]);
    for (let i = 1; i < this.details.length; i++) {
      let triangles = this.count(this.details[i]);
      if (triangles > previous || auto) {
        const target = Math.floor(previous * 0.5);
        const mode = this.details[i].leafDetail;
        const candidate = this.tree.fitTriangleBudget(target, {
          thinLeaves: mode === 'thin', compactLeaves: mode === 'compact', microLeaves: mode === 'micro',
        });
        const fitted = this.count(candidate);
        // If the fitter cannot reduce this geometry any further, reusing the
        // previous settings is the only guaranteed non-increasing fallback.
        this.details[i] = fitted <= previous ? candidate : { ...this.details[i - 1] };
        triangles = fitted <= previous ? fitted : previous;
        adjusted.push(i);
      }
      previous = triangles;
    }
    return adjusted;
  }
}
