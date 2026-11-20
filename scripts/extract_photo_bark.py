"""Build detailed bark color tiles directly from the user's photographs.

Example: python scripts/extract_photo_bark.py --source-dir "C:/.../trees"
Large native-resolution photographic crops are wrapped along narrow low-error
paths. Pixels outside those seam regions remain unchanged. No source
photographs are copied to the repository.
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


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "src/app/public/textures/bark")
    args = parser.parse_args()
    for name, (filename, box) in SOURCES.items():
        result = make_tile(crop_photo(args.source_dir / filename, box))
        folder = args.output_dir / f"{name}_1K-JPG"
        folder.mkdir(parents=True, exist_ok=True)
        output = folder / f"{name}_1K-JPG_Color.png"
        result.save(output, optimize=True)
        print(f"{name}: {output} ({result.width} x {result.height})")


if __name__ == "__main__":
    main()
