"""
3D assets for the Stage Studio 3D player: the same scenes and models as scene.py,
exported as glTF with their look baked into textures by Cycles.

  blender -b --factory-startup --python blender/export3d.py -- <out_dir> <job> [<job> ...]

  env:indoor_01      the empty hall; light, shadows and materials baked (COMBINED) -> shown unlit
  obj:paper_full     one object; procedural materials baked to an albedo texture, image
                     materials (card faces, barrier mesh, popper paint) kept as they are -> lit live

Axes as in scene.py (X right, Y downrange, Z up); the glTF exporter converts to Y-up
(three.js: x right, y up, downrange = -z).
"""
import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
# scene.py parses its own job arguments at import time: hide ours from it
if '--' in sys.argv:
    sys.argv = sys.argv[: sys.argv.index('--') + 1]

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scene as S  # noqa: E402  (module guard: importing does not render anything)
OUT_DIR = os.path.abspath(argv[0]) if argv else os.path.join(S.HERE, '..', 'out', '3d')
JOBS = argv[1:] or ['env:indoor_01', 'obj:paper_full']
ENV_SAMPLES = int(os.environ.get('BAKE_SAMPLES', '384'))
# baked images are embedded in the .glb files; the loose copies stay out of the app
BAKE_DIR = os.path.join(S.HERE, '..', 'out', 'bake')

os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(BAKE_DIR, exist_ok=True)


