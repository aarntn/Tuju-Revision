"""Builds LaPan's map stop icons and renders them as transparent sprites.

Run from the repository root:
  blender --background --factory-startup --python design/blender/build_icons.py -- [--preview]

Outputs (192 x 192, shown at about a quarter size on the map):
  public/stops/rnr.png    R&R: pavilion with a fuel pump and a tree
  public/stops/layby.png  lay-by: coconut palm and a bench on grass
  public/stops/home.png   destination: rumah kampung on stilts
  design/blender/sampai-icons.blend editable source
  --preview also writes design/blender/icons-preview.png, all three side by side
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from senja_kit import (CORAL, PAPER, PEACH, PLUM, ROOT, SAGE, WOOD,  # noqa: E402
                       blob, box, camera, cylinder, empty, gable_roof, material, render, reset, save, stage)

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
LEAF = "#5f9a86"
GRASS = "#c9dfd3"
WALL = "#f6dccb"


def tree(name, location, parent, height=0.9, crown=0.42):
    x, y, _ = location
    cylinder(f"{name} trunk", 0.06, height, (x, y, height / 2), material("Wood", WOOD, rough=0.7), vertices=8, parent=parent)
    blob(f"{name} crown", crown, (x, y, height + crown * 0.5), material("Leaf", LEAF, rough=0.8), scale=(1, 1, 1.15), parent=parent)


def palm(name, location, parent, height=1.7):
    x, y, _ = location
    wood = material("Wood", WOOD, rough=0.7)
    trunk = cylinder(f"{name} trunk", 0.09, height, (x, y, height / 2), wood, vertices=10, top_radius=0.055, parent=parent)
    trunk.rotation_euler.y = math.radians(6)
    top = (x + math.sin(math.radians(6)) * height / 2, y, height)
    leaf = material("Leaf", LEAF, rough=0.8)
    for i in range(7):
        angle = math.radians(i * 360 / 7 + 10)
        frond = box(f"{name} frond {i}", (0.13, 0.95, 0.03), (0, 0, 0), leaf, bevel=0.012, parent=parent)
        frond.location = (top[0] + math.sin(angle) * 0.42, top[1] + math.cos(angle) * 0.42, top[2] - 0.12)
        frond.rotation_euler = (math.radians(-24), 0, -angle)
    for i in range(3):
        angle = math.radians(i * 120)
        blob(f"{name} coconut {i}", 0.075, (top[0] + math.sin(angle) * 0.09, top[1] + math.cos(angle) * 0.09, top[2] - 0.1),
             material("Coconut", "#7a5a46", rough=0.6), subdivisions=1, parent=parent)


def bench(name, location, parent, length=0.9):
    x, y, z = location
    box(f"{name} seat", (length, 0.28, 0.07), (x, y, z + 0.42), material("Wood", WOOD, rough=0.7), bevel=0.02, parent=parent)
    for side in (-1, 1):
        box(f"{name} leg {side}", (0.06, 0.24, 0.4), (x + side * (length / 2 - 0.08), y, z + 0.2), material("Plum", PLUM, rough=0.4), parent=parent)


def rnr():
    root = empty("R&R")
    box("Platform", (2.0, 1.5, 0.14), (0, 0, 0.07), material("Paper", PAPER, rough=0.5), bevel=0.04, parent=root)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cylinder(f"Post {sx} {sy}", 0.055, 0.92, (sx * 0.82, sy * 0.56, 0.6), material("Plum", PLUM, rough=0.4), vertices=12, parent=root)
    gable_roof("Roof", 2.3, 1.85, 0.8, (0, 0, 1.06), material("Roof coral", CORAL, rough=0.5), parent=root)
    box("Ridge", (0.12, 1.92, 0.1), (0, 0, 1.9), material("Plum", PLUM, rough=0.4), bevel=0.02, parent=root)
    bench("Bench", (0, 0.1, 0.14), root)
    # fuel pump
    box("Pump", (0.32, 0.26, 0.62), (1.32, -0.25, 0.31), material("Peach", PEACH, rough=0.45), bevel=0.05, parent=root)
    box("Pump screen", (0.2, 0.02, 0.16), (1.32, -0.39, 0.46), material("Plum", PLUM, rough=0.4), parent=root)
    box("Pump cap", (0.36, 0.3, 0.08), (1.32, -0.25, 0.66), material("Plum", PLUM, rough=0.4), bevel=0.02, parent=root)
    tree("Tree", (-1.45, 1.0, 0), root)
    return root


def layby():
    root = empty("Layby")
    cylinder("Grass", 1.15, 0.1, (0, 0, 0.05), material("Grass", GRASS, rough=0.9), vertices=32, parent=root)
    palm("Palm", (-0.3, 0.25, 0), root)
    bench("Bench", (0.42, -0.32, 0.1), root, length=0.8)
    blob("Bush", 0.22, (0.75, 0.45, 0.2), material("Leaf", LEAF, rough=0.8), parent=root)
    return root


def home():
    root = empty("Home")
    wood = material("Wood", WOOD, rough=0.7)
    for sx in (-0.8, 0, 0.8):
        for sy in (-0.6, 0.6):
            cylinder(f"Stilt {sx} {sy}", 0.055, 0.6, (sx, sy, 0.3), wood, vertices=10, parent=root)
    box("Floor", (1.9, 1.45, 0.1), (0, 0, 0.62), wood, bevel=0.02, parent=root)
    box("Walls", (1.7, 1.25, 0.78), (0, 0, 1.06), material("Wall", WALL, rough=0.55), bevel=0.03, parent=root)
    plum = material("Plum", PLUM, rough=0.4)
    for x in (-0.48, 0.48):
        box(f"Window front {x}", (0.3, 0.03, 0.3), (x, -0.63, 1.1), plum, parent=root)
    for y in (-0.25, 0.3):
        box(f"Window side {y}", (0.03, 0.28, 0.3), (0.86, y, 1.1), plum, parent=root)
    box("Door", (0.32, 0.03, 0.56), (0, -0.635, 0.95), material("Roof coral", CORAL, rough=0.5), parent=root)
    for i in range(3):
        box(f"Step {i}", (0.42, 0.18, 0.06), (0, -0.82 - i * 0.16, 0.5 - i * 0.18), wood, bevel=0.015, parent=root)
    gable_roof("Roof", 2.1, 1.7, 0.72, (0, 0, 1.45), plum, parent=root)
    box("Ridge", (0.12, 1.78, 0.1), (0, 0, 2.18), material("Roof coral", CORAL, rough=0.5), bevel=0.02, parent=root)
    blob("Bush left", 0.22, (-1.05, -0.55, 0.18), material("Leaf", LEAF, rough=0.8), parent=root)
    blob("Bush right", 0.18, (1.08, -0.65, 0.15), material("Leaf", LEAF, rough=0.8), parent=root)
    return root


def show_only(target, roots):
    for root in roots:
        hidden = root is not target
        for obj in [root, *root.children_recursive]:
            obj.hide_render = hidden


def main():
    reset()
    icons = {"rnr": (rnr(), 4.3, 0.95), "layby": (layby(), 3.4, 0.8), "home": (home(), 3.9, 1.1)}
    stage(samples=80)
    out = os.path.join(ROOT, "public", "stops")
    os.makedirs(out, exist_ok=True)
    # Front-right, looking down at about 38 degrees: the same light and angle for every icon.
    direction = (0.62, -1.0, 0.95)
    roots = [root for root, _, _ in icons.values()]
    for name, (root, scale, centre_z) in icons.items():
        show_only(root, roots)
        d = 20
        cam = camera(f"{name} camera", (direction[0] * d, direction[1] * d, direction[2] * d + centre_z), (0, 0, centre_z), ortho_scale=scale)
        render(cam, os.path.join(out, f"{name}.png"), 192, 192)
    if "--preview" in ARGS:
        for i, root in enumerate(roots):
            root.location.x = (i - 1) * 3.6
        for obj in bpy_objects():
            obj.hide_render = False
        cam = camera("Preview camera", (direction[0] * 20, direction[1] * 20, direction[2] * 20 + 1), (0, 0, 0.9), ortho_scale=12)
        render(cam, os.path.join(ROOT, "design", "blender", "icons-preview.png"), 1100, 460)
    save("sampai-icons.blend")


def bpy_objects():
    import bpy
    return bpy.data.objects


main()
