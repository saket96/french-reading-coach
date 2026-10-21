#!/usr/bin/env python3
"""Generate DualCoach icons in Coach de lecture française brand colors."""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons")
SRC = os.path.join(ROOT, "tools", "icon-src")

CREAM = (246, 241, 231, 255)       # --color-background
CARD = (255, 250, 242, 255)        # --color-card
INK = (31, 42, 36, 255)            # --color-foreground
RING = (47, 111, 94, 255)          # --color-ring
MINT = (200, 230, 216, 255)        # guide-word-active
BORDER = (217, 207, 192, 255)      # --color-border


def font(size: int):
  for name in (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  ):
    if os.path.isfile(name):
      return ImageFont.truetype(name, size)
  return ImageFont.load_default()


def render(size: int = 512) -> Image.Image:
  img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
  d = ImageDraw.Draw(img)
  pad = int(size * 0.06)
  radius = int(size * 0.22)
  d.rounded_rectangle([pad, pad, size - pad - 1, size - pad - 1], radius=radius, fill=CREAM)
  d.rounded_rectangle(
    [pad, pad, size - pad - 1, size - pad - 1],
    radius=radius,
    outline=RING,
    width=max(2, size // 48),
  )

  # Dual subtitle bars (learning line + translation line)
  bar_left = int(size * 0.22)
  bar_right = int(size * 0.78)
  y1 = int(size * 0.38)
  y2 = int(size * 0.52)
  h = max(6, int(size * 0.09))
  r = max(3, h // 2)
  d.rounded_rectangle([bar_left, y1, bar_right, y1 + h], radius=r, fill=RING)
  d.rounded_rectangle([bar_left + int(size * 0.06), y2, bar_right - int(size * 0.06), y2 + h], radius=r, fill=MINT)
  d.rounded_rectangle(
    [bar_left + int(size * 0.06), y2, bar_right - int(size * 0.06), y2 + h],
    radius=r,
    outline=BORDER,
    width=max(1, size // 128),
  )

  # Monogram
  label = "DC"
  f = font(max(12, int(size * 0.16)))
  bbox = d.textbbox((0, 0), label, font=f)
  tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
  d.text(((size - tw) / 2, size * 0.68), label, font=f, fill=INK)
  return img


def main() -> None:
  os.makedirs(OUT, exist_ok=True)
  os.makedirs(SRC, exist_ok=True)
  master = render(1024)
  master.resize((512, 512), Image.LANCZOS).save(os.path.join(SRC, "icon512.png"))
  # CWS 128: 96 art + 16 padding
  pad = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
  pad.alpha_composite(master.resize((96, 96), Image.LANCZOS), (16, 16))
  pad.save(os.path.join(OUT, "icon128.png"))
  for size in (48, 32, 16):
    master.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, f"icon{size}.png"))
  # Docs + store icon copies
  pad.save(os.path.join(ROOT, "docs", "icon128.png"))
  pad.save(os.path.join(ROOT, "store", "store-icon-128.png"))
  print("DualCoach FRC icons written")


if __name__ == "__main__":
  main()
