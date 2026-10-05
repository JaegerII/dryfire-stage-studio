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
import json
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
# sprite frame from the app's registry: "viewW,viewH,groundY" (cm)
GEOM = [float(v) for v in argv[4].split(',')] if len(argv) > 4 else None

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


def pbr(name, mat_id, tile=1.0, tint=None, rough_mul=1.0, normal=1.0, metal=0.0, rotate=False, color=True, uv=False, stains=0.0, rough=None, sat=1.0, value=1.0):
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
    if col_out and (sat != 1.0 or value != 1.0):
        hs = N.new('ShaderNodeHueSaturation')
        hs.inputs['Saturation'].default_value = sat
        hs.inputs['Value'].default_value = value
        L.new(col_out, hs.inputs['Color'])
        col_out = hs.outputs['Color']
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
    M.pine = pbr('pine', 'Wood058', tile=1.0, rotate=True, rough_mul=1.0, normal=0.6, sat=0.72, value=1.08)
    M.pine_h = pbr('pine_h', 'Wood058', tile=1.0, rough_mul=1.0, normal=0.6, sat=0.72, value=1.08)
    M.ply = pbr('plywood', 'Wood058', tile=1.4, tint='#f4e3c3', rough_mul=1.05, normal=0.4, sat=0.35, value=1.3)
    M.black_ply = pbr('black_ply', 'Wood058', tile=1.2, tint='#262626', rough=0.6, normal=0.35, sat=0.0, value=0.6)
    M.batten = pbr('batten', 'Wood058', tile=1.2, rotate=True, tint='#1e1e1e', rough=0.64, normal=0.35, sat=0.0, value=0.6)
    M.card_edge = material('card_edge', '#8a6740', rough=0.95)
    M.white_edge = material('white_edge', '#cfcfca', rough=0.9)
    M.paint = image_material('popper_paint', os.path.join(GEN, 'popper_paint.png'), rough=0.7, normal_from='PaintedMetal004', normal=0.25)
    M.bolt = material('bolt', '#55595e', rough=0.4, metal=0.85)
    M.staple = material('staple', '#c9ccd0', rough=0.35, metal=1.0)
    M.ziptie = material('ziptie', '#101010', rough=0.5)
    M.mesh = mesh_material()
    M.drum = pbr('drum', 'Concrete034', tile=0.8, color=False, tint='#1d5ca8', rough=0.4, normal=0.08)
    M.drum_cap = material('drum_cap', '#16467f', rough=0.45)
    M.faces = {}


def face(kind):
    """Card face material by generated texture name (card_face, card_white, card_hc_half, ...)."""
    if kind not in M.faces:
        M.faces[kind] = image_material(kind, os.path.join(GEN, f'{kind}.png'), normal_from='Cardboard004', normal=0.5)
    return M.faces[kind]


