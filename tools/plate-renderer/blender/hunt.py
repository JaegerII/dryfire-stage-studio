"""
Driven hunt (Drueckjagd) scenes for DRYFIRE STAGE STUDIO: a forest lane seen from a driven-hunt stand,
game crossing it. Prototype: autumn beech forest, gravel track, one boar trotting across.

  blender -b --factory-startup --python blender/hunt.py -- <job> <outdir> [key=value ...]

  job = preview   one frame with everything in it (quick look at the composition)
        plate     the empty lane, full frame - static camera, rendered once per lane
        game      the crossing: every frame cropped to the animal (+ shadow), pasted onto the plate
                  by scripts/hunt-compose.py
  keys: w h samples fps seconds frame (preview) start end (game)

Plate and game crops use the same samples / seed / denoiser / motion blur, so every pixel the animal
does not touch comes out of the crop identical to the plate; only the crop's denoised border differs,
and the compose step feathers that away.

Axes: X right, Y down the lane, Z up. Units: meters. Assets: scripts/fetch-forest.mjs (Poly Haven, CC0).
"""
import json
import math
import os
import random
import sys

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector, noise

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
# scene.py parses its own job arguments at import time: hide ours from it
sys.argv = sys.argv[:sys.argv.index('--')] if '--' in sys.argv else sys.argv
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scene as S  # noqa: E402

JOB = argv[0] if argv else 'preview'
OUTDIR = os.path.abspath(argv[1] if len(argv) > 1 else os.path.join(S.HERE, '..', 'out', 'hunt'))
OPT = dict(a.split('=', 1) for a in argv[2:])
W = int(OPT.get('w', 1920))
H = int(OPT.get('h', 1080))
SAMPLES = int(OPT.get('samples', 256))
FPS = int(OPT.get('fps', 30))
SECONDS = float(OPT.get('seconds', 10))
FOREST = os.path.join(S.TEX, 'forest')

hex_rgba = S.hex_rgba

# ------------------------------------------------------------------ lane layout

CAM = Vector((-6.5, 0.0, 3.3))     # eye on the stand, at the left edge of the lane
AIM = Vector((0.0, 35.0, 0.6))
FOCUS = 35.0
# horizontal field of view, deg: 16:9 -> stand 1.3 x the screen width away for 1:1 angles; 9:16 shorts are
# narrower (the same 42 deg would make the frame mostly sky and leaf litter)
HFOV = 42.0 if W >= H else 30.0
FOG_D = 420.0                       # m, haze: 1 - exp(-d / FOG_D)
FOG_COL = '#b4b6ae'
CROSS_Y = 35.0                      # where the boar crosses the lane


def lane_x(y):
    """Centre line of the lane; it bends away to the right in the distance like the reference photo."""
    return 0.0005 * max(0.0, y - 30.0) ** 2


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def ground_z(x, y):
    d = abs(x - lane_x(y))
    n = noise.noise(Vector((x / 30, y / 30, 0.3))) * 0.7 + noise.noise(Vector((x / 8, y / 8, 1.7))) * 0.12
    return n * smoothstep(4.5, 10.0, d)


# ------------------------------------------------------------------ materials


def img(path, non_color=False):
    im = bpy.data.images.load(path, check_existing=True)
    if non_color:
        im.colorspace_settings.name = 'Non-Color'
    return im


def fogify(m):
    """Camera rays only: blend the surface into the haze colour by distance."""
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    out = next(n for n in N if n.type == 'OUTPUT_MATERIAL')
    surf = out.inputs['Surface'].links[0].from_socket
    cam = N.new('ShaderNodeCameraData')
    lp = N.new('ShaderNodeLightPath')
    k = N.new('ShaderNodeMath')
    k.operation = 'MULTIPLY'
    k.inputs[1].default_value = -1.0 / FOG_D
    L.new(cam.outputs['View Distance'], k.inputs[0])
    e = N.new('ShaderNodeMath')
    e.operation = 'EXPONENT'
    L.new(k.outputs[0], e.inputs[0])
    f = N.new('ShaderNodeMath')
    f.operation = 'SUBTRACT'
    f.inputs[0].default_value = 1.0
    L.new(e.outputs[0], f.inputs[1])
    g = N.new('ShaderNodeMath')
    g.operation = 'MULTIPLY'
    L.new(f.outputs[0], g.inputs[0])
    L.new(lp.outputs['Is Camera Ray'], g.inputs[1])
    em = N.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = hex_rgba(FOG_COL)
    em.inputs['Strength'].default_value = FOG_STRENGTH
    mix = N.new('ShaderNodeMixShader')
    L.new(g.outputs[0], mix.inputs['Fac'])
    L.new(surf, mix.inputs[1])
    L.new(em.outputs[0], mix.inputs[2])
    L.new(mix.outputs[0], out.inputs['Surface'])
    return m


FOG_STRENGTH = 0.55   # haze brightness: about the brightness of the overcast sky seen between the trunks


def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree.nodes, m.node_tree.links, m.node_tree.nodes['Principled BSDF']


def tex_node(N, L, vec, path, non_color=False):
    t = N.new('ShaderNodeTexImage')
    t.image = img(path, non_color)
    L.new(vec, t.inputs['Vector'])
    return t


def forest_maps(tid):
    return [os.path.join(FOREST, tid, f'{tid}_{k}.jpg') for k in ('diff', 'nor_gl', 'rough')]


def ground_material():
    """Leaf litter in the forest, moss + leaves on the verges, light gravel on the track (with a mossy
    centre strip), all keyed off the distance to the lane's centre line."""
    m, N, L, b = new_mat('ground')
    geo = N.new('ShaderNodeNewGeometry')
    sep = N.new('ShaderNodeSeparateXYZ')
    L.new(geo.outputs['Position'], sep.inputs[0])

    def math(op, a, bb=None, clamp=False):
        n = N.new('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        for i, v in enumerate((a, bb)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L.new(v, n.inputs[i])
        return n.outputs[0]

    t = math('MAXIMUM', math('SUBTRACT', sep.outputs['Y'], 30.0), 0.0)
    xc = math('MULTIPLY', math('MULTIPLY', t, t), 0.0005)
    d = math('ABSOLUTE', math('SUBTRACT', sep.outputs['X'], xc))
    wn = N.new('ShaderNodeTexNoise')
    wn.inputs['Scale'].default_value = 0.35
    wn.inputs['Detail'].default_value = 4
    L.new(geo.outputs['Position'], wn.inputs['Vector'])
    d = math('ADD', d, math('MULTIPLY', math('SUBTRACT', wn.outputs['Fac'], 0.5), 0.8))

    def band(e0, e1):
        mr = N.new('ShaderNodeMapRange')
        mr.interpolation_type = 'SMOOTHSTEP'
        mr.inputs['From Min'].default_value = e0
        mr.inputs['From Max'].default_value = e1
        mr.inputs['To Min'].default_value = 1.0
        mr.inputs['To Max'].default_value = 0.0
        L.new(d, mr.inputs['Value'])
        return mr.outputs['Result']

    road = band(1.35, 1.75)
    centre = band(0.2, 0.45)
    verge = band(3.8, 5.6)

    def uv(tile, off=0.0):
        mp = N.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1)
        mp.inputs['Location'].default_value = (off, off * 0.7, 0)
        L.new(geo.outputs['Position'], mp.inputs['Vector'])
        return mp.outputs['Vector']

    layers = {}
    for key, tid, tile, sat, val, tint in (
        ('litter', 'dry_decay_leaves', 2.2, 1.0, 1.05, '#ffffff'),
        ('moss', 'forest_leaves_02', 2.6, 0.85, 0.95, '#ffffff'),
        ('gravel', 'stony_dirt_path', 2.8, 0.15, 2.1, '#efe2cc'),
    ):
        dp, np_, rp = forest_maps(tid)
        v = uv(tile, len(layers) * 0.37)
        c = tex_node(N, L, v, dp)
        hs = N.new('ShaderNodeHueSaturation')
        hs.inputs['Saturation'].default_value = sat
        hs.inputs['Value'].default_value = val
        L.new(c.outputs['Color'], hs.inputs['Color'])
        tm = N.new('ShaderNodeMix')
        tm.data_type = 'RGBA'
        tm.blend_type = 'MULTIPLY'
        tm.inputs['Factor'].default_value = 1.0
        L.new(hs.outputs['Color'], tm.inputs['A'])
        tm.inputs['B'].default_value = hex_rgba(tint)
        layers[key] = (tm.outputs['Result'], tex_node(N, L, v, np_, True).outputs['Color'],
                       tex_node(N, L, v, rp, True).outputs['Color'])

    def mix(fac, a, bb):
        n = N.new('ShaderNodeMix')
        n.data_type = 'RGBA'
        L.new(fac, n.inputs['Factor'])
        L.new(a, n.inputs['A'])
        L.new(bb, n.inputs['B'])
        return n.outputs['Result']

    # leaves blown onto the verge and track: patchy noise
    ln = N.new('ShaderNodeTexNoise')
    ln.inputs['Scale'].default_value = 1.3
    ln.inputs['Detail'].default_value = 6
    L.new(geo.outputs['Position'], ln.inputs['Vector'])
    lr = N.new('ShaderNodeMapRange')
    lr.inputs['From Min'].default_value = 0.45
    lr.inputs['From Max'].default_value = 0.65
    L.new(ln.outputs['Fac'], lr.inputs['Value'])
    leafy = lr.outputs['Result']

    out = []
    for i in range(3):
        verge_mat = mix(leafy, layers['moss'][i], layers['litter'][i])
        v = mix(verge, layers['litter'][i], verge_mat)
        track = mix(centre, layers['gravel'][i], verge_mat)
        track = mix(math('MULTIPLY', leafy, 0.35), track, layers['litter'][i])
        out.append(mix(road, v, track))

    # large, soft brightness variation so the tiling never shows
    big = N.new('ShaderNodeTexNoise')
    big.inputs['Scale'].default_value = 0.04
    big.inputs['Detail'].default_value = 3
    L.new(geo.outputs['Position'], big.inputs['Vector'])
    br = N.new('ShaderNodeMapRange')
    br.inputs['From Min'].default_value = 0.3
    br.inputs['From Max'].default_value = 0.7
    br.inputs['To Min'].default_value = 0.72
    br.inputs['To Max'].default_value = 1.1
    L.new(big.outputs['Fac'], br.inputs['Value'])
    mul = N.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    L.new(out[0], mul.inputs['A'])
    gray = N.new('ShaderNodeCombineColor')
    for ch in ('Red', 'Green', 'Blue'):
        L.new(br.outputs['Result'], gray.inputs[ch])
    L.new(gray.outputs['Color'], mul.inputs['B'])
    L.new(mul.outputs['Result'], b.inputs['Base Color'])
    nm = N.new('ShaderNodeNormalMap')
    nm.inputs['Strength'].default_value = 1.0
    L.new(out[1], nm.inputs['Color'])
    L.new(nm.outputs['Normal'], b.inputs['Normal'])
    L.new(out[2], b.inputs['Roughness'])
    return fogify(m)


