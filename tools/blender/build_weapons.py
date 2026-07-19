"""Procedurally build the first-person weapon viewmodels and export them to
assets/weapons/*.glb.

Repro companion to build_map.py. The old AK/pistol were hand-modeled at ~268 tris
with low-sided cylinders → faceted. These are built with smooth-shaded, higher-
segment surfaces (curved barrels/mags, beveled bodies) at a few thousand tris.

Frame convention (Blender space) — MUST match the old models so the hand-tuned
viewmodel rest offsets in src/main.ts stay valid after the glTF axis swap:
  +Y = muzzle/forward (→ three.js -Z),  +Z = up (sights),  -Z = down (mag),  X = width.
The old AK occupied roughly X:[-0.025,0.025] Y:[-0.438,0.58] Z:[-0.254,0.087].

Run headless:  blender -b -P tools/blender/build_weapons.py
Or via the Blender MCP (exec the file's contents).
"""
import bpy
import math
import os
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "weapons")

# ---- materials -------------------------------------------------------------

def mat(name, color, metallic, roughness):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return m

def materials():
    return {
        "gunmetal": mat("M_Gunmetal", (0.045, 0.045, 0.05), 1.0, 0.35),
        "steel":    mat("M_Steel", (0.10, 0.10, 0.11), 1.0, 0.22),
        "wood":     mat("M_Wood_Grip", (0.20, 0.09, 0.03), 0.0, 0.55),
        "polymer":  mat("M_Polymer", (0.02, 0.02, 0.025), 0.0, 0.45),
    }

# ---- primitive helpers -----------------------------------------------------

def _finish(obj, material, smooth=True, bevel=0.0):
    obj.data.materials.append(material)
    if bevel > 0:
        m = obj.modifiers.new("bev", "BEVEL")
        m.width = bevel
        m.segments = 2
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(40)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj

def box(name, center, size, material, bevel=0.004):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = size  # primitive_cube_add(size=1) already spans 1.0 per axis
    bpy.ops.object.transform_apply(scale=True)
    return _finish(o, material, smooth=False, bevel=bevel)

def cyl(name, center, radius, length, material, axis="Y", verts=24, cone=1.0):
    """Cylinder (or truncated cone if cone!=1) of `length` along `axis`."""
    bpy.ops.mesh.primitive_cone_add(
        vertices=verts, radius1=radius, radius2=radius * cone,
        depth=length, location=center)
    o = bpy.context.active_object
    o.name = name
    if axis == "Y":
        o.rotation_euler = (math.radians(90), 0, 0)
    elif axis == "X":
        o.rotation_euler = (0, math.radians(90), 0)
    bpy.ops.object.transform_apply(rotation=True)
    return _finish(o, material, smooth=True, bevel=0.0)

def tilted_box(name, center, size, material, tilt_deg, bevel=0.006):
    """A box rotated about X (tilt forward/back) — mags, grips, stocks."""
    o = box(name, center, size, material, bevel=bevel)
    o.rotation_euler = (math.radians(tilt_deg), 0, 0)
    bpy.ops.object.transform_apply(rotation=True)
    return o

# ---- weapon builders -------------------------------------------------------

def clear_weapon_objs():
    for o in list(bpy.data.objects):
        if o.name.startswith(("AK_", "PST_", "ak_viewmodel", "pistol_viewmodel")):
            bpy.data.objects.remove(o, do_unlink=True)

def join_as(objs, name):
    for o in bpy.data.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    # center-of-frame origin so the viewmodel rest offset from main.ts holds
    obj.location = (0, 0, 0)
    return obj

