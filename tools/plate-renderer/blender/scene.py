"""
Blender (Cycles) renderer for DRYFIRE STAGE STUDIO: environment plates and asset sprites.

  blender -b --factory-startup --python blender/scene.py -- <job> <out.png> [samples] [scale]

  job = plate:indoor_01 | sprite:paper_full | sprite:steel_popper | sprite:mesh_wall

Axes: X right, Y downrange (away from the shooter), Z up. Units: meters.
The plate camera matches src/plateCamera.ts (level, eye 1.5 m, horizon at 40 %, focal 1.4 image heights).
Sprites: level camera at eye height 8 m away, off-axis so the frame is exactly viewW × viewH cm
in the object's plane with the ground line at groundY (registry geometry), transparent film +
shadow catcher floor.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.normpath(os.path.join(HERE, '..', 'public', 'tex'))
GEN = os.path.join(TEX, 'gen')

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
JOB = argv[0] if argv else 'sprite:paper_full'
OUT = argv[1] if len(argv) > 1 else os.path.join(HERE, '..', 'out', 'test.png')
SAMPLES = int(argv[2]) if len(argv) > 2 else 128
SCALE = float(argv[3]) if len(argv) > 3 else 1.0

cm = lambda v: v / 100.0

# ------------------------------------------------------------------ scene / render setup


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            for d in prefs.devices:
                d.use = d.type == kind
            if any(d.use for d in prefs.devices):
                sc.cycles.device = 'GPU'
                break
        except Exception:
            pass
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.max_bounces = 8
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    try:
        sc.view_settings.view_transform = 'Khronos PBR Neutral'
    except TypeError:
        sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'None'
    return sc


def world_hdri(strength=1.0, rotation=0.0, hdri='empty_warehouse_01.hdr'):
    w = bpy.data.worlds.new('World')
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Rotation'].default_value[2] = rotation
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(os.path.join(TEX, hdri), check_existing=True)
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], env.inputs['Vector'])
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    return w


def hex_rgba(h, a=1.0):
    h = h.lstrip('#')
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, a)


# ------------------------------------------------------------------ materials


def _img(path, non_color=False):
    im = bpy.data.images.load(path, check_existing=True)
    if non_color:
        im.colorspace_settings.name = 'Non-Color'
    return im


def material(name, color='#808080', rough=0.5, metal=0.0, emission=None, emission_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = hex_rgba(color)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emission:
        b.inputs['Emission Color'].default_value = hex_rgba(emission)
        b.inputs['Emission Strength'].default_value = emission_strength
    return m


def pbr(name, mat_id, tile=1.0, tint=None, rough_mul=1.0, normal=1.0, metal=0.0, rotate=False, color=True, uv=False, stains=0.0, rough=None):
    """Photo material. Box-projected in object space (tile = meters per texture repeat) or UV-mapped."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    b = N['Principled BSDF']
    tc = N.new('ShaderNodeTexCoord')
    mp = N.new('ShaderNodeMapping')
    s = 1.0 if uv else 1.0 / tile
    mp.inputs['Scale'].default_value = (s, s, s)
    if rotate:
        mp.inputs['Rotation'].default_value = (0, math.pi / 2, math.pi / 2)
    L.new(tc.outputs['UV' if uv else 'Object'], mp.inputs['Vector'])

    def tex(kind, non_color):
        path = os.path.join(TEX, f'{mat_id}_{kind}.jpg')
        if not os.path.exists(path):
            return None
        t = N.new('ShaderNodeTexImage')
        t.image = _img(path, non_color)
        if not uv:
            t.projection = 'BOX'
            t.projection_blend = 0.2
        L.new(mp.outputs['Vector'], t.inputs['Vector'])
        return t

    col_out = None
    if color:
        c = tex('color', False)
        col_out = c.outputs['Color'] if c else None
    if tint:
        mix = N.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        if col_out:
            L.new(col_out, mix.inputs['A'])
        else:
            mix.inputs['A'].default_value = (1, 1, 1, 1)
        mix.inputs['B'].default_value = hex_rgba(tint)
        col_out = mix.outputs['Result']
    if stains and col_out:
        # large, soft variation so tiling never shows (room-scale noise)
        nz = N.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = 0.35
        nz.inputs['Detail'].default_value = 3
        L.new(tc.outputs['Object'], nz.inputs['Vector'])
        ramp = N.new('ShaderNodeMapRange')
        ramp.inputs['From Min'].default_value = 0.35
        ramp.inputs['From Max'].default_value = 0.7
        ramp.inputs['To Min'].default_value = 1.0 - stains
        ramp.inputs['To Max'].default_value = 1.0
        L.new(nz.outputs['Fac'], ramp.inputs['Value'])
        mix = N.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        L.new(col_out, mix.inputs['A'])
        gray = N.new('ShaderNodeCombineColor')
        for ch in ('Red', 'Green', 'Blue'):
            L.new(ramp.outputs['Result'], gray.inputs[ch])
        L.new(gray.outputs['Color'], mix.inputs['B'])
        col_out = mix.outputs['Result']
    if col_out:
        L.new(col_out, b.inputs['Base Color'])
    r = None if rough is not None else tex('rough', True)
    if rough is not None:
        b.inputs['Roughness'].default_value = rough
    if r:
        mm = N.new('ShaderNodeMath')
        mm.operation = 'MULTIPLY'
        mm.inputs[1].default_value = rough_mul
        mm.use_clamp = True
        L.new(r.outputs['Color'], mm.inputs[0])
        L.new(mm.outputs['Value'], b.inputs['Roughness'])
    n = tex('normal', True)
    if n and normal > 0:
        nm = N.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = normal
        L.new(n.outputs['Color'], nm.inputs['Color'])
        L.new(nm.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Metallic'].default_value = metal
    return m


def image_material(name, path, rough=0.6, alpha=False, normal_from=None, normal=0.6, emission=0.0):
    """UV-mapped generated texture (card face, barrier mesh, paint)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    b = N['Principled BSDF']
    t = N.new('ShaderNodeTexImage')
    t.image = _img(path)
    t.interpolation = 'Cubic'
    L.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough
    if alpha:
        L.new(t.outputs['Alpha'], b.inputs['Alpha'])
    if emission:
        L.new(t.outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = emission
    if normal_from:
        tc = N.new('ShaderNodeTexCoord')
        nt_ = N.new('ShaderNodeTexImage')
        nt_.image = _img(os.path.join(TEX, f'{normal_from}_normal.jpg'), True)
        L.new(tc.outputs['UV'], nt_.inputs['Vector'])
        nm = N.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = normal
        L.new(nt_.outputs['Color'], nm.inputs['Color'])
        L.new(nm.outputs['Normal'], b.inputs['Normal'])
        rt = N.new('ShaderNodeTexImage')
        rt.image = _img(os.path.join(TEX, f'{normal_from}_rough.jpg'), True)
        L.new(tc.outputs['UV'], rt.inputs['Vector'])
        L.new(rt.outputs['Color'], b.inputs['Roughness'])
    return m


# ------------------------------------------------------------------ geometry helpers


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_obj(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    return link(ob)


def box(name, size, loc, mat, bevel=0.0):
    """Axis-aligned box: size (x, y, z) in meters, loc = centre."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=2, affect='EDGES')
    for f in bm.faces:
        f.smooth = False
    ob = mesh_obj(name, bm, [mat])
    ob.location = loc
    return ob


def rounded(pts, r, seg=8):
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % n]
        d1 = math.dist(p0, p1)
        d2 = math.dist(p1, p2)
        rr = min(r, d1 / 2, d2 / 2)
        a = (p1[0] + (p0[0] - p1[0]) * rr / d1, p1[1] + (p0[1] - p1[1]) * rr / d1)
        b = (p1[0] + (p2[0] - p1[0]) * rr / d2, p1[1] + (p2[1] - p1[1]) * rr / d2)
        for s in range(seg):
            t = s / seg
            out.append(((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * p1[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * p1[1] + t * t * b[1]))
    return out


def slab(name, outline, thickness, front_mat, side_mat, bevel=0.0):
    """Flat plate from a 2D outline (x, z in meters) in the XZ plane, front facing -Y.
    Front/back faces get UVs over the outline's bounding box."""
    bm = bmesh.new()
    front = [bm.verts.new((x, 0.0, z)) for x, z in outline]
    back = [bm.verts.new((x, thickness, z)) for x, z in outline]
    f_front = bm.faces.new(list(reversed(front)))
    f_back = bm.faces.new(back)
    n = len(outline)
    sides = [bm.faces.new((front[i], front[(i + 1) % n], back[(i + 1) % n], back[i])) for i in range(n)]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    xs = [p[0] for p in outline]
    zs = [p[1] for p in outline]
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    uv = bm.loops.layers.uv.new('UVMap')
    for f in (f_front, f_back):
        f.material_index = 0
        for lp in f.loops:
            lp[uv].uv = ((lp.vert.co.x - x0) / (x1 - x0), (lp.vert.co.z - z0) / (z1 - z0))
    for f in sides:
        f.material_index = 1
        f.smooth = True
    if bevel:
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and {f.material_index for f in e.link_faces} == {0, 1}]
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=2, affect='EDGES')
    return mesh_obj(name, bm, [front_mat, side_mat])


