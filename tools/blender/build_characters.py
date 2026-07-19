"""Procedurally build the T and CT player world-models with Mixamo-compatible
armatures and animation data, then export them to glTF 2.0 (.glb).

Blocky low-poly humanoids in the CS:S silhouette — a shared body built from
boxes, differing only by team palette (CT = navy SWAT, T = tan/olive militia).
Each exported .glb carries a 23-bone skeleton (named per Mixamo's convention)
and three animation clips:
  - idle  (2 s loop, subtle breathing/sway)
  - walk  (1 s loop, cyclic walk cycle @ ~2.5 m/s nominal pace)
  - death (1 s one-shot, fall backwards + crumple)

Frame convention (Blender space, Z-up):
  +Z = up (crown),  +Y = forward (faces enemy → three.js -Z),  X = width.
Feet sit on z=0 so `root.position.set(...)` = feet in three.js. The wrapper
Group in main.ts yaws the model; skeleton bones carry local animation only.

Run headless:  blender -b -P tools/blender/build_characters.py
Or via the Blender MCP (exec the file's contents chunk-wise).
"""
import bpy
import math
import os
from mathutils import Euler, Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "characters")
FPS = 30

# ---- palettes (per team) ---------------------------------------------------

PALETTES = {
    "ct": {  # SWAT / GIGN — navy body armour, black gear, pale skin
        "suit": (0.05, 0.07, 0.13),
        "vest": (0.02, 0.03, 0.06),
        "gear": (0.015, 0.015, 0.02),
        "skin": (0.62, 0.46, 0.36),
    },
    "t": {  # militia — tan fatigues, olive vest, ski-mask
        "suit": (0.34, 0.27, 0.16),
        "vest": (0.16, 0.18, 0.10),
        "gear": (0.03, 0.03, 0.035),
        "skin": (0.03, 0.03, 0.035),
    },
}

# Bone-to-mesh-part mapping: each body-part box is rigidly skinned to one bone
# (weight 1.0). Box names match build_humanoid() output.
BONE_MAP = {
    "mixamorig:Hips":          ["pelvis"],
    "mixamorig:Spine":         ["abdomen"],
    "mixamorig:Spine2":        ["chest"],
    "mixamorig:Neck":          ["neck"],
    "mixamorig:Head":          ["head", "helmet"],
    "mixamorig:LeftShoulder":  ["shoulder-1"],
    "mixamorig:LeftArm":       ["uarm-1"],
    "mixamorig:LeftForeArm":   ["larm-1"],
    "mixamorig:LeftHand":      ["hand-1"],
    "mixamorig:RightShoulder": ["shoulder1"],
    "mixamorig:RightArm":      ["uarm1"],
    "mixamorig:RightForeArm":  ["larm1"],
    "mixamorig:RightHand":     ["hand1"],
    "mixamorig:LeftUpLeg":     ["thigh-1"],
    "mixamorig:LeftLeg":       ["shin-1"],
    "mixamorig:LeftFoot":      ["foot-1"],
    "mixamorig:RightUpLeg":    ["thigh1"],
    "mixamorig:RightLeg":      ["shin1"],
    "mixamorig:RightFoot":     ["foot1"],
}

# ---- helpers ---------------------------------------------------------------

def _mat(name, color, rough=0.6):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Roughness"].default_value = rough
    return m

