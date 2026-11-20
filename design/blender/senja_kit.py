"""Shared Blender helpers for LaPan's 3D sprites: Senja palette, materials, lighting and rendering."""
import math
import os

import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# Senja palette (app/tokens.css)
PLUM = "#4a3f6b"
PAPER = "#faf7f5"
LAVENDER = "#b8aee0"
ROSE = "#e4a3b4"
PEACH = "#f2c09d"
CORAL = "#d9725f"
SAGE = "#7fae9f"
GLASS = "#2a2540"
TYRE = "#1e1b26"
WOOD = "#a77b62"


def srgb(hex_colour, alpha=1.0):
    """#rrggbb (sRGB) to a linear RGBA tuple for Blender."""
    h = hex_colour.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, alpha)


_materials = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _materials.clear()  # the old datablocks are gone




def material(name, hex_colour, rough=0.45, metal=0.0, emission=None, strength=0.0, coat=0.0):
    """Principled material, cached by name so repeated parts share one."""
    if name in _materials and _materials[name].name in bpy.data.materials:
        return _materials[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = srgb(hex_colour)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if coat and "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.08
    if emission:
        bsdf.inputs["Emission Color"].default_value = srgb(emission)
        bsdf.inputs["Emission Strength"].default_value = strength
    _materials[name] = mat
    return mat


def _finish(obj, name, mat, parent, smooth=True):
    obj.name = name
    obj.data.materials.append(mat)
    if smooth:
        bpy.ops.object.shade_smooth()
    if parent:
        obj.parent = parent
    return obj


def box(name, size, location, mat, bevel=0.0, segments=3, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "NONE"
    return _finish(obj, name, mat, parent)


def cylinder(name, radius, depth, location, mat, vertices=24, rotation=(0, 0, 0), top_radius=None, parent=None):
    if top_radius is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=top_radius, depth=depth, location=location, rotation=rotation)
    return _finish(bpy.context.active_object, name, mat, parent)


def blob(name, radius, location, mat, scale=(1, 1, 1), subdivisions=2, parent=None, smooth=False):
    """Low-poly rounded shape (tree crowns, bushes)."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=radius, location=location)
    obj = bpy.context.active_object
    obj.scale = scale
    return _finish(obj, name, mat, parent, smooth=smooth)


def gable_roof(name, width, length, height, location, mat, parent=None, thickness=0.07):
    """Pitched roof from two tilted slabs meeting at a ridge along Y. location is the roof's base centre."""
    x, y, z = location
    half = width / 2
    pitch = math.atan2(height, half)
    slope = math.hypot(half, height)
    parts = []
    for side in (-1, 1):
        slab = box(f"{name} {'left' if side < 0 else 'right'}", (slope, length, thickness),
                   (x + side * half / 2, y, z + height / 2), mat, bevel=0.015, segments=2, parent=parent)
        slab.rotation_euler.y = -side * pitch
        parts.append(slab)
    return parts


def taper(obj, top_scale_x=1.0, top_scale_y=1.0):
    """Pulls the top vertices in, so a box reads as a cabin rather than a crate."""
    top = max(v.co.z for v in obj.data.vertices)
    for v in obj.data.vertices:
        if v.co.z > top - 1e-4:
            v.co.x *= top_scale_x
            v.co.y *= top_scale_y


def empty(name):
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    return root


def stage(samples=96):
    """Cycles, transparent film, soft warm sun and a ground that only catches shadow."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.device = "CPU"
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"

    world = bpy.data.worlds.new("Senja sky")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = srgb("#f3ecf2")
    bg.inputs["Strength"].default_value = 0.9
    scene.world = world

    bpy.ops.object.light_add(type="SUN", location=(3, 4, 8))
    sun = bpy.context.active_object
    sun.data.energy = 3.2
    sun.data.angle = math.radians(12)
    sun.data.color = srgb("#fff3e8")[:3]
    sun.rotation_euler = (math.radians(28), math.radians(-12), math.radians(25))

    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = "Shadow catcher"
    ground.is_shadow_catcher = True


def camera(name, location, look_at, ortho_scale=None, lens=None):
    bpy.ops.object.camera_add(location=location)
    cam = bpy.context.active_object
    cam.name = name
    cam.rotation_euler = (Vector(look_at) - cam.location).to_track_quat("-Z", "Y").to_euler()
    if ortho_scale:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = ortho_scale
    if lens:
        cam.data.lens = lens
    return cam


def render(cam, path, width, height):
    scene = bpy.context.scene
    scene.camera = cam
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("wrote", path)


def save(name):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "design", "blender", name))
