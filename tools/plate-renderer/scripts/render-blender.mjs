// Photorealistic renders with Blender Cycles (see blender/scene.py).
//   npm run blender                     → indoor_01 plate + all sprites
//   npm run blender sprite:paper_full   → one job
// Needs Blender (BLENDER env var or D:/Tools/blender-5.2.2-windows-x64/blender.exe),
// the CC0 textures (npm run textures) and Python with Pillow for the generated textures.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const BLENDER = process.env.BLENDER ?? 'D:/Tools/blender-5.2.2-windows-x64/blender.exe';
const TMP = resolve('out/blender');
const ALL = ['plate:indoor_01', 'sprite:paper_full', 'sprite:steel_popper', 'sprite:mesh_wall'];
const jobs = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

mkdirSync(TMP, { recursive: true });
execFileSync('python', ['blender/textures.py'], { stdio: 'inherit' });

for (const job of jobs) {
  const [kind, id] = job.split(':');
  const png = `${TMP}/${id}.png`;
  console.log(`rendering ${job} ...`);
  // sprites at 2× (supersampled, downsampled below); plates at full 4K
  const args = kind === 'sprite' ? ['256', '2'] : ['384', '1'];
  execFileSync(BLENDER, ['-b', '--factory-startup', '--python', 'blender/scene.py', '--', job, png, ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (kind === 'plate') {
    await sharp(png).webp({ quality: 88, effort: 5 }).toFile(`../../src/assets/environments/${id}.webp`);
    continue;
  }
  const { width, height } = await sharp(png).metadata();
  // soft fade at the left/right edges, so no shadow ever ends in a hard cut
  const fade = Math.round(width * 0.08);
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="f" x1="0" x2="1">` +
      `<stop offset="0" stop-color="#000"/><stop offset="${fade / width}" stop-color="#fff"/>` +
      `<stop offset="${1 - fade / width}" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#f)"/></svg>`,
  );
  // shadow-catcher pixels are pure black + alpha: drop the faint overall shading so only real
  // shadows remain (otherwise the sprite's rectangle shows as a slightly darker floor patch)
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] + data[i + 1] + data[i + 2] <= 6) data[i + 3] = Math.max(0, Math.min(255, Math.round((data[i + 3] - 30) * 1.25)));
  }
  const cleaned = await sharp(data, { raw: info }).png().toBuffer();
  const faded = await sharp(cleaned).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  mkdirSync('../../src/assets/realistic', { recursive: true });
  await sharp(faded)
    .resize(Math.round(width / 2), Math.round(height / 2), { kernel: 'lanczos3' })
    .webp({ quality: 90, alphaQuality: 100, effort: 5 })
    .toFile(`../../src/assets/realistic/${id}.webp`);
}
rmSync(TMP, { recursive: true, force: true });
console.log('done');