def _box(name, center, size, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(material)
    bev = o.modifiers.new("bev", "BEVEL")
    bev.width = 0.01
    bev.segments = 2
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(40)
    return o

def _find_bone(name):
    for bone_name, parts in BONE_MAP.items():
        if name in parts:
            return bone_name
    if "vest" in name:
        return "mixamorig:Spine2"
    return "mixamorig:Hips"

# ---- armature --------------------------------------------------------------

def _build_armature():
    bpy.ops.object.armature_add(location=(0, 0, 0))
    arm_obj = bpy.context.active_object
    arm_obj.name = "CharacterArmature"
    arm = arm_obj.data

    bpy.ops.object.mode_set(mode='EDIT')
    def add(name, head, tail, parent=None):
        b = arm.edit_bones.new(name)
        b.head = head
        b.tail = tail
        if parent:
            b.parent = parent
        return b

    hips   = add("mixamorig:Hips",           (0, 0, 0.95), (0, 0, 1.05))
    spine  = add("mixamorig:Spine",          (0, 0, 1.05), (0, 0, 1.20), hips)
    spine1 = add("mixamorig:Spine1",         (0, 0, 1.20), (0, 0, 1.36), spine)
    spine2 = add("mixamorig:Spine2",         (0, 0, 1.36), (0, 0, 1.49), spine1)
    neck   = add("mixamorig:Neck",           (0, 0, 1.49), (0, 0, 1.56), spine2)
    head   = add("mixamorig:Head",           (0, 0, 1.56), (0, 0, 1.74), neck)

    l_shld = add("mixamorig:LeftShoulder",   (-0.22, 0, 1.44), (-0.24, 0, 1.30), spine2)
    l_arm  = add("mixamorig:LeftArm",        (-0.24, 0, 1.30), (-0.22, 0, 0.95), l_shld)
    l_farm = add("mixamorig:LeftForeArm",    (-0.22, 0, 0.95), (-0.20, 0, 0.78), l_arm)
    l_hand = add("mixamorig:LeftHand",       (-0.20, 0, 0.78), (-0.19, 0, 0.68), l_farm)

    r_shld = add("mixamorig:RightShoulder",  (0.22, 0, 1.44), (0.24, 0, 1.30), spine2)
    r_arm  = add("mixamorig:RightArm",       (0.24, 0, 1.30), (0.22, 0, 0.95), r_shld)
    r_farm = add("mixamorig:RightForeArm",   (0.22, 0, 0.95), (0.20, 0, 0.78), r_arm)
    r_hand = add("mixamorig:RightHand",      (0.20, 0, 0.78), (0.19, 0, 0.68), r_farm)

    l_uleg = add("mixamorig:LeftUpLeg",      (-0.10, 0, 0.95), (-0.10, 0, 0.52), hips)
    l_leg  = add("mixamorig:LeftLeg",        (-0.10, 0, 0.52), (-0.10, 0.05, 0.08), l_uleg)
    l_foot = add("mixamorig:LeftFoot",       (-0.10, 0.05, 0.08), (-0.10, 0.28, 0.04), l_leg)
    l_toe  = add("mixamorig:LeftToeBase",    (-0.10, 0.28, 0.04), (-0.10, 0.34, 0.02), l_foot)

    r_uleg = add("mixamorig:RightUpLeg",     (0.10, 0, 0.95), (0.10, 0, 0.52), hips)
    r_leg  = add("mixamorig:RightLeg",       (0.10, 0, 0.52), (0.10, 0.05, 0.08), r_uleg)
    r_foot = add("mixamorig:RightFoot",      (0.10, 0.05, 0.08), (0.10, 0.28, 0.04), r_leg)
    r_toe  = add("mixamorig:RightToeBase",   (0.10, 0.28, 0.04), (0.10, 0.34, 0.02), r_foot)

    bpy.ops.object.mode_set(mode='OBJECT')

    # Quaternion rotation mode for all pose bones (avoids multi-mode warnings)
    bpy.ops.object.mode_set(mode='POSE')
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = Quaternion((1, 0, 0, 0))
    bpy.ops.object.mode_set(mode='OBJECT')

    return arm_obj

# ---- mesh ------------------------------------------------------------------

def _build_mesh(arm_obj, team, pal):
    M = {
        "suit": _mat(f"M_{team}_suit", pal["suit"]),
        "vest": _mat(f"M_{team}_vest", pal["vest"], 0.5),
        "gear": _mat(f"M_{team}_gear", pal["gear"], 0.45),
        "skin": _mat(f"M_{team}_skin", pal["skin"], 0.7),
    }
    boxes = []
    ARM_X = 0.24

    for sx in (-1, 1):
        label = f"{sx}"
        x = 0.11 * sx
        boxes.append(_box(f"foot{label}",  (x, 0.05, 0.045), (0.11, 0.28, 0.09), M["gear"]))
        boxes.append(_box(f"shin{label}",  (x, -0.02, 0.30),  (0.13, 0.15, 0.45), M["suit"]))
        boxes.append(_box(f"thigh{label}", (x, -0.02, 0.72),  (0.16, 0.18, 0.42), M["suit"]))

    boxes.append(_box("pelvis",  (0, -0.02, 0.99),  (0.34, 0.20, 0.16), M["suit"]))
    boxes.append(_box("abdomen", (0, -0.02, 1.16),  (0.36, 0.21, 0.20), M["suit"]))
    boxes.append(_box("chest",   (0, -0.02, 1.37),  (0.42, 0.23, 0.24), M["suit"]))
    boxes.append(_box("vest",    (0, 0.09, 1.33),   (0.40, 0.10, 0.34), M["vest"]))

    for sx in (-1, 1):
        label = f"{sx}"
        x = ARM_X * sx
        boxes.append(_box(f"shoulder{label}", (x, -0.02, 1.44),      (0.16, 0.20, 0.16), M["vest"]))
        boxes.append(_box(f"uarm{label}",     (x, -0.02, 1.24),      (0.13, 0.14, 0.30), M["suit"]))
        boxes.append(_box(f"larm{label}",     (0.20 * sx, -0.02, 0.99), (0.11, 0.12, 0.28), M["suit"]))
        boxes.append(_box(f"hand{label}",     (0.19 * sx, -0.02, 0.82), (0.10, 0.11, 0.12), M["gear"]))

    boxes.append(_box("neck",   (0, -0.02, 1.53), (0.11, 0.11, 0.08), M["skin"]))
    boxes.append(_box("head",   (0, -0.01, 1.64), (0.19, 0.21, 0.22), M["skin"]))
    boxes.append(_box("helmet", (0, -0.01, 1.74), (0.21, 0.23, 0.10), M["gear"]))

    # Apply bevel and skin each box to its bone
    for o in boxes:
        bpy.context.view_layer.objects.active = o
        for mod in list(o.modifiers):
            if mod.type == 'BEVEL':
                bpy.ops.object.modifier_apply(modifier=mod.name)
        bone_name = _find_bone(o.name)
        arm_mod = o.modifiers.new("Armature", 'ARMATURE')
        arm_mod.object = arm_obj
        vg = o.vertex_groups.new(name=bone_name)
        vg.add([v.index for v in o.data.vertices], 1.0, 'REPLACE')

    # Join all boxes into one mesh
    for o in bpy.data.objects:
        o.select_set(False)
    for o in boxes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = boxes[0]
    bpy.ops.object.join()
    mesh_obj = bpy.context.active_object
    mesh_obj.name = f"{team}_player"
    mesh_obj.location = (0, 0, 0)
    mesh_obj.parent = arm_obj

    return mesh_obj

# ---- animation helpers -----------------------------------------------------

def _quat_x(angle):
    c = math.cos(angle / 2)
    s = math.sin(angle / 2)
    return Quaternion((c, s, 0, 0))

def _quat_z(angle):
    c = math.cos(angle / 2)
    s = math.sin(angle / 2)
    return Quaternion((c, 0, 0, s))

def _reset_pose(arm_obj):
    bpy.ops.object.mode_set(mode='POSE')
    for pb in arm_obj.pose.bones:
        pb.location = Vector((0, 0, 0))
        pb.rotation_quaternion = Quaternion((1, 0, 0, 0))
        pb.scale = Vector((1, 1, 1))

def _key_loc(pb, val, frame):
    pb.location = val
    pb.keyframe_insert(data_path="location", frame=frame)

def _key_rot(pb, val, frame):
    pb.rotation_quaternion = val
    pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)

