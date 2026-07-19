"""Procedurally build the first-person weapon viewmodels and export them to
assets/weapons/*.glb.

Frame convention (Blender space):
  +Y = muzzle/forward (→ three.js -Z),  +Z = up (sights),  -Z = down (mag),  X = width.

Run headless:  blender -b -P tools/blender/build_weapons.py
Or via the Blender MCP (exec the file's contents).
"""
import bpy
import bmesh
import json
import math
import os
from mathutils import Vector, Euler

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "weapons")
# Curves traced from reference photos via tools/refextract/outline.py. The source
# photos live under assets/reference/ (gitignored — may be copyrighted); only the
# extracted geometry (these JSONs) is committed here.
CURVES = os.path.join(ROOT, "tools", "blender", "curves")

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
        "wood":     mat("M_Wood_Grip", (0.28, 0.13, 0.04), 0.0, 0.52),
        "bakelite": mat("M_Bakelite", (0.24, 0.085, 0.028), 0.0, 0.40),
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

def slant_brake(name, center, radius, length, material, verts=24, angle_deg=32):
    """AKM slant compensator: a stub cylinder whose muzzle face is cut diagonally
    (top edge forward, bottom edge back) — the AK's iconic front-end silhouette."""
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=radius, radius2=radius,
                                    depth=length, location=center)
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = (math.radians(90), 0, 0)  # along +Y
    bpy.ops.object.transform_apply(rotation=True)
    front = center[1] + length / 2
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    a = math.radians(angle_deg)
    n = Vector((0, math.cos(a), math.sin(a))).normalized()  # tilt in Y-Z, keep top-forward
    p = Vector((center[0], front - radius * math.tan(a), center[2]))
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                           plane_co=p, plane_no=n, clear_outer=True)
    bmesh.ops.contextual_create(bm, geom=[e for e in bm.edges if e.is_boundary])
    bm.to_mesh(me)
    bm.free()
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

def swept_part(name, curve_path, top, x_width, thickness, height_m, material,
               head=0, tail=0, bevel=0.004):
    """Build a curved part (mag, grip) by following the *centerline* of a reference
    outline curve extracted from a side photo via tools/refextract/outline.py.

    The JSON gives, per height t (0=top→1=bottom), the part's centerline `c` as a
    fraction of the reference bbox *width*. We map the photo into model space —
    image −x (toward muzzle) → +Y forward, image +y (down) → −Z — preserving the
    true aspect ratio, then hang `height_m` of constant-`thickness` box segments
    from `top` following that curve. (The a..b span is the *slanted* cross-section
    width, not true thickness, so it is not used for depth.)
    """
    with open(curve_path) as f:
        data = json.load(f)
    s = data["samples"]
    if head or tail:
        s = s[head:len(s) - tail]
    x0, y0, x1, y1 = data["bbox_px"]
    aspect = (x1 - x0) / (y1 - y0)          # photo width : height
    c_ref = s[0]["c"]
    pts = [Vector((top[0],
                   top[1] + (c_ref - p["c"]) * aspect * height_m,  # image −x -> +Y forward
                   top[2] - p["t"] * height_m))                     # image +y -> −Z down
           for p in s]
    # Loft a rectangular cross-section (x_width × thickness) along the centerline:
    # one continuous mesh so the curve stays gap-free. Cross-section stays in the
    # plane perpendicular to the local tangent (which lies in Y-Z; X is constant).
    hw, ht = x_width / 2, thickness / 2
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    rings = []
    for i, P in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)])
        t.normalize()
        n = Vector((0, t.z, -t.y))            # curve-normal in Y-Z plane
        n = n.normalized() if n.length > 1e-6 else Vector((0, 0, 1))
        rings.append([P + Vector((sx * hw, 0, 0)) + n * (sn * ht) for sx, sn in corners])
    bm = bmesh.new()
    vr = [[bm.verts.new(v) for v in ring] for ring in rings]
    for i in range(len(vr) - 1):
        for k in range(4):
            bm.faces.new([vr[i][k], vr[i][(k + 1) % 4], vr[i + 1][(k + 1) % 4], vr[i + 1][k]])
    bm.faces.new(vr[0][::-1])
    bm.faces.new(vr[-1])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return [_finish(o, material, smooth=False, bevel=bevel)]

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
    parts.append(slant_brake("AK_muzzle", (0, 0.635, 0.010), 0.018, 0.070, M["steel"], verts=28))

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

    # --- curved banana magazine (curve traced from assets/reference/ak/ak-side.png) ---
    parts.extend(swept_part("AK_mag", os.path.join(CURVES, "ak_mag.curve.json"),
                            (0, 0.10, -0.010), 0.045, 0.050, 0.22, M["bakelite"], head=2))

    # --- mag catch ---
    parts.append(box("AK_magcatch", (0.018, -0.01, -0.070), (0.008, 0.025, 0.012), M["steel"], bevel=0.004))

    # --- pistol grip (curve traced from assets/reference/ak/ak-side.png) ---
    parts.extend(swept_part("AK_grip", os.path.join(CURVES, "ak_grip.curve.json"),
                            (0, -0.01, -0.035), 0.032, 0.052, 0.15, M["bakelite"], head=1, bevel=0.010))

    # --- stock (wood) ---
    parts.append(box("AK_stock_neck", (0, -0.18, 0.0), (0.036, 0.16, 0.058), M["wood"], bevel=0.012))
    parts.append(box("AK_stock_butt", (0, -0.32, -0.012), (0.040, 0.12, 0.120), M["wood"], bevel=0.020))

    # --- sling swivel ---
    parts.append(cyl("AK_swivel", (0, -0.38, -0.070), 0.005, 0.018, M["steel"], axis="X", verts=16))

    return join_as(parts, "ak_viewmodel")

