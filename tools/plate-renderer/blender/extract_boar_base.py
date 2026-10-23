"""Pull the boar statue mesh out of its source .blend (378 MB, the user's download) into a light
boar_base.blend for hunt.py: head +X, hooves on z = 0, centred, no materials or images.

  blender -b --factory-startup --disable-autoexec <statue.blend> --python blender/extract_boar_base.py -- public/tex/animals/boar_base.blend
"""
import math
import sys

import bpy
from mathutils import Matrix

out = sys.argv[sys.argv.index('--') + 1]
ob = bpy.data.objects['Mesh_lod0']
me = ob.data.copy()
me.transform(ob.matrix_world)
me.transform(Matrix.Rotation(math.radians(90), 4, 'Z'))   # head -Y -> +X
xs = [v.co.x for v in me.vertices]
ys = [v.co.y for v in me.vertices]
zs = [v.co.z for v in me.vertices]
me.transform(Matrix.Translation((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -min(zs))))
me.materials.clear()
me.name = 'boar_base'
bpy.data.libraries.write(out, {me}, fake_user=True)
print('WROTE', out, len(me.vertices), 'verts', [round(max(a) - min(a), 3) for a in (xs, ys, zs)])