def _pb(arm_obj, name):
    return arm_obj.pose.bones[name]

# ---- animations ------------------------------------------------------------

def _create_idle(arm_obj):
    _reset_pose(arm_obj)
    action = bpy.data.actions.new("idle")
    arm_obj.animation_data.action = action

    for f in range(0, 61):
        t = f / FPS
        breath = math.sin(t * 1.8) * 0.004
        sway = math.sin(t * 0.9) * 0.008
        arm_swing = math.sin(t * 0.7) * 0.015

        kb = [
            ("mixamorig:Hips",        Vector((sway * 0.5, 0, breath)),   None),
            ("mixamorig:Spine",       None,                              _quat_x(sway * 0.3)),
            ("mixamorig:Neck",        None,                              _quat_x(sway * 0.2)),
            ("mixamorig:Head",        None,                              _quat_x(sway * 0.15)),
            ("mixamorig:LeftArm",     None,                              _quat_x(arm_swing * 0.3)),
            ("mixamorig:RightArm",    None,                              _quat_x(-arm_swing * 0.3)),
            ("mixamorig:LeftForeArm", None,                              _quat_x(0.05 + arm_swing * 0.2)),
            ("mixamorig:RightForeArm",None,                              _quat_x(0.05 - arm_swing * 0.2)),
        ]
        for bn, loc, rot in kb:
            p = _pb(arm_obj, bn)
            if loc is not None:
                _key_loc(p, loc, f)
            if rot is not None:
                _key_rot(p, rot, f)