def plane(name, w, h, loc, mat, rot=(0, 0, 0), uv_repeat=(1, 1)):
    """Plane w × h; by default in the XZ plane facing -Y."""
    bm = bmesh.new()
    vs = [bm.verts.new((x * w / 2, 0, z * h / 2)) for x, z in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.new('UVMap')
    for lp, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        lp[uv].uv = (u * uv_repeat[0], v * uv_repeat[1])
    bmesh.ops.recalc_face_normals(bm, faces=[f])
    ob = mesh_obj(name, bm, [mat])
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def floor_plane(name, w, d, loc, mat):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    for v in bm.verts:
        v.co = Vector((v.co.x * w, v.co.y * d, 0))
    ob = mesh_obj(name, bm, [mat])
    ob.location = loc
    return ob


def cylinder(name, r, depth, loc, rot, mat, verts=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return ob


def area_light(name, size, loc, power, color='#fff3e2', rot=(0, 0, 0), size_y=None):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = power
    ld.color = hex_rgba(color)[:3]
    if size_y:
        ld.shape = 'RECTANGLE'
        ld.size = size
        ld.size_y = size_y
    else:
        ld.size = size
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    ob.rotation_euler = rot
    return link(ob)


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


# ------------------------------------------------------------------ shared materials


class M:
    pass


def make_materials():
    M.galv = pbr('galvanized', 'PaintedMetal004', tile=0.6, color=False, tint='#8d9399', rough=0.48, normal=0.25, metal=0.65)
    M.coat = pbr('powdercoat', 'PaintedMetal004', tile=0.5, color=False, tint='#262626', rough=0.55, normal=0.35, metal=0.3)
    M.pine = pbr('pine', 'Wood058', tile=1.0, rotate=True, rough_mul=1.0, normal=0.6)
    M.card = image_material('card_face', os.path.join(GEN, 'card_face.png'), normal_from='Cardboard004', normal=0.5)
    M.card_edge = material('card_edge', '#8a6740', rough=0.95)
    M.paint = image_material('popper_paint', os.path.join(GEN, 'popper_paint.png'), rough=0.7, normal_from='PaintedMetal004', normal=0.25)
    M.bolt = material('bolt', '#55595e', rough=0.4, metal=0.85)
    M.staple = material('staple', '#c9ccd0', rough=0.35, metal=1.0)
    M.ziptie = material('ziptie', '#101010', rough=0.5)
    M.mesh = image_material('barrier_mesh', os.path.join(GEN, 'barrier_mesh.png'), rough=0.5, alpha=True, emission=0.0)


# ------------------------------------------------------------------ models (dimensions = scripts/generate-assets.mjs)

OCT = [(-11.5, 0), (11.5, 0), (23, 13), (23, 45), (11.5, 58), (-11.5, 58), (-23, 45), (-23, 13)]
CARD_BOTTOM = 85


def metal_base(half, sockets=()):
    for s in (-1, 1):
        box('foot', (cm(7), cm(30), cm(4)), (cm(s * half), cm(-4), cm(2)), M.galv, bevel=cm(0.3))
    box('crossbar', (cm(half * 2 + 7), cm(4), cm(3.2)), (0, 0, cm(4.9)), M.galv, bevel=cm(0.3))
    for x in sockets:
        box('socket', (cm(6.4), cm(6.4), cm(10)), (cm(x), 0, cm(10)), M.galv, bevel=cm(0.3))
        cylinder('screw', cm(0.9), cm(0.6), (cm(x + 1.8), cm(-3.3), cm(10)), (math.pi / 2, 0, 0), M.bolt)


def paper_target():
    metal_base(20, (-12, 12))
    rod_len = CARD_BOTTOM + 20 - 12
    for x in (-12, 12):
        box('rod', (cm(3.6), cm(1.8), cm(rod_len)), (cm(x), cm(2.2), cm(12 + rod_len / 2)), M.pine, bevel=cm(0.2))
    outline = [(cm(x), cm(CARD_BOTTOM + z)) for x, z in rounded(OCT, 1.6)]
    card = slab('card', outline, cm(0.45), M.card, M.card_edge)
    card.location.y = 0.0
    for x in (-12, 12):
        for z in (CARD_BOTTOM + 4, CARD_BOTTOM + 16):
            box('staple', (cm(1.3), cm(0.1), cm(0.14)), (cm(x), cm(-0.06), cm(z)), M.staple)


def steel_popper():
    metal_base(20)
    box('bracket', (cm(16), cm(6), cm(10)), (0, cm(-0.5), cm(11)), M.galv, bevel=cm(0.4))
    for x in (-4.5, 4.5):
        cylinder('bolt', cm(1.1), cm(0.6), (cm(x), cm(-3.6), cm(11)), (math.pi / 2, 0, 0), M.bolt, verts=6)
    pts = [(-7, 14)]
    a0, a1 = -0.64 * math.pi, -0.36 * math.pi
    # arc over the top: from a0 clockwise (decreasing angle) to a1
    steps = 64
    total = (a0 - a1) % (2 * math.pi)
    for i in range(steps + 1):
        a = a0 - total * i / steps
        pts.append((math.cos(a) * 15, 84 + math.sin(a) * 15))
    pts.append((7, 14))
    outline = [(cm(x), cm(z)) for x, z in pts]
    plate = slab('popper', outline, cm(0.8), M.paint, M.paint, bevel=cm(0.15))
    plate.location.y = cm(-0.4)


WALL_H, MESH_B, MESH_T = 185, 10, 180


def mesh_wall(width=180):
    half = width / 2
    mesh_h = MESH_T - MESH_B
    plane('mesh', cm(width), cm(mesh_h), (0, cm(-5), cm(MESH_B + mesh_h / 2)), M.mesh)
    for s in (-1, 1):
        box('post', (cm(9), cm(9), cm(WALL_H)), (cm(s * half), 0, cm(WALL_H / 2)), M.pine, bevel=cm(0.3))
        box('foot_plate', (cm(30), cm(30), cm(4)), (cm(s * half), 0, cm(2)), M.coat, bevel=cm(0.3))
        box('foot_block', (cm(14), cm(14), cm(16)), (cm(s * half), 0, cm(12)), M.coat, bevel=cm(0.3))
        for i in range(6):
            box('ziptie', (cm(10), cm(0.4), cm(0.5)), (cm(s * (half - 4.5)), cm(-5.2), cm(MESH_B + 8 + i * 30.5)), M.ziptie)


SPRITES = {
    'paper_full': dict(viewW=54, viewH=147, groundY=143, build=paper_target),
    'steel_popper': dict(viewW=54, viewH=103, groundY=99, build=steel_popper),
    'mesh_wall': dict(viewW=220, viewH=189, groundY=185, build=lambda: mesh_wall(180)),
}

# ------------------------------------------------------------------ jobs

PX_PER_CM = 8  # final sprite resolution (rendered at SCALE× and downsampled afterwards)
VIEW_DISTANCE = 8.0
EYE = 1.5


def render_sprite(sid):
    sc = reset()
    s = SPRITES[sid]
    sc.render.film_transparent = True
    sc.render.resolution_x = round(s['viewW'] * PX_PER_CM * SCALE)
    sc.render.resolution_y = round(s['viewH'] * PX_PER_CM * SCALE)
    sc.render.resolution_percentage = 100
    world_hdri(0.4, rotation=1.2)
    make_materials()
    s['build']()
    # floor that only keeps shadows (and contact occlusion)
    catcher = floor_plane('shadow_catcher', 30, 30, (0, 0, 0), material('catcher', '#808080', rough=0.9))
    catcher.is_shadow_catcher = True
    # key: soft high-bay light above and slightly in front; fill from the right
    key = area_light('key', 2.5, (-0.6, -4.5, 7.0), 1100, '#fff4e6')
    look_at(key, (0, 0, 0.8))
    fill = area_light('fill', 3.0, (3.5, -4.0, 2.0), 140, '#e4ecff')
    look_at(fill, (0, 0, 0.8))
    # camera: level at eye height, frame = viewW × viewH cm in the object plane
    camd = bpy.data.cameras.new('cam')
    cam = link(bpy.data.objects.new('cam', camd))
    sc.camera = cam
    cam.location = (0, -VIEW_DISTANCE, EYE)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    w, h = s['viewW'] / 100, s['viewH'] / 100
    big = max(w, h)
    camd.sensor_fit = 'AUTO'
    camd.sensor_width = 36
    camd.lens = 36 * VIEW_DISTANCE / big
    zc = (2 * s['groundY'] - s['viewH']) / 200
    camd.shift_y = (zc - EYE) / big
    camd.clip_start = 0.5
    camd.clip_end = 50
    sc.render.filepath = OUT
    bpy.ops.render.render(write_still=True)


# ---- plate: indoor 01

W_ROOM, D_ROOM, H_ROOM = 16, 34, 6
Z0 = -6  # room starts 6 m behind... (three: floor centre at z = D/2 - 6)


def plate_camera(sc):
    camd = bpy.data.cameras.new('plate')
    cam = link(bpy.data.objects.new('plate', camd))
    sc.camera = cam
    cam.location = (0, -2.2, 1.5)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    camd.sensor_fit = 'VERTICAL'
    camd.sensor_height = 24
    camd.lens = 1.4 * 24
    camd.shift_y = -0.1 * 9 / 16
    camd.clip_start = 0.1
    camd.clip_end = 400


def indoor_01():
    W, D, H = W_ROOM, D_ROOM, H_ROOM
    yc = D / 2 - 6
    back = D - 6
    world_hdri(0.08)
    floor = pbr('floor', 'Concrete034', tile=1.8, tint='#7d7b78', rough_mul=0.66, normal=0.15, stains=0.3)
    floor_plane('floor', W * 2, D, (0, yc, 0), floor)
    # saw-cut joints in the concrete
    joint = material('joint', '#2a2a29', rough=0.9)
    plane('joint_c', 0.008, D, (0, yc, 0.0006), joint, rot=(math.pi / 2, 0, 0))
    for y in (4, 10, 16, 22):
        plane(f'joint_{y}', W * 2, 0.008, (0, y, 0.0006), joint, rot=(math.pi / 2, 0, 0))

    # acoustic panels: fabric with panel seams (brick texture as seam pattern)
    wall = bpy.data.materials.new('panels')
    wall.use_nodes = True
    N, L = wall.node_tree.nodes, wall.node_tree.links
    b = N['Principled BSDF']
    tc = N.new('ShaderNodeTexCoord')
    br = N.new('ShaderNodeTexBrick')
    br.offset = 0.0
    br.inputs['Color1'].default_value = hex_rgba('#3f4042')
    br.inputs['Color2'].default_value = hex_rgba('#3a3b3d')
    br.inputs['Mortar'].default_value = hex_rgba('#1c1d1e')
    br.inputs['Scale'].default_value = 1.0
    br.inputs['Mortar Size'].default_value = 0.012
    br.inputs['Brick Width'].default_value = 1.2
    br.inputs['Row Height'].default_value = 2.0
    L.new(tc.outputs['Object'], br.inputs['Vector'])
    L.new(br.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.95
    fn = N.new('ShaderNodeTexImage')
    fn.image = _img(os.path.join(TEX, 'Fabric030_normal.jpg'), True)
    fn.projection = 'BOX'
    mp = N.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (3, 3, 3)
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    L.new(mp.outputs['Vector'], fn.inputs['Vector'])
    nm = N.new('ShaderNodeNormalMap')
    nm.inputs['Strength'].default_value = 0.6
    L.new(fn.outputs['Color'], nm.inputs['Color'])
    bump = N.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.4
    bump.invert = True
    L.new(br.outputs['Fac'], bump.inputs['Height'])
    L.new(nm.outputs['Normal'], bump.inputs['Normal'])
    L.new(bump.outputs['Normal'], b.inputs['Normal'])

    box('back_wall', (W * 2, 0.1, H), (0, back + 0.05, H / 2), wall)
    for s in (-1, 1):
        box('side_wall', (0.1, D, H), (s * (W / 2 + 0.05), yc, H / 2), wall)
    steel = pbr('steel', 'PaintedMetal004', tile=0.8, color=False, tint='#3a3d40', rough_mul=0.7, normal=0.3, metal=0.6)
    dark_steel = pbr('dark_steel', 'PaintedMetal004', tile=0.8, color=False, tint='#202224', rough_mul=0.7, normal=0.3, metal=0.5)
    for s in (-1, 1):
        box('kick', (0.02, D, 0.6), (s * (W / 2 - 0.01), yc, 0.3), steel)
    column = pbr('column', 'Concrete036', tile=1.5, tint='#56575a', rough_mul=1.0, normal=0.5)
    for s in (-1, 1):
        for y in (5, 12, 19):
            box('column', (0.6, 0.6, H), (s * (W / 2 - 0.3), y, H / 2), column, bevel=0.01)
    # backstop: rubber granulate berm + steel baffle
    rubber = pbr('rubber', 'Rubber001', tile=0.7, tint='#8a8a8a', rough_mul=1.0, normal=0.8)
    berm = box('berm', (W, 0.6, 3.2), (0, back - 1.3, 1.15), rubber)
    berm.rotation_euler = (-0.9, 0, 0)
    baffle = box('baffle', (W, 0.08, 1.1), (0, back - 0.4, 3.6), dark_steel)
    baffle.rotation_euler = (0.35, 0, 0)
    # ceiling, trusses, lights
    ceiling = material('ceiling', '#111213', rough=1.0)
    box('ceiling', (W * 2, D, 0.1), (0, yc, H + 0.05), ceiling)
    for y in (3, 8.5, 14, 19.5, 25):
        box('truss', (W, 0.18, 0.35), (0, y + 2.7, H - 0.25), dark_steel)
    fixture = material('fixture', '#ffffff', rough=0.3, emission='#f7f5f0', emission_strength=12)
    housing = material('housing', '#2b2c2e', rough=0.5, metal=0.6)
    for x in (-4.5, 0, 4.5):
        for y in (3, 8.5, 14, 19.5, 25):
            box('housing', (1.46, 0.46, 0.08), (x, y, H - 0.41), housing)
            box('fixture', (1.4, 0.4, 0.02), (x, y, H - 0.455), fixture)
            area_light('bay', 1.4, (x, y, H - 0.47), 340, '#f7f5f0', size_y=0.4)
    # spent brass near the shooting position
    brass = material('brass', '#c99d48', rough=0.32, metal=1.0)
    rnd = random.Random(9)
    for i in range(40):
        y = -0.8 + rnd.random() ** 1.8 * 4.5
        x = (rnd.random() - 0.5) * (3 + y * 0.9)
        cylinder('case', 0.0048, 0.019, (x, y, 0.0048), (math.pi / 2, 0, rnd.random() * math.tau), brass, verts=12)


PLATES = {'indoor_01': indoor_01}


def render_plate(pid):
    sc = reset()
    sc.render.resolution_x = round(3840 * SCALE)
    sc.render.resolution_y = round(2160 * SCALE)
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    plate_camera(sc)
    PLATES[pid]()
    sc.render.filepath = OUT
    bpy.ops.render.render(write_still=True)


kind, name = JOB.split(':')
if kind == 'sprite':
    render_sprite(name)
else:
    render_plate(name)
print('RENDERED', JOB, '->', OUT)
