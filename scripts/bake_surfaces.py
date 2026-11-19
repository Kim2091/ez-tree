"""Bake the opaque leaf surfaces and aspen bark. Requires Pillow, NumPy and SciPy."""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.spatial import cKDTree


PUBLIC = Path(__file__).resolve().parents[1] / "src/app/public/textures"
SIZE = 1024
row, col = np.mgrid[:SIZE, :SIZE]
u, v = (col + 0.5) / SIZE, 1 - (row + 0.5) / SIZE


def noise(rng, samples):
    tile = Image.fromarray(rng.integers(0, 256, (samples, samples), dtype=np.uint8))
    return np.asarray(tile.resize((SIZE, SIZE), Image.Resampling.BICUBIC)).astype(float) / 255 - 0.5


def save_maps(base, pigment, height, roughness):
    base.parent.mkdir(exist_ok=True, parents=True)
    dy, dx = np.gradient(height)
    normals = np.stack([-dx, dy, np.ones_like(dx)], axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    for suffix, pixels in [
        ("Color", pigment), ("NormalGL", (normals + 1) * 127.5), ("Roughness", roughness * 255),
    ]:
        img = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8))
        img.save(base.with_name(base.name + "_" + suffix + ".jpg"), quality=93, subsampling=0)


def leaf(species, seed, veins):
    rng = np.random.default_rng(seed)
    broad = noise(rng, 9)
    fine = noise(rng, 135)
    grain = rng.normal(0, 1, u.shape)
    center = 0.5 + 0.004 * np.sin(v * 14 + seed) * np.sin(v * np.pi)
    x = np.abs(u - center)
    if species == "pine":
        # Longitudinal ribs and pale rows of stomata along the needle.
        rib = (0.5 + 0.5 * np.cos(2 * np.pi * (u * 5.5 + 0.06 * np.sin(v * 13)))) ** 7
        pores = (0.5 + 0.5 * np.cos(v * 470 + u * 14)) ** 11
        relief = rib * 0.9 + 0.4 * rib * pores
        pigment = (212 + 23 * broad + 13 * fine + 18 * rib + 16 * rib * pores)[..., None]
        pigment = pigment * np.array([0.94, 1, 0.99])
    else:
        # Build the secondary and tertiary veins in blade coordinates. Start
        # both sides on the midrib and taper the lines toward the margin.
        field = Image.new("L", (SIZE, SIZE))
        draw = ImageDraw.Draw(field)

        def stroke(xs, ys, intensity, width):
            coords = list(zip(xs * SIZE, (1 - ys) * SIZE))
            draw.line(coords, fill=intensity, width=width)

        for side in (-1, 1):
            for level in range(veins):
                y0 = 0.045 + 0.83 * (level + rng.uniform(-0.12, 0.12)) / veins
                reach = 0.53 * np.sin(np.pi * y0) ** 0.48
                rise = rng.uniform(0.12, 0.23) * (1 - 0.43 * y0)
                t = np.linspace(0, 1, 65)
                xs = 0.5 + side * reach * t
                ys = y0 + rise * (1.6 * t - 0.6 * t * t) + 0.008 * np.sin(8 * t + level) * t
                for j in range(1, 10):
                    k = j * 6
                    s = np.linspace(0, 1, 12)
                    stroke(xs[k] + side * s * reach * 0.11,
                           ys[k] + s * rng.uniform(0.022, 0.065), 78, 1)
                stroke(xs, ys, 173, 3)
                stroke(xs[:29], ys[:29], 212, 4)

        secondary = np.asarray(field.filter(ImageFilter.GaussianBlur(0.85))) / 255
        midrib = np.exp(-(x / (0.0017 + 0.0065 * (1 - v) ** 1.4)) ** 2)
        # Fine irregular areoles occupy the tissue between the larger veins.
        domain = np.stack([(u + 0.015 * broad) * 57, (v - 0.80 * x + 0.009 * broad) * 88], axis=-1)
        seeds = rng.uniform([-3, -45], [61, 92], size=(5900, 2))
        nearest = cKDTree(seeds).query(domain.reshape(-1, 2), k=2)[0]
        network = np.exp(-(np.diff(nearest, axis=1).reshape(u.shape) / 0.082) ** 2)
        relief = 2.9 * midrib + 1.65 * secondary + 0.28 * network
        pigment = (212 + 34 * broad + 12 * fine + 9 * network + 21 * secondary)[..., None]
        pigment = pigment * np.array([0.97, 1.015, 0.95])
        pigment += (midrib + 0.6 * secondary)[..., None] * np.array([40, 20, 13])
        pigment += (v - 0.5)[..., None] * np.array([11, 6, -2])
        for _ in range(35):
            cx, cy = rng.uniform(0.06, 0.94, 2)
            radius = rng.uniform(0.001, 0.004)
            fleck = np.exp(-((u - cx) ** 2 + (v - cy) ** 2 * 1.6) / radius ** 2)
            pigment -= fleck[..., None] * np.array([31, 46, 40])
    pigment += grain[..., None] * 1.7
    height = relief + 0.15 * fine + 0.022 * grain
    roughness = 0.60 + 0.11 * broad + 0.08 * fine + 0.045 * relief
    save_maps(PUBLIC / "foliage" / species, pigment, height, roughness)


def aspen_bark():
    rng = np.random.default_rng(4315)
    original = PUBLIC / "bark/Bark007_1K-JPG/Bark007_1K-JPG_Color.jpg"
    grain = np.asarray(Image.open(original).convert("L").resize((SIZE, SIZE))).astype(float)
    grain = (grain - grain.mean()) / grain.std()
    base = 171 + 7 * grain + 12 * noise(rng, 8)
    scars = np.zeros_like(u)
    # The texture repeats on the trunk. Wrap every lenticel across the tile.
    for _ in range(170):
        cx, cy = rng.random(2)
        width = int(rng.uniform(4, 38))
        height = rng.uniform(0.8, 2.5)
        xx = np.arange(-2 * width, 2 * width + 1)
        yy = np.arange(-12, 13)[:, None]
        arc = height * (xx / width) ** 2
        mark = np.exp(-(xx / width) ** 4 - ((yy - arc) / height) ** 2)
        idx = np.ix_((int(cy * SIZE) + yy[:, 0]) % SIZE, (int(cx * SIZE) + xx) % SIZE)
        scars[idx] = np.maximum(scars[idx], mark * rng.uniform(0.45, 1))
    pigment = (base - scars * 99)[..., None] * np.array([1.035, 1.025, 0.93])
    save_maps(PUBLIC / "bark/Aspen_1K-JPG/Aspen_1K-JPG", pigment,
              0.21 * grain - 2.8 * scars, 0.81 + 0.025 * grain)


if __name__ == "__main__":
    for args in [("oak", 211, 8), ("aspen", 173, 6), ("ash", 139, 10), ("pine", 89, 0)]:
        leaf(*args)
    aspen_bark()
