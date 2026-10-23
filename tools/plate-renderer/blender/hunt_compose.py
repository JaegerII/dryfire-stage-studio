"""
Pastes the driven-hunt game crops (hunt.py job "game") onto the lane plate, frame by frame.

  blender -b --factory-startup --python blender/hunt_compose.py -- <dir> [check|rgba]

<dir> holds plate.png, rects.json and game/NNNN.png.
  (default) writes frames/NNNN.png, full frames (encode with ffmpeg)
  rgba      writes crops/NNNN.png: each crop with its feathered edge as alpha, plus crops.json with the
            final (aligned) rects - the studio draws them onto the plate itself (driven-hunt player / MP4)
  check     prints how far each crop differs from the plate, inside and at the border
Crops come from the same renderer settings as the plate, so they match it except at their own border
(the denoiser sees less context there): each crop is blended in with a feathered edge.
"""
import json
import os
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
DIR = os.path.abspath(argv[0])
CHECK = 'check' in argv[1:]
RGBA = 'rgba' in argv[1:]
FEATHER = 14  # px


def load(path):
    im = bpy.data.images.load(path)
    w, h = im.size
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)[:, :, :3]  # rows bottom-up, like the rects


def save(arr, path, alpha=None):
    h, w, _ = arr.shape
    im = bpy.data.images.new('out', w, h, alpha=alpha is not None)
    a = alpha if alpha is not None else np.ones((h, w, 1), np.float32)
    im.pixels.foreach_set(np.concatenate([arr, a], axis=2).ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)


plate = load(os.path.join(DIR, 'plate.png'))
rects = json.load(open(os.path.join(DIR, 'rects.json')))
out_dir = os.path.join(DIR, 'crops' if RGBA else 'frames')
if not CHECK:
    os.makedirs(out_dir, exist_ok=True)
aligned = {}
done = 0
for key in sorted(rects, key=int):
    f, r = int(key), rects[key]
    out = None if RGBA else plate.copy()
    if r:
        x0, y0, x1, y1 = r
        crop = load(os.path.join(DIR, 'game', f'{f:04d}.png'))
        h, w, _ = crop.shape

        def ring(ox, oy):
            b_ = plate[y0 + oy:y0 + oy + h, x0 + ox:x0 + ox + w]
            if b_.shape != crop.shape:
                return 1e9
            d = np.abs(crop - b_)
            return d[6:12].mean() + d[-12:-6].mean() + d[:, 6:12].mean() + d[:, -12:-6].mean()
        # safety net against a one-pixel rounding offset of Blender's render border
        ox, oy = min(((ox, oy) for ox in (-1, 0, 1) for oy in (-1, 0, 1)), key=lambda o: ring(*o))
        x0, y0 = x0 + ox, y0 + oy
        y1, x1 = y0 + h, x0 + w
        base = plate[y0:y1, x0:x1]
        if CHECK:
            d = np.abs(crop - base).max(axis=2) * 255
            k = 20
            inner = d[k:-k, k:-k]
            print(f'{f}: inner mean {inner.mean():.2f} (>{8}: {(inner > 8).mean() * 100:.1f}%), border mean {d[:4].mean():.2f}')
            continue
        # feather: 0 at the crop's edge, 1 from FEATHER px in (edges at the frame border stay hard)
        ys = np.arange(h)[:, None]
        xs = np.arange(w)[None, :]
        dy = np.minimum(ys + (FEATHER if y0 == 0 else 0), h - 1 - ys + (FEATHER if y1 >= plate.shape[0] else 0))
        dx = np.minimum(xs + (FEATHER if x0 == 0 else 0), w - 1 - xs + (FEATHER if x1 >= plate.shape[1] else 0))
        a = np.clip(np.minimum(dy, dx) / FEATHER, 0, 1)[:, :, None]
        if RGBA:
            save(crop, os.path.join(out_dir, f'{f:04d}.png'), a.astype(np.float32))
            aligned[key] = [x0, y0, x1, y1]
        else:
            out[y0:y1, x0:x1] = base * (1 - a) + crop * a
    elif RGBA:
        aligned[key] = None
    if not CHECK and not RGBA:
        save(out, os.path.join(out_dir, f'{f:04d}.png'))
    done += 1
    if done % 25 == 0:
        print('COMPOSE', done, len(rects), flush=True)
if RGBA:
    json.dump({'width': plate.shape[1], 'height': plate.shape[0], 'rects': aligned}, open(os.path.join(DIR, 'crops.json'), 'w'))
print('COMPOSED', DIR)
