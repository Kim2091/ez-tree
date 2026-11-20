"""Estimate bark surface maps from native-resolution photographic color tiles.

These are artistic estimates, not measured height or material properties.
No generative processing, resizing, or changes to the color images are used.
"""
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parents[1] / 'src/app/public/textures/bark'


def derive(name):
    base = f'{name}_1K-JPG'
    folder = ROOT / base
    with Image.open(folder / f'{base}_Color.png') as image:
        rgb = np.asarray(image.convert('RGB'), dtype=np.float32) / 255
    # Relative luminance, with a broad local average removed to reduce large
    # lighting gradients. Dark fissures are assumed to be lower than ridges.
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    del rgb
    smooth = gaussian_filter(lum, 1.0, mode='wrap')
    broad = gaussian_filter(lum, 32.0, mode='wrap')
    detail = smooth - broad
    scale = max(float(np.percentile(np.abs(detail), 99)), 0.01)
    height = np.clip(0.5 + 0.4 * detail / scale, 0, 1)
    Image.fromarray(np.rint(height * 65535).astype(np.uint16)).save(folder / f'{base}_Height.png')
    # OpenGL tangent-space normals. Wrap derivatives match repeat addressing.
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 3
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 3
    length = np.sqrt(dx * dx + dy * dy + 1)
    normals = np.stack((-dx / length, dy / length, 1 / length), axis=-1)
    Image.fromarray(np.uint8(np.clip(np.rint((normals * 0.5 + 0.5) * 255), 0, 255)), 'RGB').save(folder / f'{base}_NormalGL.png')
    # Conservative matte variation; photographs cannot measure roughness.
    roughness = np.clip(0.89 - 0.10 * (height - 0.5), 0, 1)
    Image.fromarray(np.uint8(np.rint(roughness * 255)), 'L').save(folder / f'{base}_Roughness.png')
    print(f'{name}: wrote {height.shape[1]} x {height.shape[0]} height, normal and roughness')


if __name__ == '__main__':
    for bark in ('PhotoSmooth', 'PhotoFurrowed'):
        derive(bark)