def bark_material():
    """Beech: smooth silver-grey bark (a smooth bark photo, desaturated), green algae low on the trunk."""
    m, N, L, b = new_mat('beech_bark')
    tc = N.new('ShaderNodeTexCoord')
    mp = N.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1.2, 1.2, 0.6)
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    dp, np_, rp = forest_maps('trident_maple_bark')

    def t(p, nc):
        n = tex_node(N, L, mp.outputs['Vector'], p, nc)
        n.projection = 'BOX'
        n.projection_blend = 0.3
        return n
    c = t(dp, False)
    hs = N.new('ShaderNodeHueSaturation')
    hs.inputs['Saturation'].default_value = 0.22
    hs.inputs['Value'].default_value = 3.0
    L.new(c.outputs['Color'], hs.inputs['Color'])
    # algae: noise, strongest near the foot of the trunk
    nz = N.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 1.6
    nz.inputs['Detail'].default_value = 5
    L.new(tc.outputs['Object'], nz.inputs['Vector'])
    sep = N.new('ShaderNodeSeparateXYZ')
    L.new(tc.outputs['Object'], sep.inputs[0])
    hz = N.new('ShaderNodeMapRange')
    hz.inputs['From Min'].default_value = 0.0
    hz.inputs['From Max'].default_value = 6.0
    hz.inputs['To Min'].default_value = 0.75
    hz.inputs['To Max'].default_value = 0.1
    L.new(sep.outputs['Z'], hz.inputs['Value'])
    am = N.new('ShaderNodeMath')
    am.operation = 'MULTIPLY'
    am.use_clamp = True
    L.new(nz.outputs['Fac'], am.inputs[0])
    L.new(hz.outputs['Result'], am.inputs[1])
    mx = N.new('ShaderNodeMix')
    mx.data_type = 'RGBA'
    L.new(am.outputs[0], mx.inputs['Factor'])
    L.new(hs.outputs['Color'], mx.inputs['A'])
    mx.inputs['B'].default_value = hex_rgba('#4e5a34')
    L.new(mx.outputs['Result'], b.inputs['Base Color'])
    nm = N.new('ShaderNodeNormalMap')
    nm.inputs['Strength'].default_value = 0.8
    L.new(t(np_, True).outputs['Color'], nm.inputs['Color'])
    L.new(nm.outputs['Normal'], b.inputs['Normal'])
    L.new(t(rp, True).outputs['Color'], b.inputs['Roughness'])
    return fogify(m)