def build_pistol(M):
    """USP-S: boxy slide, squared nose, front+rear cocking serrations, and the
    signature threaded suppressor extending well past the muzzle."""
    parts = []

    # --- slide (boxy USP profile — slightly shorter in height so it isn't slab-heavy) ---
    parts.append(box("PST_slide", (0, 0.02, 0.018), (0.036, 0.20, 0.044), M["gunmetal"], bevel=0.006))

    # --- squared USP slide nose (slight step down at the muzzle end) ---
    parts.append(box("PST_slide_nose", (0, 0.115, 0.014), (0.034, 0.030, 0.036), M["gunmetal"], bevel=0.004))

    # --- rear cocking serrations ---
    for i in range(5):
        y_pos = -0.040 + i * 0.011
        parts.append(box(f"PST_serr_r{i}", (0, y_pos, 0.032), (0.030, 0.004, 0.014), M["gunmetal"], bevel=0.0015))

    # --- front cocking serrations (USP has them near the muzzle) ---
    for i in range(4):
        y_pos = 0.058 + i * 0.011
        parts.append(box(f"PST_serr_f{i}", (0, y_pos, 0.032), (0.030, 0.004, 0.012), M["gunmetal"], bevel=0.0015))

    # --- ejection port ---
    parts.append(box("PST_ejport", (0.012, 0.06, 0.030), (0.010, 0.07, 0.010), M["gunmetal"]))

    # --- extractor ---
    parts.append(box("PST_extractor", (0.016, 0.08, 0.038), (0.004, 0.020, 0.006), M["steel"], bevel=0.002))

    # --- threaded barrel collar poking out of the squared nose ---
    parts.append(cyl("PST_thread", (0, 0.145, 0.014), 0.011, 0.030, M["steel"], verts=24))

    # --- suppressor: the USP-S signature. Fat tube extending well past the muzzle ---
    parts.append(cyl("PST_supp", (0, 0.255, 0.014), 0.021, 0.19, M["gunmetal"], verts=32))
    parts.append(cyl("PST_supp_cap", (0, 0.352, 0.014), 0.021, 0.012, M["steel"], verts=32, cone=0.9))
    # subtle knurl rings so the tube doesn't read as a bare cylinder
    for i in range(3):
        parts.append(cyl(f"PST_supp_ring{i}", (0, 0.185 + i * 0.055, 0.014),
                         0.0225, 0.006, M["steel"], verts=32))

    # --- frame (wider) ---
    parts.append(box("PST_frame", (0, 0.0, -0.01), (0.030, 0.16, 0.035), M["polymer"], bevel=0.007))

    # --- dust cover: frame extends forward under the front of the slide (USP squared cover) ---
    parts.append(box("PST_dustcover", (0, 0.105, -0.010), (0.028, 0.060, 0.026), M["polymer"], bevel=0.005))

    # --- accessory rail ridge under the dust cover (USP frame detail) ---
    parts.append(box("PST_rail", (0, 0.100, -0.028), (0.022, 0.070, 0.010), M["polymer"], bevel=0.003))

    # --- beavertail tang: fills the web behind the slide, shields the hand (USP signature) ---
    parts.append(tilted_box("PST_beavertail", (0, -0.082, -0.004), (0.026, 0.050, 0.014), M["polymer"], tilt_deg=-32))

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

    # --- magazine floorplate poking out the bottom of the grip ---
    parts.append(tilted_box("PST_magbase", (0, -0.038, -0.150), (0.032, 0.052, 0.014), M["steel"], tilt_deg=-22))

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
