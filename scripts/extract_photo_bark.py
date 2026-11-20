"""Build detailed bark color tiles directly from the user's photographs.

Example: python scripts/extract_photo_bark.py --source-dir "C:/.../trees"
Large native-resolution photographic crops are wrapped along narrow low-error
paths. The furrowed crop receives a selective yellow color correction. No
source photographs are copied to the repository.
"""
from argparse import ArgumentParser
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
# Crops stay within the photographed trunk; no background is sampled. Each
# row is an independently positioned patch from the actual original pixels.
SOURCES = {
    "PhotoSmooth": ("P1250194_DxO.jpg", (250, 100, 3150, 4492)),
    "PhotoFurrowed": ("P1250234_DxO.jpg", (500, 100, 3050, 4492)),
}

OVERLAP = 64


def crop_photo(path, box):
    with Image.open(path) as photo:
        photo = ImageOps.exif_transpose(photo).convert("RGB")
        if box[2] > photo.width or box[3] > photo.height:
            raise ValueError(f"Crop exceeds {path.name} dimensions {photo.size}")
        photo = photo.crop(box)
    # Do not resize, de-light, sharpen, denoise, or synthesize source pixels.
    return np.asarray(photo, dtype=np.uint8)


def minimum_error_blend(left, right):
    """Cut through a low-difference path, feathering only eight pixels."""
    error = np.mean(np.abs(left.astype(np.int16) - right.astype(np.int16)), axis=2).astype(np.uint8)
    error = np.asarray(Image.fromarray(error).filter(ImageFilter.GaussianBlur(3)), dtype=np.float32)
    height, width = error.shape
    parent = np.empty((height, width), dtype=np.int8)
    cost = error[0].copy()
    parent[0] = 0
    for y in range(1, height):
        previous = np.stack((np.r_[np.inf, cost[:-1]], cost, np.r_[cost[1:], np.inf]))
        choice = np.argmin(previous, axis=0)
        parent[y] = choice.astype(np.int8) - 1
        cost = error[y] + previous[choice, np.arange(width)]
    seam = np.empty(height, dtype=np.int32)
    seam[-1] = np.argmin(cost)
    for y in range(height - 1, 0, -1):
        seam[y - 1] = seam[y] + parent[y, seam[y]]
    x = np.arange(width, dtype=np.float32)[None, :]
    weight = np.clip((x - seam[:, None] + 4) / 8, 0, 1)[..., None]
    return np.uint8(np.clip(np.rint(left * (1 - weight) + right * weight), 0, 255))


def wrap_horizontal(pixels, overlap=OVERLAP):
    period = pixels.shape[1] - overlap
    result = pixels[:, :period].copy()
    result[:, :overlap] = minimum_error_blend(pixels[:, period:], pixels[:, :overlap])
    return result


def make_tile(pixels):
    tile = wrap_horizontal(pixels)
    tile = np.swapaxes(wrap_horizontal(np.swapaxes(tile, 0, 1)), 0, 1)
    return Image.fromarray(tile, "RGB")


def reduce_yellow(image):
    """Reduce yellow lichen color while retaining luminance and photo detail."""
    pixels = np.asarray(image.convert("RGB"), dtype=np.uint8).copy()
    for start in range(0, pixels.shape[0], 512):
        end = min(start + 512, pixels.shape[0])
        color = pixels[start:end].astype(np.float32) / 255
        r, g, b = color[..., 0], color[..., 1], color[..., 2]
        mask = np.clip((np.minimum(r, g) - b - 0.015) / 0.11, 0, 1)
        mask *= np.clip((g - r + 0.22) / 0.13, 0, 1) * 0.8
        gray = (0.2126 * r + 0.7152 * g + 0.0722 * b)[..., None]
        pixels[start:end] = np.uint8(np.clip(np.rint((color + (gray - color) * mask[..., None]) * 255), 0, 255))
    return Image.fromarray(pixels, "RGB")


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "src/app/public/textures/bark")
    args = parser.parse_args()
    for name, (filename, box) in SOURCES.items():
        result = make_tile(crop_photo(args.source_dir / filename, box))
        if name == "PhotoFurrowed":
            result = reduce_yellow(result)
        folder = args.output_dir / f"{name}_1K-JPG"
        folder.mkdir(parents=True, exist_ok=True)
        output = folder / f"{name}_1K-JPG_Color.png"
        result.save(output, optimize=True)
        print(f"{name}: {output} ({result.width} x {result.height})")


if __name__ == "__main__":
    main()