def leaf_material():
    m, N, L, b = new_mat('beech_leaves')
    a = N.new('ShaderNodeAttribute')
    a.attribute_name = 'Col'
    L.new(a.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.6
    tr = N.new('ShaderNodeBsdfTranslucent')
    L.new(a.outputs['Color'], tr.inputs['Color'])
    mix = N.new('ShaderNodeMixShader')
    mix.inputs['Fac'].default_value = 0.3
    out = N['Material Output']
    L.new(b.outputs[0], mix.inputs[1])
    L.new(tr.outputs[0], mix.inputs[2])
    L.new(mix.outputs[0], out.inputs['Surface'])
    return fogify(m)


def plain(name, color, rough=0.6):
    m, N, L, b = new_mat(name)
    b.inputs['Base Color'].default_value = hex_rgba(color)
    b.inputs['Roughness'].default_value = rough
    return fogify(m)


def world(hdri='autumn_forest_02', strength=1.0, rotation=0.0, sky_fog=0.2):
    w = bpy.data.worlds.new('World')
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    N, L = nt.nodes, nt.links
    N.clear()
    tc = N.new('ShaderNodeTexCoord')
    mp = N.new('ShaderNodeMapping')
    mp.inputs['Rotation'].default_value[2] = rotation
    env = N.new('ShaderNodeTexEnvironment')
    env.image = img(os.path.join(FOREST, f'{hdri}.hdr'))
    bg = N.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    fog = N.new('ShaderNodeBackground')
    fog.inputs['Color'].default_value = hex_rgba(FOG_COL)
    fog.inputs['Strength'].default_value = FOG_STRENGTH
    lp = N.new('ShaderNodeLightPath')
    k = N.new('ShaderNodeMath')
    k.operation = 'MULTIPLY'
    k.inputs[1].default_value = sky_fog
    L.new(lp.outputs['Is Camera Ray'], k.inputs[0])
    mix = N.new('ShaderNodeMixShader')
    out = N.new('ShaderNodeOutputWorld')
    L.new(tc.outputs['Generated'], mp.inputs['Vector'])
    L.new(mp.outputs['Vector'], env.inputs['Vector'])
    L.new(env.outputs['Color'], bg.inputs['Color'])
    L.new(k.outputs[0], mix.inputs['Fac'])
    L.new(bg.outputs[0], mix.inputs[1])
    L.new(fog.outputs[0], mix.inputs[2])
    L.new(mix.outputs[0], out.inputs['Surface'])


# ------------------------------------------------------------------ geometry


def link(ob, coll=None):
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def mesh_from_bm(name, bm, mats, coll=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    return link(bpy.data.objects.new(name, me), coll)


def ground(mat):
    """Displaced grid, 1 m cells, over the whole forest block."""
    bm = bmesh.new()
    x0, x1, y0, y1, step = -120, 120, -30, 300, 1.0
    nx, ny = int((x1 - x0) / step) + 1, int((y1 - y0) / step) + 1
    vs = [[bm.verts.new((x0 + i * step, y0 + j * step, ground_z(x0 + i * step, y0 + j * step)))
           for i in range(nx)] for j in range(ny)]
    for j in range(ny - 1):
        for i in range(nx - 1):
            f = bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
            f.smooth = True
    return mesh_from_bm('ground', bm, [mat])


def tube(bm, pts, radii, sides):
    """Tapered tube along a polyline (open ends: they sit inside the parent branch / end in a point)."""
    rings = []
    up = Vector((0, 0, 1))
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        a = d.cross(up if abs(d.dot(up)) < 0.95 else Vector((1, 0, 0))).normalized()
        c = d.cross(a)
        rings.append([bm.verts.new(p + (a * math.cos(t) + c * math.sin(t)) * radii[i])
                      for t in (k * 2 * math.pi / sides for k in range(sides))])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(sides):
            f = bm.faces.new((r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k]))
            f.smooth = True


# beech autumn palette (sRGB) with weights: mostly orange-brown, some yellow, a little green left
LEAF_COLS = [('#b8642a', 5), ('#c97a35', 4), ('#9c4f26', 4), ('#7e4a22', 3), ('#d4a24c', 2),
             ('#a88a3a', 1), ('#7d7a34', 1)]
LEAF = [(0.0, 0.0), (0.22, 0.30), (0.62, 0.34), (1.0, 0.0), (0.62, -0.34), (0.22, -0.30)]


class Tree:
    """Recursive branch generator: wood tubes + flat leaf sprays (one ngon per leaf)."""

    def __init__(self, seed, leaf_size=0.085, spray=6, spacing=0.14, droop=(0.0, 0.03, 0.08, 0.12)):
        self.rng = random.Random(seed)
        self.wood = bmesh.new()
        self.leaves = bmesh.new()
        self.leaf_size, self.spray, self.spacing, self.droop = leaf_size, spray, spacing, droop
        self.cols = []
        palette = [c for c, w in LEAF_COLS for _ in range(w)]
        self.palette = [hex_rgba(c) for c in palette]

    def branch(self, p0, d, length, r0, level, maxlevel, sides=(10, 6, 5, 4)):
        rng = self.rng
        n = max(2, int(length / 0.5))
        pts, rad, dirs = [p0], [r0], [d]
        dv = d.normalized()
        for i in range(1, n + 1):
            dv = (dv + Vector((rng.gauss(0, 0.1), rng.gauss(0, 0.1), rng.gauss(0, 0.06) - self.droop[level]))).normalized()
            pts.append(pts[-1] + dv * (length / n))
            rad.append(max(0.004, r0 * (1 - 0.8 * i / n)))
            dirs.append(dv)
        tube(self.wood, pts, rad, sides[min(level, 3)])
        if level >= maxlevel:
            self.sprays(pts, dirs)
            return pts
        kids = max(1, int(length / (0.55 if level else 0.9)))
        for _ in range(kids):
            t = rng.uniform(0.25, 0.95)
            i = min(n - 1, int(t * n))
            base = pts[i].lerp(pts[i + 1], t * n - i)
            az = rng.uniform(0, 2 * math.pi)
            side = Vector((math.cos(az), math.sin(az), rng.uniform(-0.1, 0.5)))
            cd = (dirs[i] * 0.55 + side.normalized()).normalized()
            self.branch(base, cd, length * rng.uniform(0.3, 0.55), rad[i] * 0.55, level + 1, maxlevel)
        return pts

    def sprays(self, pts, dirs):
        """Beech sprays: flat, roughly horizontal fans of leaves along the outer part of each twig."""
        rng = self.rng
        total = sum((b - a).length for a, b in zip(pts, pts[1:]))
        s = total * 0.25
        while s < total:
            acc, i = 0.0, 0
            while i < len(pts) - 2 and acc + (pts[i + 1] - pts[i]).length < s:
                acc += (pts[i + 1] - pts[i]).length
                i += 1
            seg = pts[i + 1] - pts[i]
            p = pts[i] + seg.normalized() * (s - acc)
            nrm = Vector((rng.gauss(0, 0.35), rng.gauss(0, 0.35), 1.0)).normalized()
            for _ in range(self.spray):
                ax = (dirs[i] + Vector((rng.gauss(0, 0.8), rng.gauss(0, 0.8), 0))).normalized()
                ax = (ax - nrm * ax.dot(nrm)).normalized()
                side = nrm.cross(ax)
                size = self.leaf_size * rng.uniform(0.7, 1.25)
                c = p + ax * rng.uniform(0.0, 0.12) + side * rng.gauss(0, 0.04)
                vs = [self.leaves.verts.new(c + (ax * u + side * v) * size) for u, v in LEAF]
                self.leaves.faces.new(vs)
                col = list(rng.choice(self.palette))
                j = rng.uniform(0.8, 1.15)
                self.cols.append((col[0] * j, col[1] * j, col[2] * j, 1.0))
            s += self.spacing * rng.uniform(0.7, 1.3)

    def build(self, name, coll, bark, leafmat):
        wood = mesh_from_bm(name + '_wood', self.wood, [bark], coll)
        me = bpy.data.meshes.new(name + '_leaves')
        self.leaves.to_mesh(me)
        self.leaves.free()
        me.materials.append(leafmat)
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        k = 0
        for poly in me.polygons:
            for li in poly.loop_indices:
                ca.data[li].color = self.cols[k]
            k += 1
        link(bpy.data.objects.new(name + '_leaves', me), coll)
        return wood


def trunk(t, height, r0, lean):
    """Main stem: slightly leaning, gently wavy, tapered; returns its polyline."""
    rng = t.rng
    n = max(6, int(height / 1.5))
    pts, rad = [Vector((0, 0, -0.4))], [r0 * 1.25]
    d = Vector((lean[0], lean[1], 1)).normalized()
    for i in range(1, n + 1):
        d = (d + Vector((rng.gauss(0, 0.03), rng.gauss(0, 0.03), 0))).normalized()
        pts.append(pts[-1] + d * ((height + 0.4) / n))
        f = i / n
        rad.append(r0 * (1 - 0.88 * f) * (1.25 if i == 1 else 1.0))
    tube(t.wood, pts, rad, 14)
    return pts, rad


def big_beech(seed, coll, bark, leafmat):
    t = Tree(seed)
    rng = t.rng
    h = rng.uniform(24, 31)
    pts, rad = trunk(t, h, rng.uniform(0.17, 0.3), (rng.gauss(0, 0.03), rng.gauss(0, 0.03)))
    cs = rng.uniform(0.38, 0.5) * h
    for k in range(rng.randint(11, 16)):
        z = cs + (h * 0.97 - cs) * (k + rng.random()) / 14
        i = min(len(pts) - 2, int(z / (h / (len(pts) - 1))))
        az = k * 2.4 + rng.uniform(-0.4, 0.4)
        el = rng.uniform(0.6, 1.3)
        d = Vector((math.cos(az), math.sin(az), el)).normalized()
        L = (h - z) * rng.uniform(0.35, 0.6) + 1.5
        t.branch(pts[i], d, L, rad[i] * 0.45, 1, 3)
    # a few leafy shoots low on the stem (typical along a lane edge)
    for _ in range(rng.randint(0, 5)):
        z = rng.uniform(2.5, cs)
        i = min(len(pts) - 2, int(z / (h / (len(pts) - 1))))
        az = rng.uniform(0, 2 * math.pi)
        t.branch(pts[i], Vector((math.cos(az), math.sin(az), 0.3)), rng.uniform(0.6, 1.6), 0.015, 2, 3)
    return t.build(f'beech_{seed}', coll, bark, leafmat)


def pole_beech(seed, coll, bark, leafmat):
    """Pole stage (Stangenholz): thin stems, leafy from a few meters up - the orange mid layer."""
    t = Tree(seed, spray=8, spacing=0.09)
    rng = t.rng
    h = rng.uniform(6, 13)
    pts, rad = trunk(t, h, rng.uniform(0.04, 0.1), (rng.gauss(0, 0.05), rng.gauss(0, 0.05)))
    cs = rng.uniform(0.2, 0.4) * h
    for k in range(rng.randint(10, 16)):
        z = cs + (h * 0.97 - cs) * (k + rng.random()) / 14
        i = min(len(pts) - 2, int(z / (h / (len(pts) - 1))))
        az = k * 2.4 + rng.uniform(-0.5, 0.5)
        d = Vector((math.cos(az), math.sin(az), rng.uniform(0.1, 0.7))).normalized()
        t.branch(pts[i], d, (h - z) * rng.uniform(0.3, 0.5) + 0.8, max(0.012, rad[i] * 0.5), 2, 3)
    return t.build(f'pole_{seed}', coll, bark, leafmat)


def sapling(seed, coll, bark, leafmat):
    """Young beech (Naturverjuengung): bushy, keeps its dry brown leaves into winter."""
    t = Tree(seed, leaf_size=0.075, spray=9, spacing=0.07)
    rng = t.rng
    for s in range(rng.randint(1, 4)):
        h = rng.uniform(0.9, 3.5)
        base = Vector((rng.gauss(0, 0.25), rng.gauss(0, 0.25), -0.1))
        pts, rad = [base], [rng.uniform(0.008, 0.018)]
        d = Vector((rng.gauss(0, 0.15), rng.gauss(0, 0.15), 1)).normalized()
        n = 5
        for i in range(1, n + 1):
            pts.append(pts[-1] + d * (h / n))
            rad.append(rad[0] * (1 - 0.8 * i / n))
        tube(t.wood, pts, rad, 5)
        for k in range(rng.randint(5, 10)):
            f = rng.uniform(0.2, 0.95)
            i = min(n - 1, int(f * n))
            az = rng.uniform(0, 2 * math.pi)
            dd = Vector((math.cos(az), math.sin(az), rng.uniform(-0.05, 0.4))).normalized()
            t.branch(pts[i], dd, h * rng.uniform(0.25, 0.5) + 0.2, rad[i] * 0.6, 3, 3)
    return t.build(f'sapling_{seed}', coll, bark, leafmat)


def collection(name, hidden=True):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    if hidden:
        bpy.context.view_layer.layer_collection.children[name].exclude = True
    return c


def instance(src, loc, rot_z, scale, coll):
    e = bpy.data.objects.new(src.name + '_i', None)
    e.instance_type = 'COLLECTION'
    e.instance_collection = src
    e.location = loc
    e.rotation_euler = (0, 0, rot_z)
    e.scale = (scale, scale, scale)
    return link(e, coll)


def import_gltf(mid):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(FOREST, mid, f'{mid}.gltf'))
    new = [o for o in bpy.data.objects if o not in before]
    c = collection('src_' + mid)
    for o in new:
        for uc in list(o.users_collection):
            uc.objects.unlink(o)
        c.objects.link(o)
        for slot in o.material_slots:
            if slot.material and not slot.material.get('fog'):
                fogify(slot.material)
                slot.material['fog'] = True
    return c


def in_view_corridor(x, y):
    """Keep the stand's line of sight down the lane open for the first meters."""
    if y < -1 or y > 16:
        return False
    v = Vector((x, y)) - CAM.xy
    a = (AIM.xy - CAM.xy).normalized()
    along = v.dot(a)
    return along > 0 and abs(v.x * a.y - v.y * a.x) < 0.6 + along * 0.38


def build_forest():
    bark, leaves = bark_material(), leaf_material()
    world()
    ground(ground_material())
    forest = collection('forest', hidden=False)
    kinds = {}
    for kind, fn, n in (('big', big_beech, 7), ('pole', pole_beech, 8), ('sap', sapling, 10)):
        kinds[kind] = []
        for i in range(n):
            c = collection(f'src_{kind}_{i}')
            fn(1000 * len(kinds) + i, c, bark, leaves)
            kinds[kind].append(c)
    rng = random.Random(7)

    def scatter(kind, count, dmin, dmax, area, scale=(0.85, 1.15)):
        x0, x1, y0, y1 = area
        placed = 0
        while placed < count:
            x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
            d = abs(x - lane_x(y))
            if d < dmin + rng.uniform(0, 1.2) or d > dmax:
                continue
            if (Vector((x, y)) - CAM.xy).length < 2.5 or in_view_corridor(x, y):
                continue
            instance(rng.choice(kinds[kind]), (x, y, ground_z(x, y)), rng.uniform(0, 6.3),
                     rng.uniform(*scale), forest)
            placed += 1

    area = (-110, 110, -25, 290)
    scatter('big', 900, 5.0, 999, area)
    scatter('pole', 1300, 4.6, 999, area, (0.8, 1.2))
    # young growth crowds the light lane edges, sparse inside the stand
    scatter('sap', 900, 4.0, 14, (-60, 80, -10, 220), (0.7, 1.3))
    scatter('sap', 700, 4.0, 999, area, (0.6, 1.2))

    # dead wood, branches, moss from Poly Haven
    props = forest
    for mid, count, dmin, dmax, sc in (('dead_tree_trunk', 14, 5.5, 40, (0.9, 1.3)),
                                        ('dry_branches_medium_01', 160, 3.2, 60, (0.8, 1.4)),
                                        ('bark_debris_01', 90, 3.0, 60, (0.8, 1.3)),
                                        ('moss_01', 120, 3.0, 40, (0.8, 1.6)),
                                        ('fern_02', 40, 4.5, 40, (0.6, 1.0))):
        src = import_gltf(mid)
        placed = 0
        while placed < count:
            x, y = rng.uniform(-60, 80), rng.uniform(-5, 160)
            d = abs(x - lane_x(y))
            if d < dmin or d > dmax or in_view_corridor(x, y):
                continue
            instance(src, (x, y, ground_z(x, y) - 0.02), rng.uniform(0, 6.3), rng.uniform(*sc), props)
            placed += 1


