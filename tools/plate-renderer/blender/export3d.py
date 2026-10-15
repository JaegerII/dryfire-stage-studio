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


# ------------------------------------------------------------------ outdoor ranges: ground rendered from above, sky as a panorama
#
# Millions of grass blades, a 4 km ground plane and an 8K HDRI cannot be baked onto surfaces. Instead:
#   ground   rendered straight down with an orthographic Cycles camera (grass, berm shadows and all) and used
#            as the texture of flat ground planes + the berm meshes (heightfields: planar top-down UVs).
#            near = the bay at full detail, mid / far = rings around it at lower resolution, out to the
#            plates' ground plane where it meets the horizon.
#   sky      the world alone as an equirect panorama (sky_<id>.jpg), tone-mapped like the plates,
#            turned so that the image centre is +X (three.js' equirect convention) — no rotation needed there.
#   shelter  outdoor_04's covered firing line: baked like a hall (COMBINED), shown unlit.
# The bounds of the bay (where stages are built) are in ENV3D in src/stage3d/types.ts.
OUTDOOR = {
    'outdoor_01': dict(near=(-28, 28, -10, 26)),
    'outdoor_02': dict(near=(-28, 28, -10, 26)),
    'outdoor_03': dict(near=(-36, 36, -12, 36)),
    'outdoor_04': dict(near=(-32, 32, -10, 40), structures=('roof', 'fascia', 'post', 'bench')),
}
# From eye height (the plates) grass blades are seen side-on, sunlit, with a sky sheen; from straight above
# the camera looks into the darker turf. Grass colour × these gains (and no root darkening) gives the ground
# from above the plate's colour — measured with blender/calibrate_grass.py (… <plate> <env> <gain> 1.0)
# for the lawns of 03 / 04; 01 / 02 are gravel (already matching) with grass tufts: a moderate gain.
GRASS_GAIN = {
    'outdoor_01': (1.5, 1.5, 1.8),
    'outdoor_02': (1.5, 1.5, 1.8),
    'outdoor_03': (2.06, 1.92, 2.8),
    'outdoor_04': (1.55, 1.5, 2.24),
}
MID = (-210, 210, -195, 225)
FAR = (-2000, 2000, -2000, 3950)
OUTDOOR_SAMPLES = int(os.environ.get('OUTDOOR_SAMPLES', '256'))


def base_name(o):
    return o.name.split('.')[0]


TILE = 2048  # a whole 8K frame does not fit the 6 GB GPU next to the grass: render in tiles …
OVERLAP = 48  # … each with a margin that is cropped away again (pixel filter, adaptive sampling): no seams


def render_rect(rect, rx, ry, path, samples):
    """One orthographic render straight down onto `rect` (x0, x1, y0, y1 m) at rx × ry pixels."""
    sc = bpy.context.scene
    x0, x1, y0, y1 = rect
    camd = bpy.data.cameras.new('top')
    cam = S.link(bpy.data.objects.new('top', camd))
    cam.location = ((x0 + x1) / 2, (y0 + y1) / 2, 300)
    camd.type = 'ORTHO'
    camd.ortho_scale = max(x1 - x0, y1 - y0)
    camd.sensor_fit = 'AUTO'
    camd.clip_start = 1
    camd.clip_end = 400
    sc.camera = cam
    sc.render.resolution_x = rx
    sc.render.resolution_y = ry
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    # tiles of one ground share the scene: keep the (grass) BVH between them
    sc.render.use_persistent_data = True
    sc.cycles.samples = samples
    # no denoiser: next to millions of grass blades it runs out of memory (GPU and host), and at these
    # samples the remaining noise is finer than the grass itself
    sc.cycles.use_denoising = False
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.quality = 94
    sc.render.filepath = path
    print(f'rendering {os.path.basename(path)} {rx}x{ry} …', flush=True)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)


