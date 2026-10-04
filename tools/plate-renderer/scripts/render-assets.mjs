// Renders the photorealistic asset sprites (transparent WebP) into the Stage Studio asset folder.
//   npm run assets               → all sprites
//   npm run assets paper_full    → one sprite
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import sharp from 'sharp';

const OUT = '../../src/assets/realistic';
const TMP = 'out';
const ALL = ['paper_full', 'steel_popper', 'mesh_wall'];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });
for (const id of ids) {
  console.log(`rendering ${id} ...`);
  const png = `${TMP}/${id}.png`;
  execSync(`npx remotion still asset-${id.replace(/_/g, '-')} ${png} --image-format=png --log=error`, { stdio: 'inherit' });
  const { width, height } = await sharp(png).metadata();
  // soft fade at the left/right edges, so no shadow ever ends in a hard cut
  const fade = Math.round(width * 0.04);
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="f" x1="0" x2="1">` +
      `<stop offset="0" stop-color="#000"/><stop offset="${fade / width}" stop-color="#fff"/>` +
      `<stop offset="${1 - fade / width}" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#f)"/></svg>`,
  );
  const faded = await sharp(png).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  await sharp(faded)
    .resize(Math.round(width / 2), Math.round(height / 2), { kernel: 'lanczos3' })
    .webp({ quality: 90, alphaQuality: 100, effort: 5 })
    .toFile(`${OUT}/${id}.webp`);
}
rmSync(TMP, { recursive: true, force: true });
console.log('done');
