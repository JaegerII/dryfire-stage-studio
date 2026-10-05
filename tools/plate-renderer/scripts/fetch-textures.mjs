// Downloads the photo-scanned PBR materials (ambientCG, CC0) and HDRIs (Poly Haven, CC0)
// the realistic renders use, into public/tex (not committed — run once after npm install).
//   npm run textures
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'public/tex';
const TMP = '.tex-download';

/** ambientCG material id → maps to keep (2K JPG). */
const MATERIALS = [
  'Cardboard004', 'Concrete034', 'Concrete036', 'Wood058', 'Rubber001', 'Rubber004', 'Fabric030', 'PaintedMetal004',
  // outdoor ranges
  'Gravel041', 'Ground048', 'Ground037', 'Grass004',
];
const MAPS = { Color: 'color', NormalGL: 'normal', Roughness: 'rough', AmbientOcclusion: 'ao', Metalness: 'metal' };
/** Poly Haven HDRI id → resolution. Outdoor skies are seen in the background, so they need 8K. */
const HDRIS = { empty_warehouse_01: '2k', countrytrax_midday: '8k', evening_meadow: '8k', farmland_overcast: '8k', grasslands_sunset: '8k' };

mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const get = async (url, file) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
};

for (const id of MATERIALS) {
  if (existsSync(join(OUT, `${id}_color.jpg`))) continue;
  console.log(`material ${id} ...`);
  const zip = join(TMP, `${id}.zip`);
  const dir = join(TMP, id);
  await get(`https://ambientcg.com/get?file=${id}_2K-JPG.zip`, zip);
  mkdirSync(dir, { recursive: true });
  // Windows tar (bsdtar) understands zip; on other systems plain tar/bsdtar does
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
  execSync(`"${tar}" -xf "${zip}" -C "${dir}"`);
  for (const f of readdirSync(dir)) {
    const m = f.match(/_2K-JPG_(\w+)\.jpg$/);
    if (m && MAPS[m[1]]) copyFileSync(join(dir, f), join(OUT, `${id}_${MAPS[m[1]]}.jpg`));
  }
}

for (const [id, res] of Object.entries(HDRIS)) {
  if (existsSync(join(OUT, `${id}.hdr`))) continue;
  console.log(`hdri ${id} (${res}) ...`);
  await get(`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/${res}/${id}_${res}.hdr`, join(OUT, `${id}.hdr`));
}

rmSync(TMP, { recursive: true, force: true });
console.log('textures ready in', OUT);
