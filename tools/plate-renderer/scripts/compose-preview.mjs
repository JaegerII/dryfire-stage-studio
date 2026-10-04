// Composes a stage at full HD the way Stage Studio draws it (plate + sprites, 2.5D perspective).
// Used for before/after previews of the realistic assets.
//   node scripts/compose-preview.mjs <stage.json> <plate> <out.jpg> [realistic]
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const [stageFile, plateFile, outFile, mode] = process.argv.slice(2);
const stage = JSON.parse(readFileSync(stageFile, 'utf8'));
const W = 1920;
const H = 1080;
const HORIZON = 0.4;
const CAM = 1.5;
const A = '../../src/assets';

// registry geometry (viewW, viewH, groundY) + source files
const reg = readFileSync(`${A}/registry.ts`, 'utf8');
const imports = Object.fromEntries([...reg.matchAll(/import (\w+) from '\.\/([^']+)';/g)].map((m) => [m[1], m[2]]));
const assets = {};
for (const m of reg.matchAll(/^\s+(\w+): \{ type: '\w+',.*?src: (\w+), viewW: ([\d.]+), viewH: ([\d.]+), groundY: ([\d.]+)/gm)) {
  assets[m[1]] = { src: imports[m[2]], viewW: +m[3], viewH: +m[4], groundY: +m[5] };
}
const REALISTIC = ['paper_full', 'steel_popper', 'mesh_wall'];
const srcFor = (type) => {
  const svg = assets[type].src.replace(/^realistic\/(\w+)\.webp$/, (_, t) => (t === 'mesh_wall' ? 'barriers/mesh_wall.svg' : `targets/${t}.svg`));
  return mode === 'realistic' && REALISTIC.includes(type) ? `realistic/${type}.webp` : svg;
};

const zoom = stage.zoom ?? 1;
const layers = [];
const objs = [...stage.objects].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0) || a.y - b.y || (a.elevation ?? 0) - (b.elevation ?? 0));
for (const o of objs) {
  const a = assets[o.type];
  if (!a || o.visible === false) continue;
  const p = Math.min(1.5, Math.max(0.02, (o.y - HORIZON) / (1 - HORIZON)));
  const pxM = ((p * (1 - HORIZON)) / CAM) * H * zoom;
  const h = (a.viewH / 100) * pxM * (o.scale ?? 1);
  const w = ((h * a.viewW) / a.viewH) * Math.abs(Math.cos(((o.yaw ?? 0) * Math.PI) / 180));
  const sx = W / 2 + (o.x - 0.5) * W * zoom;
  const sy = HORIZON * H + (o.y - HORIZON) * H * zoom - (o.elevation ?? 0) * pxM;
  const left = Math.round(sx - w / 2);
  const top = Math.round(sy - (h * a.groundY) / a.viewH);
  let img = sharp(`${A}/${srcFor(o.type)}`, { density: 300 }).resize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), { fit: 'fill' });
  if (o.mirror) img = img.flop();
  let buf = await img.png().toBuffer();
  if (o.opacity != null && o.opacity < 1) buf = await sharp(buf).ensureAlpha(o.opacity).png().toBuffer();
  // clip to the frame
  const cl = Math.max(0, -left);
  const ct = Math.max(0, -top);
  const cw = Math.min(Math.round(w) - cl, W - Math.max(0, left));
  const ch = Math.min(Math.round(h) - ct, H - Math.max(0, top));
  if (cw <= 0 || ch <= 0) continue;
  buf = await sharp(buf).extract({ left: cl, top: ct, width: cw, height: ch }).png().toBuffer();
  layers.push({ input: buf, left: Math.max(0, left), top: Math.max(0, top) });
}
// plate scaled around the horizon centre like the app's zoom
const pw = Math.round(W * zoom);
const ph = Math.round(H * zoom);
const plate = await sharp(plateFile)
  .resize(pw, ph)
  .extract({ left: Math.round((pw - W) / 2), top: Math.round(HORIZON * (ph - H)), width: W, height: H })
  .png()
  .toBuffer();
await sharp(plate).composite(layers).jpeg({ quality: 92 }).toFile(outFile);
console.log('wrote', outFile, layers.length, 'objects');
