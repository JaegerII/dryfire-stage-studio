"""
Generated textures for the Blender renders (run with the system Python + Pillow):
card face (kraft board + printed IPSC zones), orange barrier mesh (RGBA), popper paint.
Output: public/tex/gen/*.png
"""
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, '..', 'public', 'tex')
OUT = os.path.join(TEX, 'gen')
os.makedirs(OUT, exist_ok=True)

OCT = [(-11.5, 0), (11.5, 0), (23, 13), (23, 45), (11.5, 58), (-11.5, 58), (-23, 45), (-23, 13)]
OCT_C = [(-8, 6), (8, 6), (16.5, 15), (16.5, 43), (8, 52), (-8, 52), (-16.5, 43), (-16.5, 15)]
OCT_A = [(-4.5, 15), (4.5, 15), (7.5, 22), (7.5, 44), (5, 49), (-5, 49), (-7.5, 44), (-7.5, 22)]
CARD_W, CARD_H = 46, 58


def rounded(pts, r, seg=8):
    """Polygon with quadratic-rounded corners → dense point list."""
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % n]
        d1 = math.dist(p0, p1)
        d2 = math.dist(p1, p2)
        rr = min(r, d1 / 2, d2 / 2)
        a = (p1[0] + (p0[0] - p1[0]) * rr / d1, p1[1] + (p0[1] - p1[1]) * rr / d1)
        b = (p1[0] + (p2[0] - p1[0]) * rr / d2, p1[1] + (p2[1] - p1[1]) * rr / d2)
        for s in range(seg + 1):
            t = s / seg
            x = (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * p1[0] + t * t * b[0]
            y = (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * p1[1] + t * t * b[1]
            out.append((x, y))
    return out


def card_face():
    W = 2048
    H = round(W * CARD_H / CARD_W)
    k = W / CARD_W
    P = lambda x, y: ((x + CARD_W / 2) * k, H - y * k)
    board = Image.open(os.path.join(TEX, 'Cardboard004_color.jpg')).convert('RGB')
    board = board.crop((0, 0, int(board.width * 0.77), int(board.height * 0.77))).resize((W, H), Image.LANCZOS)
    # kraft tan: half desaturate, then multiply with a warm light tan
    grey = board.convert('L').convert('RGB')
    board = Image.blend(board, grey, 0.5)
    tan = Image.new('RGB', (W, H), (247, 220, 180))
    from PIL import ImageChops
    board = ImageChops.multiply(board, tan)
    # soft uneven tone
    rnd = random.Random(7)
    tone = Image.new('L', (W, H), 128)
    td = ImageDraw.Draw(tone)
    for _ in range(40):
        x, y, r = rnd.random() * W, rnd.random() * H, 80 + rnd.random() * 300
        td.ellipse((x - r, y - r, x + r, y + r), fill=118 if rnd.random() > 0.5 else 138)
    tone = tone.filter(ImageFilter.GaussianBlur(120))
    board = ImageChops.multiply(board, Image.merge('RGB', [tone.point(lambda v: min(255, v * 2))] * 3))
    d = ImageDraw.Draw(board, 'RGBA')
    ink = (70, 45, 18, 140)
    for zone in (OCT_C, OCT_A):
        pts = [P(*p) for p in rounded(zone, 1.2)]
        pts.append(pts[0])
        # perforation: short dashes
        dash, gap = 0.9 * k, 0.25 * k
        acc, on = 0.0, True
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            L = math.dist((x0, y0), (x1, y1))
            pos = 0.0
            while pos < L:
                step = min((dash if on else gap) - acc, L - pos)
                if on:
                    t0, t1 = pos / L, (pos + step) / L
                    d.line([(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0), (x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1)], fill=ink, width=max(1, round(0.22 * k)))
                pos += step
                acc += step
                if acc >= (dash if on else gap) - 1e-6:
                    acc, on = 0.0, not on
    try:
        font = ImageFont.truetype('arialbd.ttf', round(1.5 * k))
    except OSError:
        font = ImageFont.load_default()
    for t, y in (('A', 47.4), ('C', 51), ('D', 55.8)):
        x, yy = P(0, y)
        d.text((x, yy), t, fill=(70, 45, 18, 110), font=font, anchor='mm')
    board.save(os.path.join(OUT, 'card_face.png'))


def barrier_mesh(w_cm=180, h_cm=170):
    k = 12
    W, H = round(w_cm * k), round(h_cm * k)
    cell_w, cell_h = 6, 5
    img = Image.new('RGB', (W, H), (255, 118, 18))
    rnd = random.Random(3)
    d = ImageDraw.Draw(img, 'RGBA')
    for _ in range(420):
        x = rnd.random() * W
        d.rectangle((x, 0, x + 1 + rnd.random() * 5, H), fill=(255, 150, 80, 22) if rnd.random() > 0.5 else (150, 35, 0, 22))
    mask = Image.new('L', (W, H), 255)
    md = ImageDraw.Draw(mask)
    cols, rows = math.ceil(w_cm / cell_w) + 1, math.ceil(h_cm / cell_h) + 1
    for r in range(rows):
        for c in range(cols):
            u = c * cell_w / w_cm
            sag = math.sin(u * math.pi) * 0.9 + math.sin(u * 9 + r * 0.15) * 0.18
            ow = 4.7 + (rnd.random() - 0.5) * 0.4
            oh = 3.4 + (rnd.random() - 0.5) * 0.3
            cx = (c * cell_w + cell_w / 2 + (rnd.random() - 0.5) * 0.3) * k
            cy = (r * cell_h + cell_h / 2 + (rnd.random() - 0.5) * 0.25 + sag) * k
            md.ellipse((cx - ow / 2 * k, cy - oh / 2 * k, cx + ow / 2 * k, cy + oh / 2 * k), fill=0)
    img = img.convert('RGBA')
    img.putalpha(mask)
    img.save(os.path.join(OUT, 'barrier_mesh.png'))


def popper_paint():
    S = 1024
    img = Image.new('RGB', (S, S), (206, 206, 200))
    d = ImageDraw.Draw(img, 'RGBA')
    rnd = random.Random(11)
    for _ in range(26):
        x, y, r = rnd.random() * S, rnd.random() * S, 4 + rnd.random() * 18
        a = int((0.18 + rnd.random() * 0.3) * 255)
        d.ellipse((x - r, y - r, x + r, y + r), fill=(120, 124, 128, a))
        for _ in range(6):
            ang = rnd.random() * math.tau
            dd = r * (1.2 + rnd.random() * 1.6)
            rr = r * 0.18
            d.ellipse((x + math.cos(ang) * dd - rr, y + math.sin(ang) * dd - rr, x + math.cos(ang) * dd + rr, y + math.sin(ang) * dd + rr), fill=(120, 124, 128, a))
    img.save(os.path.join(OUT, 'popper_paint.png'))


if __name__ == '__main__':
    card_face()
    barrier_mesh()
    popper_paint()
    print('generated textures in', OUT)
