// Downloads the CC0 forest assets (Poly Haven textures, models, HDRIs; ambientCG bark) the driven-hunt scenes use,
// into public/tex/forest (not committed — run once).
//   node scripts/fetch-forest.mjs
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT = 'public/tex/forest';

/** Poly Haven texture id → resolution. Maps: diff, nor_gl, rough (jpg). */
const TEXTURES = {
  dry_decay_leaves: '2k', // beech leaf litter
  forest_leaves_02: '2k', // mossy lane centre strip
  stony_dirt_path: '2k', // gravel track
  trident_maple_bark: '2k', // smooth bark, tinted grey → beech
  snow_02: '2k', // winter variant
  forest_leaves_04: '2k', // needle litter (spruce lane)
};
/** Poly Haven model id → resolution (glTF). */
const MODELS = {
  dead_tree_trunk: '2k',
  dry_branches_medium_01: '1k',
  fern_02: '1k',
  moss_01: '1k',
  bark_debris_01: '1k',
  // photo-scanned conifers for the spruce lane (render only — the live preview keeps its light trees)
  fir_tree_01: '1k',
  fir_sapling_medium: '1k',
  fir_sapling: '1k',
  tree_stump_01: '1k',
  tree_stump_02: '1k',
};
/** ambientCG bark (CC0), 2K: Bark005 smooth grey (beech), Bark014 scaly red-brown (spruce). */
const AMBIENT = ['Bark005', 'Bark014'];
const HDRIS = { autumn_forest_02: '4k', snowy_forest: '4k', schachen_forest: '4k', autumn_forest_03: '4k' };

const get = async (url, file) => {
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
};
const files = async (id) => (await fetch(`https://api.polyhaven.com/files/${id}`)).json();

for (const [id, res] of Object.entries(TEXTURES)) {
  console.log(`texture ${id} (${res}) ...`);
  const f = await files(id);
  for (const [map, short] of [['Diffuse', 'diff'], ['nor_gl', 'nor_gl'], ['Rough', 'rough']]) {
    await get(f[map][res].jpg.url, join(OUT, id, `${id}_${short}.jpg`));
  }
}

for (const [id, res] of Object.entries(MODELS)) {
  console.log(`model ${id} (${res}) ...`);
  const g = (await files(id)).gltf[res].gltf;
  await get(g.url, join(OUT, id, `${id}.gltf`));
  for (const [rel, inc] of Object.entries(g.include)) await get(inc.url, join(OUT, id, rel));
}

for (const [id, res] of Object.entries(HDRIS)) {
  console.log(`hdri ${id} (${res}) ...`);
  await get(`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/${res}/${id}_${res}.hdr`, join(OUT, `${id}.hdr`));
}

for (const id of AMBIENT) {
  const dir = join(OUT, id);
  if (existsSync(join(dir, `${id}_diff.jpg`))) continue;
  console.log(`ambientCG ${id} ...`);
  const tmp = join(OUT, `.${id}`);
  mkdirSync(tmp, { recursive: true });
  await get(`https://ambientcg.com/get?file=${id}_2K-JPG.zip`, join(tmp, 'a.zip'));
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
  execSync(`"${tar}" -xf "${join(tmp, 'a.zip')}" -C "${tmp}"`);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(tmp)) {
    const m = f.match(/_2K-JPG_(Color|NormalGL|Roughness)\.jpg$/);
    if (m) copyFileSync(join(tmp, f), join(dir, `${id}_${{ Color: 'diff', NormalGL: 'nor_gl', Roughness: 'rough' }[m[1]]}.jpg`));
  }
  rmSync(tmp, { recursive: true, force: true });
}

console.log('forest assets ready in', OUT);