# ------------------------------------------------------------------ the stand


def stand(cam):
    """Shooting rail of the driven-hunt stand along the bottom of the frame, corner post at the left.
    Parented to the camera (camera space: -Z forward, +Y up)."""
    wood = S.pbr('stand_wood', 'Wood058', tile=0.8, tint='#8f877a', rotate=True, sat=0.45)
    fogify(wood)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    rail = mesh_from_bm('rail', bm, [wood])
    rail.dimensions = (2.6, 0.04, 0.14)
    rail.parent = cam
    # centred on the lower frame edge, whatever the aspect
    v_half = math.atan(math.tan(math.radians(HFOV / 2)) * H / W)
    rail.location = (0.0, -0.95 * math.tan(v_half), -0.95)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.04, radius2=0.04, depth=1.4)
    post = mesh_from_bm('post', bm, [wood])
    post.parent = cam
    post.location = (-0.95 * math.tan(math.radians(HFOV / 2)) - 0.03, -0.15, -0.9)
    post.rotation_euler = (math.radians(90), 0, 0)


# ------------------------------------------------------------------ the boar
#
# Built from the side and top profiles of photographed wild boar: a lofted body (rings along X, superellipse
# cross sections that narrow towards the dorsal ridge), jointed legs with split hooves and dewclaws, cupped
# hairy ears, a tufted tail, and a coat of ~200k bristle curves (dark roots, grizzled grey-brown tips, mane
# along the back, fringes under the belly and on the cheeks). Facing +X, standing on z = 0, meters.

# station: x, dorsal z, ventral z, half width, ridge narrowing, superellipse exponent
BOAR_PROFILE = [
    (-0.665, 0.585, 0.545, 0.02, 0.0, 2.0),
    (-0.645, 0.645, 0.47, 0.11, 0.15, 2.2),
    (-0.60, 0.69, 0.43, 0.18, 0.2, 2.5),
    (-0.52, 0.71, 0.415, 0.215, 0.2, 2.7),    # ham
    (-0.40, 0.72, 0.405, 0.225, 0.22, 2.7),
    (-0.25, 0.735, 0.40, 0.235, 0.25, 2.7),
    (-0.10, 0.765, 0.365, 0.245, 0.25, 2.7),    # belly
    (0.05, 0.82, 0.35, 0.255, 0.28, 2.7),
    (0.20, 0.9, 0.35, 0.26, 0.3, 2.6),    # withers
    (0.32, 0.925, 0.36, 0.255, 0.3, 2.5),     # shoulder hump, the highest point
    (0.43, 0.88, 0.36, 0.24, 0.3, 2.4),     # thick neck, no visible throat
    (0.53, 0.795, 0.33, 0.225, 0.3, 2.3),     # back of the head, broad, jowls hang low
    (0.60, 0.72, 0.295, 0.205, 0.28, 2.2),
    (0.67, 0.635, 0.275, 0.17, 0.26, 2.1),     # eyes
    (0.74, 0.55, 0.26, 0.125, 0.24, 2.1),
    (0.81, 0.47, 0.25, 0.095, 0.22, 2.0),
    (0.87, 0.4, 0.248, 0.075, 0.2, 2.0),
    (0.91, 0.35, 0.252, 0.058, 0.15, 2.0),   # snout disc
]
EYE = (0.66, 0.53)
SNOUT_X = 0.76

# per class: scale (1 = keiler, ~0.9 m at the shoulder), coat colours (linear: root, tip), mane length, tusks
# per class: scale (1 = keiler, ~0.92 m at the withers), coat colours (linear: root, tip), mane length,
# tusks, body width, snout length, leg length (young animals stand higher), fur length, stripes
_K = dict(tusks=False, bulk=1.0, width=1.0, snout=1.0, legs=1.0, fur=1.0, stripes=False)
BOAR_KINDS = {
    'keiler': dict(_K, scale=1.0, root=(0.014, 0.011, 0.009), tip=(0.15, 0.12, 0.09), mane=0.13, tusks=True, bulk=1.06),
    'bache': dict(_K, scale=0.85, root=(0.025, 0.016, 0.01), tip=(0.2, 0.125, 0.07), mane=0.07, width=0.93, snout=0.97),
    'ueberlaeufer': dict(_K, scale=0.7, root=(0.022, 0.016, 0.012), tip=(0.17, 0.13, 0.09), mane=0.05, bulk=0.95,
                         width=0.9, snout=0.92, legs=1.04, fur=0.9),
    # autumn piglet: stripes gone, red-brown coat
    'frischling': dict(_K, scale=0.5, root=(0.035, 0.018, 0.009), tip=(0.24, 0.12, 0.055), mane=0.02, bulk=0.9,
                       width=0.9, snout=0.8, legs=1.12, fur=0.7),
    # spring piglet: light lengthwise stripes on dark brown
    'frischling_gestreift': dict(_K, scale=0.33, root=(0.03, 0.017, 0.008), tip=(0.1, 0.05, 0.022), mane=0.0, bulk=0.85,
                                 width=0.92, snout=0.72, legs=1.15, fur=0.55, stripes=True),
}
STRIPE_ROOT, STRIPE_TIP = (0.2, 0.13, 0.06), (0.42, 0.3, 0.15)


def coat(k, h, rng, root, tip):
    """Striped piglets: ~5 light stripes per side running head to rump (h = height on the flank)."""
    if not k['stripes'] or h < 0.12 or h > 0.92:
        return root, tip
    f = 0.5 + 0.5 * math.cos(2 * math.pi * (h * 5.2 + rng.gauss(0, 0.012)))
    return (STRIPE_ROOT, STRIPE_TIP) if f > 0.66 else (root, tip)


def eye_y():
    """Half width of the head at eye height (where the eyeball sits on the surface)."""
    st = boar_station(EYE[0])
    best = min((abs(_section(st, th)[1] - EYE[1]), _section(st, th)[0]) for th in (k * math.pi / 90 for k in range(91)))
    return best[1]


def _cr(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def boar_station(x, P=None):
    """Profile values at x (Catmull-Rom through the stations)."""
    P = P or BOAR_PROFILE
    if x <= P[0][0]:
        return P[0][1:]
    for i in range(len(P) - 1):
        if P[i][0] <= x <= P[i + 1][0]:
            t = (x - P[i][0]) / (P[i + 1][0] - P[i][0])
            a, b, c, d = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, len(P) - 1)]
            return tuple(_cr(a[k], b[k], c[k], d[k], t) for k in range(1, 6))
    return P[-1][1:]


def _section(st, th, bulk=1.0):
    top, bot, w, narrow, n = st
    c, s = math.cos(th), math.sin(th)
    zc, hh = (top + bot) / 2, (top - bot) / 2
    z = zc + hh * math.copysign(abs(c) ** (2 / n), c)
    y = w * bulk * math.copysign(abs(s) ** (2 / n), s) * (1 - narrow * max(0.0, c) ** 2) * (1 - 0.22 * max(0.0, -c) ** 2)
    return y, z


def loft(name, P, mats, bulk=1.0, rings=72, around=36, close_back=True):
    """Rings along X through the profile stations; front closed by the snout disc (material 1)."""
    bm = bmesh.new()
    x0, x1 = P[0][0], P[-1][0]
    xs = [x0 + (x1 - x0) * (0.5 - 0.5 * math.cos(math.pi * i / (rings - 1))) for i in range(rings)]
    ring_vs = []
    for x in xs:
        st = boar_station(x, P)
        ring_vs.append([bm.verts.new((x, *_section(st, 2 * math.pi * k / around, bulk))) for k in range(around)])
    for r0, r1 in zip(ring_vs, ring_vs[1:]):
        for k in range(around):
            f = bm.faces.new((r0[k], r1[k], r1[(k + 1) % around], r0[(k + 1) % around]))
            f.smooth = True
    if close_back:
        tail_c = bm.verts.new((x0 - 0.008, 0, sum(boar_station(x0, P)[:2]) / 2))
        for k in range(around):
            bm.faces.new((ring_vs[0][(k + 1) % around], ring_vs[0][k], tail_c)).smooth = True
    disc = bm.faces.new(ring_vs[-1])
    disc.material_index = 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bm(name, bm, mats)


def boar_body(skin, snout_m, bulk=1.0):
    return loft('boar_body', BOAR_PROFILE, [skin, snout_m], bulk)


def boar_ear(skin, width=0.075, height=0.12, cup=0.022):
    """Upright pointed ear: a cupped leaf (width along Y, height along Z), hollow side facing +X."""
    bm = bmesh.new()
    nu, nv = 8, 10
    vs = {}
    for j in range(nv + 1):
        v = j / nv
        hw = 0.5 * width * (1 - v) ** 0.85 * (1 + 0.35 * math.sin(math.pi * v))
        for i in range(nu + 1):
            u = (i / nu) * 2 - 1
            vs[i, j] = bm.verts.new((-cup * (1 - u * u) * (1 - 0.6 * v), u * hw, v * height))
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1])).smooth = True
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.005)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bm('ear', bm, [skin])


