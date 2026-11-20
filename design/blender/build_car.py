"""Builds the LaPan drive-mode car and renders the map marker sprite.

Run from the repository root:
  blender --background --factory-startup --python design/blender/build_car.py -- [--preview]

Outputs:
  public/drive-car.png            map marker, transparent, car pointing up (screen top = forward)
  design/blender/sampai-car.blend editable source
  --preview also writes design/blender/car-preview.png, a 3/4 beauty shot
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from senja_kit import (CORAL, GLASS, LAVENDER, PAPER, PEACH, PLUM, ROOT, TYRE,  # noqa: E402
                       box, camera, cylinder, empty, material, render, reset, save, stage, taper)

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def build_car(paint_hex=PLUM):
    paint = material(f"Paint {paint_hex}", paint_hex, rough=0.32, coat=0.6)
    roof = material("Roof paper", PAPER, rough=0.4, coat=0.4)
    glass = material("Glass", GLASS, rough=0.08, metal=0.2)
    tyre = material("Tyre", TYRE, rough=0.8)
    rim = material("Rim lavender", LAVENDER, rough=0.3, metal=0.6)
    head = material("Headlight", PAPER, rough=0.2, emission=PEACH, strength=3.0)
    tail = material("Taillight", CORAL, rough=0.3, emission=CORAL, strength=2.5)
    trim = material("Trim", TYRE, rough=0.6)

    root = empty("SampaiCar")
    # Compact hatchback, forward is +Y. Units are metres.
    box("Body", (1.72, 3.9, 0.62), (0, 0, 0.55), paint, bevel=0.22, segments=4, parent=root)
    hood = box("Hood", (1.6, 1.1, 0.2), (0, 1.25, 0.86), paint, bevel=0.12, segments=4, parent=root)
    hood.rotation_euler.x = math.radians(-6)
    cabin = box("Cabin", (1.58, 2.25, 0.62), (0, -0.35, 1.12), glass, bevel=0.16, segments=4, parent=root)
    taper(cabin, 0.86, 0.78)
    # The cabin bevel rounds its top inward, so the roof panel sits on the flat part only.
    box("Roof", (1.08, 1.4, 0.05), (0, -0.4, 1.435), roof, bevel=0.025, segments=3, parent=root)
    box("Roof stripe", (0.22, 1.42, 0.02), (0, -0.4, 1.465), material("Stripe coral", CORAL, rough=0.35), bevel=0.01, parent=root)
    box("Bumper front", (1.66, 0.22, 0.24), (0, 1.93, 0.36), trim, bevel=0.08, parent=root)
    box("Bumper rear", (1.66, 0.2, 0.24), (0, -1.94, 0.36), trim, bevel=0.08, parent=root)
    for side in (-1, 1):
        box(f"Headlight {side}", (0.42, 0.08, 0.13), (side * 0.56, 1.93, 0.72), head, bevel=0.03, parent=root)
        box(f"Taillight {side}", (0.36, 0.08, 0.14), (side * 0.6, -1.95, 0.8), tail, bevel=0.03, parent=root)
        box(f"Mirror {side}", (0.2, 0.12, 0.1), (side * 0.93, 0.62, 1.02), paint, bevel=0.03, parent=root)
        for y in (1.25, -1.2):
            cylinder(f"Tyre {side} {y}", 0.33, 0.24, (side * 0.8, y, 0.33), tyre, rotation=(0, math.radians(90), 0), parent=root)
            cylinder(f"Rim {side} {y}", 0.19, 0.05, (side * 0.93, y, 0.33), rim, vertices=16, rotation=(0, math.radians(90), 0), parent=root)
    return root


def main():
    reset()
    build_car()
    stage()
    # Marker: looking down with a slight tilt from behind, forward at the top of the image.
    tilt = math.radians(18)
    dist = 20
    marker = camera("Marker camera", (0, -dist * math.sin(tilt), dist * math.cos(tilt)), (0, 0.05, 0.4), ortho_scale=5.2)
    render(marker, os.path.join(ROOT, "public", "drive-car.png"), 224, 292)
    if "--preview" in ARGS:
        beauty = camera("Beauty camera", (6.5, 7.5, 4.2), (0, 0, 0.7), lens=55)
        render(beauty, os.path.join(ROOT, "design", "blender", "car-preview.png"), 900, 640)
    save("sampai-car.blend")


if __name__ == "__main__":
    main()