def _create_walk(arm_obj):
    _reset_pose(arm_obj)
    action = bpy.data.actions.new("walk")
    arm_obj.animation_data.action = action

    for f in range(0, 31):
        t = f / FPS
        phase = t * math.pi * 2

        hip_bob   = math.sin(phase * 2) * 0.025
        hip_twist = math.sin(phase) * 0.03
        l_leg     = math.sin(phase) * 0.55
        r_leg     = math.sin(phase + math.pi) * 0.55
        l_knee    = max(0, math.sin(phase + math.pi * 0.5)) * 0.65
        r_knee    = max(0, math.sin(phase + math.pi * 1.5)) * 0.65
        l_foot    = max(0, math.sin(phase)) * 0.25
        r_foot    = max(0, math.sin(phase + math.pi)) * 0.25
        l_arm     = math.sin(phase + math.pi) * 0.35
        r_arm     = math.sin(phase) * 0.35
        spine     = math.sin(phase * 2) * 0.02

        kb = [
            ("mixamorig:Hips",        Vector((0, 0, hip_bob)), _quat_z(hip_twist)),
            ("mixamorig:LeftUpLeg",   None,                     _quat_x(l_leg)),
            ("mixamorig:RightUpLeg",  None,                     _quat_x(r_leg)),
            ("mixamorig:LeftLeg",     None,                     _quat_x(-l_knee)),
            ("mixamorig:RightLeg",    None,                     _quat_x(-r_knee)),
            ("mixamorig:LeftFoot",    None,                     _quat_x(-l_foot)),
            ("mixamorig:RightFoot",   None,                     _quat_x(-r_foot)),
            ("mixamorig:LeftArm",     None,                     _quat_x(l_arm)),
            ("mixamorig:RightArm",    None,                     _quat_x(r_arm)),
            ("mixamorig:LeftForeArm", None,                     _quat_x(0.12)),
            ("mixamorig:RightForeArm",None,                     _quat_x(0.12)),
            ("mixamorig:Spine",       None,                     _quat_x(spine)),
        ]
        for bn, loc, rot in kb:
            p = _pb(arm_obj, bn)
            if loc is not None:
                _key_loc(p, loc, f)
            if rot is not None:
                _key_rot(p, rot, f)