def leg_mesh(name, pts, radii, mat, sides=14, flat=1.0):
    """Leg segment along `pts` (local, origin = joint), slightly flattened sideways like a real leg."""
    bm = bmesh.new()
    tube(bm, [Vector(p) for p in pts], radii, sides)
    bmesh.ops.scale(bm, vec=(1.0, flat, 1.0), verts=bm.verts)
    # close the lower end
    bm.verts.ensure_lookup_table()
    ring = bm.verts[-sides:]
    bm.faces.new(ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bm(name, bm, [mat])


def hoof(name, mat, dew_mat):
    """Two toes (cloven hoof) + two dewclaws behind, origin at the fetlock."""
    bm = bmesh.new()
    for s in (-1, 1):
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.021, radius2=0.007, depth=0.06)
        vs = res['verts']
        bmesh.ops.scale(bm, vec=(1.0, 0.7, 1.0), verts=vs)
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(150), 3, 'Y'), verts=vs)
        bmesh.ops.translate(bm, vec=(0.013, s * 0.017, -0.028), verts=vs)
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.007, radius2=0.002, depth=0.022)
        vs = res['verts']
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-150), 3, 'Y'), verts=vs)
        bmesh.ops.translate(bm, vec=(-0.02, s * 0.022, -0.012), verts=vs)
    for f in bm.faces:
        f.smooth = True
    return mesh_from_bm(name, bm, [mat])


def boar_materials():
    hair, N, L, _ = new_mat('boar_hair')
    N.remove(N['Principled BSDF'])
    h = N.new('ShaderNodeBsdfHairPrincipled')
    h.parametrization = 'COLOR'
    a = N.new('ShaderNodeAttribute')
    a.attribute_name = 'col'
    L.new(a.outputs['Color'], h.inputs['Color'])
    h.inputs['Roughness'].default_value = 0.38
    h.inputs['Radial Roughness'].default_value = 0.5
    h.inputs['Coat'].default_value = 0.15
    h.inputs['Random Roughness'].default_value = 0.35
    L.new(h.outputs[0], N['Material Output'].inputs['Surface'])
    skin = plain('boar_skin', '#1f1a17', 0.7)
    hoof_m = plain('boar_hoof', '#121010', 0.3)
    snout = plain('boar_snout', '#3a3331', 0.45)
    eye = plain('boar_eye', '#030202', 0.05)
    tusk = plain('boar_tusk', '#d8d0bc', 0.35)
    return dict(hair=fogify(hair), skin=skin, hoof=hoof_m, snout=snout, eye=eye, tusk=tusk)


def sample_surface(ob, count, rng):
    """Area-weighted random points + normals on a mesh (object space)."""
    import bisect
    me = ob.data
    me.calc_loop_triangles()
    tris = me.loop_triangles
    cum, acc = [], 0.0
    for t in tris:
        acc += t.area
        cum.append(acc)
    out = []
    for _ in range(count):
        t = tris[min(len(tris) - 1, bisect.bisect(cum, rng.random() * acc))]
        a, b, c = (me.vertices[i].co for i in t.vertices)
        u, v = rng.random(), rng.random()
        if u + v > 1:
            u, v = 1 - u, 1 - v
        out.append((a + (b - a) * u + (c - a) * v, t.normal.copy()))
    return out


def grow_fur(ob, count, rule, hair_m, seed, lmul=1.0):
    """Bristle curves on `ob`; rule(p, n, rng) -> (length, flow, lift, droop, root, tip) or None."""
    rng = random.Random(seed)
    pos, cols, rads = [], [], []
    for p, n in sample_surface(ob, count, rng):
        r = rule(p, n, rng)
        if not r:
            continue
        L, flow, lift, droop, root, tip = r
        L *= lmul
        # flow projected onto the skin, lifted off it; coherent clumps from a noise field
        f = flow - n * flow.dot(n)
        if f.length < 1e-4:
            f = Vector((-1, 0, 0))
        clump = noise.noise_vector(p * 28.0) * 0.45
        d = (f.normalized() + n * lift + clump + Vector((rng.gauss(0, 0.12), rng.gauss(0, 0.12), rng.gauss(0, 0.12)))).normalized()
        q = p - n * 0.002
        pts = [q.copy()]
        for k in range(3):
            d = (d + Vector((0, 0, -droop)) + noise.noise_vector(q * 60.0) * 0.15).normalized()
            q = q + d * (L / 3)
            pts.append(q.copy())
        pos.extend(pts)
        g = rng.uniform(0.55, 1.35)
        tip_c = (tip[0] * g, tip[1] * g, tip[2] * g)
        dark = rng.random() < 0.25
        mid = tuple(r_ * 0.6 + t_ * 0.4 for r_, t_ in zip(root, tip_c))
        for c in (root, root, mid if not dark else root, tip_c if not dark else mid):
            cols.append((*c, 1.0))
        rr = rng.uniform(0.0006, 0.0009)
        rads.extend((rr, rr * 0.85, rr * 0.6, rr * 0.25))
    hc = bpy.data.hair_curves.new(ob.name + '_fur')
    hc.add_curves([4] * (len(pos) // 4))
    hc.attributes['position'].data.foreach_set('vector', [c for v in pos for c in v])
    rad = hc.attributes.get('radius') or hc.attributes.new('radius', 'FLOAT', 'POINT')
    rad.data.foreach_set('value', rads)
    col = hc.attributes.new('col', 'FLOAT_COLOR', 'POINT')
    col.data.foreach_set('color', [c for v in cols for c in v])
    hc.materials.append(hair_m)
    fur = link(bpy.data.objects.new(ob.name + '_fur', hc))
    fur.parent = ob
    return fur


def body_rule(k):
    root, tip, mane = k['root'], k['tip'], k['mane']

    def rule(p, n, rng):
        top, bot, w, _, _ = boar_station(p.x)
        h = (p.z - bot) / max(1e-3, top - bot)          # 0 belly .. 1 ridge
        x = p.x
        if x > 0.895:                                   # snout disc rim: bare
            return None
        if abs(p.y) > 0.02 and (Vector((EYE[0], math.copysign(eye_y(), p.y), EYE[1])) - p).length < 0.028:
            return 0.006, Vector((-1, 0, 0)), 0.1, 0.0, root, root   # around the eye
        if x > SNOUT_X:                                 # snout: short, dark, a little sparser
            if rng.random() < 0.25:
                return None
            return 0.014 * rng.uniform(0.7, 1.3), Vector((-1, 0, 0)), 0.25, 0.05, root, (tip[0] * 0.55, tip[1] * 0.55, tip[2] * 0.55)
        flow = Vector((-1.0, 0, -0.55 * (1 - h)))
        L, lift, droop = 0.055, 0.22, 0.12
        if x > 0.58:                                    # face: short, combed back
            L, lift, droop = 0.03, 0.18, 0.05
        if 0.48 < x < 0.7 and h < 0.35:                 # cheek / jowl fringe
            L, flow, lift, droop = 0.075, Vector((-0.6, 0, -1)), 0.3, 0.3
        if h > 0.86 and -0.45 < x < 0.6:                # mane along the back, highest over the withers
            m = mane * (0.55 + 0.45 * smoothstep(-0.45, 0.25, x)) * (1 - 0.4 * smoothstep(0.4, 0.6, x))
            L, flow, lift, droop = m, Vector((-1, 0, 0.25)), 0.55, 0.08
            return L * rng.uniform(0.7, 1.3), flow, lift, droop, root, (tip[0] * 0.6, tip[1] * 0.6, tip[2] * 0.6)
        elif h < 0.12 and x < 0.5:                      # belly fringe
            L, flow, lift, droop = 0.07, Vector((-0.4, 0, -1)), 0.2, 0.35
        return L * rng.uniform(0.7, 1.3), flow, lift, droop, root, tip
    return rule


def leg_rule(k, lower):
    root, tip = k['root'], k['tip']
    dark_tip = tuple(c * 0.45 for c in tip)

    def rule(p, n, rng):
        if lower:
            return 0.018 * rng.uniform(0.7, 1.3), Vector((0, 0, -1)), 0.2, 0.1, root, dark_tip
        L = 0.04 if p.z > -0.08 else 0.025
        return L * rng.uniform(0.7, 1.3), Vector((-0.3, 0, -1)), 0.25, 0.2, root, dark_tip
    return rule


def ear_rule(k):
    root, tip = k['root'], k['tip']

    def rule(p, n, rng):
        L = 0.015 if p.z < 0.07 else 0.035                 # tufted rim/tip
        return L * rng.uniform(0.7, 1.4), Vector((0, 0, 1)), 0.3, 0.05, root, tip
    return rule


# leg layout (keiler scale): pivot (x, |y|, z), segments (points, radii), front?
FRONT_UP = ([(0, 0, 0.05), (0.005, 0, -0.11), (0.012, 0, -0.22)], [0.095, 0.068, 0.046])
FRONT_LO = ([(0, 0, 0.01), (0.0, 0, -0.12), (0.015, 0, -0.175)], [0.046, 0.038, 0.034])
HIND_UP = ([(0, 0, 0.05), (-0.035, 0, -0.12), (-0.075, 0, -0.25)], [0.105, 0.072, 0.047])
HIND_LO = ([(0, 0, 0.01), (0.022, 0, -0.12), (0.04, 0, -0.19)], [0.046, 0.038, 0.034])


def boar(mats, kind='keiler', seed=1):
    k = BOAR_KINDS[kind]
    root = link(bpy.data.objects.new('boar', None))
    root.scale = (k['scale'],) * 3
    body = boar_body(mats['skin'], mats['snout'], k['bulk'])
    body.parent = root
    grow_fur(body, int(200000 * k['bulk']), body_rule(k), mats['hair'], seed)
    for s in (-1, 1):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.012)
        e = mesh_from_bm('eye', bm, [mats['eye']])
        e.parent = body
        e.location = (EYE[0], s * (eye_y() * k['bulk'] - 0.002), EYE[1])
        ear = boar_ear(mats['skin'], width=0.12, height=0.17, cup=0.032)
        ear.parent = body
        ear.location = (0.545, s * 0.135, 0.735)
        ear.rotation_euler = (s * math.radians(-42), math.radians(-12), s * math.radians(-28))
        grow_fur(ear, 3500, ear_rule(k), mats['hair'], seed + 7 + s)
        if k['tusks']:
            t = leg_mesh('tusk', [(0, 0, 0), (0.012, s * 0.012, 0.024), (-0.004, s * 0.03, 0.046), (-0.014, s * 0.032, 0.056)],
                         [0.009, 0.0075, 0.005, 0.0015], mats['tusk'], 8)
            t.parent = body
            t.location = (0.83, s * 0.072, 0.262)
    # tail: thin, hanging, with a tuft
    tail = leg_mesh('tail', [(0, 0, 0), (-0.02, 0, -0.1), (-0.015, 0, -0.2)], [0.014, 0.009, 0.006], mats['skin'], 8)
    tail.parent = body
    tail.location = (-0.655, 0, 0.6)
    grow_fur(tail, 1500, lambda p, n, rng: ((0.07 if p.z < -0.15 else 0.02) * rng.uniform(0.7, 1.3),
                                            Vector((0, 0, -1)), 0.1, 0.2, k['root'], k['root']), mats['hair'], seed + 20)
    legs = {}
    for key, x, y, z, front in (('FL', 0.33, 0.13, 0.445, True), ('FR', 0.33, -0.13, 0.445, True),
                                ('HL', -0.45, 0.125, 0.49, False), ('HR', -0.45, -0.125, 0.49, False)):
        U, D = (FRONT_UP, FRONT_LO) if front else (HIND_UP, HIND_LO)
        up = leg_mesh('leg_' + key, U[0], U[1], mats['skin'], flat=0.8)
        up.parent = body
        up.location = (x, y, z)
        grow_fur(up, 9000, leg_rule(k, False), mats['hair'], seed + len(legs) * 3 + 30)
        lo = leg_mesh('shin_' + key, D[0], D[1], mats['skin'], flat=0.85)
        lo.parent = up
        lo.location = U[0][-1]
        grow_fur(lo, 4000, leg_rule(k, True), mats['hair'], seed + len(legs) * 3 + 31)
        h = hoof('hoof_' + key, mats['hoof'], mats['hoof'])
        h.parent = lo
        h.location = D[0][-1]
        legs[key] = (up, lo, h)
    return root, body, legs


# ---- boar from the sculpted base mesh (public/tex/animals/boar_base.blend: head +X, hooves on z = 0,
# extracted from the user's statue model). The statue stands like a pig, level or higher at the rump, so the
# forehand is raised first; then it is smoothed, the four legs are cut out at the belly and split at
# knee / hock so the trot can swing them, and the coat goes on as on the procedural boar.

BOAR_BASE = os.path.join(S.TEX, 'animals', 'boar_base.blend')
STATUE_FEET = {'FL': (0.177, 0.098), 'FR': (0.177, -0.098), 'HL': (-0.555, 0.102), 'HR': (-0.555, -0.102)}
STATUE_WITHERS = 0.84      # after raising the forehand
FOREHAND = 0.28            # forehand raised by up to 28 %
STATUE_TAIL = -0.655       # the statue's stub of a tail is cut off here and replaced by a hanging one
STATUE_NECK = 0.42         # the statue's (domestic pig) head is cut off here ...
# ... and replaced by a wild boar head (statue units): long wedge, deep cheeks and jowls, starting inside
# the neck so the seam is covered; x, dorsal z, ventral z, half width, ridge narrowing, exponent
HEAD_PROFILE = [
    (0.37, 0.78, 0.29, 0.145, 0.3, 2.3),
    (0.46, 0.745, 0.268, 0.152, 0.3, 2.3),
    (0.53, 0.675, 0.245, 0.138, 0.28, 2.2),
    (0.60, 0.59, 0.232, 0.116, 0.26, 2.1),
    (0.67, 0.505, 0.224, 0.09, 0.24, 2.1),
    (0.73, 0.435, 0.22, 0.07, 0.22, 2.0),
    (0.78, 0.375, 0.222, 0.056, 0.18, 2.0),
    (0.82, 0.338, 0.228, 0.05, 0.15, 2.0),    # snout disc
]
HEAD_EYE = (0.585, 0.5)


def statue_mesh():
    with bpy.data.libraries.load(BOAR_BASE) as (src, dst):
        dst.meshes = ['boar_base']
    me = dst.meshes[0]
    for v in me.vertices:
        v.co.z *= 1 + FOREHAND * smoothstep(-0.35, 0.2, v.co.x)
    tmp = link(bpy.data.objects.new('boar_tmp', me))
    sub = tmp.modifiers.new('sub', 'SUBSURF')
    sub.levels = sub.render_levels = 2
    dg = bpy.context.evaluated_depsgraph_get()
    smooth = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    return smooth


def split_faces(me, keep, name, mats, offset=Vector()):
    """New mesh object from the faces of `me` where keep(face centre) is true, shifted by -offset."""
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep(f.calc_center_median())], context='FACES')
    bmesh.ops.translate(bm, vec=-offset, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)   # the statue has patches facing inwards
    for f in bm.faces:
        f.smooth = True
    return mesh_from_bm(name, bm, mats)