def mesh_material():
    """Orange barrier mesh, tileable 60 × 50 cm, UVs in meters / tile."""
    m = bpy.data.materials.new('barrier_mesh')
    m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    b = N['Principled BSDF']
    t = N.new('ShaderNodeTexImage')
    t.image = _img(os.path.join(GEN, 'barrier_mesh.png'))
    t.interpolation = 'Cubic'
    L.new(t.outputs['Color'], b.inputs['Base Color'])
    L.new(t.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 0.5
    return m


# ------------------------------------------------------------------ models (dimensions = scripts/generate-assets.mjs)

OCT = [(-11.5, 0), (11.5, 0), (23, 13), (23, 45), (11.5, 58), (-11.5, 58), (-23, 45), (-23, 13)]
CARD_BOTTOM = 85
MESH_TILE = (0.6, 0.5)


def metal_base(half, sockets=()):
    for s in (-1, 1):
        box('foot', (cm(7), cm(30), cm(4)), (cm(s * half), cm(-4), cm(2)), M.galv, bevel=cm(0.3))
    box('crossbar', (cm(half * 2 + 7), cm(4), cm(3.2)), (0, 0, cm(4.9)), M.galv, bevel=cm(0.3))
    for x in sockets:
        box('socket', (cm(6.4), cm(6.4), cm(10)), (cm(x), 0, cm(10)), M.galv, bevel=cm(0.3))
        cylinder('screw', cm(0.9), cm(0.6), (cm(x + 1.8), cm(-3.3), cm(10)), (math.pi / 2, 0, 0), M.bolt)


def card(bottom, scale=1.0, kind='card_face', y=0.0, staples=True):
    """Octagon card, bottom edge at `bottom` cm, front face at y (m)."""
    edge = M.white_edge if kind == 'card_white' else M.card_edge
    outline = [(cm(x * scale), cm(bottom + z * scale)) for x, z in rounded(OCT, 1.6)]
    ob = slab('card', outline, cm(0.45), face(kind), edge)
    ob.location.y = y
    if staples:
        for x in (-12 * scale, 12 * scale):
            for z in (bottom + 4 * scale, bottom + 16 * scale):
                box('staple', (cm(1.3), cm(0.1), cm(0.14)), (cm(x), y - cm(0.06), cm(z)), M.staple)
    return ob


def rods(top, spread, bottom=12):
    length = top - bottom
    for x in (-spread, spread):
        box('rod', (cm(3.6), cm(1.8), cm(length)), (cm(x), cm(2.2), cm(bottom + length / 2)), M.pine, bevel=cm(0.2))


def target_on_stand(scale=1.0, kind='card_face'):
    spread = 12 * max(scale, 0.7)
    metal_base(20, (-spread, spread))
    rods(CARD_BOTTOM + 20 * scale, spread)
    card(CARD_BOTTOM, scale, kind)


def stack_on_stand(layers, step=13):
    front = 66
    metal_base(20, (-12, 12))
    rods(front + 30, 12)
    n = len(layers)
    for i, kind in enumerate(layers):
        # back card highest; every card a little in front of the one behind it
        card(front + step * (n - 1 - i), 1.0, kind, y=-cm(0.6) * i)


def card_only(kind):
    card(0, 1.0, kind, staples=False)


def swinger():
    box('pivot_plate', (cm(28), cm(20), cm(4)), (0, cm(-2), cm(2)), M.galv, bevel=cm(0.3))
    box('pivot_block', (cm(10), cm(5), cm(8)), (0, 0, cm(8)), M.galv, bevel=cm(0.4))
    cylinder('pivot_bolt', cm(1.6), cm(0.8), (0, cm(-2.8), cm(8.5)), (math.pi / 2, 0, 0), M.bolt, verts=6)
    box('pole', (cm(4), cm(2), cm(107)), (0, cm(2.2), cm(8 + 107 / 2)), M.pine, bevel=cm(0.2))
    card(CARD_BOTTOM, 1.0, 'card_face')


def steel_bracket():
    box('bracket', (cm(16), cm(6), cm(10)), (0, cm(-0.5), cm(11)), M.galv, bevel=cm(0.4))
    for x in (-4.5, 4.5):
        cylinder('bolt', cm(1.1), cm(0.6), (cm(x), cm(-3.6), cm(11)), (math.pi / 2, 0, 0), M.bolt, verts=6)


def steel_popper():
    metal_base(20)
    steel_bracket()
    pts = [(-7, 14)]
    a0, a1 = -0.64 * math.pi, -0.36 * math.pi
    total = (a0 - a1) % (2 * math.pi)
    for i in range(65):
        a = a0 - total * i / 64
        pts.append((math.cos(a) * 15, 84 + math.sin(a) * 15))
    pts.append((7, 14))
    plate = slab('popper', [(cm(x), cm(z)) for x, z in pts], cm(0.8), M.paint, M.paint, bevel=cm(0.15))
    plate.location.y = cm(-0.4)


def disc(name, r, cx, cz, y, thickness=0.8):
    pts = [(cm(cx + math.cos(a) * r), cm(cz + math.sin(a) * r)) for a in (i / 64 * math.tau for i in range(64))]
    ob = slab(name, pts, cm(thickness), M.paint, M.paint, bevel=cm(0.15))
    ob.location.y = y
    return ob


def steel_plate():
    metal_base(20)
    steel_bracket()
    box('post', (cm(5.2), cm(3), cm(42)), (0, cm(1.2), cm(14 + 21)), M.galv, bevel=cm(0.3))
    disc('plate', 15, 0, 69, cm(-0.5))


def plate_rack():
    for x in (-62, 62):
        box('leg', (cm(8), cm(8), cm(100)), (cm(x), 0, cm(50)), M.coat, bevel=cm(0.4))
        box('rack_foot', (cm(32), cm(30), cm(4)), (cm(x), 0, cm(2)), M.coat, bevel=cm(0.4))
    box('beam', (cm(164), cm(8), cm(7)), (0, 0, cm(96.5)), M.coat, bevel=cm(0.4))
    for i in range(6):
        x = -65 + i * 26
        box('stem', (cm(3.2), cm(2), cm(9)), (cm(x), cm(-1), cm(109.5)), M.coat)
        disc('rack_plate', 10, x, 118, cm(-2.5))


# ---- barrier mesh panels

WALL_H, MESH_B, MESH_T = 185, 10, 180


def mesh_panel(name, polys, y=-5):
    """Flat mesh panel from polygons (cm, x/z) — UVs in tile units so the mesh never stretches."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    for poly in polys:
        vs = [bm.verts.new((cm(x), cm(y), cm(z))) for x, z in poly]
        f = bm.faces.new(vs)
        for lp in f.loops:
            lp[uv].uv = (lp.vert.co.x / MESH_TILE[0], lp.vert.co.z / MESH_TILE[1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return mesh_obj(name, bm, [M.mesh])


def rect(x0, z0, x1, z1):
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


def rect_with_hole(x0, z0, x1, z1, hx0, hz0, hx1, hz1):
    return [rect(x0, z0, hx0, z1), rect(hx1, z0, x1, z1), rect(hx0, z0, hx1, hz0), rect(hx0, hz1, hx1, z1)]


def post(x, h=WALL_H, y=0.0):
    box('post', (cm(9), cm(9), cm(h)), (cm(x), y, cm(h / 2)), M.pine, bevel=cm(0.3))


def wall_foot(x, y=0.0):
    box('foot_plate', (cm(30), cm(30), cm(4)), (cm(x), y, cm(2)), M.coat, bevel=cm(0.3))
    box('foot_block', (cm(14), cm(14), cm(16)), (cm(x), y, cm(12)), M.coat, bevel=cm(0.3))


def zipties(x, z_top=MESH_T, count=6):
    for i in range(count):
        z = MESH_B + 8 + i * ((z_top - MESH_B - 16) / max(1, count - 1))
        box('ziptie', (cm(10), cm(0.4), cm(0.5)), (cm(x), cm(-5.2), cm(z)), M.ziptie)


def frame(x, z, w, h, y=-5.5):
    """Wooden 5 cm frame around an opening (x, z = bottom-left, cm)."""
    for bx, bz, bw, bh in ((x - 5, z + h, w + 10, 5), (x - 5, z - 5, w + 10, 5), (x - 5, z, 5, h), (x + w, z, 5, h)):
        box('frame', (cm(bw), cm(2.5), cm(bh)), (cm(bx + bw / 2), cm(y), cm(bz + bh / 2)), M.pine_h, bevel=cm(0.2))


def straight_wall(width):
    half = width / 2
    mesh_panel('mesh', [rect(-half, MESH_B, half, MESH_T)])
    for s in (-1, 1):
        post(s * half)
        wall_foot(s * half)
        zipties(s * (half - 4.5))


def window_wall():
    half = 120
    wx, ww, wz, wh = -37.5, 75, 100, 60
    mesh_panel('mesh', rect_with_hole(-half, MESH_B, half, MESH_T, wx - 5, wz - 5, wx + ww + 5, wz + wh + 5))
    frame(wx, wz, ww, wh)
    for s in (-1, 1):
        post(s * half)
        wall_foot(s * half)
        zipties(s * (half - 4.5))


def port_wall():
    half = 100
    px, pw, pz, ph = -42, 30, 30, 135
    mesh_panel('mesh', rect_with_hole(-half, MESH_B, half, MESH_T, px - 5, pz - 5, px + pw + 5, pz + ph + 5))
    frame(px, pz, pw, ph)
    for s in (-1, 1):
        post(s * half)
        wall_foot(s * half)
        zipties(s * (half - 4.5))


def diagonal_wall():
    half = 90
    low = 120
    mesh_panel('mesh', [[(-half, MESH_B), (half, MESH_B), (half, MESH_T), (-half, low)]])
    # slanted top rail
    length = math.hypot(2 * half, MESH_T - low)
    rail = box('rail', (cm(length), cm(4), cm(5)), (0, cm(-5.5), cm((MESH_T + low) / 2)), M.pine_h, bevel=cm(0.2))
    rail.rotation_euler = (0, -math.atan2(MESH_T - low, 2 * half), 0)
    post(-half, low + 5)
    post(half)
    for s in (-1, 1):
        wall_foot(s * half)
    zipties(-(half - 4.5), low, 4)
    zipties(half - 4.5)


def corner_wall():
    left, corner = -125, 55
    mesh_panel('mesh', [rect(left, MESH_B, corner, MESH_T)])
    post(left)
    post(corner)
    wall_foot(left)
    wall_foot(corner)
    zipties(left + 4.5)
    # second panel receding to the right (180 cm, turned 58.5° away from the shooter)
    g = bpy.data.objects.new('recede', None)
    link(g)
    g.location = (cm(corner), 0, 0)
    g.rotation_euler = (0, 0, math.radians(58.5))
    before = set(bpy.context.scene.objects)
    mesh_panel('mesh2', [rect(0, MESH_B, 180, MESH_T)])
    post(180)
    wall_foot(180)
    zipties(180 - 4.5)
    for ob in set(bpy.context.scene.objects) - before:
        ob.parent = g


def wood_wall():
    w, h = 300, 200
    box('plywood', (cm(w), cm(1.8), cm(h)), (0, 0, cm(h / 2)), M.ply)
    for bx, bz, bw, bh in ((-w / 2, h - 5, w, 5), (-w / 2, 0, w, 5), (-w / 2, 0, 5, h), (w / 2 - 5, 0, 5, h)):
        box('frame', (cm(bw), cm(3.8), cm(bh)), (cm(bx + bw / 2), cm(-2.6), cm(bz + bh / 2)), M.pine_h if bw > bh else M.pine, bevel=cm(0.3))
    for x in (-110, 110):
        brace = box('brace', (cm(4), cm(4), cm(180)), (cm(x), cm(45), cm(85)), M.pine)
        brace.rotation_euler = (math.radians(-28), 0, 0)


def drum(x, y=0.0):
    """Blue 220 l HDPE drum, Ø 58 cm, 90 cm, with two rolling hoops."""
    prof = [(0.0, 0.0), (0.27, 0.0), (0.285, 0.012), (0.29, 0.04), (0.29, 0.28), (0.297, 0.30), (0.297, 0.33), (0.29, 0.35),
            (0.29, 0.58), (0.297, 0.60), (0.297, 0.63), (0.29, 0.65), (0.29, 0.86), (0.285, 0.888), (0.27, 0.9), (0.0, 0.9)]
    bm = bmesh.new()
    vs = [bm.verts.new((r, 0, z)) for r, z in prof]
    es = [bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(0, 0, 1), steps=64, angle=math.tau, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        f.smooth = True
    ob = mesh_obj('drum', bm, [M.drum])
    ob.location = (cm(x), y, 0)
    for bx in (-0.13, 0.15):
        cylinder('bung', 0.035, 0.012, (cm(x) + bx, y + 0.05, 0.906), (0, 0, 0), M.drum_cap, verts=24)


def barrel():
    drum(0)


def barrel_barricade():
    box('plywood', (cm(184), cm(1.8), cm(112)), (0, cm(36), cm(38 + 56)), M.ply)
    box('ledge', (cm(184), cm(4), cm(6)), (0, cm(33), cm(37)), M.pine_h, bevel=cm(0.2))
    for x in (-62, 0, 62):
        drum(x)


def crate(width):
    """Black box, width × 60 × 60 cm, with dark battens on the front."""
    box('box', (cm(width), cm(60), cm(60)), (0, cm(30), cm(30)), M.black_ply, bevel=cm(0.5))
    battens = [(-width / 2, 0, 5, 60), (width / 2 - 5, 0, 5, 60), (-width / 2 + 5, 56, width - 10, 4), (-width / 2 + 5, 0, width - 10, 4)]
    if width > 90:
        battens.append((-2.5, 0, 5, 60))
    for bx, bz, bw, bh in battens:
        box('batten', (cm(bw), cm(1.5), cm(bh)), (cm(bx + bw / 2), cm(-0.7), cm(bz + bh / 2)), M.batten, bevel=cm(0.2))


def banner(kind):
    """Printed mesh banner (texture from the app's banner SVG) with a gentle sag."""
    m = image_material(kind, os.path.join(GEN, f'{kind}.png'), rough=0.75)
    bm = bmesh.new()
    nx, nz = 48, 16
    uv = bm.loops.layers.uv.new('UVMap')
    grid = [[bm.verts.new((cm(-80 + 160 * i / nx), cm(0.6 * math.sin(math.pi * i / nx) * math.sin(math.pi * j / nz)), cm(50 * j / nz))) for j in range(nz + 1)] for i in range(nx + 1)]
    for i in range(nx):
        for j in range(nz):
            f = bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            f.smooth = True
            for lp, (u, v) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                lp[uv].uv = (u / nx, v / nz)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    mesh_obj('banner', bm, [m])


# sprite id → (builder, floor shadow)
BUILDERS = {
    'paper_full': (lambda: target_on_stand(1.0), True),
    'paper_mini': (lambda: target_on_stand(0.62), True),
    'no_shoot': (lambda: target_on_stand(1.0, 'card_white'), True),
    'paper_hc_vertical': (lambda: target_on_stand(1.0, 'card_hc_vertical'), True),
    'paper_hc_half': (lambda: target_on_stand(1.0, 'card_hc_half'), True),
    'paper_hc_bottom': (lambda: target_on_stand(1.0, 'card_hc_bottom'), True),
    'paper_hc_diagonal': (lambda: target_on_stand(1.0, 'card_hc_diagonal'), True),
    'paper_hc_vertical_card': (lambda: card_only('card_hc_vertical'), False),
    'paper_hc_half_card': (lambda: card_only('card_hc_half'), False),
    'paper_hc_bottom_card': (lambda: card_only('card_hc_bottom'), False),
    'paper_hc_diagonal_card': (lambda: card_only('card_hc_diagonal'), False),
    'paper_card': (lambda: card_only('card_face'), False),
    'no_shoot_overlay': (lambda: card_only('card_white'), False),
    'paper_stack': (lambda: stack_on_stand(['card_face', 'card_white', 'card_face']), True),
    'paper_stack_double': (lambda: stack_on_stand(['card_face', 'card_face'], 16), True),
    'paper_swinger': (swinger, True),
    'steel_popper': (steel_popper, True),
    'steel_plate': (steel_plate, True),
    'steel_plate_rack': (plate_rack, True),
    'mesh_wall': (lambda: straight_wall(180), True),
    'mesh_wall_short': (lambda: straight_wall(90), True),
    'mesh_wall_window': (window_wall, True),
    'mesh_wall_diagonal': (diagonal_wall, True),
    'mesh_wall_port': (port_wall, True),
    'mesh_corner': (corner_wall, True),
    'wood_wall': (wood_wall, True),
    'barrel': (barrel, True),
    'barrel_barricade': (barrel_barricade, True),
    'crate': (lambda: crate(60), True),
    'crate_wide': (lambda: crate(120), True),
    'banner_forth_trace_black': (lambda: banner('banner_forth_trace_black'), False),
    'banner_forth_trace_white': (lambda: banner('banner_forth_trace_white'), False),
    'banner_west_arms': (lambda: banner('banner_west_arms'), False),
}

# ------------------------------------------------------------------ jobs

PX_PER_CM = 8  # final sprite resolution (rendered at SCALE× and downsampled afterwards)
VIEW_DISTANCE = 8.0
EYE = 1.5


def eye_camera(sc, view_w, view_h, ground_y):
    """Level camera at eye height, VIEW_DISTANCE away; the frame is view_w × view_h cm in the
    object's plane with the ground line ground_y cm below the top edge."""
    camd = bpy.data.cameras.new('cam')
    cam = link(bpy.data.objects.new('cam', camd))
    sc.camera = cam
    cam.location = (0, -VIEW_DISTANCE, EYE)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    w, h = view_w / 100, view_h / 100
    big = max(w, h)
    camd.sensor_fit = 'AUTO'
    camd.sensor_width = 36
    camd.lens = 36 * VIEW_DISTANCE / big
    zc = (2 * ground_y - view_h) / 200
    camd.shift_y = (zc - EYE) / big
    camd.clip_start = 0.5
    camd.clip_end = 50


def render_sprite(sid):
    """The object alone (no floor shadow — the app draws the environment's rendered shadow below it)."""
    sc = reset()
    view_w, view_h, ground_y = GEOM
    sc.render.film_transparent = True
    sc.render.resolution_x = round(view_w * PX_PER_CM * SCALE)
    sc.render.resolution_y = round(view_h * PX_PER_CM * SCALE)
    sc.render.resolution_percentage = 100
    world_hdri(0.4, rotation=1.2)
    make_materials()
    BUILDERS[sid][0]()
    # key: soft high-bay light above and slightly in front; fill from the right
    key = area_light('key', 2.5, (-0.6, -4.5, 7.0), 1100, '#fff4e6')
    look_at(key, (0, 0, 0.8))
    fill = area_light('fill', 3.0, (3.5, -4.0, 2.0), 140, '#e4ecff')
    look_at(fill, (0, 0, 0.8))
    eye_camera(sc, view_w, view_h, ground_y)
    sc.render.filepath = OUT
    bpy.ops.render.render(write_still=True)


# ---- shadow sprites: the floor shadow of one object, lit like one environment

SHADOW_PX_PER_CM = 4  # shadows are soft — half the sprite resolution is plenty
OBJECT_Y = 8.5  # where an object stands in the indoor halls when we light it (≈ 10.7 m from the plate camera)

# Outdoor shadows use the soft, diffuse light of the overcast sky everywhere: a low evening /
# sunset sun throws long hard shadows across the whole stage, which reads badly in a drill.
SOFT_OUTDOOR_SHADOWS = True

# sun direction for the outdoor plates: azimuth (deg, world XY, towards the sun) and elevation (deg, measured from the HDRI)
SUN = {'outdoor_01': (-120, 73.5), 'outdoor_02': (-125, 20.7), 'outdoor_04': (160, 3.2)}


def shadow_frame(env, view_w, view_h, ground_y):
    """Shadow image frame (cm): wider than the sprite so long shadows fit; ground line at the same height.
    Returns (width, height, groundY)."""
    if env in SUN and not SOFT_OUTDOOR_SHADOWS:
        az, el = (math.radians(v) for v in SUN[env])
        length = min(3.0, 1 / math.tan(max(math.radians(1), el)))
        side = view_h * length * abs(math.cos(az))
        toward = max(0.0, math.sin(az)) * view_h / 100 * length  # meters towards the shooter (sun ahead)
    else:
        side, toward = view_h * 0.5, view_h / 100 * 0.3
    e_side = max(40.0, min(450.0, side + 30))
    e_down = max(12.0, min(120.0, EYE * 100 * (VIEW_DISTANCE / max(1.0, VIEW_DISTANCE - toward) - 1) + 12))
    return view_w + 2 * e_side, view_h + e_down, ground_y


def shadow_lights(env):
    """Light the object exactly like the environment does."""
    if env.startswith('outdoor') and SOFT_OUTDOOR_SHADOWS:
        outdoor_world('farmland_overcast', 1.0, rotation=0.6)
    elif env == 'outdoor_01':
        outdoor_world('countrytrax_midday', 1.0, sun_azimuth=math.radians(SUN[env][0]))
    elif env == 'outdoor_02':
        outdoor_world('evening_meadow', 1.0, sun_azimuth=math.radians(SUN[env][0]))
    elif env == 'outdoor_03':
        outdoor_world('farmland_overcast', 1.0, rotation=0.6)
    elif env == 'outdoor_04':
        outdoor_world('grasslands_sunset', 1.0, sun_azimuth=math.radians(SUN[env][0]))
    elif env in ('indoor_01', 'indoor_02'):
        world_hdri(0.08)
        style = INDOOR_HALL[env]
        for x in (-4.5, 0, 4.5):
            for y in (3, 8.5, 14, 19.5, 25):
                area_light('bay', 1.4, (x, y - OBJECT_Y, 6 - 0.47), style['power'], style['light'], size_y=0.4)
    elif env == 'indoor_03':
        world_hdri(0.1)
        for i in range(11):
            area_light('strip_l', 8 * 0.45, (0, 1 + i * 3 - OBJECT_Y, 3.6 - 0.05), 150, '#f5f8ff', size_y=0.16)
    elif env == 'indoor_04':
        world_hdri(0.1)
        for x in (-4.8, -1.6, 1.6, 4.8):
            for y in (2, 7, 12, 17, 22, 27):
                area_light('spot_l', 0.3, (x, y - OBJECT_Y, 4.6 - 0.75), 110, '#fff6e8')


def render_shadow(env, sid):
    """Only the shadow the object throws on the floor (object invisible, shadow-catcher floor)."""
    sc = reset()
    sw, sh, sg = shadow_frame(env, *GEOM)
    sc.render.film_transparent = True
    sc.render.resolution_x = round(sw * SHADOW_PX_PER_CM * SCALE)
    sc.render.resolution_y = round(sh * SHADOW_PX_PER_CM * SCALE)
    sc.render.resolution_percentage = 100
    make_materials()
    BUILDERS[sid][0]()
    for ob in list(bpy.context.scene.objects):
        if ob.type == 'MESH':
            ob.visible_camera = False  # still casts shadows
    catcher = floor_plane('shadow_catcher', 60, 60, (0, 0, 0), material('catcher', '#808080', rough=0.9))
    catcher.is_shadow_catcher = True
    shadow_lights(env)
    eye_camera(sc, sw, sh, sg)
    sc.render.filepath = OUT
    bpy.ops.render.render(write_still=True)
    with open(OUT + '.json', 'w') as f:
        json.dump({'w': round(sw, 2), 'h': round(sh, 2), 'g': round(sg, 2)}, f)


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
    camd.clip_end = 5000


def grid_material(name, c1, c2, mortar, brick_w, row_h, mortar_size=0.012, offset=0.0, normal_img='Fabric030', normal_tile=0.33,
                  normal=0.6, bump=0.4, rough=0.95, photo=None, photo_tile=1.5, emission=0.0, axes='xz', photo_mix=0.5):
    """Panels / blocks / tiles: brick-texture grid with seams, optional photo texture in the faces."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    b = N['Principled BSDF']
    tc = N.new('ShaderNodeTexCoord')
    br = N.new('ShaderNodeTexBrick')
    br.offset = offset
    br.inputs['Color1'].default_value = hex_rgba(c1)
    br.inputs['Color2'].default_value = hex_rgba(c2)
    br.inputs['Mortar'].default_value = hex_rgba(mortar)
    br.inputs['Scale'].default_value = 1.0
    br.inputs['Mortar Size'].default_value = mortar_size
    br.inputs['Brick Width'].default_value = brick_w
    br.inputs['Row Height'].default_value = row_h
    # the brick grid runs in the wall's own plane (u along the wall, v up)
    sep = N.new('ShaderNodeSeparateXYZ')
    L.new(tc.outputs['Object'], sep.inputs['Vector'])
    comb = N.new('ShaderNodeCombineXYZ')
    L.new(sep.outputs[axes[0].upper()], comb.inputs['X'])
    L.new(sep.outputs[axes[1].upper()], comb.inputs['Y'])
    L.new(comb.outputs['Vector'], br.inputs['Vector'])
    col = br.outputs['Color']
    if photo:
        mp2 = N.new('ShaderNodeMapping')
        mp2.inputs['Scale'].default_value = (1 / photo_tile,) * 3
        L.new(tc.outputs['Object'], mp2.inputs['Vector'])
        ph = N.new('ShaderNodeTexImage')
        ph.image = _img(os.path.join(TEX, f'{photo}_color.jpg'))
        ph.projection = 'BOX'
        ph.projection_blend = 0.2
        L.new(mp2.outputs['Vector'], ph.inputs['Vector'])
        gray = N.new('ShaderNodeRGBToBW')
        L.new(ph.outputs['Color'], gray.inputs['Color'])
        sc_ = N.new('ShaderNodeMath')
        sc_.operation = 'MULTIPLY'
        sc_.inputs[1].default_value = 2.0
        L.new(gray.outputs['Val'], sc_.inputs[0])
        mix = N.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = photo_mix
        L.new(col, mix.inputs['A'])
        L.new(sc_.outputs['Value'], mix.inputs['B'])
        col = mix.outputs['Result']
    L.new(col, b.inputs['Base Color'])
    if emission:
        L.new(col, b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = emission
    b.inputs['Roughness'].default_value = rough
    nrm = None
    if normal_img:
        fn = N.new('ShaderNodeTexImage')
        fn.image = _img(os.path.join(TEX, f'{normal_img}_normal.jpg'), True)
        fn.projection = 'BOX'
        mp = N.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1 / normal_tile,) * 3
        L.new(tc.outputs['Object'], mp.inputs['Vector'])
        L.new(mp.outputs['Vector'], fn.inputs['Vector'])
        nm = N.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = normal
        L.new(fn.outputs['Color'], nm.inputs['Color'])
        nrm = nm.outputs['Normal']
    bp = N.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = bump
    bp.invert = True
    L.new(br.outputs['Fac'], bp.inputs['Height'])
    if nrm:
        L.new(nrm, bp.inputs['Normal'])
    L.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m


def brass(count=40, spread=1.0, seed=9):
    """Spent 9 mm brass lying around the shooting position."""
    mat = material('brass', '#c99d48', rough=0.32, metal=1.0)
    rnd = random.Random(seed)
    for i in range(count):
        y = -0.8 + rnd.random() ** 1.8 * 4.5
        x = (rnd.random() - 0.5) * (3 + y * 0.9) * spread
        cylinder('case', 0.0048, 0.019, (x, y, 0.0048), (math.pi / 2, 0, rnd.random() * math.tau), mat, verts=12)


def floor_joints(W, D, yc, ys, color='#2a2a29'):
    joint = material('joint', color, rough=0.9)
    plane('joint_c', 0.008, D, (0, yc, 0.0006), joint, rot=(math.pi / 2, 0, 0))
    for y in ys:
        plane(f'joint_{y}', W, 0.008, (0, y, 0.0006), joint, rot=(math.pi / 2, 0, 0))


INDOOR_HALL = {
    # dark fabric acoustic panels, warm-neutral high bays
    'indoor_01': dict(wall=lambda ax: grid_material('panels', '#3f4042', '#3a3b3d', '#1c1d1e', 1.2, 2.0, axes=ax), floor_tint='#7d7b78', light='#f7f5f0', power=340),
    # light grey concrete block, cooler and brighter LED bay
    'indoor_02': dict(
        wall=lambda ax: grid_material('blocks', '#aeb0b2', '#a6a8aa', '#7f8285', 0.4, 0.2, mortar_size=0.012, offset=0.5, normal_img='Concrete036',
                                      normal_tile=1.0, normal=0.4, bump=0.35, rough=0.9, photo='Concrete036', photo_tile=1.2, axes=ax, photo_mix=0.35),
        floor_tint='#8d8f90', light='#f3f5fa', power=380),
}


def indoor_hall(pid):
    style = INDOOR_HALL[pid]
    W, D, H = 16, 34, 6
    yc = D / 2 - 6
    back = D - 6
    world_hdri(0.08)
    floor = pbr('floor', 'Concrete034', tile=1.8, tint=style['floor_tint'], rough_mul=0.66, normal=0.15, stains=0.3)
    floor_plane('floor', W * 2, D, (0, yc, 0), floor)
    floor_joints(W * 2, D, yc, (4, 10, 16, 22))
    box('back_wall', (W * 2, 0.1, H), (0, back + 0.05, H / 2), style['wall']('xz'))
    side = style['wall']('yz')
    for s in (-1, 1):
        box('side_wall', (0.1, D, H), (s * (W / 2 + 0.05), yc, H / 2), side)
    steel = pbr('steel', 'PaintedMetal004', tile=0.8, color=False, tint='#3a3d40', rough_mul=0.7, normal=0.3, metal=0.6)
    dark_steel = pbr('dark_steel', 'PaintedMetal004', tile=0.8, color=False, tint='#202224', rough_mul=0.7, normal=0.3, metal=0.5)
    for s in (-1, 1):
        box('kick', (0.02, D, 0.6), (s * (W / 2 - 0.01), yc, 0.3), steel)
    column = pbr('column', 'Concrete036', tile=1.5, tint='#56575a', rough_mul=1.0, normal=0.5)
    for s in (-1, 1):
        for y in (5, 12, 19):
            box('column', (0.6, 0.6, H), (s * (W / 2 - 0.3), y, H / 2), column, bevel=0.01)
    rubber = pbr('rubber', 'Rubber001', tile=0.7, tint='#8a8a8a', rough_mul=1.0, normal=0.8)
    berm = box('berm', (W, 0.6, 3.2), (0, back - 1.3, 1.15), rubber)
    berm.rotation_euler = (-0.9, 0, 0)
    baffle = box('baffle', (W, 0.08, 1.1), (0, back - 0.4, 3.6), dark_steel)
    baffle.rotation_euler = (0.35, 0, 0)
    ceiling = material('ceiling', '#111213', rough=1.0)
    box('ceiling', (W * 2, D, 0.1), (0, yc, H + 0.05), ceiling)
    for y in (3, 8.5, 14, 19.5, 25):
        box('truss', (W, 0.18, 0.35), (0, y + 2.7, H - 0.25), dark_steel)
    fixture = material('fixture', '#ffffff', rough=0.3, emission=style['light'], emission_strength=12)
    housing = material('housing', '#2b2c2e', rough=0.5, metal=0.6)
    for x in (-4.5, 0, 4.5):
        for y in (3, 8.5, 14, 19.5, 25):
            box('housing', (1.46, 0.46, 0.08), (x, y, H - 0.41), housing)
            box('fixture', (1.4, 0.4, 0.02), (x, y, H - 0.455), fixture)
            area_light('bay', 1.4, (x, y, H - 0.47), style['power'], style['light'], size_y=0.4)
    brass()


def indoor_tunnel():
    """Indoor 03: long bright lane, white acoustic tiles on walls + ceiling, LED strips, green floor."""
    W, D, H = 8, 40, 3.6
    y0, back = -4, 34
    yc = y0 + D / 2
    world_hdri(0.1)
    floor = pbr('green_floor', 'Rubber004', tile=0.9, color=False, tint='#3a6448', rough=0.6, normal=0.25)
    floor_plane('floor', W, D, (0, yc, 0), floor)
    tile = lambda ax: grid_material('tiles', '#d9dcdb', '#d4d7d6', '#a9aeac', 0.6, 0.6, mortar_size=0.01, normal=0.4, bump=0.3, axes=ax)
    side, ceil = tile('yz'), tile('xy')
    for s in (-1, 1):
        box('wall', (0.1, D, H), (s * (W / 2 + 0.05), yc, H / 2), side)
    box('ceiling', (W, D, 0.1), (0, yc, H + 0.05), ceil)
    tiles = tile('xz')
    strip = material('strip', '#ffffff', rough=0.3, emission='#f5f8ff', emission_strength=14)
    for i in range(11):
        y = 1 + i * 3
        box('strip', (W * 0.45, 0.16, 0.04), (0, y, H - 0.02), strip)
        area_light('strip_l', W * 0.45, (0, y, H - 0.05), 150, '#f5f8ff', size_y=0.16)
    # backstop: lit white wall with alternating teal / white baffles, steel trap below, tiled header
    backwall = material('backwall', '#f2f4f3', rough=0.8, emission='#ffffff', emission_strength=0.6)
    box('backwall', (W, 0.1, H), (0, back + 0.65, H / 2), backwall)
    teal = material('teal', '#2e8a80', rough=0.7)
    white = material('baffle_white', '#e3e8e6', rough=0.7)
    for i in range(9):
        box('baffle', (0.5, 0.08, 2.2), (-2.4 + i * 0.6, back + 0.4, 1.6), white if i % 2 else teal)
    trap = pbr('trap', 'PaintedMetal004', tile=0.8, color=False, tint='#2a2d2e', rough=0.5, normal=0.3, metal=0.4)
    box('trap', (W, 0.6, 0.56), (0, back, 0.28), trap)
    box('header', (W, 0.1, 0.8), (0, back - 0.6, H - 0.5), tiles)
    brass(30, 0.6)


def indoor_beams():
    """Indoor 04: light concrete floor, dark speckled walls, bright ceiling with beams and spots."""
    W, D, H = 14, 38, 4.6
    y0, back = -4, 32
    yc = y0 + D / 2
    world_hdri(0.1)
    floor = pbr('floor', 'Concrete034', tile=1.8, tint='#b9b7b2', rough_mul=0.6, normal=0.15, stains=0.25)
    floor_plane('floor', W, D, (0, yc, 0), floor)
    floor_joints(W, D, yc, (3, 9, 15, 21, 27))
    walls = pbr('walls', 'Concrete036', tile=1.6, tint='#6a6d71', rough_mul=1.0, normal=0.6)
    for s in (-1, 1):
        box('wall', (0.1, D, H), (s * (W / 2 + 0.05), yc, H / 2), walls)
    box('back', (W, 0.1, H), (0, back + 0.05, H / 2), walls)
    ceiling = material('ceiling', '#f1f0ec', rough=0.8)
    box('ceiling', (W, D, 0.1), (0, yc, H + 0.05), ceiling)
    beam = material('beam', '#e6e5e1', rough=0.6)
    spot = material('spot', '#ffffff', rough=0.3, emission='#fff6e8', emission_strength=16)
    for x in (-4.8, -1.6, 1.6, 4.8):
        box('beam', (0.55, D, 0.7), (x, yc, H - 0.35), beam)
        for y in (2, 7, 12, 17, 22, 27):
            box('spot', (0.3, 0.3, 0.05), (x, y, H - 0.72), spot)
            area_light('spot_l', 0.3, (x, y, H - 0.75), 110, '#fff6e8')
    brass(40)


PLATES = {
    'indoor_01': lambda: indoor_hall('indoor_01'),
    'indoor_02': lambda: indoor_hall('indoor_02'),
    'indoor_03': indoor_tunnel,
    'indoor_04': indoor_beams,
}


# ---- outdoor ranges: real sky + horizon from an 8K HDRI, photo ground and earth berms


def hdri_sun_azimuth(path):
    """Azimuth (radians, Blender world XY) of the brightest spot (the sun) in an equirect HDRI."""
    import numpy as np
    im = bpy.data.images.load(path, check_existing=False)
    im.scale(512, 256)
    px = np.empty(512 * 256 * 4, dtype=np.float32)
    im.pixels.foreach_get(px)
    lum = px.reshape(256, 512, 4)[:, :, :3].sum(axis=2)
    v, u = np.unravel_index(int(np.argmax(lum)), lum.shape)
    bpy.data.images.remove(im)
    # Blender's equirect lookup: u = -atan2(dir.y, dir.x) / 2pi + 0.5
    return -((u + 0.5) / 512 - 0.5) * 2 * math.pi, (v + 0.5) / 256


def outdoor_world(hdri, strength=1.0, sun_azimuth=None, rotation=0.0):
    """HDRI as visible background + light. With sun_azimuth the sky is turned so the sun
    sits at that azimuth (world XY, 0 = +X, pi/2 = +Y downrange)."""
    path = os.path.join(TEX, f'{hdri}.hdr')
    if sun_azimuth is not None:
        az, _ = hdri_sun_azimuth(path)
        rotation = az - sun_azimuth
    world_hdri(strength, rotation=rotation, hdri=f'{hdri}.hdr')


def ground(mat, size=4000):
    """Huge ground plane so it meets the HDRI horizon without a visible edge."""
    floor_plane('ground', size, size, (0, size / 2 - 50, 0), mat)


def ridge(name, loc, width, depth, height, mat, rot_z=0.0, seed=1.0, steep=1.6):
    """Earth berm: smooth bump across its depth, gentle wave along it, ends fading into the ground."""
    nx, ny = 120, 40
    bm = bmesh.new()
    grid = []
    for i in range(nx + 1):
        x = -width / 2 + width * i / nx
        col = []
        for j in range(ny + 1):
            yy = -depth / 2 + depth * j / ny
            nz = yy / (depth / 2)
            profile = max(0.0, math.cos(nz * math.pi / 2)) ** steep
            wave = 1 + 0.07 * math.sin(x * 0.23 + seed) + 0.035 * math.sin(x * 0.9 + seed * 2) + 0.015 * math.sin(x * 2.7 + seed * 5)
            end = min(1.0, (width / 2 - abs(x)) / min(6.0, width / 4))
            taper = end * end * (3 - 2 * end)
            col.append(bm.verts.new((x, yy, height * profile * wave * taper)))
        grid.append(col)
    for i in range(nx):
        for j in range(ny):
            f = bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = mesh_obj(name, bm, [mat])
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    return ob


def stones(count, area, seed, mat, size=(0.04, 0.16)):
    """A few loose stones / clods so the ground is not perfectly clean."""
    rnd = random.Random(seed)
    x0, x1, y0, y1 = area
    for i in range(count):
        r = size[0] + rnd.random() * (size[1] - size[0])
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=r, location=(x0 + rnd.random() * (x1 - x0), y0 + rnd.random() * (y1 - y0), r * 0.25))
        ob = bpy.context.active_object
        ob.scale = (1, 0.8 + rnd.random() * 0.4, 0.45 + rnd.random() * 0.3)
        ob.rotation_euler = (0, 0, rnd.random() * math.tau)
        ob.data.materials.append(mat)
        bpy.ops.object.shade_smooth()


def terrain_material(name, layers, patch=None, foot=None, rough=0.96, normal=0.9):
    """Natural ground: a base photo texture, broken up by large noise patches of a second texture,
    and (for berms) blended into the ground texture at the foot so there is no hard seam.

    layers: {key: (ambientCG id, tint, tile m, saturation, value)}; 'base' is required.
    patch:  (key, amount 0..1, noise scale) — where the patch texture shows through.
    foot:   (key, height m) — below this height (object space) the key's texture takes over.
    """
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    b = N['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    tc = N.new('ShaderNodeTexCoord')
    obj = tc.outputs['Object']

    def layer(key):
        mid, tint, tile, sat, val = layers[key]
        mp = N.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1 / tile,) * 3
        L.new(obj, mp.inputs['Vector'])
        out = {}
        for kind, nc in (('color', False), ('normal', True)):
            t = N.new('ShaderNodeTexImage')
            t.image = _img(os.path.join(TEX, f'{mid}_{kind}.jpg'), nc)
            t.projection = 'BOX'
            t.projection_blend = 0.3
            L.new(mp.outputs['Vector'], t.inputs['Vector'])
            out[kind] = t.outputs['Color']
        hs = N.new('ShaderNodeHueSaturation')
        hs.inputs['Saturation'].default_value = sat
        hs.inputs['Value'].default_value = val
        L.new(out['color'], hs.inputs['Color'])
        mix = N.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        L.new(hs.outputs['Color'], mix.inputs['A'])
        mix.inputs['B'].default_value = hex_rgba(tint)
        nm = N.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = normal
        L.new(out['normal'], nm.inputs['Color'])
        return mix.outputs['Result'], nm.outputs['Normal']

    def blend(a, b_, fac):
        c = N.new('ShaderNodeMix')
        c.data_type = 'RGBA'
        L.new(fac, c.inputs['Factor'])
        L.new(a[0], c.inputs['A'])
        L.new(b_[0], c.inputs['B'])
        n = N.new('ShaderNodeMix')
        n.data_type = 'VECTOR'
        L.new(fac, n.inputs['Factor'])
        L.new(a[1], n.inputs['A'])
        L.new(b_[1], n.inputs['B'])
        return c.outputs['Result'], n.outputs['Result']

    cur = layer('base')
    if patch:
        key, amount, scale = patch
        nz = N.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = scale
        nz.inputs['Detail'].default_value = 8
        nz.inputs['Roughness'].default_value = 0.6
        L.new(obj, nz.inputs['Vector'])
        mr = N.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value = 0.62 - amount * 0.25
        mr.inputs['From Max'].default_value = 0.70 - amount * 0.25
        L.new(nz.outputs['Fac'], mr.inputs['Value'])
        cur = blend(cur, layer(key), mr.outputs['Result'])
    if foot:
        key, h = foot
        sep = N.new('ShaderNodeSeparateXYZ')
        L.new(obj, sep.inputs['Vector'])
        # ragged edge: add some noise to the height before the threshold
        nz2 = N.new('ShaderNodeTexNoise')
        nz2.inputs['Scale'].default_value = 1.5
        L.new(obj, nz2.inputs['Vector'])
        add = N.new('ShaderNodeMath')
        add.operation = 'MULTIPLY_ADD'
        add.inputs[1].default_value = h * 0.8
        L.new(nz2.outputs['Fac'], add.inputs[0])
        L.new(sep.outputs['Z'], add.inputs[2])
        mr = N.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value = h * 0.4
        mr.inputs['From Max'].default_value = h * 1.4
        mr.inputs['To Min'].default_value = 1.0
        mr.inputs['To Max'].default_value = 0.0
        L.new(add.outputs['Value'], mr.inputs['Value'])
        cur = blend(cur, layer(key), mr.outputs['Result'])
    L.new(cur[0], b.inputs['Base Color'])
    L.new(cur[1], b.inputs['Normal'])
    return m


# ground / berm recipes (ambientCG id, tint, tile m, saturation, value)
GRAVEL = ('Gravel041', '#efe9de', 2.2, 0.8, 1.0)
GRAVEL_WARM = ('Gravel041', '#eadcc4', 2.2, 0.8, 1.0)
DIRT = ('Ground048', '#eadbc4', 2.6, 0.38, 1.5)
GRASS_DIRT = ('Ground037', '#ffffff', 2.6, 0.9, 1.0)
GRASS = ('Grass004', '#d8dcc2', 1.6, 0.85, 1.0)
GRASS_WARM = ('Grass004', '#ece2c0', 1.6, 0.85, 1.0)


def hair_material(name, colors, rough=0.6):
    """Grass blade material: colour varies per strand (random) between the given hex colours."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    b = N['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    try:
        b.inputs['Subsurface Weight'].default_value = 0.15
    except KeyError:
        pass
    hi = N.new('ShaderNodeHairInfo')
    ramp = N.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    els[0].color = hex_rgba(colors[0])
    els[1].color = hex_rgba(colors[-1])
    for i, c in enumerate(colors[1:-1], 1):
        e = els.new(i / (len(colors) - 1))
        e.color = hex_rgba(c)
    L.new(hi.outputs['Random'], ramp.inputs['Fac'])
    # darker towards the root (self-shadowing in the turf)
    grad = N.new('ShaderNodeMapRange')
    grad.inputs['To Min'].default_value = 0.45
    grad.inputs['To Max'].default_value = 1.0
    L.new(hi.outputs['Intercept'], grad.inputs['Value'])
    mul = N.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    L.new(ramp.outputs['Color'], mul.inputs['A'])
    comb = N.new('ShaderNodeCombineColor')
    for ch in ('Red', 'Green', 'Blue'):
        L.new(grad.outputs['Result'], comb.inputs[ch])
    L.new(comb.outputs['Color'], mul.inputs['B'])
    # large patches: some areas lighter / drier, some darker / lusher (by world position)
    geo = N.new('ShaderNodeNewGeometry')
    nz = N.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 0.12
    nz.inputs['Detail'].default_value = 4
    L.new(geo.outputs['Position'], nz.inputs['Vector'])
    pr = N.new('ShaderNodeMapRange')
    pr.inputs['To Min'].default_value = 0.7
    pr.inputs['To Max'].default_value = 1.35
    L.new(nz.outputs['Fac'], pr.inputs['Value'])
    patch = N.new('ShaderNodeMix')
    patch.data_type = 'RGBA'
    patch.blend_type = 'MULTIPLY'
    patch.inputs['Factor'].default_value = 1.0
    L.new(mul.outputs['Result'], patch.inputs['A'])
    pc = N.new('ShaderNodeCombineColor')
    for ch in ('Red', 'Green', 'Blue'):
        L.new(pr.outputs['Result'], pc.inputs[ch])
    L.new(pc.outputs['Color'], patch.inputs['B'])
    L.new(patch.outputs['Result'], b.inputs['Base Color'])
    return m


def grass_patch(name, area, density, length, colors, patchy=0.0, seed=1, z=0.0, emitter=None, length_random=0.5):
    """Real grass blades (hair particles). area = (x0, x1, y0, y1) for a flat patch,
    or emitter = an existing mesh (berm) to grow from. density = blades per m².
    patchy > 0 thins the grass out in noise-shaped patches (0..1)."""
    if emitter is None:
        x0, x1, y0, y1 = area
        bm = bmesh.new()
        # fine grid so the density map below has enough resolution
        bmesh.ops.create_grid(bm, x_segments=max(2, int((x1 - x0) * 2)), y_segments=max(2, int((y1 - y0) * 2)), size=0.5)
        for v in bm.verts:
            v.co = Vector((v.co.x * (x1 - x0), v.co.y * (y1 - y0), 0))
        ob = mesh_obj(name, bm, [])
        ob.location = ((x0 + x1) / 2, (y0 + y1) / 2, z)
        area_m2 = (x1 - x0) * (y1 - y0)
        hide_emitter = True
    else:
        hide_emitter = False
        ob = emitter
        area_m2 = sum(p.area for p in ob.data.polygons) * ob.scale.x * ob.scale.y
    mat = hair_material(f'{name}_hair', colors)
    ob.data.materials.append(mat)
    mod = ob.modifiers.new(name, 'PARTICLE_SYSTEM')
    ps = mod.particle_system
    ps.seed = seed
    st = ps.settings
    st.type = 'HAIR'
    # a flat patch only carries the blades; the ground below stays visible
    ob.show_instancer_for_render = not hide_emitter
    st.count = int(area_m2 * density)
    st.hair_length = length
    st.hair_step = 4
    st.render_step = 3
    st.material_slot = mat.name
    st.use_advanced_hair = True
    st.emit_from = 'FACE'
    st.distribution = 'RAND'
    st.use_rotations = True
    st.rotation_mode = 'NOR'
    # with advanced hair the blade length comes from the emission velocity
    st.normal_factor = length
    st.tangent_factor = 0.0
    st.factor_random = length * 0.35
    st.brownian_factor = length * 0.05
    st.length_random = length_random
    st.root_radius = 1.0
    st.tip_radius = 0.0
    st.radius_scale = 0.0035
    st.shape = -0.2
    # bend blades a little with some kink so they do not stand like needles
    st.kink = 'CURL'
    st.kink_amplitude = length * 0.25
    st.kink_frequency = 0.6
    if patchy > 0:
        # density map: noise in world space, thresholded so grass grows in clumps and patches
        from mathutils import noise
        vg = ob.vertex_groups.new(name='density')
        mw = ob.matrix_world
        thr = -0.5 + patchy * 0.9
        for v in ob.data.vertices:
            w = mw @ v.co
            n = noise.noise(Vector((w.x * 0.35, w.y * 0.35, seed * 3.1))) + 0.5 * noise.noise(Vector((w.x * 1.3, w.y * 1.3, seed * 7.7)))
            t = max(0.0, min(1.0, (n - thr) / 0.35))
            vg.add([v.index], t * t * (3 - 2 * t), 'REPLACE')
        ps.vertex_group_density = 'density'
    return ob


LAWN = ['#557a2e', '#6a8c36', '#86a142', '#9cab55', '#b5b06a']
LAWN_WARM = ['#4f7230', '#668838', '#82984a', '#9ca45a', '#b2aa66']
DRY = ['#8a7a52', '#a4915f', '#b9a56e', '#7d7347', '#c2b07c']
BERM_GRASS = ['#425c25', '#5b7430', '#77883d', '#8c8a4a', '#6b6a3a']

OUTDOOR = {
    # midday: light gravel bay with dirt patches, brown earth berms, tree line behind
    'outdoor_01': dict(hdri='countrytrax_midday', sun=math.radians(-120),
                       ground=lambda: terrain_material('ground', {'base': GRAVEL, 'dirt': DIRT}, patch=('dirt', 0.35, 0.06)),
                       berm=lambda: terrain_material('berm', {'base': DIRT, 'gravel': GRAVEL}, foot=('gravel', 0.35)),
                       back=(0, 18.5, 52, 7, 2.6), sides=2.6,
                       ground_grass=dict(density=25, length=0.1, colors=DRY, patchy=0.95),
                       berm_grass=dict(density=120, length=0.12, colors=DRY, patchy=0.75)),
    # late afternoon: warmer gravel with grass creeping in, grass-and-dirt berms
    'outdoor_02': dict(hdri='evening_meadow', sun=math.radians(-125),
                       ground=lambda: terrain_material('ground', {'base': GRAVEL_WARM, 'grass': GRASS}, patch=('grass', 0.3, 0.06)),
                       berm=lambda: terrain_material('berm', {'base': GRASS_DIRT, 'gravel': GRAVEL_WARM}, foot=('gravel', 0.35)),
                       back=(0, 19, 52, 7, 2.4), sides=2.4,
                       ground_grass=dict(density=220, length=0.08, colors=LAWN, patchy=0.85),
                       berm_grass=dict(density=700, length=0.12, colors=BERM_GRASS, patchy=0.45)),
}


def outdoor_bay(pid):
    st = OUTDOOR[pid]
    outdoor_world(st['hdri'], 1.0, sun_azimuth=st['sun'])
    ground(st['ground']())
    berm = st['berm']()
    x, y, w, d, h = st['back']
    berms = [ridge('back_berm', (x, y, 0), w, d, h, berm, seed=1.3)]
    for s in (-1, 1):
        berms.append(ridge('side_berm', (s * 11.5, 7, 0), 30, 6, st['sides'], berm, rot_z=math.pi / 2, seed=2.1 + s))
    gg, bg = st['ground_grass'], st['berm_grass']
    grass_patch('ground_grass', (-12, 12, -1.5, y - 2), gg['density'], gg['length'], gg['colors'], patchy=gg['patchy'], seed=3)
    for i, ob in enumerate(berms):
        grass_patch(f'berm_grass{i}', None, bg['density'], bg['length'], bg['colors'], patchy=bg['patchy'], seed=10 + i, emitter=ob)


def outdoor_meadow():
    """Outdoor 03: overcast, mown grass bay between rolling grass berms."""
    outdoor_world('farmland_overcast', 1.0, rotation=0.6)
    ground(terrain_material('ground', {'base': GRASS, 'dirt': GRASS_DIRT}, patch=('dirt', 0.3, 0.06)))
    berm = terrain_material('berm', {'base': GRASS_DIRT, 'grass': GRASS}, foot=('grass', 0.4))
    for name, loc, rz, w, d, h in (
        ('back', (0, 27, 0), 0, 70, 16, 4.0),
        ('left', (-17, 10, 0), math.pi / 2, 40, 12, 3.4),
        ('right', (17, 10, 0), math.pi / 2, 40, 12, 3.6),
        ('mid_l', (-11, 21, 0), 0, 14, 7, 2.0),
        ('mid_r', (12, 22, 0), 0, 16, 7, 2.2),
    ):
        ob = ridge(name, loc, w, d, h, berm, rot_z=rz, seed=len(name) * 1.7)
        grass_patch(f'{name}_grass', None, 500, 0.11, BERM_GRASS, patchy=0.35, seed=len(name), emitter=ob)
    grass_patch('lawn', (-24, 24, -1.5, 27), 2200, 0.07, LAWN, patchy=0.12, seed=2)


def outdoor_sunset():
    """Outdoor 04: sunset, grass in front, covered firing line with a dirt backstop in the distance."""
    outdoor_world('grasslands_sunset', 1.0, sun_azimuth=math.radians(160))
    ground(terrain_material('ground', {'base': GRASS_WARM, 'dirt': GRASS_DIRT}, patch=('dirt', 0.3, 0.06)))
    roof = pbr('roof', 'PaintedMetal004', tile=1.0, color=False, tint='#4a5160', rough=0.5, normal=0.3, metal=0.4)
    steel = pbr('post', 'PaintedMetal004', tile=0.6, color=False, tint='#55595f', rough=0.5, normal=0.3, metal=0.4)
    bench = pbr('bench', 'Concrete036', tile=1.0, tint='#a19a90', normal=0.5)
    yb = 30
    r = box('roof', (56, 5, 0.18), (0, yb, 3.3), roof)
    r.rotation_euler = (-0.12, 0, 0)
    box('fascia', (56, 0.12, 0.25), (0, yb - 2.9, 3.05), roof)
    for i in range(15):
        x = -28 + i * 4
        box('post', (0.16, 0.16, 3.2), (x, yb - 2.7, 1.6), steel)
        box('bench', (1.6, 0.6, 0.9), (x + 2, yb + 1, 0.45), bench)
    berm = terrain_material('berm', {'base': DIRT, 'grass': GRASS_WARM}, foot=('grass', 0.4))
    ob = ridge('backstop', (0, yb + 5, 0), 60, 6, 3.0, berm, seed=0.7)
    grass_patch('backstop_grass', None, 150, 0.12, LAWN_WARM, patchy=0.7, seed=5, emitter=ob)
    grass_patch('lawn', (-26, 26, -1.5, 30), 1800, 0.08, LAWN_WARM, patchy=0.15, seed=2)


PLATES.update({
    'outdoor_01': lambda: outdoor_bay('outdoor_01'),
    'outdoor_02': lambda: outdoor_bay('outdoor_02'),
    'outdoor_03': outdoor_meadow,
    'outdoor_04': outdoor_sunset,
})


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


kind, name = JOB.split(':', 1)
if kind == 'sprite':
    render_sprite(name)
elif kind == 'shadow':
    render_shadow(*name.split(':'))
else:
    render_plate(name)
print('RENDERED', JOB, '->', OUT)
