/**
 * Puts the MediaPipe runtime and pose models into public/, so pose tracking
 * runs fully offline from the app's own origin (no CDN at runtime).
 *
 *   public/mediapipe/wasm/*   copied from node_modules/@mediapipe/tasks-vision/wasm
 *   public/models/*.task      downloaded once from Google's model storage
 *
 * Idempotent: existing files are kept. `--force` downloads the models again.
 * Runs automatically before `dev`, `build` and `test` (see package.json).
 */
import { copyFile, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');

const WASM_SRC = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const WASM_DST = join(root, 'public/mediapipe/wasm');
// FilesetResolver picks the SIMD or the no-SIMD build at runtime
const WASM_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];

const MODELS = {
  'pose_landmarker_lite.task': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  'pose_landmarker_full.task': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
};
const MODEL_DST = join(root, 'public/models');

const exists = async (p) => {
  try {
    return (await stat(p)).size > 0;
  } catch {
    return false;
  }
};

await mkdir(WASM_DST, { recursive: true });
for (const f of WASM_FILES) {
  const dst = join(WASM_DST, f);
  if (!(await exists(dst)) || force) await copyFile(join(WASM_SRC, f), dst);
}

await mkdir(MODEL_DST, { recursive: true });
for (const [name, url] of Object.entries(MODELS)) {
  const dst = join(MODEL_DST, name);
  if ((await exists(dst)) && !force) continue;
  process.stdout.write(`fetching ${name} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // write to a temp file first, so an interrupted download never leaves a broken model behind
  await writeFile(`${dst}.part`, buf);
  await rename(`${dst}.part`, dst);
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
}
console.log('mediapipe runtime + pose models ready in public/');