def slice_table(me, step=0.02):
    """Top / bottom z per x slice of a mesh (for 'how high up the flank' in the fur rules)."""
    tab = {}
    for v in me.vertices:
        i = int(math.floor(v.co.x / step))
        t, b = tab.get(i, (-9, 9))
        tab[i] = (max(t, v.co.z), min(b, v.co.z))
    return lambda x: tab.get(int(math.floor(x / step)), (1.0, 0.0))


def head_rule(k):
    root, tip = k['root'], k['tip']
    dark = (tip[0] * 0.55, tip[1] * 0.55, tip[2] * 0.55)
    eye_y = head_eye_y()

    def rule(p, n, rng):
        if p.x < STATUE_NECK - 0.02:                    # inside the neck
            return None
        top, bot, _, _, _ = boar_station(p.x, HEAD_PROFILE)
        h = (p.z - bot) / max(1e-3, top - bot)
        x = p.x
        if x > 0.805:                                   # snout disc rim: bare
            return None
        if abs(p.y) > 0.02 and (Vector((HEAD_EYE[0], math.copysign(eye_y, p.y), HEAD_EYE[1])) - p).length < 0.026:
            return 0.006, Vector((-1, 0, 0)), 0.1, 0.0, root, root
        if x > 0.68:                                    # snout: short and dark
            if rng.random() < 0.2:
                return None
            return 0.014 * rng.uniform(0.7, 1.3), Vector((-1, 0, 0)), 0.25, 0.05, root, dark
        flow = Vector((-1.0, 0, -0.5 * (1 - h)))
        if 0.44 < x < 0.64 and h < 0.4:                 # cheek / jowl fringe
            return 0.065 * rng.uniform(0.7, 1.3), Vector((-0.6, 0, -1)), 0.3, 0.3, root, tip
        if h > 0.6:                                     # forehead: bristly
            return 0.04 * rng.uniform(0.7, 1.3), flow, 0.35, 0.05, root, tip
        return (0.03 * rng.uniform(0.7, 1.3), flow, 0.22, 0.05, *coat(k, h, rng, root, tip))
    return rule


def head_eye_y():
    """Half width of the head at eye height."""
    st = boar_station(HEAD_EYE[0], HEAD_PROFILE)
    return min((abs(_section(st, th)[1] - HEAD_EYE[1]), _section(st, th)[0]) for th in (k * math.pi / 90 for k in range(91)))[1]


def statue_body_rule(k, slices):
    root, tip, mane = k['root'], k['tip'], k['mane']
    dark = (tip[0] * 0.55, tip[1] * 0.55, tip[2] * 0.55)

    def rule(p, n, rng):
        top, bot = slices(p.x)
        h = (p.z - bot) / max(1e-3, top - bot)          # 0 belly .. 1 ridge
        x = p.x
        if x > 0.655:                                   # snout disc: bare
            return None
        if x > 0.52:                                    # snout: short and dark
            if rng.random() < 0.25:
                return None
            return 0.014 * rng.uniform(0.7, 1.3), Vector((-1, 0, 0)), 0.25, 0.05, root, dark
        flow = Vector((-1.0, 0, -0.55 * (1 - h)))
        L, lift, droop = 0.05, 0.22, 0.12
        if x > 0.36:                                    # face: shorter, combed back, bristly on the forehead and ears
            L, lift, droop = (0.045, 0.35, 0.05) if h > 0.6 else (0.032, 0.25, 0.05)
        if 0.3 < x < 0.5 and h < 0.4:                   # cheek / jowl fringe
            L, flow, lift, droop = 0.065, Vector((-0.6, 0, -1)), 0.3, 0.3
        if h > 0.85 and -0.5 < x < 0.36 and mane > 0:   # mane along the back, highest over the withers
            m = max(L, mane * (0.55 + 0.45 * smoothstep(-0.5, 0.1, x)) * (1 - 0.4 * smoothstep(0.2, 0.36, x)))
            return m * rng.uniform(0.7, 1.3), Vector((-1, 0, 0.1)), 0.35, 0.12, root, (tip[0] * 0.45, tip[1] * 0.45, tip[2] * 0.45)
        if h < 0.12 and x < 0.25:                       # belly fringe
            L, flow, lift, droop = 0.06, Vector((-0.4, 0, -1)), 0.2, 0.35
        return (L * rng.uniform(0.7, 1.3), flow, lift, droop, *coat(k, h, rng, root, tip))
    return rule


