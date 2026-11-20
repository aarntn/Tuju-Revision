"""The LaPan kart: a chunky cartoon go-kart with googly headlight eyes, a helmeted driver and a basket of durians
on the back (the balik kampung gift). Original design.

Run on its own for a preview:
  blender --background --factory-startup --python design/blender/build_kart.py
"""
import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from senja_kit import (CORAL, GLASS, PAPER, PEACH, PLUM, ROOT, TYRE, WOOD,  # noqa: E402
                       blob, box, camera, cylinder, empty, material, render, reset, save, stage)

DURIAN = "#a7b85a"
METAL = "#c9c3d3"


def spiky(name, radius, location, mat, parent):
    """A durian: an icosphere with every face poked outward into a spike."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius)
    poked = bmesh.ops.poke(bm, faces=bm.faces[:])
    for v in poked["verts"]:
        v.co *= 1.28
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.scale = (1, 1, 1.15)
    obj.data.materials.append(mat)
    obj.parent = parent
    return obj


def wheel(name, x, y, radius, width, parent, rim_mat):
    tyre = material("Tyre", TYRE, rough=0.85)
    cylinder(f"{name} tyre", radius, width, (x, y, radius), tyre, vertices=28, rotation=(0, math.radians(90), 0), parent=parent)
    side = 1 if x > 0 else -1
    cylinder(f"{name} rim", radius * 0.58, width + 0.02, (x, y, radius), rim_mat, vertices=20, rotation=(0, math.radians(90), 0), parent=parent)
    cylinder(f"{name} hub", radius * 0.2, width + 0.06, (x + side * 0.01, y, radius), material("Metal", METAL, rough=0.3, metal=0.8),
             vertices=12, rotation=(0, math.radians(90), 0), parent=parent)


def build_kart(paint_hex=CORAL):
    paint = material(f"Kart paint {paint_hex}", paint_hex, rough=0.3, coat=0.7)
    dark = material("Trim", TYRE, rough=0.6)
    rim = material("Rim peach", PEACH, rough=0.35, metal=0.3)
    white = material("Paper", PAPER, rough=0.4)
    root = empty("SampaiKart")

    # Body: low tub, rounded nose, side pods. Forward is +Y.
    box("Floor", (1.05, 1.95, 0.12), (0, 0, 0.26), dark, bevel=0.05, parent=root)
    box("Nose", (0.92, 0.72, 0.32), (0, 0.62, 0.42), paint, bevel=0.15, segments=5, parent=root)
    box("Tub", (0.86, 0.95, 0.34), (0, -0.25, 0.44), paint, bevel=0.14, segments=5, parent=root)
    for side in (-1, 1):
        box(f"Pod {side}", (0.26, 1.0, 0.26), (side * 0.56, -0.05, 0.38), paint, bevel=0.11, segments=4, parent=root)
    box("Bumper", (1.28, 0.16, 0.16), (0, 1.03, 0.28), dark, bevel=0.07, parent=root)
    box("Number board", (0.42, 0.04, 0.24), (0, 1.0, 0.5), white, bevel=0.03, parent=root)

    # Googly headlight eyes on the nose.
    for side in (-1, 1):
        blob(f"Eye {side}", 0.12, (side * 0.24, 0.9, 0.62), material("Eye white", PAPER, rough=0.15, emission=PEACH, strength=0.6),
             subdivisions=3, parent=root, smooth=True)
        blob(f"Pupil {side}", 0.055, (side * 0.25, 1.0, 0.64), material("Pupil", PLUM, rough=0.2), subdivisions=2, parent=root)

    # Wheels: big at the back, small at the front.
    for side in (-1, 1):
        wheel(f"Rear {side}", side * 0.66, -0.62, 0.32, 0.32, root, rim)
        wheel(f"Front {side}", side * 0.6, 0.66, 0.23, 0.22, root, rim)

    # Seat, steering wheel and the driver.
    seat = box("Seat", (0.5, 0.3, 0.52), (0, -0.48, 0.66), dark, bevel=0.1, parent=root)
    seat.rotation_euler.x = math.radians(-14)
    column = cylinder("Column", 0.025, 0.42, (0, 0.18, 0.66), material("Metal", METAL, rough=0.3, metal=0.8), vertices=8, parent=root)
    column.rotation_euler.x = math.radians(-55)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.15, minor_radius=0.03, location=(0, 0.06, 0.82), rotation=(math.radians(-35), 0, 0))
    steer = bpy.context.active_object
    steer.name = "Steering wheel"
    steer.data.materials.append(dark)
    steer.parent = root
    blob("Driver body", 0.26, (0, -0.3, 0.86), material("Shirt", PLUM, rough=0.6), scale=(1, 0.85, 1.05), subdivisions=3, parent=root, smooth=True)
    for side in (-1, 1):
        arm = cylinder(f"Arm {side}", 0.055, 0.42, (side * 0.17, -0.06, 0.88), material("Shirt", PLUM, rough=0.6), vertices=10, parent=root)
        arm.rotation_euler = (math.radians(-70), side * math.radians(-12), 0)
    blob("Helmet", 0.24, (0, -0.3, 1.25), material("Helmet", PAPER, rough=0.25, coat=0.6), subdivisions=4, parent=root, smooth=True)
    box("Helmet stripe", (0.07, 0.36, 0.05), (0, -0.3, 1.465), material("Stripe coral", CORAL, rough=0.35), bevel=0.02, parent=root)
    blob("Visor", 0.2, (0, -0.15, 1.25), material("Glass", GLASS, rough=0.08, metal=0.2), scale=(0.95, 0.5, 0.5), subdivisions=3, parent=root, smooth=True)

    # Spoiler and exhausts.
    for side in (-1, 1):
        box(f"Spoiler post {side}", (0.05, 0.08, 0.36), (side * 0.38, -1.0, 0.68), dark, parent=root)
        pipe = cylinder(f"Exhaust {side}", 0.065, 0.32, (side * 0.22, -1.08, 0.4), material("Metal", METAL, rough=0.3, metal=0.8),
                        vertices=14, rotation=(math.radians(90), 0, 0), parent=root)
        pipe.rotation_euler.x = math.radians(80)
    box("Spoiler", (1.22, 0.24, 0.05), (0, -1.03, 0.88), paint, bevel=0.02, parent=root)

    # The balik kampung gift: a rattan basket of durians.
    cylinder("Basket", 0.26, 0.18, (0, -0.8, 0.62), material("Rattan", WOOD, rough=0.8), vertices=16, parent=root)
    durian = material("Durian", DURIAN, rough=0.7)
    spiky("Durian 1", 0.13, (-0.09, -0.78, 0.8), durian, root)
    spiky("Durian 2", 0.11, (0.11, -0.86, 0.78), durian, root)
    return root


if __name__ == "__main__":
    reset()
    build_kart()
    stage()
    cam = camera("Beauty camera", (4.2, 4.8, 2.9), (0, 0, 0.55), lens=50)
    render(cam, os.path.join(ROOT, "design", "blender", "kart-preview.png"), 900, 640)
    save("sampai-kart.blend")
