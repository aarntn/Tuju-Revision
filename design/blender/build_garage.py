"""Renders every Garage vehicle in every paint: a map sprite and a 12-angle turntable for the 360° preview.

Run from the repository root (takes a few minutes on a CPU):
  blender --background --factory-startup --python design/blender/build_garage.py

Outputs, for each model and paint (names must match lib/garage.ts):
  public/garage/<model>-<paint>-top.webp     map marker, forward at the top
  public/garage/<model>-<paint>-<00..11>.webp turntable, 30° apart, starting from the front-right 3/4 view
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_car import build_car  # noqa: E402
from build_kart import build_kart  # noqa: E402
from senja_kit import ROOT, camera, render, reset, stage  # noqa: E402

PAINTS = {"plum": "#4a3f6b", "coral": "#d9725f", "sage": "#6fa592", "lavender": "#9d8fd6", "sunny": "#f2b84b"}
# model: (builder, marker ortho scale, turntable ortho scale, look-at height)
MODELS = {"kart": (build_kart, 3.3, 3.5, 0.6), "hatchback": (build_car, 5.2, 5.6, 0.75)}
FRAMES = 12
OUT = os.path.join(ROOT, "public", "garage")


def webp():
    settings = bpy.context.scene.render.image_settings
    settings.file_format = "WEBP"
    settings.color_mode = "RGBA"
    settings.quality = 82


def main():
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for model, (builder, marker_scale, spin_scale, look_z) in MODELS.items():
        if only and model not in only:
            continue
        for paint, hex_colour in PAINTS.items():
            reset()
            root = builder(hex_colour)
            stage(samples=28)
            webp()
            tilt = math.radians(18)
            marker = camera("Marker", (0, -20 * math.sin(tilt), 20 * math.cos(tilt)), (0, 0.05, 0.4), ortho_scale=marker_scale)
            render(marker, os.path.join(OUT, f"{model}-{paint}-top.webp"), 224, 292)
            # Turntable: the camera stays put and the vehicle turns, so lighting and shadow stay consistent.
            spin = camera("Spin", (14, -14 * 1.05, 7.2 + look_z), (0, 0, look_z), ortho_scale=spin_scale)
            for frame in range(FRAMES):
                root.rotation_euler.z = math.radians(frame * 360 / FRAMES + 265)  # frame 0: front-right 3/4 view
                render(spin, os.path.join(OUT, f"{model}-{paint}-{frame:02d}.webp"), 480, 360)


main()