def statue_boar(mats, kind='keiler', seed=1, size=1.0):
    k = BOAR_KINDS[kind]
    root = link(bpy.data.objects.new('boar', None))
    root.scale = (k['scale'] * size * 0.92 / STATUE_WITHERS,) * 3
    me = statue_mesh()
    front_cut, hind_cut = 0.27, 0.25

    def leg_of(c):
        for key, (fx, fy) in STATUE_FEET.items():
            cut = front_cut if key[0] == 'F' else hind_cut
            if abs(c.x - fx) < 0.12 and abs(c.y - fy) < 0.085 and c.z < cut:
                return key
        return None
    lm = k['fur']
    body = split_faces(me, lambda c: leg_of(c) is None and STATUE_TAIL < c.x < STATUE_NECK, 'boar_body', [mats['skin']])
    body.parent = root
    body.scale = (1.0, k['width'], 1.0)
    # longer legs lift the body (pivot height ~0.33 statue units)
    body['z0'] = (k['legs'] - 1.0) * 0.33
    body.location.z = body['z0']
    grow_fur(body, int(200000 * k['bulk']), statue_body_rule(k, slice_table(body.data)), mats['hair'], seed, lm)
    head = loft('boar_head', HEAD_PROFILE, [mats['skin'], mats['snout']], close_back=False, rings=48)
    head.parent = body
    # snout length: scale the head along X about the neck
    head.scale.x = k['snout']
    head.location.x = STATUE_NECK * (1 - k['snout'])
    grow_fur(head, 60000, head_rule(k), mats['hair'], seed + 3, lm)
    ey = head_eye_y()
    for s_ in (-1, 1):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.011)
        e = mesh_from_bm('eye', bm, [mats['eye']])
        e.parent = head
        e.location = (HEAD_EYE[0], s_ * (ey - 0.002), HEAD_EYE[1])
        ear = boar_ear(mats['skin'], width=0.11, height=0.155, cup=0.03)
        ear.parent = head
        ear.location = (0.5, s_ * 0.088, 0.652)            # base sunk into the skull
        ear.rotation_euler = (s_ * math.radians(-38), math.radians(-14), s_ * math.radians(-28))
        grow_fur(ear, 3500, ear_rule(k), mats['hair'], seed + 7 + s_, lm)
        if k['tusks']:
            t = leg_mesh('tusk', [(0, 0, 0), (0.011, s_ * 0.011, 0.022), (-0.004, s_ * 0.027, 0.042), (-0.013, s_ * 0.029, 0.051)],
                         [0.0085, 0.007, 0.0045, 0.0014], mats['tusk'], 8)
            t.parent = head
            t.location = (0.745, s_ * 0.06, 0.238)
    # tail: thin, hanging, with a tuft; raised when the animal flees (animate_boar)
    tail = leg_mesh('tail', [(0, 0, 0), (-0.02, 0, -0.09), (-0.012, 0, -0.19)], [0.013, 0.009, 0.006], mats['skin'], 8)
    tail.parent = body
    tail.location = (STATUE_TAIL + 0.005, 0, 0.6)
    grow_fur(tail, 1500, lambda p, n, rng: ((0.07 if p.z < -0.14 else 0.02) * rng.uniform(0.7, 1.3),
                                            Vector((0, 0, -1)), 0.1, 0.2, k['root'], k['root']), mats['hair'], seed + 20, lm)
    body['tail'] = tail.name
    legs = {}
    for key, (fx, fy) in STATUE_FEET.items():
        front = key[0] == 'F'
        cut = front_cut if front else hind_cut
        knee_z = 0.15 if front else 0.16
        pivot = Vector((fx + (0.0 if front else 0.03), fy, cut + 0.06))
        knee = Vector((fx + (0.0 if front else -0.02), fy, knee_z))
        up = split_faces(me, lambda c, key=key: leg_of(c) == key and c.z >= knee_z, 'leg_' + key, [mats['skin']], pivot)
        up.parent = body
        up.location = pivot
        up.scale.z = k['legs']
        grow_fur(up, 7000, leg_rule(k, False), mats['hair'], seed + len(legs) * 3 + 30, lm)
        lo = split_faces(me, lambda c, key=key: leg_of(c) == key and c.z < knee_z, 'shin_' + key, [mats['hoof']], knee)
        lo.parent = up
        lo.location = knee - pivot
        grow_fur(lo, 3000, lambda p, n, rng: None if p.z < -knee_z + 0.05 else leg_rule(k, True)(p, n, rng),
                 mats['hair'], seed + len(legs) * 3 + 31, lm)
        h = link(bpy.data.objects.new('hoof_' + key, None))
        h.parent = lo
        legs[key] = (up, lo, h)
    return root, body, legs


def make_boar(mats, kind='keiler', seed=1, size=1.0):
    """The sculpted base mesh when it is there (base=procedural forces the lofted one)."""
    if OPT.get('base', 'statue') == 'statue' and os.path.exists(BOAR_BASE):
        return statue_boar(mats, kind, seed, size)
    return boar(mats, kind, seed)


# gait: stride (m, keiler size), leg phase offsets (fraction of a cycle), swing amplitude front/hind (deg),
# knee/hock flex front/hind (deg), body bob (m), pitch rock (deg), tail angle (deg, + = raised)
GAITS = {
    'trot': dict(stride=1.15, phase={'FL': 0.0, 'HR': 0.0, 'FR': 0.5, 'HL': 0.5}, amp=(24, 22), flex=(60, -35),
                 bob=0.018, rock=1.2, tail=15),
    # rotary gallop: the fronts land one after the other, then the hinds; long reach, back rocking, tail up
    'gallop': dict(stride=2.1, phase={'FL': 0.0, 'FR': 0.12, 'HL': 0.52, 'HR': 0.64}, amp=(44, 40), flex=(85, -55),
                   bob=0.035, rock=6.0, tail=115),
}


def animate_boar(root, body, legs, t0, x0, x1, speed, y, gait='trot', phase0=0.0, surge=0.0, seed=0, direction=1):
    """Run across the lane from x0 to x1 (direction +1 = along +X, -1 = back). speed 0 = standing.
    surge: m of gentle back-and-forth within a group. A running animal is parked far below the ground
    before it starts and once it has arrived, so it neither shows nor costs render time."""
    sc = bpy.context.scene
    frames = int(SECONDS * FPS)
    s = root.scale.x
    g = GAITS[gait]
    tail = bpy.data.objects.get(body.get('tail', ''))
    rng = random.Random(seed)
    sp = rng.uniform(0, 6.3)
    for f in range(frames + 1):
        t = f / FPS
        run = max(0.0, t - t0)
        x = x0 + direction * (run * speed + surge * math.sin(run * 2.7 + sp) * min(1.0, run))
        arrived = (x - x1) * direction >= 0
        moving = speed > 0 and t0 <= t and not arrived
        phase = 2 * math.pi * (abs(x - x0) / (g['stride'] * s) + phase0)
        parked = speed > 0 and (t < t0 - 1.0 / FPS or arrived)
        root.location = (x, y, -100.0 if parked else ground_z(x, y))
        root.rotation_euler = (0, 0, 0 if direction > 0 else math.pi)
        root.keyframe_insert('location', frame=f)
        root.keyframe_insert('rotation_euler', frame=f)
        if moving:
            bob = g['bob'] * (math.cos(2 * phase) if gait == 'trot' else math.cos(phase))
            body.location = (0, 0, body.get('z0', 0.0) + bob)
            body.rotation_euler = (0.02 * math.sin(phase), math.radians(g['rock']) * math.sin(phase + 0.6), 0)
        else:
            body.location = (0, 0, body.get('z0', 0.0))
            body.rotation_euler = (0, 0, 0)
        body.keyframe_insert('location', frame=f)
        body.keyframe_insert('rotation_euler', frame=f)
        if tail:
            lift = g['tail'] if moving else 5
            tail.rotation_euler = (0.15 * math.sin(phase * 1.0 + 1.0) if moving else 0.0, math.radians(lift + (8 * math.sin(phase) if moving else 0)), 0)
            tail.keyframe_insert('rotation_euler', frame=f)
        for key, (up, lo, hf) in legs.items():
            ph = phase + 2 * math.pi * g['phase'][key]
            front = key[0] == 'F'
            if moving:
                a = math.radians(g['amp'][0 if front else 1]) * math.sin(ph)
                swing = max(0.0, math.cos(ph)) ** 1.5      # leg travelling forward, lifted
                up.rotation_euler = (0, -a, 0)
                lo.rotation_euler = (0, math.radians(g['flex'][0 if front else 1]) * swing, 0)
                hf.rotation_euler = (0, math.radians(45) * swing, 0)
            else:
                up.rotation_euler = lo.rotation_euler = hf.rotation_euler = (0, 0, 0)
            for o in (up, lo, hf):
                o.keyframe_insert('rotation_euler', frame=f)
    sc.frame_start, sc.frame_end = 0, frames


# ---- sounders (Rotten)

def rotte_layout(kinds, rng):
    """Order and spacing of a fleeing sounder: the lead sow in front, piglets bunched close behind her,
    yearlings strung out behind; members side by side now and then (they overlap from the stand).
    Returns (kind, distance behind the leader's nose, lateral offset, size) per animal."""
    order = {'bache': 0, 'keiler': 0, 'frischling_gestreift': 1, 'frischling': 1, 'ueberlaeufer': 2}
    lead = next((i for i, k in enumerate(kinds) if k in ('bache', 'keiler')), 0)
    rest = sorted((k for i, k in enumerate(kinds) if i != lead), key=lambda k: (order.get(k, 1), rng.random()))
    out, back, prev_len = [], 0.0, 0.0
    for i, kind in enumerate([kinds[lead]] + rest):
        size = rng.uniform(0.92, 1.08)
        length = 1.65 * BOAR_KINDS[kind]['scale'] * size
        if i:
            young = kind.startswith('frischling')
            gap = rng.uniform(0.1, 0.9) if young else rng.uniform(0.6, 2.2)
            beside = young and rng.random() < 0.35                   # running next to the one in front
            back += (prev_len * 0.5 if beside else prev_len) + gap * (0.3 if beside else 1.0)
        out.append((kind, back, rng.gauss(0, 0.45) if i else 0.0, size))
        prev_len = length
    return out


# ------------------------------------------------------------------ camera / render


def camera(sc):
    cd = bpy.data.cameras.new('cam')
    cd.sensor_fit = 'HORIZONTAL'
    cd.sensor_width = 36
    cd.lens = 18 / math.tan(math.radians(HFOV / 2))
    cd.clip_start = 0.1
    cd.clip_end = 2000
    cd.dof.use_dof = True
    cd.dof.focus_distance = FOCUS
    cd.dof.aperture_fstop = 5.6
    cam = link(bpy.data.objects.new('cam', cd))
    cam.location = CAM
    S.look_at(cam, AIM)
    sc.camera = cam
    return cam


