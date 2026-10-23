// Downloads the CC0 forest assets (Poly Haven textures, models, HDRIs) the driven-hunt scenes use,
// into public/tex/forest (not committed — run once).
//   node scripts/fetch-forest.mjs
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
};
const HDRIS = { autumn_forest_02: '4k', snowy_forest: '4k', schachen_forest: '4k' };

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

console.log('forest assets ready in', OUT);