def build_ak(M):
    # Frame: +Y = muzzle, +Z = up. Parts overlap so it reads as one solid gun.
    parts = []
    # receiver body (the central mass)
    parts.append(box("AK_recv", (0, 0.05, 0.0), (0.044, 0.34, 0.072), M["gunmetal"]))
    # dust cover: rounded top ridge
    parts.append(box("AK_cover", (0, 0.05, 0.045), (0.040, 0.30, 0.024), M["gunmetal"], bevel=0.010))
    # barrel + muzzle
    parts.append(cyl("AK_barrel", (0, 0.44, 0.010), 0.011, 0.44, M["steel"], verts=28))
    parts.append(cyl("AK_muzzle", (0, 0.63, 0.010), 0.015, 0.06, M["steel"], verts=22))
    # gas tube over the barrel
    parts.append(cyl("AK_gas", (0, 0.36, 0.043), 0.009, 0.26, M["steel"], verts=20))
    # wood handguards wrapping the barrel
    parts.append(box("AK_hg_low", (0, 0.34, -0.006), (0.038, 0.22, 0.036), M["wood"], bevel=0.012))
    parts.append(box("AK_hg_up", (0, 0.33, 0.05), (0.030, 0.17, 0.022), M["wood"], bevel=0.010))
    # sights
    parts.append(box("AK_fsight", (0, 0.60, 0.048), (0.022, 0.030, 0.050), M["steel"]))
    parts.append(box("AK_rsight", (0, 0.20, 0.050), (0.022, 0.030, 0.022), M["steel"]))
    # banana magazine — tilts forward, top overlaps the receiver underside
    parts.append(tilted_box("AK_mag", (0, 0.12, -0.115), (0.020, 0.058, 0.20), M["steel"], tilt_deg=-20))
    # pistol grip — behind the mag, angled back
    parts.append(tilted_box("AK_grip", (0, -0.05, -0.095), (0.030, 0.050, 0.13), M["polymer"], tilt_deg=20, bevel=0.012))
    # stock (neck overlaps receiver back, then the butt)
    parts.append(box("AK_stock_neck", (0, -0.18, 0.0), (0.032, 0.14, 0.055), M["wood"], bevel=0.010))
    parts.append(box("AK_stock_butt", (0, -0.31, -0.01), (0.036, 0.12, 0.11), M["wood"], bevel=0.018))
    return join_as(parts, "ak_viewmodel")

def build_pistol(M):
    parts = []
    # slide
    parts.append(box("PST_slide", (0, 0.02, 0.02), (0.030, 0.19, 0.045), M["gunmetal"], bevel=0.006))
    # barrel poking out front
    parts.append(cyl("PST_barrel", (0, 0.14, 0.02), 0.010, 0.06, M["steel"], verts=20))
    # frame
    parts.append(box("PST_frame", (0, 0.0, -0.01), (0.026, 0.16, 0.03), M["polymer"], bevel=0.006))
    # trigger guard (connects up to the frame underside)
    parts.append(box("PST_guard", (0, 0.015, -0.032), (0.020, 0.050, 0.014), M["polymer"], bevel=0.006))
    # grip (angled)
    grip = box("PST_grip", (0, -0.05, -0.08), (0.028, 0.05, 0.11), M["polymer"], bevel=0.010)
    grip.rotation_euler = (math.radians(-22), 0, 0)
    bpy.ops.object.transform_apply(rotation=True)
    parts.append(grip)
    # sights
    parts.append(box("PST_rsight", (0, -0.05, 0.048), (0.018, 0.014, 0.012), M["steel"]))
    parts.append(box("PST_fsight", (0, 0.11, 0.048), (0.006, 0.012, 0.012), M["steel"]))
    return join_as(parts, "pistol_viewmodel")

# ---- export ----------------------------------------------------------------

def export(obj, filename):
    for o in bpy.data.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
    )
    return path, len(obj.data.polygons)

def main():
    clear_weapon_objs()
    M = materials()
    ak = build_ak(M)
    ak_path, ak_tris = export(ak, "ak_viewmodel.glb")
    pst = build_pistol(M)
    pst_path, pst_tris = export(pst, "pistol_viewmodel.glb")
    print(f"AK: {ak_tris} polys -> {ak_path}")
    print(f"Pistol: {pst_tris} polys -> {pst_path}")

if __name__ == "__main__":
    main()