def setup():
    S.SAMPLES = SAMPLES
    sc = S.reset()
    sc.cycles.samples = SAMPLES
    sc.cycles.adaptive_threshold = 0.015
    sc.cycles.seed = 1
    sc.cycles.use_animated_seed = False
    sc.cycles.max_bounces = 6
    sc.cycles.transparent_max_bounces = 4
    sc.render.use_persistent_data = True
    sc.render.use_motion_blur = True
    sc.render.motion_blur_shutter = 0.5
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.fps = FPS
    sc.render.image_settings.color_mode = 'RGB'
    sc.view_settings.exposure = float(OPT.get('exposure', 0.35))
    try:
        sc.cycles.curve_shape = 'RIBBONS'
    except Exception:
        pass
    return sc


def boar_rect(sc, cam, roots, margin_px=40):
    """Pixel rect (x0, y0, x1, y1; origin bottom-left) covering the animals and their contact shadows."""
    xs, ys = [], []
    for root in (roots if isinstance(roots, (list, tuple)) else [roots]):
        if root.matrix_world.translation.z < -50:          # parked: not on stage
            continue
        m = root.matrix_world
        for dx in (-0.85, 1.0):
            for dy in (-0.45, 0.45):
                for dz in (-0.05, 1.1):
                    p = world_to_camera_view(sc, cam, m @ Vector((dx, dy, dz)))
                    if p.z > 0:
                        xs.append(p.x * W)
                        ys.append(p.y * H)
    if not xs:
        return 0, 0, 0, 0
    return (max(0, int(min(xs)) - margin_px), max(0, int(min(ys)) - margin_px),
            min(W, int(max(xs)) + margin_px), min(H, int(max(ys)) + margin_px))


def boar_closeup(sc):
    """Model check: keiler, bache and ueberlaeufer standing side by side, then the keiler trotting."""
    world()
    ground(ground_material())
    mats = boar_materials()
    sc.render.use_motion_blur = False
    cd = bpy.data.cameras.new('cam')
    cam = link(bpy.data.objects.new('cam', cd))
    sc.camera = cam
    kinds = OPT.get('kinds', 'keiler,bache,ueberlaeufer').split(',')
    boars = []
    for i, kind in enumerate(kinds):
        root, body, legs = make_boar(mats, kind, seed=i + 1)
        trot = OPT.get('trot') == '1' and i == 0
        x = xs_next if i else 0.0
        size = BOAR_KINDS[kind]['scale']
        if i:
            x += 0.95 * size
        animate_boar(root, body, legs, t0=0.0, x0=x, x1=99.0 if trot else x, speed=3.6 if trot else 0.0, y=0.0)
        xs_next = x + 0.95 * size + 0.3
        boars.append(root)
    sc.frame_set(int(OPT.get('frame', 4)))
    cx = (boars[0].location.x + boars[-1].location.x) / 2 - 0.1
    span = boars[-1].location.x - boars[0].location.x + 2.6
    z = BOAR_KINDS[kinds[0]]['scale']             # close views scale with the first animal
    sc.render.resolution_x, sc.render.resolution_y = int(OPT.get('cw', 1500)), int(OPT.get('ch', 700))
    b0 = boars[0].location.x
    for name, loc, lens, tgt in (('side', (cx, -max(4.5, span * 1.25), 0.75), 50, (cx, 0, 0.4)),
                                 ('front', (b0 + 2.4 * z, -2.0 * z, 0.9 * z), 70, (b0 + 0.2 * z, 0, 0.45 * z)),
                                 ('head', (b0 + 4.0 * z, 0.0, 0.6 * z), 85, (b0, 0, 0.5 * z)),
                                 ('top', (b0 + 0.1 * z, 0.0, 5.0 * z), 85, (b0 + 0.1 * z, 0.001, 0.0))):
        cd.lens = lens
        cam.location = loc
        S.look_at(cam, Vector(tgt))
        sc.render.filepath = os.path.join(OUTDIR, f'boar_{name}.png')
        bpy.ops.render.render(write_still=True)


def gait_check(sc):
    """Side view of one animal at 6 moments of a stride: gait=gallop|trot kind=..."""
    world()
    ground(ground_material())
    mats = boar_materials()
    sc.render.use_motion_blur = False
    kind = OPT.get('kind', 'keiler')
    root, body, legs = make_boar(mats, kind)
    gait = OPT.get('gait', 'gallop')
    animate_boar(root, body, legs, t0=0.0, x0=0.0, x1=999.0, speed=8.0 if gait == 'gallop' else 3.6, y=0.0, gait=gait)
    cd = bpy.data.cameras.new('cam')
    cd.lens = 70
    cam = link(bpy.data.objects.new('cam', cd))
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = 800, 450
    stride_t = GAITS[gait]['stride'] * root.scale.x / (8.0 if gait == 'gallop' else 3.6)
    for i in range(6):
        ft = (0.5 + i / 6 * stride_t) * FPS
        sc.frame_set(int(ft), subframe=ft - int(ft))
        x = root.location.x
        cam.location = (x + 0.1, -5.0, 0.6)
        S.look_at(cam, Vector((x + 0.1, 0, 0.45)))
        sc.render.filepath = os.path.join(OUTDIR, f'gait_{i}.png')
        bpy.ops.render.render(write_still=True)


def scenario_game(mats, sc_json):
    """All crossings of a scenario on one timeline. Each crossing: at (s), animals (classes, the lead
    animal first), gait, speed (m/s), distance (m from the stand), direction (ltr / rtl), seed."""
    global SECONDS
    SECONDS = float(sc_json['duration'])
    roots, n = [], 0
    for c in sc_json['crossings']:
        rng = random.Random(int(c.get('seed', 1)))
        d = float(c['distance'])
        y = d
        # from just outside the frame edge on one side to just outside the other (wider further away)
        half = math.tan(math.radians(HFOV / 2)) * (y - CAM.y) + 4.0
        xc = CAM.x + (AIM.x - CAM.x) * (y - CAM.y) / (AIM.y - CAM.y)    # centre of the view at that depth
        direction = 1 if c.get('direction', 'ltr') == 'ltr' else -1
        x_start, x_end = xc - direction * half, xc + direction * half
        group = c['animals']
        for kind, back, dy, size in rotte_layout(group, rng):
            n += 1
            root, body, legs = make_boar(mats, kind, seed=n, size=size)
            animate_boar(root, body, legs, t0=float(c['at']), x0=x_start - direction * back, x1=x_end + direction * 0.5,
                         speed=float(c['speed']), y=y + dy, gait=c.get('gait', 'trot'), phase0=rng.random(),
                         surge=0.25 if len(group) > 1 else 0.0, seed=n, direction=direction)
            roots.append(root)
    return roots


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    sc = setup()
    if JOB == 'boar':
        boar_closeup(sc)
        return
    if JOB == 'gait':
        gait_check(sc)
        return
    cam = camera(sc)
    stand(cam)
    build_forest()
    if JOB == 'plate':
        sc.frame_set(0)
        sc.render.filepath = os.path.join(OUTDIR, 'plate.png')
        bpy.ops.render.render(write_still=True)
        return
    mats = boar_materials()
    if 'scenario' in OPT:
        roots = scenario_game(mats, json.load(open(OPT['scenario'], encoding='utf-8')))
    else:
        gait = OPT.get('gait', 'trot')
        speed = float(OPT.get('speed', 3.6 if gait == 'trot' else 8.0))
        rng = random.Random(int(OPT.get('seed', 5)))
        group = OPT['rotte'].split(',') if 'rotte' in OPT else [OPT.get('kind', 'keiler')]
        roots = []
        for i, (kind, back, dy, size) in enumerate(rotte_layout(group, rng)):
            root, body, legs = make_boar(mats, kind, seed=i + 1, size=size)
            animate_boar(root, body, legs, t0=0.8, x0=-17.5 - back, x1=19.0, speed=speed, y=CROSS_Y + dy, gait=gait,
                         phase0=rng.random(), surge=0.25 if len(group) > 1 else 0.0, seed=i)
            roots.append(root)
    root = roots
    if JOB == 'preview':
        sc.frame_set(int(OPT.get('frame', 150)))
        sc.render.filepath = os.path.join(OUTDIR, OPT.get('name', 'preview') + '.png')
        bpy.ops.render.render(write_still=True)
        return
    # game: crop every frame to the boar
    start, end = int(OPT.get('start', 0)), int(OPT.get('end', sc.frame_end))
    rects = {}
    rp = os.path.join(OUTDIR, 'rects.json')
    if os.path.exists(rp):
        rects = json.load(open(rp))
    sc.render.use_border = True
    sc.render.use_crop_to_border = True
    os.makedirs(os.path.join(OUTDIR, 'game'), exist_ok=True)
    print('TOTAL', end - start + 1, flush=True)
    for f in range(start, end + 1):
        sc.frame_set(f)
        x0, y0, x1, y1 = boar_rect(sc, cam, root)
        if x1 - x0 < 8 or y1 - y0 < 8 or x0 >= W or x1 <= 0:
            rects[str(f)] = None
            json.dump(rects, open(rp, 'w'))
            print('EMPTY', f, flush=True)
            continue
        # +1/4 px: the border is turned back into whole pixels by rounding down
        sc.render.border_min_x, sc.render.border_max_x = (x0 + 0.25) / W, (x1 + 0.25) / W
        sc.render.border_min_y, sc.render.border_max_y = (y0 + 0.25) / H, (y1 + 0.25) / H
        sc.render.filepath = os.path.join(OUTDIR, 'game', f'{f:04d}.png')
        bpy.ops.render.render(write_still=True)
        rects[str(f)] = [x0, y0, x1, y1]
        json.dump(rects, open(rp, 'w'))
        print('FRAME', f, rects[str(f)], flush=True)


main()
print('HUNT DONE', JOB, OUTDIR)
