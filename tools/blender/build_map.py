# Build + lightmap-bake the greybox map from assets/maps/de_greybox.json.
#
# Reads the SAME layout JSON the engine uses for colliders, so the baked render
# geometry aligns with the Rapier cuboids. Produces:
#   assets/maps/de_greybox.glb            (geometry + UVMap + UVMap_Lightmap)
#   assets/maps/de_greybox/lightmap.exr   (baked diffuse lighting, no albedo)
#
# Baked lighting only — zero realtime lights ship (docs/blender-pipeline.md).
# Run inside Blender: exec(open('.../tools/blender/build_map.py').read()); build_all()
#
# ponytail: everything is built in three.js space (Y up) and converted per-vertex
# to Blender Z-up via `conv`, so the glTF +Y-up export round-trips to the exact
# engine coords. One code path for boxes and the rotated ramp — no axis algebra.

import json
import math
import os
import bpy

REPO = "/home/upmoon/Development/dougysbigtrip"
JSON_PATH = os.path.join(REPO, "assets/maps/de_greybox.json")
GLB_PATH = os.path.join(REPO, "assets/maps/de_greybox.glb")
EXR_PATH = os.path.join(REPO, "assets/maps/de_greybox/lightmap.exr")
LM_SIZE = 1024
BAKE_SAMPLES = 128  # iteration bake; bump to 2048 for the final.

# three.js (x,y,z, Y-up) -> Blender (x,-z,y, Z-up). glTF +Y-up export inverts it.
def conv(x, y, z):
    return (x, -z, y)

def srgb_to_linear(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def hex_to_linear(h):
    return (srgb_to_linear((h >> 16) & 255), srgb_to_linear((h >> 8) & 255), srgb_to_linear(h & 255), 1.0)

# 8 corners in sign order (a,b,c) -> index 4a+2b+c; 6 quad faces.
_SIGNS = [(-1, -1, -1), (-1, -1, 1), (-1, 1, -1), (-1, 1, 1), (1, -1, -1), (1, -1, 1), (1, 1, -1), (1, 1, 1)]
_FACES = [(4, 5, 7, 6), (0, 2, 3, 1), (2, 6, 7, 3), (0, 1, 5, 4), (1, 3, 7, 5), (0, 4, 6, 2)]

def qrot(q, v):  # rotate v by quaternion q=(x,y,z,w)
    qx, qy, qz, qw = q
    vx, vy, vz = v
    tx = 2 * (qy * vz - qz * vy)
    ty = 2 * (qz * vx - qx * vz)
    tz = 2 * (qx * vy - qy * vx)
    return (vx + qw * tx + (qy * tz - qz * ty),
            vy + qw * ty + (qz * tx - qx * tz),
            vz + qw * tz + (qx * ty - qy * tx))

def get_material(surface, color):
    name = "M_" + surface
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = hex_to_linear(color)
    bsdf.inputs["Roughness"].default_value = 0.9
    return mat

def make_box(name, center, half, color, surface, quat=(0, 0, 0, 1)):
    verts = []
    for sx, sy, sz in _SIGNS:
        local = (sx * half[0], sy * half[1], sz * half[2])
        rx, ry, rz = qrot(quat, local)
        wx, wy, wz = center[0] + rx, center[1] + ry, center[2] + rz
        verts.append(conv(wx, wy, wz))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], list(_FACES))
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(get_material(surface, color))
    return obj

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for b in list(block):
            if b.users == 0:
                block.remove(b)

