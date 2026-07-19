"""Procedurally build the first-person weapon viewmodels and export them to
assets/weapons/*.glb.

Frame convention (Blender space):
  +Y = muzzle/forward (→ three.js -Z),  +Z = up (sights),  -Z = down (mag),  X = width.

Run headless:  blender -b -P tools/blender/build_weapons.py
Or via the Blender MCP (exec the file's contents).
"""
import bpy
import math
import os
from mathutils import Vector, Euler

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

def _finish(obj, material, smooth=True, bevel=0.0, bevel_segs=3):
    obj.data.materials.append(material)
    if bevel > 0:
        m = obj.modifiers.new("bev", "BEVEL")
        m.width = bevel
        m.segments = bevel_segs
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(40)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj

def box(name, center, size, material, bevel=0.004, bevel_segs=3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return _finish(o, material, smooth=False, bevel=bevel, bevel_segs=bevel_segs)

def cyl(name, center, radius, length, material, axis="Y", verts=32, cone=1.0):
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
    elif axis == "Z":
        pass  # default
    bpy.ops.object.transform_apply(rotation=True)
    return _finish(o, material, smooth=True, bevel=0.0)

def tilted_box(name, center, size, material, tilt_deg, tilt_axis="X", bevel=0.006):
    """A box rotated — mags, grips, stocks."""
    o = box(name, center, size, material, bevel=bevel)
    if tilt_axis == "X":
        o.rotation_euler = (math.radians(tilt_deg), 0, 0)
    elif tilt_axis == "Y":
        o.rotation_euler = (0, math.radians(tilt_deg), 0)
    bpy.ops.object.transform_apply(rotation=True)
    return o

def curved_mag(name, top, width, thickness, height, segments, material):
    """Banana magazine: walk down-and-forward from the mag-well attach point `top`.

    Segments hang from `top` (at the receiver underside), each tilting a little more
    toward +Y (muzzle) so the stack sweeps into the AK banana curve.
    """
    parts = []
    arc_angle = math.radians(42)  # total sweep, top (vertical) -> bottom (forward)
    seg_len = height / segments
    py, pz = top[1], top[2]
    for i in range(segments):
        a = ((i + 0.5) / segments) * arc_angle  # 0 at top, grows going down
        dy = math.sin(a) * seg_len
        dz = -math.cos(a) * seg_len
        seg = box(f"{name}_{i}", (top[0], py + dy / 2, pz + dz / 2),
                  (width, thickness, seg_len * 1.08), material, bevel=0.004)
        seg.rotation_euler = (a, 0, 0)
        bpy.ops.object.transform_apply(rotation=True)
        parts.append(seg)
        py += dy
        pz += dz
    return parts

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
    obj.location = (0, 0, 0)
    return obj

def build_ak(M):
    parts = []

    # --- receiver (wider for first-person depth) ---
    parts.append(box("AK_recv", (0, 0.05, 0.0), (0.050, 0.34, 0.075), M["gunmetal"], bevel=0.005))

    # --- dust cover: stepped top ridge ---
    parts.append(box("AK_cover_top", (0, 0.05, 0.046), (0.044, 0.28, 0.006), M["gunmetal"], bevel=0.012))
    parts.append(box("AK_cover_side", (0, 0.05, 0.038), (0.046, 0.30, 0.020), M["gunmetal"], bevel=0.008))

    # --- ejection port ---
    parts.append(box("AK_ejport", (0.014, 0.18, 0.032), (0.010, 0.08, 0.008), M["gunmetal"]))

    # --- charging handle (right side) ---
    parts.append(box("AK_chandle_base", (0.023, 0.20, 0.025), (0.008, 0.02, 0.015), M["steel"], bevel=0.003))
    parts.append(cyl("AK_chandle_knob", (0.027, 0.20, 0.025), 0.006, 0.018, M["steel"], axis="X", verts=16))

    # --- trigger ---
    parts.append(tilted_box("AK_trigger", (0, 0.04, -0.045), (0.008, 0.006, 0.025), M["steel"], tilt_deg=-12))
    parts.append(box("AK_trig_guard", (0, 0.03, -0.060), (0.012, 0.040, 0.010), M["steel"], bevel=0.004))

    # --- barrel + muzzle ---
    parts.append(cyl("AK_barrel", (0, 0.45, 0.010), 0.014, 0.42, M["steel"], verts=32))
    parts.append(cyl("AK_muzzle", (0, 0.63, 0.010), 0.017, 0.065, M["steel"], verts=28, cone=0.92))

    # --- gas tube (thicker) ---
    parts.append(cyl("AK_gas", (0, 0.36, 0.044), 0.011, 0.26, M["steel"], verts=28))

    # --- full-length gas block (protects front sight post) ---
    parts.append(box("AK_gasblock", (0, 0.51, 0.049), (0.022, 0.06, 0.035), M["steel"], bevel=0.006))

    # --- wood handguards ---
    parts.append(box("AK_hg_low", (0, 0.34, -0.007), (0.042, 0.22, 0.040), M["wood"], bevel=0.014))
    parts.append(box("AK_hg_up", (0, 0.33, 0.052), (0.034, 0.17, 0.026), M["wood"], bevel=0.012))

    # --- sights: stepped posts ---
    # front sight block + post
    parts.append(box("AK_fsight_block", (0, 0.60, 0.042), (0.018, 0.025, 0.025), M["steel"], bevel=0.004))
    parts.append(box("AK_fsight_post", (0, 0.60, 0.060), (0.005, 0.006, 0.025), M["steel"]))
    parts.append(box("AK_fsight_ears", (0, 0.60, 0.066), (0.016, 0.008, 0.008), M["steel"], bevel=0.003))
    # rear sight
    parts.append(box("AK_rsight_base", (0, 0.21, 0.048), (0.020, 0.022, 0.012), M["steel"], bevel=0.003))
    parts.append(box("AK_rsight_leaf", (0, 0.21, 0.060), (0.016, 0.034, 0.006), M["steel"], bevel=0.003))
    parts.append(box("AK_rsight_notch", (0, 0.21, 0.066), (0.018, 0.008, 0.008), M["steel"], bevel=0.003))

    # --- curved banana magazine ---
    parts.extend(curved_mag("AK_mag", (0, 0.10, -0.03), 0.022, 0.050, 0.22, 12, M["steel"]))

    # --- mag catch ---
    parts.append(box("AK_magcatch", (0.018, -0.01, -0.070), (0.008, 0.025, 0.012), M["steel"], bevel=0.004))

    # --- pistol grip ---
    parts.append(tilted_box("AK_grip", (0, -0.05, -0.100), (0.032, 0.050, 0.14), M["polymer"], tilt_deg=20, bevel=0.014))

    # --- stock (wood) ---
    parts.append(box("AK_stock_neck", (0, -0.18, 0.0), (0.036, 0.16, 0.058), M["wood"], bevel=0.012))
    parts.append(box("AK_stock_butt", (0, -0.32, -0.012), (0.040, 0.12, 0.120), M["wood"], bevel=0.020))

    # --- sling swivel ---
    parts.append(cyl("AK_swivel", (0, -0.38, -0.070), 0.005, 0.018, M["steel"], axis="X", verts=16))

    return join_as(parts, "ak_viewmodel")

def build_pistol(M):
    parts = []

    # --- slide (wider, taller) ---
    parts.append(box("PST_slide", (0, 0.02, 0.02), (0.036, 0.20, 0.050), M["gunmetal"], bevel=0.007))

    # --- slide serrations (rear) ---
    for i in range(5):
        y_pos = -0.035 + i * 0.012
        parts.append(box(f"PST_serr_{i}", (0, y_pos, 0.032), (0.030, 0.005, 0.014), M["gunmetal"], bevel=0.002))

    # --- ejection port ---
    parts.append(box("PST_ejport", (0.012, 0.06, 0.030), (0.010, 0.07, 0.010), M["gunmetal"]))

    # --- extractor ---
    parts.append(box("PST_extractor", (0.016, 0.08, 0.038), (0.004, 0.020, 0.006), M["steel"], bevel=0.002))

    # --- barrel ---
    parts.append(cyl("PST_barrel", (0, 0.15, 0.020), 0.012, 0.065, M["steel"], verts=28))

    # --- guide rod (visible under barrel from front) ---
    parts.append(cyl("PST_guide", (0, 0.13, 0.002), 0.005, 0.04, M["steel"], verts=16))

    # --- frame (wider) ---
    parts.append(box("PST_frame", (0, 0.0, -0.01), (0.030, 0.16, 0.035), M["polymer"], bevel=0.007))

    # --- trigger ---
    parts.append(tilted_box("PST_trigger", (0, 0.02, -0.045), (0.006, 0.005, 0.022), M["steel"], tilt_deg=-15))

    # --- trigger guard (connects up into the frame underside, bow around the trigger) ---
    parts.append(box("PST_guard_top", (0, 0.035, -0.024), (0.018, 0.020, 0.020), M["polymer"], bevel=0.005))
    parts.append(box("PST_guard_bow", (0, 0.020, -0.058), (0.018, 0.044, 0.016), M["polymer"], bevel=0.007))
    parts.append(box("PST_guard_rear", (0, -0.005, -0.050), (0.018, 0.014, 0.020), M["polymer"], bevel=0.005))

    # --- mag release ---
    parts.append(box("PST_magrel", (0.015, 0.01, -0.060), (0.006, 0.012, 0.012), M["polymer"], bevel=0.004))

    # --- grip (angled, wider) ---
    grip = box("PST_grip", (0, -0.05, -0.085), (0.030, 0.055, 0.12), M["polymer"], bevel=0.012)
    grip.rotation_euler = (math.radians(-22), 0, 0)
    bpy.ops.object.transform_apply(rotation=True)
    parts.append(grip)

    # --- mainspring housing (back of grip) ---
    parts.append(tilted_box("PST_msh", (0, -0.05, -0.140), (0.010, 0.04, 0.06), M["polymer"], tilt_deg=-22))

    # --- slide stop (right side) ---
    parts.append(box("PST_sstop", (0.016, 0.0, -0.018), (0.005, 0.025, 0.008), M["steel"], bevel=0.003))

    # --- decocker / safety ---
    parts.append(box("PST_decocker", (0.012, -0.02, 0.014), (0.008, 0.015, 0.008), M["steel"], bevel=0.003))

    # --- sights (stepped) ---
    parts.append(box("PST_rsight_base", (0, -0.05, 0.048), (0.016, 0.010, 0.008), M["steel"], bevel=0.003))
    parts.append(box("PST_rsight_notch", (0, -0.05, 0.056), (0.016, 0.008, 0.006), M["steel"], bevel=0.002))
    parts.append(box("PST_fsight_base", (0, 0.11, 0.048), (0.010, 0.008, 0.008), M["steel"], bevel=0.003))
    parts.append(box("PST_fsight_dot", (0, 0.11, 0.055), (0.004, 0.005, 0.007), M["steel"]))

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
