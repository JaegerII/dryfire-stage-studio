// Renders every environment plate at 3840x2160 and stores it as WebP in the Stage Studio asset folder.
//   npm run plates            → all plates
//   npm run plates indoor_02  → one plate
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import sharp from 'sharp';

const OUT = '../../src/assets/environments';
const TMP = 'out';
const ALL = ['indoor_01', 'indoor_02', 'indoor_03', 'indoor_04', 'outdoor_01', 'outdoor_02', 'outdoor_03', 'outdoor_04'];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

mkdirSync(TMP, { recursive: true });
for (const id of ids) {
  console.log(`rendering ${id} ...`);
  const png = `${TMP}/${id}.png`;
  execSync(`npx remotion still ${id.replace('_', '-')} ${png} --log=error`, { stdio: 'inherit' });
  await sharp(png).webp({ quality: 86, effort: 5 }).toFile(`${OUT}/${id}.webp`);
}
rmSync(TMP, { recursive: true, force: true });
console.log('done');