def needs_bake(mat):
    """Procedural / object-projected materials cannot travel in glTF: bake them."""
    if not mat or not mat.use_nodes:
        return False
    for n in mat.node_tree.nodes:
        if n.type in ('TEX_BRICK', 'TEX_NOISE', 'MIX', 'HUE_SAT', 'MATH', 'MAP_RANGE'):
            return True
        if n.type == 'TEX_IMAGE' and n.projection == 'BOX':
            return True
    return False


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def apply_all():
    """Bake parenting / transforms into the meshes so joined objects stay in place."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes():
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes()[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob


def make_single_user(ob):
    """Each object gets its own material copies (they get a bake node / are replaced)."""
    for slot in ob.material_slots:
        if slot.material:
            slot.material = slot.material.copy()


def uv_unwrap(ob, margin=0.004):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    me = ob.data
    uv = me.uv_layers.new(name='bake')
    me.uv_layers.active = uv
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=margin, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    return uv


def bake(ob, size, kind, samples, path):
    """Bake into a new image (via an active image node in every material of `ob`), save it, return it.
    size = edge length or (width, height)."""
    w, h = size if isinstance(size, tuple) else (size, size)
    img = bpy.data.images.new(f'{ob.name}_{kind}', w, h, alpha=False, float_buffer=kind == 'COMBINED')
    for slot in ob.material_slots:
        m = slot.material
        nt = m.node_tree
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        n.name = '__bake__'
        nt.nodes.active = n
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = True
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    if kind == 'DIFFUSE':
        sc.render.bake.use_pass_direct = False
        sc.render.bake.use_pass_indirect = False
        sc.render.bake.use_pass_color = True
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'})
    else:
        bpy.ops.object.bake(type='COMBINED')
    # save display-referred (view transform applied) — three.js shows it as sRGB as is
    img.filepath_raw = path
    img.file_format = 'JPEG' if path.endswith('.jpg') else 'PNG'
    sc.render.image_settings.file_format = img.file_format
    sc.render.image_settings.quality = 92
    img.save_render(path, scene=sc)
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.get('__bake__')
        if n:
            nt.nodes.remove(n)
    return bpy.data.images.load(path)


def baked_material(name, img, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    t = m.node_tree.nodes.new('ShaderNodeTexImage')
    t.image = img
    m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def use_only_uv(ob, keep):
    me = ob.data
    for l in [l for l in me.uv_layers if l.name != keep]:
        me.uv_layers.remove(l)
    me.uv_layers[keep].name = 'UVMap'


def shrink_images(objs, max_size):
    """Source textures are 4K+; an object a few meters away needs far less."""
    seen = set()
    for o in objs:
        for s in o.material_slots:
            if not s.material or not s.material.use_nodes:
                continue
            for n in s.material.node_tree.nodes:
                im = getattr(n, 'image', None)
                if n.type != 'TEX_IMAGE' or not im or im.name in seen:
                    continue
                seen.add(im.name)
                w, h = im.size
                if max(w, h) > max_size:
                    f = max_size / max(w, h)
                    im.scale(max(1, round(w * f)), max(1, round(h * f)))


def export(path, selection=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in selection or meshes():
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_lights=False,
        export_cameras=False,
        export_image_format='AUTO',
        export_jpeg_quality=90,
        export_yup=True,
    )


# ------------------------------------------------------------------ environment: everything baked, shown unlit

def centre_x(o):
    xs = [v.co.x for v in o.data.vertices]
    return (min(xs) + max(xs)) / 2


def named(*prefixes, side=0):
    """Selector: objects whose base name is one of `prefixes` (side: −1 left / +1 right of the centre line)."""
    return lambda o: o.name.split('.')[0] in prefixes and (side == 0 or (centre_x(o) > 0) == (side > 0))


# Every indoor plate of scene.py as a room for the 3D player:
#   W, H     room width / height (m) · d0 floor start (y) · back = inner face of the back wall (y)
#   groups   part → (selector, texture size (w, h), uv projection, clip to the room?)
#            top: floor seen from above · yz / xz: a wall seen face-on · smart: many small parts
# The bounds must match ENV3D in src/stage3d/types.ts.
HALL_GROUPS = [
    ('floor', named('floor'), (4096, 8192), 'top', True),
    ('wall_l', named('side_wall', side=-1), (8192, 1536), 'yz', True),
    ('wall_r', named('side_wall', side=1), (8192, 1536), 'yz', True),
    ('wall_back', named('back_wall'), (4096, 1536), 'xz', True),
    ('details', named('column', 'kick', 'berm', 'baffle'), (4096, 4096), 'smart', False),
    ('ceiling', named('ceiling', 'truss', 'housing', 'fixture'), (2048, 2048), 'smart', True),
]
ROOMS = {
    'indoor_01': dict(W=16.0, H=6.0, d0=-6.0, back=28.0, groups=HALL_GROUPS),
    'indoor_02': dict(W=16.0, H=6.0, d0=-6.0, back=28.0, groups=HALL_GROUPS),
    # long bright lane: white tiles, LED strips, teal / white baffles at the end
    'indoor_03': dict(W=8.0, H=3.6, d0=-4.0, back=34.6, groups=[
        ('floor', named('floor'), (2048, 8192), 'top', True),
        ('wall_l', named('wall', side=-1), (8192, 1024), 'yz', True),
        ('wall_r', named('wall', side=1), (8192, 1024), 'yz', True),
        ('backstop', named('backwall', 'baffle', 'trap', 'header'), (2048, 2048), 'smart', False),
        ('ceiling', named('ceiling', 'strip'), (4096, 4096), 'smart', True),
    ]),
    # light concrete floor, dark walls, bright ceiling with beams and spots
    'indoor_04': dict(W=14.0, H=4.6, d0=-4.0, back=32.0, groups=[
        ('floor', named('floor'), (4096, 8192), 'top', True),
        ('wall_l', named('wall', side=-1), (8192, 1536), 'yz', True),
        ('wall_r', named('wall', side=1), (8192, 1536), 'yz', True),
        ('wall_back', named('back'), (4096, 1536), 'xz', True),
        ('ceiling', named('ceiling', 'beam', 'spot'), (4096, 4096), 'smart', True),
    ]),
}


def keep_inner_faces(ob, centre, half_w):
    """The hall is built from boxes; only faces looking into the room are ever seen — drop the rest,
    so the texture is spent where the camera looks."""
    import bmesh
    from mathutils import Vector

    bm = bmesh.new()
    bm.from_mesh(ob.data)
    c = Vector(centre)
    drop = [f for f in bm.faces if f.normal.dot(c - f.calc_center_median()) < -1e-4 or abs(f.calc_center_median().x) > half_w + 0.3]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bm.to_mesh(ob.data)
    bm.free()


def clip_to_room(ob, half_w, d0, back):
    """Floors, walls and ceilings are longer / wider than the room: pull them in to its walls
    (materials are object-space projected, so moving vertices does not move the texture)."""
    for v in ob.data.vertices:
        v.co.x = max(-half_w, min(half_w, v.co.x))
        v.co.y = max(d0, min(back, v.co.y))


def uv_planar(ob, axes):
    """Straight projection along two axes, filling the whole texture: one big rectangle
    (floor 'xy', side wall 'yz', back wall 'xz') gets every texel."""
    me = ob.data
    uv = me.uv_layers.new(name='bake')
    a, b = ('xyz'.index(axes[0]), 'xyz'.index(axes[1]))
    us = [v.co[a] for v in me.vertices]
    vs = [v.co[b] for v in me.vertices]
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    for lp in me.loops:
        co = me.vertices[lp.vertex_index].co
        uv.data[lp.index].uv = ((co[a] - u0) / (u1 - u0), (co[b] - v0) / (v1 - v0))
    me.uv_layers.active = uv
    return uv


def export_env(pid):
    room = ROOMS[pid]
    S.reset()
    S.make_materials()
    S.PLATES[pid]()
    # spent brass: thousands of tiny UV islands for nothing — the 3D player does not need it
    for o in [o for o in meshes() if o.name.startswith('case')]:
        bpy.data.objects.remove(o)
    apply_all()
    W, H, d0, back = room['W'], room['H'], room['d0'], room['back']
    centre = (0.0, (d0 + back) / 2, H / 2)
    parts = []
    for name, select, size, mode, clip in room['groups']:
        objs = [o for o in meshes() if o not in parts and select(o)]
        if not objs:
            continue
        ob = join(objs, name)
        make_single_user(ob)
        if clip:
            clip_to_room(ob, W / 2, d0, back)
        if name != 'floor':
            keep_inner_faces(ob, centre, W / 2)
        if mode == 'top':
            uv_planar(ob, 'xy')
        elif mode in ('yz', 'xz'):
            uv_planar(ob, mode)
        else:
            uv_unwrap(ob, margin=0.002 if max(size) >= 4096 else 0.004)
        print(f'baking {pid}/{name} {size[0]}x{size[1]} …', flush=True)
        img = bake(ob, size, 'COMBINED', ENV_SAMPLES, os.path.join(BAKE_DIR, f'env_{pid}_{name}.jpg'))
        ob.data.materials.clear()
        ob.data.materials.append(baked_material(f'baked_{name}', img, rough=1.0))
        use_only_uv(ob, 'bake')
        parts.append(ob)
    # floor joints: thin lines with a plain colour, not worth a texture
    joints = [o for o in meshes() if o.name.split('.')[0].startswith('joint')]
    for o in joints:
        clip_to_room(o, W / 2, d0, back)
    if joints:
        parts.append(join(joints, 'joints'))
    # anything left (lights are not meshes) is dropped
    for o in [o for o in meshes() if o not in parts]:
        bpy.data.objects.remove(o)
    export(os.path.join(OUT_DIR, f'env_{pid}.glb'), parts)


# ------------------------------------------------------------------ objects: procedural parts baked to albedo, lit live


def export_obj(sid):
    S.reset()
    S.make_materials()
    S.BUILDERS[sid][0]()
    apply_all()
    to_bake = [o for o in meshes() if any(needs_bake(s.material) for s in o.material_slots)]
    keep = [o for o in meshes() if o not in to_bake]
    out = list(keep)
    if to_bake:
        ob = join(to_bake, f'{sid}_body')
        make_single_user(ob)
        uv_unwrap(ob)
        img = bake(ob, 1024, 'DIFFUSE', 4, os.path.join(BAKE_DIR, f'obj_{sid}_albedo.jpg'))
        metal = sum(s.material.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value for s in ob.material_slots) / max(1, len(ob.material_slots))
        ob.data.materials.clear()
        ob.data.materials.append(baked_material(f'{sid}_baked', img, rough=0.55, metal=min(0.6, metal)))
        use_only_uv(ob, 'bake')
        out.append(ob)
    shrink_images(out, 1024)
    export(os.path.join(OUT_DIR, f'obj_{sid}.glb'), out)


for job in JOBS:
    kind, name = job.split(':', 1)
    if kind == 'env':
        export_env(name)
    elif kind == 'obj':
        export_obj(name)
    print('EXPORTED', job, flush=True)
