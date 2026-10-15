"""
Grass colour for the 3D outdoor ground (export3d.py → GRASS_GAIN).

From eye height (the plates) grass blades are seen side-on, sunlit and with a sky sheen; straight
from above the camera looks into the dark turf. This finds per-channel gains for the grass material
so that the ground from above has the plate's colour in the area the plate's lower third shows.

  blender -b --factory-startup --python blender/calibrate_grass.py -- <plate.webp|png> <env> [r,g,b]

One render per run (Cycles does not give the GPU memory of the grass back between renders): run it
again with the printed NEXT gain until it settles.
"""
import math
import os
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
PLATE, PID = os.path.abspath(argv[0]), argv[1]
GAIN0 = [float(v) for v in argv[2].split(',')] if len(argv) > 2 else [1.0, 1.0, 1.0]
ROOT = float(argv[3]) if len(argv) > 3 else 0.45  # colour at the blade's root (scene.py: 0.45)
sys.argv = sys.argv[: sys.argv.index('--') + 1]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scene as S  # noqa: E402

# the plate's lower third, centre: ground ≈ 0.5 … 5 m ahead of d = 0, ±2.5 m across
PLATE_REGION = (0.3, 0.62, 0.7, 1.0)  # fractions: left, top, right, bottom
GROUND_REGION = (-2.5, 2.5, 0.3, 5.0)  # x0, x1, y0, y1 (m)


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def mean_linear(path, region):
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    px = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[::-1]  # rows top-down
    l, t, r, b = region
    sub = px[int(t * h):int(b * h), int(l * w):int(r * w), :3]
    bpy.data.images.remove(im)
    # bytes as stored (display-referred sRGB) → linear for a meaningful ratio
    return srgb_to_linear(sub.reshape(-1, 3)).mean(axis=0)


def hair_gain_nodes():
    """The root-darkening map range of every grass material: its output range scales the colour."""
    out = []
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        for n in m.node_tree.nodes:
            if n.type == 'MAP_RANGE' and n.inputs['Value'].is_linked and n.inputs['Value'].links[0].from_node.type == 'HAIR_INFO':
                out.append((m, n))
    return out


def set_gain(gain):
    for m, n in hair_gain_nodes():
        n.inputs['To Min'].default_value = ROOT
        nt = m.node_tree
        g = nt.nodes.get('__gain__')
        if g is None:
            # colour × gain right before the BSDF
            b = nt.nodes['Principled BSDF']
            src = b.inputs['Base Color'].links[0].from_socket
            g = nt.nodes.new('ShaderNodeMix')
            g.name = '__gain__'
            g.data_type = 'RGBA'
            g.blend_type = 'MULTIPLY'
            g.inputs['Factor'].default_value = 1.0
            nt.links.new(src, g.inputs['A'])
            nt.links.new(g.outputs['Result'], b.inputs['Base Color'])
        g.inputs['B'].default_value = (*gain, 1.0)


target = mean_linear(PLATE, PLATE_REGION)
print('plate', target, flush=True)
sc = S.reset()
S.make_materials()
S.PLATES[PID]()
sc.cycles_curves.shape = 'RIBBONS'
for ps in bpy.data.particles:
    ps.render_step = 2
cam = S.link(bpy.data.objects.new('top', bpy.data.cameras.new('top')))
x0, x1, y0, y1 = GROUND_REGION
cam.location = ((x0 + x1) / 2, (y0 + y1) / 2, 50)
cam.data.type = 'ORTHO'
cam.data.ortho_scale = max(x1 - x0, y1 - y0)
sc.camera = cam
sc.render.resolution_x = round(480 * (x1 - x0) / max(x1 - x0, y1 - y0))
sc.render.resolution_y = round(480 * (y1 - y0) / max(x1 - x0, y1 - y0))
sc.cycles.samples = 64
sc.cycles.denoising_use_gpu = False
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGB'
out = os.path.join(S.HERE, '..', 'out', f'calib_{PID}.png')
sc.render.filepath = out
gain = np.array(GAIN0)
set_gain(gain)
bpy.ops.render.render(write_still=True)
got = mean_linear(out, (0, 0, 1, 1))
print(f'{PID}: root {ROOT} gain {np.round(gain, 3).tolist()} → {np.round(got, 4).tolist()} (plate {np.round(target, 4).tolist()})', flush=True)
print('NEXT', PID, ','.join(f'{v:.3f}' for v in gain * (target / np.maximum(got, 1e-4))), flush=True)
