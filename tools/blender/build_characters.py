"""Procedurally build the T and CT player world-models and export them to
assets/characters/{t,ct}_player.glb.

Blocky low-poly humanoids in the CS:S silhouette — a shared body built from
boxes, differing only by team palette (CT = navy SWAT, T = tan/olive militia).
No rig yet: hitboxes are height bands (src/game/hitbox.ts, Phase 5 gets bones).

Frame convention (Blender space, Z-up):
  +Z = up (crown),  +Y = forward (faces enemy → three.js -Z),  X = width.
Feet sit on z=0 so `body.position = feet` in three.js. Model.rotation.y = bot.yaw.

Run headless:  blender -b -P tools/blender/build_characters.py
Or via the Blender MCP (exec the file's contents).
"""
import bpy
import math
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "characters")

# ---- palettes (per team) ---------------------------------------------------

PALETTES = {
    "ct": {  # SWAT / GIGN — navy body armour, black gear, pale skin
        "suit":  (0.05, 0.07, 0.13),   # navy fatigues
        "vest":  (0.02, 0.03, 0.06),   # dark tac vest
        "gear":  (0.015, 0.015, 0.02), # boots, gloves, helmet
        "skin":  (0.62, 0.46, 0.36),
    },
    "t": {   # militia — tan fatigues, olive vest, ski-mask
        "suit":  (0.34, 0.27, 0.16),   # tan/khaki
        "vest":  (0.16, 0.18, 0.10),   # olive chest rig
        "gear":  (0.03, 0.03, 0.035),  # boots, gloves, balaclava
        "skin":  (0.03, 0.03, 0.035),  # masked — no face
    },
}

# ---- helpers ---------------------------------------------------------------

def mat(name, color, rough=0.6):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Roughness"].default_value = rough
    return m

def box(name, center, size, material, bevel=0.01):
    """Axis-aligned box; `size` is full extent (x, y, z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(material)
    if bevel > 0:
        m = o.modifiers.new("bev", "BEVEL")
        m.width = bevel
        m.segments = 2
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(40)
    return o

def join_as(objs, name):
    for o in bpy.data.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    obj.location = (0, 0, 0)
    return obj

def clear_character_objs():
    for o in list(bpy.data.objects):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)

# ---- the humanoid ----------------------------------------------------------

def build_humanoid(team, pal):
    M = {
        "suit": mat(f"M_{team}_suit", pal["suit"]),
        "vest": mat(f"M_{team}_vest", pal["vest"], rough=0.5),
        "gear": mat(f"M_{team}_gear", pal["gear"], rough=0.45),
        "skin": mat(f"M_{team}_skin", pal["skin"], rough=0.7),
    }
    p = []
    ARM_X = 0.24  # shoulder half-width

    # legs (feet on z=0)
    for sx in (-1, 1):
        x = 0.11 * sx
        p.append(box(f"foot{sx}", (x, 0.05, 0.045), (0.11, 0.28, 0.09), M["gear"]))
        p.append(box(f"shin{sx}", (x, -0.02, 0.30), (0.13, 0.15, 0.45), M["suit"]))
        p.append(box(f"thigh{sx}", (x, -0.02, 0.72), (0.16, 0.18, 0.42), M["suit"]))
    # pelvis + torso
    p.append(box("pelvis", (0, -0.02, 0.99), (0.34, 0.20, 0.16), M["suit"]))
    p.append(box("abdomen", (0, -0.02, 1.16), (0.36, 0.21, 0.20), M["suit"]))
    p.append(box("chest", (0, -0.02, 1.37), (0.42, 0.23, 0.24), M["suit"]))
    # chest rig / body armour (sits proud on the front)
    p.append(box("vest", (0, 0.09, 1.33), (0.40, 0.10, 0.34), M["vest"]))

    # arms (hang at sides, slight inward at the hands)
    for sx in (-1, 1):
        x = ARM_X * sx
        p.append(box(f"shoulder{sx}", (x, -0.02, 1.44), (0.16, 0.20, 0.16), M["vest"]))
        p.append(box(f"uarm{sx}", (x, -0.02, 1.24), (0.13, 0.14, 0.30), M["suit"]))
        p.append(box(f"larm{sx}", ((0.20) * sx, -0.02, 0.99), (0.11, 0.12, 0.28), M["suit"]))
        p.append(box(f"hand{sx}", ((0.19) * sx, -0.02, 0.82), (0.10, 0.11, 0.12), M["gear"]))

    # neck + head + helmet
    p.append(box("neck", (0, -0.02, 1.53), (0.11, 0.11, 0.08), M["skin"]))
    p.append(box("head", (0, -0.01, 1.64), (0.19, 0.21, 0.22), M["skin"]))
    p.append(box("helmet", (0, -0.01, 1.74), (0.21, 0.23, 0.10), M["gear"]))

    return join_as(p, f"{team}_player")

# ---- export ----------------------------------------------------------------

def export(obj, filename):
    for o in bpy.data.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB",
        use_selection=True, export_yup=True, export_apply=True,
    )
    return path, len(obj.data.polygons)

def main():
    clear_character_objs()
    for team, pal in PALETTES.items():
        obj = build_humanoid(team, pal)
        path, tris = export(obj, f"{team}_player.glb")
        print(f"{team}: {tris} polys -> {path}")
        clear_character_objs()

if __name__ == "__main__":
    main()