def render_top(rect, px, path, samples):
    """The ground of `rect` from straight above; px = pixels along the longer side. Returns the image."""
    import numpy as np
    x0, x1, y0, y1 = rect
    mpp = max(x1 - x0, y1 - y0) / px
    W, H = round((x1 - x0) / mpp), round((y1 - y0) / mpp)
    nx, ny = math.ceil(W / TILE), math.ceil(H / TILE)
    if nx * ny == 1:
        render_rect(rect, W, H, path, samples)
        return bpy.data.images.load(path)
    out = np.zeros((H, W, 4), dtype=np.float32)
    for i in range(nx):
        for j in range(ny):
            # pixel columns a, rows b (from the bottom = y0) of this tile, with and without its margin
            a0, a1, b0, b1 = i * W // nx, (i + 1) * W // nx, j * H // ny, (j + 1) * H // ny
            pa0, pa1, pb0, pb1 = max(0, a0 - OVERLAP), min(W, a1 + OVERLAP), max(0, b0 - OVERLAP), min(H, b1 + OVERLAP)
            tile = path.replace('.jpg', f'_{i}{j}.jpg')
            render_rect((x0 + pa0 * mpp, x0 + pa1 * mpp, y0 + pb0 * mpp, y0 + pb1 * mpp), pa1 - pa0, pb1 - pb0, tile, samples)
            im = bpy.data.images.load(tile)
            px_ = np.empty((pb1 - pb0) * (pa1 - pa0) * 4, dtype=np.float32)
            im.pixels.foreach_get(px_)
            out[b0:b1, a0:a1] = px_.reshape(pb1 - pb0, pa1 - pa0, 4)[b0 - pb0:b1 - pb0, a0 - pa0:a1 - pa0]
            bpy.data.images.remove(im)
            os.remove(tile)
    # the tiles are display-referred already: store the bytes as they are (no second view transform)
    img = bpy.data.images.new(os.path.basename(path), W, H, alpha=False)
    img.pixels.foreach_set(out.ravel())
    img.filepath_raw = path
    img.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.quality = 94
    img.save()
    bpy.data.images.remove(img)
    return bpy.data.images.load(path)


def sky_panorama(path, size=(4096, 2048)):
    """The world (HDRI × strength, turned as in the plates) as an equirect JPG, view transform applied."""
    import numpy as np
    sc = bpy.context.scene
    nt = sc.world.node_tree
    env = next(n for n in nt.nodes if n.type == 'TEX_ENVIRONMENT')
    rot = next(n for n in nt.nodes if n.type == 'MAPPING').inputs['Rotation'].default_value[2]
    strength = next(n for n in nt.nodes if n.type == 'BACKGROUND').inputs['Strength'].default_value
    W, H = size
    im = bpy.data.images.load(bpy.path.abspath(env.image.filepath), check_existing=False)
    im.scale(W, H)
    px = np.empty(W * H * 4, dtype=np.float32)
    im.pixels.foreach_get(px)
    px = px.reshape(H, W, 4)
    # the mapping node looks the HDRI up at R(rot)·dir: in u that is a shift by rot / 2pi
    px = np.roll(px, round(rot / (2 * math.pi) * W), axis=1)
    px[:, :, :3] *= strength
    out = bpy.data.images.new('sky', W, H, alpha=False, float_buffer=True)
    out.pixels.foreach_set(px.ravel())
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.quality = 90
    out.save_render(path, scene=sc)


def ground_mesh(name, outer, hole, img):
    """Flat ground over `outer` without `hole` (the next finer level), UVs spanning `outer` = its top-down render."""
    import bmesh
    x0, x1, y0, y1 = outer
    rects = [outer] if hole is None else [
        (x0, x1, y0, hole[2]), (x0, x1, hole[3], y1), (x0, hole[0], hole[2], hole[3]), (hole[1], x1, hole[2], hole[3])]
    bm = bmesh.new()
    for a, b, c, d in rects:
        bm.faces.new([bm.verts.new((x, y, 0)) for x, y in ((a, c), (b, c), (b, d), (a, d))])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = S.link(bpy.data.objects.new(name, me))
    uv_rect(ob, outer)
    ob.data.materials.append(baked_material(f'baked_{name}', img, rough=1.0))
    return ob


def uv_rect(ob, rect):
    """Top-down UVs: (x, y) inside `rect` → (0..1, 0..1), as the orthographic render sees it."""
    x0, x1, y0, y1 = rect
    me = ob.data
    uv = me.uv_layers.new(name='bake')
    for lp in me.loops:
        co = me.vertices[lp.vertex_index].co
        uv.data[lp.index].uv = ((co.x - x0) / (x1 - x0), (co.y - y0) / (y1 - y0))
    use_only_uv(ob, 'bake')