def _create_death(arm_obj):
    _reset_pose(arm_obj)
    action = bpy.data.actions.new("death")
    arm_obj.animation_data.action = action

    for f in range(0, 31):
        t = f / FPS
        p = t / 1.0
        fall = p * p * math.pi * 0.5
        drop = p * p * 0.6

        kb = [
            ("mixamorig:Hips",        Vector((0, 0, -drop)),       _quat_x(fall)),
            ("mixamorig:LeftArm",     None,                        _quat_x(-0.3 - p * 0.8)),
            ("mixamorig:RightArm",    None,                        _quat_x(-0.3 - p * 0.8)),
            ("mixamorig:LeftForeArm", None,                        _quat_x(0.3 + p * 0.5)),
            ("mixamorig:RightForeArm",None,                        _quat_x(0.3 + p * 0.5)),
            ("mixamorig:LeftUpLeg",   None,                        _quat_x(0.2 + p * 0.4)),
            ("mixamorig:RightUpLeg",  None,                        _quat_x(0.2 + p * 0.4)),
            ("mixamorig:LeftLeg",     None,                        _quat_x(-p * 0.5)),
            ("mixamorig:RightLeg",    None,                        _quat_x(-p * 0.5)),
            ("mixamorig:Neck",        None,                        _quat_x(p * 0.5)),
            ("mixamorig:Head",        None,                        _quat_x(p * 0.4)),
        ]
        for bn, loc, rot in kb:
            p = _pb(arm_obj, bn)
            if loc is not None:
                _key_loc(p, loc, f)
            if rot is not None:
                _key_rot(p, rot, f)

def _create_animations(arm_obj):
    if not arm_obj.animation_data:
        arm_obj.animation_data_create()
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    bpy.context.view_layer.objects.active = arm_obj
    _create_idle(arm_obj)
    _create_walk(arm_obj)
    _create_death(arm_obj)
    bpy.ops.object.mode_set(mode='OBJECT')

def _stash_actions(arm_obj):
    for action in bpy.data.actions:
        arm_obj.animation_data.action = action
        track = arm_obj.animation_data.nla_tracks.new()
        track.name = action.name
        track.strips.new(action.name, int(action.frame_range[0]), action)
    arm_obj.animation_data.action = None

# ---- export ----------------------------------------------------------------

def _export_scene(arm_obj, mesh_obj, filename):
    for o in bpy.data.objects:
        o.select_set(False)
    arm_obj.select_set(True)
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB",
        use_selection=True, export_yup=True, export_apply=True,
        export_animations=True, export_animation_mode='ACTIONS',
    )
    return path

# ---- main ------------------------------------------------------------------

def _clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    for a in list(bpy.data.armatures):
        bpy.data.armatures.remove(a)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)

def _recolor_mesh(mesh_obj, pal):
    for mat in mesh_obj.data.materials:
        n = mat.name.lower()
        color = None
        if "suit" in n:
            color = pal["suit"]
        elif "vest" in n:
            color = pal["vest"]
        elif "gear" in n:
            color = pal["gear"]
        elif "skin" in n:
            color = pal["skin"]
        if color and mat.use_nodes:
            b = mat.node_tree.nodes.get("Principled BSDF")
            b.inputs["Base Color"].default_value = (*color, 1.0)

def main():
    _clear_scene()

    # Build once with CT palette; export CT, then recolor + export T.
    arm_obj = _build_armature()
    ct_mesh = _build_mesh(arm_obj, "ct", PALETTES["ct"])
    _create_animations(arm_obj)
    _stash_actions(arm_obj)

    path = _export_scene(arm_obj, ct_mesh, "ct_player.glb")
    tris = len(ct_mesh.data.polygons)
    size = os.path.getsize(path)
    print(f"ct: {tris} tris, {size:,} bytes -> {path}")

    _recolor_mesh(ct_mesh, PALETTES["t"])
    path = _export_scene(arm_obj, ct_mesh, "t_player.glb")
    size = os.path.getsize(path)
    print(f"t:  {tris} tris, {size:,} bytes -> {path}")

if __name__ == "__main__":
    main()
