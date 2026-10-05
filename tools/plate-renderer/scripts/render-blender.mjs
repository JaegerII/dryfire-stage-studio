// Photorealistic renders with Blender Cycles (see blender/scene.py).
//   npm run blender                          → every plate + sprite
//   npm run blender sprite:paper_full        → one job (plate:indoor_01, sprite:<type>)
//   npm run blender sprites                  → all sprites
// Needs Blender (BLENDER env var or D:/Tools/blender-5.2.2-windows-x64/blender.exe),
// the CC0 textures (npm run textures) and Python with Pillow for the generated textures.
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const BLENDER = process.env.BLENDER ?? 'D:/Tools/blender-5.2.2-windows-x64/blender.exe';
const A = '../../src/assets';
const TMP = resolve('out/blender');

// sprite frame geometry comes from the app's registry (single source of truth)
const reg = readFileSync(`${A}/registry.ts`, 'utf8');
const GEOM = {};
for (const m of reg.matchAll(/^\s+(\w+): \{ type: '\w+',.*?viewW: ([\d.]+), viewH: ([\d.]+), groundY: ([\d.]+)/gm)) GEOM[m[1]] = [m[2], m[3], m[4]];
const SKIP = ['start_box']; // floor marking, stays a drawing
const SPRITES = Object.keys(GEOM).filter((t) => !SKIP.includes(t));
const PLATES = ['indoor_01', 'indoor_02', 'indoor_03', 'indoor_04', 'outdoor_01', 'outdoor_02', 'outdoor_03', 'outdoor_04'];

const argJobs = process.argv.slice(2);
const jobs = !argJobs.length
  ? [...PLATES.map((p) => `plate:${p}`), ...SPRITES.map((s) => `sprite:${s}`)]
  : argJobs.flatMap((j) => (j === 'sprites' ? SPRITES.map((s) => `sprite:${s}`) : j === 'plates' ? PLATES.map((p) => `plate:${p}`) : [j]));

mkdirSync(TMP, { recursive: true });
execFileSync('python', ['blender/textures.py'], { stdio: 'inherit' });

// banner artwork → bitmap (Chrome renders the SVG with its embedded font), banner area only (50 of 54 cm)
for (const b of SPRITES.filter((s) => s.startsWith('banner_'))) {
  if (!jobs.includes(`sprite:${b}`)) continue;
  copyFileSync(`${A}/banners/${b}.svg`, `public/tex/gen/${b}.svg`);
  execSync(`npx remotion still banner-image ${TMP}/${b}_raw.png --props="{\\"file\\":\\"${b}.svg\\"}" --log=error`, { stdio: 'inherit' });
  await sharp(`${TMP}/${b}_raw.png`).extract({ left: 0, top: 0, width: 3200, height: 1000 }).png().toFile(`public/tex/gen/${b}.png`);
}

const t0 = Date.now();
for (const [i, job] of jobs.entries()) {
  const [kind, id] = job.split(':');
  const png = `${TMP}/${id}.png`;
  console.log(`[${i + 1}/${jobs.length}] ${job} ...`);
  // sprites at 2× (supersampled, downsampled below); plates at full 4K
  const args = kind === 'sprite' ? ['192', '2', GEOM[id].join(',')] : ['384', '1'];
  execFileSync(BLENDER, ['-b', '--factory-startup', '--python', 'blender/scene.py', '--', job, png, ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (kind === 'plate') {
    await sharp(png).webp({ quality: 88, effort: 5 }).toFile(`${A}/environments/${id}.webp`);
    continue;
  }
  const { width, height } = await sharp(png).metadata();
  // shadow-catcher pixels are pure black + alpha: drop the faint overall shading so only real
  // shadows remain (otherwise the sprite's rectangle shows as a slightly darker floor patch)
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let p = 0; p < data.length; p += 4) {
    if (data[p] + data[p + 1] + data[p + 2] <= 6) data[p + 3] = Math.max(0, Math.min(255, Math.round((data[p + 3] - 30) * 1.25)));
  }
  // soft fade at the left/right edges, so no shadow ever ends in a hard cut
  const fade = Math.round(width * 0.08);
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="f" x1="0" x2="1">` +
      `<stop offset="0" stop-color="#000"/><stop offset="${fade / width}" stop-color="#fff"/>` +
      `<stop offset="${1 - fade / width}" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#f)"/></svg>`,
  );
  const cleaned = await sharp(data, { raw: info }).png().toBuffer();
  const faded = id.startsWith('banner_') ? cleaned : await sharp(cleaned).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  mkdirSync(`${A}/realistic`, { recursive: true });
  await sharp(faded)
    .resize(Math.round(width / 2), Math.round(height / 2), { kernel: 'lanczos3' })
    .webp({ quality: 90, alphaQuality: 100, effort: 5 })
    .toFile(`${A}/realistic/${id}.webp`);
}
rmSync(TMP, { recursive: true, force: true });
console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s`);