def apply_transforms(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def refine_grass(cuts=3):
    """The plates' grass emitters have ~0.5 m faces and Blender weights the blade count per face: fine from
    eye height, a checkerboard of grass patches from above. Subdivide the emitters for the renders from
    above and redo the density map. Returns the original meshes (the berms are exported with those)."""
    import bmesh
    keep = {}
    for o in meshes():
        if 'grass_patchy' not in o or not o.particle_systems:
            continue
        keep[o.name] = o.data.copy()
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
        bm.to_mesh(o.data)
        bm.free()
        if o['grass_patchy'] > 0:
            S.grass_density(o, o['grass_patchy'], o['grass_seed'])
    return keep


def grass_gain(gain):
    """Grass as seen from above: no darkening towards the root, colour × gain (per channel) — see GRASS_GAIN."""
    for m in bpy.data.materials:
        if not m.use_nodes or not any(n.type == 'HAIR_INFO' for n in m.node_tree.nodes):
            continue
        nt = m.node_tree
        for n in nt.nodes:
            if n.type == 'MAP_RANGE' and n.inputs['Value'].is_linked and n.inputs['Value'].links[0].from_node.type == 'HAIR_INFO':
                n.inputs['To Min'].default_value = 1.0
        b = nt.nodes['Principled BSDF']
        g = nt.nodes.new('ShaderNodeMix')
        g.data_type = 'RGBA'
        g.blend_type = 'MULTIPLY'
        g.inputs['Factor'].default_value = 1.0
        nt.links.new(b.inputs['Base Color'].links[0].from_socket, g.inputs['A'])
        g.inputs['B'].default_value = (*gain, 1.0)
        nt.links.new(g.outputs['Result'], b.inputs['Base Color'])


def export_outdoor(pid):
    cfg = OUTDOOR[pid]
    S.reset()
    S.make_materials()
    S.PLATES[pid]()
    # the plates' ground ends 50 m behind the camera: the 3D camera may look back
    g = bpy.data.objects['ground']
    # (the material is object-space projected: moving vertices does not move the texture)
    for v in g.data.vertices:
        if (g.matrix_world @ v.co).y < 0:
            v.co.y = FAR[2] - g.location.y

    sky_panorama(os.path.join(OUT_DIR, f'sky_{pid}.jpg'))
    az, v = S.hdri_sun_azimuth(bpy.path.abspath(next(n for n in bpy.context.scene.world.node_tree.nodes if n.type == 'TEX_ENVIRONMENT').image.filepath))
    rot = next(n for n in bpy.context.scene.world.node_tree.nodes if n.type == 'MAPPING').inputs['Rotation'].default_value[2]
    print(f'{pid}: brightest spot at azimuth {math.degrees(az - rot):.1f}°, elevation {(v - 0.5) * 180:.1f}°', flush=True)

    # from straight above a blade is a few pixels: flat ribbons with fewer segments are plenty and
    # keep millions of blades within the GPU's memory
    bpy.context.scene.cycles_curves.shape = 'RIBBONS'
    for ps in bpy.data.particles:
        ps.render_step = 2

    berms = [o for o in meshes() if any(s.material and base_name(s.material) == 'berm' for s in o.material_slots)]
    structures = [o for o in meshes() if base_name(o) in cfg.get('structures', ())]
    apply_transforms(berms + structures)
    originals = refine_grass()
    grass_gain(GRASS_GAIN[pid])

    # ground from above: the shelter stays out of the picture (it is exported as geometry) but casts its shadow
    for o in structures:
        o.visible_camera = False
    near = cfg['near']
    imgs = {
        'near': render_top(near, 8192, os.path.join(BAKE_DIR, f'env_{pid}_near.jpg'), OUTDOOR_SAMPLES),
        'mid': render_top(MID, 4096, os.path.join(BAKE_DIR, f'env_{pid}_mid.jpg'), max(32, OUTDOOR_SAMPLES // 4)),
        'far': render_top(FAR, 3072, os.path.join(BAKE_DIR, f'env_{pid}_far.jpg'), max(32, OUTDOOR_SAMPLES // 4)),
    }
    for o in structures:
        o.visible_camera = True

    parts = []
    if structures:
        ob = join(structures, 'shelter')
        make_single_user(ob)
        uv_unwrap(ob, margin=0.002)
        print(f'baking {pid}/shelter …', flush=True)
        img = bake(ob, (4096, 2048), 'COMBINED', ENV_SAMPLES, os.path.join(BAKE_DIR, f'env_{pid}_shelter.jpg'))
        ob.data.materials.clear()
        ob.data.materials.append(baked_material('baked_shelter', img, rough=1.0))
        use_only_uv(ob, 'bake')
        parts.append(ob)

    # berms: heightfields, textured straight from the near render (exported with their own, coarser mesh)
    for o in berms:
        for m in list(o.modifiers):
            o.modifiers.remove(m)
        o.data = originals.get(o.name, o.data)
    if berms:
        ob = join(berms, 'berms')
        ob.data.materials.clear()
        ob.data.materials.append(baked_material('baked_berms', imgs['near'], rough=1.0))
        uv_rect(ob, near)
        parts.append(ob)

    parts += [
        ground_mesh('ground_near', near, None, imgs['near']),
        ground_mesh('ground_mid', MID, near, imgs['mid']),
        ground_mesh('ground_far', FAR, MID, imgs['far']),
    ]
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
    if kind == 'env' and name in OUTDOOR:
        export_outdoor(name)
    elif kind == 'env':
        export_env(name)
    elif kind == 'obj':
        export_obj(name)
    print('EXPORTED', job, flush=True)