def build_geometry():
    with open(JSON_PATH) as f:
        data = json.load(f)
    objs = []
    for i, b in enumerate(data["boxes"]):
        c, s = b["c"], b["s"]
        half = (s[0] / 2, s[1] / 2, s[2] / 2)
        objs.append(make_box(f"box_{i}", c, half, b["color"], b["surface"]))
    for i, r in enumerate(data["ramps"]):
        st, en = r["start"], r["end"]
        dx, dy = en[0] - st[0], en[1] - st[1]
        length = math.hypot(dx, dy)
        angle = math.atan2(dy, dx)
        q = (0.0, 0.0, math.sin(angle / 2), math.cos(angle / 2))  # about three-Z
        nx, ny = -math.sin(angle), math.cos(angle)
        t = r["thickness"]
        cx = (st[0] + en[0]) / 2 - nx * t / 2
        cy = (st[1] + en[1]) / 2 - ny * t / 2
        cz = (st[2] + en[2]) / 2
        half = (length / 2, t / 2, r["width"] / 2)
        objs.append(make_box(f"ramp_{i}", (cx, cy, cz), half, r["color"], r["surface"], q))
    # Join into one object so the glb is one mesh with a primitive per material.
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    m = bpy.context.view_layer.objects.active
    m.name = "de_greybox"
    # Recalc normals outward.
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return m

def setup_uvs(obj):
    me = obj.data
    if "UVMap" not in me.uv_layers:
        me.uv_layers.new(name="UVMap")
    me.uv_layers.active = me.uv_layers["UVMap"]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cube_project(cube_size=1.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    lm = me.uv_layers.new(name="UVMap_Lightmap")
    me.uv_layers.active = lm
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(island_margin=0.02, angle_limit=1.15)
    bpy.ops.uv.pack_islands(margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")

def setup_lighting():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    try:
        scene.cycles.device = "GPU"
    except Exception:
        pass
    scene.cycles.samples = BAKE_SAMPLES
    scene.cycles.use_denoising = True
    # Idempotent: drop any lights from a previous run.
    for o in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(o, do_unlink=True)
    # Sun: low-ish angle, sharp-ish shadows (Source look). Strong key vs. a weak
    # sky fill so crate/wall faces in shadow actually go dark — a soft, near-equal
    # ratio read flat and made objects blend into each other (first-round bug).
    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 6.0
    sun_data.angle = math.radians(1.5)
    sun = bpy.data.objects.new("Sun", sun_data)
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    bpy.context.scene.collection.objects.link(sun)
    # Nishita sky for blue ambient fill.
    world = bpy.data.worlds.new("MapWorld") if not bpy.data.worlds else bpy.data.worlds[0]
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new("ShaderNodeBackground")
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    bg.inputs["Strength"].default_value = 0.2
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

def setup_bake_targets(obj):
    lm = bpy.data.images.get("LM_de_greybox")
    if lm is None:
        lm = bpy.data.images.new("LM_de_greybox", width=LM_SIZE, height=LM_SIZE, float_buffer=True)
    for slot in obj.material_slots:
        mat = slot.material
        nt = mat.node_tree
        node = nt.nodes.get("BAKE_TARGET")
        if node is None:
            node = nt.nodes.new("ShaderNodeTexImage")
            node.name = node.label = "BAKE_TARGET"
            node.location = (-900, 600)
            uv = nt.nodes.new("ShaderNodeUVMap")
            uv.uv_map = "UVMap_Lightmap"
            uv.location = (-1100, 600)
            nt.links.new(uv.outputs["UV"], node.inputs["Vector"])
        node.image = lm
        nt.nodes.active = node
        node.select = True
    return lm

def do_bake(obj):
    scene = bpy.context.scene
    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.use_pass_color = False
    scene.render.bake.margin = 16
    scene.render.bake.margin_type = "ADJACENT_FACES"
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type="DIFFUSE")

def save_exr():
    os.makedirs(os.path.dirname(EXR_PATH), exist_ok=True)
    lm = bpy.data.images["LM_de_greybox"]
    lm.filepath_raw = EXR_PATH
    lm.file_format = "OPEN_EXR"
    lm.save()

def export_glb():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH,
        export_format="GLB",
        use_selection=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="NONE",
    )

def build_all():
    clear_scene()
    obj = build_geometry()
    setup_uvs(obj)
    setup_lighting()
    setup_bake_targets(obj)
    do_bake(obj)
    save_exr()
    export_glb()
    return obj
